"""Process-wide logging: one stdout handler, JSON or text, with job correlation."""

import json
import logging
import sys
from datetime import UTC, datetime

from app.config import LogFormat, LogLevel
from app.observability.job_context import current_job_context

NOISY_LOGGER_NAMES = (
    "httpx",
    "httpcore",
    "botocore",
    "boto3",
    "urllib3",
    "s3transfer",
    "pdfminer",
    "aiohttp.access",
)
_STANDARD_LOG_RECORD_ATTRIBUTES = frozenset(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__.keys()
) | {
    "message",
    "asctime",
}


class JobContextFilter(logging.Filter):
    """Annotate every record with the active job identifiers (never suppresses)."""

    def filter(self, record: logging.LogRecord) -> bool:
        context = current_job_context()
        record.queue = context.queue if context else "-"
        record.job_id = context.job_id if context else "-"
        record.request_id = (context.request_id if context else None) or "-"
        record.document_id = (context.document_id if context else None) or "-"
        return True


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_payload: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for attribute_name, attribute_value in record.__dict__.items():
            if attribute_name not in _STANDARD_LOG_RECORD_ATTRIBUTES:
                log_payload[attribute_name] = attribute_value
        if record.exc_info:
            log_payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_payload, default=str, ensure_ascii=False)


def configure_logging(log_level: LogLevel, log_format: LogFormat) -> None:
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.addFilter(JobContextFilter())
    if log_format == "json":
        stream_handler.setFormatter(JsonLogFormatter())
    else:
        stream_handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s [%(queue)s job=%(job_id)s] %(message)s")
        )
    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(stream_handler)
    root_logger.setLevel(log_level)
    for noisy_logger_name in NOISY_LOGGER_NAMES:
        logging.getLogger(noisy_logger_name).setLevel(max(logging.WARNING, root_logger.level))
