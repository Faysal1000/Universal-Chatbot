"""Run a use case for every job of a BullMQ queue.

The event loop only does Redis I/O (lock renewal, progress, completion); parsing runs in a
worker thread so a long page never stalls lock renewal. Failures become BullMQ outcomes:
``PermanentJobError`` -> ``UnrecoverableError`` (no retry), ``RetryableJobError`` -> a
normal failure (retried with the job's backoff), anything else -> ``internal_error`` (retried,
logged with its stack).
"""

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from bullmq import Job, UnrecoverableError, Worker
from pydantic import BaseModel

from app.application.job_envelope import read_job_metadata, read_job_payload
from app.application.ports import ProgressReporter
from app.contracts.generated.job_envelope_v1 import JobMetadata
from app.domain.errors import FailureCode, PermanentJobError, RetryableJobError
from app.observability.job_context import JobContext, job_context

PROGRESS_REPORT_TIMEOUT_SECONDS = 10

logger = logging.getLogger(__name__)

UseCaseRunner = Callable[[Any, ProgressReporter], BaseModel]


@dataclass(frozen=True, slots=True)
class QueueBinding:
    """A queue, the payload model its jobs carry, and the use case that processes them."""

    queue_name: str
    payload_model: type[BaseModel]
    run_use_case: UseCaseRunner


@dataclass(frozen=True, slots=True)
class WorkerSettings:
    redis_url: str
    queue_prefix: str
    concurrency: int
    lock_duration_milliseconds: int
    stalled_interval_milliseconds: int


class JobProgressReporter:
    """Forwards progress from the parsing thread to ``job.updateProgress`` on the event loop."""

    def __init__(self, job: Job, event_loop: asyncio.AbstractEventLoop) -> None:
        self._job = job
        self._event_loop = event_loop

    def report_progress(self, pages_done: int, pages_total: int) -> None:
        progress = {"pagesDone": pages_done, "pagesTotal": pages_total}
        future = asyncio.run_coroutine_threadsafe(self._job.updateProgress(progress), self._event_loop)
        try:
            future.result(timeout=PROGRESS_REPORT_TIMEOUT_SECONDS)
        except Exception:
            logger.warning("Could not report progress %s/%s", pages_done, pages_total, exc_info=True)


class QueueJobProcessor:
    def __init__(self, binding: QueueBinding) -> None:
        self._binding = binding

    async def process(self, job: Job, token: str) -> dict[str, Any]:
        try:
            return await self._process_envelope(job)
        except PermanentJobError as failure:
            logger.warning("Job %s failed permanently: %s", job.id, failure)
            raise UnrecoverableError(str(failure)) from failure
        except RetryableJobError as failure:
            logger.warning("Job %s failed and may be retried: %s", job.id, failure)
            raise
        except Exception as error:
            logger.exception("Job %s failed unexpectedly", job.id)
            raise RuntimeError(
                f"{FailureCode.INTERNAL_ERROR.value}: {type(error).__name__}: {error}"
            ) from error

    async def _process_envelope(self, job: Job) -> dict[str, Any]:
        metadata = read_job_metadata(job.data)
        context = _job_context(job, self._binding.queue_name, metadata)
        with job_context(context):
            payload = read_job_payload(job.data, self._binding.payload_model)
            progress_reporter = JobProgressReporter(job, asyncio.get_running_loop())
            logger.info("Processing job %s (attempt %s)", job.id, context.attempt)
            result = await asyncio.to_thread(self._binding.run_use_case, payload, progress_reporter)
            logger.info("Completed job %s", job.id)
            return result.model_dump(mode="json")


def create_worker(binding: QueueBinding, settings: WorkerSettings) -> Worker:
    processor = QueueJobProcessor(binding)
    return Worker(
        binding.queue_name,
        processor.process,
        {
            "connection": settings.redis_url,
            "prefix": settings.queue_prefix,
            "concurrency": settings.concurrency,
            "lockDuration": settings.lock_duration_milliseconds,
            "stalledInterval": settings.stalled_interval_milliseconds,
            "name": f"document-parser:{binding.queue_name}",
            "autorun": False,
        },
    )


def _job_context(job: Job, queue_name: str, metadata: JobMetadata) -> JobContext:
    payload = job.data.get("payload") if isinstance(job.data, dict) else None
    document_id = payload.get("documentId") if isinstance(payload, dict) else None
    return JobContext(
        queue=queue_name,
        job_id=str(job.id),
        attempt=int(job.attemptsMade) + 1,
        request_id=metadata.requestId,
        document_id=str(document_id) if document_id is not None else None,
    )
