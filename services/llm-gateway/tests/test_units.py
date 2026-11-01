"""Unit tests for configuration, security, routing, cost/throughput math, and error mapping."""

import asyncio
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.core.errors import (
    UpstreamConfigurationError,
    UpstreamRateLimitedError,
    UpstreamRejectedRequestError,
    UpstreamServerError,
    classify_upstream_status,
)
from app.inference.asgi_responses import CancelOnDisconnectResponse
from app.metrics.cost import compute_output_tokens_per_second, estimate_cost_usd
from app.protocols.types import TokenUsage
from app.routing.task_routes import RouteStep, RoutingSnapshot, TaskRoute, normalise_task_name
from app.security.admin_passwords import (
    hash_admin_password,
    is_valid_password_hash_format,
    verify_admin_password,
)
from app.security.admin_sessions import AdminSessionSigner
from app.security.caller_api_keys import extract_caller_api_key, is_valid_caller_api_key
from app.security.login_throttle import LoginAttemptLimiter
from app.security.secret_cipher import SecretCipher
from tests.conftest import TEST_ENCRYPTION_KEY, build_test_settings
from tests.test_protocols import make_target

# ----- Configuration -----


@pytest.mark.parametrize(
    ("field_name", "bad_value"),
    [
        ("api_key", "too-short"),
        ("admin_session_secret", "x" * 10),
        ("encryption_key", "not-a-fernet-key"),
        ("database_url", "postgresql://user:pass@host/db"),
    ],
)
def test_settings_reject_weak_or_malformed_secrets(field_name: str, bad_value: str) -> None:
    with pytest.raises(ValidationError):
        build_test_settings(**{field_name: bad_value})


def test_settings_accept_valid_values() -> None:
    settings = build_test_settings()
    assert settings.max_attempts_per_model == 3
    assert settings.port == 4000


# ----- Security -----


def test_secret_cipher_round_trip_and_wrong_key() -> None:
    cipher = SecretCipher(TEST_ENCRYPTION_KEY)
    ciphertext = cipher.encrypt_text("sk-live-123")
    assert b"sk-live-123" not in ciphertext
    assert cipher.decrypt_text(ciphertext) == "sk-live-123"
    assert cipher.decrypt_headers(cipher.encrypt_headers({"X-A": "1"})) == {"X-A": "1"}
    other_cipher = SecretCipher("ZmFrZWZha2VmYWtlZmFrZWZha2VmYWtlZmFrZWZha2U=")
    with pytest.raises(ValueError, match="cannot be decrypted"):
        other_cipher.decrypt_text(ciphertext)


def test_admin_password_hash_verification() -> None:
    password_hash = hash_admin_password("s3cret-password")
    assert "$" not in password_hash
    assert is_valid_password_hash_format(password_hash)
    assert verify_admin_password("s3cret-password", password_hash)
    assert not verify_admin_password("wrong", password_hash)
    assert not verify_admin_password("s3cret-password", "garbage")


def test_admin_session_tokens_expire_and_resist_tampering() -> None:
    signer = AdminSessionSigner("signing-secret-" * 4, session_ttl_seconds=600)
    token = signer.issue("admin", now_unix_seconds=1000)
    session = signer.verify(token, now_unix_seconds=1500)
    assert session is not None
    assert session.username == "admin"
    assert signer.verify(token, now_unix_seconds=1601) is None
    payload, signature = token.split(".")
    assert signer.verify(f"{payload}x.{signature}", now_unix_seconds=1500) is None
    assert AdminSessionSigner("another-secret-" * 4, 600).verify(token, now_unix_seconds=1500) is None
    assert signer.verify(None) is None


def test_caller_api_key_extraction_and_comparison() -> None:
    assert extract_caller_api_key("Bearer abc", None) == "abc"
    assert extract_caller_api_key("bearer  abc ", None) == "abc"
    assert extract_caller_api_key(None, "xyz") == "xyz"
    assert extract_caller_api_key("Basic abc", None) is None
    assert is_valid_caller_api_key("abc", "abc")
    assert not is_valid_caller_api_key(None, "abc")
    assert not is_valid_caller_api_key("abd", "abc")


def test_login_attempt_limiter_window() -> None:
    limiter = LoginAttemptLimiter(max_failures_per_minute=2)
    limiter.record_failure("ip", now_monotonic=0)
    limiter.record_failure("ip", now_monotonic=1)
    assert limiter.is_blocked("ip", now_monotonic=2)
    assert not limiter.is_blocked("ip", now_monotonic=62)
    assert not limiter.is_blocked("other", now_monotonic=2)


# ----- Routing -----


