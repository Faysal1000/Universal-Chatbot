"""End-to-end API tests: admin configuration, inference through every protocol, metrics.

Requires ``LLM_GATEWAY_TEST_DATABASE_URL`` (see conftest); upstream providers are the
in-process fake from ``tests.fake_provider``.
"""

import json
import statistics
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import (
    DASHBOARD_HEADERS,
    TEST_ADMIN_PASSWORD,
    create_provider_with_models,
    inference_headers,
    wait_for,
)
from tests.fake_provider import received_requests

PROTOCOLS = ["openai_chat_completions", "openai_responses", "anthropic_messages"]
PRICES = {
    "input_price_usd_per_million_tokens": 1.0,
    "cached_input_price_usd_per_million_tokens": 0.5,
    "output_price_usd_per_million_tokens": 4.0,
}


def chat(client: TestClient, task_name: str | None, **extra: Any) -> Any:
    request_body: dict[str, Any] = {"messages": [{"role": "user", "content": "hi"}], **extra}
    if task_name is not None:
        request_body["model"] = task_name
    return client.post("/v1/chat/completions", headers=inference_headers(), json=request_body)


def stream_chat(client: TestClient, task_name: str, include_usage: bool = True) -> tuple[Any, list[Any]]:
    request_body = {
        "model": task_name,
        "stream": True,
        "stream_options": {"include_usage": include_usage},
        "messages": [{"role": "user", "content": "hi"}],
    }
    with client.stream(
        "POST", "/v1/chat/completions", headers=inference_headers(), json=request_body
    ) as response:
        data_lines = [
            line.removeprefix("data: ") for line in response.iter_lines() if line.startswith("data: ")
        ]
    return response, [line if line == "[DONE]" else json.loads(line) for line in data_lines]


def recent_requests(admin_client: TestClient, minimum_rows: int, **filters: Any) -> list[dict[str, Any]]:
    def load() -> list[dict[str, Any]] | None:
        rows: list[dict[str, Any]] = admin_client.get("/admin/api/analytics/requests", params=filters).json()
        return rows if len(rows) >= minimum_rows else None

    return wait_for(load) or []


def set_default_model(admin_client: TestClient, model_pk: int) -> None:
    assert admin_client.put("/admin/api/settings", json={"default_model_pk": model_pk}).status_code == 200


def create_route(
    admin_client: TestClient, task_name: str, primary_model_pk: int, fallback_model_pk: int | None = None
) -> None:
    """A primary route with an optional fallback; without one the default model comes next."""
    model_pks = [primary_model_pk] if fallback_model_pk is None else [primary_model_pk, fallback_model_pk]
    route_response = admin_client.post(
        "/admin/api/routes",
        json={
            "task_name": task_name,
            "steps": [{"model_pk": model_pk, "max_attempts": None} for model_pk in model_pks],
            "append_default_model": fallback_model_pk is None,
        },
    )
    assert route_response.status_code == 201, route_response.text


# ----- Health and auth -----


def test_health_endpoints(gateway_client: TestClient) -> None:
    assert gateway_client.get("/health/live").json() == {"status": "alive"}
    assert gateway_client.get("/health/ready").json() == {"status": "ready"}


