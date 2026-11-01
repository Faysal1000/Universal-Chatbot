import io
import json
import logging

import pytest

from app.adapters.nemotron_postprocessing import NvidiaNemotronPostprocessor
from app.adapters.pdfium_document import PdfiumOpener
from app.adapters.pdfminer_text_extractor import PdfminerTextExtractor
from app.application.page_parser import PageParser, PageParserDependencies, PageParsingSettings
from app.application.parse_page_batch import ParsePageBatch
from app.application.ports import GatewayDeadlineExceededError, GatewayRejectedError, GatewayUnavailableError
from app.application.source_loading import SourceLoader, SourcePolicy
from app.contracts.generated.block_manifest_record_v1 import BlockManifestRecord
from app.contracts.generated.parse_pages_v1 import ParsePagesResult
from app.domain.blocks import derive_block_id
from app.domain.errors import FailureCode, PermanentJobError, RetryableJobError
from app.domain.parse_strategy import FallbackReason
from tests.support import pdf_factory
from tests.support.builders import BUCKET, INGESTION_RUN_ID, OUTPUT_PREFIX, a_page_plan, a_pages_payload
from tests.support.doubles import (
    FakeOcrEngine,
    InMemoryObjectStorage,
    RecordingProgressReporter,
    ScriptedGateway,
)

SOURCE_KEY = "originals/source"
NEMOTRON_MARKUP = (
    "<x_0.08><y_0.08>Quarterly Report<x_0.5><y_0.11><class_Title>"
    r"<x_0.08><y_0.2>\begin{tabular}{cc} Plan & Price \\ Starter & 19 \\ \end{tabular}"
    "<x_0.9><y_0.3><class_Table>"
    "<x_0.08><y_0.35>ঢাকা অঞ্চলে বিক্রয় বৃদ্ধি পেয়েছে<x_0.9><y_0.4><class_Text>"
)


class BatchScenario:
    def __init__(
        self, pdf_bytes: bytes, gateway: ScriptedGateway | None = None, ocr: FakeOcrEngine | None = None
    ) -> None:
        self.storage = InMemoryObjectStorage()
        self.storage.put(BUCKET, SOURCE_KEY, pdf_bytes)
        self.gateway = gateway or ScriptedGateway()
        self.ocr = ocr or FakeOcrEngine(["Scanned letter text", "Second scanned line"])
        self.progress = RecordingProgressReporter()
        page_parser = PageParser(
            PageParserDependencies(
                object_storage=self.storage,
                native_text_extractor=PdfminerTextExtractor(),
                ocr_engine=self.ocr,
                gateway=self.gateway,
                nemotron_postprocessor=NvidiaNemotronPostprocessor(),
            ),
            PageParsingSettings(ocr_render_dpi=100, minimum_ocr_seconds=30),
        )
        self.use_case = ParsePageBatch(
            SourceLoader(self.storage, SourcePolicy(allowed_bucket=BUCKET, maximum_source_bytes=50_000_000)),
            self.storage,
            PdfiumOpener(),
            page_parser,
        )

    def parse(self, pages: list[dict[str, object]], **limits: int) -> ParsePagesResult:
        return self.use_case.execute(a_pages_payload(SOURCE_KEY, pages, **limits), self.progress)

    def manifest_records(self, result: ParsePagesResult) -> list[BlockManifestRecord]:
        manifest = self.storage.body_of(result.manifest.bucket, result.manifest.key).decode("utf-8")
        return [BlockManifestRecord.model_validate(json.loads(line)) for line in manifest.splitlines()]


def fallback_reasons(caplog: pytest.LogCaptureFixture) -> list[FallbackReason]:
    """Reasons from the page parser's "falls back" log lines, in order."""
    return [
        FallbackReason(record.args[2])
        for record in caplog.records
        if record.msg == "Page %s falls back to %s (%s)" and isinstance(record.args, tuple)
    ]


