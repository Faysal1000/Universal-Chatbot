"""Parse one planned page into manifest records, following the policy in ``parse_strategy``."""

import logging
from dataclasses import dataclass, field
from uuid import UUID

from app.application.ports import (
    DocumentParseGateway,
    GatewayDeadlineExceededError,
    GatewayRejectedError,
    GatewayUnavailableError,
    NativeTextExtractor,
    NemotronPostprocessor,
    ObjectStorage,
    OcrEngine,
    OcrTimeoutError,
    PdfDocument,
    RenderedPage,
    StoredObject,
)
from app.contracts.generated.block_manifest_record_v1 import BlockManifestRecord, NormalisedBoundingBox
from app.contracts.generated.parse_pages_v1 import PagePlan, ParsedPageSummary
from app.domain.blocks import DraftBlock, derive_block_id
from app.domain.errors import FailureCode, RetryableJobError
from app.domain.language_detection import detect_language
from app.domain.object_keys import crop_key, page_render_key, vision_markup_cache_key
from app.domain.ocr_layout import group_words_into_text_boxes, score_ocr_quality
from app.domain.parse_strategy import (
    Deadline,
    FallbackReason,
    PageParseMethod,
    VisionCallBudget,
    fallback_method,
    method_without_vision_model,
    wants_vision_model,
)
from app.domain.text_layer_blocks import build_text_layer_blocks
from app.domain.vision_blocks import build_vision_blocks

PNG_CONTENT_TYPE = "image/png"
TEXT_CONTENT_TYPE = "text/plain; charset=utf-8"
EXTRACTION_METHOD_BY_PARSE_METHOD: dict[PageParseMethod, str] = {
    "native": "native",
    "ocr_tesseract": "ocr_tesseract",
    "vlm": "vlm:document_parse",
}
TIMED_OUT_OCR_QUALITY_SCORE = 0.0

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class PageParsingSettings:
    ocr_render_dpi: int
    minimum_ocr_seconds: float


@dataclass(slots=True)
class BatchVisionState:
    """Vision-model state shared by the pages of one batch."""

    budget: VisionCallBudget
    is_gateway_disabled: bool = False

    def unavailability_reason(self) -> FallbackReason | None:
        if self.is_gateway_disabled:
            return FallbackReason.GATEWAY_DISABLED
        if self.budget.is_exhausted:
            return FallbackReason.BUDGET_EXHAUSTED
        return None


@dataclass(frozen=True, slots=True)
class PageTask:
    """Everything needed to parse one page of a batch."""

    document: PdfDocument
    pdf_bytes: bytes
    plan: PagePlan
    bucket: str
    output_prefix: str
    ingestion_run_id: UUID
    render_dpi: int
    page_timeout_seconds: int
    vision_state: BatchVisionState


@dataclass(slots=True)
class PageExtraction:
    method: PageParseMethod
    blocks: list[DraftBlock]
    rendered_page: RenderedPage | None = None
    render_key: str | None = None
    ocr_quality_score: float | None = None


@dataclass(frozen=True, slots=True)
class ParsedPage:
    summary: ParsedPageSummary
    records: list[BlockManifestRecord] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class PageParserDependencies:
    object_storage: ObjectStorage
    native_text_extractor: NativeTextExtractor
    ocr_engine: OcrEngine
    gateway: DocumentParseGateway
    nemotron_postprocessor: NemotronPostprocessor


