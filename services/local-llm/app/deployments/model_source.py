"""Read a Hugging Face repository's metadata and decide how (and whether) it can be served.

Nothing large is downloaded here: file sizes and parameter counts come from the Hub API,
so a model that cannot fit is refused before its weights are fetched.
"""

import json
import logging
from collections.abc import Callable
from pathlib import Path, PurePosixPath

from huggingface_hub import HfApi, hf_hub_download
from huggingface_hub.errors import (
    GatedRepoError,
    HfHubHTTPError,
    RepositoryNotFoundError,
    RevisionNotFoundError,
)
from huggingface_hub.hf_api import ModelInfo

from app.config import Settings
from app.deployments.models import ModelReference, ResolvedModel
from app.errors import ModelSourceError, UntrustedRemoteCodeError

logger = logging.getLogger(__name__)

GGUF_SUFFIX = ".gguf"
GGUF_PROJECTOR_PREFIX = "mmproj"
# Preferred vision projector precisions, best first (BF16/F16 halve F32's memory).
GGUF_PROJECTOR_PREFERENCE = ("BF16", "F16", "F32")
TRANSFORMERS_RUNTIME_SUFFIXES = (".json", ".safetensors", ".py", ".jinja", ".txt", ".model", ".tiktoken")
CONTEXT_WINDOW_CONFIG_KEYS = ("max_position_embeddings", "max_sequence_length", "n_positions")


ConfigReader = Callable[[str, str], dict[str, object]]


class ModelSourceResolver:
    """Turns a ``model_id`` (``org/repo`` or ``org/repo:QUANT``) into a :class:`ResolvedModel`."""

    def __init__(
        self,
        settings: Settings,
        hub_api: HfApi | None = None,
        config_reader: ConfigReader | None = None,
    ) -> None:
        self._token = settings.huggingface_token.get_secret_value() if settings.huggingface_token else None
        self._hub_api = hub_api or HfApi(token=self._token)
        self._read_model_config = config_reader or self._download_model_config
        self._trusted_code_organizations = settings.trusted_code_organization_names

    def resolve(self, model_id: str, revision: str | None) -> ResolvedModel:
        """Inspect the repository and pick the engine. Blocking: run it in a worker thread."""
        reference = ModelReference.parse(model_id)
        model_info = self._fetch_model_info(reference.repository_id, revision)
        file_sizes = {sibling.rfilename: sibling.size or 0 for sibling in model_info.siblings or []}
        if reference.quantization is not None or _contains_only_gguf_weights(file_sizes):
            return self._resolve_gguf(reference, model_info, file_sizes)
        return self._resolve_transformers(reference, model_info, file_sizes)

    def _fetch_model_info(self, repository_id: str, revision: str | None) -> ModelInfo:
        try:
            return self._hub_api.model_info(repository_id, revision=revision, files_metadata=True)
        except GatedRepoError as error:
            raise ModelSourceError(
                f"'{repository_id}' is gated; accept its licence on Hugging Face and set LOCAL_LLM_HUGGINGFACE_TOKEN"
            ) from error
        except RevisionNotFoundError as error:
            raise ModelSourceError(f"Revision '{revision}' does not exist in '{repository_id}'") from error
        except RepositoryNotFoundError as error:
            raise ModelSourceError(f"Hugging Face repository '{repository_id}' was not found") from error
        except HfHubHTTPError as error:
            raise ModelSourceError(f"Hugging Face metadata for '{repository_id}' is unavailable") from error

    def _resolve_gguf(
        self, reference: ModelReference, model_info: ModelInfo, file_sizes: dict[str, int]
    ) -> ResolvedModel:
        weight_files = _select_gguf_weight_files(reference, file_sizes)
        projector_file = _select_gguf_projector_file(file_sizes)
        downloaded_files = (*weight_files, projector_file) if projector_file else weight_files
        gguf_metadata = model_info.gguf or {}
        return ResolvedModel(
            repository_id=reference.repository_id,
            revision=_require_commit_sha(model_info),
            engine="llama_cpp",
            files_to_download=downloaded_files,
            is_vision=projector_file is not None,
            needs_remote_code=False,
            model_type=gguf_metadata.get("architecture"),
            native_context_window_tokens=gguf_metadata.get("context_length"),
            parameter_count=int(gguf_metadata.get("total") or 0),
            weight_file_bytes=sum(file_sizes[file_name] for file_name in downloaded_files),
            gguf_model_file=weight_files[0],
            gguf_projector_file=projector_file,
        )

    def _resolve_transformers(
        self, reference: ModelReference, model_info: ModelInfo, file_sizes: dict[str, int]
    ) -> ResolvedModel:
        if "config.json" not in file_sizes:
            raise ModelSourceError(f"'{reference.repository_id}' has no config.json; it is not a Transformers model")
        if model_info.safetensors is None or not model_info.safetensors.total:
            raise ModelSourceError(
                f"'{reference.repository_id}' has no safetensors weights; pickled weights are refused for safety"
            )
        revision = _require_commit_sha(model_info)
        model_config = self._read_model_config(reference.repository_id, revision)
        needs_remote_code = "auto_map" in model_config
        if needs_remote_code:
            self._require_trusted_organization(reference)
        return ResolvedModel(
            repository_id=reference.repository_id,
            revision=revision,
            engine="transformers",
            files_to_download=_root_runtime_files(file_sizes),
            is_vision="preprocessor_config.json" in file_sizes or "vision_config" in model_config,
            needs_remote_code=needs_remote_code,
            model_type=_optional_string(model_config.get("model_type")),
            native_context_window_tokens=_read_context_window(model_config),
            parameter_count=model_info.safetensors.total,
            weight_file_bytes=sum(size for name, size in file_sizes.items() if name.endswith(".safetensors")),
        )

    def _download_model_config(self, repository_id: str, revision: str) -> dict[str, object]:
        config_path = hf_hub_download(repository_id, "config.json", revision=revision, token=self._token)
        loaded_config: dict[str, object] = json.loads(Path(config_path).read_text(encoding="utf-8"))
        return loaded_config

    def _require_trusted_organization(self, reference: ModelReference) -> None:
        if reference.organization.lower() not in self._trusted_code_organizations:
            raise UntrustedRemoteCodeError(
                f"'{reference.repository_id}' executes its own Python code on load; add "
                f"'{reference.organization}' to LOCAL_LLM_TRUSTED_CODE_ORGANIZATIONS to allow it"
            )


