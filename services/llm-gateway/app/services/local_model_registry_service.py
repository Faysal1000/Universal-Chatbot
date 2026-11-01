"""Machine registration of ``services/local-llm`` deployments under the "Local models" provider.

Registration is an idempotent upsert keyed by deployment name: each call leaves the
model available with exactly the reported endpoint, limits and capabilities (the
admin's enable switch is kept). A deployment may claim default routes for tasks that
have none yet; an admin's existing route is never overwritten.
"""

import logging

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.model_capabilities import VISION_CAPABILITY
from app.persistence import configuration_repository
from app.persistence.tables import ProviderModelRecord, ProviderRecord, TaskRouteRecord, TaskRouteStepRecord
from app.routing.routing_catalog import RoutingCatalog
from app.schemas.local_models import (
    LocalModelDeploymentResponse,
    LocalModelRegistrationRequest,
    LocalModelRegistrationResponse,
)
from app.security.secret_cipher import SecretCipher
from app.services.errors import InvalidReferenceError, ResourceConflictError, ResourceNotFoundError
from app.services.record_mappers import deployment_to_response
from app.services.task_model_compatibility import (
    ensure_models_suit_task,
    ensure_vision_can_be_removed,
    model_has_vision,
)

logger = logging.getLogger(__name__)

LOCAL_MODELS_PROVIDER_ID = "local-models"
LOCAL_MODELS_PROVIDER_NAME = "Local models"
# Self-hosted models may run on CPU, so they get far longer than hosted APIs.
LOCAL_MODELS_REQUEST_TIMEOUT_SECONDS = 600.0
LOCAL_MODELS_MAX_CONCURRENT_REQUESTS = 16


