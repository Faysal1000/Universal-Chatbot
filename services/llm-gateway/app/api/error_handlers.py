"""Renders every error the way its audience expects.

* ``/v1/*`` (SDK callers): the OpenAI envelope ``{"error": {message, type, param, code}}``.
* ``/admin/api/*`` (dashboard): FastAPI's ``{"detail": ...}``.
"""

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.errors import GatewayError, build_error_body
from app.services.errors import (
    AdminOperationError,
    InvalidParameterError,
    InvalidReferenceError,
    ProviderUnreachableError,
    ResourceConflictError,
    ResourceNotFoundError,
)

_ADMIN_ERROR_STATUS_CODES: dict[type[AdminOperationError], int] = {
    ResourceNotFoundError: 404,
    ResourceConflictError: 409,
    InvalidReferenceError: 422,
    InvalidParameterError: 422,
    ProviderUnreachableError: 502,
}
_OPENAI_ERROR_TYPES_BY_STATUS = {401: "authentication_error", 403: "permission_error", 404: "not_found_error"}


def _is_inference_path(request: Request) -> bool:
    return request.url.path.startswith("/v1/")


async def handle_gateway_error(_request: Request, error: Exception) -> Response:
    """Gateway errors carry their own status and OpenAI error code."""
    assert isinstance(error, GatewayError)  # noqa: S101 - registered for GatewayError only.
    return error.to_response()


async def handle_admin_operation_error(_request: Request, error: Exception) -> Response:
    """Map service errors to HTTP statuses with a ``detail`` message."""
    assert isinstance(error, AdminOperationError)  # noqa: S101 - registered for AdminOperationError only.
    return JSONResponse(
        status_code=_ADMIN_ERROR_STATUS_CODES.get(type(error), 400), content={"detail": error.message}
    )


async def handle_validation_error(request: Request, error: Exception) -> Response:
    """OpenAI-shaped 400 for inference calls; FastAPI's 422 for everything else."""
    assert isinstance(error, RequestValidationError)  # noqa: S101 - registered for RequestValidationError only.
    if not _is_inference_path(request):
        return await request_validation_exception_handler(request, error)
    first_error = error.errors()[0] if error.errors() else {}
    error_location = ".".join(str(part) for part in first_error.get("loc", ()) if part != "body")
    message = (
        f"{error_location}: {first_error.get('msg', 'invalid value')}" if error_location else "Invalid body"
    )
    return JSONResponse(
        status_code=400, content=build_error_body(message, "invalid_request_error", "invalid_request")
    )


async def handle_http_exception(request: Request, error: Exception) -> Response:
    """OpenAI-shaped bodies for framework errors (405, 413...) on inference paths."""
    assert isinstance(error, StarletteHTTPException)  # noqa: S101 - registered for HTTPException only.
    if not _is_inference_path(request):
        return await http_exception_handler(request, error)
    error_type = _OPENAI_ERROR_TYPES_BY_STATUS.get(error.status_code, "invalid_request_error")
    return JSONResponse(
        status_code=error.status_code,
        content=build_error_body(str(error.detail), error_type, f"http_{error.status_code}"),
        headers=getattr(error, "headers", None),
    )


def register_error_handlers(application: FastAPI) -> None:
    """Install every handler on ``application``."""
    application.add_exception_handler(GatewayError, handle_gateway_error)
    application.add_exception_handler(AdminOperationError, handle_admin_operation_error)
    application.add_exception_handler(RequestValidationError, handle_validation_error)
    application.add_exception_handler(StarletteHTTPException, handle_http_exception)
