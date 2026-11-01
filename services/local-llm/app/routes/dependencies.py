"""Request-scoped access to objects created at startup."""

from typing import Annotated

from fastapi import Depends, Request

from app.deployments.manager import DeploymentManager


def get_deployment_manager(request: Request) -> DeploymentManager:
    """The process-wide deployment manager."""
    manager: DeploymentManager = request.app.state.deployment_manager
    return manager


ManagerDependency = Annotated[DeploymentManager, Depends(get_deployment_manager)]
