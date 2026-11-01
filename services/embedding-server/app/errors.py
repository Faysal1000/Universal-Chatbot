"""Domain exceptions and their mapping to HTTP status codes.

Each exception carries the status code and a client-safe message so the API layer
can translate failures without leaking internal details.
"""

from http import HTTPStatus


class EmbeddingServerError(Exception):
    """Base class for every error the API is allowed to surface to clients."""

    http_status: HTTPStatus = HTTPStatus.INTERNAL_SERVER_ERROR
    client_message: str = "Internal server error"
    retry_after_seconds: int | None = None

    def __init__(self, client_message: str | None = None) -> None:
        self.client_message = client_message or self.client_message
        super().__init__(self.client_message)


class InvalidInputError(EmbeddingServerError):
    """A request item is well-formed JSON but cannot be embedded as supplied."""

    http_status = HTTPStatus.UNPROCESSABLE_ENTITY
    client_message = "Invalid embedding input"

    def __init__(self, client_message: str | None = None, item_index: int | None = None) -> None:
        self.item_index = item_index
        super().__init__(client_message)

    def for_item(self, item_index: int) -> "InvalidInputError":
        """Return a copy of this error annotated with the failing batch position."""
        annotated_error = type(self)(self.client_message, item_index=item_index)
        annotated_error.__cause__ = self.__cause__
        return annotated_error


class InvalidImageError(InvalidInputError):
    """The supplied image is malformed, unsupported, or exceeds safety limits."""

    client_message = "Image could not be decoded safely"


class InputTooLongError(InvalidInputError):
    """Text exceeds the configured token budget."""

    client_message = "Text exceeds the maximum token length"


class ServiceAtCapacityError(EmbeddingServerError):
    """Admitting the request would exceed the bounded pending-work budget."""

    http_status = HTTPStatus.SERVICE_UNAVAILABLE
    client_message = "Embedding service is at capacity; retry shortly"
    retry_after_seconds = 1


class ServiceUnavailableError(EmbeddingServerError):
    """The service is starting up, shutting down, or its worker has stopped."""

    http_status = HTTPStatus.SERVICE_UNAVAILABLE
    client_message = "Embedding service is not ready"
    retry_after_seconds = 5


class EmbeddingTimeoutError(EmbeddingServerError):
    """The request did not complete within the configured deadline."""

    http_status = HTTPStatus.GATEWAY_TIMEOUT
    client_message = "Embedding request timed out"


class InferenceFailedError(EmbeddingServerError):
    """The model raised an error or produced an invalid result for a batch."""

    http_status = HTTPStatus.SERVICE_UNAVAILABLE
    client_message = "Embedding inference failed"
    retry_after_seconds = 1
