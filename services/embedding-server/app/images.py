"""Untrusted image validation and normalisation.

Images arrive as raw Base64. They are fully validated, flattened to RGB, resized to a
bounded side length, stripped of all metadata, and re-encoded as JPEG bytes that are
held in memory until inference. Nothing is written to disk, so the container can run
with a read-only root filesystem and there are no temporary files to leak.
"""

import base64
import binascii
import warnings
from dataclasses import dataclass
from io import BytesIO

from PIL import Image, UnidentifiedImageError

from app.config import Settings
from app.errors import InvalidImageError

ALLOWED_IMAGE_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})
NORMALISED_JPEG_QUALITY = 90
_TRANSPARENCY_BACKGROUND_COLOUR = (255, 255, 255)


@dataclass(frozen=True, slots=True)
class NormalisedImage:
    """A validated image re-encoded as metadata-free JPEG bytes."""

    jpeg_bytes: bytes
    width_pixels: int
    height_pixels: int


def _decode_base64_payload(encoded_image: str, settings: Settings) -> bytes:
    """Strictly decode standard Base64 and enforce the raw-size limit."""
    if len(encoded_image) > settings.base64_image_character_limit:
        raise InvalidImageError("Image exceeds the configured size limit")
    try:
        raw_image_bytes = base64.b64decode(encoded_image, validate=True)
    except (binascii.Error, ValueError) as decode_error:
        raise InvalidImageError("image_base64 must be valid standard Base64") from decode_error
    if not raw_image_bytes:
        raise InvalidImageError("Image is empty")
    if len(raw_image_bytes) > settings.max_image_bytes:
        raise InvalidImageError("Image exceeds the configured size limit")
    return raw_image_bytes


def _inspect_image_header(raw_image_bytes: bytes, settings: Settings) -> None:
    """Check format, frame count, and pixel budget before decoding any pixel data."""
    with Image.open(BytesIO(raw_image_bytes)) as header_probe:
        if header_probe.format not in ALLOWED_IMAGE_FORMATS:
            raise InvalidImageError("Only JPEG, PNG, and WEBP images are supported")
        if getattr(header_probe, "is_animated", False) or getattr(header_probe, "n_frames", 1) > 1:
            raise InvalidImageError("Animated images are not supported")
        if header_probe.width < 1 or header_probe.height < 1:
            raise InvalidImageError("Image dimensions are invalid")
        if header_probe.width * header_probe.height > settings.max_image_pixels:
            raise InvalidImageError("Image exceeds the configured pixel limit")
        header_probe.verify()


def _flatten_to_rgb(source_image: Image.Image) -> Image.Image:
    """Convert any supported mode to RGB, compositing transparency onto white."""
    if "A" in source_image.getbands() or source_image.mode == "P":
        rgba_image = source_image.convert("RGBA")
        rgb_image = Image.new("RGB", rgba_image.size, _TRANSPARENCY_BACKGROUND_COLOUR)
        rgb_image.paste(rgba_image, mask=rgba_image.getchannel("A"))
        rgba_image.close()
        return rgb_image
    return source_image.convert("RGB")


def normalise_base64_image(encoded_image: str, settings: Settings) -> NormalisedImage:
    """Validate an untrusted Base64 image and return a safe, bounded JPEG re-encoding.

    This is CPU-bound and must be called from a worker thread, not the event loop.

    Raises:
        InvalidImageError: If the payload is not valid Base64, not an allowed format,
            animated, a decompression bomb, or exceeds any configured limit.
    """
    raw_image_bytes = _decode_base64_payload(encoded_image, settings)
    try:
        with warnings.catch_warnings():
            # Promote Pillow's soft decompression-bomb warning to a hard failure.
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            _inspect_image_header(raw_image_bytes, settings)

            # verify() invalidates the probe, so the image must be reopened to decode.
            with Image.open(BytesIO(raw_image_bytes)) as source_image:
                source_image.load()
                rgb_image = _flatten_to_rgb(source_image)

            try:
                side_limit = settings.max_image_side_pixels
                rgb_image.thumbnail((side_limit, side_limit), Image.Resampling.LANCZOS)
                jpeg_buffer = BytesIO()
                rgb_image.save(
                    jpeg_buffer,
                    format="JPEG",
                    quality=NORMALISED_JPEG_QUALITY,
                    optimize=True,
                )
                return NormalisedImage(
                    jpeg_bytes=jpeg_buffer.getvalue(),
                    width_pixels=rgb_image.width,
                    height_pixels=rgb_image.height,
                )
            finally:
                rgb_image.close()
    except InvalidImageError:
        raise
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        SyntaxError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ) as decode_error:
        raise InvalidImageError("Image could not be decoded safely") from decode_error


def open_normalised_image(normalised_image: NormalisedImage) -> Image.Image:
    """Decode previously normalised JPEG bytes into an RGB PIL image for inference."""
    pil_image = Image.open(BytesIO(normalised_image.jpeg_bytes))
    pil_image.load()
    return pil_image
