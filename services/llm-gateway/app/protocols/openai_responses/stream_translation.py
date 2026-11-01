"""OpenAI Responses stream events -> ``chat.completion.chunk`` payloads."""

from app.protocols.adapter_base import StreamTranslationResult, StreamTranslator
from app.protocols.openai_responses.response_translation import finish_reason_for, parse_responses_usage
from app.protocols.server_sent_events import ServerSentEvent, parse_event_json


class ResponsesStreamTranslator(StreamTranslator):
    """Converts ``response.*`` stream events into ``chat.completion.chunk`` payloads."""

    def __init__(
        self, completion_id: str, created_unix_seconds: int, model_name: str, client_wants_usage: bool
    ) -> None:
        super().__init__(completion_id, created_unix_seconds, model_name)
        self._client_wants_usage = client_wants_usage
        self._tool_call_index_by_item_id: dict[str, int] = {}
        self._sent_role = False

    def translate_event(self, event: ServerSentEvent) -> StreamTranslationResult:
        """Handle the subset of Responses events that carry chat-visible output."""
        event_body = parse_event_json(event)
        event_type = str(event_body.get("type") or event.event_name or "")
        client_payloads: list[str] = []
        contains_output_token = False

        if event_type == "response.created" and not self._sent_role:
            self._sent_role = True
            client_payloads.append(self.build_chunk({"role": "assistant", "content": ""}))
        elif event_type == "response.output_text.delta":
            client_payloads.append(self.build_chunk({"content": event_body.get("delta", "")}))
            contains_output_token = True
        elif event_type in {"response.reasoning_summary_text.delta", "response.reasoning_text.delta"}:
            client_payloads.append(self.build_chunk({"reasoning_content": event_body.get("delta", "")}))
            contains_output_token = True
        elif event_type == "response.output_item.added":
            output_item = event_body.get("item") or {}
            if output_item.get("type") == "function_call":
                tool_call_index = len(self._tool_call_index_by_item_id)
                self._tool_call_index_by_item_id[str(output_item.get("id"))] = tool_call_index
                tool_call_delta = {
                    "index": tool_call_index,
                    "id": output_item.get("call_id"),
                    "type": "function",
                    "function": {"name": output_item.get("name"), "arguments": ""},
                }
                client_payloads.append(self.build_chunk({"tool_calls": [tool_call_delta]}))
                contains_output_token = True
        elif event_type == "response.function_call_arguments.delta":
            tool_call_index = self._tool_call_index_by_item_id.get(str(event_body.get("item_id")), 0)
            client_payloads.append(
                self.build_chunk(
                    {
                        "tool_calls": [
                            {"index": tool_call_index, "function": {"arguments": event_body.get("delta", "")}}
                        ]
                    }
                )
            )
            contains_output_token = True
        elif event_type in {"response.completed", "response.incomplete"}:
            response_body = event_body.get("response") or {}
            self.usage = parse_responses_usage(response_body.get("usage"))
            finish_reason = finish_reason_for(response_body, bool(self._tool_call_index_by_item_id))
            client_payloads.append(self.build_chunk({}, finish_reason=finish_reason))
            if self._client_wants_usage:
                client_payloads.append(self.build_chunk({}, usage=self.usage.to_chat_completions_usage()))
            self.finished = True
        elif event_type in {"response.failed", "error"}:
            response_error = (
                (event_body.get("response") or {}).get("error") or event_body.get("error") or event_body
            )
            client_payloads.append(
                self.build_error_payload(
                    str(response_error.get("code") or "upstream_stream_error"),
                    str(response_error.get("message") or "Provider reported a stream error"),
                )
            )
            self.finished = True
        return StreamTranslationResult(
            client_payloads=client_payloads, contains_output_token=contains_output_token
        )
