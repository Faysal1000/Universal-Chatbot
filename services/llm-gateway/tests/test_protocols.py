"""Protocol translation: Chat Completions <-> Anthropic Messages / OpenAI Responses."""

import json
from collections.abc import AsyncIterator
from typing import Any

import pytest

from app.core.errors import UnsupportedFeatureError, UpstreamProtocolError
from app.protocols.adapter_base import StreamTranslator
from app.protocols.registry import adapter_for
from app.protocols.server_sent_events import ServerSentEvent, iterate_server_sent_events
from app.protocols.types import UpstreamTarget


def make_target(api_protocol: str, **overrides: object) -> UpstreamTarget:
    target_values: dict[str, object] = {
        "provider_id": "provider",
        "provider_display_name": "Provider",
        "base_url": "https://api.example.com/v1/",
        "api_protocol": api_protocol,
        "api_key": "sk-secret",
        "extra_headers": {"X-Org": "org-1"},
        "request_timeout_seconds": 30.0,
        "max_concurrent_requests": 4,
        "model_pk": 1,
        "model_id": "real-model",
        **overrides,
    }
    return UpstreamTarget(**target_values)  # type: ignore[arg-type]


def chunks_from(
    translator: StreamTranslator, events: list[tuple[str | None, dict[str, object]]]
) -> list[dict[str, Any]]:
    payloads: list[str] = []
    for event_name, event_body in events:
        payloads.extend(
            translator.translate_event(ServerSentEvent(event_name, json.dumps(event_body))).client_payloads
        )
    return [json.loads(payload) for payload in payloads]


TOOL_CONVERSATION = [
    {"role": "system", "content": "You are helpful."},
    {"role": "developer", "content": [{"type": "text", "text": "Cite sources."}]},
    {"role": "user", "content": "Weather in Paris?"},
    {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": "call_1",
                "type": "function",
                "function": {"name": "get_weather", "arguments": '{"city":"Paris"}'},
            }
        ],
    },
    {"role": "tool", "tool_call_id": "call_1", "content": "18C, sunny"},
    {
        "role": "user",
        "content": [
            {"type": "text", "text": "Thanks! And this?"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,QUJD"}},
        ],
    },
]
WEATHER_TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Weather lookup",
        "parameters": {"type": "object", "properties": {"city": {"type": "string"}}},
    },
}


# ----- OpenAI Chat Completions (pass-through) -----


def test_chat_completions_passthrough_rewrites_model_and_forces_stream_usage() -> None:
    prepared = adapter_for("openai_chat_completions").build_request(
        {
            "model": "answer_generation",
            "messages": [{"role": "user", "content": "hi"}],
            "stream": True,
            "temperature": 0.2,
        },
        make_target("openai_chat_completions"),
    )
    assert prepared.url == "https://api.example.com/v1/chat/completions"
    assert prepared.json_body["model"] == "real-model"
    assert prepared.json_body["stream_options"] == {"include_usage": True}
    assert prepared.json_body["temperature"] == 0.2
    assert prepared.headers["Authorization"] == "Bearer sk-secret"
    assert prepared.headers["X-Org"] == "org-1"


def test_chat_completions_stream_drops_usage_chunk_unless_caller_asked() -> None:
    adapter = adapter_for("openai_chat_completions")
    usage_event = ServerSentEvent(
        None, json.dumps({"choices": [], "usage": {"prompt_tokens": 5, "completion_tokens": 7}})
    )
    silent_translator = adapter.create_stream_translator(
        make_target("openai_chat_completions"), "id", 0, False
    )
    assert silent_translator.translate_event(usage_event).client_payloads == []
    assert silent_translator.usage.output_tokens == 7
    verbose_translator = adapter.create_stream_translator(
        make_target("openai_chat_completions"), "id", 0, True
    )
    assert len(verbose_translator.translate_event(usage_event).client_payloads) == 1


