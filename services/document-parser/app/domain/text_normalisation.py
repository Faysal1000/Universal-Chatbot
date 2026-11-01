"""Turn extracted text lines into clean block text: whitespace, hyphenation and list items."""

import re
from collections.abc import Sequence

WHITESPACE_RUN = re.compile(r"[ \t\u00a0\u2000-\u200b\u3000]+")
TRAILING_HYPHEN = re.compile(r"[-\u00ad]$")
BULLET_MARKERS = (
    "\u2022\u25e6\u25aa\u25ab\u25cf\u25cb\u25a0\u25a1\u2023\u2043"  # bullets and boxes
    "\u2013\u2014-*\u00b7\u27a2\u27a4\u25ba\u25b6\u2713\u2714"  # dashes, arrows, ticks
)
UNMAPPED_GLYPH = re.compile(r"\(cid:\d+\)")
LEADING_UNMAPPED_GLYPH = re.compile(r"^\s*\(cid:\d+\)\s*")
LIST_ITEM_MARKER = re.compile(
    r"^\s*(?:"
    r"\(cid:\d+\)"  # an unmapped glyph opening a line is almost always a bullet
    r"|"
    rf"[{re.escape(BULLET_MARKERS)}]"  # bullets and dashes
    r"|\(?(?:\d{1,3}|[\u09e6-\u09ef]{1,3}|[a-zA-Z]|[ivxlcdm]{1,6})[.)]"  # 1. 1) (a) iv. ১.
    r")\s+\S"
)
ORDERED_ITEM_MARKER = re.compile(r"^\s*\(?(?:\d{1,3}|[\u09e6-\u09ef]{1,3}|[a-zA-Z]|[ivxlcdm]{1,6})[.)]\s+")
BULLET_ITEM_MARKER = re.compile(rf"^\s*(?:[{re.escape(BULLET_MARKERS)}]|\(cid:\d+\))\s+")


def normalise_whitespace(text: str) -> str:
    """Collapse whitespace; a leading unmapped glyph becomes a bullet, others are dropped."""
    with_bullet = LEADING_UNMAPPED_GLYPH.sub("\u2022 ", text, count=1)
    return WHITESPACE_RUN.sub(" ", UNMAPPED_GLYPH.sub("", with_bullet)).strip()


def join_lines(lines: Sequence[str]) -> str:
    """Join wrapped lines into one paragraph, re-joining words hyphenated at a line break."""
    paragraph = ""
    for raw_line in lines:
        line = normalise_whitespace(raw_line)
        if not line:
            continue
        if not paragraph:
            paragraph = line
        elif _ends_with_broken_word(paragraph, line):
            paragraph = paragraph[:-1] + line
        else:
            paragraph = f"{paragraph} {line}"
    return paragraph


def is_list_item(line: str) -> bool:
    return LIST_ITEM_MARKER.match(line) is not None


def group_list_items(lines: Sequence[str]) -> list[str]:
    """Each item starts at a marker line; following lines without a marker continue it."""
    items: list[list[str]] = []
    for line in lines:
        if is_list_item(line) or not items:
            items.append([line])
        else:
            items[-1].append(line)
    return [join_lines(item_lines) for item_lines in items]


def list_items_to_markdown(items: Sequence[str]) -> str:
    return "\n".join(_list_item_to_markdown(item) for item in items)


def _list_item_to_markdown(item: str) -> str:
    if ORDERED_ITEM_MARKER.match(item):
        return item
    return f"- {BULLET_ITEM_MARKER.sub('', item, count=1)}"


def _ends_with_broken_word(paragraph: str, next_line: str) -> bool:
    if not TRAILING_HYPHEN.search(paragraph) or len(paragraph) < 2:
        return False
    return paragraph[-2].isalpha() and next_line[:1].islower()
