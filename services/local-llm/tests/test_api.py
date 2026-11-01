"""HTTP behaviour of the inference, admin and health APIs, with fake engines."""

import asyncio
import base64
import io
import json

import httpx
from PIL import Image

from tests.conftest import (
    FAKE_REPLY,
    GIBIBYTE,
    AppHarness,
    admin_headers,
    inference_headers,
    wait_until_ready,
)

SYSTEM_NAME = "nemotron-parse"


def png_data_uri() -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (32, 32), "white").save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def chat_body(model: str, **extra: object) -> dict[str, object]:
    return {"model": model, "messages": [{"role": "user", "content": "Hi"}], **extra}


async def deploy_qwen(client: httpx.AsyncClient, harness: AppHarness, name: str = "qwen") -> httpx.Response:
    response = await client.post(
        "/admin/v1/deployments",
        headers=admin_headers(),
        json={"name": name, "model_id": "unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M", "default_for_tasks": ["query_rewrite"]},
    )
    if response.status_code == 202:
        await wait_until_ready(harness, name)
    return response


# ---------------------------------------------------------------------------- health


async def test_readiness_succeeds_once_the_system_deployment_is_ready(client: httpx.AsyncClient) -> None:
    assert (await client.get("/health/live")).json() == {"status": "alive"}
    assert (await client.get("/health/ready")).json() == {"status": "ready"}


async def test_readiness_fails_while_the_system_deployment_is_not_ready(
    client: httpx.AsyncClient, harness: AppHarness
) -> None:
    harness.engine.load_gate.clear()
    await client.post(f"/admin/v1/deployments/{SYSTEM_NAME}/restart", headers=admin_headers())

    response = await client.get("/health/ready")

    assert response.status_code == 503
    harness.engine.load_gate.set()


# ---------------------------------------------------------------------------- inference


