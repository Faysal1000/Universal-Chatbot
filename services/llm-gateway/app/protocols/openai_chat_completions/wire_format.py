"""Request headers and usage parsing for the Chat Completions wire format.

Shared with the Responses adapter, which uses the same bearer authentication.
"""

from app.protocols.message_content import optional_int
from app.protocols.types import JsonObject, TokenUsage, UpstreamTarget


def build_openai_headers(target: UpstreamTarget) -> dict[str, str]:
    """Bearer auth plus any provider-specific extra headers (extra headers win)."""
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if target.api_key:
        headers["Authorization"] = f"Bearer {target.api_key}"
    headers.update(target.extra_headers)
    return headers


def parse_chat_completions_usage(usage: object) -> TokenUsage:
    """Read OpenAI usage, including DeepSeek's ``prompt_cache_hit_tokens`` variant."""
    if not isinstance(usage, dict):
        return TokenUsage()
    prompt_details = usage.get("prompt_tokens_details") or {}
    completion_details = usage.get("completion_tokens_details") or {}
    cached_input_tokens = (
        optional_int(prompt_details.get("cached_tokens")) if isinstance(prompt_details, dict) else None
    )
    if cached_input_tokens is None:
        cached_input_tokens = optional_int(usage.get("prompt_cache_hit_tokens"))
    input_tokens = optional_int(usage.get("prompt_tokens"))
    output_tokens = optional_int(usage.get("completion_tokens"))
    total_tokens = optional_int(usage.get("total_tokens"))
    if not output_tokens and input_tokens is not None and total_tokens is not None:
        # Some providers (seen with Gemma on Google AI Studio) report only prompt and total tokens.
        output_tokens = max(0, total_tokens - input_tokens)
    return TokenUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cached_input_tokens=cached_input_tokens,
        reasoning_tokens=(
            optional_int(completion_details.get("reasoning_tokens"))
            if isinstance(completion_details, dict)
            else None
        ),
    )


def normalise_reasoning_field(chat_body: JsonObject, message_key: str) -> bool:
    """Rename ``reasoning`` (OpenRouter, newer vLLM) to ``reasoning_content`` in every choice.

    ``message_key`` is ``"delta"`` for stream chunks and ``"message"`` for full responses.
    Callers then read reasoning from one field whatever the provider. Returns whether
    anything changed, so unchanged stream chunks can still be forwarded byte for byte.
    """
    changed = False
    for choice in chat_body.get("choices") or []:
        message = choice.get(message_key) if isinstance(choice, dict) else None
        if isinstance(message, dict) and isinstance(message.get("reasoning"), str):
            reasoning_text = message.pop("reasoning")
            if not message.get("reasoning_content"):
                message["reasoning_content"] = reasoning_text
            changed = True
    return changed
