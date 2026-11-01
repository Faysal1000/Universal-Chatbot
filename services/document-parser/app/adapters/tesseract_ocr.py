"""Fallback OCR with Tesseract (``eng+ben``) through pytesseract."""

from collections.abc import Mapping, Sequence
from typing import Any

import pytesseract

from app.adapters.pdfium_document import PillowRenderedPage
from app.application.ports import OcrTimeoutError, RenderedPage
from app.domain.geometry import Rectangle
from app.domain.ocr_layout import OcrWord

WORD_LEVEL = 5
FULLY_AUTOMATIC_PAGE_SEGMENTATION = 3


class TesseractUnavailableError(RuntimeError):
    """The tesseract binary or one of the configured language packs is missing."""


class TesseractOcrEngine:
    def __init__(
        self, languages: str, page_segmentation_mode: int = FULLY_AUTOMATIC_PAGE_SEGMENTATION
    ) -> None:
        self._languages = languages
        self._configuration = f"--psm {page_segmentation_mode}"

    def ensure_available(self) -> None:
        """Fail fast at start-up instead of on the first scanned page."""
        try:
            installed_languages = set(pytesseract.get_languages(config=""))
        except pytesseract.TesseractNotFoundError as error:
            raise TesseractUnavailableError("the tesseract binary is not installed") from error
        missing_languages = set(self._languages.split("+")) - installed_languages
        if missing_languages:
            raise TesseractUnavailableError(f"tesseract language data missing: {sorted(missing_languages)}")

    def recognise_words(self, page: RenderedPage, timeout_seconds: float) -> list[OcrWord]:
        if not isinstance(page, PillowRenderedPage):
            raise TypeError("TesseractOcrEngine needs a PillowRenderedPage")
        try:
            word_table = pytesseract.image_to_data(
                page.image,
                lang=self._languages,
                config=self._configuration,
                output_type=pytesseract.Output.DICT,
                timeout=timeout_seconds,
            )
        except RuntimeError as error:
            if "timeout" in str(error).lower():
                raise OcrTimeoutError(str(error)) from error
            raise
        return parse_word_table(word_table)


def parse_word_table(word_table: Mapping[str, Sequence[Any]]) -> list[OcrWord]:
    """Word rows of ``image_to_data`` output, skipping block/paragraph/line rows and blanks."""
    words: list[OcrWord] = []
    for row_index, level in enumerate(word_table["level"]):
        text = str(word_table["text"][row_index]).strip()
        if int(level) != WORD_LEVEL or not text:
            continue
        left = float(word_table["left"][row_index])
        top = float(word_table["top"][row_index])
        words.append(
            OcrWord(
                text=text,
                confidence=float(word_table["conf"][row_index]),
                rectangle=Rectangle(
                    left=left,
                    top=top,
                    right=left + float(word_table["width"][row_index]),
                    bottom=top + float(word_table["height"][row_index]),
                ),
                block_number=int(word_table["block_num"][row_index]),
                paragraph_number=int(word_table["par_num"][row_index]),
                line_number=int(word_table["line_num"][row_index]),
            )
        )
    return words
