import pytest

from app.adapters.image_conversion import PillowImageToPdfConverter
from app.adapters.pdfium_document import PdfiumOpener
from app.application.inspect_document import InspectDocument
from app.application.source_loading import SourceLoader, SourcePolicy
from app.contracts.generated.parse_inspect_v1 import ParseInspectResult
from app.domain.errors import FailureCode, PermanentJobError
from tests.support import pdf_factory
from tests.support.builders import BUCKET, OUTPUT_PREFIX, an_inspect_payload, original_key
from tests.support.doubles import InMemoryObjectStorage, RecordingProgressReporter


class InspectionScenario:
    def __init__(self, content: bytes) -> None:
        self.content = content
        self.storage = InMemoryObjectStorage()
        self.storage.put(BUCKET, original_key(content), content)
        self.progress = RecordingProgressReporter()
        self.use_case = InspectDocument(
            SourceLoader(self.storage, SourcePolicy(allowed_bucket=BUCKET, maximum_source_bytes=50_000_000)),
            self.storage,
            PdfiumOpener(),
            PillowImageToPdfConverter(maximum_image_pixels=50_000_000),
        )

    def inspect(self, mime_type: str = "application/pdf", max_pages: int = 200) -> ParseInspectResult:
        return self.use_case.execute(an_inspect_payload(self.content, mime_type, max_pages), self.progress)


def test_pdf_is_inspected_in_place() -> None:
    scenario = InspectionScenario(pdf_factory.build_report_pdf())

    result = scenario.inspect()

    assert result.parseSource.key == original_key(scenario.content)
    assert result.pageCount == 1
    assert result.detectedLanguage == "en"
    assert result.pages[0].complexity.hasTables
    assert scenario.progress.reports == [(1, 1)]


def test_result_matches_the_contract_shape() -> None:
    result = InspectionScenario(pdf_factory.build_multi_page_pdf(12)).inspect()

    dumped = result.model_dump(mode="json")
    assert [page["pageNumber"] for page in dumped["pages"]] == list(range(1, 13))
    assert set(dumped) == {
        "documentId",
        "ingestionRunId",
        "parseSource",
        "pageCount",
        "detectedLanguage",
        "pages",
    }


def test_progress_is_reported_every_ten_pages_and_at_the_end() -> None:
    scenario = InspectionScenario(pdf_factory.build_multi_page_pdf(12))

    scenario.inspect()

    assert scenario.progress.reports == [(10, 12), (12, 12)]


def test_too_many_pages_fail_permanently() -> None:
    with pytest.raises(PermanentJobError) as raised:
        InspectionScenario(pdf_factory.build_multi_page_pdf(3)).inspect(max_pages=2)

    assert raised.value.code is FailureCode.TOO_MANY_PAGES
    assert str(raised.value) == "too_many_pages: the document has 3 pages; the limit is 2"


def test_scanned_document_has_no_detected_language() -> None:
    result = InspectionScenario(pdf_factory.build_scanned_pdf(["Scanned"])).inspect()

    assert result.pages[0].pageKind == "scanned"
    assert result.detectedLanguage is None


def test_bengali_document_is_detected_as_bengali() -> None:
    bengali_pdf = pdf_factory.build_bengali_pdf()
    if bengali_pdf is None:
        pytest.skip("no Bengali font installed")

    assert InspectionScenario(bengali_pdf).inspect().detectedLanguage == "bn"


def test_image_upload_is_converted_and_stored_as_parse_source() -> None:
    png = pdf_factory.encode_image(pdf_factory.build_text_image(["Receipt"]), "PNG")
    scenario = InspectionScenario(png)

    result = scenario.inspect(mime_type="image/png")

    assert result.parseSource.key == f"{OUTPUT_PREFIX}source.pdf"
    assert scenario.storage.objects[(BUCKET, result.parseSource.key)].content_type == "application/pdf"
    assert result.pages[0].pageKind == "scanned"


def test_office_documents_are_not_supported_yet() -> None:
    with pytest.raises(PermanentJobError) as raised:
        InspectionScenario(b"PK docx").inspect(
            mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )

    assert raised.value.code is FailureCode.UNSUPPORTED_FORMAT


def test_encrypted_pdf_fails_permanently() -> None:
    with pytest.raises(PermanentJobError) as raised:
        InspectionScenario(pdf_factory.build_encrypted_pdf()).inspect()

    assert raised.value.code is FailureCode.ENCRYPTED_DOCUMENT
