"""Configurable model chains: order, per-step attempts, circuit breakers, streaming cutoff, errors."""

import json
import time
from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import create_provider_with_models, inference_headers
from tests.fake_provider import received_requests
from tests.test_gateway_api import chat, recent_requests, set_default_model

TASK = "answer_generation"
CHAIN_STEP_HEADER = "X-LLM-Gateway-Chain-Step"


def create_models(admin_client: TestClient, *model_ids: str, **model_fields: Any) -> dict[str, int]:
    return create_provider_with_models(
        admin_client, "chainy", "openai_chat_completions", list(model_ids), **model_fields
    )


def put_chain(
    admin_client: TestClient, steps: list[dict[str, Any]], append_default_model: bool = False
) -> Any:
    return admin_client.put(
        f"/admin/api/routes/{TASK}/chain", json={"steps": steps, "append_default_model": append_default_model}
    )


def chain_of(*model_pks: int, **step_fields: Any) -> list[dict[str, Any]]:
    return [{"model_pk": model_pk, **step_fields} for model_pk in model_pks]


def called_models() -> list[str]:
    return [received_request["body"]["model"] for received_request in received_requests]


def breaker_of(admin_client: TestClient, model_pk: int) -> dict[str, Any] | None:
    breakers = admin_client.get("/admin/api/circuit-breakers").json()
    return next((breaker for breaker in breakers if breaker["model_pk"] == model_pk), None)


# ----- Order, attempts, default model -----


def test_steps_are_tried_in_order_until_one_succeeds(admin_client: TestClient) -> None:
    models = create_models(admin_client, "fail-500", "fail-429", "good")
    put_chain(admin_client, chain_of(models["fail-500"], models["fail-429"], models["good"]))

    response = chat(admin_client, TASK)
    rows = sorted(recent_requests(admin_client, minimum_rows=3), key=lambda row: row["chain_step"])

    assert response.status_code == 200
    assert response.headers[CHAIN_STEP_HEADER] == "3"
    assert called_models() == ["fail-500", "fail-429", "good"]
    assert [row["chain_step"] for row in rows] == [1, 2, 3]
    assert [row["fallback_reason"] for row in rows] == [
        None,
        "upstream_server_error",
        "upstream_rate_limited",
    ]
    assert rows[2]["chain_steps_tried"] == 3


def test_each_step_retries_up_to_its_own_max_attempts(admin_client: TestClient) -> None:
    models = create_models(admin_client, "fail-500", "fail-503", "good")
    put_chain(
        admin_client,
        [
            {"model_pk": models["fail-500"], "max_attempts": 3},
            {"model_pk": models["fail-503"]},
            {"model_pk": models["good"]},
        ],
    )

    chat(admin_client, TASK)

    assert called_models() == ["fail-500", "fail-500", "fail-500", "fail-503", "good"]


def test_appended_default_model_is_the_last_step_and_never_repeated(admin_client: TestClient) -> None:
    models = create_models(admin_client, "fail-500", "good")
    set_default_model(admin_client, models["good"])
    put_chain(admin_client, chain_of(models["fail-500"]), append_default_model=True)

    response = chat(admin_client, TASK)
    resolution = admin_client.get(f"/v1/tasks/{TASK}", headers=inference_headers()).json()
    put_chain(admin_client, chain_of(models["good"], models["fail-500"]), append_default_model=True)
    deduplicated = admin_client.get(f"/v1/tasks/{TASK}", headers=inference_headers()).json()

    assert response.headers[CHAIN_STEP_HEADER] == "2"
    assert [(model["step"], model["role"]) for model in resolution["models"]] == [
        (1, "primary"),
        (2, "default"),
    ]
    assert [model["model_id"] for model in deduplicated["models"]] == ["good", "fail-500"]


def test_disabled_steps_are_not_tried_and_do_not_limit_the_task(admin_client: TestClient) -> None:
    small = create_models(admin_client, "fail-500", context_window_tokens=1000)["fail-500"]
    large = create_provider_with_models(
        admin_client, "roomy", "openai_chat_completions", ["good"], context_window_tokens=64000
    )["good"]
    put_chain(admin_client, [{"model_pk": small, "is_enabled": False}, {"model_pk": large}])

    response = chat(admin_client, TASK)
    resolution = admin_client.get(f"/v1/tasks/{TASK}", headers=inference_headers()).json()
    chain = admin_client.get(f"/admin/api/routes/{TASK}/chain").json()

    assert response.headers[CHAIN_STEP_HEADER] == "2"
    assert called_models() == ["good"]
    assert [model["step"] for model in resolution["models"]] == [2]
    assert resolution["limits"]["context_window_tokens"] == 64000
    assert [step["is_enabled"] for step in chain["steps"]] == [False, True]


# ----- Failure reporting -----


