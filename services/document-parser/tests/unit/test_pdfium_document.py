import io

import pytest
from PIL import Image

from app.adapters.pdfium_document import PdfiumOpener, PillowRenderedPage, bounded_render_scale
from app.application.inspect_document import build_page_inspection
from app.contracts.generated.parse_inspect_v1 import PageInspection
from app.domain.errors import FailureCode, PermanentJobError
from app.domain.geometry import NormalisedBox, PageSize
from tests.support import pdf_factory


def inspect_first_page(pdf_bytes: bytes) -> PageInspection:
    with PdfiumOpener().open_document(pdf_bytes) as document:
        return build_page_inspection(1, document.inspect_page(1))


def test_report_page_is_digital_with_a_table() -> None:
    inspection = inspect_first_page(pdf_factory.build_report_pdf())

    assert inspection.pageKind == "digital"
    assert (inspection.widthPoints, inspection.heightPoints) == (595.28, 841.89)
    assert inspection.textCoverageRatio > 0.02
    assert inspection.complexity.hasTables
    assert not inspection.complexity.hasMultipleColumns


def test_two_column_page_is_flagged() -> None:
    assert inspect_first_page(pdf_factory.build_two_column_pdf()).complexity.hasMultipleColumns


def test_formula_page_is_flagged() -> None:
    assert inspect_first_page(pdf_factory.build_formula_pdf()).complexity.hasFormulas


def test_bar_chart_is_a_chart_not_a_table() -> None:
    complexity = inspect_first_page(pdf_factory.build_bar_chart_pdf()).complexity

    assert complexity.hasCharts
    assert not complexity.hasTables


def test_image_only_page_is_scanned() -> None:
    inspection = inspect_first_page(pdf_factory.build_scanned_pdf(["Scanned letter"]))

    assert inspection.pageKind == "scanned"
    assert inspection.textCoverageRatio == 0
    assert inspection.complexity.hasImages


def test_bengali_text_layer_is_read() -> None:
    bengali_pdf = pdf_factory.build_bengali_pdf()
    if bengali_pdf is None:
        pytest.skip("no Bengali font installed")
    with PdfiumOpener().open_document(bengali_pdf) as document:
        snapshot = document.inspect_page(1)

    assert any("ঀ" <= character <= "৿" for character in snapshot.text)


def test_encrypted_pdf_fails_permanently() -> None:
    with pytest.raises(PermanentJobError) as raised:
        PdfiumOpener().open_document(pdf_factory.build_encrypted_pdf())

    assert raised.value.code is FailureCode.ENCRYPTED_DOCUMENT


def test_corrupt_pdf_fails_permanently() -> None:
    with pytest.raises(PermanentJobError) as raised:
        PdfiumOpener().open_document(b"%PDF-1.7 this is not really a pdf")

    assert raised.value.code is FailureCode.CORRUPT_DOCUMENT


def test_missing_page_fails_permanently() -> None:
    with PdfiumOpener().open_document(pdf_factory.build_multi_page_pdf(2)) as document:
        assert document.page_count == 2
        with pytest.raises(PermanentJobError):
            document.inspect_page(3)


def test_render_at_requested_dpi_and_crop() -> None:
    with PdfiumOpener().open_document(pdf_factory.build_report_pdf()) as document:
        page = document.render_page(1, dots_per_inch=144)
    try:
        assert (page.size.width, page.size.height) == (1191, 1684)
        assert page.to_png().startswith(b"\x89PNG")
        crop = Image.open(io.BytesIO(page.crop_to_png(NormalisedBox(0.25, 0.25, 0.5, 0.5))))
        assert crop.size[0] == pytest.approx(306, abs=1)
        assert crop.size[1] == pytest.approx(429, abs=1)
    finally:
        page.close()


def test_render_is_capped_by_the_pixel_budget() -> None:
    with PdfiumOpener(maximum_render_pixels=1_000_000).open_document(
        pdf_factory.build_report_pdf()
    ) as document:
        page = document.render_page(1, dots_per_inch=300)

    assert page.size.width * page.size.height <= 1_000_000
    page.close()


def test_bounded_render_scale() -> None:
    a4 = PageSize(595, 842)

    assert bounded_render_scale(a4, 144, 10_000_000) == 2.0
    assert bounded_render_scale(a4, 144, 501_000) == pytest.approx(1.0, rel=0.02)


def test_closed_rendered_page_cannot_be_used() -> None:
    page = PillowRenderedPage(Image.new("RGB", (10, 10)))
    page.close()
    page.close()

    with pytest.raises(RuntimeError, match="closed"):
        page.to_png()
