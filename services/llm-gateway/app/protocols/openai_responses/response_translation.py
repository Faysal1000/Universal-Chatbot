"""OpenAI Responses response -> Chat Completions response (output items, status, usage)."""

from app.protocols.message_content import optional_int
from app.protocols.types import JsonObject, TokenUsage


def parse_responses_usage(usage: object) -> TokenUsage:
    """Read Responses usage (``input_tokens`` / ``output_tokens`` with detail objects)."""
    if not isinstance(usage, dict):
        return TokenUsage()
    input_details = usage.get("input_tokens_details") or {}
    output_details = usage.get("output_tokens_details") or {}
    return TokenUsage(
        input_tokens=optional_int(usage.get("input_tokens")),
        output_tokens=optional_int(usage.get("output_tokens")),
        cached_input_tokens=optional_int(input_details.get("cached_tokens"))
        if isinstance(input_details, dict)
        else None,
        reasoning_tokens=(
            optional_int(output_details.get("reasoning_tokens")) if isinstance(output_details, dict) else None
        ),
    )


def finish_reason_for(response_body: JsonObject, has_tool_calls: bool) -> str:
    if response_body.get("status") == "incomplete":
        incomplete_reason = (response_body.get("incomplete_details") or {}).get("reason")
        return "content_filter" if incomplete_reason == "content_filter" else "length"
    return "tool_calls" if has_tool_calls else "stop"
