"""Small HTTP server for probes: ``/health/live`` and ``/health/ready``."""

import asyncio
import logging
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass

from aiohttp import web

logger = logging.getLogger(__name__)

ReadinessCheck = Callable[[], Awaitable[None]]


@dataclass(frozen=True, slots=True)
class ReadinessProbe:
    """Named dependency checks, each raising on failure and bounded by ``timeout_seconds``."""

    checks: Mapping[str, ReadinessCheck]
    timeout_seconds: float
    is_accepting_jobs: Callable[[], bool]

    async def evaluate(self) -> dict[str, str]:
        results = await asyncio.gather(*(self._run_check(check) for check in self.checks.values()))
        statuses = dict(zip(self.checks.keys(), results, strict=True))
        statuses["workers"] = "ok" if self.is_accepting_jobs() else "stopped"
        return statuses

    async def _run_check(self, check: ReadinessCheck) -> str:
        try:
            await asyncio.wait_for(check(), timeout=self.timeout_seconds)
        except TimeoutError:
            return "timeout"
        except Exception as error:  # noqa: BLE001 - any failure means "not ready"; details go to the log.
            logger.warning("Readiness check failed: %s: %s", type(error).__name__, error)
            return "error"
        return "ok"


def create_health_application(readiness_probe: ReadinessProbe) -> web.Application:
    async def live(_: web.Request) -> web.Response:
        return web.json_response({"status": "ok"})

    async def ready(_: web.Request) -> web.Response:
        statuses = await readiness_probe.evaluate()
        is_ready = all(status == "ok" for status in statuses.values())
        return web.json_response(
            {"status": "ok" if is_ready else "unavailable", "checks": statuses},
            status=200 if is_ready else 503,
        )

    application = web.Application()
    application.router.add_get("/health/live", live)
    application.router.add_get("/health/ready", ready)
    return application


async def start_health_server(application: web.Application, host: str, port: int) -> web.AppRunner:
    runner = web.AppRunner(application, access_log=None)
    await runner.setup()
    await web.TCPSite(runner, host=host, port=port).start()
    logger.info("Health server listening on %s:%s", host, port)
    return runner