def test_chat_completions_usage_reads_deepseek_cache_hits() -> None:
    _, token_usage = adapter_for("openai_chat_completions").translate_response(
        {
            "choices": [],
            "usage": {"prompt_tokens": 100, "completion_tokens": 10, "prompt_cache_hit_tokens": 60},
        },
        make_target("openai_chat_completions"),
        "id",
        0,
    )
    assert (token_usage.input_tokens, token_usage.cached_input_tokens, token_usage.output_tokens) == (
        100,
        60,
        10,
    )


def test_chat_completions_usage_derives_output_from_total_when_missing() -> None:
    _, token_usage = adapter_for("openai_chat_completions").translate_response(
        {"choices": [], "usage": {"prompt_tokens": 2060, "total_tokens": 3084}},
        make_target("openai_chat_completions"),
        "id",
        0,
    )
    assert (token_usage.input_tokens, token_usage.output_tokens) == (2060, 1024)


# ----- Anthropic Messages -----


def test_anthropic_request_translation_covers_system_tools_images_and_tool_results() -> None:
    prepared = adapter_for("anthropic_messages").build_request(
        {
            "model": "answer_generation",
            "messages": TOOL_CONVERSATION,
            "tools": [WEATHER_TOOL],
            "tool_choice": "required",
            "parallel_tool_calls": False,
            "stop": "END",
            "max_completion_tokens": 300,
        },
        make_target("anthropic_messages"),
    )
    body = prepared.json_body
    assert prepared.url == "https://api.example.com/v1/messages"
    assert prepared.headers["x-api-key"] == "sk-secret"
    assert prepared.headers["anthropic-version"] == "2023-06-01"
    assert body["system"] == "You are helpful.\n\nCite sources."
    assert body["max_tokens"] == 300
    assert body["stop_sequences"] == ["END"]
    assert body["tools"] == [
        {
            "name": "get_weather",
            "description": "Weather lookup",
            "input_schema": {"type": "object", "properties": {"city": {"type": "string"}}},
        }
    ]
    assert body["tool_choice"] == {"type": "any", "disable_parallel_tool_use": True}
    roles = [message["role"] for message in body["messages"]]
    assert roles == ["user", "assistant", "user"], "tool result and next user turn must merge"
    assert body["messages"][1]["content"] == [
        {"type": "tool_use", "id": "call_1", "name": "get_weather", "input": {"city": "Paris"}}
    ]
    merged_user_turn = body["messages"][2]["content"]
    assert merged_user_turn[0] == {"type": "tool_result", "tool_use_id": "call_1", "content": "18C, sunny"}
    assert merged_user_turn[2] == {
        "type": "image",
        "source": {"type": "base64", "media_type": "image/png", "data": "QUJD"},
    }


def test_anthropic_request_uses_model_default_then_fallback_max_tokens() -> None:
    adapter = adapter_for("anthropic_messages")
    request_body = {"messages": [{"role": "user", "content": "hi"}]}
    assert (
        adapter.build_request(request_body, make_target("anthropic_messages")).json_body["max_tokens"] == 4096
    )
    configured_target = make_target("anthropic_messages", default_max_output_tokens=777)
    assert adapter.build_request(request_body, configured_target).json_body["max_tokens"] == 777


def test_anthropic_rejects_response_format_instead_of_ignoring_it() -> None:
    with pytest.raises(UnsupportedFeatureError):
        adapter_for("anthropic_messages").build_request(
            {"messages": [{"role": "user", "content": "hi"}], "response_format": {"type": "json_object"}},
            make_target("anthropic_messages"),
        )


