"""The contract every provider protocol adapter implements.

The gateway's inbound format is always OpenAI Chat Completions. An adapter
translates that request to its provider protocol and translates the provider's
response, or SSE stream, back into Chat Completions objects.
"""

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from app.core.errors import UpstreamProtocolError
from app.protocols.server_sent_events import ServerSentEvent
from app.protocols.types import (
    ApiProtocol,
    DiscoveredModel,
    JsonObject,
    PreparedUpstreamRequest,
    TokenUsage,
    UpstreamTarget,
)


@dataclass(slots=True)
class StreamTranslationResult:
    """Client-bound SSE payloads produced from one upstream event."""

    client_payloads: list[str] = field(default_factory=list)
    # True once the event carried generated output (text, reasoning, or tool-call data).
    contains_output_token: bool = False


@dataclass(slots=True)
class InStreamError:
    """An error the provider reported inside an already-started stream."""

    error_class: str
    message: str


class StreamTranslator(ABC):
    """Stateful converter from one provider SSE stream to Chat Completions chunks."""

    def __init__(self, completion_id: str, created_unix_seconds: int, model_name: str) -> None:
        self.completion_id = completion_id
        self.created_unix_seconds = created_unix_seconds
        self.model_name = model_name
        self.usage = TokenUsage()
        self.in_stream_error: InStreamError | None = None
        self.finished = False

    @abstractmethod
    def translate_event(self, event: ServerSentEvent) -> StreamTranslationResult:
        """Translate one upstream event into zero or more client payloads."""

    def build_chunk(
        self,
        delta: JsonObject,
        finish_reason: str | None = None,
        usage: JsonObject | None = None,
    ) -> str:
        """Serialise a ``chat.completion.chunk`` with this stream's id/model/created."""
        chunk: JsonObject = {
            "id": self.completion_id,
            "object": "chat.completion.chunk",
            "created": self.created_unix_seconds,
            "model": self.model_name,
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
        }
        if usage is not None:
            chunk["choices"] = []
            chunk["usage"] = usage
        return json.dumps(chunk, separators=(",", ":"), ensure_ascii=False)

    def build_error_payload(self, error_class: str, message: str) -> str:
        """Record an in-stream error and render it the way OpenAI streams report errors."""
        self.in_stream_error = InStreamError(error_class=error_class, message=message)
        return json.dumps(
            {"error": {"message": message, "type": "upstream_error", "param": None, "code": error_class}},
            separators=(",", ":"),
        )


class ProtocolAdapter(ABC):
    """Translation between inbound Chat Completions and one provider protocol."""

    api_protocol: ApiProtocol

    @abstractmethod
    def build_request(self, chat_request: JsonObject, target: UpstreamTarget) -> PreparedUpstreamRequest:
        """Translate a Chat Completions request body for ``target``."""

    @abstractmethod
    def translate_response(
        self, upstream_body: JsonObject, target: UpstreamTarget, completion_id: str, created_unix_seconds: int
    ) -> tuple[JsonObject, TokenUsage]:
        """Translate a non-streaming provider response into a ``chat.completion`` object."""

    @abstractmethod
    def create_stream_translator(
        self, target: UpstreamTarget, completion_id: str, created_unix_seconds: int, client_wants_usage: bool
    ) -> StreamTranslator:
        """Return a fresh translator for one streaming response."""

    @abstractmethod
    def build_models_list_request(self, target: UpstreamTarget) -> tuple[str, dict[str, str]]:
        """Return ``(url, headers)`` for the provider's list-models endpoint."""

    def parse_models_list(self, upstream_body: JsonObject) -> list[DiscoveredModel]:
        """Parse ``{"data": [{"id": ...}, ...]}``, the shape OpenAI and Anthropic both use."""
        model_entries = upstream_body.get("data")
        if not isinstance(model_entries, list):
            raise UpstreamProtocolError("Provider models response has no 'data' list")
        discovered_models = [
            DiscoveredModel(model_id=str(entry["id"]), display_name=entry.get("display_name"))
            for entry in model_entries
            if isinstance(entry, dict) and entry.get("id")
        ]
        return sorted(discovered_models, key=lambda discovered_model: discovered_model.model_id)

    @staticmethod
    def extract_error_message(response_text: str) -> str:
        """Pull a human-readable message out of an OpenAI- or Anthropic-style error body."""
        try:
            error_body = json.loads(response_text)
        except ValueError:
            return response_text
        if isinstance(error_body, dict):
            nested_error = error_body.get("error")
            if isinstance(nested_error, dict) and isinstance(nested_error.get("message"), str):
                return str(nested_error["message"])
            if isinstance(nested_error, str):
                return nested_error
            if isinstance(error_body.get("message"), str):
                return str(error_body["message"])
            if isinstance(error_body.get("detail"), str):
                return str(error_body["detail"])
        return response_text
