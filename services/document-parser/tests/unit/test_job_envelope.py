import pytest

from app.application.job_envelope import read_job_metadata, read_job_payload
from app.contracts.generated.parse_inspect_v1 import ParseInspectPayload
from app.domain.errors import FailureCode, PermanentJobError
from tests.support.builders import an_envelope, an_inspect_payload


def valid_payload() -> dict[str, object]:
    return an_inspect_payload(b"%PDF").model_dump(mode="json")


def test_reads_metadata_and_payload() -> None:
    job_data = an_envelope(valid_payload(), request_id="request-1")

    metadata = read_job_metadata(job_data)
    payload = read_job_payload(job_data, ParseInspectPayload)

    assert metadata.requestId == "request-1"
    assert payload.limits.maxPages == 200


@pytest.mark.parametrize("job_data", [None, [], {"payload": {}}, {"meta": "x", "payload": {}}, {"meta": {}}])
def test_malformed_envelopes_are_invalid(job_data: object) -> None:
    with pytest.raises(PermanentJobError) as raised:
        read_job_metadata(job_data)

    assert raised.value.code in (FailureCode.INVALID_JOB_PAYLOAD, FailureCode.UNSUPPORTED_SCHEMA_VERSION)


@pytest.mark.parametrize("schema_version", [2, "1", None])
def test_unknown_major_version_is_rejected(schema_version: object) -> None:
    with pytest.raises(PermanentJobError) as raised:
        read_job_metadata(an_envelope(valid_payload(), schema_version=schema_version))

    assert raised.value.code is FailureCode.UNSUPPORTED_SCHEMA_VERSION
    assert str(raised.value).startswith("unsupported_schema_version: ")


def test_invalid_metadata_field_is_rejected() -> None:
    with pytest.raises(PermanentJobError, match="requestId"):
        read_job_metadata(an_envelope(valid_payload(), request_id="x" * 129))


def test_invalid_payload_names_fields_but_not_values() -> None:
    payload = valid_payload() | {"outputPrefix": "secret-value/../", "extra": "x"}

    with pytest.raises(PermanentJobError) as raised:
        read_job_payload(an_envelope(payload), ParseInspectPayload)

    message = str(raised.value)
    assert message.startswith("invalid_job_payload: invalid payload: ")
    assert "outputPrefix" in message
    assert "extra" in message
    assert "secret-value" not in message


def test_many_validation_errors_are_summarised() -> None:
    with pytest.raises(PermanentJobError, match=r"and \d+ more"):
        read_job_payload(an_envelope({"documentId": 1, "a": 1, "b": 2, "c": 3}), ParseInspectPayload)
