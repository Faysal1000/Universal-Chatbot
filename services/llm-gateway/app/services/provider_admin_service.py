"""Provider and model administration: create, update, delete, with encrypted secrets.

Every successful write invalidates the routing cache so new configuration is used
by the very next request.
"""

import logging

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.model_capabilities import VISION_CAPABILITY
from app.persistence import configuration_repository
from app.persistence.tables import ProviderModelRecord, ProviderRecord
from app.routing.routing_catalog import RoutingCatalog
from app.schemas.providers import (
    ExtraHeaderInput,
    ProviderCreateRequest,
    ProviderModelCreateRequest,
    ProviderModelResponse,
    ProviderModelUpdateRequest,
    ProviderResponse,
    ProviderUpdateRequest,
)
from app.security.secret_cipher import SecretCipher
from app.services.errors import (
    InvalidParameterError,
    InvalidReferenceError,
    ResourceConflictError,
    ResourceNotFoundError,
)
from app.services.record_mappers import model_to_response, optional_decimal, provider_to_response
from app.services.task_model_compatibility import ensure_vision_can_be_removed, model_has_vision

logger = logging.getLogger(__name__)

_PROVIDER_SCALAR_FIELDS = (
    "display_name",
    "base_url",
    "api_protocol",
    "is_enabled",
    "request_timeout_seconds",
    "max_concurrent_requests",
)
# Optional model fields copied verbatim; an explicit ``null`` clears them.
_MODEL_OPTIONAL_FIELDS = (
    "display_name",
    "default_max_output_tokens",
    "context_window_tokens",
    "max_output_tokens",
    "base_url_override",
    "api_protocol_override",
    "breaker_failure_threshold",
    "breaker_cooldown_seconds",
)
_MODEL_PRICE_FIELDS = (
    "input_price_usd_per_million_tokens",
    "cached_input_price_usd_per_million_tokens",
    "output_price_usd_per_million_tokens",
)


def merge_extra_headers(
    requested_headers: list[ExtraHeaderInput], stored_headers: dict[str, str]
) -> dict[str, str]:
    """Replace-whole-list semantics where an entry with ``value: None`` keeps its stored value."""
    merged_headers: dict[str, str] = {}
    for requested_header in requested_headers:
        if requested_header.value is not None:
            merged_headers[requested_header.name] = requested_header.value
        elif requested_header.name in stored_headers:
            merged_headers[requested_header.name] = stored_headers[requested_header.name]
        else:
            raise InvalidReferenceError(
                f"Header '{requested_header.name}' needs a value (it is not stored yet)"
            )
    return merged_headers


def _ensure_output_limits_consistent(provider_model: ProviderModelRecord) -> None:
    """The default output length cannot exceed the model's maximum output."""
    default_output = provider_model.default_max_output_tokens
    maximum_output = provider_model.max_output_tokens
    if default_output is not None and maximum_output is not None and default_output > maximum_output:
        raise InvalidParameterError(
            f"default_max_output_tokens ({default_output}) exceeds max_output_tokens ({maximum_output})"
        )


