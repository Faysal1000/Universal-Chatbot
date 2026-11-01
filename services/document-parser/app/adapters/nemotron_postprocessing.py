"""Run NVIDIA's reference post-processing on Nemotron Parse markup (vendored, unmodified)."""

import logging
from collections.abc import Mapping
from typing import Any

from app.adapters.vendor.nemotron_parse.postprocessing import (
    convert_mmd_to_plain_text_ours,
    postprocess_document,
)
from app.domain.geometry import NormalisedBox, PageSize
from app.domain.vision_blocks import NemotronBlock, is_known_nemotron_class

BOX_DECIMAL_PLACES = 4

logger = logging.getLogger(__name__)


class NvidiaNemotronPostprocessor:
    def postprocess(self, markup: str, image_size: PageSize) -> list[NemotronBlock]:
        document = postprocess_document(markup, image_size=(image_size.width, image_size.height))
        for warning in document.get("warnings", []):
            logger.warning(
                "Nemotron post-processing: block %s: %s", warning["block_index"], warning["message"]
            )
        return [_to_nemotron_block(raw_block, image_size) for raw_block in document["blocks"]]


def _to_nemotron_block(raw_block: Mapping[str, Any], image_size: PageSize) -> NemotronBlock:
    class_name = str(raw_block["class"])
    if not is_known_nemotron_class(class_name):
        logger.warning("Unknown Nemotron class %r mapped to paragraph", class_name)
    left, top, right, bottom = (float(value) for value in raw_block["bbox_pixels"])
    content = str(raw_block["content"])
    return NemotronBlock(
        class_name=class_name,
        box=NormalisedBox.from_corners(
            left / image_size.width,
            top / image_size.height,
            right / image_size.width,
            bottom / image_size.height,
        ).rounded(BOX_DECIMAL_PLACES),
        content=content,
        plain_text=convert_mmd_to_plain_text_ours(content),
    )