class PageParser:
    def __init__(self, dependencies: PageParserDependencies, settings: PageParsingSettings) -> None:
        self._dependencies = dependencies
        self._settings = settings

    def parse_page(self, task: PageTask) -> ParsedPage:
        extraction = self._extract(task, Deadline.after_seconds(task.page_timeout_seconds))
        try:
            records = self._build_records(task, extraction)
        finally:
            _close_rendered_page(extraction)
        return ParsedPage(summary=_summarise(task, extraction, len(records)), records=records)

    # ------------------------------------------------------------------ method selection

    def _extract(self, task: PageTask, deadline: Deadline) -> PageExtraction:
        if wants_vision_model(task.plan.useVisionModelFor):
            return self._extract_with_vision_model(task, deadline)
        return self._extract_without_vision_model(
            task, method_without_vision_model(task.plan.pageKind), deadline
        )

    def _extract_with_vision_model(self, task: PageTask, deadline: Deadline) -> PageExtraction:
        cached_markup = self._read_cached_markup(task)
        unavailability_reason = task.vision_state.unavailability_reason()
        if cached_markup is None and unavailability_reason is not None:
            return self._fall_back(task, unavailability_reason, deadline)
        rendered_page = self._render_page(task, task.render_dpi)
        try:
            return self._parse_rendered_page(task, rendered_page, cached_markup, deadline)
        except BaseException:
            rendered_page.close()
            raise

    def _parse_rendered_page(
        self, task: PageTask, rendered_page: RenderedPage, cached_markup: str | None, deadline: Deadline
    ) -> PageExtraction:
        render_key = self._store_render(task, rendered_page)
        try:
            markup = cached_markup or self._call_gateway(task, rendered_page, deadline)
        except GatewayRejectedError as error:
            logger.warning("Vision model rejected page %s: %s", task.plan.pageNumber, error)
            if error.disables_gateway:
                task.vision_state.is_gateway_disabled = True
            rendered_page.close()
            return self._fall_back(task, FallbackReason.GATEWAY_REJECTED, deadline, render_key)
        except GatewayDeadlineExceededError:
            rendered_page.close()
            return self._fall_back(task, FallbackReason.PAGE_TIMEOUT, deadline, render_key)
        nemotron_blocks = self._dependencies.nemotron_postprocessor.postprocess(markup, rendered_page.size)
        return PageExtraction(
            method="vlm",
            blocks=build_vision_blocks(nemotron_blocks),
            rendered_page=rendered_page,
            render_key=render_key,
        )

    def _fall_back(
        self, task: PageTask, reason: FallbackReason, deadline: Deadline, render_key: str | None = None
    ) -> PageExtraction:
        method = fallback_method(task.plan.pageKind)
        logger.info("Page %s falls back to %s (%s)", task.plan.pageNumber, method, reason.value)
        extraction = self._extract_without_vision_model(task, method, deadline)
        extraction.render_key = render_key
        return extraction

    def _extract_without_vision_model(
        self, task: PageTask, method: PageParseMethod, deadline: Deadline
    ) -> PageExtraction:
        if method == "ocr_tesseract":
            return self._extract_with_ocr(task, deadline)
        return self._extract_natively(task)

    # ------------------------------------------------------------------ extraction methods

    def _extract_natively(self, task: PageTask) -> PageExtraction:
        text_boxes, page_size = self._dependencies.native_text_extractor.extract_text_boxes(
            task.pdf_bytes, task.plan.pageNumber
        )
        return PageExtraction(method="native", blocks=build_text_layer_blocks(text_boxes, page_size))

    def _extract_with_ocr(self, task: PageTask, deadline: Deadline) -> PageExtraction:
        timeout_seconds = max(deadline.remaining_seconds(), self._settings.minimum_ocr_seconds)
        rendered_page = self._render_page(task, max(task.render_dpi, self._settings.ocr_render_dpi))
        try:
            words = self._dependencies.ocr_engine.recognise_words(rendered_page, timeout_seconds)
            page_size = rendered_page.size
        except OcrTimeoutError:
            logger.warning("OCR of page %s timed out after %.0f s", task.plan.pageNumber, timeout_seconds)
            return PageExtraction(
                method="ocr_tesseract", blocks=[], ocr_quality_score=TIMED_OUT_OCR_QUALITY_SCORE
            )
        finally:
            rendered_page.close()
        blocks = build_text_layer_blocks(group_words_into_text_boxes(words), page_size)
        return PageExtraction(
            method="ocr_tesseract", blocks=blocks, ocr_quality_score=score_ocr_quality(words)
        )

    def _call_gateway(self, task: PageTask, rendered_page: RenderedPage, deadline: Deadline) -> str:
        task.vision_state.budget.spend_one_call()
        try:
            markup = self._dependencies.gateway.parse_page_image(rendered_page.to_png(), deadline)
        except GatewayUnavailableError as error:
            raise RetryableJobError(
                FailureCode.GATEWAY_UNAVAILABLE,
                f"vision model unavailable for page {task.plan.pageNumber}: {error}",
            ) from error
        self._dependencies.object_storage.write_object(
            StoredObject(task.bucket, vision_markup_cache_key(task.output_prefix, task.plan.pageNumber)),
            markup.encode("utf-8"),
            TEXT_CONTENT_TYPE,
        )
        return markup

    def _read_cached_markup(self, task: PageTask) -> str | None:
        cache_location = StoredObject(
            task.bucket, vision_markup_cache_key(task.output_prefix, task.plan.pageNumber)
        )
        cached_bytes = self._dependencies.object_storage.read_object_if_exists(cache_location)
        return cached_bytes.decode("utf-8") if cached_bytes is not None else None

    def _render_page(self, task: PageTask, dots_per_inch: int) -> RenderedPage:
        return task.document.render_page(task.plan.pageNumber, dots_per_inch)

    def _store_render(self, task: PageTask, rendered_page: RenderedPage) -> str:
        render_key = page_render_key(task.output_prefix, task.plan.pageNumber)
        self._dependencies.object_storage.write_object(
            StoredObject(task.bucket, render_key), rendered_page.to_png(), PNG_CONTENT_TYPE
        )
        return render_key

    # ------------------------------------------------------------------ manifest records

    def _build_records(self, task: PageTask, extraction: PageExtraction) -> list[BlockManifestRecord]:
        return [
            self._build_record(task, extraction, reading_order, block.within_contract_limits())
            for reading_order, block in enumerate(extraction.blocks)
        ]

    def _build_record(
        self, task: PageTask, extraction: PageExtraction, reading_order: int, block: DraftBlock
    ) -> BlockManifestRecord:
        block_id = derive_block_id(task.ingestion_run_id, task.plan.pageNumber, reading_order)
        return BlockManifestRecord(
            blockId=block_id,
            pageNumber=task.plan.pageNumber,
            blockType=block.block_type,
            readingOrder=reading_order,
            text=block.text,
            markdown=block.markdown,
            latex=block.latex,
            bbox=NormalisedBoundingBox(x0=block.box.x0, y0=block.box.y0, x1=block.box.x1, y1=block.box.y1),
            headingLevel=block.heading_level,
            extractionMethod=EXTRACTION_METHOD_BY_PARSE_METHOD[extraction.method],
            confidence=block.confidence,
            cropKey=self._store_crop(task, extraction, block, block_id),
            language=detect_language(block.text),
        )

    def _store_crop(
        self, task: PageTask, extraction: PageExtraction, block: DraftBlock, block_id: UUID
    ) -> str | None:
        if not block.needs_crop or extraction.rendered_page is None:
            return None
        key = crop_key(task.output_prefix, block_id)
        crop_png = extraction.rendered_page.crop_to_png(block.box)
        self._dependencies.object_storage.write_object(
            StoredObject(task.bucket, key), crop_png, PNG_CONTENT_TYPE
        )
        return key


def _summarise(task: PageTask, extraction: PageExtraction, block_count: int) -> ParsedPageSummary:
    return ParsedPageSummary(
        pageNumber=task.plan.pageNumber,
        parseMethod=extraction.method,
        ocrQualityScore=extraction.ocr_quality_score,
        renderKey=extraction.render_key,
        blockCount=block_count,
    )


def _close_rendered_page(extraction: PageExtraction) -> None:
    if extraction.rendered_page is not None:
        extraction.rendered_page.close()
