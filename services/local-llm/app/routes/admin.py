"""Admin API (``/admin/v1``): deploy, load, unload, restart, update and inspect deployments."""

from dataclasses import asdict

from fastapi import APIRouter, Depends, Request, Response, status

from app.deployments.manager import DeploymentManager
from app.deployments.models import DeploymentSpec, effective_reasoning_control
from app.deployments.runtime import DeploymentRuntime
from app.hardware import llama_cpp_supports_cuda, read_host_inventory
from app.routes.dependencies import ManagerDependency
from app.schemas.admin import (
    ConfiguredSettingsView,
    DeploymentCreateRequest,
    DeploymentList,
    DeploymentUpdateRequest,
    DeploymentView,
    DeviceBudgetView,
    EngineSupportView,
    GpuView,
    MemoryView,
    SystemView,
    ThroughputView,
)
from app.security import KeyDependency


def build_admin_router(require_admin_key: KeyDependency) -> APIRouter:
    """Routes protected by the admin API key; errors are ``application/problem+json``."""
    router = APIRouter(prefix="/admin/v1", tags=["admin"], dependencies=[Depends(require_admin_key)])

    @router.get("/system")
    async def describe_system(request: Request, manager: ManagerDependency) -> SystemView:
        """CPU, RAM and GPUs, plus how much memory admission control can still hand out."""
        settings = request.app.state.settings
        inventory = read_host_inventory(settings.memory_capacity_bytes)
        ledger = request.app.state.memory_ledger
        return SystemView(
            cpu_cores=inventory.cpu_cores,
            ram_capacity_bytes=inventory.ram_capacity_bytes,
            ram_available_bytes=inventory.ram_available_bytes,
            memory_reserve_bytes=settings.memory_reserve_bytes,
            gpus=[GpuView(**asdict(gpu)) for gpu in inventory.gpus],
            budgets=[
                DeviceBudgetView(
                    device=device,
                    capacity_bytes=ledger.capacity_bytes(device),
                    reserved_bytes=ledger.capacity_bytes(device) - ledger.free_bytes(device),
                    free_bytes=ledger.free_bytes(device),
                )
                for device in ("cpu", "cuda")
                if ledger.capacity_bytes(device) > 0
            ],
            engines=EngineSupportView(
                transformers_cuda=bool(inventory.gpus),
                llama_cpp_installed=settings.llama_server_binary.is_file(),
                llama_cpp_cuda=bool(inventory.gpus) and llama_cpp_supports_cuda(settings.llama_server_binary),
            ),
        )

    @router.get("/deployments")
    async def list_deployments(manager: ManagerDependency) -> DeploymentList:
        """Every deployment with status, device, memory and throughput."""
        return DeploymentList(data=[_to_view(runtime, manager) for runtime in manager.list_runtimes()])

    @router.get("/deployments/{deployment_name}")
    async def get_deployment(deployment_name: str, manager: ManagerDependency) -> DeploymentView:
        """One deployment."""
        return _to_view(manager.get_runtime(deployment_name), manager)

    @router.post("/deployments", status_code=status.HTTP_202_ACCEPTED)
    async def create_deployment(body: DeploymentCreateRequest, manager: ManagerDependency) -> DeploymentView:
        """Reserve memory and start downloading and loading; 409 if it cannot fit, 422 if it cannot run."""
        spec = DeploymentSpec(
            **body.model_dump(exclude={"default_for_tasks"}), default_for_tasks=tuple(body.default_for_tasks)
        )
        return _to_view(await manager.create(spec), manager)

    @router.patch("/deployments/{deployment_name}", status_code=status.HTTP_202_ACCEPTED)
    async def update_deployment(
        deployment_name: str, body: DeploymentUpdateRequest, manager: ManagerDependency
    ) -> DeploymentView:
        """Change settings, or upgrade to a new model or revision (also for the system deployment)."""
        changes = body.model_dump(exclude_unset=True)
        if "default_for_tasks" in changes:
            changes["default_for_tasks"] = tuple(changes["default_for_tasks"] or ())
        return _to_view(await manager.update(deployment_name, changes), manager)

    @router.post("/deployments/{deployment_name}/load", status_code=status.HTTP_202_ACCEPTED)
    async def load_deployment(deployment_name: str, manager: ManagerDependency) -> DeploymentView:
        """Load an unloaded or failed deployment."""
        return _to_view(await manager.load(deployment_name), manager)

    @router.post("/deployments/{deployment_name}/unload")
    async def unload_deployment(deployment_name: str, manager: ManagerDependency) -> DeploymentView:
        """Free the deployment's memory (403 for the system deployment)."""
        return _to_view(await manager.unload(deployment_name), manager)

    @router.post("/deployments/{deployment_name}/restart", status_code=status.HTTP_202_ACCEPTED)
    async def restart_deployment(deployment_name: str, manager: ManagerDependency) -> DeploymentView:
        """Unload and load again."""
        return _to_view(await manager.restart(deployment_name), manager)

    @router.delete("/deployments/{deployment_name}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_deployment(deployment_name: str, manager: ManagerDependency) -> Response:
        """Unload and remove (403 for the system deployment)."""
        await manager.delete(deployment_name)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return router


def _to_view(runtime: DeploymentRuntime, manager: DeploymentManager) -> DeploymentView:
    plan = runtime.plan
    loaded_model = runtime.managed_model.loaded_model if runtime.managed_model else None
    reservation = manager.reservation_of(runtime.name)
    throughput = runtime.throughput.snapshot()
    return DeploymentView(
        name=runtime.name,
        display_name=runtime.spec.display_name,
        model_id=runtime.spec.model_id,
        revision=runtime.spec.revision,
        resolved_revision=plan.resolved_model.revision if plan else None,
        engine=plan.resolved_model.engine if plan else None,
        is_system=runtime.spec.is_system,
        status=runtime.status,
        status_changed_at=runtime.status_changed_at,
        loaded_at=runtime.loaded_at,
        device=runtime.spec.device,
        resolved_device=reservation.device if reservation else None,
        dtype=plan.dtype if plan and plan.resolved_model.engine == "transformers" else None,
        capabilities=["vision"] if loaded_model and loaded_model.is_vision else [],
        context_window_tokens=plan.context_window_tokens if plan else None,
        max_output_tokens=plan.max_output_tokens if plan else None,
        reasoning_control=(
            effective_reasoning_control(runtime.spec.reasoning_control, loaded_model.has_thinking_switch)
            if loaded_model
            else None
        ),
        default_for_tasks=list(runtime.spec.default_for_tasks),
        configured=ConfiguredSettingsView(
            revision=runtime.spec.revision,
            device=runtime.spec.device,
            dtype=runtime.spec.dtype,
            context_window_tokens=runtime.spec.context_window_tokens,
            max_output_tokens=runtime.spec.max_output_tokens,
            reasoning_control=runtime.spec.reasoning_control,
        ),
        memory=MemoryView(
            estimated_bytes=plan.estimated_bytes if plan else None,
            reserved_bytes=reservation.reserved_bytes if reservation else None,
            measured_bytes=loaded_model.measured_memory_bytes() if loaded_model else None,
        ),
        throughput=ThroughputView(**asdict(throughput)),
        requests_in_flight=runtime.admission.in_flight_count,
        requests_queued=runtime.admission.waiting_count,
        pending_update=runtime.pending_update,
        last_error=runtime.last_error,
    )
