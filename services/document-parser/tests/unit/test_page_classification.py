import pytest

from app.domain.geometry import PageSize, Rectangle
from app.domain.page_classification import classify_page_kind, has_readable_text_layer, text_coverage_ratio
from app.domain.page_layout import PageLayoutSnapshot, TextSegment, VectorGraphics

A4 = PageSize(width=595.0, height=842.0)
FULL_PAGE_IMAGE = Rectangle(0, 0, 595, 842)
BODY_TEXT = "Our service grew steadily throughout the year and customers were happy. " * 3


def a_page(
    text: str = "",
    images: tuple[Rectangle, ...] = (),
    text_objects: int = 0,
    invisible_text_objects: int = 0,
    curve_segments: int = 0,
) -> PageLayoutSnapshot:
    return PageLayoutSnapshot(
        page_size=A4,
        text=text,
        text_object_count=text_objects,
        invisible_text_object_count=invisible_text_objects,
        image_rectangles=images,
        vector_graphics=VectorGraphics(curve_segment_count=curve_segments),
    )


def test_text_page_without_images_is_digital() -> None:
    assert classify_page_kind(a_page(text=BODY_TEXT, text_objects=3)) == "digital"


def test_image_only_page_is_scanned() -> None:
    assert classify_page_kind(a_page(images=(FULL_PAGE_IMAGE,))) == "scanned"


def test_blank_page_is_digital() -> None:
    assert classify_page_kind(a_page()) == "digital"


def test_outlined_glyphs_without_text_layer_are_scanned() -> None:
    assert classify_page_kind(a_page(curve_segments=500)) == "scanned"


def test_text_over_full_page_image_is_hybrid() -> None:
    assert classify_page_kind(a_page(text=BODY_TEXT, images=(FULL_PAGE_IMAGE,), text_objects=3)) == "hybrid"


def test_invisible_ocr_text_layer_is_hybrid() -> None:
    page = a_page(
        text=BODY_TEXT, images=(Rectangle(0, 0, 100, 100),), text_objects=10, invisible_text_objects=10
    )

    assert classify_page_kind(page) == "hybrid"


def test_small_image_on_text_page_stays_digital() -> None:
    page = a_page(text=BODY_TEXT, images=(Rectangle(50, 50, 200, 200),), text_objects=3)

    assert classify_page_kind(page) == "digital"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        (BODY_TEXT, True),
        ("short", False),
        ("�" * 40, False),
        ("" * 30 + "abc" * 3, False),
    ],
)
def test_readable_text_layer(text: str, expected: bool) -> None:
    assert has_readable_text_layer(text) is expected


def test_garbled_text_with_full_image_is_scanned() -> None:
    assert classify_page_kind(a_page(text="�" * 100, images=(FULL_PAGE_IMAGE,))) == "scanned"


def test_text_coverage_ratio_sums_segment_areas() -> None:
    page = PageLayoutSnapshot(
        page_size=PageSize(100, 100),
        text_segments=(TextSegment(Rectangle(0, 0, 50, 10), "a"), TextSegment(Rectangle(0, 20, 50, 30), "b")),
    )

    assert text_coverage_ratio(page) == pytest.approx(0.1)