def test_all_steps_failed_returns_one_error_listing_every_step(admin_client: TestClient) -> None:
    models = create_models(admin_client, "fail-500", "fail-429")
    put_chain(admin_client, chain_of(models["fail-500"], models["fail-429"]))

    response = chat(admin_client, TASK)
    error = response.json()["error"]

    assert response.status_code == 429
    assert error["code"] == "upstream_rate_limited"
    assert error["steps"] == [
        {
            "step": 1,
            "model": "chainy/fail-500",
            "outcome": "failed",
            "http_status": 502,
            "error_class": "upstream_server_error",
            "attempts": 1,
        },
        {
            "step": 2,
            "model": "chainy/fail-429",
            "outcome": "failed",
            "http_status": 429,
            "error_class": "upstream_rate_limited",
            "attempts": 1,
        },
    ]
    assert "sk-chainy-secret" not in response.text


def test_a_rejected_request_stops_the_chain(admin_client: TestClient) -> None:
    models = create_models(admin_client, "fail-400", "good")
    put_chain(admin_client, chain_of(models["fail-400"], models["good"]))

    response = chat(admin_client, TASK)

    assert response.status_code == 400
    assert called_models() == ["fail-400"]
    assert [step["model"] for step in response.json()["error"]["steps"]] == ["chainy/fail-400"]


# ----- Circuit breaker -----


def test_breaker_opens_after_consecutive_failures_and_the_chain_skips_the_model(
    admin_client: TestClient,
) -> None:
    models = create_models(admin_client, "fail-500", "good", breaker_failure_threshold=2)
    put_chain(admin_client, chain_of(models["fail-500"], models["good"]))

    chat(admin_client, TASK)
    chat(admin_client, TASK)
    calls_before_open_request = len(received_requests)
    skipped = chat(admin_client, TASK)
    skipped_row = recent_requests(admin_client, minimum_rows=5)[0]
    breaker = breaker_of(admin_client, models["fail-500"])
    chain = admin_client.get(f"/admin/api/routes/{TASK}").json()

    assert skipped.headers[CHAIN_STEP_HEADER] == "2"
    assert called_models()[calls_before_open_request:] == ["good"]
    assert skipped_row["fallback_reason"] == "circuit_open"
    assert skipped_row["chain_steps_tried"] == 2
    assert breaker is not None
    assert breaker["status"] == "open"
    assert breaker["consecutive_failures"] == 2
    assert breaker["last_error_class"] == "upstream_server_error"
    assert chain["steps"][0]["breaker_status"] == "open"


def test_breaker_lets_one_trial_through_after_the_cooldown_and_closes_on_success(
    admin_client: TestClient,
) -> None:
    models = create_models(
        admin_client, "flaky-1", "good", breaker_failure_threshold=1, breaker_cooldown_seconds=1
    )
    put_chain(admin_client, chain_of(models["flaky-1"], models["good"]))

    chat(admin_client, TASK)
    while_open = chat(admin_client, TASK)
    time.sleep(1.1)
    after_cooldown = chat(admin_client, TASK)

    assert while_open.headers[CHAIN_STEP_HEADER] == "2"
    assert after_cooldown.headers[CHAIN_STEP_HEADER] == "1"
    assert breaker_of(admin_client, models["flaky-1"]) is None


def test_admin_can_reset_one_or_all_breakers(admin_client: TestClient) -> None:
    models = create_models(admin_client, "fail-500", "fail-503", "good", breaker_failure_threshold=1)
    put_chain(admin_client, chain_of(models["fail-500"], models["fail-503"], models["good"]))
    chat(admin_client, TASK)

    reset_one = admin_client.post(f"/admin/api/circuit-breakers/{models['fail-500']}/reset")
    calls_before = len(received_requests)
    chat(admin_client, TASK)
    retried_models = called_models()[calls_before:]
    reset_all = admin_client.post("/admin/api/circuit-breakers/reset")

    assert reset_one.status_code == 204
    assert retried_models == ["fail-500", "good"]
    assert reset_all.json() == {"reset_count": 2}
    assert admin_client.get("/admin/api/circuit-breakers").json() == []
    assert admin_client.post("/admin/api/circuit-breakers/999999/reset").status_code == 404


def test_all_steps_skipped_returns_503_listing_the_skips(admin_client: TestClient) -> None:
    model_pk = create_models(admin_client, "fail-500", breaker_failure_threshold=1)["fail-500"]
    put_chain(admin_client, chain_of(model_pk))
    chat(admin_client, TASK)

    response = chat(admin_client, TASK)

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "all_models_circuit_open"
    assert response.json()["error"]["steps"][0]["outcome"] == "skipped"
    assert response.headers["Retry-After"] == "5"


def test_rejected_requests_do_not_count_towards_the_breaker(admin_client: TestClient) -> None:
    model_pk = create_models(admin_client, "fail-400", breaker_failure_threshold=1)["fail-400"]
    put_chain(admin_client, chain_of(model_pk))

    chat(admin_client, TASK)

    assert breaker_of(admin_client, model_pk) is None


# ----- Streaming -----


