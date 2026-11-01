"""Translating adapter for ``POST {base_url}/responses``."""

from app.protocols.adapter_base import ProtocolAdapter, StreamTranslator
from app.protocols.message_content import copy_if_present
from app.protocols.openai_chat_completions.wire_format import build_openai_headers
from app.protocols.openai_responses.request_translation import (
    convert_messages,
    convert_response_format,
    convert_tools,
)
from app.protocols.openai_responses.response_translation import finish_reason_for, parse_responses_usage
from app.protocols.openai_responses.stream_translation import ResponsesStreamTranslator
from app.protocols.types import JsonObject, PreparedUpstreamRequest, TokenUsage, UpstreamTarget


class OpenAIResponsesAdapter(ProtocolAdapter):
    """Translating adapter for ``POST {base_url}/responses``."""

    api_protocol = "openai_responses"

    def build_request(self, chat_request: JsonObject, target: UpstreamTarget) -> PreparedUpstreamRequest:
        """Translate the Chat Completions body to a Responses body."""
        instructions, input_items = convert_messages(chat_request["messages"])
        upstream_body: JsonObject = {"model": target.model_id, "input": input_items, "store": False}
        if instructions:
            upstream_body["instructions"] = instructions
        if chat_request.get("stream"):
            upstream_body["stream"] = True
        max_output_tokens = (
            chat_request.get("max_completion_tokens")
            or chat_request.get("max_tokens")
            or target.default_max_output_tokens
        )
        if max_output_tokens:
            upstream_body["max_output_tokens"] = max_output_tokens
        copy_if_present(chat_request, upstream_body, "temperature", "temperature")
        copy_if_present(chat_request, upstream_body, "top_p", "top_p")
        copy_if_present(chat_request, upstream_body, "parallel_tool_calls", "parallel_tool_calls")
        copy_if_present(chat_request, upstream_body, "user", "user")
        copy_if_present(chat_request, upstream_body, "metadata", "metadata")
        if chat_request.get("reasoning_effort"):
            # "auto" summaries are what the gateway streams back as ``reasoning_content``.
            upstream_body["reasoning"] = {"effort": chat_request["reasoning_effort"], "summary": "auto"}
        if chat_request.get("tools"):
            upstream_body["tools"] = convert_tools(chat_request["tools"])
        tool_choice = chat_request.get("tool_choice")
        if isinstance(tool_choice, str):
            upstream_body["tool_choice"] = tool_choice
        elif isinstance(tool_choice, dict) and isinstance(tool_choice.get("function"), dict):
            upstream_body["tool_choice"] = {"type": "function", "name": tool_choice["function"].get("name")}
        text_format = convert_response_format(chat_request.get("response_format"))
        if text_format is not None:
            upstream_body["text"] = {"format": text_format}
        return PreparedUpstreamRequest(
            url=target.endpoint_url("responses"),
            headers=build_openai_headers(target),
            json_body=upstream_body,
        )

    def translate_response(
        self, upstream_body: JsonObject, target: UpstreamTarget, completion_id: str, created_unix_seconds: int
    ) -> tuple[JsonObject, TokenUsage]:
        """Build a ``chat.completion`` from Responses output items."""
        text_parts: list[str] = []
        reasoning_parts: list[str] = []
        tool_calls: list[JsonObject] = []
        for output_item in upstream_body.get("output") or []:
            item_type = output_item.get("type")
            if item_type == "message":
                text_parts.extend(
                    str(content_part.get("text", ""))
                    for content_part in output_item.get("content") or []
                    if content_part.get("type") == "output_text"
                )
            elif item_type == "reasoning":
                reasoning_parts.extend(
                    str(summary_part.get("text", "")) for summary_part in output_item.get("summary") or []
                )
            elif item_type == "function_call":
                tool_calls.append(
                    {
                        "id": output_item.get("call_id"),
                        "type": "function",
                        "function": {
                            "name": output_item.get("name"),
                            "arguments": output_item.get("arguments", ""),
                        },
                    }
                )
        assistant_message: JsonObject = {"role": "assistant", "content": "".join(text_parts) or None}
        if reasoning_parts:
            assistant_message["reasoning_content"] = "".join(reasoning_parts)
        if tool_calls:
            assistant_message["tool_calls"] = tool_calls
        token_usage = parse_responses_usage(upstream_body.get("usage"))
        chat_completion: JsonObject = {
            "id": completion_id,
            "object": "chat.completion",
            "created": created_unix_seconds,
            "model": upstream_body.get("model", target.model_id),
            "choices": [
                {
                    "index": 0,
                    "message": assistant_message,
                    "finish_reason": finish_reason_for(upstream_body, bool(tool_calls)),
                }
            ],
            "usage": token_usage.to_chat_completions_usage(),
        }
        return chat_completion, token_usage

    def create_stream_translator(
        self, target: UpstreamTarget, completion_id: str, created_unix_seconds: int, client_wants_usage: bool
    ) -> StreamTranslator:
        """Create a Responses -> Chat Completions chunk translator."""
        return ResponsesStreamTranslator(
            completion_id, created_unix_seconds, target.model_id, client_wants_usage
        )

    def build_models_list_request(self, target: UpstreamTarget) -> tuple[str, dict[str, str]]:
        """``GET {base_url}/models`` with bearer auth."""
        return target.endpoint_url("models"), build_openai_headers(target)
