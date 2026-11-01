from app.domain.geometry import PageSize, Rectangle
from app.domain.page_complexity import (
    assess_page_complexity,
    has_aligned_text_grid,
    has_chart,
    has_formula,
    has_multiple_text_columns,
    has_significant_image,
    has_table,
    is_math_font,
)
from app.domain.page_layout import LineSegment, PageLayoutSnapshot, TextSegment, VectorGraphics

A4 = PageSize(width=595.0, height=842.0)


def horizontal(y: float, left: float = 100, right: float = 400) -> LineSegment:
    return LineSegment(left, y, right, y)


def vertical(x: float, top: float = 100, bottom: float = 300) -> LineSegment:
    return LineSegment(x, top, x, bottom)


def a_segment(left: float, top: float, width: float, text: str, height: float = 10) -> TextSegment:
    return TextSegment(Rectangle(left, top, left + width, top + height), text)


def a_page(**fields: object) -> PageLayoutSnapshot:
    return PageLayoutSnapshot(page_size=A4, **fields)  # type: ignore[arg-type]


def grid_rows(row_count: int, column_lefts: tuple[float, ...] = (100, 250, 400)) -> tuple[TextSegment, ...]:
    return tuple(
        a_segment(left, 100 + row * 20, 60, f"cell {row}-{column}")
        for row in range(row_count)
        for column, left in enumerate(column_lefts)
    )


# ----------------------------------------------------------------------------- tables


def test_ruled_grid_is_a_table() -> None:
    graphics = VectorGraphics(
        straight_segments=(
            *(horizontal(y) for y in (100, 140, 180, 220)),
            *(vertical(x) for x in (100, 250, 400)),
        )
    )

    assert has_table(a_page(vector_graphics=graphics))


def test_three_rules_and_aligned_cells_are_a_booktabs_table() -> None:
    graphics = VectorGraphics(straight_segments=tuple(horizontal(y) for y in (95, 120, 170)))

    assert has_table(a_page(vector_graphics=graphics, text_segments=grid_rows(3)))


def test_box_around_text_is_not_a_table() -> None:
    graphics = VectorGraphics(
        straight_segments=(horizontal(100), horizontal(300), vertical(100), vertical(400))
    )

    assert not has_table(a_page(vector_graphics=graphics))


def test_bars_of_different_heights_are_not_table_rules() -> None:
    bars = tuple(
        segment
        for index, height in enumerate((100, 150, 200, 250))
        for segment in (
            horizontal(500 - height, 100 + index * 80, 140 + index * 80),
            horizontal(500, 100 + index * 80, 140 + index * 80),
            vertical(100 + index * 80, 500 - height, 500),
            vertical(140 + index * 80, 500 - height, 500),
        )
    )

    assert not has_table(a_page(vector_graphics=VectorGraphics(straight_segments=bars)))


def test_thin_filled_rectangles_count_as_rules() -> None:
    rules = tuple(Rectangle(100, y, 400, y + 0.5) for y in (100, 150, 200))

    assert has_table(a_page(vector_graphics=VectorGraphics(path_bounds=rules), text_segments=grid_rows(3)))


def test_aligned_text_grid_needs_three_rows() -> None:
    assert has_aligned_text_grid(grid_rows(3), A4)
    assert not has_aligned_text_grid(grid_rows(2), A4)


def test_prose_lines_are_not_a_grid() -> None:
    prose = tuple(a_segment(72, 100 + row * 14, 450, "A full line of body text.") for row in range(20))

    assert not has_aligned_text_grid(prose, A4)


# ----------------------------------------------------------------------------- formulas


def test_tex_math_font_signals_a_formula() -> None:
    assert has_formula(a_page(font_names=frozenset({"ABCDEF+CMMI10"})))


def test_math_operators_in_text_signal_a_formula() -> None:
    assert has_formula(a_page(text="∑ f(x) ≤ ∫ g(x) dx"))


def test_symbol_font_alone_is_just_bullets() -> None:
    assert not has_formula(a_page(font_names=frozenset({"Symbol"}), text="• item"))


def test_symbol_font_with_math_characters_is_a_formula() -> None:
    assert has_formula(a_page(font_names=frozenset({"Symbol"}), text="x ≠ y"))


def test_plain_text_has_no_formula() -> None:
    assert not has_formula(a_page(font_names=frozenset({"Helvetica"}), text="Price is 5 - 3 = 2"))


def test_math_font_names() -> None:
    assert is_math_font("Cambria Math")
    assert is_math_font("STIXTwoMath-Regular")
    assert not is_math_font("Calibri")


# ----------------------------------------------------------------------------- charts


def year_labels() -> tuple[TextSegment, ...]:
    return tuple(a_segment(100 + index * 80, 510, 30, str(2021 + index)) for index in range(4))


def test_bars_with_axis_labels_are_a_chart() -> None:
    bars = tuple(
        Rectangle(100 + index * 80, 500 - height, 140 + index * 80, 500)
        for index, height in enumerate((100, 150, 200, 250))
    )

    assert has_chart(a_page(vector_graphics=VectorGraphics(path_bounds=bars), text_segments=year_labels()))


def test_line_plot_with_labels_is_a_chart() -> None:
    plot = tuple(
        LineSegment(100 + step * 10, 400 - step * 3, 110 + step * 10, 395 - step * 4) for step in range(15)
    )

    assert has_chart(
        a_page(vector_graphics=VectorGraphics(straight_segments=plot), text_segments=year_labels())
    )


def test_shapes_without_labels_are_not_a_chart() -> None:
    plot = VectorGraphics(curve_segment_count=50)

    assert not has_chart(a_page(vector_graphics=plot))


# ----------------------------------------------------------------------------- images and columns


def test_tiny_images_are_ignored() -> None:
    assert not has_significant_image(a_page(image_rectangles=(Rectangle(0, 0, 10, 10),)))
    assert has_significant_image(a_page(image_rectangles=(Rectangle(0, 0, 200, 200),)))


def column_lines(left: float, count: int) -> tuple[TextSegment, ...]:
    return tuple(a_segment(left, 100 + row * 14, 230, "column text line here") for row in range(count))


def test_two_side_by_side_columns() -> None:
    assert has_multiple_text_columns(a_page(text_segments=column_lines(54, 20) + column_lines(320, 20)))


def test_single_column_page() -> None:
    wide_lines = tuple(
        a_segment(72, 100 + row * 14, 450, "A long single column line of text") for row in range(30)
    )

    assert not has_multiple_text_columns(a_page(text_segments=wide_lines))


def test_columns_one_above_the_other_are_not_side_by_side() -> None:
    upper = column_lines(54, 10)
    lower = tuple(a_segment(320, 600 + row * 14, 230, "column text line here") for row in range(10))

    assert not has_multiple_text_columns(a_page(text_segments=upper + lower))


def test_assessment_combines_every_flag() -> None:
    flags = assess_page_complexity(a_page(text="∑ ∫ ≤", image_rectangles=(Rectangle(0, 0, 300, 300),)))

    assert (
        flags.has_formulas,
        flags.has_images,
        flags.has_tables,
        flags.has_charts,
        flags.has_multiple_columns,
    ) == (
        True,
        True,
        False,
        False,
        False,
    )
