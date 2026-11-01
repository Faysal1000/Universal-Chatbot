import base64
from io import BytesIO

import pytest
from PIL import Image

from app.config import Settings
from app.errors import InvalidImageError
from app.images import normalise_base64_image, open_normalised_image
from tests.conftest import encode_test_image


def test_png_is_normalised_to_jpeg(app_settings: Settings) -> None:
    normalised_image = normalise_base64_image(encode_test_image("PNG"), app_settings)
    with Image.open(BytesIO(normalised_image.jpeg_bytes)) as decoded_image:
        assert decoded_image.format == "JPEG"
        assert decoded_image.size == (12, 12)
    with open_normalised_image(normalised_image) as reopened_image:
        assert reopened_image.mode == "RGB"


def test_transparent_image_is_flattened(app_settings: Settings) -> None:
    normalised_image = normalise_base64_image(encode_test_image("PNG", mode="RGBA"), app_settings)
    assert normalised_image.width_pixels == 12


def test_large_image_is_downscaled(app_settings: Settings) -> None:
    oversized_side = app_settings.max_image_side_pixels + 100
    normalised_image = normalise_base64_image(
        encode_test_image("JPEG", size=(oversized_side, 10)), app_settings
    )
    assert normalised_image.width_pixels == app_settings.max_image_side_pixels


def test_invalid_base64_is_rejected(app_settings: Settings) -> None:
    with pytest.raises(InvalidImageError):
        normalise_base64_image("this is not valid base64!!!", app_settings)


def test_unsupported_format_is_rejected(app_settings: Settings) -> None:
    with pytest.raises(InvalidImageError, match="Only JPEG"):
        normalise_base64_image(encode_test_image("BMP"), app_settings)


def test_non_image_bytes_are_rejected(app_settings: Settings) -> None:
    with pytest.raises(InvalidImageError):
        normalise_base64_image(base64.b64encode(b"definitely not an image" * 4).decode(), app_settings)


def test_pixel_bomb_is_rejected(app_settings: Settings) -> None:
    bomb_settings = app_settings.model_copy(update={"max_image_pixels": 1_000_000})
    with pytest.raises(InvalidImageError, match="pixel limit"):
        normalise_base64_image(encode_test_image("PNG", size=(1001, 1000)), bomb_settings)
