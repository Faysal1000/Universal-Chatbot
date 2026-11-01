"""Read the text layer of one page with pdfminer.six, keeping font size and weight per line."""

import io
import logging
from collections.abc import Iterable, Iterator
from statistics import median
from typing import Any

from pdfminer.high_level import extract_pages
from pdfminer.layout import LAParams, LTChar, LTContainer, LTPage, LTTextBox, LTTextLine
from pdfminer.pdfparser import PDFSyntaxError
from pdfminer.psparser import PSException

from app.domain.geometry import PageSize, Rectangle
from app.domain.heading_levels import is_bold_font_name
from app.domain.text_layer_blocks import TextBox, TextLine

BOLD_CHARACTER_MAJORITY = 0.6

logger = logging.getLogger(__name__)


class PdfminerTextExtractor:
    def __init__(self) -> None:
        # all_texts: also analyse text inside Form XObjects (common in generated PDFs).
        self._layout_parameters = LAParams(all_texts=True)

    def extract_text_boxes(self, pdf_bytes: bytes, page_number: int) -> tuple[list[TextBox], PageSize]:
        """Text boxes in pdfminer's reading order, in top-left-origin points.

        A page pdfminer cannot read yields no boxes (logged) rather than failing the batch:
        PDFium already opened the document, so the rest of it is still worth parsing.
        """
        try:
            layout_page = self._analyse_page(pdf_bytes, page_number)
        except (PDFSyntaxError, PSException, ValueError, KeyError, TypeError) as error:
            logger.warning("pdfminer could not read page %s: %s", page_number, error)
            return [], PageSize(width=1.0, height=1.0)
        page_size = PageSize(width=layout_page.width, height=layout_page.height)
        text_boxes = [_convert_text_box(text_box, layout_page) for text_box in _find_text_boxes(layout_page)]
        return [text_box for text_box in text_boxes if text_box.lines], page_size

    def _analyse_page(self, pdf_bytes: bytes, page_number: int) -> LTPage:
        pages = extract_pages(
            io.BytesIO(pdf_bytes), page_numbers=[page_number - 1], laparams=self._layout_parameters
        )
        layout_page = next(iter(pages), None)
        if layout_page is None:
            raise ValueError(f"page {page_number} not found")
        return layout_page


def _find_text_boxes(container: LTContainer[Any]) -> Iterator[LTTextBox]:
    for layout_object in container:
        if isinstance(layout_object, LTTextBox):
            yield layout_object
        elif isinstance(layout_object, LTContainer):
            yield from _find_text_boxes(layout_object)


def _convert_text_box(text_box: LTTextBox, layout_page: LTPage) -> TextBox:
    lines = [
        _convert_line(line, layout_page)
        for line in text_box
        if isinstance(line, LTTextLine) and line.get_text().strip()
    ]
    return TextBox(lines=tuple(lines))


def _convert_line(line: LTTextLine, layout_page: LTPage) -> TextLine:
    characters = [character for character in line if isinstance(character, LTChar)]
    return TextLine(
        text=line.get_text().strip(),
        rectangle=Rectangle(
            left=line.x0 - layout_page.x0,
            top=layout_page.y1 - line.y1,
            right=line.x1 - layout_page.x0,
            bottom=layout_page.y1 - line.y0,
        ),
        size=_median_size(characters),
        is_bold=_is_mostly_bold(characters),
    )


def _median_size(characters: Iterable[LTChar]) -> float:
    sizes = [character.size for character in characters if character.get_text().strip()]
    return float(median(sizes)) if sizes else 0.0


def _is_mostly_bold(characters: Iterable[LTChar]) -> bool:
    visible_characters = [character for character in characters if character.get_text().strip()]
    if not visible_characters:
        return False
    bold_count = sum(1 for character in visible_characters if is_bold_font_name(character.fontname))
    return bold_count / len(visible_characters) >= BOLD_CHARACTER_MAJORITY
