"""Classify a page as digital, scanned or hybrid from its text layer and image coverage.

- ``digital``: a readable text layer and no page-sized image (blank pages included).
- ``scanned``: no readable text layer, but a page-sized image or outlined glyphs.
- ``hybrid``: a readable text layer on top of a page-sized image, or a text layer that is
  mostly invisible (the typical OCR layer of a scanner), so the text cannot be trusted alone.
"""

import unicodedata
from typing import Literal

from app.domain.geometry import coverage_ratio
from app.domain.page_layout import PageLayoutSnapshot

PageKind = Literal["digital", "scanned", "hybrid"]

MINIMUM_READABLE_CHARACTERS = 20
MINIMUM_READABLE_CHARACTER_RATIO = 0.6
SCANNED_PAGE_IMAGE_COVERAGE = 0.3
HYBRID_PAGE_IMAGE_COVERAGE = 0.5
INVISIBLE_TEXT_MAJORITY = 0.5
OUTLINED_TEXT_CURVE_SEGMENTS = 200
UNREADABLE_UNICODE_CATEGORIES = frozenset({"Cc", "Cf", "Co", "Cn", "Cs"})
REPLACEMENT_CHARACTER = "�"


def classify_page_kind(snapshot: PageLayoutSnapshot) -> PageKind:
    image_coverage = coverage_ratio(snapshot.image_rectangles, snapshot.page_size)
    if not has_readable_text_layer(snapshot.text):
        return "scanned" if _looks_like_an_image_of_text(snapshot, image_coverage) else "digital"
    if image_coverage >= HYBRID_PAGE_IMAGE_COVERAGE or has_mostly_invisible_text(snapshot):
        return "hybrid"
    return "digital"


def text_coverage_ratio(snapshot: PageLayoutSnapshot) -> float:
    return coverage_ratio((segment.rectangle for segment in snapshot.text_segments), snapshot.page_size)


def has_readable_text_layer(text: str) -> bool:
    """Enough characters, most of which map to real Unicode (not garbage from broken fonts)."""
    visible_characters = [character for character in text if not character.isspace()]
    if len(visible_characters) < MINIMUM_READABLE_CHARACTERS:
        return False
    readable_characters = sum(1 for character in visible_characters if is_readable_character(character))
    return readable_characters / len(visible_characters) >= MINIMUM_READABLE_CHARACTER_RATIO


def is_readable_character(character: str) -> bool:
    if character == REPLACEMENT_CHARACTER:
        return False
    return unicodedata.category(character) not in UNREADABLE_UNICODE_CATEGORIES


def has_mostly_invisible_text(snapshot: PageLayoutSnapshot) -> bool:
    if snapshot.text_object_count == 0:
        return False
    return snapshot.invisible_text_object_count / snapshot.text_object_count > INVISIBLE_TEXT_MAJORITY


def _looks_like_an_image_of_text(snapshot: PageLayoutSnapshot, image_coverage: float) -> bool:
    has_page_sized_image = image_coverage >= SCANNED_PAGE_IMAGE_COVERAGE
    has_outlined_glyphs = snapshot.vector_graphics.curve_segment_count >= OUTLINED_TEXT_CURVE_SEGMENTS
    return has_page_sized_image or has_outlined_glyphs
