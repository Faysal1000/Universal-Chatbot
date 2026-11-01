from uuid import UUID

import pytest

from app.domain.errors import FailureCode, PermanentJobError
from app.domain.object_keys import (
    converted_source_key,
    crop_key,
    manifest_key,
    page_render_key,
    vision_markup_cache_key,
)
from app.domain.source_formats import infer_image_resolution_dpi, resolve_source_format

PREFIX = "documents/a/runs/b/"


@pytest.mark.parametrize(
    ("mime_type", "source_format"),
    [("application/pdf", "pdf"), ("image/png", "image"), ("image/jpeg", "image"), ("image/tiff", "image")],
)
def test_supported_formats(mime_type: str, source_format: str) -> None:
    assert resolve_source_format(mime_type) == source_format


@pytest.mark.parametrize(
    "mime_type",
    [
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/html",
    ],
)
def test_office_and_unknown_formats_fail_permanently(mime_type: str) -> None:
    with pytest.raises(PermanentJobError) as raised:
        resolve_source_format(mime_type)

    assert raised.value.code is FailureCode.UNSUPPORTED_FORMAT
    assert str(raised.value).startswith("unsupported_format: ")


def test_declared_resolution_is_used_when_plausible() -> None:
    assert infer_image_resolution_dpi(2480, 3508, 300.0) == 300.0


def test_missing_resolution_makes_the_long_side_one_a4_height() -> None:
    assert infer_image_resolution_dpi(1169, 800, None) == pytest.approx(100.0)
    assert infer_image_resolution_dpi(2000, 3000, 1.0) == pytest.approx(3000 / 11.69)


def test_inferred_resolution_is_bounded() -> None:
    assert infer_image_resolution_dpi(100, 100, None) == 72.0
    assert infer_image_resolution_dpi(100_000, 100, None) == 1200.0


def test_object_keys_live_under_the_output_prefix() -> None:
    block_id = UUID("5df5cdf2-3c3b-5c1a-9f2e-6a1d6c0b8e11")

    assert converted_source_key(PREFIX) == "documents/a/runs/b/source.pdf"
    assert page_render_key(PREFIX, 2) == "documents/a/runs/b/pages/2.png"
    assert vision_markup_cache_key(PREFIX, 2) == "documents/a/runs/b/pages/2.document_parse.txt"
    assert crop_key(PREFIX, block_id) == f"documents/a/runs/b/crops/{block_id}.png"
    assert manifest_key(PREFIX, 7) == "documents/a/runs/b/blocks-0007.jsonl"
