"""Delivery of registration changes to llm-gateway: payloads, retries and reconciliation."""

import asyncio
import json
from pathlib import Path

import httpx

from app.gateway_registration import GatewayRegistrar, RegistrationPayload
from tests.conftest import TEST_INFERENCE_KEY, build_settings

PAYLOAD = RegistrationPayload(
    display_name="Nemotron Parse",
    base_url="http://local-llm:8000/v1",
    capabilities=("vision",),
    context_window_tokens=16_384,
    max_output_tokens=8744,
    default_for_tasks=("document_parse",),
)


def build_registrar(tmp_path: Path, handler: object) -> GatewayRegistrar:
    settings = build_settings(
        tmp_path,
        gateway_base_url="http://gateway.test",
        gateway_registration_api_key="registration-key-that-is-long-enough-0001",
        public_base_url="http://local-llm:8000",
        gateway_retry_max_backoff_seconds=1,
    )
    client = httpx.AsyncClient(base_url="http://gateway.test", transport=httpx.MockTransport(handler))  # type: ignore[arg-type]
    return GatewayRegistrar(settings, http_client=client, random_jitter=lambda: 0.0)


async def eventually(condition: object, timeout_seconds: float = 3.0) -> None:
    for _ in range(int(timeout_seconds / 0.01)):
        if condition():  # type: ignore[operator]
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition not met in time")


async def test_registration_sends_the_phase_1_contract_body(tmp_path: Path) -> None:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200, json=[] if request.method == "GET" else {"claimed_default_routes": ["document_parse"]}
        )

    registrar = build_registrar(tmp_path, handle)
    registrar.start(set)
    registrar.mark_available("nemotron-parse", PAYLOAD)
    await eventually(lambda: any(request.method == "PUT" for request in requests))
    await registrar.stop(flush_timeout_seconds=1)

    put_request = next(request for request in requests if request.method == "PUT")
    assert put_request.url.path == "/v1/local-models/nemotron-parse"
    assert put_request.headers["authorization"].startswith("Bearer registration-key")
    assert json.loads(put_request.content) == {
        "display_name": "Nemotron Parse",
        "base_url": "http://local-llm:8000/v1",
        "capabilities": ["vision"],
        "context_window_tokens": 16_384,
        "max_output_tokens": 8744,
        "default_for_tasks": ["document_parse"],
        "api_protocol": "openai_chat_completions",
        "api_key": TEST_INFERENCE_KEY,
    }


async def test_registration_is_retried_while_the_gateway_is_down(tmp_path: Path) -> None:
    attempts: list[int] = []

    def handle(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json=[])
        attempts.append(1)
        return httpx.Response(503) if len(attempts) < 3 else httpx.Response(201, json={})

    registrar = build_registrar(tmp_path, handle)
    registrar.start(set)
    registrar.mark_available("qwen", PAYLOAD)
    await eventually(lambda: len(attempts) == 3)
    await registrar.stop(flush_timeout_seconds=1)

    assert len(attempts) == 3


async def test_unavailable_for_an_unknown_deployment_counts_as_delivered(tmp_path: Path) -> None:
    attempts: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        attempts.append(request.url.path)
        return httpx.Response(200, json=[]) if request.method == "GET" else httpx.Response(404)

    registrar = build_registrar(tmp_path, handle)
    registrar.start(set)
    registrar.mark_unavailable("never-registered")
    await eventually(lambda: "/v1/local-models/never-registered/unavailable" in attempts)
    await asyncio.sleep(0.05)
    await registrar.stop(flush_timeout_seconds=1)

    assert attempts.count("/v1/local-models/never-registered/unavailable") == 1


async def test_startup_reconciliation_marks_stale_registrations_unavailable(tmp_path: Path) -> None:
    unavailable_paths: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(
                200,
                json=[
                    {"deployment_name": "nemotron-parse", "is_available": True},
                    {"deployment_name": "deleted-while-down", "is_available": True},
                    {"deployment_name": "already-off", "is_available": False},
                ],
            )
        unavailable_paths.append(request.url.path)
        return httpx.Response(200, json={})

    registrar = build_registrar(tmp_path, handle)
    registrar.start(lambda: {"nemotron-parse"})
    await eventually(lambda: bool(unavailable_paths))
    await registrar.stop(flush_timeout_seconds=1)

    assert unavailable_paths == ["/v1/local-models/deleted-while-down/unavailable"]


async def test_nothing_is_sent_when_registration_is_disabled(tmp_path: Path) -> None:
    registrar = GatewayRegistrar(build_settings(tmp_path))
    registrar.start(set)

    registrar.mark_available("qwen", PAYLOAD)

    await registrar.stop(flush_timeout_seconds=1)
