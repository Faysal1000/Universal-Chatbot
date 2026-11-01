"""When to retry the same model, and how long to wait first.

Only retryable failures (429, 5xx, timeouts, connection errors, an error event before
any output) are retried, up to the chain step's ``max_attempts`` (default
``max_attempts_per_model``) attempts in total, with exponential backoff and jitter
that honours a provider's ``Retry-After``.
"""

import random
from dataclasses import dataclass

from app.core.config import Settings
from app.core.errors import UpstreamError


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    """Pure retry decision and delay calculation (sleeping is the caller's job)."""

    max_attempts_per_model: int
    base_delay_seconds: float
    max_delay_seconds: float

    @classmethod
    def from_settings(cls, settings: Settings) -> "RetryPolicy":
        """Build the policy from ``LLM_GATEWAY_*`` retry settings."""
        return cls(
            max_attempts_per_model=settings.max_attempts_per_model,
            base_delay_seconds=settings.retry_base_delay_seconds,
            max_delay_seconds=settings.retry_max_delay_seconds,
        )

    def delay_before_next_attempt(
        self, attempts_made: int, upstream_error: UpstreamError, max_attempts: int | None = None
    ) -> float | None:
        """Seconds to wait before attempt ``attempts_made + 1``, or ``None`` to stop retrying.

        ``max_attempts`` is the chain step's own limit; ``None`` uses ``max_attempts_per_model``.
        """
        attempt_limit = max_attempts or self.max_attempts_per_model
        if not upstream_error.is_retryable or attempts_made >= attempt_limit:
            return None
        exponential_delay = self.base_delay_seconds * (2 ** (attempts_made - 1))
        jitter_factor = random.uniform(0.5, 1.0)  # noqa: S311 - backoff jitter, not cryptography.
        backoff_delay: float = min(exponential_delay, self.max_delay_seconds) * jitter_factor
        if upstream_error.upstream_retry_after_seconds is not None:
            backoff_delay = max(
                backoff_delay, min(upstream_error.upstream_retry_after_seconds, self.max_delay_seconds)
            )
        return backoff_delay