def _contains_only_gguf_weights(file_sizes: dict[str, int]) -> bool:
    has_gguf = any(name.endswith(GGUF_SUFFIX) for name in file_sizes)
    has_safetensors = any(name.endswith(".safetensors") for name in file_sizes)
    return has_gguf and not has_safetensors


def _select_gguf_weight_files(reference: ModelReference, file_sizes: dict[str, int]) -> tuple[str, ...]:
    """The GGUF file(s) for the requested quantisation; several only for split models."""
    weight_files = sorted(
        name
        for name in file_sizes
        if name.endswith(GGUF_SUFFIX) and not PurePosixPath(name).name.lower().startswith(GGUF_PROJECTOR_PREFIX)
    )
    if reference.quantization is None:
        if len(weight_files) == 1:
            return (weight_files[0],)
        raise ModelSourceError(
            f"'{reference.repository_id}' has several GGUF files; add a quantisation such as "
            f"'{reference.repository_id}:Q4_K_M'. Available: {_quantization_tags(weight_files)}"
        )
    matching_files = tuple(name for name in weight_files if _has_quantization_tag(name, reference.quantization))
    if not matching_files:
        raise ModelSourceError(
            f"'{reference.repository_id}' has no '{reference.quantization}' GGUF file. "
            f"Available: {_quantization_tags(weight_files)}"
        )
    return matching_files


def _has_quantization_tag(file_name: str, quantization: str) -> bool:
    stem = PurePosixPath(file_name).name.removesuffix(GGUF_SUFFIX).lower()
    stem_without_shard = stem.split("-0000", 1)[0]
    return stem_without_shard.endswith((f"-{quantization.lower()}", f".{quantization.lower()}"))


def _quantization_tags(weight_files: list[str]) -> str:
    tags = {PurePosixPath(name).name.removesuffix(GGUF_SUFFIX).rsplit("-", 1)[-1] for name in weight_files}
    return ", ".join(sorted(tags))


def _select_gguf_projector_file(file_sizes: dict[str, int]) -> str | None:
    projector_files = [
        name
        for name in file_sizes
        if name.endswith(GGUF_SUFFIX) and PurePosixPath(name).name.lower().startswith(GGUF_PROJECTOR_PREFIX)
    ]
    for precision in GGUF_PROJECTOR_PREFERENCE:
        for projector_file in projector_files:
            if projector_file.upper().endswith(f"-{precision}{GGUF_SUFFIX.upper()}"):
                return projector_file
    return sorted(projector_files)[0] if projector_files else None


def _root_runtime_files(file_sizes: dict[str, int]) -> tuple[str, ...]:
    """Repository-root files a Transformers model needs; skips docs, benchmarks and pickles."""
    return tuple(
        sorted(name for name in file_sizes if "/" not in name and name.endswith(TRANSFORMERS_RUNTIME_SUFFIXES))
    )


def _read_context_window(model_config: dict[str, object]) -> int | None:
    """The first context-length key found at the top level, in ``text_config`` or in ``decoder``."""
    candidate_configs: list[object] = [model_config, model_config.get("text_config"), model_config.get("decoder")]
    for candidate_config in candidate_configs:
        if not isinstance(candidate_config, dict):
            continue
        for key in CONTEXT_WINDOW_CONFIG_KEYS:
            value = candidate_config.get(key)
            if isinstance(value, int) and value > 0:
                return value
    return None


def _optional_string(value: object) -> str | None:
    return value if isinstance(value, str) else None


def _require_commit_sha(model_info: ModelInfo) -> str:
    if model_info.sha is None:
        raise ModelSourceError(f"Hugging Face returned no commit for '{model_info.id}'")
    return model_info.sha
