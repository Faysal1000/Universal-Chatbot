import logging
from typing import Any

import httpx
import pytest

from app.adapters.s3_object_storage import S3ObjectStorage, create_s3_client
from app.adapters.tesseract_ocr import TesseractOcrEngine
from app.config import Settings
from app.entrypoints import worker_main
from app.observability.logging_config import JsonLogFormatter, configure_logging

REQUIRED: dict[str, Any] = {
    "redis_url": "redis://document_parser:secret@localhost:6379/0",
    "s3_bucket": "rag",
    "s3_access_key_id": "document-parser",
    "s3_secret_access_key": "secret",
    "llm_gateway_url": "http://llm-gateway:4000",
    "llm_gateway_api_key": "gateway-key",
}


def a_settings(**overrides: Any) -> Settings:
    return Settings(_env_file=None, **(REQUIRED | overrides))


def test_both_queues_are_bound_to_their_use_cases() -> None:
    settings = a_settings()
    storage = S3ObjectStorage(create_s3_client(None, "us-east-1", "key", "secret", True, 5))

    bindings = worker_main.build_queue_bindings(
        settings, storage, TesseractOcrEngine("eng+ben"), httpx.Client()
    )

    assert [binding.queue_name for binding in bindings] == ["parse.inspect", "parse.pages"]


def test_worker_settings_use_per_queue_concurrency_and_the_rag_prefix() -> None:
    settings = a_settings(parse_inspect_concurrency=3, lock_duration_seconds=120)

    inspect_settings = worker_main.worker_settings(settings, "parse.inspect")
    pages_settings = worker_main.worker_settings(settings, "parse.pages")

    assert (inspect_settings.concurrency, pages_settings.concurrency) == (3, 1)
    assert inspect_settings.queue_prefix == "rag"
    assert inspect_settings.lock_duration_milliseconds == 120_000
    assert inspect_settings.stalled_interval_milliseconds == 30_000


def test_invalid_configuration_exits_without_echoing_secrets(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.chdir("/")
    monkeypatch.setenv("DOCUMENT_PARSER_REDIS_URL", "redis://user:very-secret@redis:6379")

    with pytest.raises(SystemExit) as raised:
        worker_main.main()

    assert raised.value.code == worker_main.INVALID_CONFIGURATION_EXIT_CODE
    assert "very-secret" not in capsys.readouterr().err


def test_json_logging_is_installed_on_the_root_logger() -> None:
    root_logger = logging.getLogger()
    previous_handlers = root_logger.handlers[:]
    try:
        configure_logging("INFO", "json")

        assert isinstance(root_logger.handlers[0].formatter, JsonLogFormatter)
        assert logging.getLogger("botocore").level == logging.WARNING
    finally:
        root_logger.handlers[:] = previous_handlers
