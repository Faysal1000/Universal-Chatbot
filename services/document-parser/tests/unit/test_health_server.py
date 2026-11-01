from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from app.entrypoints.health_server import ReadinessCheck, ReadinessProbe, create_health_application


async def succeed() -> None:
    return None


async def fail() -> None:
    raise ConnectionError("down")


async def hang() -> None:
    import asyncio

    await asyncio.sleep(10)


async def a_client(probe: ReadinessProbe) -> TestClient[web.Request, web.Application]:
    client = TestClient(TestServer(create_health_application(probe)))
    await client.start_server()
    return client


def a_probe(accepting: bool = True, **checks: ReadinessCheck) -> ReadinessProbe:
    return ReadinessProbe(
        checks=checks or {"redis": succeed}, timeout_seconds=0.05, is_accepting_jobs=lambda: accepting
    )


async def test_liveness_is_always_ok() -> None:
    client = await a_client(a_probe(accepting=False))
    try:
        response = await client.get("/health/live")
        assert (response.status, await response.json()) == (200, {"status": "ok"})
    finally:
        await client.close()


async def test_ready_when_every_check_passes() -> None:
    client = await a_client(a_probe(redis=succeed, object_storage=succeed))
    try:
        response = await client.get("/health/ready")
        assert response.status == 200
        assert (await response.json())["checks"] == {"redis": "ok", "object_storage": "ok", "workers": "ok"}
    finally:
        await client.close()


async def test_not_ready_when_a_dependency_fails_or_hangs() -> None:
    client = await a_client(a_probe(redis=fail, object_storage=hang))
    try:
        response = await client.get("/health/ready")
        assert response.status == 503
        assert (await response.json())["checks"] == {
            "redis": "error",
            "object_storage": "timeout",
            "workers": "ok",
        }
    finally:
        await client.close()


async def test_not_ready_while_shutting_down() -> None:
    client = await a_client(a_probe(accepting=False))
    try:
        assert (await client.get("/health/ready")).status == 503
    finally:
        await client.close()
