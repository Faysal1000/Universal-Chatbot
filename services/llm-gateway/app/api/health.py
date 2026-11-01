"""Liveness and readiness probes (unauthenticated)."""

import asyncio
import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.runtime import GatewayRuntime

logger = logging.getLogger(__name__)

READINESS_DATABASE_TIMEOUT_SECONDS = 2.0

health_router = APIRouter(tags=["health"])


@health_router.get("/health/live")
async def liveness() -> dict[str, str]:
    """The process is running and serving HTTP."""
    return {"status": "alive"}


@health_router.get("/health/ready")
async def readiness(request: Request) -> JSONResponse:
    """Started up and Postgres answers; otherwise 503 so traffic is held back."""
    runtime: GatewayRuntime | None = getattr(request.app.state, "runtime", None)
    if runtime is None:
        return JSONResponse(status_code=503, content={"status": "starting"})
    try:
        async with asyncio.timeout(READINESS_DATABASE_TIMEOUT_SECONDS):
            async with runtime.database_engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
    except Exception:
        logger.warning("Readiness check failed: database unavailable", exc_info=True)
        return JSONResponse(status_code=503, content={"status": "database_unavailable"})
    return JSONResponse(content={"status": "ready"})
