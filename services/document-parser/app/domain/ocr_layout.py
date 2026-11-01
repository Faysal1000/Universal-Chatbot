"""Group Tesseract words into text boxes and score recognition quality."""

from collections.abc import Sequence
from dataclasses import dataclass
from itertools import groupby
from statistics import fmean

from app.domain.geometry import Rectangle, bounding_rectangle
from app.domain.text_layer_blocks import TextBox, TextLine

TESSERACT_MAXIMUM_CONFIDENCE = 100.0


@dataclass(frozen=True, slots=True)
class OcrWord:
    """One recognised word; ``confidence`` is Tesseract's 0-100 score, in image pixels."""

    text: str
    confidence: float
    rectangle: Rectangle
    block_number: int
    paragraph_number: int
    line_number: int


def group_words_into_text_boxes(words: Sequence[OcrWord]) -> list[TextBox]:
    """One text box per Tesseract paragraph, one line per Tesseract line, in reading order."""
    text_boxes: list[TextBox] = []
    for _, paragraph_words in groupby(words, key=lambda word: (word.block_number, word.paragraph_number)):
        lines = [
            _build_line(list(line_words))
            for _, line_words in groupby(paragraph_words, key=lambda word: word.line_number)
        ]
        text_boxes.append(TextBox(lines=tuple(lines)))
    return text_boxes


def score_ocr_quality(words: Sequence[OcrWord]) -> float | None:
    """Mean word confidence in 0..1; ``None`` when nothing was recognised."""
    confidences = [word.confidence for word in words if word.confidence >= 0]
    if not confidences:
        return None
    return round(fmean(confidences) / TESSERACT_MAXIMUM_CONFIDENCE, 4)


def _build_line(line_words: Sequence[OcrWord]) -> TextLine:
    rectangle = bounding_rectangle(word.rectangle for word in line_words)
    return TextLine(
        text=" ".join(word.text for word in line_words),
        rectangle=rectangle,
        size=rectangle.height,
        confidence=score_ocr_quality(line_words),
    )
