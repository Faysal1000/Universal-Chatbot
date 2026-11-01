"""Service-to-service admin access with ``LLM_GATEWAY_ADMIN_API_KEY`` (used by the admin console)."""

from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import create_app
from tests.conftest import (
    TEST_API_KEY,
    TEST_REGISTRATION_API_KEY,
    build_test_settings,
    truncate_all_tables,
)
from tests.fake_provider import fake_provider_app

TEST_ADMIN_API_KEY = "test-admin-api-key-0123456789abcdefghijklmnopq"


def test_admin_api_key_is_optional_and_blank_means_unset() -> None:
    assert build_test_settings().admin_api_key is None
    assert build_test_settings(admin_api_key="  ").admin_api_key is None


def test_admin_api_key_must_be_strong() -> None:
    with pytest.raises(ValidationError, match="at least 32"):
        build_test_settings(admin_api_key="short")


@pytest.mark.parametrize("reused_key", [TEST_API_KEY, TEST_REGISTRATION_API_KEY])
def test_admin_api_key_must_differ_from_the_other_keys(reused_key: str) -> None:
    with pytest.raises(ValidationError, match="must all differ"):
        build_test_settings(admin_api_key=reused_key)


def _client_with_admin_key(test_database_url: str, admin_api_key: str | None) -> Iterator[TestClient]:
    truncate_all_tables(test_database_url)
    application = create_app(
        build_test_settings(database_url=test_database_url, admin_api_key=admin_api_key),
        upstream_transport=httpx.ASGITransport(app=fake_provider_app),
    )
    with TestClient(application) as client:
        yield client


@pytest.fixture
def keyed_client(test_database_url: str) -> Iterator[TestClient]:
    """A gateway configured with an admin API key, with no session cookie."""
    yield from _client_with_admin_key(test_database_url, TEST_ADMIN_API_KEY)


@pytest.fixture
def keyless_client(test_database_url: str) -> Iterator[TestClient]:
    """A gateway without an admin API key (the default)."""
    yield from _client_with_admin_key(test_database_url, None)


def test_bearer_admin_key_reads_and_mutates_without_session_or_csrf_header(keyed_client: TestClient) -> None:
    headers = {"Authorization": f"Bearer {TEST_ADMIN_API_KEY}"}

    assert keyed_client.get("/admin/api/providers", headers=headers).status_code == 200
    updated = keyed_client.put("/admin/api/settings", json={"default_model_pk": None}, headers=headers)

    assert updated.status_code == 200, updated.text


@pytest.mark.parametrize(
    "admin_read_path",
    [
        "/admin/api/providers",
        "/admin/api/routes",
        "/admin/api/tasks",
        "/admin/api/settings",
        "/admin/api/circuit-breakers",
        "/admin/api/analytics/overview",
        "/admin/api/analytics/chain-steps",
    ],
)
def test_bearer_admin_key_reaches_every_admin_router(keyed_client: TestClient, admin_read_path: str) -> None:
    response = keyed_client.get(admin_read_path, headers={"Authorization": f"Bearer {TEST_ADMIN_API_KEY}"})

    assert response.status_code == 200, response.text


def test_x_api_key_header_is_accepted_too(keyed_client: TestClient) -> None:
    response = keyed_client.get("/admin/api/settings", headers={"X-API-Key": TEST_ADMIN_API_KEY})

    assert response.status_code == 200


@pytest.mark.parametrize("wrong_key", [TEST_API_KEY, TEST_REGISTRATION_API_KEY, "nope"])
def test_other_keys_are_rejected_on_admin_routes(keyed_client: TestClient, wrong_key: str) -> None:
    response = keyed_client.get("/admin/api/providers", headers={"Authorization": f"Bearer {wrong_key}"})

    assert response.status_code == 401


def test_admin_key_is_rejected_on_caller_routes(keyed_client: TestClient) -> None:
    response = keyed_client.get("/v1/models", headers={"Authorization": f"Bearer {TEST_ADMIN_API_KEY}"})

    assert response.status_code == 401


def test_without_a_configured_key_bearer_admin_access_is_refused(keyless_client: TestClient) -> None:
    response = keyless_client.get(
        "/admin/api/providers", headers={"Authorization": f"Bearer {TEST_ADMIN_API_KEY}"}
    )

    assert response.status_code == 401


def test_sessions_still_need_the_csrf_header(admin_client: TestClient) -> None:
    del admin_client.headers["X-Requested-With"]

    assert admin_client.get("/admin/api/providers").status_code == 200
    refused = admin_client.put("/admin/api/settings", json={"default_model_pk": None})

    assert refused.status_code == 403
