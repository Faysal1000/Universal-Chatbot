"""OpenAI ``chat.completion.chunk`` Server-Sent Events for engines that generate in-process."""

import json
from typing import Any

from app.schemas.openai import FinishReason, Usage, new_completion_id, unix_timestamp

SSE_DONE = b"data: [DONE]\n\n"


def encode_sse_event(payload: dict[str, Any]) -> bytes:
    """One ``data:`` event terminated by a blank line."""
    return b"data: " + json.dumps(payload, ensure_ascii=False).encode("utf-8") + b"\n\n"


def encode_sse_error(message: str, error_code: str) -> bytes:
    """A mid-stream failure, in the shape llm-gateway forwards to callers."""
    return encode_sse_event({"error": {"message": message, "type": "server_error", "param": None, "code": error_code}})


class ChunkFactory:
    """Builds the chunks of one streamed completion (they share id, model and created)."""

    def __init__(self, model_name: str) -> None:
        self._completion_id = new_completion_id()
        self._created = unix_timestamp()
        self._model_name = model_name

    def role_chunk(self) -> dict[str, Any]:
        """First chunk: announces the assistant role."""
        return self._chunk([{"index": 0, "delta": {"role": "assistant", "content": ""}, "finish_reason": None}])

    def content_chunk(self, text: str) -> dict[str, Any]:
        """A piece of generated text."""
        return self._chunk([{"index": 0, "delta": {"content": text}, "finish_reason": None}])

    def finish_chunk(self, finish_reason: FinishReason) -> dict[str, Any]:
        """Last choice chunk, carrying the finish reason."""
        return self._chunk([{"index": 0, "delta": {}, "finish_reason": finish_reason}])

    def usage_chunk(self, usage: Usage) -> dict[str, Any]:
        """Usage-only chunk sent when ``stream_options.include_usage`` is set."""
        usage_chunk = self._chunk([])
        usage_chunk["usage"] = usage.model_dump()
        return usage_chunk

    def _chunk(self, choices: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "id": self._completion_id,
            "object": "chat.completion.chunk",
            "created": self._created,
            "model": self._model_name,
            "choices": choices,
        }
