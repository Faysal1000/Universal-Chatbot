import pytest

from app.domain.text_normalisation import (
    group_list_items,
    is_list_item,
    join_lines,
    list_items_to_markdown,
    normalise_whitespace,
)


def test_wrapped_lines_join_with_single_spaces() -> None:
    assert join_lines(["Our service  grew", "  steadily.", ""]) == "Our service grew steadily."


def test_words_hyphenated_at_line_break_are_rejoined() -> None:
    assert join_lines(["The infor-", "mation was clear"]) == "The information was clear"


def test_hyphen_before_capital_is_kept() -> None:
    assert join_lines(["North-", "East region"]) == "North- East region"


@pytest.mark.parametrize(
    "line",
    [
        "• Faster onboarding",
        "- dash item",
        "1. First step",
        "2) Second",
        "(a) option",
        "iv. roman",
        "১. বাংলা",
        "(cid:127) glyph",
    ],
)
def test_list_markers_are_recognised(line: str) -> None:
    assert is_list_item(line)


@pytest.mark.parametrize("line", ["Plain sentence.", "2024 was a good year", "e.g. something", "•no space"])
def test_ordinary_lines_are_not_list_items(line: str) -> None:
    assert not is_list_item(line)


def test_continuation_lines_join_their_item() -> None:
    items = group_list_items(["• First item that", "wraps onto a second line", "• Second item"])

    assert items == ["• First item that wraps onto a second line", "• Second item"]


def test_list_markdown_keeps_numbers_and_normalises_bullets() -> None:
    assert list_items_to_markdown(["• Apples", "2. Pears"]) == "- Apples\n2. Pears"


def test_unmapped_glyphs_become_a_bullet_or_disappear() -> None:
    assert normalise_whitespace("(cid:127) Item with (cid:3)glyph") == "• Item with glyph"
