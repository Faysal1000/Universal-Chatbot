"""Low-level ASGI response writing: JSON bodies, SSE streams, and disconnect handling."""

import asyncio
import contextlib
import json
from collections.abc import Callable, Coroutine
from typing import Any

from starlette.responses import Response
from starlette.types import Receive, Scope, Send

from app.core.errors import GatewayError, build_error_body
from app.protocols.types import JsonObject

SSE_TERMINATOR = b"data: [DONE]\n\n"


class CancelOnDisconnectResponse(Response):
    """Runs ``producer(send)`` and cancels it as soon as the client disconnects.

    Starlette's own streaming response only notices a disconnect on its next write,
    which may be minutes away while a reasoning model is thinking; this watches the
    connection independently so the upstream call is cancelled immediately.
    """

    def __init__(self, producer: Callable[[Send], Coroutine[Any, Any, None]]) -> None:
        # The base class only makes FastAPI return this object as-is; the producer
        # writes the real status, headers, and body.
        super().__init__()
        self._producer = producer

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """ASGI entrypoint."""
        producer_task = asyncio.create_task(self._producer(send))
        disconnect_task = asyncio.create_task(self._wait_for_disconnect(receive))
        try:
            finished_tasks, _ = await asyncio.wait(
                {producer_task, disconnect_task}, return_when=asyncio.FIRST_COMPLETED
            )
            if disconnect_task in finished_tasks and not producer_task.done():
                producer_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await producer_task
        finally:
            for task in (producer_task, disconnect_task):
                if not task.done():
                    task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await task

    @staticmethod
    async def _wait_for_disconnect(receive: Receive) -> None:
        while (await receive())["type"] != "http.disconnect":
            pass


async def send_json_response(
    send: Send, status_code: int, body: JsonObject, extra_headers: dict[str, str] | None = None
) -> None:
    """Write a complete JSON response to the ASGI channel."""
    encoded_body = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    response_headers = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(encoded_body)).encode("latin-1")),
        *encode_headers(extra_headers or {}),
    ]
    await send({"type": "http.response.start", "status": status_code, "headers": response_headers})
    await send({"type": "http.response.body", "body": encoded_body})


def encode_headers(headers: dict[str, str]) -> list[tuple[bytes, bytes]]:
    return [(name.lower().encode("latin-1"), value.encode("latin-1")) for name, value in headers.items()]


async def send_gateway_error(
    send: Send,
    error: GatewayError,
    extra_headers: dict[str, str] | None = None,
    step_reports: list[dict[str, object]] | None = None,
) -> None:
    """Write ``error`` as an OpenAI-shaped JSON error response.

    ``step_reports`` (each model-chain step reached and why it failed) is added as ``error.steps``.
    """
    response_headers = dict(extra_headers or {})
    if error.retry_after_seconds is not None:
        response_headers["Retry-After"] = str(error.retry_after_seconds)
    error_body = build_error_body(error.client_message, error.error_type, error.error_code)
    if step_reports is not None:
        error_details = error_body["error"]
        if isinstance(error_details, dict):
            error_details["steps"] = step_reports
    await send_json_response(send, int(error.http_status), error_body, response_headers)


async def send_event_stream_start(send: Send, extra_headers: dict[str, str]) -> None:
    """Start a 200 ``text/event-stream`` response."""
    stream_headers = {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",  # Disable proxy buffering (nginx) so tokens flow immediately.
        **extra_headers,
    }
    await send({"type": "http.response.start", "status": 200, "headers": encode_headers(stream_headers)})


async def send_event_payloads(send: Send, event_payloads: list[str]) -> None:
    """Write ``data: <payload>`` events (no-op for an empty list)."""
    if not event_payloads:
        return
    encoded_events = "".join(f"data: {payload}\n\n" for payload in event_payloads).encode("utf-8")
    await send({"type": "http.response.body", "body": encoded_events, "more_body": True})


async def send_event_stream_end(send: Send) -> None:
    """Write ``data: [DONE]`` and close the response."""
    await send({"type": "http.response.body", "body": SSE_TERMINATOR, "more_body": False})
