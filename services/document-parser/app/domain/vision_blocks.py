"""Map Nemotron Parse blocks (after NVIDIA's post-processing) to normalised blocks.

Class mapping follows the local-llm document parsing contract. Headings use the level
Nemotron wrote as Markdown hashes, else ``Title`` = 1 and ``Section-header`` = 2 (the same
levels NVIDIA's own Markdown renderer emits).
"""

import re
from dataclasses import dataclass

from app.domain.blocks import BlockType, DraftBlock
from app.domain.geometry import NormalisedBox
from app.domain.table_markdown import (
    Table,
    html_table_to_table,
    latex_tabular_to_table,
    linearise_table,
    replace_html_tables_with_linearised_text,
    replace_html_tables_with_markdown,
    table_to_markdown,
)

NEMOTRON_CLASS_TO_BLOCK_TYPE: dict[str, BlockType] = {
    "Title": "heading",
    "Section-header": "heading",
    "Text": "paragraph",
    "Footnote": "paragraph",
    "Code": "paragraph",
    "TOC": "paragraph",
    "Bibliography": "paragraph",
    "List-item": "list",
    "Table": "table",
    "Formula": "formula",
    "Picture": "figure",
    "Chart": "chart",
    "Caption": "caption",
    "Page-header": "page_header",
    "Page-footer": "page_footer",
}
DEFAULT_BLOCK_TYPE: BlockType = "paragraph"
TITLE_HEADING_LEVEL = 1
SECTION_HEADER_HEADING_LEVEL = 2
MARKDOWN_HEADING_PREFIX = re.compile(r"^(#{1,6})\s+")
FORMULA_DELIMITERS = re.compile(r"^\s*(?:\$\$|\\\[|\\\(|\$)(.*?)(?:\$\$|\\\]|\\\)|\$)\s*$", re.DOTALL)
BLOCK_TYPES_KEPT_WITHOUT_TEXT: frozenset[BlockType] = frozenset({"figure", "chart", "table", "formula"})


@dataclass(frozen=True, slots=True)
class NemotronBlock:
    """One post-processed Nemotron block.

    ``content`` is NVIDIA's rendered content (Markdown; tables as HTML, or the original LaTeX
    when conversion failed) and ``plain_text`` its Markdown-stripped form.
    """

    class_name: str
    box: NormalisedBox
    content: str
    plain_text: str


def map_nemotron_class(class_name: str) -> BlockType:
    return NEMOTRON_CLASS_TO_BLOCK_TYPE.get(class_name, DEFAULT_BLOCK_TYPE)


def is_known_nemotron_class(class_name: str) -> bool:
    return class_name in NEMOTRON_CLASS_TO_BLOCK_TYPE


def build_vision_blocks(nemotron_blocks: list[NemotronBlock]) -> list[DraftBlock]:
    """Blocks in Nemotron's reading order; text blocks with no text are dropped."""
    draft_blocks = [_build_block(nemotron_block) for nemotron_block in nemotron_blocks]
    return [block for block in draft_blocks if _has_content(block)]


def _build_block(nemotron_block: NemotronBlock) -> DraftBlock:
    block_type = map_nemotron_class(nemotron_block.class_name)
    if block_type == "heading":
        return _heading_block(nemotron_block)
    if block_type == "table":
        return _table_block(nemotron_block)
    if block_type == "formula":
        return _formula_block(nemotron_block)
    if block_type == "chart":
        return _chart_block(nemotron_block)
    return DraftBlock(
        block_type=block_type,
        box=nemotron_block.box,
        text=_text_or_none(nemotron_block.plain_text),
        markdown=_text_or_none(nemotron_block.content),
    )


def _heading_block(nemotron_block: NemotronBlock) -> DraftBlock:
    heading_level = heading_level_for(nemotron_block.class_name, nemotron_block.content)
    heading_text = MARKDOWN_HEADING_PREFIX.sub("", nemotron_block.plain_text).strip()
    return DraftBlock(
        block_type="heading",
        box=nemotron_block.box,
        text=_text_or_none(heading_text),
        markdown=f"{'#' * heading_level} {heading_text}" if heading_text else None,
        heading_level=heading_level,
    )


def heading_level_for(class_name: str, content: str) -> int:
    explicit_level = MARKDOWN_HEADING_PREFIX.match(content.strip())
    if explicit_level is not None:
        return len(explicit_level.group(1))
    return TITLE_HEADING_LEVEL if class_name == "Title" else SECTION_HEADER_HEADING_LEVEL


def _table_block(nemotron_block: NemotronBlock) -> DraftBlock:
    table = _parse_table(nemotron_block.content)
    if table is None or table.is_empty:
        return DraftBlock(
            block_type="table",
            box=nemotron_block.box,
            text=_text_or_none(nemotron_block.plain_text),
            markdown=None,
        )
    return DraftBlock(
        block_type="table",
        box=nemotron_block.box,
        text=_text_or_none(linearise_table(table)),
        markdown=table_to_markdown(table),
    )


def _parse_table(content: str) -> Table | None:
    return html_table_to_table(content) or latex_tabular_to_table(content)


def _formula_block(nemotron_block: NemotronBlock) -> DraftBlock:
    latex = strip_formula_delimiters(nemotron_block.content)
    return DraftBlock(
        block_type="formula",
        box=nemotron_block.box,
        text=_text_or_none(latex),
        markdown=f"$$\n{latex}\n$$" if latex else None,
        latex=_text_or_none(latex),
    )


def strip_formula_delimiters(formula: str) -> str:
    match = FORMULA_DELIMITERS.match(formula)
    return (match.group(1) if match else formula).strip()


def _chart_block(nemotron_block: NemotronBlock) -> DraftBlock:
    return DraftBlock(
        block_type="chart",
        box=nemotron_block.box,
        text=_text_or_none(replace_html_tables_with_linearised_text(nemotron_block.content)),
        markdown=_text_or_none(replace_html_tables_with_markdown(nemotron_block.content)),
    )


def _has_content(block: DraftBlock) -> bool:
    return block.block_type in BLOCK_TYPES_KEPT_WITHOUT_TEXT or bool(block.text)


def _text_or_none(text: str) -> str | None:
    stripped_text = text.strip()
    return stripped_text or None
