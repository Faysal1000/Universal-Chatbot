"""Liveness and readiness probes (unauthenticated, no model details)."""

from fastapi import APIRouter, HTTPException, Request

from app.deployments.models import DeploymentStatus
from app.routes.dependencies import ManagerDependency

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live")
async def liveness() -> dict[str, str]:
    """The process is up and its event loop answers."""
    return {"status": "alive"}


@router.get("/ready")
async def readiness(request: Request, manager: ManagerDependency) -> dict[str, str]:
    """Ready only when the system deployment (Nemotron Parse) serves requests and no shutdown is under way."""
    if request.app.state.is_shutting_down:
        raise HTTPException(status_code=503, detail="Shutting down")
    if manager.system_runtime.status is not DeploymentStatus.READY:
        raise HTTPException(status_code=503, detail=f"System deployment is {manager.system_runtime.status.value}")
    return {"status": "ready"}
