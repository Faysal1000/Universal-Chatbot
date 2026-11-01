"""Download the documents a job refers to, enforcing bucket, size and checksum rules."""

import hashlib
from dataclasses import dataclass

from app.application.ports import ObjectStorage, StoredObject
from app.domain.errors import FailureCode, PermanentJobError


@dataclass(frozen=True, slots=True)
class SourcePolicy:
    allowed_bucket: str
    maximum_source_bytes: int


@dataclass(frozen=True, slots=True)
class UploadedSource:
    location: StoredObject
    sha256: str
    byte_size: int


class SourceLoader:
    def __init__(self, object_storage: ObjectStorage, policy: SourcePolicy) -> None:
        self._object_storage = object_storage
        self._policy = policy

    def load_uploaded_source(self, source: UploadedSource) -> bytes:
        """The original upload, verified against the size and SHA-256 recorded by ``rag``."""
        self._reject_oversized_upload(source.byte_size)
        content = self.load_object(source.location)
        if hashlib.sha256(content).hexdigest() != source.sha256:
            raise PermanentJobError(
                FailureCode.SOURCE_CHECKSUM_MISMATCH,
                f"object {source.location.key} does not match the SHA-256 recorded at upload",
            )
        return content

    def load_object(self, location: StoredObject) -> bytes:
        self.ensure_bucket_is_allowed(location.bucket)
        return self._object_storage.read_object(location, self._policy.maximum_source_bytes)

    def ensure_bucket_is_allowed(self, bucket: str) -> None:
        if bucket != self._policy.allowed_bucket:
            raise PermanentJobError(
                FailureCode.BUCKET_NOT_ALLOWED,
                f"bucket {bucket!r} is not the configured bucket {self._policy.allowed_bucket!r}",
            )

    def _reject_oversized_upload(self, byte_size: int) -> None:
        if byte_size > self._policy.maximum_source_bytes:
            raise PermanentJobError(
                FailureCode.SOURCE_TOO_LARGE,
                f"upload is {byte_size} bytes; the limit is {self._policy.maximum_source_bytes}",
            )
