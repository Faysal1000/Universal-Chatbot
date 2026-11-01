"""Chat Completions request -> Anthropic Messages request.

* ``system``/``developer`` messages become the top-level ``system`` prompt.
* ``tool`` messages become ``tool_result`` blocks inside a user turn; assistant
  ``tool_calls`` become ``tool_use`` blocks. Consecutive same-role turns are merged.
* ``image_url`` parts become ``image`` blocks (base64 data URLs or plain URLs).
* ``max_tokens`` is required by Anthropic; it falls back to the model's configured
  default, then :data:`FALLBACK_MAX_OUTPUT_TOKENS`.
* ``reasoning_effort`` enables extended thinking with a matching token budget; the
  budget is added on top of ``max_tokens`` so the visible answer keeps its full limit,
  and ``temperature``/``top_p`` are dropped because Anthropic rejects them with thinking.
* Parameters Messages cannot express (``n``, ``logprobs``, ``presence_penalty``...)
  are dropped; ``response_format`` is rejected rather than silently ignored.
"""

import json
import re

from app.core.errors import UnsupportedFeatureError
from app.protocols.message_content import message_content_as_text
from app.protocols.types import JsonObject, UpstreamTarget

ANTHROPIC_API_VERSION = "2023-06-01"
FALLBACK_MAX_OUTPUT_TOKENS = 4096
# Extended-thinking budgets per OpenAI ``reasoning_effort`` (Anthropic's minimum is 1024).
THINKING_BUDGET_TOKENS_BY_EFFORT = {"minimal": 1024, "low": 2048, "medium": 8192, "high": 16384}
_DATA_URL_PATTERN = re.compile(r"^data:(?P<media_type>[\w/+.-]+);base64,(?P<data>.+)$", re.DOTALL)


def build_anthropic_headers(target: UpstreamTarget) -> dict[str, str]:
    """``x-api-key`` auth plus the pinned API version (extra headers win)."""
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "anthropic-version": ANTHROPIC_API_VERSION,
    }
    if target.api_key:
        headers["x-api-key"] = target.api_key
    headers.update(target.extra_headers)
    return headers


def _convert_image_part(image_part: JsonObject) -> JsonObject:
    image_url_value = image_part.get("image_url")
    image_url = image_url_value.get("url") if isinstance(image_url_value, dict) else image_url_value
    if not isinstance(image_url, str) or not image_url:
        raise UnsupportedFeatureError("image_url part has no url")
    data_url_match = _DATA_URL_PATTERN.match(image_url)
    if data_url_match:
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": data_url_match.group("media_type"),
                "data": data_url_match.group("data"),
            },
        }
    return {"type": "image", "source": {"type": "url", "url": image_url}}


def _convert_user_content(content: object) -> list[JsonObject]:
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    if not isinstance(content, list):
        return [{"type": "text", "text": message_content_as_text(content)}]
    content_blocks: list[JsonObject] = []
    for content_part in content:
        if not isinstance(content_part, dict):
            continue
        part_type = content_part.get("type")
        if part_type == "text":
            content_blocks.append({"type": "text", "text": str(content_part.get("text", ""))})
        elif part_type == "image_url":
            content_blocks.append(_convert_image_part(content_part))
        else:
            raise UnsupportedFeatureError(f"Content part type '{part_type}' is not supported by this model")
    return content_blocks


def _parse_tool_arguments(raw_arguments: object) -> object:
    if isinstance(raw_arguments, dict):
        return raw_arguments
    if not raw_arguments:
        return {}
    try:
        return json.loads(str(raw_arguments))
    except ValueError as decode_error:
        raise UnsupportedFeatureError("Assistant tool call arguments are not valid JSON") from decode_error


