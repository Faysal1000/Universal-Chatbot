"""Download a planned model, load it with its engine and prove it generates."""

import asyncio
import logging
from collections.abc import Callable, Mapping
from pathlib import Path

from huggingface_hub import snapshot_download

from app.deployments.models import DeploymentStatus, EngineKind, ResolvedDevice
from app.deployments.runtime import LoadedState, ManagedModel
from app.engines.base import Engine, LoadRequest

logger = logging.getLogger(__name__)

StatusReporter = Callable[[DeploymentStatus], None]
SnapshotDownloader = Callable[..., str]


class ModelLoader:
    """Turns a plan into a ready :class:`ManagedModel`: download, load, smoke test."""

    def __init__(
        self,
        engines: Mapping[EngineKind, Engine],
        cpu_threads: int,
        huggingface_token: str | None,
        snapshot_downloader: SnapshotDownloader = snapshot_download,
    ) -> None:
        self._engines = engines
        self._cpu_threads = cpu_threads
        self._huggingface_token = huggingface_token
        self._snapshot_downloader = snapshot_downloader

    async def load(
        self, deployment_name: str, plan: LoadedState, device: ResolvedDevice, report_status: StatusReporter
    ) -> ManagedModel:
        """Download (cached after the first time), load and smoke-test; unload again if the test fails."""
        report_status(DeploymentStatus.DOWNLOADING)
        model_directory = await asyncio.to_thread(self._download, plan)
        report_status(DeploymentStatus.LOADING)
        load_request = LoadRequest(
            deployment_name=deployment_name,
            resolved_model=plan.resolved_model,
            model_directory=model_directory,
            device=device,
            dtype=plan.dtype,
            context_window_tokens=plan.context_window_tokens,
            max_output_tokens=plan.max_output_tokens,
            cpu_threads=self._cpu_threads,
        )
        loaded_model = await self._engines[plan.resolved_model.engine].load(load_request)
        try:
            await loaded_model.run_smoke_test()
        except BaseException:
            await loaded_model.unload()
            raise
        return ManagedModel(loaded_model)

    def _download(self, plan: LoadedState) -> Path:
        resolved_model = plan.resolved_model
        logger.info(
            "Downloading model files",
            extra={"repository": resolved_model.repository_id, "revision": resolved_model.revision},
        )
        return Path(
            self._snapshot_downloader(
                resolved_model.repository_id,
                revision=resolved_model.revision,
                allow_patterns=list(resolved_model.files_to_download),
                token=self._huggingface_token,
            )
        )
