"""End-to-end: enqueue real parse.inspect / parse.pages jobs like rag does and read the results.

Needs Redis and MinIO from the root compose plus a running document-parser worker; opt in with
``pytest -m infrastructure tests/integration``. Connection settings come from the environment:

- ``IT_PRODUCER_REDIS_URL``: Redis URL rag uses
- ``IT_S3_ENDPOINT``, ``IT_S3_ACCESS_KEY_ID``, ``IT_S3_SECRET_ACCESS_KEY``: object storage credentials
"""

import asyncio
import hashlib
import json
import os
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import boto3
import pytest
from bullmq import Job, Queue
from mypy_boto3_s3 import S3Client

from app.contracts.generated.block_manifest_record_v1 import BlockManifestRecord
from app.contracts.generated.parse_inspect_v1 import ParseInspectResult
from app.contracts.generated.parse_pages_v1 import ParsePagesResult
from tests.support import pdf_factory

# bullmq leaves a Redis client for the garbage collector after the event loop closes.
pytestmark = [
    pytest.mark.infrastructure,
    pytest.mark.filterwarnings("ignore::pytest.PytestUnraisableExceptionWarning"),
]

BUCKET = "rag"
QUEUE_PREFIX = "rag"
JOB_TIMEOUT_SECONDS = 600
POLL_INTERVAL_SECONDS = 0.25


@dataclass(frozen=True)
class Run:
    document_id: str
    ingestion_run_id: str

    @property
    def output_prefix(self) -> str:
        return f"documents/{self.document_id}/runs/{self.ingestion_run_id}/"

    def job_id(self, stage: str) -> str:
        return f"{self.document_id}:{self.ingestion_run_id}:{stage}"

    def pages_payload(
        self, source_key: str, batch_number: int, page_plans: list[dict[str, Any]]
    ) -> dict[str, Any]:
        return {
            "documentId": self.document_id,
            "ingestionRunId": self.ingestion_run_id,
            "batchNumber": batch_number,
            "parseSource": {"bucket": BUCKET, "key": source_key},
            "pages": page_plans,
            "outputPrefix": self.output_prefix,
            "limits": {"maxVisionModelCalls": 0, "pageTimeoutSeconds": 300, "renderDpi": 144},
        }


