"""Anthropic Messages response -> Chat Completions response (content blocks, stop reason, usage)."""

from app.protocols.message_content import optional_int
from app.protocols.types import TokenUsage

STOP_REASON_TO_FINISH_REASON = {
    "end_turn": "stop",
    "stop_sequence": "stop",
    "pause_turn": "stop",
    "max_tokens": "length",
    "model_context_window_exceeded": "length",
    "tool_use": "tool_calls",
    "refusal": "content_filter",
}


def parse_anthropic_usage(usage: object, existing_usage: TokenUsage | None = None) -> TokenUsage:
    """Convert Anthropic usage. Input tokens include cache reads and cache writes."""
    token_usage = existing_usage or TokenUsage()
    if not isinstance(usage, dict):
        return token_usage
    uncached_input_tokens = optional_int(usage.get("input_tokens"))
    cache_read_tokens = optional_int(usage.get("cache_read_input_tokens"))
    cache_write_tokens = optional_int(usage.get("cache_creation_input_tokens"))
    if uncached_input_tokens is not None:
        token_usage.input_tokens = (
            uncached_input_tokens + (cache_read_tokens or 0) + (cache_write_tokens or 0)
        )
    if cache_read_tokens is not None:
        token_usage.cached_input_tokens = cache_read_tokens
    output_tokens = optional_int(usage.get("output_tokens"))
    if output_tokens is not None:
        token_usage.output_tokens = output_tokens
    return token_usage