class ProviderAdminService:
    """Use cases behind ``/admin/api/providers`` and ``/admin/api/models``."""

    def __init__(
        self, database_session: AsyncSession, secret_cipher: SecretCipher, routing_catalog: RoutingCatalog
    ) -> None:
        self._database_session = database_session
        self._secret_cipher = secret_cipher
        self._routing_catalog = routing_catalog

    # ----- Providers -----

    async def list_providers(self) -> list[ProviderResponse]:
        """All providers with their models."""
        return [
            provider_to_response(provider)
            for provider in await configuration_repository.list_providers(self._database_session)
        ]

    async def get_provider(self, provider_id: str) -> ProviderResponse:
        """One provider with its models."""
        return provider_to_response(await self.require_provider(provider_id))

    async def create_provider(self, create_request: ProviderCreateRequest) -> ProviderResponse:
        """Register a provider; its API key and header values are encrypted before storage."""
        if await configuration_repository.find_provider(self._database_session, create_request.provider_id):
            raise ResourceConflictError(f"Provider '{create_request.provider_id}' already exists")
        provider = ProviderRecord(
            provider_id=create_request.provider_id,
            display_name=create_request.display_name,
            base_url=create_request.base_url,
            api_protocol=create_request.api_protocol,
            is_enabled=create_request.is_enabled,
            request_timeout_seconds=create_request.request_timeout_seconds,
            max_concurrent_requests=create_request.max_concurrent_requests,
            models=[],
        )
        if create_request.api_key and create_request.api_key.get_secret_value():
            provider.encrypted_api_key = self._secret_cipher.encrypt_text(
                create_request.api_key.get_secret_value()
            )
        self._store_extra_headers(provider, merge_extra_headers(create_request.extra_headers, {}))
        self._database_session.add(provider)
        await self._commit(conflict_message="Provider already exists")
        await self._database_session.refresh(provider)
        logger.info("Provider created", extra={"provider_id": provider.provider_id})
        return provider_to_response(provider)

    async def update_provider(
        self, provider_id: str, update_request: ProviderUpdateRequest
    ) -> ProviderResponse:
        """Partial update; see :class:`ProviderUpdateRequest` for the secret semantics."""
        provider = await self.require_provider(provider_id)
        for field_name in _PROVIDER_SCALAR_FIELDS:
            new_value = getattr(update_request, field_name)
            if new_value is not None:
                setattr(provider, field_name, new_value)
        if update_request.clear_api_key:
            provider.encrypted_api_key = None
        elif update_request.api_key is not None and update_request.api_key.get_secret_value():
            provider.encrypted_api_key = self._secret_cipher.encrypt_text(
                update_request.api_key.get_secret_value()
            )
        if update_request.extra_headers is not None:
            self._store_extra_headers(
                provider, merge_extra_headers(update_request.extra_headers, self._stored_headers(provider))
            )
        await self._commit()
        await self._database_session.refresh(provider)
        logger.info("Provider updated", extra={"provider_id": provider_id})
        return provider_to_response(provider)

    async def delete_provider(self, provider_id: str) -> None:
        """Delete a provider and its models unless one of them is still routed to."""
        provider = await self.require_provider(provider_id)
        await self._ensure_models_unused(
            [provider_model.id for provider_model in provider.models], "Provider models"
        )
        await self._database_session.delete(provider)
        await self._commit()
        logger.info("Provider deleted", extra={"provider_id": provider_id})

    # ----- Models -----

    async def create_model(
        self, provider_id: str, create_request: ProviderModelCreateRequest
    ) -> ProviderModelResponse:
        """Add a model to a provider."""
        await self.require_provider(provider_id)
        provider_model = ProviderModelRecord(
            provider_id=provider_id,
            model_id=create_request.model_id,
            is_enabled=create_request.is_enabled,
            capabilities=list(create_request.capabilities),
            reasoning_control=create_request.reasoning_control,
            **{field_name: getattr(create_request, field_name) for field_name in _MODEL_OPTIONAL_FIELDS},
            **{
                field_name: optional_decimal(getattr(create_request, field_name))
                for field_name in _MODEL_PRICE_FIELDS
            },
        )
        _ensure_output_limits_consistent(provider_model)
        self._database_session.add(provider_model)
        await self._commit(
            conflict_message=f"Model '{create_request.model_id}' already exists for '{provider_id}'"
        )
        await self._database_session.refresh(provider_model)
        return model_to_response(provider_model)

    async def update_model(
        self, model_pk: int, update_request: ProviderModelUpdateRequest
    ) -> ProviderModelResponse:
        """Partial update; explicitly sent ``null`` clears optional fields."""
        provider_model = await self.require_model(model_pk)
        sent_fields = update_request.model_fields_set
        for field_name in ("model_id", "is_enabled", "reasoning_control"):
            if field_name in sent_fields and getattr(update_request, field_name) is not None:
                setattr(provider_model, field_name, getattr(update_request, field_name))
        for field_name in _MODEL_OPTIONAL_FIELDS:
            if field_name in sent_fields:
                setattr(provider_model, field_name, getattr(update_request, field_name))
        if update_request.capabilities is not None:
            await self._replace_capabilities(provider_model, list(update_request.capabilities))
        for field_name in _MODEL_PRICE_FIELDS:
            if field_name in sent_fields:
                setattr(provider_model, field_name, optional_decimal(getattr(update_request, field_name)))
        _ensure_output_limits_consistent(provider_model)
        await self._commit(conflict_message="A model with that ID already exists")
        await self._database_session.refresh(provider_model)
        return model_to_response(provider_model)

    async def delete_model(self, model_pk: int) -> None:
        """Delete a model unless a task route or the default-model setting uses it."""
        provider_model = await self.require_model(model_pk)
        await self._ensure_models_unused([model_pk], "Model")
        await self._database_session.delete(provider_model)
        await self._commit()

    # ----- Shared lookups -----

    async def require_provider(self, provider_id: str) -> ProviderRecord:
        """The provider, or :class:`ResourceNotFoundError`."""
        provider = await configuration_repository.find_provider(self._database_session, provider_id)
        if provider is None:
            raise ResourceNotFoundError(f"Provider '{provider_id}' not found")
        return provider

    async def require_model(self, model_pk: int) -> ProviderModelRecord:
        """The model, or :class:`ResourceNotFoundError`."""
        provider_model = await configuration_repository.find_model(self._database_session, model_pk)
        if provider_model is None:
            raise ResourceNotFoundError(f"Model {model_pk} not found")
        return provider_model

    # ----- Internals -----

    async def _replace_capabilities(
        self, provider_model: ProviderModelRecord, capabilities: list[str]
    ) -> None:
        if model_has_vision(provider_model) and VISION_CAPABILITY not in capabilities:
            await ensure_vision_can_be_removed(self._database_session, provider_model)
        provider_model.capabilities = capabilities

    async def _ensure_models_unused(self, model_pks: list[int], subject: str) -> None:
        usages = [
            f"task route '{task_name}'"
            for task_name in await configuration_repository.list_task_names_using_models(
                self._database_session, model_pks
            )
        ]
        gateway_settings = await configuration_repository.get_gateway_settings(self._database_session)
        if gateway_settings.default_model_pk in model_pks:
            usages.append("the default model setting")
        if usages:
            raise ResourceConflictError(f"{subject} still used by {', '.join(usages)}")

    def _stored_headers(self, provider: ProviderRecord) -> dict[str, str]:
        if provider.encrypted_extra_headers is None:
            return {}
        return self._secret_cipher.decrypt_headers(provider.encrypted_extra_headers)

    def _store_extra_headers(self, provider: ProviderRecord, headers: dict[str, str]) -> None:
        provider.encrypted_extra_headers = self._secret_cipher.encrypt_headers(headers) if headers else None
        provider.extra_header_names = sorted(headers)

    async def _commit(self, conflict_message: str = "The change conflicts with existing data") -> None:
        try:
            await self._database_session.commit()
        except IntegrityError as integrity_error:
            await self._database_session.rollback()
            raise ResourceConflictError(conflict_message) from integrity_error
        self._routing_catalog.invalidate()
