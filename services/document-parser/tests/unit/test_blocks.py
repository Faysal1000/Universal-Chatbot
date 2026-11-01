import uuid
from uuid import UUID

from app.domain.blocks import MAXIMUM_LATEX_CHARACTERS, MAXIMUM_TEXT_CHARACTERS, DraftBlock, derive_block_id
from app.domain.geometry import NormalisedBox

RUN_ID = UUID("7c9e6679-7425-40de-944b-e07fc1f90ae7")
ANY_BOX = NormalisedBox(0.1, 0.1, 0.9, 0.2)


def test_block_id_is_deterministic_for_run_page_and_order() -> None:
    assert derive_block_id(RUN_ID, 3, 7) == derive_block_id(RUN_ID, 3, 7)


def test_block_id_is_uuid5_in_the_run_namespace() -> None:
    block_id = derive_block_id(RUN_ID, 1, 0)

    assert block_id.version == 5


def test_block_ids_differ_by_page_order_and_run() -> None:
    other_run = UUID("0f8fad5b-d9cb-469f-a165-70867728950e")
    block_ids = {
        derive_block_id(RUN_ID, 1, 0),
        derive_block_id(RUN_ID, 1, 1),
        derive_block_id(RUN_ID, 2, 0),
        derive_block_id(other_run, 1, 0),
    }

    assert len(block_ids) == 4


def test_block_id_name_is_page_colon_order() -> None:
    assert derive_block_id(RUN_ID, 12, 4) == uuid.uuid5(RUN_ID, "12:4")


def test_only_visual_blocks_need_crops() -> None:
    assert DraftBlock("table", ANY_BOX, "a").needs_crop
    assert DraftBlock("formula", ANY_BOX, "x").needs_crop
    assert not DraftBlock("paragraph", ANY_BOX, "text").needs_crop


def test_overlong_fields_are_truncated_to_contract_limits() -> None:
    block = DraftBlock(
        "formula", ANY_BOX, "t" * (MAXIMUM_TEXT_CHARACTERS + 5), latex="x" * (MAXIMUM_LATEX_CHARACTERS + 1)
    )

    limited = block.within_contract_limits()

    assert len(limited.text or "") == MAXIMUM_TEXT_CHARACTERS
    assert len(limited.latex or "") == MAXIMUM_LATEX_CHARACTERS
    assert limited.markdown is None
