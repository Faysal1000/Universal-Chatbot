from typing import Any

import pytest
from pydantic import ValidationError

from app.config import Settings

REQUIRED: dict[str, Any] = {
    "redis_url": "redis://document_parser:secret-password@redis:6379/0",
    "s3_bucket": "rag",
    "s3_access_key_id": "document-parser",
    "s3_secret_access_key": "s3-secret-value",
    "llm_gateway_url": "http://llm-gateway:4000",
    "llm_gateway_api_key": "gateway-secret-value",
}


def build_settings(**overrides: object) -> Settings:
    return Settings(_env_file=None, **(REQUIRED | overrides))


def test_defaults_match_the_platform() -> None:
    settings = build_settings()

    assert settings.queue_prefix == "rag"
    assert (settings.parse_inspect_concurrency, settings.parse_pages_concurrency) == (2, 1)
    assert settings.port == 8090
    assert settings.lock_duration_milliseconds == 600_000
    assert settings.tesseract_languages == "eng+ben"


def test_variables_are_read_with_the_service_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    for name, value in REQUIRED.items():
        monkeypatch.setenv(f"DOCUMENT_PARSER_{name.upper()}", value)
    monkeypatch.setenv("DOCUMENT_PARSER_PORT", "9123")
    monkeypatch.setenv("PORT", "1")

    assert Settings(_env_file=None).port == 9123


def test_secrets_never_appear_in_repr() -> None:
    rendered = repr(build_settings()) + str(build_settings().model_dump())

    for secret in ("secret-password", "s3-secret-value", "gateway-secret-value"):
        assert secret not in rendered


def test_missing_required_settings_fail_fast() -> None:
    with pytest.raises(ValidationError, match="llm_gateway_api_key"):
        Settings(
            _env_file=None, **{key: value for key, value in REQUIRED.items() if key != "llm_gateway_api_key"}
        )


@pytest.mark.parametrize(
    "override",
    [
        {"llm_gateway_api_key": "  "},
        {"llm_gateway_url": "not a url"},
        {"tesseract_languages": "eng ben"},
        {"port": 0},
    ],
)
def test_invalid_values_are_rejected(override: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        build_settings(**override)


def test_blank_optional_values_mean_unset() -> None:
    settings = build_settings(s3_endpoint=" ")

    assert settings.s3_endpoint is None