def stream(admin_client: TestClient) -> tuple[Any, str]:
    with admin_client.stream(
        "POST",
        "/v1/chat/completions",
        headers=inference_headers(),
        json={"model": TASK, "stream": True, "messages": [{"role": "user", "content": "hi"}]},
    ) as response:
        return response, "\n".join(response.iter_lines())


def test_stream_moves_to_the_next_step_before_the_first_token(admin_client: TestClient) -> None:
    models = create_models(admin_client, "fail-500", "good")
    put_chain(admin_client, chain_of(models["fail-500"], models["good"]))

    response, body = stream(admin_client)

    assert response.status_code == 200
    assert response.headers[CHAIN_STEP_HEADER] == "2"
    assert "good" in body


def test_stream_fails_instead_of_switching_models_after_the_first_token(admin_client: TestClient) -> None:
    models = create_models(admin_client, "stream-error", "good", breaker_failure_threshold=5)
    put_chain(admin_client, chain_of(models["stream-error"], models["good"]))

    response, body = stream(admin_client)
    error_events = [
        json.loads(line.removeprefix("data: "))
        for line in body.split("\n")
        if line.startswith("data: {") and '"error"' in line
    ]

    assert response.status_code == 200
    assert called_models() == ["stream-error"]
    assert error_events
    breaker = breaker_of(admin_client, models["stream-error"])
    assert breaker is not None and breaker["consecutive_failures"] == 1


# ----- Chain administration -----


def test_chain_replace_is_validated_and_atomic(admin_client: TestClient) -> None:
    models = create_models(admin_client, *[f"model-{index}" for index in range(11)])
    model_pks = list(models.values())
    put_chain(admin_client, chain_of(model_pks[0], model_pks[1]))

    too_long = put_chain(admin_client, chain_of(*model_pks))
    duplicate = put_chain(admin_client, chain_of(model_pks[0], model_pks[0]))
    empty = put_chain(admin_client, [])
    unknown_model = put_chain(admin_client, chain_of(model_pks[2], 999999))
    chain_after_rejections = admin_client.get(f"/admin/api/routes/{TASK}/chain").json()

    assert [response.status_code for response in (too_long, duplicate, empty, unknown_model)] == [422] * 4
    assert [step["model_pk"] for step in chain_after_rejections["steps"]] == model_pks[:2]


def test_chain_replace_reorders_and_keeps_step_settings(admin_client: TestClient) -> None:
    models = create_models(admin_client, "first", "second")
    put_chain(admin_client, chain_of(models["first"], models["second"]))

    reordered = put_chain(
        admin_client,
        [
            {"model_pk": models["second"], "max_attempts": 2, "timeout_seconds": 30},
            {"model_pk": models["first"], "max_attempts": None, "is_enabled": False},
        ],
        append_default_model=True,
    ).json()

    assert [(step["position"], step["model_name"]) for step in reordered["steps"]] == [
        (1, "chainy/second"),
        (2, "chainy/first"),
    ]
    assert reordered["steps"][0]["max_attempts"] == 2
    assert reordered["steps"][0]["timeout_seconds"] == 30
    assert reordered["steps"][1]["max_attempts"] is None
    assert reordered["append_default_model"] is True


def test_every_step_of_a_vision_task_needs_vision(admin_client: TestClient) -> None:
    vision_pk = create_provider_with_models(
        admin_client, "seeing", "openai_chat_completions", ["eyes"], capabilities=["vision"]
    )["eyes"]
    text_pk = create_models(admin_client, "text-only")["text-only"]

    response = admin_client.put(
        "/admin/api/routes/document_parse/chain",
        json={"steps": [{"model_pk": vision_pk}, {"model_pk": text_pk, "is_enabled": False}]},
    )

    assert response.status_code == 422


def test_a_model_in_a_chain_cannot_be_deleted(admin_client: TestClient) -> None:
    models = create_models(admin_client, "first", "second")
    put_chain(admin_client, chain_of(models["first"], models["second"]))

    assert admin_client.delete(f"/admin/api/models/{models['second']}").status_code == 409


# ----- Metrics -----


def test_analytics_report_the_share_served_by_each_step(admin_client: TestClient) -> None:
    models = create_models(admin_client, "flaky-1", "good")
    put_chain(admin_client, chain_of(models["flaky-1"], models["good"]))
    chat(admin_client, TASK)
    chat(admin_client, TASK)
    recent_requests(admin_client, minimum_rows=3)

    summary = admin_client.get("/admin/api/analytics/chain-steps", params={"task_name": TASK}).json()

    task_summary = summary["tasks"][0]
    assert task_summary["served_request_count"] == 2
    assert task_summary["steps"] == [
        {"chain_step": 1, "served_count": 1, "share": 0.5},
        {"chain_step": 2, "served_count": 1, "share": 0.5},
    ]
    assert task_summary["fallback_reasons"] == [{"reason": "upstream_server_error", "occurrence_count": 1}]
