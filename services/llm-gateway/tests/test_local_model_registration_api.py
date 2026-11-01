"""Machine registration of local-llm deployments (``/v1/local-models``)."""

from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import FAKE_PROVIDER_BASE_URL, inference_headers, registration_headers
from tests.fake_provider import received_requests
from tests.test_gateway_api import chat, create_route, set_default_model
from tests.test_task_catalog_api import create_text_and_vision_models

NEMOTRON_REGISTRATION: dict[str, Any] = {
    "display_name": "Nemotron Parse",
    "base_url": f"{FAKE_PROVIDER_BASE_URL}/openai/v1",
    "api_protocol": "openai_chat_completions",
    "capabilities": ["vision"],
    "context_window_tokens": 8192,
    "max_output_tokens": 4096,
    "default_for_tasks": ["document_parse"],
}


def register(client: TestClient, deployment_name: str, **overrides: Any) -> Any:
    return client.put(
        f"/v1/local-models/{deployment_name}",
        headers=registration_headers(),
        json={**NEMOTRON_REGISTRATION, **overrides},
    )


def test_registration_requires_the_registration_key(gateway_client: TestClient) -> None:
    with_caller_key = gateway_client.put(
        "/v1/local-models/nemotron-parse", headers=inference_headers(), json=NEMOTRON_REGISTRATION
    )
    registration_key_for_chat = gateway_client.post(
        "/v1/chat/completions",
        headers=registration_headers(),
        json={"model": "x", "messages": [{"role": "user", "content": "hi"}]},
    )

    assert with_caller_key.status_code == 401
    assert registration_key_for_chat.status_code == 401


def test_registration_is_an_idempotent_upsert(gateway_client: TestClient) -> None:
    first = register(gateway_client, "nemotron-parse")
    second = register(gateway_client, "nemotron-parse")

    assert first.status_code == 201, first.text
    assert second.status_code == 200
    assert first.json()["was_created"] is True
    assert second.json()["was_created"] is False
    assert first.json()["model_pk"] == second.json()["model_pk"]
    assert second.json()["qualified_name"] == "local-models/nemotron-parse"
    assert second.json()["capabilities"] == ["vision"]
    assert second.json()["is_available"] is True


def test_first_registration_claims_free_default_routes_only(admin_client: TestClient) -> None:
    _, admin_vision_model_pk = create_text_and_vision_models(admin_client)
    create_route(admin_client, "table_extraction", admin_vision_model_pk)

    response = register(
        admin_client, "nemotron-parse", default_for_tasks=["document_parse", "table_extraction"]
    )
    routes = {route["task_name"]: route for route in admin_client.get("/admin/api/routes").json()}

    assert response.json()["claimed_default_routes"] == ["document_parse"]
    assert routes["document_parse"]["steps"][0]["model_name"] == "local-models/nemotron-parse"
    assert routes["document_parse"]["append_default_model"] is True
    assert routes["table_extraction"]["steps"][0]["model_pk"] == admin_vision_model_pk
    assert register(admin_client, "nemotron-parse").json()["claimed_default_routes"] == []


def test_registration_rejects_unknown_tasks_and_vision_tasks_without_vision(
    gateway_client: TestClient,
) -> None:
    unknown_task = register(gateway_client, "nemotron-parse", default_for_tasks=["not_a_task"])
    text_only = register(gateway_client, "qwen", capabilities=[], default_for_tasks=["document_parse"])

    assert unknown_task.status_code == 422
    assert text_only.status_code == 422
    assert gateway_client.get("/v1/local-models", headers=registration_headers()).json() == []


def test_vision_cannot_be_dropped_while_routed_for_vision(gateway_client: TestClient) -> None:
    register(gateway_client, "nemotron-parse")

    response = register(gateway_client, "nemotron-parse", capabilities=[], default_for_tasks=[])

    assert response.status_code == 409


def test_registered_deployment_serves_its_task_at_its_own_url(gateway_client: TestClient) -> None:
    register(gateway_client, "nemotron-parse")

    response = chat(gateway_client, "document_parse")

    assert response.status_code == 200, response.text
    assert response.headers["X-LLM-Gateway-Provider"] == "local-models"
    assert received_requests[-1]["body"]["model"] == "nemotron-parse"
    resolution = gateway_client.get("/v1/tasks/document_parse", headers=inference_headers()).json()
    assert resolution["limits"] == {"context_window_tokens": 8192, "max_output_tokens": 4096}


def test_unavailable_deployment_falls_back_until_it_registers_again(admin_client: TestClient) -> None:
    _, admin_vision_model_pk = create_text_and_vision_models(admin_client)
    set_default_model(admin_client, admin_vision_model_pk)
    register(admin_client, "nemotron-parse")

    marked = admin_client.post("/v1/local-models/nemotron-parse/unavailable", headers=registration_headers())
    while_unavailable = chat(admin_client, "document_parse")
    register(admin_client, "nemotron-parse")
    after_reregistration = chat(admin_client, "document_parse")

    assert marked.status_code == 200
    assert marked.json()["is_available"] is False
    assert while_unavailable.headers["X-LLM-Gateway-Provider"] == "seeing"
    assert after_reregistration.headers["X-LLM-Gateway-Provider"] == "local-models"


def test_marking_an_unknown_deployment_unavailable_is_404(gateway_client: TestClient) -> None:
    response = gateway_client.post("/v1/local-models/ghost/unavailable", headers=registration_headers())

    assert response.status_code == 404


def test_deployments_are_listed_for_reconciliation(gateway_client: TestClient) -> None:
    register(gateway_client, "nemotron-parse")
    register(
        gateway_client, "qwen3.5-0.8b", capabilities=[], default_for_tasks=[], context_window_tokens=32768
    )

    deployments = gateway_client.get("/v1/local-models", headers=registration_headers()).json()

    assert [deployment["deployment_name"] for deployment in deployments] == ["nemotron-parse", "qwen3.5-0.8b"]
    assert deployments[1]["context_window_tokens"] == 32768


def test_registration_stores_the_upstream_key_encrypted_and_keeps_it_when_omitted(
    gateway_client: TestClient,
) -> None:
    local_llm_key = "local-llm-upstream-key-for-tests"
    with_key = register(gateway_client, "nemotron-parse", api_key=local_llm_key)
    without_key = register(gateway_client, "nemotron-parse")

    chat(gateway_client, "document_parse")

    assert with_key.json()["has_api_key"] is True
    assert without_key.json()["has_api_key"] is True
    assert local_llm_key not in with_key.text
    assert received_requests[-1]["headers"]["authorization"] == f"Bearer {local_llm_key}"


def test_registration_without_a_key_leaves_the_provider_keyless(gateway_client: TestClient) -> None:
    response = register(gateway_client, "nemotron-parse")

    assert response.json()["has_api_key"] is False
