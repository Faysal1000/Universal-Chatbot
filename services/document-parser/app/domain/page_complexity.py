"""Heuristics that flag page content native text extraction cannot represent faithfully.

``rag`` sends flagged pages to the vision model, so the flags favour recall over precision:
a false positive costs one vision call, a false negative loses a table or formula.
"""

from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from itertools import pairwise
from statistics import median

from app.domain.geometry import PageSize, Rectangle
from app.domain.page_layout import PageLayoutSnapshot, TextSegment

MINIMUM_IMAGE_PAGE_SHARE = 0.01

RULE_MAXIMUM_THICKNESS_POINTS = 2.5
HORIZONTAL_RULE_MINIMUM_WIDTH_SHARE = 0.05
VERTICAL_RULE_MINIMUM_HEIGHT_SHARE = 0.01
RULE_POSITION_GRANULARITY_POINTS = 2.0
RULED_TABLE_MINIMUM_HORIZONTAL_RULES = 3
RULED_TABLE_MINIMUM_VERTICAL_RULES = 3
OPEN_TABLE_MINIMUM_HORIZONTAL_RULES = 2

TEXT_ROW_TOLERANCE_POINTS = 3.0
COLUMN_ANCHOR_GRANULARITY_SHARE = 0.01
GRID_MINIMUM_CELLS_PER_ROW = 3
GRID_MINIMUM_ROWS = 3
GRID_MINIMUM_ALIGNED_COLUMNS = 3

MATH_FONT_MARKERS = ("cmmi", "cmsy", "cmex", "msam", "msbm", "math", "euclid", "mtextra", "esint", "rsfs")
SYMBOL_FONT_MARKER = "symbol"
MATH_CHARACTER_RANGES = (
    (0x2200, 0x22FF),  # Mathematical Operators
    (0x27C0, 0x27EF),  # Miscellaneous Mathematical Symbols-A
    (0x2980, 0x29FF),  # Miscellaneous Mathematical Symbols-B
    (0x2A00, 0x2AFF),  # Supplemental Mathematical Operators
    (0x1D400, 0x1D7FF),  # Mathematical Alphanumeric Symbols
)
MINIMUM_MATH_CHARACTERS = 3

CHART_MAXIMUM_LABEL_CHARACTERS = 8
CHART_MINIMUM_SHORT_LABELS = 4
CHART_MINIMUM_CURVED_OR_DIAGONAL_SEGMENTS = 12
CHART_MINIMUM_BARS = 3
BAR_MAXIMUM_WIDTH_SHARE = 0.15
BAR_MINIMUM_HEIGHT_SHARE = 0.02

COLUMN_LINE_MINIMUM_CHARACTERS = 10
COLUMN_LINE_MAXIMUM_WIDTH_SHARE = 0.5
COLUMN_START_GRANULARITY_SHARE = 0.015
COLUMN_MINIMUM_LINES = 4
COLUMN_MINIMUM_LINE_SHARE = 0.2
COLUMN_MINIMUM_GAP_SHARE = 0.25
COLUMN_MINIMUM_VERTICAL_OVERLAP_SHARE = 0.3


@dataclass(frozen=True, slots=True)
class PageComplexityFlags:
    has_tables: bool
    has_formulas: bool
    has_charts: bool
    has_images: bool
    has_multiple_columns: bool


def assess_page_complexity(snapshot: PageLayoutSnapshot) -> PageComplexityFlags:
    return PageComplexityFlags(
        has_tables=has_table(snapshot),
        has_formulas=has_formula(snapshot),
        has_charts=has_chart(snapshot),
        has_images=has_significant_image(snapshot),
        has_multiple_columns=has_multiple_text_columns(snapshot),
    )


# ----------------------------------------------------------------------------- images


def has_significant_image(snapshot: PageLayoutSnapshot) -> bool:
    minimum_area = snapshot.page_size.area * MINIMUM_IMAGE_PAGE_SHARE
    return any(
        rectangle.clipped_to(snapshot.page_size).area >= minimum_area
        for rectangle in snapshot.image_rectangles
    )


# ----------------------------------------------------------------------------- tables


def has_table(snapshot: PageLayoutSnapshot) -> bool:
    horizontal_rule_count = count_horizontal_rule_positions(snapshot)
    vertical_rule_count = count_vertical_rule_positions(snapshot)
    is_ruled_grid = (
        horizontal_rule_count >= RULED_TABLE_MINIMUM_HORIZONTAL_RULES
        and vertical_rule_count >= RULED_TABLE_MINIMUM_VERTICAL_RULES
    )
    if is_ruled_grid:
        return True
    return horizontal_rule_count >= OPEN_TABLE_MINIMUM_HORIZONTAL_RULES and has_aligned_text_grid(
        snapshot.text_segments, snapshot.page_size
    )


