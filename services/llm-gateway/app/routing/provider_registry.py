"""Builds decrypted, database-detached :class:`UpstreamTarget` objects from configuration rows."""

import logging

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.reasoning_control import ReasoningControl, is_reasoning_control
from app.persistence.configuration_repository import (
    get_gateway_settings,
    list_providers,
    list_task_routes,
    list_tasks,
)
from app.persistence.tables import ProviderModelRecord, ProviderRecord, TaskRecord, TaskRouteRecord
from app.protocols.types import ApiProtocol, UpstreamTarget
from app.routing.task_routes import RouteStep, RoutingSnapshot, TaskPolicy, TaskRoute
from app.security.secret_cipher import SecretCipher

logger = logging.getLogger(__name__)


def build_upstream_target(
    provider: ProviderRecord, provider_model: ProviderModelRecord, cipher: SecretCipher
) -> UpstreamTarget:
    """Decrypt one provider model into a detached :class:`UpstreamTarget`.

    A model's own endpoint (``base_url_override`` / ``api_protocol_override``) wins over
    its provider's, which is how each local deployment keeps its own URL.
    """
    return UpstreamTarget(
        provider_id=provider.provider_id,
        provider_display_name=provider.display_name,
        base_url=provider_model.base_url_override or provider.base_url,
        api_protocol=parse_api_protocol(provider_model.api_protocol_override or provider.api_protocol),
        api_key=cipher.decrypt_text(provider.encrypted_api_key) if provider.encrypted_api_key else None,
        extra_headers=(
            cipher.decrypt_headers(provider.encrypted_extra_headers)
            if provider.encrypted_extra_headers
            else {}
        ),
        request_timeout_seconds=provider.request_timeout_seconds,
        max_concurrent_requests=provider.max_concurrent_requests,
        model_pk=provider_model.id,
        model_id=provider_model.model_id,
        default_max_output_tokens=provider_model.default_max_output_tokens,
        context_window_tokens=provider_model.context_window_tokens,
        max_output_tokens=provider_model.max_output_tokens,
        capabilities=frozenset(provider_model.capabilities),
        reasoning_control=parse_reasoning_control(provider_model.reasoning_control),
        breaker_failure_threshold=provider_model.breaker_failure_threshold,
        breaker_cooldown_seconds=provider_model.breaker_cooldown_seconds,
        input_price_usd_per_million_tokens=provider_model.input_price_usd_per_million_tokens,
        cached_input_price_usd_per_million_tokens=provider_model.cached_input_price_usd_per_million_tokens,
        output_price_usd_per_million_tokens=provider_model.output_price_usd_per_million_tokens,
    )


def parse_reasoning_control(raw_control: str) -> ReasoningControl:
    """Narrow a stored reasoning control (guarded by a CHECK constraint)."""
    if is_reasoning_control(raw_control):
        return raw_control
    raise ValueError(f"Unknown reasoning control {raw_control!r}")


def parse_api_protocol(raw_protocol: str) -> ApiProtocol:
    """Narrow a stored protocol string (guarded by a CHECK constraint) to :data:`ApiProtocol`."""
    if raw_protocol == "openai_chat_completions":
        return "openai_chat_completions"
    if raw_protocol == "openai_responses":
        return "openai_responses"
    if raw_protocol == "anthropic_messages":
        return "anthropic_messages"
    raise ValueError(f"Unknown API protocol in database: {raw_protocol!r}")


async def load_routing_snapshot(session: AsyncSession, cipher: SecretCipher) -> RoutingSnapshot:
    """Read every provider, model, task, route, and the default model in one pass."""
    providers = await list_providers(session)
    usable_targets_by_model_pk: dict[int, UpstreamTarget] = {}
    for provider in providers:
        if not provider.is_enabled:
            continue
        for provider_model in provider.models:
            if not (provider_model.is_enabled and provider_model.is_available):
                continue
            try:
                target = build_upstream_target(provider, provider_model, cipher)
            except ValueError:
                logger.exception(
                    "Skipping provider whose secrets cannot be decrypted",
                    extra={"provider_id": provider.provider_id},
                )
                break
            usable_targets_by_model_pk[provider_model.id] = target

    task_routes = await list_task_routes(session)
    gateway_settings = await get_gateway_settings(session)
    return RoutingSnapshot(
        usable_targets_by_model_pk=usable_targets_by_model_pk,
        routes_by_task_name={task_route.task_name: task_route_from(task_route) for task_route in task_routes},
        policies_by_task_name={task.task_name: task_policy_from(task) for task in await list_tasks(session)},
        default_model_pk=gateway_settings.default_model_pk,
    )


def task_route_from(task_route: TaskRouteRecord) -> TaskRoute:
    """Detach a route row and its ordered steps."""
    return TaskRoute(
        task_name=task_route.task_name,
        is_enabled=task_route.is_enabled,
        append_default_model=task_route.append_default_model,
        steps=tuple(
            RouteStep(
                position=route_step.position,
                model_pk=route_step.model_pk,
                max_attempts=route_step.max_attempts,
                timeout_seconds=route_step.timeout_seconds,
                is_enabled=route_step.is_enabled,
            )
            for route_step in task_route.steps
        ),
    )


def task_policy_from(task: TaskRecord) -> TaskPolicy:
    """Detach a catalog row into the routing view of the task."""
    return TaskPolicy(task_name=task.task_name, requires_vision=task.requires_vision)
