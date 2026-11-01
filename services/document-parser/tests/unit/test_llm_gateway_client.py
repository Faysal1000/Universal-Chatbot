import base64
import json
from datetime import UTC, datetime

import httpx
import pytest
from pydantic import SecretStr

from app.adapters.llm_gateway_client import (
    GatewayRetryPolicy,
    LlmGatewayClient,
    build_document_parse_request,
    parse_retry_after,
)
from app.application.ports import GatewayDeadlineExceededError, GatewayRejectedError, GatewayUnavailableError
from app.domain.parse_strategy import Deadline
from tests.support.doubles import FakeClock

API_KEY = "test-gateway-key-0123456789"
MARKUP = "<x_0.1><y_0.1>Hello<x_0.9><y_0.2><class_Text>"
RETRY_POLICY = GatewayRetryPolicy(maximum_attempts=3, initial_backoff_seconds=2, maximum_backoff_seconds=30)


def a_completion(content: object = MARKUP) -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": content}}]})


def an_error(status_code: int, headers: dict[str, str] | None = None) -> httpx.Response:
    body = {"error": {"message": "no route", "type": "invalid_request_error", "code": "model_not_found"}}
    return httpx.Response(status_code, json=body, headers=headers)


class GatewayHarness:
    def __init__(self, *responses: httpx.Response | Exception, page_timeout_seconds: float = 600) -> None:
        self.clock = FakeClock()
        self.requests: list[httpx.Request] = []
        self.sleeps: list[float] = []
        self._responses = list(responses)
        self.deadline = Deadline.after_seconds(page_timeout_seconds, clock=self.clock)
        transport = httpx.MockTransport(self._respond)
        self.client = LlmGatewayClient(
            base_url="http://llm-gateway:4000/",
            api_key=SecretStr(API_KEY),
            http_client=httpx.Client(transport=transport),
            retry_policy=RETRY_POLICY,
            max_tokens=8744,
            sleep=self._sleep,
            random_fraction=lambda: 1.0,
        )

    def _respond(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        response = self._responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def _sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.clock.advance(seconds)

    def parse(self) -> str:
        return self.client.parse_page_image(b"\x89PNG-bytes", self.deadline)


def test_successful_call_returns_raw_markup() -> None:
    harness = GatewayHarness(a_completion())

    assert harness.parse() == MARKUP


def test_request_follows_the_document_parse_contract() -> None:
    harness = GatewayHarness(a_completion())

    harness.parse()

    request = harness.requests[0]
    body = json.loads(request.content)
    assert str(request.url) == "http://llm-gateway:4000/v1/chat/completions"
    assert request.headers["Authorization"] == f"Bearer {API_KEY}"
    assert request.headers["X-Request-ID"]
    assert body["model"] == "document_parse"
    assert body["max_tokens"] == 8744
    image_url = body["messages"][0]["content"][0]["image_url"]["url"]
    assert image_url == "data:image/png;base64," + base64.b64encode(b"\x89PNG-bytes").decode()


def test_service_unavailable_is_retried_after_retry_after() -> None:
    harness = GatewayHarness(an_error(503, {"Retry-After": "7"}), a_completion())

    assert harness.parse() == MARKUP
    assert harness.sleeps == [7.0]


def test_backoff_doubles_between_attempts() -> None:
    harness = GatewayHarness(httpx.ConnectError("refused"), an_error(502), a_completion())

    harness.parse()

    assert harness.sleeps == [2.0, 4.0]


def test_persistent_outage_is_unavailable() -> None:
    harness = GatewayHarness(httpx.ConnectError("refused"), an_error(500), an_error(429))

    with pytest.raises(GatewayUnavailableError, match="3 attempts failed"):
        harness.parse()


@pytest.mark.parametrize(
    ("status_code", "disables_gateway"), [(400, False), (422, False), (401, True), (404, True)]
)
def test_client_errors_are_rejected_without_retry(status_code: int, disables_gateway: bool) -> None:
    harness = GatewayHarness(an_error(status_code))

    with pytest.raises(GatewayRejectedError) as raised:
        harness.parse()

    assert raised.value.disables_gateway is disables_gateway
    assert "invalid_request_error/model_not_found: no route" in str(raised.value)
    assert len(harness.requests) == 1


@pytest.mark.parametrize("content", ["", None, 42])
def test_response_without_content_is_rejected(content: object) -> None:
    with pytest.raises(GatewayRejectedError):
        GatewayHarness(a_completion(content)).parse()


def test_malformed_json_is_rejected() -> None:
    with pytest.raises(GatewayRejectedError):
        GatewayHarness(httpx.Response(200, text="not json")).parse()


def test_retry_that_would_outlive_the_page_deadline_gives_up() -> None:
    harness = GatewayHarness(an_error(503, {"Retry-After": "120"}), page_timeout_seconds=60)

    with pytest.raises(GatewayDeadlineExceededError):
        harness.parse()


def test_timeout_at_the_deadline_is_a_deadline_error() -> None:
    harness = GatewayHarness(page_timeout_seconds=60)

    def time_out_and_expire(request: httpx.Request) -> httpx.Response:
        harness.clock.advance(61)
        raise httpx.ReadTimeout("slow", request=request)

    harness.client = LlmGatewayClient(
        "http://gateway",
        SecretStr(API_KEY),
        httpx.Client(transport=httpx.MockTransport(time_out_and_expire)),
        RETRY_POLICY,
        100,
    )

    with pytest.raises(GatewayDeadlineExceededError):
        harness.parse()


def test_expired_deadline_sends_nothing() -> None:
    harness = GatewayHarness(a_completion(), page_timeout_seconds=1)
    harness.clock.advance(2)

    with pytest.raises(GatewayDeadlineExceededError):
        harness.parse()
    assert harness.requests == []


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (None, None),
        ("", None),
        ("12", 12.0),
        ("Thu, 29 Oct 2026 08:00:30 GMT", 30.0),
        ("Thu, 29 Oct 2026 07:00:00 GMT", 0.0),
        ("soon", None),
    ],
)
def test_retry_after_header_parsing(header: str | None, expected: float | None) -> None:
    now = datetime(2026, 10, 29, 8, 0, 0, tzinfo=UTC)

    assert parse_retry_after(header, now=now) == expected


def test_backoff_is_capped_and_respects_retry_after() -> None:
    assert RETRY_POLICY.backoff_seconds(10, None, 1.0) == 30
    assert RETRY_POLICY.backoff_seconds(1, 9.0, 0.1) == 9.0


def test_request_body_carries_task_and_token_limit() -> None:
    body = json.loads(build_document_parse_request(b"x", 10))

    assert (body["model"], body["max_tokens"]) == ("document_parse", 10)
