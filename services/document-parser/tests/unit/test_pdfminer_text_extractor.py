from app.adapters.pdfminer_text_extractor import PdfminerTextExtractor
from app.domain.blocks import DraftBlock
from app.domain.text_layer_blocks import build_text_layer_blocks
from tests.support import pdf_factory


def native_blocks(pdf_bytes: bytes) -> list[DraftBlock]:
    text_boxes, page_size = PdfminerTextExtractor().extract_text_boxes(pdf_bytes, 1)
    return build_text_layer_blocks(text_boxes, page_size)


def test_report_headings_paragraphs_and_lists() -> None:
    blocks = native_blocks(pdf_factory.build_report_pdf())

    headings = [(block.text, block.heading_level) for block in blocks if block.block_type == "heading"]
    assert headings == [("Quarterly Service Report", 1), ("Introduction", 2), ("Outlook", 2)]
    assert [block.markdown for block in blocks if block.block_type == "list"] == [
        "- Faster onboarding for new customers",
        "- Lower churn in the business segment",
    ]
    assert any(block.block_type == "paragraph" and "grew steadily" in (block.text or "") for block in blocks)


def test_boxes_use_top_left_origin() -> None:
    blocks = native_blocks(pdf_factory.build_report_pdf())

    title = blocks[0]
    assert title.box.y0 < 0.15
    assert 0 <= title.box.x0 < title.box.x1 <= 1


def test_second_page_is_read() -> None:
    text_boxes, _ = PdfminerTextExtractor().extract_text_boxes(pdf_factory.build_multi_page_pdf(3), 2)

    assert text_boxes[0].lines[0].text.startswith("Page 2 ")


def test_unreadable_document_yields_no_boxes() -> None:
    assert PdfminerTextExtractor().extract_text_boxes(b"not a pdf", 1)[0] == []
