"""Read the versioned envelope ``{meta, payload}`` around every job's data.

Metadata is read first (and on its own) so the worker can join the producer's trace even
when the payload turns out to be invalid. Every problem is a permanent failure: a job whose
data is wrong now will be wrong on every retry.
"""

from typing import Any

from pydantic import BaseModel, ValidationError

from app.application.validation_messages import describe_validation_error
from app.contracts.generated.job_envelope_v1 import JobEnvelope, JobMetadata
from app.domain.errors import FailureCode, PermanentJobError

SUPPORTED_SCHEMA_VERSION = 1


def read_job_metadata(job_data: object) -> JobMetadata:
    if (
        not isinstance(job_data, dict)
        or not isinstance(job_data.get("meta"), dict)
        or "payload" not in job_data
    ):
        raise PermanentJobError(
            FailureCode.INVALID_JOB_PAYLOAD, 'job data must be an object with "meta" and "payload"'
        )
    schema_version = job_data["meta"].get("schemaVersion")
    if schema_version != SUPPORTED_SCHEMA_VERSION:
        raise PermanentJobError(
            FailureCode.UNSUPPORTED_SCHEMA_VERSION,
            f"envelope schemaVersion {schema_version!r} is not supported "
            f"(expected {SUPPORTED_SCHEMA_VERSION})",
        )
    return _validate(JobEnvelope, job_data, "envelope").meta


def read_job_payload[PayloadModel: BaseModel](
    job_data: dict[str, Any], payload_model: type[PayloadModel]
) -> PayloadModel:
    return _validate(payload_model, job_data["payload"], "payload")


def _validate[Model: BaseModel](model: type[Model], data: object, description: str) -> Model:
    try:
        return model.model_validate(data)
    except ValidationError as error:
        raise PermanentJobError(
            FailureCode.INVALID_JOB_PAYLOAD, f"invalid {description}: {describe_validation_error(error)}"
        ) from error
