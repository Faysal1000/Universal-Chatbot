"""Build blocks from positioned text lines (the PDF text layer or Tesseract output).

Both native extraction and OCR produce text boxes made of lines with a size (font size, or
line height for OCR). Within a box, consecutive lines with the same heading level form one
block, so a bold heading line glued to its paragraph by the layout analysis is split off.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from itertools import groupby
from statistics import fmean

from app.domain.blocks import BlockType, DraftBlock
from app.domain.geometry import NormalisedBox, PageSize, Rectangle, bounding_rectangle
from app.domain.heading_levels import estimate_body_font_size, infer_heading_level
from app.domain.text_normalisation import (
    group_list_items,
    is_list_item,
    join_lines,
    list_items_to_markdown,
    normalise_whitespace,
)

PAGE_MARGIN_BAND_SHARE = 0.07
MARGIN_BLOCK_MAXIMUM_LINES = 2
HEADING_MAXIMUM_LINES = 3
HEADING_MAXIMUM_CHARACTERS = 200
LIST_MINIMUM_MARKED_LINE_SHARE = 0.5


@dataclass(frozen=True, slots=True)
class TextLine:
    """One line of text; ``size`` is its font size, or its height when only pixels are known."""

    text: str
    rectangle: Rectangle
    size: float
    is_bold: bool = False
    confidence: float | None = None


@dataclass(frozen=True, slots=True)
class TextBox:
    """Lines the layout analysis grouped together, in reading order."""

    lines: tuple[TextLine, ...]


def build_text_layer_blocks(text_boxes: Sequence[TextBox], page_size: PageSize) -> list[DraftBlock]:
    body_size = estimate_body_font_size(
        (line.size, len(line.text.strip())) for box in text_boxes for line in box.lines
    )
    blocks: list[DraftBlock] = []
    for text_box in text_boxes:
        for line_run in _split_by_heading_level(text_box.lines, body_size):
            block = _build_block(line_run, body_size, page_size)
            if block is not None:
                blocks.append(block)
    return blocks


def _split_by_heading_level(lines: Sequence[TextLine], body_size: float) -> list[list[TextLine]]:
    def heading_level_of(line: TextLine) -> int | None:
        return infer_heading_level(line.size, body_size, line.is_bold)

    return [list(line_run) for _, line_run in groupby(lines, key=heading_level_of)]


def _build_block(lines: Sequence[TextLine], body_size: float, page_size: PageSize) -> DraftBlock | None:
    texts = [line.text for line in lines if normalise_whitespace(line.text)]
    if not texts:
        return None
    rectangle = bounding_rectangle(line.rectangle for line in lines)
    box = NormalisedBox.from_rectangle(rectangle, page_size).rounded()
    confidence = _mean_confidence(lines)
    margin_type = _page_margin_block_type(rectangle, len(texts), page_size)
    if margin_type is not None:
        return DraftBlock(block_type=margin_type, box=box, text=join_lines(texts), confidence=confidence)
    heading_level = _heading_level(lines, texts, body_size)
    if heading_level is not None:
        return _heading_block(texts, heading_level, box, confidence)
    if _is_list(texts):
        return _list_block(texts, box, confidence)
    paragraph = join_lines(texts)
    return DraftBlock(
        block_type="paragraph", box=box, text=paragraph, markdown=paragraph, confidence=confidence
    )


def _heading_level(lines: Sequence[TextLine], texts: Sequence[str], body_size: float) -> int | None:
    first_line = lines[0]
    level = infer_heading_level(first_line.size, body_size, first_line.is_bold)
    is_short = len(texts) <= HEADING_MAXIMUM_LINES and len(join_lines(texts)) <= HEADING_MAXIMUM_CHARACTERS
    return level if is_short else None


def _heading_block(
    texts: Sequence[str], heading_level: int, box: NormalisedBox, confidence: float | None
) -> DraftBlock:
    heading_text = join_lines(texts)
    return DraftBlock(
        block_type="heading",
        box=box,
        text=heading_text,
        markdown=f"{'#' * heading_level} {heading_text}",
        heading_level=heading_level,
        confidence=confidence,
    )


def _is_list(texts: Sequence[str]) -> bool:
    if not is_list_item(texts[0]):
        return False
    marked_line_count = sum(1 for text in texts if is_list_item(text))
    return marked_line_count / len(texts) >= LIST_MINIMUM_MARKED_LINE_SHARE or len(texts) <= 2


def _list_block(texts: Sequence[str], box: NormalisedBox, confidence: float | None) -> DraftBlock:
    items = group_list_items(texts)
    return DraftBlock(
        block_type="list",
        box=box,
        text="\n".join(items),
        markdown=list_items_to_markdown(items),
        confidence=confidence,
    )


def _page_margin_block_type(rectangle: Rectangle, line_count: int, page_size: PageSize) -> BlockType | None:
    if line_count > MARGIN_BLOCK_MAXIMUM_LINES:
        return None
    band_height = page_size.height * PAGE_MARGIN_BAND_SHARE
    if rectangle.bottom <= band_height:
        return "page_header"
    if rectangle.top >= page_size.height - band_height:
        return "page_footer"
    return None


def _mean_confidence(lines: Sequence[TextLine]) -> float | None:
    confidences = [line.confidence for line in lines if line.confidence is not None]
    return round(fmean(confidences), 4) if confidences else None
