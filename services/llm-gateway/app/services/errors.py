"""Errors raised by admin services; the API layer maps each to an HTTP status.

Services stay free of HTTP concerns: they raise these, and
``app.api.error_handlers`` renders them as ``{"detail": message}``.
"""


class AdminOperationError(Exception):
    """Base class: ``message`` is safe to show to the admin."""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class ResourceNotFoundError(AdminOperationError):
    """The addressed provider, model, or route does not exist (HTTP 404)."""


class ResourceConflictError(AdminOperationError):
    """The change conflicts with existing state: a duplicate, or a model still in use (HTTP 409)."""


class InvalidReferenceError(AdminOperationError):
    """The request references something that does not exist or is incomplete (HTTP 422)."""


class ProviderUnreachableError(AdminOperationError):
    """The provider could not be queried during an admin action (HTTP 502)."""


class InvalidParameterError(AdminOperationError):
    """A parameter is well-formed but not acceptable, e.g. an inverted time range (HTTP 422)."""
