"""Parsing of provider Server-Sent Event streams (the WHATWG subset LLM APIs use)."""

import json
from collections.abc import AsyncGenerator, AsyncIterator
from dataclasses import dataclass

from app.core.errors import UpstreamProtocolError
from app.protocols.types import JsonObject


@dataclass(frozen=True, slots=True)
class ServerSentEvent:
    """One parsed SSE event (``event:`` name and joined ``data:`` lines)."""

    event_name: str | None
    data: str


async def iterate_server_sent_events(text_lines: AsyncIterator[str]) -> AsyncGenerator[ServerSentEvent]:
    """Parse an SSE line stream (per the WHATWG spec subset providers use)."""
    event_name: str | None = None
    data_lines: list[str] = []
    async for raw_line in text_lines:
        line = raw_line.rstrip("\r")
        if not line:
            if data_lines:
                yield ServerSentEvent(event_name=event_name, data="\n".join(data_lines))
            event_name, data_lines = None, []
            continue
        if line.startswith(":"):
            continue  # Comment / keep-alive.
        field_name, _, field_value = line.partition(":")
        field_value = field_value.removeprefix(" ")
        if field_name == "event":
            event_name = field_value
        elif field_name == "data":
            data_lines.append(field_value)
    if data_lines:
        yield ServerSentEvent(event_name=event_name, data="\n".join(data_lines))


def parse_event_json(event: ServerSentEvent) -> JsonObject:
    """Decode an event's JSON data or raise :class:`UpstreamProtocolError`."""
    try:
        decoded_data = json.loads(event.data)
    except ValueError as decode_error:
        raise UpstreamProtocolError("Provider sent a malformed stream event") from decode_error
    if not isinstance(decoded_data, dict):
        raise UpstreamProtocolError("Provider sent a non-object stream event")
    return decoded_data
