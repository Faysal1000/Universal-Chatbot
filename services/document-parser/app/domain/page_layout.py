"""What the PDF adapter observed on one page, in top-left-origin PDF points.

The adapter only collects facts; every judgement about them (page kind, tables, columns)
lives in the pure classification and complexity modules.
"""

from dataclasses import dataclass, field

from app.domain.geometry import PageSize, Rectangle

AXIS_ALIGNMENT_TOLERANCE_POINTS = 0.5


@dataclass(frozen=True, slots=True)
class TextSegment:
    """A run of text on one line, as reported by the PDF text layer."""

    rectangle: Rectangle
    text: str


@dataclass(frozen=True, slots=True)
class LineSegment:
    """A straight segment of a vector path."""

    start_x: float
    start_y: float
    end_x: float
    end_y: float

    @property
    def is_horizontal(self) -> bool:
        return abs(self.end_y - self.start_y) <= AXIS_ALIGNMENT_TOLERANCE_POINTS

    @property
    def is_vertical(self) -> bool:
        return abs(self.end_x - self.start_x) <= AXIS_ALIGNMENT_TOLERANCE_POINTS

    @property
    def is_diagonal(self) -> bool:
        return not (self.is_horizontal or self.is_vertical)

    @property
    def horizontal_length(self) -> float:
        return abs(self.end_x - self.start_x)

    @property
    def vertical_length(self) -> float:
        return abs(self.end_y - self.start_y)


@dataclass(frozen=True, slots=True)
class VectorGraphics:
    """Vector drawing on the page: path outlines plus their straight and curved segments."""

    path_bounds: tuple[Rectangle, ...] = ()
    straight_segments: tuple[LineSegment, ...] = ()
    curve_segment_count: int = 0


@dataclass(frozen=True, slots=True)
class PageLayoutSnapshot:
    """Everything page inspection needs to know about one page."""

    page_size: PageSize
    text: str = ""
    text_segments: tuple[TextSegment, ...] = ()
    font_names: frozenset[str] = frozenset()
    text_object_count: int = 0
    invisible_text_object_count: int = 0
    image_rectangles: tuple[Rectangle, ...] = ()
    vector_graphics: VectorGraphics = field(default_factory=VectorGraphics)
