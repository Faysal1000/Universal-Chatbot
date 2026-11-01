import pytest

from app.domain.heading_levels import estimate_body_font_size, infer_heading_level, is_bold_font_name


@pytest.mark.parametrize(
    ("font_size", "is_bold", "expected_level"),
    [
        (18.0, False, 1),
        (14.0, False, 2),
        (12.0, True, 3),
        (10.9, False, 4),
        (10.0, True, 5),
        (10.0, False, None),
        (8.0, True, None),
    ],
)
def test_heading_level_follows_size_relative_to_body(
    font_size: float, is_bold: bool, expected_level: int | None
) -> None:
    assert infer_heading_level(font_size, body_font_size=10.0, is_bold=is_bold) == expected_level


def test_no_heading_without_a_body_size() -> None:
    assert infer_heading_level(18.0, body_font_size=0.0, is_bold=True) is None


def test_body_size_is_the_size_with_most_characters() -> None:
    sized_runs = [(18.0, 20), (10.0, 400), (10.1, 50), (14.0, 30)]

    assert estimate_body_font_size(sized_runs) == 10.0


def test_body_size_of_empty_page_is_zero() -> None:
    assert estimate_body_font_size([]) == 0.0


@pytest.mark.parametrize(
    ("font_name", "expected"),
    [
        ("ABCDEF+Helvetica-Bold", True),
        ("Arial,Bold", True),
        ("Roboto-Black", True),
        ("SegoeUI-Semibold", True),
        ("Arial,B", True),
        ("Helvetica", False),
        ("Times-Italic", False),
    ],
)
def test_bold_font_names(font_name: str, expected: bool) -> None:
    assert is_bold_font_name(font_name) is expected
