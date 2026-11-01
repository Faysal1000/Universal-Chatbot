import json
import logging

from app.observability.job_context import JobContext, current_job_context, job_context
from app.observability.logging_config import JobContextFilter, JsonLogFormatter


def a_record(message: str = "hello") -> logging.LogRecord:
    return logging.LogRecord("app.test", logging.INFO, __file__, 1, message, None, None)


def test_json_logs_carry_job_context() -> None:
    record = a_record()
    with job_context(
        JobContext(queue="parse.pages", job_id="j1", attempt=2, request_id="r1", document_id="d1")
    ):
        JobContextFilter().filter(record)

    line = json.loads(JsonLogFormatter().format(record))

    assert (line["message"], line["queue"], line["job_id"], line["request_id"], line["document_id"]) == (
        "hello",
        "parse.pages",
        "j1",
        "r1",
        "d1",
    )


def test_context_is_cleared_after_the_job() -> None:
    with job_context(JobContext(queue="q", job_id="j", attempt=1)):
        pass

    assert current_job_context() is None
