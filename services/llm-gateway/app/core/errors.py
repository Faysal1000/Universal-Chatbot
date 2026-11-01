"""Domain exceptions, their HTTP mapping, and OpenAI-shaped error bodies.

Every error the gateway surfaces to a caller is a :class:`GatewayError`. Each carries a
status code, an OpenAI ``error.type``, a stable ``error.code`` (also stored in request
metrics as the error class), and a client-safe message that never leaks provider
credentials or internal details.
"""

from http import HTTPStatus

from fastapi.responses import JSONResponse

MAX_UPSTREAM_MESSAGE_CHARACTERS = 500


class GatewayError(Exception):
    """Base class for every error the API is allowed to surface to callers."""

    http_status: HTTPStatus = HTTPStatus.INTERNAL_SERVER_ERROR
    error_type: str = "server_error"
    error_code: str = "internal_error"
    client_message: str = "Internal server error"
    retry_after_seconds: int | None = None

    def __init__(self, client_message: str | None = None) -> None:
        self.client_message = client_message or self.client_message
        super().__init__(self.client_message)

    def to_response(self) -> JSONResponse:
        """Render the error in the OpenAI error envelope that every OpenAI SDK understands."""
        response_headers = (
            {"Retry-After": str(self.retry_after_seconds)} if self.retry_after_seconds is not None else None
        )
        return JSONResponse(
            status_code=int(self.http_status),
            content=build_error_body(self.client_message, self.error_type, self.error_code),
            headers=response_headers,
        )


def build_error_body(message: str, error_type: str, error_code: str) -> dict[str, object]:
    """Return ``{"error": {...}}`` in the shape used by the OpenAI API."""
    return {"error": {"message": message, "type": error_type, "param": None, "code": error_code}}


def truncate_upstream_message(message: str) -> str:
    """Bound provider error text so huge HTML error pages never reach logs or callers."""
    collapsed_message = " ".join(message.split())
    if len(collapsed_message) <= MAX_UPSTREAM_MESSAGE_CHARACTERS:
        return collapsed_message
    return collapsed_message[:MAX_UPSTREAM_MESSAGE_CHARACTERS] + "…"


# ----- Caller errors -----


class AuthenticationFailedError(GatewayError):
    """The caller did not present the gateway API key."""

    http_status = HTTPStatus.UNAUTHORIZED
    error_type = "authentication_error"
    error_code = "invalid_api_key"
    client_message = "Invalid or missing API key"


class InvalidRequestError(GatewayError):
    """The request body is not a valid Chat Completions request."""

    http_status = HTTPStatus.BAD_REQUEST
    error_type = "invalid_request_error"
    error_code = "invalid_request"
    client_message = "Invalid request"


class UnsupportedFeatureError(InvalidRequestError):
    """The request uses a feature the target provider protocol cannot express."""

    error_code = "unsupported_feature"


# ----- Gateway-side availability errors -----


class NoModelAvailableError(GatewayError):
    """No enabled model is configured for the task and no default model is usable."""

    http_status = HTTPStatus.SERVICE_UNAVAILABLE
    error_type = "service_unavailable"
    error_code = "no_model_configured"
    client_message = "No enabled model is configured for this task"


class AllModelsCoolingDownError(GatewayError):
    """Every model in the task's chain was skipped because its circuit breaker is open."""

    http_status = HTTPStatus.SERVICE_UNAVAILABLE
    error_type = "service_unavailable"
    error_code = "all_models_circuit_open"
    client_message = "Every model for this task is cooling down after repeated failures; retry shortly"
    retry_after_seconds = 5


class GatewayAtCapacityError(GatewayError):
    """The provider's concurrency budget stayed full for the whole wait timeout."""

    http_status = HTTPStatus.SERVICE_UNAVAILABLE
    error_type = "service_unavailable"
    error_code = "gateway_at_capacity"
    client_message = "LLM gateway is at capacity; retry shortly"
    retry_after_seconds = 1


class GatewayNotReadyError(GatewayError):
    """The gateway is starting up or shutting down."""

    http_status = HTTPStatus.SERVICE_UNAVAILABLE
    error_type = "service_unavailable"
    error_code = "gateway_not_ready"
    client_message = "LLM gateway is not ready"
    retry_after_seconds = 5


