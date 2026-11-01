import pytest
from pydantic import ValidationError

from app.config import Settings

VALID_KEY = "x" * 40


def build_settings(**overrides: object) -> Settings:
    return Settings(_env_file=None, **{"api_key": VALID_KEY, **overrides})  # type: ignore[arg-type]


def test_environment_variables_are_namespaced(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMBEDDING_SERVER_PORT", "9123")
    monkeypatch.setenv("PORT", "1")  # A generic variable from another service must be ignored.
    assert Settings(_env_file=None).port == 9123  # type: ignore[call-arg]


def test_short_api_key_is_rejected() -> None:
    with pytest.raises(ValidationError, match="EMBEDDING_SERVER_API_KEY"):
        build_settings(api_key="short")


def test_image_limit_must_be_below_body_limit() -> None:
    with pytest.raises(ValidationError):
        build_settings(max_image_bytes=2048, max_request_body_bytes=2048)


def test_batch_items_cannot_exceed_pending_capacity() -> None:
    with pytest.raises(ValidationError):
        build_settings(max_batch_items=64, max_pending_items=32)


def test_blank_optional_secrets_are_treated_as_unset() -> None:
    assert build_settings(huggingface_token="", model_revision="  ").huggingface_token is None