def count_horizontal_rule_positions(snapshot: PageLayoutSnapshot) -> int:
    """Most rows of horizontal rules sharing one left/right extent (bars and boxes do not)."""
    minimum_width = snapshot.page_size.width * HORIZONTAL_RULE_MINIMUM_WIDTH_SHARE
    segment_rules = [
        _horizontal_rule(segment.start_x, segment.end_x, segment.start_y)
        for segment in snapshot.vector_graphics.straight_segments
        if segment.is_horizontal and segment.horizontal_length >= minimum_width
    ]
    thin_path_rules = [
        _horizontal_rule(bounds.left, bounds.right, bounds.top)
        for bounds in snapshot.vector_graphics.path_bounds
        if bounds.height <= RULE_MAXIMUM_THICKNESS_POINTS and bounds.width >= minimum_width
    ]
    return _most_positions_sharing_an_extent(segment_rules + thin_path_rules)


def count_vertical_rule_positions(snapshot: PageLayoutSnapshot) -> int:
    """Most columns of vertical rules sharing one top/bottom extent."""
    minimum_height = snapshot.page_size.height * VERTICAL_RULE_MINIMUM_HEIGHT_SHARE
    segment_rules = [
        _vertical_rule(segment.start_y, segment.end_y, segment.start_x)
        for segment in snapshot.vector_graphics.straight_segments
        if segment.is_vertical and segment.vertical_length >= minimum_height
    ]
    thin_path_rules = [
        _vertical_rule(bounds.top, bounds.bottom, bounds.left)
        for bounds in snapshot.vector_graphics.path_bounds
        if bounds.width <= RULE_MAXIMUM_THICKNESS_POINTS and bounds.height >= minimum_height
    ]
    return _most_positions_sharing_an_extent(segment_rules + thin_path_rules)


def _horizontal_rule(first_x: float, second_x: float, y: float) -> tuple[int, int, int]:
    return _quantise_rule(min(first_x, second_x), max(first_x, second_x), y)


def _vertical_rule(first_y: float, second_y: float, x: float) -> tuple[int, int, int]:
    return _quantise_rule(min(first_y, second_y), max(first_y, second_y), x)


def _quantise_rule(extent_start: float, extent_end: float, position: float) -> tuple[int, int, int]:
    return (
        round(extent_start / RULE_POSITION_GRANULARITY_POINTS),
        round(extent_end / RULE_POSITION_GRANULARITY_POINTS),
        round(position / RULE_POSITION_GRANULARITY_POINTS),
    )


def _most_positions_sharing_an_extent(rules: Iterable[tuple[int, int, int]]) -> int:
    positions_by_extent: dict[tuple[int, int], set[int]] = {}
    for extent_start, extent_end, position in rules:
        positions_by_extent.setdefault((extent_start, extent_end), set()).add(position)
    return max((len(positions) for positions in positions_by_extent.values()), default=0)


def has_aligned_text_grid(text_segments: Sequence[TextSegment], page_size: PageSize) -> bool:
    """At least three rows of three or more cells that share three column anchors."""
    grid_rows = [
        row for row in group_segments_into_rows(text_segments) if len(row) >= GRID_MINIMUM_CELLS_PER_ROW
    ]
    if len(grid_rows) < GRID_MINIMUM_ROWS:
        return False
    anchor_granularity = page_size.width * COLUMN_ANCHOR_GRANULARITY_SHARE
    anchor_row_counts: Counter[tuple[str, int]] = Counter()
    for row in grid_rows:
        anchor_row_counts.update(_column_anchors(row, anchor_granularity))
    aligned_columns = [
        anchor for anchor, row_count in anchor_row_counts.items() if row_count >= GRID_MINIMUM_ROWS
    ]
    return len(aligned_columns) >= GRID_MINIMUM_ALIGNED_COLUMNS


def group_segments_into_rows(text_segments: Iterable[TextSegment]) -> list[list[TextSegment]]:
    """Group segments whose vertical centres lie within a few points of each other."""
    rows: list[list[TextSegment]] = []
    for segment in sorted(text_segments, key=_vertical_centre):
        if (
            rows
            and abs(_vertical_centre(rows[-1][0]) - _vertical_centre(segment)) <= TEXT_ROW_TOLERANCE_POINTS
        ):
            rows[-1].append(segment)
        else:
            rows.append([segment])
    return rows


def _column_anchors(row: Sequence[TextSegment], granularity: float) -> set[tuple[str, int]]:
    left_anchors = {("left", round(segment.rectangle.left / granularity)) for segment in row}
    right_anchors = {("right", round(segment.rectangle.right / granularity)) for segment in row}
    return left_anchors | right_anchors


def _vertical_centre(segment: TextSegment) -> float:
    return (segment.rectangle.top + segment.rectangle.bottom) / 2


# ----------------------------------------------------------------------------- formulas


def has_formula(snapshot: PageLayoutSnapshot) -> bool:
    math_character_count = count_math_characters(snapshot.text)
    if any(is_math_font(font_name) for font_name in snapshot.font_names):
        return True
    uses_symbol_font = any(SYMBOL_FONT_MARKER in font_name.lower() for font_name in snapshot.font_names)
    if uses_symbol_font and math_character_count > 0:
        return True
    return math_character_count >= MINIMUM_MATH_CHARACTERS


