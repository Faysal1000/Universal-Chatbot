"""Use case for ``parse.pages``: parse a batch of pages into a JSON Lines block manifest."""

from collections.abc import Sequence

from app.application.page_parser import BatchVisionState, PageParser, PageTask, ParsedPage
from app.application.ports import ObjectStorage, PdfDocument, PdfOpener, ProgressReporter, StoredObject
from app.application.source_loading import SourceLoader
from app.contracts.generated.block_manifest_record_v1 import BlockManifestRecord
from app.contracts.generated.parse_pages_v1 import (
    ObjectReference,
    PagePlan,
    ParsePagesPayload,
    ParsePagesResult,
)
from app.domain.errors import FailureCode, PermanentJobError
from app.domain.object_keys import manifest_key
from app.domain.parse_strategy import VisionCallBudget

MANIFEST_CONTENT_TYPE = "application/x-ndjson"


class ParsePageBatch:
    def __init__(
        self,
        source_loader: SourceLoader,
        object_storage: ObjectStorage,
        pdf_opener: PdfOpener,
        page_parser: PageParser,
    ) -> None:
        self._source_loader = source_loader
        self._object_storage = object_storage
        self._pdf_opener = pdf_opener
        self._page_parser = page_parser

    def execute(self, payload: ParsePagesPayload, progress_reporter: ProgressReporter) -> ParsePagesResult:
        self._source_loader.ensure_bucket_is_allowed(payload.parseSource.bucket)
        source_location = StoredObject(bucket=payload.parseSource.bucket, key=payload.parseSource.key)
        pdf_bytes = self._source_loader.load_object(source_location)
        vision_state = BatchVisionState(
            budget=VisionCallBudget(maximum_calls=payload.limits.maxVisionModelCalls)
        )
        with self._pdf_opener.open_document(pdf_bytes) as document:
            ensure_pages_exist(payload.pages, document.page_count)
            parsed_pages = self._parse_pages(payload, document, pdf_bytes, vision_state, progress_reporter)
        manifest_location = self._write_manifest(payload, parsed_pages)
        return ParsePagesResult(
            documentId=payload.documentId,
            ingestionRunId=payload.ingestionRunId,
            batchNumber=payload.batchNumber,
            manifest=ObjectReference(bucket=manifest_location.bucket, key=manifest_location.key),
            pages=[parsed_page.summary for parsed_page in parsed_pages],
            visionModelCallCount=vision_state.budget.used_calls,
        )

    def _parse_pages(
        self,
        payload: ParsePagesPayload,
        document: PdfDocument,
        pdf_bytes: bytes,
        vision_state: BatchVisionState,
        progress_reporter: ProgressReporter,
    ) -> list[ParsedPage]:
        parsed_pages: list[ParsedPage] = []
        for page_plan in payload.pages:
            task = PageTask(
                document=document,
                pdf_bytes=pdf_bytes,
                plan=page_plan,
                bucket=payload.parseSource.bucket,
                output_prefix=payload.outputPrefix,
                ingestion_run_id=payload.ingestionRunId,
                render_dpi=payload.limits.renderDpi,
                page_timeout_seconds=payload.limits.pageTimeoutSeconds,
                vision_state=vision_state,
            )
            parsed_pages.append(self._page_parser.parse_page(task))
            progress_reporter.report_progress(len(parsed_pages), len(payload.pages))
        return parsed_pages

    def _write_manifest(self, payload: ParsePagesPayload, parsed_pages: Sequence[ParsedPage]) -> StoredObject:
        location = StoredObject(
            bucket=payload.parseSource.bucket, key=manifest_key(payload.outputPrefix, payload.batchNumber)
        )
        records = [record for parsed_page in parsed_pages for record in parsed_page.records]
        self._object_storage.write_object(location, serialise_manifest(records), MANIFEST_CONTENT_TYPE)
        return location


def serialise_manifest(records: Sequence[BlockManifestRecord]) -> bytes:
    """JSON Lines: one record per line, UTF-8, every line terminated by a newline."""
    return b"".join(record.model_dump_json().encode("utf-8") + b"\n" for record in records)


def ensure_pages_exist(page_plans: Sequence[PagePlan], page_count: int) -> None:
    missing_pages = sorted(plan.pageNumber for plan in page_plans if plan.pageNumber > page_count)
    if missing_pages:
        raise PermanentJobError(
            FailureCode.PAGE_OUT_OF_RANGE,
            f"pages {missing_pages} do not exist; the document has {page_count} pages",
        )
