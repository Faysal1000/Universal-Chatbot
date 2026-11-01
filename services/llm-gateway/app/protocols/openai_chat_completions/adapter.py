"""Pass-through adapter for ``POST {base_url}/chat/completions``.

The inbound format matches, so only the ``model`` field is rewritten (and usage
reporting is forced on streams so metrics always have token counts). Models whose
``reasoning_control`` is ``enable_thinking`` get ``reasoning_effort`` as a chat-template switch.
"""

from app.core.reasoning_control import ENABLE_THINKING_CONTROL
from app.protocols.adapter_base import ProtocolAdapter, StreamTranslator
from app.protocols.openai_chat_completions.inline_thoughts import move_inline_thoughts_to_reasoning
from app.protocols.openai_chat_completions.stream_translation import ChatCompletionsStreamTranslator
from app.protocols.openai_chat_completions.thinking_switch import (
    replace_reasoning_effort_with_thinking_switch,
)
from app.protocols.openai_chat_completions.wire_format import (
    build_openai_headers,
    normalise_reasoning_field,
    parse_chat_completions_usage,
)
from app.protocols.types import JsonObject, PreparedUpstreamRequest, TokenUsage, UpstreamTarget


class OpenAIChatCompletionsAdapter(ProtocolAdapter):
    """Pass-through adapter for ``POST {base_url}/chat/completions``."""

    api_protocol = "openai_chat_completions"

    def build_request(self, chat_request: JsonObject, target: UpstreamTarget) -> PreparedUpstreamRequest:
        """Rewrite ``model`` and force usage reporting on streams."""
        upstream_body = dict(chat_request)
        upstream_body["model"] = target.model_id
        if upstream_body.get("stream"):
            caller_stream_options = upstream_body.get("stream_options")
            upstream_body["stream_options"] = {
                **(caller_stream_options if isinstance(caller_stream_options, dict) else {}),
                "include_usage": True,
            }
        if (
            target.default_max_output_tokens is not None
            and upstream_body.get("max_tokens") is None
            and upstream_body.get("max_completion_tokens") is None
        ):
            upstream_body["max_tokens"] = target.default_max_output_tokens
        if target.reasoning_control == ENABLE_THINKING_CONTROL:
            replace_reasoning_effort_with_thinking_switch(upstream_body)
        return PreparedUpstreamRequest(
            url=target.endpoint_url("chat/completions"),
            headers=build_openai_headers(target),
            json_body=upstream_body,
        )

    def translate_response(
        self, upstream_body: JsonObject, target: UpstreamTarget, completion_id: str, created_unix_seconds: int
    ) -> tuple[JsonObject, TokenUsage]:
        """Return the provider body (already a ``chat.completion``) with reasoning normalised."""
        normalise_reasoning_field(upstream_body, "message")
        for choice in upstream_body.get("choices") or []:
            if isinstance(choice, dict) and isinstance(choice.get("message"), dict):
                move_inline_thoughts_to_reasoning(choice["message"])
        upstream_body.setdefault("id", completion_id)
        upstream_body.setdefault("object", "chat.completion")
        upstream_body.setdefault("created", created_unix_seconds)
        upstream_body.setdefault("model", target.model_id)
        return upstream_body, parse_chat_completions_usage(upstream_body.get("usage"))

    def create_stream_translator(
        self, target: UpstreamTarget, completion_id: str, created_unix_seconds: int, client_wants_usage: bool
    ) -> StreamTranslator:
        """Create a pass-through translator."""
        return ChatCompletionsStreamTranslator(
            completion_id, created_unix_seconds, target.model_id, client_wants_usage
        )

    def build_models_list_request(self, target: UpstreamTarget) -> tuple[str, dict[str, str]]:
        """``GET {base_url}/models`` with bearer auth."""
        return target.endpoint_url("models"), build_openai_headers(target)
