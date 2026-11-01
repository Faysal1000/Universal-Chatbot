"""Describes how a task resolves to models, for callers that budget their prompts."""

from app.protocols.types import UpstreamTarget
from app.routing.task_routes import RouteCandidate, RoutingSnapshot
from app.schemas.tasks import TaskLimitsResponse, TaskModelResponse, TaskResolutionResponse


def describe_task_resolution(snapshot: RoutingSnapshot, task_name: str) -> TaskResolutionResponse:
    """The candidate models for ``task_name`` and the limits every one of them respects."""
    route_candidates = snapshot.resolve(task_name)
    targets = [route_candidate.target for route_candidate in route_candidates]
    return TaskResolutionResponse(
        task_name=task_name,
        is_routed=snapshot.is_routed(task_name),
        requires_vision=snapshot.policy_for(task_name).requires_vision,
        models=[_describe_candidate(route_candidate) for route_candidate in route_candidates],
        limits=TaskLimitsResponse(
            context_window_tokens=_smallest_known([target.context_window_tokens for target in targets]),
            max_output_tokens=_smallest_known([target.max_output_tokens for target in targets]),
        ),
    )


def _describe_candidate(route_candidate: RouteCandidate) -> TaskModelResponse:
    target: UpstreamTarget = route_candidate.target
    return TaskModelResponse(
        step=route_candidate.step_number,
        role=route_candidate.role,
        max_attempts=route_candidate.max_attempts,
        qualified_name=target.qualified_model_name,
        provider_id=target.provider_id,
        model_id=target.model_id,
        context_window_tokens=target.context_window_tokens,
        max_output_tokens=target.max_output_tokens,
        capabilities=sorted(target.capabilities),
    )


def _smallest_known(limits: list[int | None]) -> int | None:
    """A fallback model may be smaller than the primary, so the tightest declared limit wins."""
    known_limits = [limit for limit in limits if limit is not None]
    return min(known_limits) if known_limits else None