def test_anthropic_response_translation_with_tool_use_and_cache_usage() -> None:
    chat_completion, token_usage = adapter_for("anthropic_messages").translate_response(
        {
            "model": "claude-x",
            "content": [
                {"type": "thinking", "thinking": "hmm"},
                {"type": "text", "text": "Checking."},
                {"type": "tool_use", "id": "toolu_1", "name": "get_weather", "input": {"city": "Paris"}},
            ],
            "stop_reason": "tool_use",
            "usage": {
                "input_tokens": 10,
                "cache_read_input_tokens": 30,
                "cache_creation_input_tokens": 5,
                "output_tokens": 8,
            },
        },
        make_target("anthropic_messages"),
        "chatcmpl-1",
        123,
    )
    choice = chat_completion["choices"][0]
    assert choice["finish_reason"] == "tool_calls"
    assert choice["message"]["content"] == "Checking."
    assert choice["message"]["reasoning_content"] == "hmm"
    assert choice["message"]["tool_calls"][0]["function"] == {
        "name": "get_weather",
        "arguments": '{"city": "Paris"}',
    }
    assert (token_usage.input_tokens, token_usage.cached_input_tokens, token_usage.output_tokens) == (
        45,
        30,
        8,
    )
    assert chat_completion["usage"]["prompt_tokens"] == 45


def test_anthropic_stream_translation_text_tools_usage_and_finish() -> None:
    translator = adapter_for("anthropic_messages").create_stream_translator(
        make_target("anthropic_messages"), "chatcmpl-1", 1, True
    )
    chunks = chunks_from(
        translator,
        [
            (
                "message_start",
                {"type": "message_start", "message": {"usage": {"input_tokens": 9, "output_tokens": 1}}},
            ),
            ("ping", {"type": "ping"}),
            (
                "content_block_start",
                {"type": "content_block_start", "index": 0, "content_block": {"type": "text"}},
            ),
            (
                "content_block_delta",
                {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hi"}},
            ),
            (
                "content_block_start",
                {
                    "type": "content_block_start",
                    "index": 1,
                    "content_block": {"type": "tool_use", "id": "t1", "name": "f"},
                },
            ),
            (
                "content_block_delta",
                {
                    "type": "content_block_delta",
                    "index": 1,
                    "delta": {"type": "input_json_delta", "partial_json": "{}"},
                },
            ),
            (
                "message_delta",
                {
                    "type": "message_delta",
                    "delta": {"stop_reason": "tool_use"},
                    "usage": {"output_tokens": 6},
                },
            ),
            ("message_stop", {"type": "message_stop"}),
        ],
    )
    assert chunks[0]["choices"][0]["delta"] == {"role": "assistant", "content": ""}
    assert chunks[1]["choices"][0]["delta"] == {"content": "Hi"}
    assert chunks[2]["choices"][0]["delta"]["tool_calls"][0]["id"] == "t1"
    assert chunks[3]["choices"][0]["delta"]["tool_calls"][0] == {"index": 0, "function": {"arguments": "{}"}}
    assert chunks[4]["choices"][0]["finish_reason"] == "tool_calls"
    assert chunks[5]["usage"]["completion_tokens"] == 6
    assert translator.finished
    assert (translator.usage.input_tokens, translator.usage.output_tokens) == (9, 6)


def test_anthropic_stream_error_event_is_reported() -> None:
    translator = adapter_for("anthropic_messages").create_stream_translator(
        make_target("anthropic_messages"), "c", 1, False
    )
    chunks = chunks_from(
        translator,
        [("error", {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}})],
    )
    assert chunks[0]["error"]["code"] == "overloaded_error"
    assert translator.in_stream_error is not None


# ----- OpenAI Responses -----


def test_responses_request_translation() -> None:
    prepared = adapter_for("openai_responses").build_request(
        {
            "model": "answer_generation",
            "messages": TOOL_CONVERSATION,
            "tools": [WEATHER_TOOL],
            "tool_choice": {"type": "function", "function": {"name": "get_weather"}},
            "max_tokens": 50,
            "reasoning_effort": "low",
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "answer_generation", "schema": {"type": "object"}},
            },
        },
        make_target("openai_responses"),
    )
    body = prepared.json_body
    assert prepared.url == "https://api.example.com/v1/responses"
    assert body["store"] is False
    assert body["instructions"] == "You are helpful.\n\nCite sources."
    assert body["max_output_tokens"] == 50
    assert body["reasoning"] == {"effort": "low", "summary": "auto"}
    assert body["tool_choice"] == {"type": "function", "name": "get_weather"}
    assert body["text"] == {
        "format": {"type": "json_schema", "name": "answer_generation", "schema": {"type": "object"}}
    }
    assert body["tools"][0]["name"] == "get_weather"
    item_types = [item["type"] for item in body["input"]]
    assert item_types == ["message", "function_call", "function_call_output", "message"]
    assert body["input"][3]["content"][1] == {
        "type": "input_image",
        "image_url": "data:image/png;base64,QUJD",
    }


