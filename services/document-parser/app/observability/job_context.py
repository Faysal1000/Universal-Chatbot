"""Identifiers of the job being processed, attached to every log line emitted for it."""

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class JobContext:
    queue: str
    job_id: str
    attempt: int
    request_id: str | None = None
    document_id: str | None = None


_current_job_context: ContextVar[JobContext | None] = ContextVar("current_job_context", default=None)


def current_job_context() -> JobContext | None:
    return _current_job_context.get()


@contextmanager
def job_context(context: JobContext) -> Iterator[JobContext]:
    token = _current_job_context.set(context)
    try:
        yield context
    finally:
        _current_job_context.reset(token)
