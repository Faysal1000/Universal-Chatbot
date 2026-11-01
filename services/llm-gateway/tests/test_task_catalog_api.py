"""Task catalog, the vision routing rule, model limits, and caller task resolution."""

from fastapi.testclient import TestClient

from tests.conftest import create_provider_with_models, inference_headers
from tests.test_gateway_api import create_route, set_default_model

BUILTIN_VISION_TASKS = {"document_parse", "table_extraction", "equation_ocr", "chart_description"}
BUILTIN_TEXT_TASKS = {"query_rewrite", "answer_generation", "conversation_summary"}


def create_text_and_vision_models(admin_client: TestClient) -> tuple[int, int]:
    text_model_pk = create_provider_with_models(
        admin_client,
        "texty",
        "openai_chat_completions",
        ["fake-small"],
        context_window_tokens=128_000,
        max_output_tokens=8000,
    )["fake-small"]
    vision_model_pk = create_provider_with_models(
        admin_client,
        "seeing",
        "openai_chat_completions",
        ["fake-vision"],
        capabilities=["vision"],
        context_window_tokens=16_000,
        max_output_tokens=4000,
    )["fake-vision"]
    return text_model_pk, vision_model_pk


# ----- Catalog -----


def test_builtin_tasks_are_seeded_with_their_vision_needs(admin_client: TestClient) -> None:
    tasks = {task["task_name"]: task for task in admin_client.get("/admin/api/tasks").json()}

    assert set(tasks) == BUILTIN_VISION_TASKS | BUILTIN_TEXT_TASKS
    assert all(tasks[name]["requires_vision"] for name in BUILTIN_VISION_TASKS)
    assert not any(tasks[name]["requires_vision"] for name in BUILTIN_TEXT_TASKS)


def test_tasks_cannot_be_created_by_admins(admin_client: TestClient) -> None:
    assert admin_client.post("/admin/api/tasks", json={"task_name": "sms_reply"}).status_code == 405


def test_a_route_needs_a_builtin_task(admin_client: TestClient) -> None:
    text_model_pk, _ = create_text_and_vision_models(admin_client)

    response = admin_client.post(
        "/admin/api/routes", json={"task_name": "brand_new_task", "steps": [{"model_pk": text_model_pk}]}
    )

    assert response.status_code == 422
    assert "is not a built-in task" in response.json()["detail"]


# ----- Vision rule -----


def test_vision_task_cannot_route_to_a_text_model(admin_client: TestClient) -> None:
    text_model_pk, vision_model_pk = create_text_and_vision_models(admin_client)

    rejected = admin_client.post(
        "/admin/api/routes", json={"task_name": "document_parse", "steps": [{"model_pk": text_model_pk}]}
    )
    accepted = admin_client.post(
        "/admin/api/routes", json={"task_name": "document_parse", "steps": [{"model_pk": vision_model_pk}]}
    )
    rejected_fallback = admin_client.put(
        "/admin/api/routes/document_parse/chain",
        json={"steps": [{"model_pk": vision_model_pk}, {"model_pk": text_model_pk}]},
    )

    assert rejected.status_code == 422
    assert "requires vision" in rejected.json()["detail"]
    assert accepted.status_code == 201
    assert rejected_fallback.status_code == 422


def test_vision_cannot_be_removed_from_a_model_routed_for_vision(admin_client: TestClient) -> None:
    _, vision_model_pk = create_text_and_vision_models(admin_client)
    create_route(admin_client, "chart_description", vision_model_pk)

    removal = admin_client.patch(f"/admin/api/models/{vision_model_pk}", json={"capabilities": []})

    assert removal.status_code == 409
    assert "chart_description" in removal.json()["detail"]


# ----- Model limits -----


def test_model_limits_and_capabilities_round_trip(admin_client: TestClient) -> None:
    text_model_pk, _ = create_text_and_vision_models(admin_client)

    updated = admin_client.patch(
        f"/admin/api/models/{text_model_pk}",
        json={
            "context_window_tokens": 64_000,
            "capabilities": ["vision", "vision"],
            "max_output_tokens": None,
        },
    )

    assert updated.status_code == 200, updated.text
    assert updated.json()["context_window_tokens"] == 64_000
    assert updated.json()["max_output_tokens"] is None
    assert updated.json()["capabilities"] == ["vision"]
    assert updated.json()["is_available"] is True


def test_default_output_cannot_exceed_max_output(admin_client: TestClient) -> None:
    text_model_pk, _ = create_text_and_vision_models(admin_client)

    response = admin_client.patch(
        f"/admin/api/models/{text_model_pk}", json={"default_max_output_tokens": 9000}
    )

    assert response.status_code == 422
    assert "exceeds max_output_tokens" in response.json()["detail"]


# ----- Caller task resolution -----


def test_task_resolution_reports_models_and_tightest_limits(admin_client: TestClient) -> None:
    text_model_pk, vision_model_pk = create_text_and_vision_models(admin_client)
    create_route(admin_client, "answer_generation", text_model_pk, vision_model_pk)

    response = admin_client.get("/v1/tasks/answer_generation", headers=inference_headers())

    assert response.status_code == 200, response.text
    resolution = response.json()
    assert [model["qualified_name"] for model in resolution["models"]] == [
        "texty/fake-small",
        "seeing/fake-vision",
    ]
    assert [model["role"] for model in resolution["models"]] == ["primary", "fallback"]
    assert resolution["limits"] == {"context_window_tokens": 16_000, "max_output_tokens": 4000}
    assert resolution["is_routed"] is True


def test_unrouted_task_resolves_to_the_default_model(admin_client: TestClient) -> None:
    text_model_pk, _ = create_text_and_vision_models(admin_client)
    set_default_model(admin_client, text_model_pk)

    resolution = admin_client.get("/v1/tasks/conversation_summary", headers=inference_headers()).json()

    assert resolution["is_routed"] is False
    assert resolution["models"][0]["role"] == "default"
    assert resolution["limits"]["context_window_tokens"] == 128_000


def test_vision_task_without_a_vision_model_is_unavailable(admin_client: TestClient) -> None:
    text_model_pk, _ = create_text_and_vision_models(admin_client)
    set_default_model(admin_client, text_model_pk)

    resolution = admin_client.get("/v1/tasks/document_parse", headers=inference_headers())
    completion = admin_client.post(
        "/v1/chat/completions",
        headers=inference_headers(),
        json={"model": "document_parse", "messages": [{"role": "user", "content": "page"}]},
    )

    assert resolution.status_code == 503
    assert completion.status_code == 503


def test_task_list_includes_the_catalog(admin_client: TestClient) -> None:
    response = admin_client.get("/v1/tasks", headers=inference_headers())

    assert response.status_code == 200
    assert {task["task_name"] for task in response.json()} >= BUILTIN_VISION_TASKS | BUILTIN_TEXT_TASKS


def test_task_resolution_requires_the_caller_key(gateway_client: TestClient) -> None:
    assert gateway_client.get("/v1/tasks/answer_generation").status_code == 401