def is_math_font(font_name: str) -> bool:
    """TeX math fonts (CMMI, CMSY, ...) and OpenType math fonts (Cambria Math, STIX Math)."""
    lowered_name = font_name.lower()
    return any(marker in lowered_name for marker in MATH_FONT_MARKERS)


def count_math_characters(text: str) -> int:
    return sum(1 for character in text if _is_math_character(character))


def _is_math_character(character: str) -> bool:
    code_point = ord(character)
    return any(first <= code_point <= last for first, last in MATH_CHARACTER_RANGES)


# ----------------------------------------------------------------------------- charts


def has_chart(snapshot: PageLayoutSnapshot) -> bool:
    """Axis labels (short text) next to plotted shapes (curves, diagonal lines or bars)."""
    if count_short_labels(snapshot.text_segments) < CHART_MINIMUM_SHORT_LABELS:
        return False
    graphics = snapshot.vector_graphics
    diagonal_segment_count = sum(1 for segment in graphics.straight_segments if segment.is_diagonal)
    curved_or_diagonal_count = graphics.curve_segment_count + diagonal_segment_count
    has_plotted_lines = curved_or_diagonal_count >= CHART_MINIMUM_CURVED_OR_DIAGONAL_SEGMENTS
    return has_plotted_lines or count_bars(graphics.path_bounds, snapshot.page_size) >= CHART_MINIMUM_BARS


def count_short_labels(text_segments: Iterable[TextSegment]) -> int:
    return sum(
        1 for segment in text_segments if 0 < len(segment.text.strip()) <= CHART_MAXIMUM_LABEL_CHARACTERS
    )


def count_bars(path_bounds: Iterable[Rectangle], page_size: PageSize) -> int:
    maximum_width = page_size.width * BAR_MAXIMUM_WIDTH_SHARE
    minimum_height = page_size.height * BAR_MINIMUM_HEIGHT_SHARE
    return sum(
        1
        for bounds in path_bounds
        if RULE_MAXIMUM_THICKNESS_POINTS < bounds.width <= maximum_width and bounds.height >= minimum_height
    )


# ----------------------------------------------------------------------------- columns


def has_multiple_text_columns(snapshot: PageLayoutSnapshot) -> bool:
    """Two clusters of narrow lines with distinct start positions, side by side on the page."""
    page_width = snapshot.page_size.width
    column_lines = [
        segment
        for segment in snapshot.text_segments
        if len(segment.text.strip()) >= COLUMN_LINE_MINIMUM_CHARACTERS
        and segment.rectangle.width <= page_width * COLUMN_LINE_MAXIMUM_WIDTH_SHARE
    ]
    if len(column_lines) < 2 * COLUMN_MINIMUM_LINES:
        return False
    columns = _cluster_lines_by_start(column_lines, page_width)
    return any(
        _are_side_by_side_columns(left_column, right_column, page_width)
        for left_column, right_column in pairwise(columns)
    )


def _cluster_lines_by_start(lines: Sequence[TextSegment], page_width: float) -> list[list[TextSegment]]:
    granularity = page_width * COLUMN_START_GRANULARITY_SHARE
    clusters: dict[int, list[TextSegment]] = {}
    for line in lines:
        clusters.setdefault(round(line.rectangle.left / granularity), []).append(line)
    minimum_size = max(COLUMN_MINIMUM_LINES, len(lines) * COLUMN_MINIMUM_LINE_SHARE)
    return [clusters[anchor] for anchor in sorted(clusters) if len(clusters[anchor]) >= minimum_size]


def _are_side_by_side_columns(
    left_column: Sequence[TextSegment], right_column: Sequence[TextSegment], page_width: float
) -> bool:
    left_start = median(line.rectangle.left for line in left_column)
    right_start = median(line.rectangle.left for line in right_column)
    left_end = median(line.rectangle.right for line in left_column)
    is_far_enough_apart = right_start - left_start >= page_width * COLUMN_MINIMUM_GAP_SHARE
    does_not_overlap = left_end <= right_start
    return is_far_enough_apart and does_not_overlap and _overlap_vertically(left_column, right_column)


def _overlap_vertically(left_column: Sequence[TextSegment], right_column: Sequence[TextSegment]) -> bool:
    left_span = _vertical_span(left_column)
    right_span = _vertical_span(right_column)
    shorter_height = min(left_span.height, right_span.height)
    if shorter_height <= 0:
        return False
    return (
        left_span.vertical_overlap_with(right_span) / shorter_height >= COLUMN_MINIMUM_VERTICAL_OVERLAP_SHARE
    )


def _vertical_span(lines: Sequence[TextSegment]) -> Rectangle:
    return Rectangle(
        left=0.0,
        top=min(line.rectangle.top for line in lines),
        right=0.0,
        bottom=max(line.rectangle.bottom for line in lines),
    )
