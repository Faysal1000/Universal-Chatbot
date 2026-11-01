"""Client for the LLM gateway's ``document_parse`` task (OpenAI-compatible chat completions).

Retry policy, bounded by the page deadline:
- connection errors, timeouts, 408, 425, 429, 500, 502, 503, 504: retried with exponential
  backoff and full jitter; ``Retry-After`` on 429/503 sets the minimum wait;
- 401, 403, 404: rejected, and the gateway is disabled for the rest of the batch (the key or
  the task route is misconfigured, so every other page would fail the same way);
- any other 4xx or a response without content: rejected for this page only, never retried.
"""

import base64
import json
import logging
import random
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Any

import httpx
from pydantic import SecretStr

from app.application.ports import GatewayDeadlineExceededError, GatewayRejectedError, GatewayUnavailableError
from app.domain.parse_strategy import Deadline

DOCUMENT_PARSE_TASK = "document_parse"
CHAT_COMPLETIONS_PATH = "/v1/chat/completions"
RETRYABLE_STATUS_CODES = frozenset({408, 425, 429, 500, 502, 503, 504})
GATEWAY_DISABLING_STATUS_CODES = frozenset({401, 403, 404})
CONNECT_TIMEOUT_SECONDS = 10.0
MAXIMUM_ERROR_MESSAGE_CHARACTERS = 300

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class GatewayRetryPolicy:
    maximum_attempts: int
    initial_backoff_seconds: float
    maximum_backoff_seconds: float

    def backoff_seconds(
        self, attempt: int, retry_after_seconds: float | None, random_fraction: float
    ) -> float:
        """Full-jitter exponential backoff, never shorter than the server's ``Retry-After``."""
        ceiling = min(self.maximum_backoff_seconds, self.initial_backoff_seconds * 2.0 ** (attempt - 1))
        jittered = ceiling * random_fraction
        return max(jittered, retry_after_seconds or 0.0)


class _TransientGatewayError(Exception):
    def __init__(self, reason: str, retry_after_seconds: float | None = None) -> None:
        super().__init__(reason)
        self.retry_after_seconds = retry_after_seconds


