"""Engine choice and safety checks made from Hugging Face metadata (no network)."""

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.deployments.model_source import ModelSourceResolver
from app.errors import ModelSourceError, UntrustedRemoteCodeError
from tests.conftest import build_settings

QWEN_GGUF_FILES = {
    "Qwen3.5-0.8B-Q4_K_M.gguf": 532_517_120,
    "Qwen3.5-0.8B-Q8_0.gguf": 811_843_840,
    "Qwen3.5-0.8B-UD-Q4_K_XL.gguf": 558_772_480,
    "mmproj-F32.gguf": 402_381_664,
    "mmproj-BF16.gguf": 207_346_528,
    "README.md": 100,
}
NEMOTRON_FILES = {
    "config.json": 5_735,
    "model.safetensors": 2_523_266_640,
    "hf_nemotron_parse_modeling.py": 12_800,
    "preprocessor_config.json": 950,
    "reference/parse_3_5/validation.json": 3_072,
    "README.md": 26_400,
}


class FakeHubApi:
    """Returns canned ``model_info`` results keyed by repository id."""

    def __init__(self, files_by_repository: dict[str, dict[str, int]], safetensors_total: int | None = None) -> None:
        self._files_by_repository = files_by_repository
        self._safetensors_total = safetensors_total

    def model_info(self, repository_id: str, revision: str | None = None, files_metadata: bool = False) -> Any:
        files = self._files_by_repository[repository_id]
        return SimpleNamespace(
            id=repository_id,
            sha="a" * 40,
            siblings=[SimpleNamespace(rfilename=name, size=size) for name, size in files.items()],
            safetensors=SimpleNamespace(total=self._safetensors_total) if self._safetensors_total else None,
            gguf={"architecture": "qwen35", "context_length": 262_144, "total": 752_393_024},
        )


def build_resolver(
    tmp_path: Path, hub_api: FakeHubApi, model_config: dict[str, object] | None = None
) -> ModelSourceResolver:
    return ModelSourceResolver(
        build_settings(tmp_path),
        hub_api=hub_api,  # type: ignore[arg-type]
        config_reader=lambda repository_id, revision: model_config or {},
    )


def test_gguf_quantisation_selects_the_matching_file_and_best_projector(tmp_path: Path) -> None:
    resolver = build_resolver(tmp_path, FakeHubApi({"unsloth/Qwen3.5-0.8B-GGUF": QWEN_GGUF_FILES}))

    resolved = resolver.resolve("unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M", None)

    assert resolved.engine == "llama_cpp"
    assert resolved.gguf_model_file == "Qwen3.5-0.8B-Q4_K_M.gguf"
    assert resolved.gguf_projector_file == "mmproj-BF16.gguf"
    assert resolved.is_vision
    assert resolved.weight_file_bytes == 532_517_120 + 207_346_528


def test_unknown_gguf_quantisation_lists_the_available_ones(tmp_path: Path) -> None:
    resolver = build_resolver(tmp_path, FakeHubApi({"unsloth/Qwen3.5-0.8B-GGUF": QWEN_GGUF_FILES}))

    with pytest.raises(ModelSourceError, match=r"Available: .*Q4_K_M"):
        resolver.resolve("unsloth/Qwen3.5-0.8B-GGUF:Q2_K", None)


def test_gguf_repository_with_several_files_needs_a_quantisation(tmp_path: Path) -> None:
    resolver = build_resolver(tmp_path, FakeHubApi({"unsloth/Qwen3.5-0.8B-GGUF": QWEN_GGUF_FILES}))

    with pytest.raises(ModelSourceError, match="add a quantisation"):
        resolver.resolve("unsloth/Qwen3.5-0.8B-GGUF", None)


def test_transformers_model_downloads_only_root_runtime_files(tmp_path: Path) -> None:
    resolver = build_resolver(
        tmp_path,
        FakeHubApi({"nvidia/Nemotron-3.5-Parse": NEMOTRON_FILES}, safetensors_total=630_800_504),
        {"model_type": "nemotron_parse", "auto_map": {"AutoModel": "x.Y"}, "max_position_embeddings": 16_384},
    )

    resolved = resolver.resolve("nvidia/Nemotron-3.5-Parse", None)

    assert resolved.engine == "transformers"
    assert resolved.needs_remote_code
    assert resolved.is_vision
    assert resolved.native_context_window_tokens == 16_384
    assert resolved.files_to_download == (
        "config.json",
        "hf_nemotron_parse_modeling.py",
        "model.safetensors",
        "preprocessor_config.json",
    )


def test_remote_code_from_an_untrusted_organisation_is_refused(tmp_path: Path) -> None:
    resolver = build_resolver(
        tmp_path,
        FakeHubApi({"someone/custom-model": NEMOTRON_FILES}, safetensors_total=1_000),
        {"auto_map": {"AutoModel": "evil.Model"}},
    )

    with pytest.raises(UntrustedRemoteCodeError, match="LOCAL_LLM_TRUSTED_CODE_ORGANIZATIONS"):
        resolver.resolve("someone/custom-model", None)


def test_pickled_weights_are_refused(tmp_path: Path) -> None:
    resolver = build_resolver(tmp_path, FakeHubApi({"org/old-model": {"config.json": 10, "pytorch_model.bin": 10}}))

    with pytest.raises(ModelSourceError, match="no safetensors"):
        resolver.resolve("org/old-model", None)
