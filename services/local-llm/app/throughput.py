"""Sliding-window throughput per deployment: tokens per second and, for parsers, pages per minute."""

import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass

from app.engines.base import GenerationStats

SECONDS_PER_MINUTE = 60


@dataclass(frozen=True, slots=True)
class ThroughputSnapshot:
    """Throughput over the recent window; rates are ``None`` until a request completes."""

    window_seconds: int
    completed_requests: int
    generated_tokens: int
    tokens_per_second: float | None
    pages_parsed: int
    seconds_per_page: float | None
    pages_per_minute: float | None


@dataclass(frozen=True, slots=True)
class _Sample:
    finished_at: float
    stats: GenerationStats


class ThroughputTracker:
    """Rates are measured over busy time, so idle minutes do not dilute the model's speed."""

    def __init__(self, window_seconds: int, clock: Callable[[], float] = time.monotonic) -> None:
        self._window_seconds = window_seconds
        self._clock = clock
        self._samples: deque[_Sample] = deque()

    def record(self, stats: GenerationStats) -> None:
        """Add one finished generation."""
        self._samples.append(_Sample(finished_at=self._clock(), stats=stats))
        self._drop_expired_samples()

    def snapshot(self) -> ThroughputSnapshot:
        """Aggregate the samples still inside the window."""
        self._drop_expired_samples()
        stats_list = [sample.stats for sample in self._samples]
        generated_tokens = sum(stats.completion_tokens for stats in stats_list)
        generation_seconds = sum(stats.generation_seconds for stats in stats_list)
        page_stats = [stats for stats in stats_list if stats.pages > 0]
        pages_parsed = sum(stats.pages for stats in page_stats)
        page_seconds = sum(stats.generation_seconds for stats in page_stats)
        seconds_per_page = page_seconds / pages_parsed if pages_parsed else None
        return ThroughputSnapshot(
            window_seconds=self._window_seconds,
            completed_requests=len(stats_list),
            generated_tokens=generated_tokens,
            tokens_per_second=generated_tokens / generation_seconds if generation_seconds > 0 else None,
            pages_parsed=pages_parsed,
            seconds_per_page=seconds_per_page,
            pages_per_minute=SECONDS_PER_MINUTE / seconds_per_page if seconds_per_page else None,
        )

    def _drop_expired_samples(self) -> None:
        oldest_allowed = self._clock() - self._window_seconds
        while self._samples and self._samples[0].finished_at < oldest_allowed:
            self._samples.popleft()
