import pytest

from app.domain.geometry import NormalisedBox, PageSize, Rectangle, bounding_rectangle, coverage_ratio

PAGE = PageSize(width=200.0, height=100.0)


def test_normalised_box_orders_and_clamps_corners() -> None:
    assert NormalisedBox.from_corners(1.2, 0.8, -0.1, 0.2) == NormalisedBox(0.0, 0.2, 1.0, 0.8)


def test_rectangle_is_normalised_against_its_page() -> None:
    box = NormalisedBox.from_rectangle(Rectangle(50, 25, 150, 75), PAGE)

    assert box == NormalisedBox(0.25, 0.25, 0.75, 0.75)


def test_coverage_is_clipped_to_the_page_and_capped() -> None:
    assert coverage_ratio([Rectangle(-50, 0, 100, 100)], PAGE) == 0.5
    assert coverage_ratio([Rectangle(0, 0, 200, 100), Rectangle(0, 0, 200, 100)], PAGE) == 1.0


def test_coverage_of_degenerate_page_is_zero() -> None:
    assert coverage_ratio([Rectangle(0, 0, 1, 1)], PageSize(0, 0)) == 0.0


def test_bounding_rectangle_needs_input() -> None:
    with pytest.raises(ValueError, match="at least one"):
        bounding_rectangle([])


def test_vertical_overlap() -> None:
    assert Rectangle(0, 0, 10, 10).vertical_overlap_with(Rectangle(0, 5, 10, 20)) == 5
    assert Rectangle(0, 0, 10, 10).vertical_overlap_with(Rectangle(0, 15, 10, 20)) == 0