# ----- Upstream (provider) errors -----


class UpstreamError(GatewayError):
    """A provider call failed. Subclasses decide whether retrying or falling back can help."""

    http_status = HTTPStatus.BAD_GATEWAY
    error_type = "upstream_error"
    error_code = "upstream_error"
    client_message = "The model provider returned an error"
    is_retryable: bool = False
    # Whether another model might succeed where this one failed.
    allows_fallback: bool = True

    def __init__(
        self,
        client_message: str | None = None,
        upstream_status_code: int | None = None,
        retry_after_seconds: float | None = None,
    ) -> None:
        self.upstream_status_code = upstream_status_code
        self.upstream_retry_after_seconds = retry_after_seconds
        super().__init__(client_message)


class UpstreamRateLimitedError(UpstreamError):
    """The provider returned 429."""

    http_status = HTTPStatus.TOO_MANY_REQUESTS
    error_type = "rate_limit_error"
    error_code = "upstream_rate_limited"
    client_message = "The model provider is rate limiting requests"
    is_retryable = True
    retry_after_seconds = 1


class UpstreamServerError(UpstreamError):
    """The provider returned a 5xx (or Anthropic's 529 overloaded)."""

    error_code = "upstream_server_error"
    client_message = "The model provider had an internal error"
    is_retryable = True


class UpstreamTimeoutError(UpstreamError):
    """The provider did not respond within the provider's timeout."""

    http_status = HTTPStatus.GATEWAY_TIMEOUT
    error_code = "upstream_timeout"
    client_message = "The model provider did not respond in time"
    is_retryable = True


class UpstreamConnectionError(UpstreamError):
    """The provider could not be reached (DNS, TCP, TLS)."""

    error_code = "upstream_connection_error"
    client_message = "Could not connect to the model provider"
    is_retryable = True


class UpstreamConfigurationError(UpstreamError):
    """The provider rejected the gateway's credentials or model ID (401/403/404).

    Retrying the same model cannot help, but a different provider can, so fallback is
    allowed. The caller sees 502 because the problem is the gateway's configuration.
    """

    error_code = "upstream_configuration_error"
    client_message = "The model provider rejected the gateway configuration"


class UpstreamRejectedRequestError(UpstreamError):
    """The provider rejected the request content itself (400/413/422).

    Another model would almost certainly reject it too, so neither retry nor fallback
    happens and the provider's status code is passed to the caller.
    """

    http_status = HTTPStatus.BAD_REQUEST
    error_type = "invalid_request_error"
    error_code = "upstream_rejected_request"
    client_message = "The model provider rejected the request"
    allows_fallback = False


class UpstreamProtocolError(UpstreamError):
    """The provider answered with something that does not match its declared protocol."""

    error_code = "upstream_protocol_error"
    client_message = "The model provider returned an invalid response"


RETRYABLE_UPSTREAM_STATUS_CODES = frozenset({408, 409, 425, 429, 500, 502, 503, 504, 529})
CONFIGURATION_UPSTREAM_STATUS_CODES = frozenset({401, 402, 403, 404})
# Only these say the request itself is bad, so another model would reject it too; any other
# 4xx is a problem with this provider and moves to the next chain step.
REJECTED_REQUEST_STATUS_CODES = frozenset({400, 413, 422})


def classify_upstream_status(
    status_code: int, upstream_message: str, retry_after_seconds: float | None
) -> UpstreamError:
    """Map a non-2xx provider status code to the matching :class:`UpstreamError`."""
    message = truncate_upstream_message(upstream_message) if upstream_message else None
    if status_code == 429:
        return UpstreamRateLimitedError(message, status_code, retry_after_seconds)
    if status_code in RETRYABLE_UPSTREAM_STATUS_CODES:
        return UpstreamServerError(message, status_code, retry_after_seconds)
    if status_code in REJECTED_REQUEST_STATUS_CODES:
        rejected_error = UpstreamRejectedRequestError(message, status_code)
        rejected_error.http_status = HTTPStatus(status_code)
        return rejected_error
    if status_code in CONFIGURATION_UPSTREAM_STATUS_CODES or 400 <= status_code < 500:
        return UpstreamConfigurationError(message, status_code)
    return UpstreamServerError(message, status_code, retry_after_seconds)