def test_inference_requires_api_key_in_openai_error_shape(gateway_client: TestClient) -> None:
    response = gateway_client.post(
        "/v1/chat/completions", json={"messages": [{"role": "user", "content": "x"}]}
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_api_key"
    assert response.headers["x-request-id"]


def test_x_api_key_header_is_accepted_and_request_id_is_propagated(admin_client: TestClient) -> None:
    model_pks = create_provider_with_models(admin_client, "chatty", "openai_chat_completions", ["fake-small"])
    set_default_model(admin_client, model_pks["fake-small"])
    response = admin_client.post(
        "/v1/chat/completions",
        headers={
            "X-API-Key": inference_headers()["Authorization"].removeprefix("Bearer "),
            "X-Request-ID": "trace-123",
        },
        json={"messages": [{"role": "user", "content": "x"}]},
    )
    assert response.status_code == 200
    assert response.headers["x-request-id"] == "trace-123"
    assert recent_requests(admin_client, 1)[0]["request_id"] == "trace-123"


def test_invalid_body_returns_openai_shaped_400(gateway_client: TestClient) -> None:
    response = gateway_client.post("/v1/chat/completions", headers=inference_headers(), json={"messages": []})
    assert response.status_code == 400
    assert response.json()["error"]["type"] == "invalid_request_error"


def test_no_configured_model_returns_503(gateway_client: TestClient) -> None:
    response = chat(gateway_client, "answer_generation")
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "no_model_configured"
    assert "PUT /admin/api/settings" in response.json()["error"]["message"]


def test_admin_login_logout_and_guards(gateway_client: TestClient) -> None:
    assert gateway_client.get("/admin/api/providers").status_code == 401
    no_csrf = gateway_client.post(
        "/admin/api/session", json={"username": "admin", "password": TEST_ADMIN_PASSWORD}
    )
    assert no_csrf.status_code == 403
    wrong_password = gateway_client.post(
        "/admin/api/session", headers=DASHBOARD_HEADERS, json={"username": "admin", "password": "nope"}
    )
    assert wrong_password.status_code == 401
    login = gateway_client.post(
        "/admin/api/session",
        headers=DASHBOARD_HEADERS,
        json={"username": "admin", "password": TEST_ADMIN_PASSWORD},
    )
    assert login.status_code == 200
    set_cookie_header = login.headers["set-cookie"].lower()
    assert "httponly" in set_cookie_header
    assert "samesite=strict" in set_cookie_header
    assert gateway_client.get("/admin/api/session").json()["username"] == "admin"
    assert gateway_client.delete("/admin/api/session", headers=DASHBOARD_HEADERS).status_code == 204
    assert gateway_client.get("/admin/api/providers").status_code == 401


def test_login_is_rate_limited(gateway_client: TestClient) -> None:
    for _ in range(5):
        gateway_client.post(
            "/admin/api/session", headers=DASHBOARD_HEADERS, json={"username": "a", "password": "b"}
        )
    response = gateway_client.post(
        "/admin/api/session",
        headers=DASHBOARD_HEADERS,
        json={"username": "admin", "password": TEST_ADMIN_PASSWORD},
    )
    assert response.status_code == 429


# ----- Provider administration -----


def test_provider_secrets_are_write_only_and_encrypted(
    admin_client: TestClient, test_database_url: str
) -> None:
    created = admin_client.post(
        "/admin/api/providers",
        json={
            "provider_id": "acme-gateway",
            "display_name": "Acme",
            "base_url": "https://gateway.example/v1/",
            "api_protocol": "openai_chat_completions",
            "api_key": "sk-very-secret",
            "extra_headers": [{"name": "X-Tenant", "value": "tenant-secret"}],
        },
    )
    assert created.status_code == 201
    provider = created.json()
    assert provider["base_url"] == "https://gateway.example/v1"
    assert provider["has_api_key"] is True
    assert provider["extra_header_names"] == ["X-Tenant"]
    assert "sk-very-secret" not in created.text
    assert "tenant-secret" not in created.text

    # value: null keeps the stored header value; clear_api_key removes the key.
    updated = admin_client.patch(
        "/admin/api/providers/acme-gateway",
        json={
            "clear_api_key": True,
            "extra_headers": [{"name": "X-Tenant", "value": None}, {"name": "X-B", "value": "2"}],
        },
    )
    assert updated.json()["has_api_key"] is False
    assert updated.json()["extra_header_names"] == ["X-B", "X-Tenant"]


@pytest.mark.parametrize(
    ("payload_changes", "expected_status"),
    [
        ({"provider_id": "Bad_ID"}, 422),
        ({"provider_id": "1abc"}, 422),
        ({"base_url": "ftp://x"}, 422),
        ({"api_protocol": "gemini"}, 422),
        ({"extra_headers": [{"name": "Content-Type", "value": "x"}]}, 422),
        ({"unknown_field": True}, 422),
    ],
)
def test_provider_validation(
    admin_client: TestClient, payload_changes: dict[str, Any], expected_status: int
) -> None:
    payload = {
        "provider_id": "valid",
        "display_name": "Valid",
        "base_url": "https://api.example.com/v1",
        "api_protocol": "openai_chat_completions",
        **payload_changes,
    }
    assert admin_client.post("/admin/api/providers", json=payload).status_code == expected_status


def test_duplicate_provider_and_model_conflict(admin_client: TestClient) -> None:
    create_provider_with_models(admin_client, "dupe", "openai_chat_completions", ["fake-small"])
    duplicate_provider = admin_client.post(
        "/admin/api/providers",
        json={
            "provider_id": "dupe",
            "display_name": "x",
            "base_url": "https://a.b/v1",
            "api_protocol": "openai_responses",
        },
    )
    assert duplicate_provider.status_code == 409
    assert (
        admin_client.post("/admin/api/providers/dupe/models", json={"model_id": "fake-small"}).status_code
        == 409
    )


def test_discover_and_test_model(admin_client: TestClient) -> None:
    model_pks = create_provider_with_models(admin_client, "claude", "anthropic_messages", ["fake-small"])
    discovered = admin_client.post("/admin/api/providers/claude/discover-models").json()
    assert {(entry["model_id"], entry["already_added"]) for entry in discovered} == {
        ("fake-large", False),
        ("fake-small", True),
    }
    test_result = admin_client.post(f"/admin/api/models/{model_pks['fake-small']}/test").json()
    assert test_result["success"] is True
    assert test_result["response_preview"] == "Hello from anthropic fake-small"
    anthropic_request = received_requests[-1]
    assert anthropic_request["headers"]["x-api-key"] == "sk-claude-secret"


def test_failing_model_test_reports_error(admin_client: TestClient) -> None:
    model_pks = create_provider_with_models(admin_client, "broken", "openai_chat_completions", ["fail-401"])
    test_result = admin_client.post(f"/admin/api/models/{model_pks['fail-401']}/test").json()
    assert test_result["success"] is False
    assert test_result["http_status"] == 401


def test_models_in_use_cannot_be_deleted(admin_client: TestClient) -> None:
    model_pks = create_provider_with_models(
        admin_client, "used", "openai_chat_completions", ["fake-small", "spare"]
    )
    create_route(admin_client, "answer_generation", model_pks["fake-small"])
    blocked = admin_client.delete(f"/admin/api/models/{model_pks['fake-small']}")
    assert blocked.status_code == 409
    assert "answer_generation" in blocked.json()["detail"]
    assert admin_client.delete("/admin/api/providers/used").status_code == 409
    assert admin_client.delete(f"/admin/api/models/{model_pks['spare']}").status_code == 204
    assert admin_client.delete("/admin/api/routes/answer_generation").status_code == 204
    assert admin_client.delete("/admin/api/providers/used").status_code == 204


def test_route_validation(admin_client: TestClient) -> None:
    assert (
        admin_client.post(
            "/admin/api/routes", json={"task_name": "x", "steps": [{"model_pk": 999999}]}
        ).status_code
        == 422
    )
    assert (
        admin_client.post(
            "/admin/api/routes", json={"task_name": "Bad Name", "steps": [{"model_pk": 1}]}
        ).status_code
        == 422
    )


# ----- Inference -----


@pytest.mark.parametrize("api_protocol", PROTOCOLS)
def test_non_streaming_completion_through_each_protocol(admin_client: TestClient, api_protocol: str) -> None:
    model_pks = create_provider_with_models(admin_client, "upstream", api_protocol, ["fake-small"], **PRICES)
    create_route(admin_client, "answer_generation", model_pks["fake-small"])
    response = chat(admin_client, "answer_generation", max_tokens=50)
    assert response.status_code == 200, response.text
    completion = response.json()
    assert completion["object"] == "chat.completion"
    assert completion["choices"][0]["message"]["content"].startswith("Hello from")
    assert completion["usage"]["prompt_tokens"] == 12
    assert response.headers["x-llm-gateway-provider"] == "upstream"
    assert response.headers["x-llm-gateway-model"] == "fake-small"
    assert received_requests[-1]["body"]["model"] == "fake-small"

    metric_row = recent_requests(admin_client, 1)[0]
    assert metric_row["task_name"] == "answer_generation"
    assert metric_row["upstream_protocol"] == api_protocol
    assert (metric_row["input_tokens"], metric_row["cached_input_tokens"], metric_row["output_tokens"]) == (
        12,
        4,
        4,
    )
    # (12 - 4) * 1.0 + 4 * 0.5 + 4 * 4.0 = 26 per million tokens
    assert metric_row["cost_usd"] == pytest.approx(0.000026)


@pytest.mark.parametrize("api_protocol", PROTOCOLS)
def test_streaming_completion_through_each_protocol(admin_client: TestClient, api_protocol: str) -> None:
    model_pks = create_provider_with_models(admin_client, "upstream", api_protocol, ["fake-small"])
    create_route(admin_client, "answer_generation", model_pks["fake-small"])
    response, events = stream_chat(admin_client, "answer_generation")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert events[-1] == "[DONE]"
    chunks = events[:-1]
    streamed_text = "".join(
        chunk["choices"][0]["delta"].get("content") or "" for chunk in chunks if chunk.get("choices")
    )
    assert streamed_text.startswith("Hello from")
    assert any(chunk.get("choices") and chunk["choices"][0]["finish_reason"] == "stop" for chunk in chunks)
    assert chunks[-1]["usage"]["completion_tokens"] == 4

    metric_row = recent_requests(admin_client, 1)[0]
    assert metric_row["is_stream"] is True
    assert metric_row["time_to_first_token_ms"] is not None
    assert metric_row["time_to_first_token_ms"] <= metric_row["total_duration_ms"]
    assert metric_row["output_tokens"] == 4


def test_stream_without_include_usage_omits_usage_chunk(admin_client: TestClient) -> None:
    model_pks = create_provider_with_models(
        admin_client, "upstream", "openai_chat_completions", ["fake-small"]
    )
    create_route(admin_client, "answer_generation", model_pks["fake-small"])
    _, events = stream_chat(admin_client, "answer_generation", include_usage=False)
    assert not any(isinstance(event, dict) and "usage" in event for event in events)
    # The gateway still asked the provider for usage, so metrics have tokens.
    assert received_requests[-1]["body"]["stream_options"] == {"include_usage": True}
    assert recent_requests(admin_client, 1)[0]["output_tokens"] == 4


def test_tool_calls_round_trip_through_anthropic(admin_client: TestClient) -> None:
    model_pks = create_provider_with_models(admin_client, "claude", "anthropic_messages", ["tool-caller"])
    create_route(admin_client, "query_rewrite", model_pks["tool-caller"])
    response = chat(
        admin_client,
        "query_rewrite",
        tools=[{"type": "function", "function": {"name": "get_weather", "parameters": {"type": "object"}}}],
    )
    tool_call = response.json()["choices"][0]["message"]["tool_calls"][0]
    assert tool_call["function"] == {"name": "get_weather", "arguments": '{"city": "Paris"}'}
    assert response.json()["choices"][0]["finish_reason"] == "tool_calls"
    assert received_requests[-1]["body"]["tools"][0]["input_schema"] == {"type": "object"}


def test_retry_then_success_on_same_model(admin_client: TestClient) -> None:
    model_pks = create_provider_with_models(admin_client, "upstream", "openai_chat_completions", ["flaky-2"])
    create_route(admin_client, "answer_generation", model_pks["flaky-2"])
    response = chat(admin_client, "answer_generation")
    assert response.status_code == 200
    assert response.headers["x-llm-gateway-attempts"] == "3"
    assert recent_requests(admin_client, 1)[0]["attempt_count"] == 3


def test_fallback_to_route_fallback_then_records_both_chains(admin_client: TestClient) -> None:
    broken = create_provider_with_models(admin_client, "broken", "anthropic_messages", ["fail-500"])
    healthy = create_provider_with_models(admin_client, "healthy", "openai_responses", ["fake-small"])
    create_route(admin_client, "answer_generation", broken["fail-500"], healthy["fake-small"])
    response = chat(admin_client, "answer_generation")
    assert response.status_code == 200
    assert response.headers["x-llm-gateway-fallback"] == "true"
    assert response.headers["x-llm-gateway-provider"] == "healthy"
    rows = recent_requests(admin_client, 2)
    rows_by_model = {row["model_id"]: row for row in rows}
    assert rows_by_model["fail-500"]["error_class"] == "upstream_server_error"
    assert rows_by_model["fail-500"]["attempt_count"] == 3
    assert rows_by_model["fake-small"]["is_fallback"] is True
    assert rows[0]["request_id"] == rows[1]["request_id"]


def test_fallback_to_default_model_when_route_has_no_fallback(admin_client: TestClient) -> None:
    broken = create_provider_with_models(admin_client, "broken", "openai_chat_completions", ["fail-429"])
    default = create_provider_with_models(
        admin_client, "default-provider", "anthropic_messages", ["fake-small"]
    )
    set_default_model(admin_client, default["fake-small"])
    create_route(admin_client, "answer_generation", broken["fail-429"])
    response, events = stream_chat(admin_client, "answer_generation")
    assert response.headers["x-llm-gateway-provider"] == "default-provider"
    assert "".join(
        e["choices"][0]["delta"].get("content", "") for e in events[:-1] if e.get("choices")
    ).startswith("Hello from anthropic")


def test_everything_failing_returns_last_error(admin_client: TestClient) -> None:
    model_pks = create_provider_with_models(
        admin_client, "broken", "openai_chat_completions", ["fail-500", "fail-401"]
    )
    set_default_model(admin_client, model_pks["fail-401"])
    create_route(admin_client, "answer_generation", model_pks["fail-500"])
    response = chat(admin_client, "answer_generation")
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "upstream_configuration_error"
    rows = recent_requests(admin_client, 2)
    assert {row["attempt_count"] for row in rows} == {3, 1}, "401 is not retried, 500 is"


def test_rejected_request_does_not_fall_back(admin_client: TestClient) -> None:
    model_pks = create_provider_with_models(
        admin_client, "strict", "openai_chat_completions", ["fail-400", "fake-small"]
    )
    create_route(admin_client, "answer_generation", model_pks["fail-400"], model_pks["fake-small"])
    response = chat(admin_client, "answer_generation")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "upstream_rejected_request"
    assert len(recent_requests(admin_client, 1)) == 1


def test_unknown_and_missing_task_use_default_model(admin_client: TestClient) -> None:
    model_pks = create_provider_with_models(
        admin_client, "upstream", "openai_chat_completions", ["fake-small"]
    )
    set_default_model(admin_client, model_pks["fake-small"])
    assert chat(admin_client, "brand-new-task").status_code == 200
    assert chat(admin_client, None).status_code == 200
    assert {row["task_name"] for row in recent_requests(admin_client, 2)} == {"brand-new-task", "default"}


def test_disabled_provider_is_skipped(admin_client: TestClient) -> None:
    primary = create_provider_with_models(admin_client, "primary", "openai_chat_completions", ["fake-small"])
    default = create_provider_with_models(admin_client, "secondary", "openai_responses", ["fake-small"])
    set_default_model(admin_client, default["fake-small"])
    create_route(admin_client, "answer_generation", primary["fake-small"])
    admin_client.patch("/admin/api/providers/primary", json={"is_enabled": False})
    assert chat(admin_client, "answer_generation").headers["x-llm-gateway-provider"] == "secondary"


def test_mid_stream_error_is_reported_in_stream(admin_client: TestClient) -> None:
    model_pks = create_provider_with_models(
        admin_client, "upstream", "openai_chat_completions", ["stream-error", "fake-small"]
    )
    create_route(admin_client, "answer_generation", model_pks["stream-error"], model_pks["fake-small"])
    response, events = stream_chat(admin_client, "answer_generation")
    assert response.headers["x-llm-gateway-model"] == "stream-error", "no fallback once streaming started"
    assert any(isinstance(event, dict) and "error" in event for event in events)
    assert events[-1] == "[DONE]"


def test_v1_models_lists_task_names(admin_client: TestClient) -> None:
    model_pks = create_provider_with_models(
        admin_client, "upstream", "openai_chat_completions", ["fake-small"]
    )
    create_route(admin_client, "answer_generation", model_pks["fake-small"])
    model_ids = [
        entry["id"] for entry in admin_client.get("/v1/models", headers=inference_headers()).json()["data"]
    ]
    assert model_ids == ["answer_generation", "default"]


# ----- Analytics -----


def test_dashboard_percentiles_match_exact_computation(admin_client: TestClient) -> None:
    model_pks = create_provider_with_models(
        admin_client, "upstream", "openai_chat_completions", ["fake-small", "fail-500"]
    )
    create_route(admin_client, "answer_generation", model_pks["fake-small"])
    create_route(admin_client, "conversation_summary", model_pks["fail-500"])
    for _ in range(9):
        chat(admin_client, "answer_generation")
    chat(admin_client, "conversation_summary")
    rows = recent_requests(admin_client, 10)
    successful_durations = sorted(row["total_duration_ms"] for row in rows if row["error_class"] is None)

    overview = admin_client.get("/admin/api/analytics/overview", params={"group_by": "model"}).json()
    groups = {group["group_key"]: group for group in overview["groups"]}
    healthy_group = groups["upstream/fake-small"]
    assert healthy_group["request_count"] == 9
    assert healthy_group["error_rate"] == 0
    # percentile_cont uses linear interpolation, like statistics.quantiles(method="inclusive").
    expected_cut_points = statistics.quantiles(successful_durations, n=100, method="inclusive")
    assert healthy_group["latency_ms"]["p50"] == pytest.approx(
        statistics.median(successful_durations), abs=0.01
    )
    assert healthy_group["latency_ms"]["p90"] == pytest.approx(expected_cut_points[89], abs=0.01)
    assert healthy_group["latency_ms"]["p99"] == pytest.approx(expected_cut_points[98], abs=0.01)
    assert groups["upstream/fail-500"]["error_rate"] == 1.0
    assert overview["unique_request_count"] == 10
    assert overview["totals"]["output_tokens"] == 36

    series = admin_client.get("/admin/api/analytics/timeseries", params={"group_by": "task"}).json()
    assert sum(point["request_count"] for point in series["points"]) == 10
    assert series["bucket_seconds"] == 900  # 24h default range -> 15 min buckets

    top_errors = admin_client.get("/admin/api/analytics/errors").json()
    assert top_errors[0]["error_class"] == "upstream_server_error"
    assert (
        admin_client.get("/admin/api/analytics/requests", params={"errors_only": True}).json()[0]["model_id"]
        == "fail-500"
    )


def test_analytics_range_validation(admin_client: TestClient) -> None:
    now = datetime.now(UTC)
    inverted = admin_client.get(
        "/admin/api/analytics/overview",
        params={"start": now.isoformat(), "end": (now - timedelta(hours=1)).isoformat()},
    )
    assert inverted.status_code == 422
    too_long = admin_client.get(
        "/admin/api/analytics/overview", params={"start": (now - timedelta(days=500)).isoformat()}
    )
    assert too_long.status_code == 422
