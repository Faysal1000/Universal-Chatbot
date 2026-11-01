"""Shared fixtures.

Unit tests need nothing. API tests need a disposable Postgres database whose URL is
given in ``LLM_GATEWAY_TEST_DATABASE_URL`` (it is wiped and migrated per session);
they are skipped when it is not set. Upstream providers are faked in-process by
``tests.fake_provider`` mounted through ``httpx.ASGITransport``.
"""

import asyncio
import os
import subprocess
import sys
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import Settings
from app.main import create_app
from app.security.admin_passwords import hash_admin_password
from tests.fake_provider import fake_provider_app, reset_fake_provider_state

TEST_API_KEY = "test-gateway-api-key-0123456789abcdefghijklmnop"
TEST_REGISTRATION_API_KEY = "test-registration-key-0123456789abcdefghijklmn"
TEST_ADMIN_USERNAME = "admin"
TEST_ADMIN_PASSWORD = "correct-horse-battery-staple"
TEST_ADMIN_PASSWORD_HASH = hash_admin_password(TEST_ADMIN_PASSWORD)
TEST_ENCRYPTION_KEY = Fernet.generate_key().decode("ascii")
FAKE_PROVIDER_BASE_URL = "http://fake-provider.test"
DASHBOARD_HEADERS = {"X-Requested-With": "llm-gateway-dashboard"}
BACKEND_DIRECTORY = Path(__file__).resolve().parents[1]


def build_test_settings(**overrides: Any) -> Settings:
    """Valid settings for tests; database URL may be a dummy for unit tests."""
    settings_values: dict[str, Any] = {
        "api_key": TEST_API_KEY,
        "registration_api_key": TEST_REGISTRATION_API_KEY,
        "encryption_key": TEST_ENCRYPTION_KEY,
        "database_url": os.environ.get(
            "LLM_GATEWAY_TEST_DATABASE_URL", "postgresql+asyncpg://unused:unused@localhost:1/unused"
        ),
        "admin_username": TEST_ADMIN_USERNAME,
        "admin_password_hash": TEST_ADMIN_PASSWORD_HASH,
        "admin_session_secret": "test-session-secret-0123456789abcdefghijklmnop",
        "admin_cookie_secure": False,
        "log_format": "text",
        "retry_base_delay_seconds": 0.01,
        "retry_max_delay_seconds": 0.05,
        "metrics_flush_interval_seconds": 0.05,
        "routing_cache_ttl_seconds": 0,
        **overrides,
    }
    return Settings(_env_file=None, **settings_values)


@pytest.fixture(scope="session")
def test_database_url() -> str:
    """Wipe and migrate the test database once per session."""
    database_url = os.environ.get("LLM_GATEWAY_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("LLM_GATEWAY_TEST_DATABASE_URL is not set; skipping database-backed tests")

    async def drop_everything() -> None:
        engine = create_async_engine(database_url)
        async with engine.begin() as connection:
            await connection.execute(text("DROP SCHEMA public CASCADE"))
            await connection.execute(text("CREATE SCHEMA public"))
        await engine.dispose()

    asyncio.run(drop_everything())
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIRECTORY,
        env={**os.environ, "LLM_GATEWAY_DATABASE_URL": database_url},
        check=True,
        capture_output=True,
    )
    return database_url


def truncate_all_tables(database_url: str) -> None:
    async def truncate() -> None:
        engine = create_async_engine(database_url)
        async with engine.begin() as connection:
            await connection.execute(text("UPDATE gateway_settings SET default_model_pk = NULL"))
            await connection.execute(text("DELETE FROM task_routes"))
            await connection.execute(text("DELETE FROM providers"))  # Cascades to provider_models.
            await connection.execute(text("TRUNCATE request_metrics"))
        await engine.dispose()

    asyncio.run(truncate())


@pytest.fixture
def gateway_client(test_database_url: str) -> Iterator[TestClient]:
    """A running gateway (lifespan included) whose upstream calls hit the fake provider."""
    truncate_all_tables(test_database_url)
    reset_fake_provider_state()
    application = create_app(
        build_test_settings(database_url=test_database_url),
        upstream_transport=httpx.ASGITransport(app=fake_provider_app),
    )
    with TestClient(application) as client:
        yield client


@pytest.fixture
def admin_client(gateway_client: TestClient) -> TestClient:
    """The same client, signed in as the admin and sending the CSRF header."""
    gateway_client.headers.update(DASHBOARD_HEADERS)
    login_response = gateway_client.post(
        "/admin/api/session", json={"username": TEST_ADMIN_USERNAME, "password": TEST_ADMIN_PASSWORD}
    )
    assert login_response.status_code == 200, login_response.text
    return gateway_client


def inference_headers() -> dict[str, str]:
    """Caller headers with the gateway API key."""
    return {"Authorization": f"Bearer {TEST_API_KEY}"}


def registration_headers() -> dict[str, str]:
    """local-llm headers with the registration API key."""
    return {"Authorization": f"Bearer {TEST_REGISTRATION_API_KEY}"}


def create_provider_with_models(
    admin_client: TestClient, provider_id: str, api_protocol: str, model_ids: list[str], **model_fields: Any
) -> dict[str, int]:
    """Create a fake-backed provider and its models; return ``{model_id: model_pk}``."""
    path_prefix = "anthropic" if api_protocol == "anthropic_messages" else "openai"
    provider_response = admin_client.post(
        "/admin/api/providers",
        json={
            "provider_id": provider_id,
            "display_name": provider_id.title(),
            "base_url": f"{FAKE_PROVIDER_BASE_URL}/{path_prefix}/v1",
            "api_protocol": api_protocol,
            "api_key": f"sk-{provider_id}-secret",
        },
    )
    assert provider_response.status_code == 201, provider_response.text
    model_pks: dict[str, int] = {}
    for model_id in model_ids:
        model_response = admin_client.post(
            f"/admin/api/providers/{provider_id}/models", json={"model_id": model_id, **model_fields}
        )
        assert model_response.status_code == 201, model_response.text
        model_pks[model_id] = model_response.json()["id"]
    return model_pks


def wait_for(condition: Callable[[], Any], timeout_seconds: float = 3.0) -> Any:
    """Poll until ``condition()`` is truthy (metrics are written asynchronously)."""
    deadline = time.monotonic() + timeout_seconds
    while True:
        result = condition()
        if result or time.monotonic() > deadline:
            return result
        time.sleep(0.05)