def test_digital_page_is_parsed_natively_into_a_valid_manifest() -> None:
    scenario = BatchScenario(pdf_factory.build_report_pdf())

    result = scenario.parse([a_page_plan(1)])

    records = scenario.manifest_records(result)
    assert result.manifest.key == f"{OUTPUT_PREFIX}blocks-0001.jsonl"
    assert result.pages[0].parseMethod == "native"
    assert result.pages[0].blockCount == len(records) > 5
    assert result.visionModelCallCount == 0
    assert {record.extractionMethod for record in records} == {"native"}
    assert records[0].blockType == "heading"
    assert records[0].headingLevel == 1
    assert [record.readingOrder for record in records] == list(range(len(records)))
    assert records[0].blockId == derive_block_id(INGESTION_RUN_ID, 1, 0)
    assert records[0].language == "en"
    assert scenario.progress.reports == [(1, 1)]


def test_retry_produces_identical_manifest() -> None:
    scenario = BatchScenario(pdf_factory.build_report_pdf())

    first = scenario.storage.body_of(BUCKET, scenario.parse([a_page_plan(1)]).manifest.key)
    second = scenario.storage.body_of(BUCKET, scenario.parse([a_page_plan(1)]).manifest.key)

    assert first == second


def test_document_parse_page_uses_the_vision_model() -> None:
    scenario = BatchScenario(pdf_factory.build_report_pdf(), gateway=ScriptedGateway(NEMOTRON_MARKUP))

    result = scenario.parse([a_page_plan(1, "digital", ["document_parse"])])

    records = scenario.manifest_records(result)
    summary = result.pages[0]
    assert (summary.parseMethod, summary.renderKey, result.visionModelCallCount) == (
        "vlm",
        f"{OUTPUT_PREFIX}pages/1.png",
        1,
    )
    assert [record.blockType for record in records] == ["heading", "table", "paragraph"]
    assert {record.extractionMethod for record in records} == {"vlm:document_parse"}
    assert records[1].markdown == "| Plan | Price |\n| --- | --- |\n| Starter | 19 |"
    assert records[1].cropKey == f"{OUTPUT_PREFIX}crops/{records[1].blockId}.png"
    assert scenario.storage.body_of(BUCKET, records[1].cropKey).startswith(b"\x89PNG")
    assert records[2].language == "bn"
    assert scenario.gateway.received_images[0].startswith(b"\x89PNG")


def test_cached_vision_output_is_reused_on_retry() -> None:
    scenario = BatchScenario(pdf_factory.build_report_pdf(), gateway=ScriptedGateway(NEMOTRON_MARKUP))
    vision_page = [a_page_plan(1, "digital", ["document_parse"])]

    scenario.parse(vision_page)
    retried = scenario.parse(vision_page)

    assert retried.pages[0].parseMethod == "vlm"
    assert retried.visionModelCallCount == 0
    assert len(scenario.gateway.received_images) == 1


