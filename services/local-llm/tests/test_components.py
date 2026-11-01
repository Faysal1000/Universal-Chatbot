"""Small components: config, images, admission, throughput, store and SSE relaying."""

import asyncio
import base64
import io
import json
from pathlib import Path

import pytest
from PIL import Image
from pydantic import ValidationError

from app.admission import DeploymentAdmission
from app.deployments.models import DeploymentSpec, ReasoningControlSetting, effective_reasoning_control
from app.deployments.store import DeploymentStore
from app.engines.base import GenerationStats
from app.engines.chat_templates import has_thinking_switch
from app.engines.llama_cpp_engine import _StreamMonitor
from app.errors import InvalidImageError, ServiceAtCapacityError
from app.images import ImageLimits, decode_data_uri_image
from app.throughput import ThroughputTracker
from tests.conftest import TEST_ADMIN_KEY, TEST_INFERENCE_KEY, build_settings

IMAGE_LIMITS = ImageLimits(max_bytes=1024 * 1024, max_pixels=1_000_000)


def png_data_uri(width: int, height: int) -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), "white").save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


# ---------------------------------------------------------------------------- config


def test_short_api_keys_are_refused(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="at least 32"):
        build_settings(tmp_path, admin_api_key="short")


def test_inference_and_admin_keys_must_differ(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="must be different"):
        build_settings(tmp_path, admin_api_key=TEST_INFERENCE_KEY)


def test_gateway_registration_requires_its_key(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="GATEWAY_REGISTRATION_API_KEY"):
        build_settings(tmp_path, gateway_base_url="http://llm-gateway:4000")


def test_the_advertised_address_defaults_to_the_platform_service_name(tmp_path: Path) -> None:
    settings = build_settings(
        tmp_path,
        gateway_base_url="http://llm-gateway:4000/",
        gateway_registration_api_key="registration-key-that-is-long-enough-0001",
    )

    assert settings.public_base_url == "http://local-llm:8000"
    assert settings.gateway_base_url == "http://llm-gateway:4000"


def test_blank_optional_values_mean_unset(tmp_path: Path) -> None:
    settings = build_settings(tmp_path, gateway_base_url="", system_model_revision=" ", admin_api_key=TEST_ADMIN_KEY)

    assert settings.gateway_base_url is None
    assert settings.system_model_revision is None
    assert not settings.is_gateway_registration_enabled


def test_trusted_organisations_are_parsed_case_insensitively(tmp_path: Path) -> None:
    settings = build_settings(tmp_path, trusted_code_organizations="nvidia, Qwen ,")

    assert settings.trusted_code_organization_names == frozenset({"nvidia", "qwen"})


# ---------------------------------------------------------------------------- images


def test_a_valid_png_data_uri_decodes_to_rgb() -> None:
    image = decode_data_uri_image(png_data_uri(20, 10), IMAGE_LIMITS)

    assert (image.mode, image.size) == ("RGB", (20, 10))


@pytest.mark.parametrize(
    ("data_uri", "message"),
    [
        ("https://example.com/page.png", "data URIs"),
        ("data:image/png;base64,***", "not valid base64"),
        ("data:image/png;base64," + "A" * 2_000_000, "byte limit"),
    ],
)
def test_unsafe_or_malformed_images_are_refused(data_uri: str, message: str) -> None:
    with pytest.raises(InvalidImageError, match=message):
        decode_data_uri_image(data_uri, IMAGE_LIMITS)


def test_decompression_bombs_are_refused_before_decoding() -> None:
    with pytest.raises(InvalidImageError, match="pixels"):
        decode_data_uri_image(png_data_uri(2000, 1000), IMAGE_LIMITS)


# ---------------------------------------------------------------------------- admission


