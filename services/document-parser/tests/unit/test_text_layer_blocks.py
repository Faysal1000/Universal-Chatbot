from app.domain.geometry import PageSize, Rectangle
from app.domain.text_layer_blocks import TextBox, TextLine, build_text_layer_blocks

PAGE = PageSize(width=600.0, height=800.0)


def a_line(
    text: str, top: float, size: float = 10.0, is_bold: bool = False, confidence: float | None = None
) -> TextLine:
    return TextLine(
        text=text,
        rectangle=Rectangle(72, top, 500, top + size),
        size=size,
        is_bold=is_bold,
        confidence=confidence,
    )


def body_box(top: float, line_count: int = 4) -> TextBox:
    return TextBox(
        lines=tuple(
            a_line(f"Body text line number {index} goes here.", top + index * 12)
            for index in range(line_count)
        )
    )


def test_large_text_becomes_a_heading_with_level() -> None:
    blocks = build_text_layer_blocks([TextBox((a_line("Annual Report", 100, size=18),)), body_box(150)], PAGE)

    assert (blocks[0].block_type, blocks[0].heading_level, blocks[0].markdown) == (
        "heading",
        1,
        "# Annual Report",
    )
    assert blocks[1].block_type == "paragraph"


def test_bold_first_line_is_split_from_its_paragraph() -> None:
    glued_box = TextBox((a_line("Scope", 100, is_bold=True), *body_box(112).lines))

    blocks = build_text_layer_blocks([glued_box, body_box(300)], PAGE)

    assert [block.block_type for block in blocks] == ["heading", "paragraph", "paragraph"]
    assert blocks[0].heading_level == 5


def test_long_large_text_is_not_a_heading() -> None:
    large_lines = tuple(
        a_line("Very large text that goes on and on", 100 + index * 20, size=18) for index in range(5)
    )

    blocks = build_text_layer_blocks([TextBox(large_lines), body_box(300, 20)], PAGE)

    assert blocks[0].block_type == "paragraph"


def test_bulleted_lines_become_a_list() -> None:
    list_box = TextBox((a_line("• Apples", 200), a_line("• Pears and", 212), a_line("more pears", 224)))

    blocks = build_text_layer_blocks([list_box, body_box(300)], PAGE)

    assert blocks[0].block_type == "list"
    assert blocks[0].text == "• Apples\n• Pears and more pears"
    assert blocks[0].markdown == "- Apples\n- Pears and more pears"


def test_short_text_in_margins_is_header_or_footer() -> None:
    header = TextBox((a_line("ACME Corp — Confidential", 20),))
    footer = TextBox((a_line("Page 3", 770),))

    blocks = build_text_layer_blocks([header, body_box(300), footer], PAGE)

    assert [block.block_type for block in blocks] == ["page_header", "paragraph", "page_footer"]


def test_box_coordinates_are_normalised() -> None:
    blocks = build_text_layer_blocks([TextBox((a_line("Hello world body", 400),))], PAGE)

    assert (blocks[0].box.x0, blocks[0].box.y0, blocks[0].box.x1, blocks[0].box.y1) == (
        0.12,
        0.5,
        0.8333,
        0.5125,
    )


def test_confidence_is_the_mean_of_line_confidences() -> None:
    box = TextBox((a_line("first line", 300, confidence=0.9), a_line("second line", 312, confidence=0.7)))

    assert build_text_layer_blocks([box], PAGE)[0].confidence == 0.8


def test_whitespace_only_lines_produce_no_block() -> None:
    assert build_text_layer_blocks([TextBox((a_line("   ", 300),))], PAGE) == []