class LlmGatewayClient:
    def __init__(
        self,
        base_url: str,
        api_key: SecretStr,
        http_client: httpx.Client,
        retry_policy: GatewayRetryPolicy,
        max_tokens: int,
        sleep: Callable[[float], None] = time.sleep,
        random_fraction: Callable[[], float] = random.random,
    ) -> None:
        self._endpoint = base_url.rstrip("/") + CHAT_COMPLETIONS_PATH
        self._api_key = api_key
        self._http_client = http_client
        self._retry_policy = retry_policy
        self._max_tokens = max_tokens
        self._sleep = sleep
        self._random_fraction = random_fraction

    def parse_page_image(self, png_bytes: bytes, deadline: Deadline) -> str:
        request_body = build_document_parse_request(png_bytes, self._max_tokens)
        return self._send_with_retries(request_body, deadline)

    def _send_with_retries(self, request_body: bytes, deadline: Deadline) -> str:
        last_error: _TransientGatewayError | None = None
        for attempt in range(1, self._retry_policy.maximum_attempts + 1):
            if deadline.has_expired():
                raise GatewayDeadlineExceededError("the page deadline passed before the gateway answered")
            try:
                return self._send_once(request_body, deadline)
            except _TransientGatewayError as error:
                last_error = error
                self._wait_before_retry(attempt, error, deadline)
        raise GatewayUnavailableError(
            f"{self._retry_policy.maximum_attempts} attempts failed, last: {last_error}"
        )

    def _wait_before_retry(self, attempt: int, error: _TransientGatewayError, deadline: Deadline) -> None:
        if attempt >= self._retry_policy.maximum_attempts:
            return
        delay = self._retry_policy.backoff_seconds(
            attempt, error.retry_after_seconds, self._random_fraction()
        )
        if delay >= deadline.remaining_seconds():
            raise GatewayDeadlineExceededError(f"no time left to retry after: {error}")
        logger.info("Gateway attempt %s failed (%s); retrying in %.1f s", attempt, error, delay)
        self._sleep(delay)

    def _send_once(self, request_body: bytes, deadline: Deadline) -> str:
        response = self._post(request_body, deadline)
        return self._interpret_response(response)

    def _post(self, request_body: bytes, deadline: Deadline) -> httpx.Response:
        remaining_seconds = deadline.remaining_seconds()
        timeout = httpx.Timeout(remaining_seconds, connect=min(CONNECT_TIMEOUT_SECONDS, remaining_seconds))
        try:
            return self._http_client.post(
                self._endpoint, content=request_body, headers=self._headers(), timeout=timeout
            )
        except httpx.TimeoutException as error:
            if deadline.has_expired():
                raise GatewayDeadlineExceededError(
                    "the gateway did not answer before the page deadline"
                ) from error
            raise _TransientGatewayError(f"timeout: {type(error).__name__}") from error
        except httpx.TransportError as error:
            raise _TransientGatewayError(f"transport error: {type(error).__name__}") from error

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key.get_secret_value()}",
            "Content-Type": "application/json",
            "X-Request-ID": str(uuid.uuid4()),
        }

    def _interpret_response(self, response: httpx.Response) -> str:
        status_code = response.status_code
        if status_code == httpx.codes.OK:
            return extract_markup(response)
        error_description = describe_error_body(response)
        if status_code in RETRYABLE_STATUS_CODES:
            retry_after = parse_retry_after(response.headers.get("Retry-After"))
            raise _TransientGatewayError(f"HTTP {status_code}: {error_description}", retry_after)
        raise GatewayRejectedError(
            f"HTTP {status_code}: {error_description}",
            disables_gateway=status_code in GATEWAY_DISABLING_STATUS_CODES,
        )


def build_document_parse_request(png_bytes: bytes, max_tokens: int) -> bytes:
    image_url = "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")
    body = {
        "model": DOCUMENT_PARSE_TASK,
        "messages": [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": image_url}}]}],
        "max_tokens": max_tokens,
    }
    return json.dumps(body).encode("utf-8")


def extract_markup(response: httpx.Response) -> str:
    try:
        content = response.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as error:
        raise GatewayRejectedError(
            "the gateway response has no message content", disables_gateway=False
        ) from error
    if not isinstance(content, str) or not content.strip():
        raise GatewayRejectedError("the gateway returned empty content", disables_gateway=False)
    return content


def describe_error_body(response: httpx.Response) -> str:
    """``type/code: message`` from the OpenAI error envelope, else the start of the body."""
    try:
        error_object: Any = response.json().get("error", {})
    except (ValueError, AttributeError):
        return response.text[:MAXIMUM_ERROR_MESSAGE_CHARACTERS]
    if not isinstance(error_object, dict):
        return str(error_object)[:MAXIMUM_ERROR_MESSAGE_CHARACTERS]
    label = "/".join(str(error_object[key]) for key in ("type", "code") if error_object.get(key))
    message = str(error_object.get("message", ""))[:MAXIMUM_ERROR_MESSAGE_CHARACTERS]
    return f"{label}: {message}" if label else message


def parse_retry_after(header_value: str | None, now: datetime | None = None) -> float | None:
    """Seconds to wait from a ``Retry-After`` header (delta-seconds or HTTP date)."""
    if header_value is None or not header_value.strip():
        return None
    stripped_value = header_value.strip()
    if stripped_value.isdigit():
        return float(stripped_value)
    try:
        retry_at = parsedate_to_datetime(stripped_value)
    except (TypeError, ValueError):
        return None
    if retry_at.tzinfo is None:
        retry_at = retry_at.replace(tzinfo=UTC)
    return max(0.0, (retry_at - (now or datetime.now(UTC))).total_seconds())
