"""Pure-ASGI middleware: request-body size enforcement and request-ID correlation."""

import json
import re
import uuid

from starlette.exceptions import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import build_error_body
from app.core.logging_config import current_request_id

REQUEST_ID_HEADER = "X-Request-ID"
_REQUEST_ID_HEADER_BYTES = REQUEST_ID_HEADER.lower().encode("latin-1")
_SAFE_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
_METHODS_WITH_BODY = frozenset({"POST", "PUT", "PATCH"})


async def _send_json_error(send: Send, status_code: int, detail: str, error_code: str) -> None:
    """Write a complete OpenAI-shaped JSON error response directly to the ASGI channel."""
    response_body = json.dumps(build_error_body(detail, "invalid_request_error", error_code)).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status_code,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(response_body)).encode("latin-1")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": response_body})


class RequestBodySizeLimitMiddleware:
    """Reject request bodies larger than ``max_body_bytes``, including chunked uploads.

    Requests that declare an oversized ``Content-Length`` are rejected before any
    body bytes are read. Chunked or under-declared bodies are counted as they stream
    in; once the limit is crossed, ``receive`` raises a 413 ``HTTPException`` that
    FastAPI's body parser re-raises unchanged and Starlette renders as a response.
    """

    def __init__(self, app: ASGIApp, max_body_bytes: int) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Enforce the limit for body-carrying HTTP methods; pass everything else through."""
        if scope["type"] != "http" or scope.get("method") not in _METHODS_WITH_BODY:
            await self.app(scope, receive, send)
            return

        declared_content_length = self._read_declared_content_length(scope)
        if declared_content_length == -1:
            await _send_json_error(send, 400, "Invalid Content-Length header", "invalid_content_length")
            return
        if declared_content_length is not None and declared_content_length > self.max_body_bytes:
            await _send_json_error(send, 413, "Request body too large", "request_too_large")
            return

        received_body_bytes = 0

        async def size_limited_receive() -> Message:
            nonlocal received_body_bytes
            message = await receive()
            if message["type"] == "http.request":
                received_body_bytes += len(message.get("body", b""))
                if received_body_bytes > self.max_body_bytes:
                    raise HTTPException(status_code=413, detail="Request body too large")
            return message

        await self.app(scope, size_limited_receive, send)

    @staticmethod
    def _read_declared_content_length(scope: Scope) -> int | None:
        """Return the declared length, ``None`` if absent, or ``-1`` if malformed."""
        for header_name, header_value in scope.get("headers", []):
            if header_name == b"content-length":
                try:
                    declared_length = int(header_value)
                except ValueError:
                    return -1
                return declared_length if declared_length >= 0 else -1
        return None


class RequestContextMiddleware:
    """Propagate or mint an ``X-Request-ID`` and expose it to logs and responses.

    A caller-supplied ID is reused only if it matches a conservative character set,
    which prevents log injection through the header.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Bind the request ID to the logging context for the lifetime of the request."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = self._resolve_request_id(scope)
        request_id_header_value = request_id.encode("latin-1")
        context_token = current_request_id.set(request_id)

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                response_headers = list(message.get("headers", []))
                response_headers.append((_REQUEST_ID_HEADER_BYTES, request_id_header_value))
                message["headers"] = response_headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            current_request_id.reset(context_token)

    @staticmethod
    def _resolve_request_id(scope: Scope) -> str:
        """Reuse a well-formed inbound request ID or generate a new random one."""
        for header_name, header_value in scope.get("headers", []):
            if header_name == _REQUEST_ID_HEADER_BYTES:
                candidate_request_id: str = header_value.decode("latin-1")
                if _SAFE_REQUEST_ID_PATTERN.fullmatch(candidate_request_id):
                    return candidate_request_id
                break
        return uuid.uuid4().hex
