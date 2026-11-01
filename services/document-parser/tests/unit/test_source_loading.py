import hashlib

import pytest

from app.application.ports import StoredObject
from app.application.source_loading import SourceLoader, SourcePolicy, UploadedSource
from app.domain.errors import FailureCode, PermanentJobError
from tests.support.doubles import InMemoryObjectStorage

CONTENT = b"%PDF-1.7 content"
LOCATION = StoredObject("rag", "originals/x")


def a_loader(maximum_source_bytes: int = 1000) -> SourceLoader:
    storage = InMemoryObjectStorage()
    storage.put("rag", "originals/x", CONTENT)
    return SourceLoader(
        storage, SourcePolicy(allowed_bucket="rag", maximum_source_bytes=maximum_source_bytes)
    )


def an_upload(
    sha256: str = hashlib.sha256(CONTENT).hexdigest(), byte_size: int = len(CONTENT)
) -> UploadedSource:
    return UploadedSource(location=LOCATION, sha256=sha256, byte_size=byte_size)


def test_verified_upload_is_returned() -> None:
    assert a_loader().load_uploaded_source(an_upload()) == CONTENT


def test_checksum_mismatch_fails_permanently() -> None:
    with pytest.raises(PermanentJobError) as raised:
        a_loader().load_uploaded_source(an_upload(sha256="0" * 64))

    assert raised.value.code is FailureCode.SOURCE_CHECKSUM_MISMATCH


def test_declared_size_over_the_limit_is_rejected_before_download() -> None:
    with pytest.raises(PermanentJobError) as raised:
        a_loader(maximum_source_bytes=5).load_uploaded_source(an_upload(byte_size=10))

    assert raised.value.code is FailureCode.SOURCE_TOO_LARGE


def test_other_buckets_are_not_allowed() -> None:
    with pytest.raises(PermanentJobError) as raised:
        a_loader().load_object(StoredObject("other-bucket", "originals/x"))

    assert raised.value.code is FailureCode.BUCKET_NOT_ALLOWED
