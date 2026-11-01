import asyncio
from typing import Any

import pytest
from bullmq import UnrecoverableError
from pydantic import BaseModel

from app.adapters.bullmq_consumer import JobProgressReporter, QueueBinding, QueueJobProcessor
from app.application.ports import ProgressReporter
from app.contracts.generated.parse_inspect_v1 import ParseInspectPayload
from app.domain.errors import FailureCode, PermanentJobError, RetryableJobError
from app.observability.job_context import current_job_context
from tests.support.builders import an_envelope, an_inspect_payload


class FakeJob:
    def __init__(self, data: Any) -> None:
        self.id = "doc:run:inspect"
        self.data = data
        self.attemptsMade = 0
        self.progress_updates: list[dict[str, int]] = []

    async def updateProgress(self, progress: dict[str, int]) -> None:  # noqa: N802 - BullMQ's API name
        self.progress_updates.append(progress)


class Answer(BaseModel):
    pageCount: int  # noqa: N815 - contract field name


def a_job() -> FakeJob:
    return FakeJob(an_envelope(an_inspect_payload(b"%PDF").model_dump(mode="json")))


def a_processor(run_use_case: Any) -> QueueJobProcessor:
    return QueueJobProcessor(QueueBinding("parse.inspect", ParseInspectPayload, run_use_case))


async def test_successful_job_returns_json_and_reports_progress() -> None:
    observed_contexts = []

    def run_use_case(payload: ParseInspectPayload, progress: ProgressReporter) -> Answer:
        observed_contexts.append(current_job_context())
        progress.report_progress(1, 2)
        return Answer(pageCount=payload.limits.maxPages)

    job = a_job()

    result = await a_processor(run_use_case).process(job, "token")

    assert result == {"pageCount": 200}
    assert job.progress_updates == [{"pagesDone": 1, "pagesTotal": 2}]
    assert observed_contexts[0] is not None
    assert observed_contexts[0].document_id == "0f8fad5b-d9cb-469f-a165-70867728950e"


async def test_permanent_failure_becomes_unrecoverable_with_code() -> None:
    def run_use_case(payload: object, progress: object) -> Answer:
        raise PermanentJobError(FailureCode.TOO_MANY_PAGES, "the document has 3 pages; the limit is 2")

    with pytest.raises(UnrecoverableError, match=r"^too_many_pages: the document has 3 pages"):
        await a_processor(run_use_case).process(a_job(), "token")


async def test_invalid_envelope_is_unrecoverable() -> None:
    with pytest.raises(UnrecoverableError, match=r"^unsupported_schema_version: "):
        await a_processor(None).process(FakeJob(an_envelope({}, schema_version=2)), "token")


async def test_retryable_failure_is_raised_as_is() -> None:
    def run_use_case(payload: object, progress: object) -> Answer:
        raise RetryableJobError(FailureCode.GATEWAY_UNAVAILABLE, "down")

    with pytest.raises(RetryableJobError, match=r"^gateway_unavailable: down$"):
        await a_processor(run_use_case).process(a_job(), "token")


async def test_unexpected_error_is_an_internal_error() -> None:
    def run_use_case(payload: object, progress: object) -> Answer:
        raise ZeroDivisionError("boom")

    with pytest.raises(RuntimeError, match=r"^internal_error: ZeroDivisionError: boom$"):
        await a_processor(run_use_case).process(a_job(), "token")


async def test_progress_failures_never_fail_the_job() -> None:
    class BrokenJob(FakeJob):
        async def updateProgress(self, progress: dict[str, int]) -> None:  # noqa: N802
            raise ConnectionError("redis gone")

    reporter = JobProgressReporter(BrokenJob({}), asyncio.get_running_loop())

    await asyncio.to_thread(reporter.report_progress, 1, 1)
