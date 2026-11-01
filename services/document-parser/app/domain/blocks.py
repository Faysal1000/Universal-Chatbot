"""Normalised content blocks, before page-level provenance (IDs, order, crops) is attached."""

import uuid
from dataclasses import dataclass, replace
from typing import Literal
from uuid import UUID

from app.domain.geometry import NormalisedBox

BlockType = Literal[
    "heading",
    "paragraph",
    "list",
    "table",
    "formula",
    "figure",
    "chart",
    "caption",
    "page_header",
    "page_footer",
]

CROPPED_BLOCK_TYPES: frozenset[BlockType] = frozenset({"table", "chart", "figure", "formula"})

# Upper bounds from block-manifest-record.v1; longer values are truncated, never rejected.
MAXIMUM_TEXT_CHARACTERS = 100_000
MAXIMUM_MARKDOWN_CHARACTERS = 200_000
MAXIMUM_LATEX_CHARACTERS = 20_000


@dataclass(frozen=True, slots=True)
class DraftBlock:
    """One block of a page in reading order, as produced by any extraction method."""

    block_type: BlockType
    box: NormalisedBox
    text: str | None
    markdown: str | None = None
    latex: str | None = None
    heading_level: int | None = None
    confidence: float | None = None

    @property
    def needs_crop(self) -> bool:
        return self.block_type in CROPPED_BLOCK_TYPES

    def within_contract_limits(self) -> "DraftBlock":
        return replace(
            self,
            text=_truncate(self.text, MAXIMUM_TEXT_CHARACTERS),
            markdown=_truncate(self.markdown, MAXIMUM_MARKDOWN_CHARACTERS),
            latex=_truncate(self.latex, MAXIMUM_LATEX_CHARACTERS),
        )


def derive_block_id(ingestion_run_id: UUID, page_number: int, reading_order: int) -> UUID:
    """UUIDv5 in the run's namespace, so a retried batch reproduces the same block IDs."""
    return uuid.uuid5(ingestion_run_id, f"{page_number}:{reading_order}")


def _truncate(value: str | None, maximum_characters: int) -> str | None:
    if value is None or len(value) <= maximum_characters:
        return value
    return value[:maximum_characters]
