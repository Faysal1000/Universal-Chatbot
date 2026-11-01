"""Object storage on S3 or MinIO through boto3, with failures translated into job failures."""

from typing import TYPE_CHECKING

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.application.ports import StoredObject
from app.domain.errors import FailureCode, PermanentJobError, RetryableJobError

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client

MISSING_OBJECT_ERROR_CODES = frozenset({"NoSuchKey", "404", "NotFound"})
MISSING_BUCKET_ERROR_CODES = frozenset({"NoSuchBucket"})
SDK_RETRY_ATTEMPTS = 3
CONNECT_TIMEOUT_SECONDS = 5


def create_s3_client(
    endpoint_url: str | None,
    region: str,
    access_key_id: str,
    secret_access_key: str,
    force_path_style: bool,
    timeout_seconds: float,
) -> "S3Client":
    configuration = Config(
        region_name=region,
        connect_timeout=CONNECT_TIMEOUT_SECONDS,
        read_timeout=timeout_seconds,
        retries={"max_attempts": SDK_RETRY_ATTEMPTS, "mode": "standard"},
        s3={"addressing_style": "path" if force_path_style else "auto"},
        signature_version="s3v4",
    )
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        config=configuration,
    )


class S3ObjectStorage:
    def __init__(self, client: "S3Client") -> None:
        self._client = client

    def read_object(self, location: StoredObject, maximum_bytes: int) -> bytes:
        try:
            response = self._client.get_object(Bucket=location.bucket, Key=location.key)
        except ClientError as error:
            if _error_code(error) in MISSING_OBJECT_ERROR_CODES | MISSING_BUCKET_ERROR_CODES:
                raise PermanentJobError(
                    FailureCode.SOURCE_NOT_FOUND, f"object {location.key} does not exist in {location.bucket}"
                ) from error
            raise _unavailable("read", location, error) from error
        except BotoCoreError as error:
            raise _unavailable("read", location, error) from error
        if response["ContentLength"] > maximum_bytes:
            response["Body"].close()
            raise PermanentJobError(
                FailureCode.SOURCE_TOO_LARGE,
                f"object {location.key} is {response['ContentLength']} bytes; the limit is {maximum_bytes}",
            )
        return self._read_body(response["Body"], location)

    def read_object_if_exists(self, location: StoredObject) -> bytes | None:
        try:
            response = self._client.get_object(Bucket=location.bucket, Key=location.key)
        except ClientError as error:
            if _error_code(error) in MISSING_OBJECT_ERROR_CODES:
                return None
            raise _unavailable("read", location, error) from error
        except BotoCoreError as error:
            raise _unavailable("read", location, error) from error
        return self._read_body(response["Body"], location)

    def write_object(self, location: StoredObject, body: bytes, content_type: str) -> None:
        try:
            self._client.put_object(
                Bucket=location.bucket, Key=location.key, Body=body, ContentType=content_type
            )
        except (ClientError, BotoCoreError) as error:
            raise _unavailable("write", location, error) from error

    def ensure_bucket_is_reachable(self, bucket: str) -> None:
        """Raises when the bucket is missing, unreachable or not accessible with these credentials."""
        self._client.head_bucket(Bucket=bucket)

    @staticmethod
    def _read_body(body: object, location: StoredObject) -> bytes:
        try:
            return body.read()  # type: ignore[attr-defined, no-any-return]
        except (BotoCoreError, OSError) as error:
            raise _unavailable("read", location, error) from error


def _error_code(error: ClientError) -> str:
    return str(error.response.get("Error", {}).get("Code", ""))


def _unavailable(operation: str, location: StoredObject, error: Exception) -> RetryableJobError:
    return RetryableJobError(
        FailureCode.OBJECT_STORAGE_UNAVAILABLE,
        f"cannot {operation} {location.bucket}/{location.key}: {type(error).__name__}",
    )
