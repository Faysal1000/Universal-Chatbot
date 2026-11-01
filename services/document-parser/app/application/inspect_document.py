"""Use case for ``parse.inspect``: make the upload a PDF and classify every page."""

from dataclasses import dataclass

from app.application.ports import (
    ImageToPdfConverter,
    ObjectStorage,
    PdfDocument,
    PdfOpener,
    ProgressReporter,
    StoredObject,
)
from app.application.source_loading import SourceLoader, UploadedSource
from app.contracts.generated.parse_inspect_v1 import (
    ObjectReference,
    PageComplexity,
    PageInspection,
    ParseInspectPayload,
    ParseInspectResult,
)
from app.domain.errors import FailureCode, PermanentJobError
from app.domain.language_detection import (
    ScriptCharacterCounts,
    count_script_characters,
    detect_language_from_counts,
)
from app.domain.object_keys import converted_source_key
from app.domain.page_classification import classify_page_kind, text_coverage_ratio
from app.domain.page_complexity import assess_page_complexity
from app.domain.page_layout import PageLayoutSnapshot
from app.domain.source_formats import resolve_source_format

PDF_CONTENT_TYPE = "application/pdf"
PROGRESS_REPORT_INTERVAL_PAGES = 10
RATIO_DECIMAL_PLACES = 4
POINTS_DECIMAL_PLACES = 2


@dataclass(frozen=True, slots=True)
class ParseSource:
    location: StoredObject
    pdf_bytes: bytes


@dataclass(slots=True)
class _InspectionProgress:
    pages: list[PageInspection]
    language_counts: ScriptCharacterCounts


class InspectDocument:
    def __init__(
        self,
        source_loader: SourceLoader,
        object_storage: ObjectStorage,
        pdf_opener: PdfOpener,
        image_converter: ImageToPdfConverter,
    ) -> None:
        self._source_loader = source_loader
        self._object_storage = object_storage
        self._pdf_opener = pdf_opener
        self._image_converter = image_converter

    def execute(
        self, payload: ParseInspectPayload, progress_reporter: ProgressReporter
    ) -> ParseInspectResult:
        parse_source = self._prepare_parse_source(payload)
        with self._pdf_opener.open_document(parse_source.pdf_bytes) as document:
            enforce_page_limit(document.page_count, payload.limits.maxPages)
            inspection = self._inspect_pages(document, progress_reporter)
        return ParseInspectResult(
            documentId=payload.documentId,
            ingestionRunId=payload.ingestionRunId,
            parseSource=ObjectReference(bucket=parse_source.location.bucket, key=parse_source.location.key),
            pageCount=len(inspection.pages),
            detectedLanguage=detect_language_from_counts(inspection.language_counts),
            pages=inspection.pages,
        )

    def _prepare_parse_source(self, payload: ParseInspectPayload) -> ParseSource:
        source_format = resolve_source_format(payload.source.mimeType)
        original_location = StoredObject(bucket=payload.source.object.bucket, key=payload.source.object.key)
        source_bytes = self._source_loader.load_uploaded_source(
            UploadedSource(
                location=original_location, sha256=payload.source.sha256, byte_size=payload.source.byteSize
            )
        )
        if source_format == "pdf":
            return ParseSource(location=original_location, pdf_bytes=source_bytes)
        return self._convert_image_upload(payload, source_bytes)

    def _convert_image_upload(self, payload: ParseInspectPayload, image_bytes: bytes) -> ParseSource:
        pdf_bytes = self._image_converter.convert_to_pdf(image_bytes, maximum_pages=payload.limits.maxPages)
        converted_location = StoredObject(
            bucket=payload.source.object.bucket, key=converted_source_key(payload.outputPrefix)
        )
        self._object_storage.write_object(converted_location, pdf_bytes, PDF_CONTENT_TYPE)
        return ParseSource(location=converted_location, pdf_bytes=pdf_bytes)

    def _inspect_pages(
        self, document: PdfDocument, progress_reporter: ProgressReporter
    ) -> _InspectionProgress:
        progress = _InspectionProgress(pages=[], language_counts=ScriptCharacterCounts())
        for page_number in range(1, document.page_count + 1):
            snapshot = document.inspect_page(page_number)
            progress.pages.append(build_page_inspection(page_number, snapshot))
            progress.language_counts += count_script_characters(snapshot.text)
            if page_number % PROGRESS_REPORT_INTERVAL_PAGES == 0 or page_number == document.page_count:
                progress_reporter.report_progress(page_number, document.page_count)
        return progress


def enforce_page_limit(page_count: int, maximum_pages: int) -> None:
    if page_count == 0:
        raise PermanentJobError(FailureCode.CORRUPT_DOCUMENT, "the document has no pages")
    if page_count > maximum_pages:
        raise PermanentJobError(
            FailureCode.TOO_MANY_PAGES, f"the document has {page_count} pages; the limit is {maximum_pages}"
        )


def build_page_inspection(page_number: int, snapshot: PageLayoutSnapshot) -> PageInspection:
    complexity = assess_page_complexity(snapshot)
    return PageInspection(
        pageNumber=page_number,
        pageKind=classify_page_kind(snapshot),
        widthPoints=round(snapshot.page_size.width, POINTS_DECIMAL_PLACES),
        heightPoints=round(snapshot.page_size.height, POINTS_DECIMAL_PLACES),
        textCoverageRatio=round(text_coverage_ratio(snapshot), RATIO_DECIMAL_PLACES),
        complexity=PageComplexity(
            hasTables=complexity.has_tables,
            hasFormulas=complexity.has_formulas,
            hasCharts=complexity.has_charts,
            hasImages=complexity.has_images,
            hasMultipleColumns=complexity.has_multiple_columns,
        ),
    )