class LocalModelRegistryService:
    """Use cases behind ``/v1/local-models`` (authenticated with the registration key)."""

    def __init__(
        self, database_session: AsyncSession, secret_cipher: SecretCipher, routing_catalog: RoutingCatalog
    ) -> None:
        self._database_session = database_session
        self._secret_cipher = secret_cipher
        self._routing_catalog = routing_catalog

    async def list_deployments(self) -> list[LocalModelDeploymentResponse]:
        """Every registered deployment, so local-llm can reconcile after a restart."""
        provider = await configuration_repository.find_provider(
            self._database_session, LOCAL_MODELS_PROVIDER_ID
        )
        if provider is None:
            return []
        return [deployment_to_response(provider_model, provider) for provider_model in provider.models]

    async def register(
        self, deployment_name: str, registration: LocalModelRegistrationRequest
    ) -> LocalModelRegistrationResponse:
        """Create or update the deployment's model, mark it available, and claim free default routes."""
        try:
            return await self._register_once(deployment_name, registration)
        except IntegrityError:
            # Another deployment created the provider or this model at the same moment; now it exists.
            await self._database_session.rollback()
            return await self._register_once(deployment_name, registration)

    async def _register_once(
        self, deployment_name: str, registration: LocalModelRegistrationRequest
    ) -> LocalModelRegistrationResponse:
        provider = await self._ensure_local_provider(registration)
        self._store_api_key_if_sent(provider, registration)
        provider_model = await configuration_repository.find_model_by_name(
            self._database_session, LOCAL_MODELS_PROVIDER_ID, deployment_name
        )
        was_created = provider_model is None
        if provider_model is None:
            provider_model = ProviderModelRecord(
                provider_id=LOCAL_MODELS_PROVIDER_ID, model_id=deployment_name
            )
            self._database_session.add(provider_model)
        else:
            await self._ensure_vision_kept_if_routed(provider_model, registration)
        self._apply_registration(provider_model, registration)
        await self._database_session.flush()
        claimed_task_names = await self._claim_default_routes(provider_model, registration.default_for_tasks)
        await self._commit()
        await self._database_session.refresh(provider_model)
        logger.info(
            "Local model registered",
            extra={
                "deployment_name": deployment_name,
                "was_created": was_created,
                "claimed": claimed_task_names,
            },
        )
        return LocalModelRegistrationResponse(
            **deployment_to_response(provider_model, provider).model_dump(),
            was_created=was_created,
            claimed_default_routes=claimed_task_names,
        )

    async def mark_unavailable(self, deployment_name: str) -> LocalModelDeploymentResponse:
        """Stop routing to the deployment (e.g. unloaded); its routes fall back until it registers again."""
        provider_model = await configuration_repository.find_model_by_name(
            self._database_session, LOCAL_MODELS_PROVIDER_ID, deployment_name
        )
        if provider_model is None:
            raise ResourceNotFoundError(f"Local deployment '{deployment_name}' is not registered")
        provider_model.is_available = False
        await self._commit()
        await self._database_session.refresh(provider_model)
        logger.info("Local model marked unavailable", extra={"deployment_name": deployment_name})
        return deployment_to_response(provider_model, provider_model.provider)

    async def _ensure_local_provider(self, registration: LocalModelRegistrationRequest) -> ProviderRecord:
        provider = await configuration_repository.find_provider(
            self._database_session, LOCAL_MODELS_PROVIDER_ID
        )
        if provider is not None:
            return provider
        provider = ProviderRecord(
            provider_id=LOCAL_MODELS_PROVIDER_ID,
            display_name=LOCAL_MODELS_PROVIDER_NAME,
            base_url=registration.base_url,
            api_protocol=registration.api_protocol,
            request_timeout_seconds=LOCAL_MODELS_REQUEST_TIMEOUT_SECONDS,
            max_concurrent_requests=LOCAL_MODELS_MAX_CONCURRENT_REQUESTS,
            models=[],
        )
        self._database_session.add(provider)
        await self._database_session.flush()
        return provider

    def _store_api_key_if_sent(
        self, provider: ProviderRecord, registration: LocalModelRegistrationRequest
    ) -> None:
        if registration.api_key is not None and registration.api_key.get_secret_value():
            provider.encrypted_api_key = self._secret_cipher.encrypt_text(
                registration.api_key.get_secret_value()
            )

    async def _ensure_vision_kept_if_routed(
        self, provider_model: ProviderModelRecord, registration: LocalModelRegistrationRequest
    ) -> None:
        if model_has_vision(provider_model) and VISION_CAPABILITY not in registration.capabilities:
            await ensure_vision_can_be_removed(self._database_session, provider_model)

    @staticmethod
    def _apply_registration(
        provider_model: ProviderModelRecord, registration: LocalModelRegistrationRequest
    ) -> None:
        provider_model.display_name = registration.display_name
        provider_model.base_url_override = registration.base_url
        provider_model.api_protocol_override = registration.api_protocol
        provider_model.capabilities = list(registration.capabilities)
        if registration.reasoning_control is not None:
            provider_model.reasoning_control = registration.reasoning_control
        provider_model.context_window_tokens = registration.context_window_tokens
        provider_model.max_output_tokens = registration.max_output_tokens
        provider_model.is_available = True

    async def _claim_default_routes(
        self, provider_model: ProviderModelRecord, task_names: list[str]
    ) -> list[str]:
        claimed_task_names: list[str] = []
        for task_name in task_names:
            if await configuration_repository.find_task(self._database_session, task_name) is None:
                raise InvalidReferenceError(f"Task '{task_name}' is not a built-in task")
            if await configuration_repository.find_task_route(self._database_session, task_name):
                continue
            await ensure_models_suit_task(self._database_session, task_name, [provider_model.id])
            # One-step route: this model, then the default model.
            self._database_session.add(
                TaskRouteRecord(
                    task_name=task_name,
                    append_default_model=True,
                    steps=[TaskRouteStepRecord(position=1, model_pk=provider_model.id, max_attempts=None)],
                )
            )
            claimed_task_names.append(task_name)
        return claimed_task_names

    async def _commit(self) -> None:
        try:
            await self._database_session.commit()
        except IntegrityError as integrity_error:
            await self._database_session.rollback()
            raise ResourceConflictError("The registration conflicts with existing data") from integrity_error
        self._routing_catalog.invalidate()
