import io
from collections.abc import Iterator

import boto3
import pytest
from botocore.response import StreamingBody
from botocore.stub import Stubber
from mypy_boto3_s3 import S3Client

from app.adapters.s3_object_storage import S3ObjectStorage, create_s3_client
from app.application.ports import StoredObject
from app.domain.errors import FailureCode, PermanentJobError, RetryableJobError

LOCATION = StoredObject("rag", "originals/abc")


@pytest.fixture
def stubbed_client() -> Iterator[tuple[S3Client, Stubber]]:
    client = boto3.client(
        "s3", region_name="us-east-1", aws_access_key_id="test", aws_secret_access_key="test"
    )
    with Stubber(client) as stubber:
        yield client, stubber
        stubber.assert_no_pending_responses()


def a_body(content: bytes) -> StreamingBody:
    return StreamingBody(io.BytesIO(content), len(content))


def test_reads_an_object(stubbed_client: tuple[S3Client, Stubber]) -> None:
    client, stubber = stubbed_client
    stubber.add_response(
        "get_object", {"Body": a_body(b"pdf"), "ContentLength": 3}, {"Bucket": "rag", "Key": "originals/abc"}
    )

    assert S3ObjectStorage(client).read_object(LOCATION, maximum_bytes=10) == b"pdf"


def test_missing_object_is_a_permanent_failure(stubbed_client: tuple[S3Client, Stubber]) -> None:
    client, stubber = stubbed_client
    stubber.add_client_error("get_object", service_error_code="NoSuchKey", http_status_code=404)

    with pytest.raises(PermanentJobError) as raised:
        S3ObjectStorage(client).read_object(LOCATION, maximum_bytes=10)

    assert raised.value.code is FailureCode.SOURCE_NOT_FOUND


def test_oversized_object_is_rejected_before_download(stubbed_client: tuple[S3Client, Stubber]) -> None:
    client, stubber = stubbed_client
    stubber.add_response("get_object", {"Body": a_body(b"x" * 20), "ContentLength": 20})

    with pytest.raises(PermanentJobError) as raised:
        S3ObjectStorage(client).read_object(LOCATION, maximum_bytes=10)

    assert raised.value.code is FailureCode.SOURCE_TOO_LARGE


def test_server_errors_are_retryable(stubbed_client: tuple[S3Client, Stubber]) -> None:
    client, stubber = stubbed_client
    stubber.add_client_error("put_object", service_error_code="InternalError", http_status_code=500)

    with pytest.raises(RetryableJobError) as raised:
        S3ObjectStorage(client).write_object(LOCATION, b"x", "text/plain")

    assert raised.value.code is FailureCode.OBJECT_STORAGE_UNAVAILABLE


def test_access_denied_on_read_is_retryable(stubbed_client: tuple[S3Client, Stubber]) -> None:
    client, stubber = stubbed_client
    stubber.add_client_error("get_object", service_error_code="AccessDenied", http_status_code=403)

    with pytest.raises(RetryableJobError):
        S3ObjectStorage(client).read_object(LOCATION, maximum_bytes=10)


def test_optional_read_returns_none_for_missing_objects(stubbed_client: tuple[S3Client, Stubber]) -> None:
    client, stubber = stubbed_client
    stubber.add_client_error("get_object", service_error_code="NoSuchKey", http_status_code=404)
    stubber.add_response("get_object", {"Body": a_body(b"cached"), "ContentLength": 6})

    storage = S3ObjectStorage(client)

    assert storage.read_object_if_exists(LOCATION) is None
    assert storage.read_object_if_exists(LOCATION) == b"cached"


def test_writes_with_content_type(stubbed_client: tuple[S3Client, Stubber]) -> None:
    client, stubber = stubbed_client
    stubber.add_response(
        "put_object", {}, {"Bucket": "rag", "Key": "originals/abc", "Body": b"x", "ContentType": "image/png"}
    )

    S3ObjectStorage(client).write_object(LOCATION, b"x", "image/png")


def test_bucket_reachability_uses_head_bucket(stubbed_client: tuple[S3Client, Stubber]) -> None:
    client, stubber = stubbed_client
    stubber.add_response("head_bucket", {}, {"Bucket": "rag"})

    S3ObjectStorage(client).ensure_bucket_is_reachable("rag")


def test_client_factory_uses_path_style_for_minio() -> None:
    client = create_s3_client("http://object-storage:9000", "us-east-1", "key", "secret", True, 5)

    assert client.meta.config.s3 == {"addressing_style": "path"}  # type: ignore[attr-defined]
    assert client.meta.endpoint_url == "http://object-storage:9000"
