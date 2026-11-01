"""Process-wide logging setup with request-ID correlation and optional JSON output."""

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime

from app.core.config import LogFormat, LogLevel

# Populated by RequestContextMiddleware; read by every log record emitted during a request.
current_request_id: ContextVar[str | None] = ContextVar("current_request_id", default=None)

_STANDARD_LOG_RECORD_ATTRIBUTES = frozenset(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__.keys()
) | {"message", "asctime", "request_id"}


class RequestIdFilter(logging.Filter):
    """Attach the active request ID (or ``"-"``) to every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        """Annotate the record in place; never suppresses records."""
        record.request_id = current_request_id.get() or "-"
        return True


class JsonLogFormatter(logging.Formatter):
    """Render log records as single-line JSON objects for log aggregation pipelines."""

    def format(self, record: logging.LogRecord) -> str:
        """Serialise the record, including ``extra=`` fields and exception tracebacks."""
        log_payload: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        for attribute_name, attribute_value in record.__dict__.items():
            if attribute_name not in _STANDARD_LOG_RECORD_ATTRIBUTES:
                log_payload[attribute_name] = attribute_value
        if record.exc_info:
            log_payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_payload, default=str)


def configure_logging(log_level: LogLevel, log_format: LogFormat, enable_access_log: bool = False) -> None:
    """Install a single stdout handler on the root logger and align Uvicorn's loggers.

    Access logs (one line per HTTP request, including health probes) are only emitted
    when ``enable_access_log`` is set; gateway request outcomes are logged and recorded
    in metrics anyway.
    """
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.addFilter(RequestIdFilter())
    if log_format == "json":
        stream_handler.setFormatter(JsonLogFormatter())
    else:
        stream_handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s [request_id=%(request_id)s] %(message)s")
        )

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.addHandler(stream_handler)
    root_logger.setLevel(log_level)

    # Third-party HTTP clients log every request (every upstream LLM call).
    for noisy_logger_name in ("httpx", "httpcore", "asyncpg"):
        logging.getLogger(noisy_logger_name).setLevel(max(logging.WARNING, root_logger.level))

    # Route Uvicorn through the root handler so every line shares one format.
    for uvicorn_logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(uvicorn_logger_name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True
    logging.getLogger("uvicorn.access").disabled = not enable_access_log
