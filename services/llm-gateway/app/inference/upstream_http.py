"""HTTP-level helpers for provider calls: timeouts, error classification, JSON decoding."""

import contextlib
from collections.abc import Iterator

import httpx

from app.core.errors import (
    UpstreamConnectionError,
    UpstreamProtocolError,
    UpstreamTimeoutError,
    classify_upstream_status,
)
from app.protocols.adapter_base import ProtocolAdapter
from app.protocols.types import JsonObject, UpstreamTarget


@contextlib.contextmanager
def translate_transport_errors() -> Iterator[None]:
    """Map httpx transport exceptions to retryable :class:`UpstreamError` subclasses."""
    try:
        yield
    except httpx.TimeoutException as timeout_error:
        raise UpstreamTimeoutError() from timeout_error
    except httpx.HTTPError as transport_error:
        raise UpstreamConnectionError(
            f"Could not connect to the model provider ({type(transport_error).__name__})"
        ) from transport_error


def decode_json_object(response: httpx.Response) -> JsonObject:
    try:
        decoded_body = response.json()
    except ValueError as decode_error:
        raise UpstreamProtocolError("The model provider returned invalid JSON") from decode_error
    if not isinstance(decoded_body, dict):
        raise UpstreamProtocolError("The model provider returned a non-object JSON body")
    return decoded_body


def parse_retry_after_seconds(response: httpx.Response) -> float | None:
    retry_after_value = response.headers.get("retry-after")
    if retry_after_value is None:
        return None
    try:
        return max(float(retry_after_value), 0.0)
    except ValueError:
        return None  # HTTP-date form is rare for LLM APIs; fall back to the gateway's own backoff.


async def raise_for_upstream_status(response: httpx.Response, adapter: ProtocolAdapter) -> None:
    """Raise the classified :class:`UpstreamError` for any non-2xx provider response."""
    if response.status_code < 400:
        return
    error_text = (await response.aread()).decode("utf-8", errors="replace")
    raise classify_upstream_status(
        response.status_code, adapter.extract_error_message(error_text), parse_retry_after_seconds(response)
    )


def build_upstream_timeout(target: UpstreamTarget, connect_timeout_seconds: float) -> httpx.Timeout:
    """Per-provider read/write timeout with a bounded connect timeout."""
    return httpx.Timeout(
        target.request_timeout_seconds, connect=min(connect_timeout_seconds, target.request_timeout_seconds)
    )
