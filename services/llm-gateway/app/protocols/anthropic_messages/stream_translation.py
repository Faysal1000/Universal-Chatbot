"""Anthropic Messages stream events -> ``chat.completion.chunk`` payloads."""

from app.protocols.adapter_base import StreamTranslationResult, StreamTranslator
from app.protocols.anthropic_messages.response_translation import (
    STOP_REASON_TO_FINISH_REASON,
    parse_anthropic_usage,
)
from app.protocols.server_sent_events import ServerSentEvent, parse_event_json
from app.protocols.types import JsonObject


class AnthropicStreamTranslator(StreamTranslator):
    """Converts Messages stream events into ``chat.completion.chunk`` payloads."""

    def __init__(
        self, completion_id: str, created_unix_seconds: int, model_name: str, client_wants_usage: bool
    ) -> None:
        super().__init__(completion_id, created_unix_seconds, model_name)
        self._client_wants_usage = client_wants_usage
        # Anthropic content-block index -> Chat Completions tool_calls index.
        self._tool_call_index_by_block_index: dict[int, int] = {}
        self._finish_reason: str | None = None

    def translate_event(self, event: ServerSentEvent) -> StreamTranslationResult:
        """Handle one ``message_*`` / ``content_block_*`` / ``error`` event."""
        event_body = parse_event_json(event)
        event_type = event_body.get("type") or event.event_name
        handler = getattr(self, f"_handle_{event_type}", None)
        if handler is None:
            return StreamTranslationResult()  # ping and future event types.
        translation_result: StreamTranslationResult = handler(event_body)
        return translation_result

    def _handle_message_start(self, event_body: JsonObject) -> StreamTranslationResult:
        message = event_body.get("message") or {}
        self.usage = parse_anthropic_usage(message.get("usage"), self.usage)
        return StreamTranslationResult(
            client_payloads=[self.build_chunk({"role": "assistant", "content": ""})]
        )

    def _handle_content_block_start(self, event_body: JsonObject) -> StreamTranslationResult:
        content_block = event_body.get("content_block") or {}
        if content_block.get("type") != "tool_use":
            return StreamTranslationResult()
        tool_call_index = len(self._tool_call_index_by_block_index)
        self._tool_call_index_by_block_index[int(event_body.get("index", 0))] = tool_call_index
        tool_call_delta = {
            "index": tool_call_index,
            "id": content_block.get("id"),
            "type": "function",
            "function": {"name": content_block.get("name"), "arguments": ""},
        }
        return StreamTranslationResult(
            client_payloads=[self.build_chunk({"tool_calls": [tool_call_delta]})], contains_output_token=True
        )

    def _handle_content_block_delta(self, event_body: JsonObject) -> StreamTranslationResult:
        delta = event_body.get("delta") or {}
        delta_type = delta.get("type")
        chat_delta: JsonObject
        if delta_type == "text_delta":
            chat_delta = {"content": delta.get("text", "")}
        elif delta_type == "thinking_delta":
            chat_delta = {"reasoning_content": delta.get("thinking", "")}
        elif delta_type == "input_json_delta":
            tool_call_index = self._tool_call_index_by_block_index.get(int(event_body.get("index", 0)), 0)
            chat_delta = {
                "tool_calls": [
                    {"index": tool_call_index, "function": {"arguments": delta.get("partial_json", "")}}
                ]
            }
        else:
            return StreamTranslationResult()  # signature_delta, citations_delta, ...
        return StreamTranslationResult(
            client_payloads=[self.build_chunk(chat_delta)], contains_output_token=True
        )

    def _handle_message_delta(self, event_body: JsonObject) -> StreamTranslationResult:
        self.usage = parse_anthropic_usage(event_body.get("usage"), self.usage)
        stop_reason = (event_body.get("delta") or {}).get("stop_reason")
        if stop_reason is None:
            return StreamTranslationResult()
        self._finish_reason = STOP_REASON_TO_FINISH_REASON.get(str(stop_reason), "stop")
        return StreamTranslationResult(
            client_payloads=[self.build_chunk({}, finish_reason=self._finish_reason)]
        )

    def _handle_message_stop(self, _event_body: JsonObject) -> StreamTranslationResult:
        self.finished = True
        if not self._client_wants_usage:
            return StreamTranslationResult()
        return StreamTranslationResult(
            client_payloads=[self.build_chunk({}, usage=self.usage.to_chat_completions_usage())]
        )

    def _handle_error(self, event_body: JsonObject) -> StreamTranslationResult:
        error_details = event_body.get("error") or {}
        self.finished = True
        return StreamTranslationResult(
            client_payloads=[
                self.build_error_payload(
                    str(error_details.get("type", "upstream_stream_error")),
                    str(error_details.get("message", "Provider reported a stream error")),
                )
            ]
        )
