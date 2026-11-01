"""Infer Markdown heading levels from font size relative to the page's body text.

Levels come from fixed size ratios rather than from ranking the sizes on each page, so the
same visual style maps to the same level on every page and ``rag`` can build section paths
across pages.
"""

from collections import Counter
from collections.abc import Iterable

# (minimum size relative to body text, heading level), largest first.
HEADING_SIZE_RATIO_LEVELS = ((1.6, 1), (1.35, 2), (1.15, 3), (1.08, 4))
BOLD_BODY_SIZE_HEADING_LEVEL = 5
BOLD_HEADING_MINIMUM_SIZE_RATIO = 0.95
FONT_SIZE_GRANULARITY_POINTS = 0.5
BOLD_FONT_NAME_MARKERS = ("bold", "black", "heavy", "semibold", "demibold", "extrabold", "ultrabold")
BOLD_FONT_NAME_SUFFIXES = (",b", "-bd", "-b", "bd")


def infer_heading_level(font_size: float, body_font_size: float, is_bold: bool) -> int | None:
    """Heading level 1-5 for text larger than (or bold at) body size; ``None`` for body text."""
    if body_font_size <= 0 or font_size <= 0:
        return None
    size_ratio = font_size / body_font_size
    for minimum_ratio, heading_level in HEADING_SIZE_RATIO_LEVELS:
        if size_ratio >= minimum_ratio:
            return heading_level
    if is_bold and size_ratio >= BOLD_HEADING_MINIMUM_SIZE_RATIO:
        return BOLD_BODY_SIZE_HEADING_LEVEL
    return None


def estimate_body_font_size(sized_text_runs: Iterable[tuple[float, int]]) -> float:
    """Most common font size weighted by character count; 0 when there is no text.

    Each item is ``(font_size, character_count)``.
    """
    character_counts_by_size: Counter[float] = Counter()
    for font_size, character_count in sized_text_runs:
        if font_size > 0 and character_count > 0:
            character_counts_by_size[_quantise(font_size)] += character_count
    if not character_counts_by_size:
        return 0.0
    most_common_size, _ = character_counts_by_size.most_common(1)[0]
    return most_common_size


def _quantise(font_size: float) -> float:
    return round(font_size / FONT_SIZE_GRANULARITY_POINTS) * FONT_SIZE_GRANULARITY_POINTS


def is_bold_font_name(font_name: str) -> bool:
    """Bold, black and heavy weights by PostScript name, e.g. ``ABCDEF+Helvetica-Bold``."""
    lowered_name = font_name.lower().split("+", 1)[-1]
    return any(marker in lowered_name for marker in BOLD_FONT_NAME_MARKERS) or lowered_name.endswith(
        BOLD_FONT_NAME_SUFFIXES
    )
