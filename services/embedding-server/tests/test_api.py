from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import TEST_API_KEY, FakeEmbeddingBackend, encode_test_image

AUTH_HEADERS = {"X-API-Key": TEST_API_KEY}


@pytest.fixture
def client(app_settings: Settings, fake_backend: FakeEmbeddingBackend) -> Iterator[TestClient]:
    application = create_app(app_settings, model_loader=lambda _settings: fake_backend)
    with TestClient(application) as test_client:
        yield test_client


def test_health_endpoints(client: TestClient) -> None:
    assert client.get("/health/live").json() == {"status": "alive"}
    assert client.get("/health/ready").json() == {"status": "ready"}


def test_request_id_is_propagated_or_generated(client: TestClient) -> None:
    assert (
        client.get("/health/live", headers={"X-Request-ID": "abc-123"}).headers["X-Request-ID"] == "abc-123"
    )
    generated = client.get("/health/live", headers={"X-Request-ID": "bad\nvalue"}).headers["X-Request-ID"]
    assert generated != "bad\nvalue" and len(generated) == 32


def test_missing_or_wrong_api_key_is_rejected(client: TestClient) -> None:
    body = {"type": "text", "text": "hello"}
    assert client.post("/v1/embed", json=body).status_code == 401
    assert client.post("/v1/embed", json=body, headers={"X-API-Key": "wrong"}).status_code == 401


def test_single_text_embedding(client: TestClient, app_settings: Settings) -> None:
    response = client.post(
        "/v1/embed", json={"type": "text", "text": "hello", "task": "query"}, headers=AUTH_HEADERS
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["dimension"] == app_settings.embedding_dimension
    assert len(payload["embedding"]) == app_settings.embedding_dimension


def test_query_prompt_template_is_applied(client: TestClient, fake_backend: FakeEmbeddingBackend) -> None:
    client.post("/v1/embed", json={"type": "text", "text": "hello", "task": "query"}, headers=AUTH_HEADERS)
    assert fake_backend.received_batches[0][0].text == "task: search result | query: hello"


def test_batch_with_mixed_modalities(client: TestClient) -> None:
    image = encode_test_image()
    items = [
        {"type": "text", "text": "a passage", "task": "document", "title": "Doc"},
        {"type": "image", "image_base64": image},
        {"type": "text_image", "text": "a caption", "image_base64": image},
    ]
    response = client.post("/v1/embed/batch", json={"items": items}, headers=AUTH_HEADERS)
    assert response.status_code == 200
    assert response.json()["count"] == 3


def test_invalid_batch_item_reports_its_index(client: TestClient) -> None:
    items = [{"type": "text", "text": "fine"}, {"type": "image", "image_base64": "A" * 32}]
    response = client.post("/v1/embed/batch", json={"items": items}, headers=AUTH_HEADERS)
    assert response.status_code == 422
    assert response.json()["item_index"] == 1


def test_text_over_token_budget_is_rejected(client: TestClient, app_settings: Settings) -> None:
    long_text = "word " * (app_settings.max_text_tokens + 1)
    response = client.post("/v1/embed", json={"type": "text", "text": long_text}, headers=AUTH_HEADERS)
    assert response.status_code == 422
    assert "tokens" in response.json()["detail"]


def test_inference_failure_returns_503_with_retry_after(
    client: TestClient, fake_backend: FakeEmbeddingBackend
) -> None:
    fake_backend.fail_next_batch = True
    response = client.post("/v1/embed", json={"type": "text", "text": "x"}, headers=AUTH_HEADERS)
    assert response.status_code == 503
    assert response.headers["Retry-After"] == "1"


def test_oversized_body_is_rejected_by_content_length(client: TestClient, app_settings: Settings) -> None:
    oversized = b"x" * (app_settings.max_request_body_bytes + 1)
    response = client.post(
        "/v1/embed", content=oversized, headers={**AUTH_HEADERS, "Content-Type": "application/json"}
    )
    assert response.status_code == 413


def test_oversized_chunked_body_is_rejected(client: TestClient, app_settings: Settings) -> None:
    chunk = b"x" * 65_536
    chunk_count = app_settings.max_request_body_bytes // len(chunk) + 2

    def stream() -> Iterator[bytes]:
        for _ in range(chunk_count):
            yield chunk

    response = client.post(
        "/v1/embed", content=stream(), headers={**AUTH_HEADERS, "Content-Type": "application/json"}
    )
    assert response.status_code == 413


def test_docs_disabled_by_default(client: TestClient) -> None:
    assert client.get("/docs").status_code == 404