def test_scanned_page_falls_back_to_ocr_when_budget_is_spent(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    scenario = BatchScenario(pdf_factory.build_scanned_pdf(["Scanned letter"]))

    result = scenario.parse([a_page_plan(1, "scanned", ["document_parse"])], max_vision_calls=0)

    records = scenario.manifest_records(result)
    assert result.pages[0].parseMethod == "ocr_tesseract"
    assert result.pages[0].ocrQualityScore == 0.9
    assert result.pages[0].renderKey is None
    assert records[0].extractionMethod == "ocr_tesseract"
    assert records[0].confidence == 0.9
    assert fallback_reasons(caplog) == [FallbackReason.BUDGET_EXHAUSTED]


def test_budget_limits_vision_calls_within_the_batch() -> None:
    scenario = BatchScenario(pdf_factory.build_multi_page_pdf(2), gateway=ScriptedGateway(NEMOTRON_MARKUP))
    pages = [a_page_plan(1, "digital", ["document_parse"]), a_page_plan(2, "digital", ["document_parse"])]

    result = scenario.parse(pages, max_vision_calls=1)

    assert [page.parseMethod for page in result.pages] == ["vlm", "native"]
    assert result.visionModelCallCount == 1


def test_rejected_page_falls_back_and_keeps_its_render() -> None:
    gateway = ScriptedGateway(GatewayRejectedError("HTTP 422", disables_gateway=False), NEMOTRON_MARKUP)
    scenario = BatchScenario(pdf_factory.build_multi_page_pdf(2), gateway=gateway)
    pages = [a_page_plan(1, "hybrid", ["document_parse"]), a_page_plan(2, "digital", ["document_parse"])]

    result = scenario.parse(pages)

    assert [page.parseMethod for page in result.pages] == ["ocr_tesseract", "vlm"]
    assert result.pages[0].renderKey == f"{OUTPUT_PREFIX}pages/1.png"
    assert result.visionModelCallCount == 2


def test_misconfigured_gateway_is_disabled_for_the_rest_of_the_batch(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    gateway = ScriptedGateway(GatewayRejectedError("HTTP 401", disables_gateway=True))
    scenario = BatchScenario(pdf_factory.build_multi_page_pdf(2), gateway=gateway)
    pages = [a_page_plan(1, "digital", ["document_parse"]), a_page_plan(2, "digital", ["document_parse"])]

    result = scenario.parse(pages)

    assert [page.parseMethod for page in result.pages] == ["native", "native"]
    assert fallback_reasons(caplog) == [
        FallbackReason.GATEWAY_REJECTED,
        FallbackReason.GATEWAY_DISABLED,
    ]
    assert len(gateway.received_images) == 1


def test_page_timeout_falls_back(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)
    scenario = BatchScenario(
        pdf_factory.build_report_pdf(), gateway=ScriptedGateway(GatewayDeadlineExceededError())
    )

    result = scenario.parse([a_page_plan(1, "digital", ["document_parse"])])

    assert result.pages[0].parseMethod == "native"
    assert fallback_reasons(caplog) == [FallbackReason.PAGE_TIMEOUT]


def test_gateway_outage_fails_the_job_for_a_retry() -> None:
    scenario = BatchScenario(
        pdf_factory.build_report_pdf(), gateway=ScriptedGateway(GatewayUnavailableError("down"))
    )

    with pytest.raises(RetryableJobError) as raised:
        scenario.parse([a_page_plan(1, "digital", ["document_parse"])])

    assert raised.value.code is FailureCode.GATEWAY_UNAVAILABLE


def test_scanned_page_without_vision_request_uses_ocr() -> None:
    scenario = BatchScenario(pdf_factory.build_scanned_pdf(["Scanned"]))

    result = scenario.parse([a_page_plan(1, "scanned")])

    assert result.pages[0].parseMethod == "ocr_tesseract"


def test_region_tasks_alone_are_parsed_natively() -> None:
    scenario = BatchScenario(pdf_factory.build_report_pdf())

    result = scenario.parse([a_page_plan(1, "digital", ["table_extraction"])])

    assert result.pages[0].parseMethod == "native"


def test_ocr_timeout_yields_an_empty_page_with_zero_quality() -> None:
    scenario = BatchScenario(pdf_factory.build_scanned_pdf(["Scanned"]), ocr=FakeOcrEngine(times_out=True))

    result = scenario.parse([a_page_plan(1, "scanned")])

    assert (result.pages[0].blockCount, result.pages[0].ocrQualityScore) == (0, 0.0)


def test_ocr_renders_at_least_at_the_ocr_resolution() -> None:
    scenario = BatchScenario(pdf_factory.build_scanned_pdf(["Scanned"]))

    scenario.parse([a_page_plan(1, "scanned")])

    width, _ = scenario.ocr.calls[0]
    assert width == pytest.approx(595 * 100 / 72, abs=2)


def test_pages_beyond_the_document_fail_permanently() -> None:
    scenario = BatchScenario(pdf_factory.build_multi_page_pdf(2))

    with pytest.raises(PermanentJobError) as raised:
        scenario.parse([a_page_plan(1), a_page_plan(5)])

    assert raised.value.code is FailureCode.PAGE_OUT_OF_RANGE


def test_progress_is_reported_after_every_page() -> None:
    scenario = BatchScenario(pdf_factory.build_multi_page_pdf(3))

    scenario.parse([a_page_plan(1), a_page_plan(2), a_page_plan(3)])

    assert scenario.progress.reports == [(1, 3), (2, 3), (3, 3)]


def test_manifest_lines_are_utf8_json() -> None:
    scenario = BatchScenario(pdf_factory.build_report_pdf(), gateway=ScriptedGateway(NEMOTRON_MARKUP))
    result = scenario.parse([a_page_plan(1, "digital", ["document_parse"])])

    manifest = scenario.storage.body_of(BUCKET, result.manifest.key)

    assert manifest.endswith(b"\n")
    assert "ঢাকা".encode() in manifest
    assert all(json.loads(line) for line in io.BytesIO(manifest))
