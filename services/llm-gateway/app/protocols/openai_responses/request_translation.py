"""Chat Completions request -> OpenAI Responses request.

* ``system``/``developer`` messages become ``instructions``.
* User/assistant messages become ``message`` input items; assistant ``tool_calls``
  become ``function_call`` items and ``tool`` messages ``function_call_output`` items.
* ``response_format`` maps to ``text.format``; ``reasoning_effort`` to ``reasoning.effort``
  with ``summary: "auto"`` so reasoning summaries can be streamed back.
* ``store`` is always ``false``: the gateway is stateless and keeps no conversation
  state on the provider's side.
"""

from app.core.errors import UnsupportedFeatureError
from app.protocols.message_content import copy_if_present, message_content_as_text
from app.protocols.types import JsonObject


def _convert_user_content(content: object) -> list[JsonObject]:
    if isinstance(content, str):
        return [{"type": "input_text", "text": content}]
    if not isinstance(content, list):
        return [{"type": "input_text", "text": message_content_as_text(content)}]
    input_parts: list[JsonObject] = []
    for content_part in content:
        if not isinstance(content_part, dict):
            continue
        part_type = content_part.get("type")
        if part_type == "text":
            input_parts.append({"type": "input_text", "text": str(content_part.get("text", ""))})
        elif part_type == "image_url":
            image_url_value = content_part.get("image_url")
            image_part: JsonObject = {"type": "input_image"}
            if isinstance(image_url_value, dict):
                image_part["image_url"] = image_url_value.get("url")
                copy_if_present(image_url_value, image_part, "detail", "detail")
            else:
                image_part["image_url"] = image_url_value
            input_parts.append(image_part)
        else:
            raise UnsupportedFeatureError(f"Content part type '{part_type}' is not supported by this model")
    return input_parts


def convert_messages(chat_messages: list[JsonObject]) -> tuple[str | None, list[JsonObject]]:
    """Return ``(instructions, input_items)`` for a Responses request."""
    instruction_parts: list[str] = []
    input_items: list[JsonObject] = []
    for message in chat_messages:
        role = message.get("role")
        if role in {"system", "developer"}:
            instruction_parts.append(message_content_as_text(message.get("content")))
        elif role == "user":
            input_items.append(
                {"type": "message", "role": "user", "content": _convert_user_content(message.get("content"))}
            )
        elif role == "assistant":
            assistant_text = message_content_as_text(message.get("content"))
            if assistant_text:
                input_items.append(
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": assistant_text}],
                    }
                )
            for tool_call in message.get("tool_calls") or []:
                function_call = tool_call.get("function") or {}
                input_items.append(
                    {
                        "type": "function_call",
                        "call_id": tool_call.get("id"),
                        "name": function_call.get("name"),
                        "arguments": function_call.get("arguments") or "{}",
                    }
                )
        elif role == "tool":
            input_items.append(
                {
                    "type": "function_call_output",
                    "call_id": message.get("tool_call_id"),
                    "output": message_content_as_text(message.get("content")),
                }
            )
        else:
            raise UnsupportedFeatureError(f"Message role '{role}' is not supported")
    instructions = "\n\n".join(part for part in instruction_parts if part) or None
    return instructions, input_items


def convert_tools(chat_tools: list[JsonObject]) -> list[JsonObject]:
    """Chat nested function tools -> Responses flat function tools."""
    response_tools: list[JsonObject] = []
    for chat_tool in chat_tools:
        if chat_tool.get("type") != "function":
            raise UnsupportedFeatureError(
                f"Tool type '{chat_tool.get('type')}' is not supported by this model"
            )
        function_definition = chat_tool.get("function") or {}
        response_tool: JsonObject = {"type": "function", "name": function_definition.get("name")}
        copy_if_present(function_definition, response_tool, "description", "description")
        copy_if_present(function_definition, response_tool, "parameters", "parameters")
        copy_if_present(function_definition, response_tool, "strict", "strict")
        response_tools.append(response_tool)
    return response_tools


def convert_response_format(response_format: object) -> JsonObject | None:
    """Chat ``response_format`` -> Responses ``text.format``."""
    if not isinstance(response_format, dict) or response_format.get("type") in (None, "text"):
        return None
    if response_format["type"] == "json_object":
        return {"type": "json_object"}
    if response_format["type"] == "json_schema":
        json_schema = response_format.get("json_schema") or {}
        text_format: JsonObject = {"type": "json_schema", "name": json_schema.get("name", "response")}
        copy_if_present(json_schema, text_format, "schema", "schema")
        copy_if_present(json_schema, text_format, "strict", "strict")
        copy_if_present(json_schema, text_format, "description", "description")
        return text_format
    raise UnsupportedFeatureError(f"response_format type '{response_format['type']}' is not supported")
