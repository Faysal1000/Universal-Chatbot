"""In-process throttling of failed admin sign-ins (sliding one-minute window)."""

import time
from collections import deque

_WINDOW_SECONDS = 60


class LoginAttemptLimiter:
    """Sliding one-minute window of failed logins per client address (in-process)."""

    def __init__(self, max_failures_per_minute: int) -> None:
        self._max_failures_per_minute = max_failures_per_minute
        self._failure_times_by_client: dict[str, deque[float]] = {}

    def is_blocked(self, client_address: str, now_monotonic: float | None = None) -> bool:
        """Whether this client has used up its failed attempts for the current window."""
        return len(self._recent_failures(client_address, now_monotonic)) >= self._max_failures_per_minute

    def record_failure(self, client_address: str, now_monotonic: float | None = None) -> None:
        """Count one failed login for ``client_address``."""
        current_time = now_monotonic if now_monotonic is not None else time.monotonic()
        self._recent_failures(client_address, current_time)
        self._failure_times_by_client.setdefault(client_address, deque()).append(current_time)

    def reset(self, client_address: str) -> None:
        """Forget failures after a successful login."""
        self._failure_times_by_client.pop(client_address, None)

    def _recent_failures(self, client_address: str, now_monotonic: float | None) -> deque[float]:
        """Drop failures older than the window; clients with none hold no state (bounded memory)."""
        failure_times = self._failure_times_by_client.get(client_address)
        if failure_times is None:
            return deque()
        current_time = now_monotonic if now_monotonic is not None else time.monotonic()
        while failure_times and current_time - failure_times[0] > _WINDOW_SECONDS:
            failure_times.popleft()
        if not failure_times:
            del self._failure_times_by_client[client_address]
        return failure_times
