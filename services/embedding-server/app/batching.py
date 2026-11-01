"""Admission control and dynamic micro-batching in front of a single model instance.

Lifecycle of one item:

1. ``DynamicBatcher.reserve`` admits N items against ``max_pending_items`` or fails
   fast with 503, so memory and latency stay bounded under overload.
2. The caller prepares inputs (tokenisation, image decoding) while holding the
   reservation, then calls ``CapacityReservation.embed``.
3. Jobs wait in a per-modality FIFO. The worker takes the modality whose oldest job
   has waited longest, tops the batch up for at most the collection window, and
   runs the model on a dedicated single-thread executor.
4. Each job's slot is released when the worker finishes or discards it, so
   ``pending_items`` always reflects real memory held by the service.
"""

import asyncio
import logging
import time
from collections import defaultdict, deque
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from contextlib import suppress
from dataclasses import dataclass, field
from types import TracebackType

import numpy as np
import numpy.typing as npt

from app.config import Settings
from app.errors import (
    InferenceFailedError,
    ServiceAtCapacityError,
    ServiceUnavailableError,
)
from app.model import EmbeddingBackend, EncoderInput

logger = logging.getLogger(__name__)

EmbeddingVector = npt.NDArray[np.float32]


@dataclass(slots=True)
class EmbeddingJob:
    """A single prepared item waiting for, or undergoing, inference."""

    encoder_input: EncoderInput
    result_future: asyncio.Future[EmbeddingVector]
    enqueued_at_monotonic: float = field(default_factory=time.monotonic)

    @property
    def modality(self) -> str:
        """Batching key inherited from the encoder input."""
        return self.encoder_input.modality


