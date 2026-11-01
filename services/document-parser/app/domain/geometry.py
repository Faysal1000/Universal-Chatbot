"""Page geometry: rectangles in page units and boxes normalised to the page."""

from collections.abc import Iterable
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class PageSize:
    """Page or image dimensions in a single unit (PDF points or pixels)."""

    width: float
    height: float

    @property
    def area(self) -> float:
        return self.width * self.height


@dataclass(frozen=True, slots=True)
class Rectangle:
    """Axis-aligned rectangle with a top-left origin, in the same unit as its page."""

    left: float
    top: float
    right: float
    bottom: float

    @property
    def width(self) -> float:
        return max(0.0, self.right - self.left)

    @property
    def height(self) -> float:
        return max(0.0, self.bottom - self.top)

    @property
    def area(self) -> float:
        return self.width * self.height

    def clipped_to(self, page_size: PageSize) -> "Rectangle":
        return Rectangle(
            left=_clamp(self.left, 0.0, page_size.width),
            top=_clamp(self.top, 0.0, page_size.height),
            right=_clamp(self.right, 0.0, page_size.width),
            bottom=_clamp(self.bottom, 0.0, page_size.height),
        )

    def vertical_overlap_with(self, other: "Rectangle") -> float:
        return max(0.0, min(self.bottom, other.bottom) - max(self.top, other.top))


@dataclass(frozen=True, slots=True)
class NormalisedBox:
    """Box relative to its page: every coordinate in 0..1, origin at the top-left corner."""

    x0: float
    y0: float
    x1: float
    y1: float

    @classmethod
    def from_rectangle(cls, rectangle: Rectangle, page_size: PageSize) -> "NormalisedBox":
        return cls.from_corners(
            rectangle.left / page_size.width,
            rectangle.top / page_size.height,
            rectangle.right / page_size.width,
            rectangle.bottom / page_size.height,
        )

    @classmethod
    def from_corners(
        cls, first_x: float, first_y: float, second_x: float, second_y: float
    ) -> "NormalisedBox":
        """Order and clamp two arbitrary corners into a valid normalised box."""
        return cls(
            x0=_clamp(min(first_x, second_x), 0.0, 1.0),
            y0=_clamp(min(first_y, second_y), 0.0, 1.0),
            x1=_clamp(max(first_x, second_x), 0.0, 1.0),
            y1=_clamp(max(first_y, second_y), 0.0, 1.0),
        )

    def rounded(self, decimal_places: int = 4) -> "NormalisedBox":
        return NormalisedBox(
            x0=round(self.x0, decimal_places),
            y0=round(self.y0, decimal_places),
            x1=round(self.x1, decimal_places),
            y1=round(self.y1, decimal_places),
        )


def bounding_rectangle(rectangles: Iterable[Rectangle]) -> Rectangle:
    """Smallest rectangle containing every input; raises ``ValueError`` for no input."""
    rectangle_list = list(rectangles)
    if not rectangle_list:
        raise ValueError("bounding_rectangle needs at least one rectangle")
    return Rectangle(
        left=min(rectangle.left for rectangle in rectangle_list),
        top=min(rectangle.top for rectangle in rectangle_list),
        right=max(rectangle.right for rectangle in rectangle_list),
        bottom=max(rectangle.bottom for rectangle in rectangle_list),
    )


def coverage_ratio(rectangles: Iterable[Rectangle], page_size: PageSize) -> float:
    """Share of the page covered by the rectangles (overlaps counted twice, capped at 1)."""
    if page_size.area <= 0:
        return 0.0
    covered_area = sum(rectangle.clipped_to(page_size).area for rectangle in rectangles)
    return _clamp(covered_area / page_size.area, 0.0, 1.0)


def _clamp(value: float, lower_bound: float, upper_bound: float) -> float:
    return min(upper_bound, max(lower_bound, value))
