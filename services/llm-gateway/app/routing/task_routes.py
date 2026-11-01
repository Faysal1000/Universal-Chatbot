"""Resolution of a caller task to an ordered list of candidate models.

Callers never name real models. They send a task name (``answer_generation``,
``query_rewrite``...) in the Chat Completions ``model`` field and the gateway tries the
task route's **chain**: its enabled steps in order, then the gateway-wide default model
when the route appends it. Disabled or unavailable models and providers are skipped.
Unknown task names go straight to the default model, so a caller can introduce a new
task before the admin has configured a route for it; the task name is still recorded in
metrics. A task that requires vision is only ever served by vision-capable models.

Circuit breakers are applied per request on top of this (see ``circuit_breaker``).
"""

import dataclasses
from dataclasses import dataclass
from typing import Literal

from app.core.model_capabilities import VISION_CAPABILITY
from app.protocols.types import UpstreamTarget

DEFAULT_TASK_NAME = "default"

CandidateRole = Literal["primary", "fallback", "default"]


@dataclass(frozen=True, slots=True)
class RouteCandidate:
    """One model to try for a request, in chain order.

    ``target`` already carries the step's timeout. ``max_attempts`` ``None`` means the
    gateway-wide attempt count.
    """

    target: UpstreamTarget
    role: CandidateRole
    is_fallback: bool
    step_number: int
    max_attempts: int | None = None


@dataclass(frozen=True, slots=True)
class RouteStep:
    """Cached view of a ``task_route_steps`` row."""

    position: int
    model_pk: int
    max_attempts: int | None = None
    timeout_seconds: float | None = None
    is_enabled: bool = True


@dataclass(frozen=True, slots=True)
class TaskRoute:
    """Cached view of a ``task_routes`` row with its ordered chain."""

    task_name: str
    is_enabled: bool
    steps: tuple[RouteStep, ...]
    append_default_model: bool = False


@dataclass(frozen=True, slots=True)
class _PlannedStep:
    role: CandidateRole
    step_number: int
    model_pk: int | None
    max_attempts: int | None = None
    timeout_seconds: float | None = None


@dataclass(frozen=True, slots=True)
class TaskPolicy:
    """Cached view of a ``tasks`` row: what a task needs from its models."""

    task_name: str
    requires_vision: bool = False


@dataclass(frozen=True, slots=True)
class RoutingSnapshot:
    """Immutable, fully-decrypted routing configuration."""

    usable_targets_by_model_pk: dict[int, UpstreamTarget]
    routes_by_task_name: dict[str, TaskRoute]
    policies_by_task_name: dict[str, TaskPolicy]
    default_model_pk: int | None

    def policy_for(self, task_name: str) -> TaskPolicy:
        """The task's policy; tasks missing from the catalog have no requirements."""
        return self.policies_by_task_name.get(task_name) or TaskPolicy(task_name=task_name)

    def resolve(self, task_name: str) -> list[RouteCandidate]:
        """Return the ordered, de-duplicated, usable models for ``task_name``."""
        route_candidates: list[RouteCandidate] = []
        seen_model_pks: set[int] = set()
        for preference_position, planned_step in enumerate(self._planned_steps(task_name)):
            model_pk = planned_step.model_pk
            if model_pk is None or model_pk in seen_model_pks:
                continue
            seen_model_pks.add(model_pk)
            target = self.usable_targets_by_model_pk.get(model_pk)
            if target is not None and self._satisfies_policy(target, task_name):
                # Anything other than the chain's first choice counts as a fallback.
                is_fallback = preference_position > 0
                route_candidates.append(self._candidate_for(planned_step, target, is_fallback))
        return route_candidates

    def is_routed(self, task_name: str) -> bool:
        """Whether an enabled route exists (otherwise the default model serves the task)."""
        task_route = self.routes_by_task_name.get(task_name)
        return task_route is not None and task_route.is_enabled

    @property
    def routable_task_names(self) -> list[str]:
        """Task names a caller can usefully send (enabled routes plus ``default``)."""
        enabled_task_names = {name for name in self.routes_by_task_name if self.is_routed(name)}
        return sorted(enabled_task_names | {DEFAULT_TASK_NAME})

    @property
    def known_task_names(self) -> list[str]:
        """Catalogued tasks plus any routed task names, sorted."""
        return sorted(set(self.policies_by_task_name) | set(self.routes_by_task_name))

    def _planned_steps(self, task_name: str) -> list[_PlannedStep]:
        """Enabled chain steps in order (step numbers are chain positions), then the default."""
        task_route = self.routes_by_task_name.get(task_name)
        if task_route is None or not task_route.is_enabled:
            return [_PlannedStep(role="default", step_number=1, model_pk=self.default_model_pk)]
        planned_steps = [
            _PlannedStep(
                role="primary" if route_step.position == 1 else "fallback",
                step_number=route_step.position,
                model_pk=route_step.model_pk,
                max_attempts=route_step.max_attempts,
                timeout_seconds=route_step.timeout_seconds,
            )
            for route_step in task_route.steps
            if route_step.is_enabled
        ]
        if task_route.append_default_model:
            default_step_number = len(task_route.steps) + 1
            planned_steps.append(
                _PlannedStep(role="default", step_number=default_step_number, model_pk=self.default_model_pk)
            )
        return planned_steps

    @staticmethod
    def _candidate_for(
        planned_step: _PlannedStep, target: UpstreamTarget, is_fallback: bool
    ) -> RouteCandidate:
        if planned_step.timeout_seconds is not None:
            target = dataclasses.replace(target, request_timeout_seconds=planned_step.timeout_seconds)
        return RouteCandidate(
            target=target,
            role=planned_step.role,
            is_fallback=is_fallback,
            step_number=planned_step.step_number,
            max_attempts=planned_step.max_attempts,
        )

    def _satisfies_policy(self, target: UpstreamTarget, task_name: str) -> bool:
        return not self.policy_for(task_name).requires_vision or target.has_capability(VISION_CAPABILITY)


def normalise_task_name(requested_model_field: object) -> str:
    """The caller's ``model`` value, lower-cased; empty or missing means ``default``."""
    if not isinstance(requested_model_field, str) or not requested_model_field.strip():
        return DEFAULT_TASK_NAME
    return requested_model_field.strip().lower()[:128]