class CapacityReservation:
    """Admission slots held by one request; unused slots return to the pool on exit."""

    def __init__(self, batcher: "DynamicBatcher", item_count: int) -> None:
        self._batcher = batcher
        self._item_count = item_count
        self._handed_to_worker = False

    def __enter__(self) -> "CapacityReservation":
        return self

    def __exit__(
        self,
        exception_type: type[BaseException] | None,
        exception: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        if not self._handed_to_worker:
            self._batcher._release_slots(self._item_count)

    async def embed(self, encoder_inputs: Sequence[EncoderInput]) -> list[EmbeddingVector]:
        """Submit prepared inputs and wait for their embeddings, preserving order.

        Cancelling the awaiting task (timeout or client disconnect) cancels every job,
        and the worker discards cancelled jobs without running inference on them.

        Raises:
            ValueError: If the number of inputs differs from the reserved count.
            ServiceUnavailableError: If the worker stopped since the reservation.
            InferenceFailedError: If the model failed for any item in the request.
        """
        if len(encoder_inputs) != self._item_count:
            raise ValueError("Number of inputs must match the reserved item count")
        if self._handed_to_worker:
            raise RuntimeError("A reservation can only be submitted once")

        result_futures = self._batcher._enqueue(encoder_inputs)
        self._handed_to_worker = True  # The worker now releases each slot individually.

        results = await asyncio.gather(*result_futures, return_exceptions=True)
        for result in results:
            if isinstance(result, BaseException):
                raise result
        return results  # type: ignore[return-value]  # all entries are vectors here.


class DynamicBatcher:
    """Bounded multi-modality job queue served by one background inference worker."""

    def __init__(self, embedding_backend: EmbeddingBackend, settings: Settings) -> None:
        self._embedding_backend = embedding_backend
        self._settings = settings
        self._pending_jobs_by_modality: defaultdict[str, deque[EmbeddingJob]] = defaultdict(deque)
        self._work_available = asyncio.Event()
        self._admitted_item_count = 0
        self._accepting_work = False
        self._stop_requested = False
        self._worker_task: asyncio.Task[None] | None = None
        # One thread: the model is serialised anyway, and a dedicated pool means
        # image decoding or tokenisation can never starve inference of a thread.
        self._inference_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="embedding-inference")

    # ----- Lifecycle -----

    def start(self) -> None:
        """Launch the worker task on the running event loop."""
        if self._worker_task is not None:
            raise RuntimeError("DynamicBatcher has already been started")
        self._worker_task = asyncio.create_task(self._run_worker(), name="embedding-batch-worker")
        self._accepting_work = True
        logger.info("Embedding batch worker started")

    async def stop(self, drain_timeout_seconds: float) -> None:
        """Stop admitting work, drain queued jobs, then release all resources.

        Jobs still pending after ``drain_timeout_seconds`` are failed with 503 so no
        caller waits forever.
        """
        self._accepting_work = False
        self._stop_requested = True
        self._work_available.set()

        if self._worker_task is not None:
            try:
                await asyncio.wait_for(asyncio.shield(self._worker_task), drain_timeout_seconds)
            except TimeoutError:
                logger.error(
                    "Batch worker did not drain in time; cancelling",
                    extra={"pending_items": self._admitted_item_count},
                )
                self._worker_task.cancel()
                await asyncio.gather(self._worker_task, return_exceptions=True)

        self._fail_all_pending_jobs(ServiceUnavailableError("Embedding service is shutting down"))
        self._inference_executor.shutdown(wait=False, cancel_futures=True)
        logger.info("Embedding batch worker stopped")

    @property
    def is_healthy(self) -> bool:
        """True while the worker task is alive and accepting new work."""
        return self._accepting_work and self._worker_task is not None and not self._worker_task.done()

    @property
    def has_crashed(self) -> bool:
        """True if the worker exited without a stop request (liveness should fail)."""
        return self._worker_task is not None and self._worker_task.done() and not self._stop_requested

    @property
    def pending_item_count(self) -> int:
        """Items admitted but not yet finished."""
        return self._admitted_item_count

    # ----- Admission control -----

    def reserve(self, item_count: int) -> CapacityReservation:
        """Admit ``item_count`` items or fail fast without blocking.

        Raises:
            ServiceUnavailableError: If the worker is not running.
            ServiceAtCapacityError: If admitting would exceed ``max_pending_items``.
        """
        if item_count < 1:
            raise ValueError("item_count must be positive")
        if not self.is_healthy:
            raise ServiceUnavailableError()
        if self._admitted_item_count + item_count > self._settings.max_pending_items:
            raise ServiceAtCapacityError()
        self._admitted_item_count += item_count
        return CapacityReservation(self, item_count)

    def _release_slots(self, item_count: int) -> None:
        self._admitted_item_count -= item_count
        if self._admitted_item_count < 0:
            logger.error("Admission counter underflow; resetting to zero")
            self._admitted_item_count = 0

    def _enqueue(self, encoder_inputs: Sequence[EncoderInput]) -> list[asyncio.Future[EmbeddingVector]]:
        if not self.is_healthy:
            raise ServiceUnavailableError()
        event_loop = asyncio.get_running_loop()
        result_futures: list[asyncio.Future[EmbeddingVector]] = []
        for encoder_input in encoder_inputs:
            job = EmbeddingJob(encoder_input=encoder_input, result_future=event_loop.create_future())
            self._pending_jobs_by_modality[job.modality].append(job)
            result_futures.append(job.result_future)
        self._work_available.set()
        return result_futures

    # ----- Worker -----

    def _has_pending_jobs(self) -> bool:
        return any(self._pending_jobs_by_modality.values())

    async def _wait_for_new_work(self, timeout_seconds: float | None) -> None:
        """Sleep until new work is enqueued, stop is requested, or the timeout elapses.

        Callers must check for pending work *before* calling; the event is cleared
        here without an intervening ``await``, so no wake-up can be lost.
        """
        self._work_available.clear()
        with suppress(TimeoutError):
            await asyncio.wait_for(self._work_available.wait(), timeout_seconds)

    def _modality_with_oldest_job(self) -> str | None:
        """Pick the modality whose head-of-line job has waited longest (fairness)."""
        oldest_modality: str | None = None
        oldest_enqueue_time = float("inf")
        for modality, pending_jobs in self._pending_jobs_by_modality.items():
            if pending_jobs and pending_jobs[0].enqueued_at_monotonic < oldest_enqueue_time:
                oldest_modality = modality
                oldest_enqueue_time = pending_jobs[0].enqueued_at_monotonic
        return oldest_modality

    def _move_live_jobs_into_batch(self, modality: str, batch: list[EmbeddingJob]) -> None:
        """Pop jobs of ``modality`` into ``batch``, discarding ones whose caller gave up."""
        pending_jobs = self._pending_jobs_by_modality[modality]
        while pending_jobs and len(batch) < self._settings.inference_batch_size:
            job = pending_jobs.popleft()
            if job.result_future.done():
                self._release_slots(1)
                continue
            batch.append(job)

    async def _collect_batch(self) -> list[EmbeddingJob]:
        """Gather up to ``inference_batch_size`` same-modality jobs.

        The collection window is measured from when the oldest job was enqueued, so
        a job that already waited behind a previous batch is not delayed further.
        """
        modality = self._modality_with_oldest_job()
        if modality is None:
            return []

        batch: list[EmbeddingJob] = []
        self._move_live_jobs_into_batch(modality, batch)
        if not batch:
            return []

        window_seconds = self._settings.batch_collection_window_milliseconds / 1000
        collection_deadline = batch[0].enqueued_at_monotonic + window_seconds
        while len(batch) < self._settings.inference_batch_size and not self._stop_requested:
            remaining_seconds = collection_deadline - time.monotonic()
            if remaining_seconds <= 0:
                break
            await self._wait_for_new_work(remaining_seconds)
            self._move_live_jobs_into_batch(modality, batch)
        return batch

    async def _process_batch(self, batch: list[EmbeddingJob]) -> None:
        """Run inference for live jobs and resolve every job's future exactly once."""
        modality = batch[0].modality
        live_jobs = [job for job in batch if not job.result_future.done()]
        try:
            if not live_jobs:
                return
            embedding_matrix = await asyncio.get_running_loop().run_in_executor(
                self._inference_executor,
                self._embedding_backend.encode_batch,
                [job.encoder_input for job in live_jobs],
            )
            for job, embedding_vector in zip(live_jobs, embedding_matrix, strict=True):
                if not job.result_future.done():
                    job.result_future.set_result(embedding_vector)

        except asyncio.CancelledError:
            self._fail_jobs(batch, ServiceUnavailableError("Worker stopped during inference"))
            raise
        except Exception:
            logger.exception(
                "Embedding inference batch failed",
                extra={"batch_size": len(live_jobs), "modality": modality},
            )
            self._fail_jobs(batch, InferenceFailedError())
        finally:
            self._release_slots(len(batch))

    async def _run_worker(self) -> None:
        """Main worker loop; on an unexpected crash, stop admitting and fail fast."""
        try:
            while True:
                if not self._has_pending_jobs():
                    if self._stop_requested:
                        return
                    await self._wait_for_new_work(timeout_seconds=None)
                    continue
                batch = await self._collect_batch()
                if batch:
                    await self._process_batch(batch)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.critical("Embedding batch worker crashed; service is no longer healthy", exc_info=True)
            self._accepting_work = False
            self._fail_all_pending_jobs(ServiceUnavailableError())
            raise

    # ----- Failure helpers -----

    @staticmethod
    def _fail_jobs(jobs: Sequence[EmbeddingJob], error: Exception) -> None:
        for job in jobs:
            if not job.result_future.done():
                job.result_future.set_exception(error)

    def _fail_all_pending_jobs(self, error: Exception) -> None:
        for pending_jobs in self._pending_jobs_by_modality.values():
            while pending_jobs:
                job = pending_jobs.popleft()
                self._fail_jobs([job], error)
                self._release_slots(1)
