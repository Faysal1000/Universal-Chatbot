import shutil
from typing import Any

import pytest
from PIL import Image

from app.adapters.pdfium_document import PillowRenderedPage
from app.adapters.tesseract_ocr import TesseractOcrEngine, TesseractUnavailableError, parse_word_table
from app.application.ports import OcrTimeoutError
from app.domain.geometry import Rectangle
from app.domain.ocr_layout import group_words_into_text_boxes, score_ocr_quality
from tests.support.pdf_factory import build_text_image

requires_tesseract = pytest.mark.skipif(
    shutil.which("tesseract") is None, reason="tesseract is not installed"
)


def test_word_rows_are_parsed_and_structural_rows_skipped() -> None:
    word_table: dict[str, list[Any]] = {
        "level": [1, 4, 5, 5, 5],
        "text": ["", "", "Hello", " ", "world"],
        "conf": [-1, -1, 96.5, -1, 88.0],
        "left": [0, 10, 10, 50, 60],
        "top": [0, 20, 20, 20, 22],
        "width": [500, 100, 40, 5, 45],
        "height": [800, 12, 12, 12, 10],
        "block_num": [0, 1, 1, 1, 1],
        "par_num": [0, 1, 1, 1, 1],
        "line_num": [0, 1, 1, 1, 1],
    }

    words = parse_word_table(word_table)

    assert [(word.text, word.confidence) for word in words] == [("Hello", 96.5), ("world", 88.0)]
    assert words[1].rectangle == Rectangle(60, 22, 105, 32)


def test_only_pillow_pages_are_accepted() -> None:
    class OtherPage:
        pass

    with pytest.raises(TypeError):
        TesseractOcrEngine("eng").recognise_words(OtherPage(), 10)  # type: ignore[arg-type]


def test_missing_language_is_reported(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("pytesseract.get_languages", lambda config="": ["eng", "osd"])

    with pytest.raises(TesseractUnavailableError, match="ben"):
        TesseractOcrEngine("eng+ben").ensure_available()


def test_timeout_is_translated(monkeypatch: pytest.MonkeyPatch) -> None:
    def time_out(*arguments: object, **options: object) -> None:
        raise RuntimeError("Tesseract process timeout")

    monkeypatch.setattr("pytesseract.image_to_data", time_out)

    with pytest.raises(OcrTimeoutError):
        TesseractOcrEngine("eng").recognise_words(PillowRenderedPage(Image.new("RGB", (10, 10))), 1)


@pytest.mark.tesseract
@requires_tesseract
def test_recognises_english_text_on_a_scanned_page() -> None:
    engine = TesseractOcrEngine("eng+ben")
    engine.ensure_available()
    page = PillowRenderedPage(build_text_image(["Quarterly service report", "Revenue grew in every region"]))

    words = engine.recognise_words(page, timeout_seconds=120)

    recognised_text = " ".join(line.text for box in group_words_into_text_boxes(words) for line in box.lines)
    assert "Quarterly" in recognised_text
    assert "Revenue" in recognised_text
    assert (score_ocr_quality(words) or 0) > 0.6
