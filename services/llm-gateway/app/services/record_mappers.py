"""Mapping of configuration rows to API response models (no secret values ever leave here)."""

from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal

from app.persistence.tables import ProviderModelRecord, ProviderRecord, TaskRecord, TaskRouteRecord
from app.routing.provider_registry import parse_api_protocol, parse_reasoning_control
from app.schemas.local_models import LocalModelDeploymentResponse
from app.schemas.providers import ProviderModelResponse, ProviderResponse
from app.schemas.routing import BreakerStatusName, ChainStepResponse, TaskRouteResponse
from app.schemas.task_catalog import TaskResponse


def optional_float(price: Decimal | None) -> float | None:
    """Prices are stored as exact decimals and returned as JSON numbers."""
    return float(price) if price is not None else None


def optional_decimal(price: float | None) -> Decimal | None:
    """Convert via ``str`` so 0.1 is stored as 0.1, not its binary approximation."""
    return Decimal(str(price)) if price is not None else None


def model_to_response(provider_model: ProviderModelRecord) -> ProviderModelResponse:
    """Serialise a model row."""
    return ProviderModelResponse(
        id=provider_model.id,
        provider_id=provider_model.provider_id,
        model_id=provider_model.model_id,
        qualified_name=f"{provider_model.provider_id}/{provider_model.model_id}",
        display_name=provider_model.display_name,
        is_enabled=provider_model.is_enabled,
        default_max_output_tokens=provider_model.default_max_output_tokens,
        context_window_tokens=provider_model.context_window_tokens,
        max_output_tokens=provider_model.max_output_tokens,
        capabilities=list(provider_model.capabilities),
        is_available=provider_model.is_available,
        base_url_override=provider_model.base_url_override,
        api_protocol_override=(
            parse_api_protocol(provider_model.api_protocol_override)
            if provider_model.api_protocol_override
            else None
        ),
        reasoning_control=parse_reasoning_control(provider_model.reasoning_control),
        breaker_failure_threshold=provider_model.breaker_failure_threshold,
        breaker_cooldown_seconds=provider_model.breaker_cooldown_seconds,
        input_price_usd_per_million_tokens=optional_float(provider_model.input_price_usd_per_million_tokens),
        cached_input_price_usd_per_million_tokens=optional_float(
            provider_model.cached_input_price_usd_per_million_tokens
        ),
        output_price_usd_per_million_tokens=optional_float(
            provider_model.output_price_usd_per_million_tokens
        ),
        created_at=provider_model.created_at,
        updated_at=provider_model.updated_at,
    )


def provider_to_response(provider: ProviderRecord) -> ProviderResponse:
    """Serialise a provider row; secrets are reduced to ``has_api_key`` and header names."""
    return ProviderResponse(
        provider_id=provider.provider_id,
        display_name=provider.display_name,
        base_url=provider.base_url,
        api_protocol=parse_api_protocol(provider.api_protocol),
        has_api_key=provider.encrypted_api_key is not None,
        extra_header_names=list(provider.extra_header_names),
        is_enabled=provider.is_enabled,
        request_timeout_seconds=provider.request_timeout_seconds,
        max_concurrent_requests=provider.max_concurrent_requests,
        models=[model_to_response(provider_model) for provider_model in provider.models],
        created_at=provider.created_at,
        updated_at=provider.updated_at,
    )


@dataclass(frozen=True, slots=True)
class RouteDisplayContext:
    """What a route needs besides its own rows to be shown: names, default model, breakers."""

    model_names: dict[int, str]
    default_model_pk: int | None
    breaker_status_of: Callable[[int], BreakerStatusName]


def task_route_to_response(task_route: TaskRouteRecord, context: RouteDisplayContext) -> TaskRouteResponse:
    """Serialise a route with its ordered chain, model names and breaker status."""
    appended_default_pk = context.default_model_pk if task_route.append_default_model else None
    return TaskRouteResponse(
        task_name=task_route.task_name,
        description=task_route.description,
        is_enabled=task_route.is_enabled,
        append_default_model=task_route.append_default_model,
        steps=[
            ChainStepResponse(
                position=route_step.position,
                model_pk=route_step.model_pk,
                model_name=context.model_names.get(route_step.model_pk, "unknown"),
                max_attempts=route_step.max_attempts,
                timeout_seconds=route_step.timeout_seconds,
                is_enabled=route_step.is_enabled,
                breaker_status=context.breaker_status_of(route_step.model_pk),
            )
            for route_step in task_route.steps
        ],
        default_model_pk=appended_default_pk,
        default_model_name=context.model_names.get(appended_default_pk) if appended_default_pk else None,
        created_at=task_route.created_at,
        updated_at=task_route.updated_at,
    )


def task_to_response(task: TaskRecord, has_route: bool) -> TaskResponse:
    """Serialise a task."""
    return TaskResponse(
        task_name=task.task_name,
        description=task.description,
        requires_vision=task.requires_vision,
        has_route=has_route,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


def deployment_to_response(
    provider_model: ProviderModelRecord, provider: ProviderRecord
) -> LocalModelDeploymentResponse:
    """Serialise a local deployment with its effective endpoint."""
    return LocalModelDeploymentResponse(
        deployment_name=provider_model.model_id,
        model_pk=provider_model.id,
        qualified_name=f"{provider_model.provider_id}/{provider_model.model_id}",
        display_name=provider_model.display_name,
        base_url=provider_model.base_url_override or provider.base_url,
        api_protocol=parse_api_protocol(provider_model.api_protocol_override or provider.api_protocol),
        capabilities=list(provider_model.capabilities),
        reasoning_control=parse_reasoning_control(provider_model.reasoning_control),
        context_window_tokens=provider_model.context_window_tokens,
        max_output_tokens=provider_model.max_output_tokens,
        is_available=provider_model.is_available,
        is_enabled=provider_model.is_enabled,
        has_api_key=provider.encrypted_api_key is not None,
        created_at=provider_model.created_at,
        updated_at=provider_model.updated_at,
    )
