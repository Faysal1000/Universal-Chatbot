from app.adapters.nemotron_postprocessing import NvidiaNemotronPostprocessor
from app.domain.geometry import NormalisedBox, PageSize
from app.domain.vision_blocks import build_vision_blocks

NEMOTRON_MARKUP = (
    "<x_0.0811><y_0.0781>**Quarterly Service Report**<x_0.5273><y_0.107><class_Section-header>"
    r"<x_0.082><y_0.1688>\begin{tabular}{ccc} Plan & Price & Seats \\ Starter & \$19 & 1 \\ \end{tabular}"
    "<x_0.9141><y_0.2422><class_Table>"
    "<x_0.0811><y_0.3406>ঢাকা অঞ্চলে বিক্রয় বৃদ্ধি পেয়েছে<x_0.8672><y_0.3742><class_Text>"
    "<x_0.1><y_0.4>$$E=mc^2$$<x_0.5><y_0.45><class_Formula>"
    "<x_0.1><y_0.5>Logo<x_0.2><y_0.55><class_Mystery>"
)


def test_postprocessed_blocks_keep_order_classes_and_boxes() -> None:
    blocks = NvidiaNemotronPostprocessor().postprocess(NEMOTRON_MARKUP, PageSize(1000, 1400))

    assert [block.class_name for block in blocks] == ["Section-header", "Table", "Text", "Formula", "Mystery"]
    assert blocks[0].box == NormalisedBox(0.0811, 0.0781, 0.5273, 0.107)
    assert blocks[0].plain_text == "Quarterly Service Report"
    assert blocks[1].content.startswith("<table>")


def test_end_to_end_mapping_to_draft_blocks() -> None:
    nemotron_blocks = NvidiaNemotronPostprocessor().postprocess(NEMOTRON_MARKUP, PageSize(1000, 1400))

    draft_blocks = build_vision_blocks(nemotron_blocks)

    assert [block.block_type for block in draft_blocks] == [
        "heading",
        "table",
        "paragraph",
        "formula",
        "paragraph",
    ]
    assert draft_blocks[1].markdown == "| Plan | Price | Seats |\n| --- | --- | --- |\n| Starter | $19 | 1 |"
    assert draft_blocks[3].latex == "E=mc^2"
