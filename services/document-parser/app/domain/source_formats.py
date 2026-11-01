"""Which uploads the parser accepts, and how image uploads become a PDF page size."""

from typing import Literal

from app.domain.errors import FailureCode, PermanentJobError

SourceFormat = Literal["pdf", "image"]

PDF_MIME_TYPE = "application/pdf"
IMAGE_MIME_TYPES = frozenset({"image/png", "image/jpeg", "image/tiff"})
OFFICE_MIME_TYPES = frozenset(
    {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }
)

ASSUMED_PAGE_HEIGHT_INCHES = 11.69  # A4, used when an image declares no usable resolution
MINIMUM_RESOLUTION_DPI = 72.0
MAXIMUM_RESOLUTION_DPI = 1200.0


def resolve_source_format(mime_type: str) -> SourceFormat:
    if mime_type == PDF_MIME_TYPE:
        return "pdf"
    if mime_type in IMAGE_MIME_TYPES:
        return "image"
    if mime_type in OFFICE_MIME_TYPES:
        raise PermanentJobError(
            FailureCode.UNSUPPORTED_FORMAT,
            f"{mime_type} is not supported yet; convert the document to PDF before uploading",
        )
    raise PermanentJobError(FailureCode.UNSUPPORTED_FORMAT, f"{mime_type} is not a supported upload type")


def infer_image_resolution_dpi(width_pixels: int, height_pixels: int, declared_dpi: float | None) -> float:
    """The image's own DPI when plausible, else the DPI that makes its long side one A4 height."""
    if declared_dpi is not None and MINIMUM_RESOLUTION_DPI <= declared_dpi <= MAXIMUM_RESOLUTION_DPI:
        return declared_dpi
    inferred_dpi = max(width_pixels, height_pixels) / ASSUMED_PAGE_HEIGHT_INCHES
    return min(MAXIMUM_RESOLUTION_DPI, max(MINIMUM_RESOLUTION_DPI, inferred_dpi))