def test_responses_response_translation_with_function_call() -> None:
    chat_completion, token_usage = adapter_for("openai_responses").translate_response(
        {
            "status": "completed",
            "output": [
                {"type": "function_call", "call_id": "call_9", "name": "f", "arguments": "{}"},
            ],
            "usage": {
                "input_tokens": 3,
                "output_tokens": 2,
                "output_tokens_details": {"reasoning_tokens": 1},
            },
        },
        make_target("openai_responses"),
        "c",
        1,
    )
    assert chat_completion["choices"][0]["finish_reason"] == "tool_calls"
    assert chat_completion["choices"][0]["message"]["tool_calls"][0]["id"] == "call_9"
    assert token_usage.reasoning_tokens == 1


def test_responses_incomplete_maps_to_length() -> None:
    chat_completion, _ = adapter_for("openai_responses").translate_response(
        {"status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}, "output": []},
        make_target("openai_responses"),
        "c",
        1,
    )
    assert chat_completion["choices"][0]["finish_reason"] == "length"


def test_responses_stream_translation() -> None:
    translator = adapter_for("openai_responses").create_stream_translator(
        make_target("openai_responses"), "c", 1, True
    )
    chunks = chunks_from(
        translator,
        [
            (None, {"type": "response.created"}),
            (None, {"type": "response.output_text.delta", "delta": "Hel"}),
            (
                None,
                {
                    "type": "response.output_item.added",
                    "item": {"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "f"},
                },
            ),
            (None, {"type": "response.function_call_arguments.delta", "item_id": "fc_1", "delta": "{}"}),
            (
                None,
                {
                    "type": "response.completed",
                    "response": {"status": "completed", "usage": {"input_tokens": 4, "output_tokens": 3}},
                },
            ),
        ],
    )
    assert chunks[1]["choices"][0]["delta"] == {"content": "Hel"}
    assert chunks[2]["choices"][0]["delta"]["tool_calls"][0]["id"] == "call_1"
    assert chunks[3]["choices"][0]["delta"]["tool_calls"][0]["function"]["arguments"] == "{}"
    assert chunks[4]["choices"][0]["finish_reason"] == "tool_calls"
    assert chunks[5]["usage"] == {"prompt_tokens": 4, "completion_tokens": 3, "total_tokens": 7}
    assert translator.finished


# ----- SSE parsing and error extraction -----


async def test_sse_parser_handles_multiline_data_comments_and_event_names() -> None:
    async def lines() -> AsyncIterator[str]:
        for line in [
            ": keep-alive",
            "event: message_start",
            'data: {"a":',
            "data: 1}",
            "",
            "data: [DONE]",
            "",
        ]:
            yield line

    events = [event async for event in iterate_server_sent_events(lines())]
    assert events == [ServerSentEvent("message_start", '{"a":\n1}'), ServerSentEvent(None, "[DONE]")]


def test_malformed_stream_event_raises_protocol_error() -> None:
    translator = adapter_for("anthropic_messages").create_stream_translator(
        make_target("anthropic_messages"), "c", 1, False
    )
    with pytest.raises(UpstreamProtocolError):
        translator.translate_event(ServerSentEvent(None, "not json"))


@pytest.mark.parametrize(
    ("error_body", "expected_message"),
    [
        ('{"error": {"message": "bad key"}}', "bad key"),
        ('{"type": "error", "error": {"type": "x", "message": "overloaded"}}', "overloaded"),
        ('{"detail": "nope"}', "nope"),
        ("<html>502</html>", "<html>502</html>"),
    ],
)
def test_error_message_extraction(error_body: str, expected_message: str) -> None:
    assert adapter_for("openai_chat_completions").extract_error_message(error_body) == expected_message
