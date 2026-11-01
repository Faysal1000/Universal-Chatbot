"""Convert PNG, JPEG and (multi-frame) TIFF uploads into a PDF with one page per frame.

Frames are re-encoded as JPEG and written one at a time with PDFium, so memory holds a
single frame however many pages a TIFF has.
"""

import io

import pypdfium2 as pdfium
from PIL import Image, ImageSequence, UnidentifiedImageError

from app.adapters.pdfium_document import PDFIUM_LOCK, POINTS_PER_INCH
from app.domain.errors import FailureCode, PermanentJobError
from app.domain.source_formats import infer_image_resolution_dpi

JPEG_QUALITY = 92
JPEG_COMPATIBLE_MODES = frozenset({"RGB", "L"})


class PillowImageToPdfConverter:
    def __init__(self, maximum_image_pixels: int) -> None:
        self._maximum_image_pixels = maximum_image_pixels

    def convert_to_pdf(self, image_bytes: bytes, maximum_pages: int) -> bytes:
        with self._open_image(image_bytes) as image:
            frame_count = int(getattr(image, "n_frames", 1))
            if frame_count > maximum_pages:
                raise PermanentJobError(
                    FailureCode.TOO_MANY_PAGES,
                    f"the image has {frame_count} frames; the limit is {maximum_pages}",
                )
            return self._write_pdf(image)

    def _open_image(self, image_bytes: bytes) -> Image.Image:
        # The configured pixel limit is checked below; Pillow's own (lower) warning threshold is not used.
        try:
            image = Image.open(io.BytesIO(image_bytes))
            self._reject_oversized(image)
            return image
        except Image.DecompressionBombError as error:
            raise PermanentJobError(
                FailureCode.SOURCE_TOO_LARGE, f"the image is too large: {error}"
            ) from error
        except (UnidentifiedImageError, OSError) as error:
            raise PermanentJobError(
                FailureCode.CORRUPT_DOCUMENT, f"the image cannot be read: {error}"
            ) from error

    def _reject_oversized(self, image: Image.Image) -> None:
        pixel_count = image.width * image.height
        if pixel_count > self._maximum_image_pixels:
            raise PermanentJobError(
                FailureCode.SOURCE_TOO_LARGE,
                f"the image has {pixel_count} pixels; the limit is {self._maximum_image_pixels}",
            )

    def _write_pdf(self, image: Image.Image) -> bytes:
        with PDFIUM_LOCK:
            pdf = pdfium.PdfDocument.new()
            try:
                for frame in ImageSequence.Iterator(image):
                    self._reject_oversized(frame)
                    _append_frame_as_page(pdf, frame)
                output = io.BytesIO()
                pdf.save(output)
                return output.getvalue()
            except OSError as error:
                raise PermanentJobError(
                    FailureCode.CORRUPT_DOCUMENT, f"an image frame cannot be decoded: {error}"
                ) from error
            finally:
                pdf.close()


def _append_frame_as_page(pdf: pdfium.PdfDocument, frame: Image.Image) -> None:
    """Caller must hold ``PDFIUM_LOCK``."""
    dots_per_inch = infer_image_resolution_dpi(frame.width, frame.height, _declared_dpi(frame))
    width_points = frame.width * POINTS_PER_INCH / dots_per_inch
    height_points = frame.height * POINTS_PER_INCH / dots_per_inch
    page = pdf.new_page(width_points, height_points)
    try:
        image_object = pdfium.PdfImage.new(pdf)
        image_object.load_jpeg(io.BytesIO(_encode_jpeg(frame)), inline=True)
        image_object.set_matrix(pdfium.PdfMatrix().scale(width_points, height_points))
        page.insert_obj(image_object)
        page.gen_content()
    finally:
        page.close()


def _encode_jpeg(frame: Image.Image) -> bytes:
    jpeg_ready_frame = frame if frame.mode in JPEG_COMPATIBLE_MODES else frame.convert("RGB")
    buffer = io.BytesIO()
    jpeg_ready_frame.save(buffer, format="JPEG", quality=JPEG_QUALITY)
    return buffer.getvalue()


def _declared_dpi(frame: Image.Image) -> float | None:
    resolution = frame.info.get("dpi")
    if not isinstance(resolution, tuple) or not resolution:
        return None
    try:
        return float(resolution[0])
    except (TypeError, ValueError):
        return None
