"""Failures a job can end with, classified by whether retrying can help.

The worker turns every error into a BullMQ ``failedReason`` of the form ``"<code>: <detail>"``
so ``rag`` can branch on the stable code without parsing prose. Permanent errors are raised
to BullMQ as ``UnrecoverableError`` (no further attempts); retryable ones use the job's
backoff policy.
"""

from enum import StrEnum


class FailureCode(StrEnum):
    """Stable machine-readable failure codes (part of the contract with ``rag``)."""

    INVALID_JOB_PAYLOAD = "invalid_job_payload"
    UNSUPPORTED_SCHEMA_VERSION = "unsupported_schema_version"
    UNSUPPORTED_FORMAT = "unsupported_format"
    BUCKET_NOT_ALLOWED = "bucket_not_allowed"
    SOURCE_NOT_FOUND = "source_not_found"
    SOURCE_TOO_LARGE = "source_too_large"
    SOURCE_CHECKSUM_MISMATCH = "source_checksum_mismatch"
    ENCRYPTED_DOCUMENT = "encrypted_document"
    CORRUPT_DOCUMENT = "corrupt_document"
    TOO_MANY_PAGES = "too_many_pages"
    PAGE_OUT_OF_RANGE = "page_out_of_range"
    OBJECT_STORAGE_UNAVAILABLE = "object_storage_unavailable"
    GATEWAY_UNAVAILABLE = "gateway_unavailable"
    INTERNAL_ERROR = "internal_error"


class JobError(Exception):
    """Base class for every expected job failure; ``str()`` is the BullMQ failedReason."""

    def __init__(self, code: FailureCode, detail: str) -> None:
        super().__init__(f"{code.value}: {detail}")
        self.code = code
        self.detail = detail


class PermanentJobError(JobError):
    """Retrying cannot succeed (bad input, unsupported or broken document)."""


class RetryableJobError(JobError):
    """A dependency was unavailable; the same job may succeed on a later attempt."""