def build_snapshot(
    default_model_pk: int | None, disabled_model_pks: frozenset[int] = frozenset()
) -> RoutingSnapshot:
    targets = {
        model_pk: make_target("openai_chat_completions", model_pk=model_pk, model_id=f"model-{model_pk}")
        for model_pk in (1, 2, 3)
        if model_pk not in disabled_model_pks
    }
    return RoutingSnapshot(
        usable_targets_by_model_pk=targets,
        routes_by_task_name={
            "answer_generation": TaskRoute(
                "answer_generation", True, steps=(RouteStep(1, 1), RouteStep(2, 2))
            ),
            "query": TaskRoute("query", True, steps=(RouteStep(1, 2),), append_default_model=True),
            "paused": TaskRoute("paused", False, steps=(RouteStep(1, 1),), append_default_model=True),
        },
        policies_by_task_name={},
        default_model_pk=default_model_pk,
    )


def resolved(snapshot: RoutingSnapshot, task_name: str) -> list[tuple[int, bool]]:
    return [(candidate.target.model_pk, candidate.is_fallback) for candidate in snapshot.resolve(task_name)]


def test_route_with_explicit_fallback() -> None:
    assert resolved(build_snapshot(default_model_pk=3), "answer_generation") == [(1, False), (2, True)]


def test_route_without_fallback_uses_default_model() -> None:
    assert resolved(build_snapshot(default_model_pk=3), "query") == [(2, False), (3, True)]


def test_route_whose_primary_is_the_default_is_not_duplicated() -> None:
    assert resolved(build_snapshot(default_model_pk=2), "query") == [(2, False)]


def test_unknown_and_disabled_tasks_use_default_model() -> None:
    snapshot = build_snapshot(default_model_pk=3)
    assert resolved(snapshot, "brand-new-task") == [(3, False)]
    assert resolved(snapshot, "paused") == [(3, False)]


def test_disabled_primary_is_skipped() -> None:
    assert resolved(
        build_snapshot(default_model_pk=3, disabled_model_pks=frozenset({1})), "answer_generation"
    ) == [(2, True)]


def test_nothing_usable_resolves_to_empty_list() -> None:
    assert resolved(build_snapshot(default_model_pk=None), "unknown") == []


def test_task_name_normalisation() -> None:
    assert normalise_task_name(None) == "default"
    assert normalise_task_name("  ") == "default"
    assert normalise_task_name(" Answer ") == "answer"


# ----- Cost and throughput -----


def test_cost_uses_cached_price_for_cached_tokens() -> None:
    target = make_target(
        "openai_chat_completions",
        input_price_usd_per_million_tokens=Decimal("2"),
        cached_input_price_usd_per_million_tokens=Decimal("0.5"),
        output_price_usd_per_million_tokens=Decimal("8"),
    )
    cost = estimate_cost_usd(
        target, TokenUsage(input_tokens=1_000_000, cached_input_tokens=400_000, output_tokens=100_000)
    )
    assert cost == Decimal("2.20000000")  # 0.6M*2 + 0.4M*0.5 + 0.1M*8


def test_cost_is_unknown_without_prices_or_usage() -> None:
    priced_target = make_target("openai_chat_completions", input_price_usd_per_million_tokens=Decimal(1))
    assert estimate_cost_usd(make_target("openai_chat_completions"), TokenUsage(input_tokens=10)) is None
    assert estimate_cost_usd(priced_target, TokenUsage()) is None


def test_output_tokens_per_second_excludes_time_to_first_token() -> None:
    assert compute_output_tokens_per_second(100, total_duration_ms=3000, time_to_first_token_ms=1000) == 50.0
    assert compute_output_tokens_per_second(None, 1000, None) is None
    assert compute_output_tokens_per_second(10, 500, 500) is None


# ----- Error classification -----


@pytest.mark.parametrize(
    ("status_code", "expected_error_type", "retryable", "allows_fallback"),
    [
        (429, UpstreamRateLimitedError, True, True),
        (500, UpstreamServerError, True, True),
        (529, UpstreamServerError, True, True),
        (401, UpstreamConfigurationError, False, True),
        (404, UpstreamConfigurationError, False, True),
        (400, UpstreamRejectedRequestError, False, False),
        (422, UpstreamRejectedRequestError, False, False),
    ],
)
def test_upstream_status_classification(
    status_code: int, expected_error_type: type, retryable: bool, allows_fallback: bool
) -> None:
    upstream_error = classify_upstream_status(status_code, "message", None)
    assert type(upstream_error) is expected_error_type
    assert upstream_error.is_retryable is retryable
    assert upstream_error.allows_fallback is allows_fallback
    if isinstance(upstream_error, UpstreamRejectedRequestError):
        assert int(upstream_error.http_status) == status_code


# ----- Disconnect handling -----


async def test_cancel_on_disconnect_response_cancels_producer() -> None:
    producer_was_cancelled = asyncio.Event()

    async def never_ending_producer(_send: object) -> None:
        try:
            await asyncio.sleep(60)
        except asyncio.CancelledError:
            producer_was_cancelled.set()
            raise

    async def receive_disconnect() -> dict[str, str]:
        await asyncio.sleep(0.01)
        return {"type": "http.disconnect"}

    async def ignore_send(_message: object) -> None:
        return None

    response = CancelOnDisconnectResponse(never_ending_producer)
    await asyncio.wait_for(response({"type": "http"}, receive_disconnect, ignore_send), timeout=2)
    assert producer_was_cancelled.is_set()
