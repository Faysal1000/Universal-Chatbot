"""Retry decisions and backoff delays of :class:`RetryPolicy`."""

import pytest

from app.core.errors import UpstreamRateLimitedError, UpstreamRejectedRequestError, UpstreamServerError
from app.inference.retry_policy import RetryPolicy

POLICY = RetryPolicy(max_attempts_per_model=3, base_delay_seconds=1.0, max_delay_seconds=4.0)


def test_non_retryable_error_stops_immediately() -> None:
    assert POLICY.delay_before_next_attempt(1, UpstreamRejectedRequestError(upstream_status_code=400)) is None


def test_stops_after_max_attempts() -> None:
    assert POLICY.delay_before_next_attempt(3, UpstreamServerError(upstream_status_code=500)) is None


@pytest.mark.parametrize(("attempts_made", "full_delay"), [(1, 1.0), (2, 2.0)])
def test_exponential_backoff_with_jitter(attempts_made: int, full_delay: float) -> None:
    delay = POLICY.delay_before_next_attempt(attempts_made, UpstreamServerError(upstream_status_code=503))
    assert delay is not None
    assert full_delay * 0.5 <= delay <= full_delay


def test_backoff_is_capped_at_max_delay() -> None:
    policy = RetryPolicy(max_attempts_per_model=10, base_delay_seconds=1.0, max_delay_seconds=4.0)
    delay = policy.delay_before_next_attempt(8, UpstreamServerError(upstream_status_code=500))
    assert delay is not None
    assert delay <= 4.0


def test_retry_after_is_honoured_but_capped() -> None:
    honoured = POLICY.delay_before_next_attempt(
        1, UpstreamRateLimitedError(upstream_status_code=429, retry_after_seconds=3.0)
    )
    capped = POLICY.delay_before_next_attempt(
        1, UpstreamRateLimitedError(upstream_status_code=429, retry_after_seconds=60.0)
    )
    assert honoured == 3.0
    assert capped == 4.0
