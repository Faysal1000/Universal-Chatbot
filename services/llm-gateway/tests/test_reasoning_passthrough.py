"""Reasoning reaches callers as ``reasoning_content`` whatever the upstream protocol."""

import json

from app.protocols.registry import adapter_for
from app.protocols.server_sent_events import ServerSentEvent
from tests.test_protocols import chunks_from, make_target

USER_MESSAGES = [{"role": "user", "content": "Why is the sky blue?"}]


def test_chat_completions_stream_renames_reasoning_to_reasoning_content() -> None:
    translator = adapter_for("openai_chat_completions").create_stream_translator(
        make_target("openai_chat_completions"), "id", 0, False
    )
    result = translator.translate_event(
        ServerSentEvent(None, json.dumps({"choices": [{"index": 0, "delta": {"reasoning": "Rayleigh"}}]}))
    )
    delta = json.loads(result.client_payloads[0])["choices"][0]["delta"]
    assert delta == {"reasoning_content": "Rayleigh"}
    assert result.contains_output_token


def test_chat_completions_stream_forwards_reasoning_content_chunks_unchanged() -> None:
    translator = adapter_for("openai_chat_completions").create_stream_translator(
        make_target("openai_chat_completions"), "id", 0, False
    )
    raw_chunk = '{"choices":[{"index":0,"delta":{"reasoning_content":"Rayleigh"}}]}'
    result = translator.translate_event(ServerSentEvent(None, raw_chunk))
    assert result.client_payloads == [raw_chunk]


def test_chat_completions_json_response_renames_reasoning() -> None:
    chat_completion, _ = adapter_for("openai_chat_completions").translate_response(
        {"choices": [{"index": 0, "message": {"role": "assistant", "reasoning": "Rayleigh"}}]},
        make_target("openai_chat_completions"),
        "id",
        0,
    )
    message = chat_completion["choices"][0]["message"]
    assert message["reasoning_content"] == "Rayleigh"
    assert "reasoning" not in message


def test_anthropic_reasoning_effort_enables_thinking_on_top_of_answer_budget() -> None:
    body = (
        adapter_for("anthropic_messages")
        .build_request(
            {"messages": USER_MESSAGES, "max_tokens": 1000, "reasoning_effort": "low", "temperature": 0.2},
            make_target("anthropic_messages"),
        )
        .json_body
    )
    assert body["thinking"] == {"type": "enabled", "budget_tokens": 2048}
    assert body["max_tokens"] == 3048
    assert "temperature" not in body  # Anthropic rejects temperature with thinking enabled.


def test_anthropic_without_reasoning_effort_leaves_thinking_off() -> None:
    body = (
        adapter_for("anthropic_messages")
        .build_request(
            {"messages": USER_MESSAGES, "max_tokens": 1000, "temperature": 0.2},
            make_target("anthropic_messages"),
        )
        .json_body
    )
    assert "thinking" not in body
    assert body["max_tokens"] == 1000
    assert body["temperature"] == 0.2


def test_anthropic_thinking_stream_becomes_reasoning_content() -> None:
    translator = adapter_for("anthropic_messages").create_stream_translator(
        make_target("anthropic_messages"), "id", 0, False
    )
    chunks = chunks_from(
        translator,
        [
            ("message_start", {"type": "message_start", "message": {"usage": {"input_tokens": 3}}}),
            (
                "content_block_start",
                {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking"}},
            ),
            (
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": {"type": "thinking_delta", "thinking": "Hmm"},
                },
            ),
        ],
    )
    deltas = [chunk["choices"][0]["delta"] for chunk in chunks if chunk["choices"]]
    assert {"reasoning_content": "Hmm"} in deltas


def test_responses_reasoning_summary_stream_becomes_reasoning_content() -> None:
    translator = adapter_for("openai_responses").create_stream_translator(
        make_target("openai_responses"), "id", 0, False
    )
    chunks = chunks_from(
        translator,
        [(None, {"type": "response.reasoning_summary_text.delta", "delta": "Scattering"})],
    )
    assert chunks[0]["choices"][0]["delta"] == {"reasoning_content": "Scattering"}
