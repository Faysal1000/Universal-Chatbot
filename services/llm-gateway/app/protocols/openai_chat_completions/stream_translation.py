"""Chat Completions streams pass through (almost) verbatim.

Each chunk is checked for the first generated output (time to first token) and for
the final ``usage`` chunk, which the gateway always requests upstream but forwards
only when the caller asked for it. Two rewrites put reasoning in one field for callers:
``delta.reasoning`` becomes ``delta.reasoning_content``, and so does a leading
``<thought>`` block streamed inside ``delta.content``.
"""

import json
from typing import Any

from app.protocols.adapter_base import StreamTranslationResult, StreamTranslator
from app.protocols.openai_chat_completions.inline_thoughts import InlineThoughtSplitter
from app.protocols.openai_chat_completions.wire_format import (
    normalise_reasoning_field,
    parse_chat_completions_usage,
)
from app.protocols.server_sent_events import ServerSentEvent, parse_event_json

STREAM_TERMINATOR = "[DONE]"


def _delta_contains_output(delta: Any) -> bool:
    if not isinstance(delta, dict):
        return False
    return bool(
        delta.get("content")
        or delta.get("reasoning_content")
        or delta.get("reasoning")
        or delta.get("tool_calls")
    )


class ChatCompletionsStreamTranslator(StreamTranslator):
    """Forwards provider chunks, noting usage and first output and moving leading thoughts to reasoning."""

    def __init__(
        self, completion_id: str, created_unix_seconds: int, model_name: str, client_wants_usage: bool
    ) -> None:
        super().__init__(completion_id, created_unix_seconds, model_name)
        self._client_wants_usage = client_wants_usage
        self._thought_splitters: dict[int, InlineThoughtSplitter] = {}

    def translate_event(self, event: ServerSentEvent) -> StreamTranslationResult:
        """Pass the event through, dropping the usage-only chunk if the caller did not ask for it."""
        if event.data.strip() == STREAM_TERMINATOR:
            self.finished = True
            return StreamTranslationResult(client_payloads=self._flush_thought_splitters())
        chunk = parse_event_json(event)
        if isinstance(chunk.get("error"), dict):
            error_details = chunk["error"]
            return StreamTranslationResult(
                client_payloads=[
                    self.build_error_payload(
                        str(
                            error_details.get("code") or error_details.get("type") or "upstream_stream_error"
                        ),
                        str(error_details.get("message", "Provider reported a stream error")),
                    )
                ]
            )
        if chunk.get("usage"):
            self.usage = parse_chat_completions_usage(chunk["usage"])
        choices = chunk.get("choices")
        is_usage_only_chunk = isinstance(choices, list) and not choices and "usage" in chunk
        if is_usage_only_chunk and not self._client_wants_usage:
            return StreamTranslationResult()
        contains_output_token = isinstance(choices, list) and any(
            _delta_contains_output(choice.get("delta")) for choice in choices if isinstance(choice, dict)
        )
        is_rewritten = normalise_reasoning_field(chunk, "delta")
        if isinstance(choices, list):
            rewritten_choices = [self._split_inline_thoughts(choice) for choice in choices]
            is_rewritten = is_rewritten or any(rewritten_choices)
        client_payload = json.dumps(chunk) if is_rewritten else event.data
        return StreamTranslationResult(
            client_payloads=[client_payload], contains_output_token=contains_output_token
        )

    def _split_inline_thoughts(self, choice: Any) -> bool:
        """Route this choice's content through its splitter; returns whether the delta changed.

        The last chunk often carries only ``finish_reason``, so the splitter is flushed there
        even without content.
        """
        if not isinstance(choice, dict) or not isinstance(choice.get("delta"), dict):
            return False
        delta = choice["delta"]
        content = delta.get("content")
        has_content = isinstance(content, str)
        is_last_chunk = bool(choice.get("finish_reason"))
        if not has_content and not is_last_chunk:
            return False
        splitter = self._thought_splitters.setdefault(int(choice.get("index") or 0), InlineThoughtSplitter())
        reasoning, answer = splitter.split(content) if has_content else ("", "")
        if is_last_chunk:
            remaining_reasoning, remaining_answer = splitter.flush()
            reasoning, answer = reasoning + remaining_reasoning, answer + remaining_answer
        if not reasoning and answer == (content if has_content else ""):
            return False
        if has_content or answer:
            delta["content"] = answer
        if reasoning:
            delta["reasoning_content"] = str(delta.get("reasoning_content") or "") + reasoning
        return True

    def _flush_thought_splitters(self) -> list[str]:
        """Chunks for text still held back when a stream ends without a ``finish_reason``."""
        payloads = []
        for splitter in self._thought_splitters.values():
            reasoning, answer = splitter.flush()
            fields = (("reasoning_content", reasoning), ("content", answer))
            delta = {key: text for key, text in fields if text}
            if delta:
                payloads.append(self.build_chunk(delta))
        return payloads
