"""Per-model reasoning control: ``reasoning_effort`` becomes a chat template's thinking switch."""

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.reasoning_control import ENABLE_THINKING_CONTROL
from app.protocols.openai_chat_completions.adapter import OpenAIChatCompletionsAdapter
from app.protocols.openai_chat_completions.thinking_switch import (
    replace_reasoning_effort_with_thinking_switch,
)
from app.protocols.types import UpstreamTarget
from tests.conftest import create_provider_with_models
from tests.fake_provider import received_requests
from tests.test_gateway_api import chat, create_route
from tests.test_local_model_registration_api import register

QWEN_TASK = "query_rewrite"


def upstream_target(**overrides: Any) -> UpstreamTarget:
    return UpstreamTarget(
        provider_id="local-models",
        provider_display_name="Local models",
        base_url="http://local-llm:8000/v1",
        api_protocol="openai_chat_completions",
        api_key=None,
        extra_headers={},
        request_timeout_seconds=60,
        max_concurrent_requests=4,
        model_pk=1,
        model_id="qwen3.5-0.8b",
        **overrides,
    )


# ----- Translation -----


@pytest.mark.parametrize(
    ("request_fields", "expected_thinking"),
    [
        ({}, False),
        ({"reasoning_effort": None}, False),
        ({"reasoning_effort": "none"}, False),
        ({"reasoning_effort": "minimal"}, True),
        ({"reasoning_effort": "high"}, True),
    ],
)
def test_reasoning_effort_maps_to_enable_thinking(
    request_fields: dict[str, Any], expected_thinking: bool
) -> None:
    upstream_body: dict[str, Any] = {"messages": [], **request_fields}

    replace_reasoning_effort_with_thinking_switch(upstream_body)

    assert "reasoning_effort" not in upstream_body
    assert upstream_body["chat_template_kwargs"] == {"enable_thinking": expected_thinking}


def test_callers_own_template_switch_wins_and_other_kwargs_are_kept() -> None:
    upstream_body: dict[str, Any] = {
        "reasoning_effort": "high",
        "chat_template_kwargs": {"enable_thinking": False, "custom_flag": 1},
    }

    replace_reasoning_effort_with_thinking_switch(upstream_body)

    assert upstream_body["chat_template_kwargs"] == {"enable_thinking": False, "custom_flag": 1}


def test_adapter_translates_only_for_models_with_the_thinking_switch() -> None:
    chat_request = {"model": QWEN_TASK, "messages": [], "reasoning_effort": "none"}
    adapter = OpenAIChatCompletionsAdapter()

    switched = adapter.build_request(chat_request, upstream_target(reasoning_control=ENABLE_THINKING_CONTROL))
    passed_through = adapter.build_request(chat_request, upstream_target())

    assert switched.json_body["chat_template_kwargs"] == {"enable_thinking": False}
    assert "reasoning_effort" not in switched.json_body
    assert passed_through.json_body["reasoning_effort"] == "none"
    assert "chat_template_kwargs" not in passed_through.json_body


# ----- Configuration -----


def test_admin_sets_reasoning_control_and_the_upstream_receives_the_switch(admin_client: TestClient) -> None:
    model_pk = create_provider_with_models(admin_client, "qwenish", "openai_chat_completions", ["qwen"])[
        "qwen"
    ]
    create_route(admin_client, QWEN_TASK, model_pk)

    updated = admin_client.patch(
        f"/admin/api/models/{model_pk}", json={"reasoning_control": "enable_thinking"}
    )
    response = chat(admin_client, QWEN_TASK, reasoning_effort="none")

    assert updated.json()["reasoning_control"] == "enable_thinking"
    assert response.status_code == 200, response.text
    assert received_requests[-1]["body"]["chat_template_kwargs"] == {"enable_thinking": False}
    assert "reasoning_effort" not in received_requests[-1]["body"]


def test_models_pass_reasoning_effort_on_by_default(admin_client: TestClient) -> None:
    model_pk = create_provider_with_models(admin_client, "hosted", "openai_chat_completions", ["gpt"])["gpt"]
    create_route(admin_client, QWEN_TASK, model_pk)

    chat(admin_client, QWEN_TASK, reasoning_effort="low")

    assert received_requests[-1]["body"]["reasoning_effort"] == "low"
    assert admin_client.get("/admin/api/providers/hosted").json()["models"][0]["reasoning_control"] == (
        "reasoning_effort"
    )


def test_registration_keeps_an_admin_set_reasoning_control_when_omitted(admin_client: TestClient) -> None:
    model_pk = register(admin_client, "qwen3.5-0.8b", capabilities=[], default_for_tasks=[]).json()[
        "model_pk"
    ]
    admin_client.patch(f"/admin/api/models/{model_pk}", json={"reasoning_control": "enable_thinking"})

    reregistered = register(admin_client, "qwen3.5-0.8b", capabilities=[], default_for_tasks=[])
    declared = register(
        admin_client,
        "qwen3.5-0.8b",
        capabilities=[],
        default_for_tasks=[],
        reasoning_control="reasoning_effort",
    )

    assert reregistered.json()["reasoning_control"] == "enable_thinking"
    assert declared.json()["reasoning_control"] == "reasoning_effort"