async def test_models_lists_only_ready_deployments(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/models", headers=inference_headers())

    assert [model["id"] for model in response.json()["data"]] == [SYSTEM_NAME]


async def test_inference_rejects_missing_and_admin_keys(client: httpx.AsyncClient) -> None:
    missing_key_response = await client.post("/v1/chat/completions", json=chat_body(SYSTEM_NAME))
    admin_key_response = await client.get("/v1/models", headers=admin_headers())

    assert missing_key_response.status_code == 401
    assert admin_key_response.status_code == 401
    assert missing_key_response.json()["error"]["type"] == "authentication_error"


async def test_x_api_key_header_is_accepted(client: httpx.AsyncClient) -> None:
    response = await client.get("/v1/models", headers={"X-API-Key": inference_headers()["Authorization"][7:]})

    assert response.status_code == 200


async def test_non_streamed_completion_returns_the_model_reply(client: httpx.AsyncClient, harness: AppHarness) -> None:
    await deploy_qwen(client, harness)

    response = await client.post("/v1/chat/completions", headers=inference_headers(), json=chat_body("qwen"))

    assert response.status_code == 200
    assert response.json()["choices"][0]["message"]["content"] == FAKE_REPLY
    assert response.headers["x-request-id"]


async def test_streamed_completion_is_server_sent_events_ending_with_done(
    client: httpx.AsyncClient, harness: AppHarness
) -> None:
    await deploy_qwen(client, harness)

    response = await client.post(
        "/v1/chat/completions",
        headers=inference_headers(),
        json=chat_body("qwen", stream=True, stream_options={"include_usage": True}),
    )

    events = [line.removeprefix("data: ") for line in response.text.splitlines() if line.startswith("data: ")]
    chunks = [json.loads(event) for event in events[:-1]]
    assert response.headers["content-type"].startswith("text/event-stream")
    assert events[-1] == "[DONE]"
    assert "".join(c["choices"][0]["delta"].get("content", "") for c in chunks if c["choices"]).strip() == FAKE_REPLY
    assert chunks[-1]["usage"]["total_tokens"] == 10


async def test_streaming_releases_the_admission_slot(client: httpx.AsyncClient, harness: AppHarness) -> None:
    await deploy_qwen(client, harness)

    await client.post("/v1/chat/completions", headers=inference_headers(), json=chat_body("qwen", stream=True))

    assert harness.manager is not None
    assert harness.manager.get_runtime("qwen").admission.in_flight_count == 0


async def test_unknown_model_is_a_404_in_the_openai_error_envelope(client: httpx.AsyncClient) -> None:
    response = await client.post("/v1/chat/completions", headers=inference_headers(), json=chat_body("missing"))

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "deployment_not_found"


async def test_images_are_refused_by_text_only_deployments(client: httpx.AsyncClient, harness: AppHarness) -> None:
    await deploy_qwen(client, harness)
    image_message = {"role": "user", "content": [{"type": "image_url", "image_url": {"url": png_data_uri()}}]}

    response = await client.post(
        "/v1/chat/completions", headers=inference_headers(), json={"model": "qwen", "messages": [image_message]}
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


async def test_remote_image_urls_are_never_fetched(client: httpx.AsyncClient) -> None:
    image_message = {
        "role": "user",
        "content": [{"type": "image_url", "image_url": {"url": "http://169.254.169.254/"}}],
    }

    response = await client.post(
        "/v1/chat/completions", headers=inference_headers(), json={"model": SYSTEM_NAME, "messages": [image_message]}
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_image"


async def test_page_parse_counts_towards_pages_per_minute(client: httpx.AsyncClient) -> None:
    image_message = {"role": "user", "content": [{"type": "image_url", "image_url": {"url": png_data_uri()}}]}
    await client.post(
        "/v1/chat/completions", headers=inference_headers(), json={"model": SYSTEM_NAME, "messages": [image_message]}
    )

    deployment = (await client.get(f"/admin/v1/deployments/{SYSTEM_NAME}", headers=admin_headers())).json()

    assert deployment["throughput"]["pages_parsed"] == 1
    assert deployment["throughput"]["pages_per_minute"] == 120.0


async def test_oversized_bodies_are_rejected_before_parsing(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/v1/chat/completions",
        headers={**inference_headers(), "Content-Length": str(64 * 1024 * 1024)},
        content=b"{}",
    )

    assert response.status_code == 413
    assert response.headers["connection"] == "close"


async def test_a_full_queue_answers_503_with_retry_after(client: httpx.AsyncClient, harness: AppHarness) -> None:
    assert harness.manager is not None
    admission = harness.manager.get_runtime(SYSTEM_NAME).admission
    holders = [admission.slot() for _ in range(1 + harness.settings.max_queued_requests_per_deployment)]
    entered = [asyncio.create_task(holder.__aenter__()) for holder in holders]
    await asyncio.sleep(0)

    response = await client.post("/v1/chat/completions", headers=inference_headers(), json=chat_body(SYSTEM_NAME))

    assert response.status_code == 503
    assert response.headers["retry-after"] == "2"
    for task in entered:
        task.cancel()


# ---------------------------------------------------------------------------- admin


async def test_admin_api_rejects_the_inference_key(client: httpx.AsyncClient) -> None:
    response = await client.get("/admin/v1/deployments", headers=inference_headers())

    assert response.status_code == 401
    assert response.headers["content-type"] == "application/problem+json"


async def test_system_view_reports_the_memory_budget(client: httpx.AsyncClient) -> None:
    response = await client.get("/admin/v1/system", headers=admin_headers())

    cpu_budget = response.json()["budgets"][0]
    assert cpu_budget["device"] == "cpu"
    assert cpu_budget["capacity_bytes"] == 8 * GIBIBYTE
    assert 0 < cpu_budget["reserved_bytes"] < cpu_budget["capacity_bytes"]


async def test_deploying_a_model_loads_and_registers_it(client: httpx.AsyncClient, harness: AppHarness) -> None:
    response = await deploy_qwen(client, harness)

    deployment = (await client.get("/admin/v1/deployments/qwen", headers=admin_headers())).json()
    assert response.status_code == 202
    assert deployment["status"] == "ready"
    assert deployment["engine"] == "llama_cpp"
    assert deployment["resolved_device"] == "cpu"
    await asyncio.sleep(0.05)
    assert harness.gateway.registered["qwen"]["base_url"] == "http://local-llm:8000/v1"
    assert harness.gateway.registered["qwen"]["default_for_tasks"] == ["query_rewrite"]


async def test_the_system_deployment_registers_as_a_vision_document_parser(
    client: httpx.AsyncClient, harness: AppHarness
) -> None:
    await asyncio.sleep(0.05)

    registration = harness.gateway.registered[SYSTEM_NAME]

    assert registration["capabilities"] == ["vision"]
    assert "document_parse" in registration["default_for_tasks"]
    assert "reasoning_control" not in registration


async def test_a_model_with_a_thinking_switch_registers_enable_thinking(
    client: httpx.AsyncClient, harness: AppHarness
) -> None:
    await deploy_qwen(client, harness)
    await asyncio.sleep(0.05)

    deployment = (await client.get("/admin/v1/deployments/qwen", headers=admin_headers())).json()
    assert harness.gateway.registered["qwen"]["reasoning_control"] == "enable_thinking"
    assert deployment["reasoning_control"] == "enable_thinking"
    assert deployment["configured"]["reasoning_control"] == "auto"


async def test_an_explicit_reasoning_control_is_re_registered_without_a_reload(
    client: httpx.AsyncClient, harness: AppHarness
) -> None:
    await deploy_qwen(client, harness)

    response = await client.patch(
        "/admin/v1/deployments/qwen", headers=admin_headers(), json={"reasoning_control": "reasoning_effort"}
    )
    await asyncio.sleep(0.05)

    assert response.json()["status"] == "ready"
    assert harness.gateway.registered["qwen"]["reasoning_control"] == "reasoning_effort"


async def test_the_view_shows_configured_values_next_to_resolved_ones(
    client: httpx.AsyncClient, harness: AppHarness
) -> None:
    await deploy_qwen(client, harness)

    deployment = (await client.get("/admin/v1/deployments/qwen", headers=admin_headers())).json()

    assert (deployment["configured"]["device"], deployment["resolved_device"]) == ("auto", "cpu")
    assert deployment["configured"]["context_window_tokens"] is None
    assert deployment["context_window_tokens"] is not None
    assert deployment["configured"]["revision"] is None
    assert deployment["resolved_revision"] is not None


async def test_duplicate_names_are_rejected(client: httpx.AsyncClient, harness: AppHarness) -> None:
    await deploy_qwen(client, harness)

    response = await deploy_qwen(client, harness)

    assert response.status_code == 409
    assert response.json()["code"] == "deployment_name_taken"


async def test_a_model_that_does_not_fit_is_refused(client: httpx.AsyncClient, harness: AppHarness) -> None:
    harness.resolver.parameter_counts["Qwen/Qwen3-32B"] = 32_000_000_000

    response = await client.post(
        "/admin/v1/deployments", headers=admin_headers(), json={"name": "big", "model_id": "Qwen/Qwen3-32B"}
    )

    assert response.status_code == 409
    assert response.json()["code"] == "insufficient_memory"
    assert response.json()["details"]["required_bytes"]["cpu"] > 8 * GIBIBYTE


async def test_unload_marks_the_deployment_unavailable_and_load_restores_it(
    client: httpx.AsyncClient, harness: AppHarness
) -> None:
    await deploy_qwen(client, harness)

    unloaded = await client.post("/admin/v1/deployments/qwen/unload", headers=admin_headers())
    await asyncio.sleep(0.05)
    assert unloaded.json()["status"] == "unloaded"
    assert "qwen" in harness.gateway.unavailable

    await client.post("/admin/v1/deployments/qwen/load", headers=admin_headers())
    await wait_until_ready(harness, "qwen")
    await asyncio.sleep(0.05)
    assert "qwen" not in harness.gateway.unavailable


async def test_the_system_deployment_cannot_be_deleted_or_unloaded(client: httpx.AsyncClient) -> None:
    delete_response = await client.delete(f"/admin/v1/deployments/{SYSTEM_NAME}", headers=admin_headers())
    unload_response = await client.post(f"/admin/v1/deployments/{SYSTEM_NAME}/unload", headers=admin_headers())

    assert delete_response.status_code == 403
    assert unload_response.status_code == 403
    assert delete_response.json()["code"] == "system_deployment_protected"


async def test_deleting_a_deployment_removes_it(client: httpx.AsyncClient, harness: AppHarness) -> None:
    await deploy_qwen(client, harness)

    response = await client.delete("/admin/v1/deployments/qwen", headers=admin_headers())

    assert response.status_code == 204
    assert (await client.get("/admin/v1/deployments/qwen", headers=admin_headers())).status_code == 404


async def test_a_failed_load_is_reported_with_its_reason(client: httpx.AsyncClient, harness: AppHarness) -> None:
    harness.engine.failing_model_ids.add("org/broken")

    await client.post(
        "/admin/v1/deployments", headers=admin_headers(), json={"name": "broken", "model_id": "org/broken"}
    )
    await wait_until_ready(harness, "broken", expected="failed")

    deployment = (await client.get("/admin/v1/deployments/broken", headers=admin_headers())).json()
    assert "simulated load failure" in deployment["last_error"]
    assert deployment["memory"]["reserved_bytes"] is None


async def test_upgrading_the_system_model_swaps_without_downtime(
    client: httpx.AsyncClient, harness: AppHarness
) -> None:
    response = await client.patch(
        f"/admin/v1/deployments/{SYSTEM_NAME}", headers=admin_headers(), json={"revision": "new-revision"}
    )
    await wait_until_ready(harness, SYSTEM_NAME)

    deployment = (await client.get(f"/admin/v1/deployments/{SYSTEM_NAME}", headers=admin_headers())).json()
    assert response.status_code == 202
    assert deployment["revision"] == "new-revision"
    assert deployment["status"] == "ready"
    assert harness.engine.loaded_models[0].is_unloaded


async def test_a_failed_upgrade_keeps_the_previous_model_serving(
    client: httpx.AsyncClient, harness: AppHarness
) -> None:
    harness.engine.failing_model_ids.add("nvidia/Nemotron-Next")

    await client.patch(
        f"/admin/v1/deployments/{SYSTEM_NAME}", headers=admin_headers(), json={"model_id": "nvidia/Nemotron-Next"}
    )
    await wait_until_ready(harness, SYSTEM_NAME)

    deployment = (await client.get(f"/admin/v1/deployments/{SYSTEM_NAME}", headers=admin_headers())).json()
    assert deployment["model_id"] == "nvidia/Nemotron-3.5-Parse"
    assert "Update to nvidia/Nemotron-Next failed" in deployment["last_error"]


async def test_deployments_survive_a_restart(harness: AppHarness, client: httpx.AsyncClient) -> None:
    await deploy_qwen(client, harness)

    stored = json.loads((harness.settings.state_directory / "deployments.json").read_text())

    assert [deployment["name"] for deployment in stored["deployments"]] == [SYSTEM_NAME, "qwen"]


async def test_validation_errors_do_not_echo_request_content(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/admin/v1/deployments", headers=admin_headers(), json={"name": "bad name!", "model_id": "secret-prompt"}
    )

    assert response.status_code == 422
    assert "secret-prompt" not in response.text