async def test_admission_rejects_beyond_running_plus_waiting() -> None:
    admission = DeploymentAdmission(concurrency=1, max_waiting=1)
    release = asyncio.Event()

    async def hold_slot() -> None:
        async with admission.slot():
            await release.wait()

    holders = [asyncio.create_task(hold_slot()) for _ in range(2)]
    await asyncio.sleep(0)

    with pytest.raises(ServiceAtCapacityError):
        async with admission.slot():
            pass
    assert (admission.in_flight_count, admission.waiting_count) == (2, 1)
    release.set()
    await asyncio.gather(*holders)
    assert admission.in_flight_count == 0


# ---------------------------------------------------------------------------- throughput


def test_throughput_uses_busy_time_and_forgets_old_samples() -> None:
    now = [0.0]
    tracker = ThroughputTracker(window_seconds=60, clock=lambda: now[0])
    tracker.record(GenerationStats(10, 100, 4.0, "stop"))
    tracker.record(GenerationStats(10, 0, 6.0, "stop", pages=1))

    snapshot = tracker.snapshot()
    assert snapshot.tokens_per_second == 10.0
    assert (snapshot.seconds_per_page, snapshot.pages_per_minute) == (6.0, 10.0)

    now[0] = 120.0
    assert tracker.snapshot().completed_requests == 0


# ---------------------------------------------------------------------------- store


def test_store_round_trips_specs(tmp_path: Path) -> None:
    store = DeploymentStore(tmp_path)
    spec = DeploymentSpec(
        name="qwen", model_id="unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M", default_for_tasks=("query_rewrite",)
    )

    store.save_all([spec])

    assert store.load_all() == [spec]
    assert not list(tmp_path.glob(".deployments-*"))


def test_a_corrupt_state_file_stops_startup_instead_of_forgetting_deployments(tmp_path: Path) -> None:
    (tmp_path / "deployments.json").write_text("{not json")

    with pytest.raises(RuntimeError, match="unreadable"):
        DeploymentStore(tmp_path).load_all()


# ---------------------------------------------------------------------------- llama.cpp stream relay


class RecordingObserver:
    def __init__(self) -> None:
        self.finished: list[GenerationStats] = []

    def on_finished(self, stats: GenerationStats) -> None:
        self.finished.append(stats)


def sse_line(payload: dict[str, object]) -> str:
    return "data: " + json.dumps(payload)


def test_stream_relay_hides_usage_the_caller_did_not_ask_for_but_still_measures_it() -> None:
    observer = RecordingObserver()
    monitor = _StreamMonitor(observer, caller_wants_usage=False)
    lines = [
        sse_line({"choices": [{"delta": {"content": "Hi"}, "finish_reason": None}]}),
        "",
        sse_line({"choices": [{"delta": {}, "finish_reason": "length"}]}),
        sse_line({"choices": [], "usage": {"prompt_tokens": 7, "completion_tokens": 3}}),
        "data: [DONE]",
    ]

    relayed = [event for line in lines if (event := monitor.relay(line)) is not None]
    monitor.finish(elapsed_seconds=1.5)

    assert len(relayed) == 3
    assert relayed[-1] == b"data: [DONE]\n\n"
    assert observer.finished == [GenerationStats(7, 3, 1.5, "length")]


# ---------------------------------------------------------------------------- reasoning control


@pytest.mark.parametrize(
    ("setting", "has_switch", "expected"),
    [
        ("auto", True, "enable_thinking"),
        ("auto", False, None),
        ("reasoning_effort", True, "reasoning_effort"),
        ("enable_thinking", False, "enable_thinking"),
    ],
)
def test_reasoning_control_follows_the_setting_or_the_chat_template(
    setting: ReasoningControlSetting, has_switch: bool, expected: str | None
) -> None:
    assert effective_reasoning_control(setting, has_switch) == expected


def test_the_thinking_switch_is_read_from_the_chat_template() -> None:
    assert has_thinking_switch("{%- if enable_thinking is defined and enable_thinking is false %}")
    assert not has_thinking_switch("{{ messages }}")
    assert not has_thinking_switch(None)
