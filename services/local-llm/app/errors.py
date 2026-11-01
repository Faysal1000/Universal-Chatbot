"""Domain exceptions and their client-facing rendering.

Each exception carries an HTTP status, a stable machine-readable ``code`` and a
client-safe message, so the API layer translates failures without leaking internals.
OpenAI-compatible routes (``/v1``) render the OpenAI error envelope that llm-gateway
passes through; every other route renders RFC 9457 ``application/problem+json``.
"""

from http import HTTPStatus

OPENAI_ROUTE_PREFIX = "/v1/"
PROBLEM_JSON_MEDIA_TYPE = "application/problem+json"

_OPENAI_ERROR_TYPES: dict[int, str] = {
    400: "invalid_request_error",
    401: "authentication_error",
    403: "permission_error",
    404: "not_found_error",
    409: "invalid_request_error",
    413: "invalid_request_error",
    422: "invalid_request_error",
    429: "rate_limit_error",
}


class LocalLlmError(Exception):
    """Base class for every error the API is allowed to surface to clients."""

    http_status: HTTPStatus = HTTPStatus.INTERNAL_SERVER_ERROR
    error_code: str = "internal_error"
    client_message: str = "Internal server error"
    retry_after_seconds: int | None = None

    def __init__(self, client_message: str | None = None, *, details: dict[str, object] | None = None) -> None:
        self.client_message = client_message or self.client_message
        self.details: dict[str, object] = details or {}
        super().__init__(self.client_message)


class InvalidRequestError(LocalLlmError):
    """The request is well-formed JSON but cannot be served as supplied."""

    http_status = HTTPStatus.UNPROCESSABLE_ENTITY
    error_code = "invalid_request"
    client_message = "Invalid request"


class InvalidImageError(InvalidRequestError):
    """An image is malformed, unsupported, remote, or exceeds the safety limits."""

    error_code = "invalid_image"
    client_message = "Image could not be decoded safely"


class ModelSourceError(InvalidRequestError):
    """The Hugging Face model cannot be found or is not in a format this service runs."""

    error_code = "unsupported_model"
    client_message = "The model cannot be served by local-llm"


class UntrustedRemoteCodeError(InvalidRequestError):
    """The model needs to execute repository code and its organisation is not trusted."""

    error_code = "untrusted_remote_code"
    client_message = "The model runs its own code and its organisation is not trusted"


class GpuUnavailableError(InvalidRequestError):
    """A deployment asked for a GPU on a host or engine build without one."""

    error_code = "gpu_unavailable"
    client_message = "No usable GPU is available for this deployment"


class DeploymentNotFoundError(LocalLlmError):
    """No deployment exists with the requested name."""

    http_status = HTTPStatus.NOT_FOUND
    error_code = "deployment_not_found"
    client_message = "Deployment not found"


class DeploymentConflictError(LocalLlmError):
    """The operation conflicts with the deployment's current state."""

    http_status = HTTPStatus.CONFLICT
    error_code = "deployment_conflict"
    client_message = "The deployment is in a state that does not allow this operation"


class DeploymentNameTakenError(DeploymentConflictError):
    """Another deployment already uses the requested name (the console offers a different name)."""

    error_code = "deployment_name_taken"
    client_message = "A deployment with this name already exists"


class InsufficientMemoryError(LocalLlmError):
    """Loading the model would exceed the memory budget of every allowed device."""

    http_status = HTTPStatus.CONFLICT
    error_code = "insufficient_memory"
    client_message = "Not enough memory to load this model"


class SystemDeploymentProtectedError(LocalLlmError):
    """The system deployment (Nemotron Parse) cannot be removed or unloaded."""

    http_status = HTTPStatus.FORBIDDEN
    error_code = "system_deployment_protected"
    client_message = "The system deployment cannot be removed or unloaded"


class DeploymentNotReadyError(LocalLlmError):
    """The deployment exists but is not loaded and ready to serve requests."""

    http_status = HTTPStatus.SERVICE_UNAVAILABLE
    error_code = "deployment_not_ready"
    client_message = "The model is not loaded"
    retry_after_seconds = 10


class ServiceAtCapacityError(LocalLlmError):
    """Admitting the request would exceed the deployment's bounded queue."""

    http_status = HTTPStatus.SERVICE_UNAVAILABLE
    error_code = "at_capacity"
    client_message = "The model is busy; retry shortly"
    retry_after_seconds = 2


class ServiceShuttingDownError(LocalLlmError):
    """The process is draining and accepts no new work."""

    http_status = HTTPStatus.SERVICE_UNAVAILABLE
    error_code = "shutting_down"
    client_message = "The service is shutting down"
    retry_after_seconds = 5


class InferenceTimeoutError(LocalLlmError):
    """The request did not complete within the configured deadline."""

    http_status = HTTPStatus.GATEWAY_TIMEOUT
    error_code = "inference_timeout"
    client_message = "The model did not finish within the request deadline"


class InferenceFailedError(LocalLlmError):
    """The model or its engine process failed while generating."""

    http_status = HTTPStatus.BAD_GATEWAY
    error_code = "inference_failed"
    client_message = "The model failed to generate a response"


def build_error_body(
    request_path: str,
    status_code: int,
    error_code: str,
    message: str,
    request_id: str | None,
    details: dict[str, object] | None = None,
) -> tuple[dict[str, object], str]:
    """Return ``(body, media_type)`` in the error format the route's callers expect."""
    if request_path.startswith(OPENAI_ROUTE_PREFIX):
        return _build_openai_error_body(status_code, error_code, message), "application/json"
    return _build_problem_body(status_code, error_code, message, request_id, details), PROBLEM_JSON_MEDIA_TYPE


def _build_openai_error_body(status_code: int, error_code: str, message: str) -> dict[str, object]:
    error_type = _OPENAI_ERROR_TYPES.get(status_code, "server_error")
    return {"error": {"message": message, "type": error_type, "param": None, "code": error_code}}


def _build_problem_body(
    status_code: int,
    error_code: str,
    message: str,
    request_id: str | None,
    details: dict[str, object] | None,
) -> dict[str, object]:
    problem: dict[str, object] = {
        "type": "about:blank",
        "title": HTTPStatus(status_code).phrase,
        "status": status_code,
        "detail": message,
        "code": error_code,
        "requestId": request_id,
    }
    if details:
        problem["details"] = details
    return problem
