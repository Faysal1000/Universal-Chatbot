"""Translating adapter for ``POST {base_url}/messages``."""

import json
from typing import Any

from app.core.errors import UnsupportedFeatureError
from app.protocols.adapter_base import ProtocolAdapter, StreamTranslator
from app.protocols.anthropic_messages.request_translation import (
    FALLBACK_MAX_OUTPUT_TOKENS,
    build_anthropic_headers,
    convert_messages,
    convert_tool_choice,
    convert_tools,
    thinking_budget_tokens,
)
from app.protocols.anthropic_messages.response_translation import (
    STOP_REASON_TO_FINISH_REASON,
    parse_anthropic_usage,
)
from app.protocols.anthropic_messages.stream_translation import AnthropicStreamTranslator
from app.protocols.message_content import copy_if_present
from app.protocols.types import JsonObject, PreparedUpstreamRequest, TokenUsage, UpstreamTarget


class AnthropicMessagesAdapter(ProtocolAdapter):
    """Translating adapter for ``POST {base_url}/messages``."""

    api_protocol = "anthropic_messages"

    def build_request(self, chat_request: JsonObject, target: UpstreamTarget) -> PreparedUpstreamRequest:
        """Translate the Chat Completions body to a Messages body."""
        if chat_request.get("response_format") not in (None, {"type": "text"}):
            raise UnsupportedFeatureError("response_format is not supported by Anthropic Messages models")
        system_prompt, anthropic_messages = convert_messages(chat_request["messages"])
        max_output_tokens = (
            chat_request.get("max_completion_tokens")
            or chat_request.get("max_tokens")
            or target.default_max_output_tokens
            or FALLBACK_MAX_OUTPUT_TOKENS
        )
        upstream_body: JsonObject = {
            "model": target.model_id,
            "messages": anthropic_messages,
            "max_tokens": max_output_tokens,
        }
        if system_prompt:
            upstream_body["system"] = system_prompt
        if chat_request.get("stream"):
            upstream_body["stream"] = True
        thinking_budget = thinking_budget_tokens(chat_request.get("reasoning_effort"))
        if thinking_budget is not None:
            upstream_body["thinking"] = {"type": "enabled", "budget_tokens": thinking_budget}
            upstream_body["max_tokens"] = max_output_tokens + thinking_budget
        else:
            copy_if_present(chat_request, upstream_body, "temperature", "temperature")
            copy_if_present(chat_request, upstream_body, "top_p", "top_p")
        stop_sequences: Any = chat_request.get("stop")
        if stop_sequences:
            upstream_body["stop_sequences"] = (
                [stop_sequences] if isinstance(stop_sequences, str) else stop_sequences
            )
        if chat_request.get("tools"):
            upstream_body["tools"] = convert_tools(chat_request["tools"])
        anthropic_tool_choice = convert_tool_choice(
            chat_request.get("tool_choice"), chat_request.get("parallel_tool_calls")
        )
        if anthropic_tool_choice is not None and "tools" in upstream_body:
            upstream_body["tool_choice"] = anthropic_tool_choice
        if isinstance(chat_request.get("user"), str):
            upstream_body["metadata"] = {"user_id": chat_request["user"]}
        return PreparedUpstreamRequest(
            url=target.endpoint_url("messages"),
            headers=build_anthropic_headers(target),
            json_body=upstream_body,
        )

    def translate_response(
        self, upstream_body: JsonObject, target: UpstreamTarget, completion_id: str, created_unix_seconds: int
    ) -> tuple[JsonObject, TokenUsage]:
        """Build a ``chat.completion`` from Messages content blocks."""
        text_parts: list[str] = []
        reasoning_parts: list[str] = []
        tool_calls: list[JsonObject] = []
        for content_block in upstream_body.get("content") or []:
            block_type = content_block.get("type")
            if block_type == "text":
                text_parts.append(str(content_block.get("text", "")))
            elif block_type == "thinking":
                reasoning_parts.append(str(content_block.get("thinking", "")))
            elif block_type == "tool_use":
                tool_calls.append(
                    {
                        "id": content_block.get("id"),
                        "type": "function",
                        "function": {
                            "name": content_block.get("name"),
                            "arguments": json.dumps(content_block.get("input") or {}),
                        },
                    }
                )
        assistant_message: JsonObject = {"role": "assistant", "content": "".join(text_parts) or None}
        if reasoning_parts:
            assistant_message["reasoning_content"] = "".join(reasoning_parts)
        if tool_calls:
            assistant_message["tool_calls"] = tool_calls
        token_usage = parse_anthropic_usage(upstream_body.get("usage"))
        chat_completion: JsonObject = {
            "id": completion_id,
            "object": "chat.completion",
            "created": created_unix_seconds,
            "model": upstream_body.get("model", target.model_id),
            "choices": [
                {
                    "index": 0,
                    "message": assistant_message,
                    "finish_reason": STOP_REASON_TO_FINISH_REASON.get(
                        str(upstream_body.get("stop_reason")), "stop"
                    ),
                }
            ],
            "usage": token_usage.to_chat_completions_usage(),
        }
        return chat_completion, token_usage

    def create_stream_translator(
        self, target: UpstreamTarget, completion_id: str, created_unix_seconds: int, client_wants_usage: bool
    ) -> StreamTranslator:
        """Create a Messages -> Chat Completions chunk translator."""
        return AnthropicStreamTranslator(
            completion_id, created_unix_seconds, target.model_id, client_wants_usage
        )

    def build_models_list_request(self, target: UpstreamTarget) -> tuple[str, dict[str, str]]:
        """``GET {base_url}/models?limit=1000``."""
        return target.endpoint_url("models?limit=1000"), build_anthropic_headers(target)
