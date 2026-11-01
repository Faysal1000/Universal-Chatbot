"""Per-model circuit breakers: skip a model that keeps failing, then try it again later.

A model's breaker counts consecutive failed requests on that model (after the step's
retries), whichever task chain made them. Once the count reaches the model's threshold
the breaker is **open**: chains skip the model for the cooldown. After the cooldown it is
**half-open**: the next request tries the model, and a success closes the breaker while a
failure re-opens it for another cooldown. Content rejections (400/413/422), local
capacity limits and caller disconnects are not the model's fault and are not counted.

State is in memory and per replica (the gateway runs one worker per replica).
"""

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from app.protocols.types import UpstreamTarget

logger = logging.getLogger(__name__)

BreakerStatus = Literal["closed", "open", "half_open"]


@dataclass(slots=True)
class _ModelBreaker:
    qualified_model_name: str
    failure_threshold: int
    cooldown_seconds: int
    consecutive_failures: int = 0
    last_failure_monotonic: float | None = None
    last_failure_at: datetime | None = None
    last_error_class: str | None = None
    opened_count: int = 0


@dataclass(frozen=True, slots=True)
class BreakerState:
    """A model's breaker as shown by the admin API."""

    model_pk: int
    qualified_model_name: str
    status: BreakerStatus
    consecutive_failures: int
    failure_threshold: int
    cooldown_seconds: int
    cooldown_remaining_seconds: float
    last_failure_at: datetime | None
    last_error_class: str | None
    opened_count: int


class CircuitBreakerBoard:
    """Process-wide breakers keyed by model; thresholds come from the model or the defaults."""

    def __init__(
        self,
        default_failure_threshold: int,
        default_cooldown_seconds: int,
        monotonic_clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._default_failure_threshold = default_failure_threshold
        self._default_cooldown_seconds = default_cooldown_seconds
        self._monotonic_clock = monotonic_clock
        self._breakers_by_model_pk: dict[int, _ModelBreaker] = {}

    def is_open(self, target: UpstreamTarget) -> bool:
        """Whether chains must skip ``target`` now (open and still cooling down).

        Once the cooldown ends, the first caller gets through as the trial and the cooldown
        restarts, so the others keep skipping the model until that trial succeeds.
        """
        breaker = self._breakers_by_model_pk.get(target.model_pk)
        if breaker is None:
            return False
        status = self._status_of(breaker)
        if status == "half_open":
            breaker.last_failure_monotonic = self._monotonic_clock()
        return status == "open"

    def record_success(self, target: UpstreamTarget) -> None:
        """A served request closes the model's breaker."""
        breaker = self._breakers_by_model_pk.pop(target.model_pk, None)
        if breaker is not None and breaker.consecutive_failures >= breaker.failure_threshold:
            logger.info("Circuit breaker closed", extra={"model": breaker.qualified_model_name})

    def record_failure(self, target: UpstreamTarget, error_class: str) -> None:
        """Count a failed request; reaching the threshold opens (or re-opens) the breaker."""
        breaker = self._breaker_for(target)
        breaker.consecutive_failures += 1
        breaker.last_failure_monotonic = self._monotonic_clock()
        breaker.last_failure_at = datetime.now(UTC)
        breaker.last_error_class = error_class
        if breaker.consecutive_failures >= breaker.failure_threshold:
            breaker.opened_count += 1
            logger.warning(
                "Circuit breaker opened",
                extra={
                    "model": breaker.qualified_model_name,
                    "consecutive_failures": breaker.consecutive_failures,
                    "cooldown_seconds": breaker.cooldown_seconds,
                    "error_class": error_class,
                },
            )

    def states(self) -> list[BreakerState]:
        """Every model with at least one recent consecutive failure, by model key."""
        return [
            self._describe(model_pk, breaker)
            for model_pk, breaker in sorted(self._breakers_by_model_pk.items())
        ]

    def state_of(self, model_pk: int) -> BreakerState | None:
        """The model's breaker, or ``None`` when it has no recent failures (closed)."""
        breaker = self._breakers_by_model_pk.get(model_pk)
        return self._describe(model_pk, breaker) if breaker is not None else None

    def reset(self, model_pk: int) -> bool:
        """Close one model's breaker; ``False`` if it had no recorded failures."""
        return self._breakers_by_model_pk.pop(model_pk, None) is not None

    def reset_all(self) -> int:
        """Close every breaker and return how many had recorded failures."""
        reset_count = len(self._breakers_by_model_pk)
        self._breakers_by_model_pk.clear()
        return reset_count

    def _breaker_for(self, target: UpstreamTarget) -> _ModelBreaker:
        # Read on every failure: the admin may have changed the model's settings meanwhile.
        failure_threshold = target.breaker_failure_threshold or self._default_failure_threshold
        cooldown_seconds = target.breaker_cooldown_seconds or self._default_cooldown_seconds
        breaker = self._breakers_by_model_pk.setdefault(
            target.model_pk,
            _ModelBreaker(target.qualified_model_name, failure_threshold, cooldown_seconds),
        )
        breaker.failure_threshold = failure_threshold
        breaker.cooldown_seconds = cooldown_seconds
        return breaker

    def _status_of(self, breaker: _ModelBreaker) -> BreakerStatus:
        if breaker.consecutive_failures < breaker.failure_threshold:
            return "closed"
        return "open" if self._cooldown_remaining(breaker) > 0 else "half_open"

    def _cooldown_remaining(self, breaker: _ModelBreaker) -> float:
        if breaker.last_failure_monotonic is None:
            return 0.0
        elapsed_seconds = self._monotonic_clock() - breaker.last_failure_monotonic
        return max(breaker.cooldown_seconds - elapsed_seconds, 0.0)

    def _describe(self, model_pk: int, breaker: _ModelBreaker) -> BreakerState:
        status = self._status_of(breaker)
        return BreakerState(
            model_pk=model_pk,
            qualified_model_name=breaker.qualified_model_name,
            status=status,
            consecutive_failures=breaker.consecutive_failures,
            failure_threshold=breaker.failure_threshold,
            cooldown_seconds=breaker.cooldown_seconds,
            cooldown_remaining_seconds=round(self._cooldown_remaining(breaker), 3)
            if status == "open"
            else 0.0,
            last_failure_at=breaker.last_failure_at,
            last_error_class=breaker.last_error_class,
            opened_count=breaker.opened_count,
        )