def required_environment(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        pytest.skip(f"{name} is not set")
    return value


def an_envelope(payload: dict[str, Any], schema_version: int = 1) -> dict[str, Any]:
    return {
        "meta": {
            "schemaVersion": schema_version,
            "requestId": str(uuid.uuid4()),
            "enqueuedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        },
        "payload": payload,
    }


def a_storage_client(access_key_id: str, secret_access_key: str) -> S3Client:
    return boto3.client(
        "s3",
        endpoint_url=required_environment("IT_S3_ENDPOINT"),
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        region_name="us-east-1",
    )


@pytest.fixture
def storage() -> S3Client:
    return a_storage_client(
        required_environment("IT_S3_ACCESS_KEY_ID"), required_environment("IT_S3_SECRET_ACCESS_KEY")
    )


@pytest.fixture
def run() -> Run:
    return Run(document_id=str(uuid.uuid4()), ingestion_run_id=str(uuid.uuid4()))


@pytest.fixture
def redis_url() -> str:
    return required_environment("IT_PRODUCER_REDIS_URL")


async def enqueue_and_wait(redis_url: str, queue_name: str, job_id: str, envelope: dict[str, Any]) -> Job:
    queue = Queue(queue_name, {"connection": redis_url, "prefix": QUEUE_PREFIX})
    try:
        await queue.add(queue_name, envelope, {"jobId": job_id, "attempts": 3})
        return await wait_until_finished(queue, job_id)
    finally:
        await queue.close()


async def wait_until_finished(queue: Queue, job_id: str) -> Job:
    deadline = time.monotonic() + JOB_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if await queue.getJobState(job_id) in ("completed", "failed"):
            return await Job.fromId(queue, job_id)
        await asyncio.sleep(POLL_INTERVAL_SECONDS)
    raise AssertionError(f"job {job_id} did not finish in {JOB_TIMEOUT_SECONDS} s")


async def run_job(redis_url: str, queue_name: str, job_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    job = await enqueue_and_wait(redis_url, queue_name, job_id, an_envelope(payload))
    assert await job.getState() == "completed", job.failedReason
    return dict(job.returnvalue)


def upload_original(storage: S3Client, content: bytes) -> tuple[str, str]:
    sha256 = hashlib.sha256(content).hexdigest()
    key = f"originals/{sha256}"
    storage.put_object(Bucket=BUCKET, Key=key, Body=content, ContentType="application/pdf")
    return key, sha256


def read_manifest(storage: S3Client, key: str) -> list[BlockManifestRecord]:
    manifest = storage.get_object(Bucket=BUCKET, Key=key)["Body"].read().decode("utf-8")
    return [BlockManifestRecord.model_validate(json.loads(line)) for line in manifest.splitlines()]


async def test_inspect_then_parse_a_digital_pdf(redis_url: str, storage: S3Client, run: Run) -> None:
    pdf_bytes = pdf_factory.build_report_pdf()
    key, sha256 = upload_original(storage, pdf_bytes)
    inspect_payload = {
        "documentId": run.document_id,
        "ingestionRunId": run.ingestion_run_id,
        "source": {
            "object": {"bucket": BUCKET, "key": key},
            "sha256": sha256,
            "mimeType": "application/pdf",
            "byteSize": len(pdf_bytes),
        },
        "outputPrefix": run.output_prefix,
        "limits": {"maxPages": 50},
    }

    inspection = ParseInspectResult.model_validate(
        await run_job(redis_url, "parse.inspect", run.job_id("inspect"), inspect_payload)
    )
    page_plans = [{"pageNumber": 1, "pageKind": "digital", "useVisionModelFor": []}]
    parsed = ParsePagesResult.model_validate(
        await run_job(
            redis_url,
            "parse.pages",
            run.job_id("pages:1"),
            run.pages_payload(inspection.parseSource.key, 1, page_plans),
        )
    )

    records = read_manifest(storage, parsed.manifest.key)
    assert inspection.pages[0].pageKind == "digital"
    assert inspection.pages[0].complexity.hasTables
    assert inspection.detectedLanguage == "en"
    assert parsed.manifest.key == f"{run.output_prefix}blocks-0001.jsonl"
    assert parsed.pages[0].parseMethod == "native"
    assert len(records) == parsed.pages[0].blockCount > 5
    assert records[0].blockType == "heading"


async def test_batch_with_native_and_ocr_pages(redis_url: str, storage: S3Client, run: Run) -> None:
    native_key, _ = upload_original(storage, pdf_factory.build_multi_page_pdf(10))
    scanned_pdf = pdf_factory.build_scanned_pdf(["Quarterly service report", "Revenue grew"])
    scanned_key, _ = upload_original(storage, scanned_pdf)
    native_plans = [
        {"pageNumber": number, "pageKind": "digital", "useVisionModelFor": []} for number in range(1, 11)
    ]
    scanned_plans = [{"pageNumber": 1, "pageKind": "scanned", "useVisionModelFor": ["document_parse"]}]

    native = ParsePagesResult.model_validate(
        await run_job(
            redis_url, "parse.pages", run.job_id("pages:2"), run.pages_payload(native_key, 2, native_plans)
        )
    )
    scanned = ParsePagesResult.model_validate(
        await run_job(
            redis_url, "parse.pages", run.job_id("pages:3"), run.pages_payload(scanned_key, 3, scanned_plans)
        )
    )

    assert [page.parseMethod for page in native.pages] == ["native"] * 10
    assert scanned.pages[0].parseMethod == "ocr_tesseract"
    assert (scanned.pages[0].ocrQualityScore or 0) > 0.6
    assert any("Revenue" in (record.text or "") for record in read_manifest(storage, scanned.manifest.key))


async def test_unknown_schema_version_fails_without_retries(redis_url: str) -> None:
    job = await enqueue_and_wait(
        redis_url, "parse.inspect", f"it-version-{uuid.uuid4()}", an_envelope({}, schema_version=2)
    )

    # Enqueued with attempts=3: being "failed" right after the first attempt proves no retry.
    assert await job.getState() == "failed"
    assert job.failedReason.startswith("unsupported_schema_version: ")
