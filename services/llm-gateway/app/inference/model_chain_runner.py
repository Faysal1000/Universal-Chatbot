"""Walks a task's model chain for one request: breaker skips, fallbacks, one final error.

* Steps are tried in chain order. A step whose model has an open circuit breaker is
  skipped; every other step is served by a :class:`ModelCaller`, which retries on that
  model up to the step's ``max_attempts``.
* A failed step moves the request to the next step, unless the provider rejected the
  request content itself (400/413/422), which another model would reject too.
* A stream moves on only before its first token reached the caller; after that the
  failure is reported in-stream and the chain stops.
* When no step serves the request, the caller gets one error listing every step reached
  and why it failed or was skipped (model names and error classes only, never secrets).
"""

import logging
from dataclasses import dataclass, field
from typing import Literal

from starlette.types import Send

from app.core.errors import AllModelsCoolingDownError, GatewayError, UpstreamError
from app.inference.asgi_responses import send_gateway_error
from app.inference.attempt_chain import CompletionRequestContext, ModelAttemptChain
from app.inference.model_caller import CommittedStreamFailure, ModelCaller
from app.protocols.registry import adapter_for
from app.protocols.types import JsonObject
from app.routing.circuit_breaker import CircuitBreakerBoard
from app.routing.task_routes import RouteCandidate

logger = logging.getLogger(__name__)

CIRCUIT_OPEN_REASON = "circuit_open"


@dataclass(frozen=True, slots=True)
class StepOutcome:
    """Why one chain step did not serve the request (part of the final error body)."""

    step: int
    model: str
    outcome: Literal["failed", "skipped"]
    error_class: str
    http_status: int | None = None
    attempts: int = 0

    def to_json(self) -> JsonObject:
        """The step as listed in ``error.steps``."""
        return {
            "step": self.step,
            "model": self.model,
            "outcome": self.outcome,
            "http_status": self.http_status,
            "error_class": self.error_class,
            "attempts": self.attempts,
        }


@dataclass(slots=True)
class _ChainProgress:
    """What happened so far in one request's walk down the chain."""

    outcomes: list[StepOutcome] = field(default_factory=list)
    last_failed_chain: ModelAttemptChain | None = None
    last_error: GatewayError | None = None

    @property
    def pending_fallback_reason(self) -> str | None:
        return self.outcomes[-1].error_class if self.outcomes else None


class ModelChainRunner:
    """Serves a request with the first chain step that succeeds."""

    def __init__(
        self,
        json_model_caller: ModelCaller,
        streaming_model_caller: ModelCaller,
        breakers: CircuitBreakerBoard,
    ) -> None:
        self._json_model_caller = json_model_caller
        self._streaming_model_caller = streaming_model_caller
        self._breakers = breakers

    async def run(
        self,
        chat_request: JsonObject,
        route_candidates: list[RouteCandidate],
        request_context: CompletionRequestContext,
        send: Send,
    ) -> None:
        """Serve the request or send one error describing every step reached."""
        model_caller = self._streaming_model_caller if request_context.is_stream else self._json_model_caller
        progress = _ChainProgress()
        for steps_tried, route_candidate in enumerate(route_candidates, start=1):
            self._note_fallback(request_context, progress, route_candidate)
            if self._breakers.is_open(route_candidate.target):
                self._skip_open_step(route_candidate, progress)
                continue
            chain = ModelAttemptChain(
                candidate=route_candidate,
                request_context=request_context,
                steps_tried=steps_tried,
                fallback_reason=progress.pending_fallback_reason,
            )
            try:
                await model_caller.serve(adapter_for(chain.target.api_protocol), chat_request, chain, send)
            except CommittedStreamFailure as committed_failure:
                self._breakers.record_failure(chain.target, committed_failure.cause.error_code)
                return
            except GatewayError as model_error:
                self._record_step_failure(chain, model_error, progress)
                if isinstance(model_error, UpstreamError) and not model_error.allows_fallback:
                    break
                continue
            self._breakers.record_success(chain.target)
            return
        await self._send_chain_failure(progress, send)

    @staticmethod
    def _skip_open_step(route_candidate: RouteCandidate, progress: _ChainProgress) -> None:
        target = route_candidate.target
        progress.outcomes.append(
            StepOutcome(
                step=route_candidate.step_number,
                model=target.qualified_model_name,
                outcome="skipped",
                error_class=CIRCUIT_OPEN_REASON,
            )
        )

    def _record_step_failure(
        self, chain: ModelAttemptChain, model_error: GatewayError, progress: _ChainProgress
    ) -> None:
        if _is_model_failure(model_error):
            self._breakers.record_failure(chain.target, model_error.error_code)
        progress.last_failed_chain, progress.last_error = chain, model_error
        progress.outcomes.append(
            StepOutcome(
                step=chain.candidate.step_number,
                model=chain.target.qualified_model_name,
                outcome="failed",
                error_class=model_error.error_code,
                http_status=int(model_error.http_status),
                attempts=chain.attempt_count,
            )
        )

    @staticmethod
    def _note_fallback(
        request_context: CompletionRequestContext, progress: _ChainProgress, next_candidate: RouteCandidate
    ) -> None:
        """Log the move from the previous step to ``next_candidate``."""
        if not progress.outcomes:
            return
        previous_outcome = progress.outcomes[-1]
        logger.warning(
            "Moving to the next chain step",
            extra={
                "task_name": request_context.task_name,
                "from_step": previous_outcome.step,
                "from_model": previous_outcome.model,
                "to_step": next_candidate.step_number,
                "to_model": next_candidate.target.qualified_model_name,
                "reason": previous_outcome.error_class,
            },
        )

    @staticmethod
    async def _send_chain_failure(progress: _ChainProgress, send: Send) -> None:
        step_reports = [outcome.to_json() for outcome in progress.outcomes]
        if progress.last_error is None or progress.last_failed_chain is None:
            await send_gateway_error(send, AllModelsCoolingDownError(), step_reports=step_reports)
            return
        await send_gateway_error(
            send,
            progress.last_error,
            progress.last_failed_chain.response_headers(),
            step_reports=step_reports,
        )


def _is_model_failure(model_error: GatewayError) -> bool:
    """Failures that say something about the model's health (and count towards its breaker)."""
    return isinstance(model_error, UpstreamError) and model_error.allows_fallback
