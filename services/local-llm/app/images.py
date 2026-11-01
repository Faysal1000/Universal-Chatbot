"""Safe decoding of ``data:`` URI images.

Only inline images are accepted, so the service never fetches caller-supplied URLs
(no SSRF). Size and pixel limits run before full decoding to stop decompression bombs.
"""

import base64
import binascii
import re
from dataclasses import dataclass
from io import BytesIO

from PIL import Image, UnidentifiedImageError

from app.errors import InvalidImageError

_DATA_URI_PATTERN = re.compile(r"^data:image/(png|jpeg|jpg|webp|gif|bmp|tiff);base64,", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class ImageLimits:
    """Per-image safety limits."""

    max_bytes: int
    max_pixels: int


def decode_data_uri_image(data_uri: str, limits: ImageLimits) -> Image.Image:
    """Decode a base64 ``data:image/...`` URI into an RGB image, enforcing every safety limit."""
    image_bytes = _decode_data_uri_bytes(data_uri, limits.max_bytes)
    try:
        with Image.open(BytesIO(image_bytes)) as candidate_image:
            width, height = candidate_image.size
            if width * height > limits.max_pixels:
                raise InvalidImageError(f"Image has {width * height} pixels; the maximum is {limits.max_pixels}")
            return candidate_image.convert("RGB")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise InvalidImageError() from error


def validate_data_uri_image(data_uri: str, limits: ImageLimits) -> None:
    """Check scheme, encoding and size without decoding pixels (for pass-through engines)."""
    _decode_data_uri_bytes(data_uri, limits.max_bytes)


def downscale_to_pixel_budget(image: Image.Image, max_pixels: int) -> Image.Image:
    """Shrink (never enlarge) to at most ``max_pixels``, keeping the aspect ratio and text sharp (Lanczos)."""
    pixel_count = image.width * image.height
    if pixel_count <= max_pixels:
        return image
    scale = (max_pixels / pixel_count) ** 0.5
    target_size = (max(1, int(image.width * scale)), max(1, int(image.height * scale)))
    return image.resize(target_size, Image.Resampling.LANCZOS)


def _decode_data_uri_bytes(data_uri: str, max_image_bytes: int) -> bytes:
    header_match = _DATA_URI_PATTERN.match(data_uri)
    if header_match is None:
        raise InvalidImageError("Images must be base64 data URIs (data:image/png;base64,...); URLs are not fetched")
    base64_payload = data_uri[header_match.end() :]
    if len(base64_payload) > _base64_length_limit(max_image_bytes):
        raise InvalidImageError(f"Image exceeds the {max_image_bytes} byte limit")
    try:
        return base64.b64decode(base64_payload, validate=True)
    except (binascii.Error, ValueError) as error:
        raise InvalidImageError("Image data is not valid base64") from error


def _base64_length_limit(max_image_bytes: int) -> int:
    return ((max_image_bytes + 2) // 3) * 4