def _convert_assistant_content(message: JsonObject) -> list[JsonObject]:
    content_blocks: list[JsonObject] = []
    assistant_text = message_content_as_text(message.get("content"))
    if assistant_text:
        content_blocks.append({"type": "text", "text": assistant_text})
    for tool_call in message.get("tool_calls") or []:
        function_call = tool_call.get("function") or {}
        content_blocks.append(
            {
                "type": "tool_use",
                "id": tool_call.get("id"),
                "name": function_call.get("name"),
                "input": _parse_tool_arguments(function_call.get("arguments")),
            }
        )
    return content_blocks


def convert_messages(chat_messages: list[JsonObject]) -> tuple[str | None, list[JsonObject]]:
    """Split out the system prompt and convert the conversation to Anthropic turns."""
    system_prompt_parts: list[str] = []
    anthropic_messages: list[JsonObject] = []

    def append_turn(role: str, content_blocks: list[JsonObject]) -> None:
        if not content_blocks:
            return
        if anthropic_messages and anthropic_messages[-1]["role"] == role:
            anthropic_messages[-1]["content"].extend(content_blocks)
        else:
            anthropic_messages.append({"role": role, "content": content_blocks})

    for message in chat_messages:
        role = message.get("role")
        if role in {"system", "developer"}:
            system_prompt_parts.append(message_content_as_text(message.get("content")))
        elif role == "user":
            append_turn("user", _convert_user_content(message.get("content")))
        elif role == "assistant":
            append_turn("assistant", _convert_assistant_content(message))
        elif role == "tool":
            append_turn(
                "user",
                [
                    {
                        "type": "tool_result",
                        "tool_use_id": message.get("tool_call_id"),
                        "content": message_content_as_text(message.get("content")),
                    }
                ],
            )
        else:
            raise UnsupportedFeatureError(f"Message role '{role}' is not supported")
    system_prompt = "\n\n".join(part for part in system_prompt_parts if part) or None
    return system_prompt, anthropic_messages


def convert_tools(chat_tools: list[JsonObject]) -> list[JsonObject]:
    """Chat ``{"type": "function", "function": {...}}`` tools -> Anthropic tools."""
    anthropic_tools: list[JsonObject] = []
    for chat_tool in chat_tools:
        if chat_tool.get("type") != "function":
            raise UnsupportedFeatureError(
                f"Tool type '{chat_tool.get('type')}' is not supported by this model"
            )
        function_definition = chat_tool.get("function") or {}
        anthropic_tool: JsonObject = {
            "name": function_definition.get("name"),
            "input_schema": function_definition.get("parameters") or {"type": "object", "properties": {}},
        }
        if function_definition.get("description"):
            anthropic_tool["description"] = function_definition["description"]
        anthropic_tools.append(anthropic_tool)
    return anthropic_tools


def convert_tool_choice(tool_choice: object, parallel_tool_calls: object) -> JsonObject | None:
    """Map ``auto``/``none``/``required``/named tool choice to Anthropic's object form."""
    anthropic_tool_choice: JsonObject | None
    if tool_choice is None:
        anthropic_tool_choice = {"type": "auto"} if parallel_tool_calls is False else None
    elif tool_choice == "auto":
        anthropic_tool_choice = {"type": "auto"}
    elif tool_choice == "none":
        anthropic_tool_choice = {"type": "none"}
    elif tool_choice == "required":
        anthropic_tool_choice = {"type": "any"}
    elif isinstance(tool_choice, dict) and isinstance(tool_choice.get("function"), dict):
        anthropic_tool_choice = {"type": "tool", "name": tool_choice["function"].get("name")}
    else:
        raise UnsupportedFeatureError("Unsupported tool_choice value")
    if (
        anthropic_tool_choice is not None
        and parallel_tool_calls is False
        and anthropic_tool_choice["type"] != "none"
    ):
        anthropic_tool_choice["disable_parallel_tool_use"] = True
    return anthropic_tool_choice


def thinking_budget_tokens(reasoning_effort: object) -> int | None:
    """Thinking budget for a ``reasoning_effort`` value, or ``None`` to leave thinking off."""
    if not isinstance(reasoning_effort, str):
        return None
    return THINKING_BUDGET_TOKENS_BY_EFFORT.get(reasoning_effort)
