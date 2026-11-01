import pytest

from app.domain.geometry import NormalisedBox
from app.domain.vision_blocks import (
    NEMOTRON_CLASS_TO_BLOCK_TYPE,
    NemotronBlock,
    build_vision_blocks,
    heading_level_for,
    map_nemotron_class,
    strip_formula_delimiters,
)

ANY_BOX = NormalisedBox(0.1, 0.2, 0.9, 0.3)


def a_block(class_name: str, content: str, plain_text: str | None = None) -> NemotronBlock:
    return NemotronBlock(
        class_name=class_name,
        box=ANY_BOX,
        content=content,
        plain_text=plain_text if plain_text is not None else content,
    )


@pytest.mark.parametrize(
    ("class_name", "block_type"),
    [
        ("Title", "heading"),
        ("Section-header", "heading"),
        ("Text", "paragraph"),
        ("Footnote", "paragraph"),
        ("Code", "paragraph"),
        ("TOC", "paragraph"),
        ("Bibliography", "paragraph"),
        ("List-item", "list"),
        ("Table", "table"),
        ("Formula", "formula"),
        ("Picture", "figure"),
        ("Chart", "chart"),
        ("Caption", "caption"),
        ("Page-header", "page_header"),
        ("Page-footer", "page_footer"),
        ("Something-new", "paragraph"),
    ],
)
def test_class_mapping_follows_the_local_llm_contract(class_name: str, block_type: str) -> None:
    assert map_nemotron_class(class_name) == block_type


def test_every_documented_class_is_mapped() -> None:
    assert len(NEMOTRON_CLASS_TO_BLOCK_TYPE) == 15


@pytest.mark.parametrize(
    ("class_name", "content", "level"),
    [("Title", "Report", 1), ("Section-header", "Scope", 2), ("Section-header", "### Detail", 3)],
)
def test_heading_levels(class_name: str, content: str, level: int) -> None:
    assert heading_level_for(class_name, content) == level


def test_heading_block_strips_markup_and_writes_markdown() -> None:
    [heading] = build_vision_blocks([a_block("Section-header", "**Quarterly Report**", "Quarterly Report")])

    assert (heading.text, heading.markdown, heading.heading_level) == (
        "Quarterly Report",
        "## Quarterly Report",
        2,
    )


def test_table_block_has_gfm_and_linearised_text() -> None:
    html = "<table><tr><th>Plan</th><th>Price</th></tr><tr><td>Starter</td><td>$19</td></tr></table>"

    [table] = build_vision_blocks([a_block("Table", html, "ignored")])

    assert table.markdown == "| Plan | Price |\n| --- | --- |\n| Starter | $19 |"
    assert table.text == "Plan | Price\nStarter | $19"


def test_unconverted_latex_table_is_still_converted() -> None:
    latex = r"\begin{tabular}{cc} A & B \\ 1 & 2 \\ \end{tabular}"

    [table] = build_vision_blocks([a_block("Table", latex)])

    assert table.markdown == "| A | B |\n| --- | --- |\n| 1 | 2 |"


def test_unparseable_table_keeps_its_text() -> None:
    [table] = build_vision_blocks([a_block("Table", "garbled", "garbled")])

    assert (table.text, table.markdown) == ("garbled", None)


@pytest.mark.parametrize("formula", ["$$E=mc^2$$", r"\[E=mc^2\]", "$E=mc^2$", "E=mc^2"])
def test_formula_delimiters_are_removed(formula: str) -> None:
    assert strip_formula_delimiters(formula) == "E=mc^2"


def test_formula_block_carries_latex() -> None:
    [formula] = build_vision_blocks([a_block("Formula", "$$E=mc^2$$")])

    assert (formula.latex, formula.markdown) == ("E=mc^2", "$$\nE=mc^2\n$$")


def test_chart_tables_become_markdown() -> None:
    content = "Revenue\n\n<table><tr><th>Year</th></tr><tr><td>2024</td></tr></table>"

    [chart] = build_vision_blocks([a_block("Chart", content)])

    assert chart.markdown == "Revenue\n\n| Year |\n| --- |\n| 2024 |"
    assert chart.text == "Revenue\n\nYear\n2024"


def test_empty_text_blocks_are_dropped_but_empty_pictures_kept() -> None:
    blocks = build_vision_blocks([a_block("Text", "  "), a_block("Picture", "")])

    assert [(block.block_type, block.text) for block in blocks] == [("figure", None)]
