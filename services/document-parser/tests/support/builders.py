"""Builders for contract payloads with sensible defaults."""

import hashlib
from typing import Any
from uuid import UUID

from app.contracts.generated.parse_inspect_v1 import ParseInspectPayload
from app.contracts.generated.parse_pages_v1 import ParsePagesPayload

BUCKET = "rag"
DOCUMENT_ID = UUID("0f8fad5b-d9cb-469f-a165-70867728950e")
INGESTION_RUN_ID = UUID("7c9e6679-7425-40de-944b-e07fc1f90ae7")
OUTPUT_PREFIX = f"documents/{DOCUMENT_ID}/runs/{INGESTION_RUN_ID}/"


def original_key(content: bytes) -> str:
    return f"originals/{hashlib.sha256(content).hexdigest()}"


def an_inspect_payload(
    content: bytes, mime_type: str = "application/pdf", max_pages: int = 200
) -> ParseInspectPayload:
    return ParseInspectPayload.model_validate(
        {
            "documentId": str(DOCUMENT_ID),
            "ingestionRunId": str(INGESTION_RUN_ID),
            "source": {
                "object": {"bucket": BUCKET, "key": original_key(content)},
                "sha256": hashlib.sha256(content).hexdigest(),
                "mimeType": mime_type,
                "byteSize": len(content),
            },
            "outputPrefix": OUTPUT_PREFIX,
            "limits": {"maxPages": max_pages},
        }
    )


def a_page_plan(
    page_number: int, page_kind: str = "digital", tasks: list[str] | None = None
) -> dict[str, Any]:
    return {"pageNumber": page_number, "pageKind": page_kind, "useVisionModelFor": tasks or []}


def a_pages_payload(
    source_key: str,
    pages: list[dict[str, Any]],
    max_vision_calls: int = 8,
    page_timeout_seconds: int = 900,
    batch_number: int = 1,
) -> ParsePagesPayload:
    return ParsePagesPayload.model_validate(
        {
            "documentId": str(DOCUMENT_ID),
            "ingestionRunId": str(INGESTION_RUN_ID),
            "batchNumber": batch_number,
            "parseSource": {"bucket": BUCKET, "key": source_key},
            "pages": pages,
            "outputPrefix": OUTPUT_PREFIX,
            "limits": {
                "maxVisionModelCalls": max_vision_calls,
                "pageTimeoutSeconds": page_timeout_seconds,
                "renderDpi": 72,
            },
        }
    )


def an_envelope(payload: Any, schema_version: object = 1, request_id: str | None = None) -> dict[str, Any]:
    meta: dict[str, Any] = {"schemaVersion": schema_version, "enqueuedAt": "2026-10-29T08:15:30.120Z"}
    if request_id is not None:
        meta["requestId"] = request_id
    return {"meta": meta, "payload": payload}
