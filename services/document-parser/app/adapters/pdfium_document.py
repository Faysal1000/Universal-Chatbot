"""PDF inspection and rendering with pypdfium2.

PDFium is not thread-safe, and jobs run in worker threads, so every PDFium call (including
closing handles) happens under one process-wide lock. Pages are loaded, used and closed one
at a time to keep memory flat on large documents.
"""

import ctypes
import io
import math
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from types import TracebackType
from typing import Any, Self

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_raw
from PIL import Image

from app.domain.errors import FailureCode, PermanentJobError
from app.domain.geometry import NormalisedBox, PageSize, Rectangle
from app.domain.page_layout import LineSegment, PageLayoutSnapshot, TextSegment, VectorGraphics

PDFIUM_LOCK = threading.RLock()
POINTS_PER_INCH = 72
MAXIMUM_TEXT_SEGMENTS_PER_PAGE = 5_000
MAXIMUM_PATH_SEGMENTS_PER_PAGE = 20_000
MAXIMUM_FONT_NAMES_PER_PAGE = 64
BEZIER_POINTS_PER_CURVE = 3
CROP_PADDING_PIXELS = 4
PNG_COMPRESSION_LEVEL = 6
DEFAULT_MAXIMUM_RENDER_PIXELS = 40_000_000
RENDER_ROUNDING_MARGIN = 0.99  # PDFium rounds bitmap sides up


def bounded_render_scale(page_size_points: PageSize, dots_per_inch: int, maximum_pixels: int) -> float:
    """Scale factor for ``dots_per_inch``, reduced so the bitmap never exceeds ``maximum_pixels``."""
    requested_scale = dots_per_inch / POINTS_PER_INCH
    requested_pixels = page_size_points.area * requested_scale**2
    if requested_pixels <= maximum_pixels:
        return requested_scale
    return math.sqrt(maximum_pixels / page_size_points.area) * RENDER_ROUNDING_MARGIN


class PillowRenderedPage:
    """A rendered page held as a Pillow RGB image."""

    def __init__(self, image: Image.Image) -> None:
        self._image: Image.Image | None = image
        self._size = PageSize(width=image.width, height=image.height)
        self._png_bytes: bytes | None = None

    @property
    def size(self) -> PageSize:
        return self._size

    @property
    def image(self) -> Image.Image:
        if self._image is None:
            raise RuntimeError("the rendered page has been closed")
        return self._image

    def to_png(self) -> bytes:
        if self._png_bytes is None:
            self._png_bytes = encode_png(self.image)
        return self._png_bytes

    def crop_to_png(self, box: NormalisedBox) -> bytes:
        with self.image.crop(_padded_pixel_box(box, self._size)) as cropped_image:
            return encode_png(cropped_image)

    def close(self) -> None:
        if self._image is not None:
            self._image.close()
        self._image = None
        self._png_bytes = None


class PdfiumDocument:
    def __init__(self, pdf: pdfium.PdfDocument, maximum_render_pixels: int) -> None:
        self._pdf = pdf
        self._maximum_render_pixels = maximum_render_pixels

    @property
    def page_count(self) -> int:
        with PDFIUM_LOCK:
            return len(self._pdf)

    def inspect_page(self, page_number: int) -> PageLayoutSnapshot:
        with PDFIUM_LOCK, _loaded_page(self._pdf, page_number) as page:
            text_page = page.get_textpage()
            try:
                return _collect_layout_snapshot(page, text_page, page_number)
            finally:
                text_page.close()

    def render_page(self, page_number: int, dots_per_inch: int) -> PillowRenderedPage:
        with PDFIUM_LOCK, _loaded_page(self._pdf, page_number) as page:
            page_size = PageSize(*page.get_size())
            scale = bounded_render_scale(page_size, dots_per_inch, self._maximum_render_pixels)
            bitmap = page.render(scale=scale, may_draw_forms=True)
            try:
                image = bitmap.to_pil().convert("RGB")
            finally:
                bitmap.close()
        return PillowRenderedPage(image)

    def close(self) -> None:
        with PDFIUM_LOCK:
            self._pdf.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exception_type: type[BaseException] | None,
        exception: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()


class PdfiumOpener:
    def __init__(self, maximum_render_pixels: int = DEFAULT_MAXIMUM_RENDER_PIXELS) -> None:
        self._maximum_render_pixels = maximum_render_pixels

    def open_document(self, pdf_bytes: bytes) -> PdfiumDocument:
        with PDFIUM_LOCK:
            try:
                pdf = pdfium.PdfDocument(pdf_bytes)
            except pdfium.PdfiumError as error:
                raise translate_open_error(error) from error
        return PdfiumDocument(pdf, self._maximum_render_pixels)


def translate_open_error(error: pdfium.PdfiumError) -> PermanentJobError:
    if error.err_code == pdfium_raw.FPDF_ERR_PASSWORD:
        return PermanentJobError(FailureCode.ENCRYPTED_DOCUMENT, "the PDF is password-protected")
    return PermanentJobError(FailureCode.CORRUPT_DOCUMENT, f"the PDF cannot be opened: {error}")


def encode_png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", compress_level=PNG_COMPRESSION_LEVEL)
    return buffer.getvalue()


# ----------------------------------------------------------------------------- page loading


@contextmanager
def _loaded_page(pdf: pdfium.PdfDocument, page_number: int) -> Iterator[Any]:
    """Load a page and always close it; the caller must hold ``PDFIUM_LOCK``."""
    if not 1 <= page_number <= len(pdf):
        raise PermanentJobError(FailureCode.PAGE_OUT_OF_RANGE, f"page {page_number} does not exist")
    page = pdf[page_number - 1]
    try:
        yield page
    finally:
        page.close()


# ----------------------------------------------------------------------------- snapshot collection


class _PageFrame:
    """Converts PDF user space (bottom-left origin) into top-left-origin page coordinates."""

    def __init__(self, page: Any) -> None:
        left, bottom, right, top = page.get_bbox()
        self.left = float(left)
        self.top = float(top)
        self.size = PageSize(width=float(right - left), height=float(top - bottom))

    def rectangle(self, left: float, bottom: float, right: float, top: float) -> Rectangle:
        return Rectangle(
            left=left - self.left, top=self.top - top, right=right - self.left, bottom=self.top - bottom
        )

    def point(self, x: float, y: float) -> tuple[float, float]:
        return x - self.left, self.top - y


def _collect_layout_snapshot(page: Any, text_page: Any, page_number: int) -> PageLayoutSnapshot:
    frame = _PageFrame(page)
    if frame.size.width <= 0 or frame.size.height <= 0:
        raise PermanentJobError(FailureCode.CORRUPT_DOCUMENT, f"page {page_number} has no area")
    collector = _PageObjectCollector(frame)
    for page_object in page.get_objects():
        collector.add(page_object)
    return PageLayoutSnapshot(
        page_size=frame.size,
        text=text_page.get_text_range(),
        text_segments=tuple(_text_segments(text_page, frame)),
        font_names=frozenset(collector.font_names),
        text_object_count=collector.text_object_count,
        invisible_text_object_count=collector.invisible_text_object_count,
        image_rectangles=tuple(collector.image_rectangles),
        vector_graphics=VectorGraphics(
            path_bounds=tuple(collector.path_bounds),
            straight_segments=tuple(collector.straight_segments),
            curve_segment_count=collector.curve_segment_count,
        ),
    )


def _text_segments(text_page: Any, frame: _PageFrame) -> Iterator[TextSegment]:
    rectangle_count = min(text_page.count_rects(), MAXIMUM_TEXT_SEGMENTS_PER_PAGE)
    for rectangle_index in range(rectangle_count):
        left, bottom, right, top = text_page.get_rect(rectangle_index)
        yield TextSegment(
            rectangle=frame.rectangle(left, bottom, right, top),
            text=text_page.get_text_bounded(left, bottom, right, top),
        )


class _PageObjectCollector:
    def __init__(self, frame: _PageFrame) -> None:
        self._frame = frame
        self.font_names: set[str] = set()
        self.text_object_count = 0
        self.invisible_text_object_count = 0
        self.image_rectangles: list[Rectangle] = []
        self.path_bounds: list[Rectangle] = []
        self.straight_segments: list[LineSegment] = []
        self.curve_segment_count = 0

    def add(self, page_object: Any) -> None:
        if page_object.type == pdfium_raw.FPDF_PAGEOBJ_TEXT:
            self._add_text_object(page_object)
        elif page_object.type == pdfium_raw.FPDF_PAGEOBJ_IMAGE:
            self.image_rectangles.append(self._bounds(page_object))
        elif page_object.type == pdfium_raw.FPDF_PAGEOBJ_PATH:
            self.path_bounds.append(self._bounds(page_object))
            self._add_path_segments(page_object)

    def _bounds(self, page_object: Any) -> Rectangle:
        left, bottom, right, top = page_object.get_bounds()
        return self._frame.rectangle(left, bottom, right, top)

    def _add_text_object(self, text_object: Any) -> None:
        self.text_object_count += 1
        if pdfium_raw.FPDFTextObj_GetTextRenderMode(text_object) == pdfium_raw.FPDF_TEXTRENDERMODE_INVISIBLE:
            self.invisible_text_object_count += 1
        if len(self.font_names) < MAXIMUM_FONT_NAMES_PER_PAGE:
            font_name = _font_base_name(text_object)
            if font_name:
                self.font_names.add(font_name)

    def _add_path_segments(self, path_object: Any) -> None:
        segment_count = pdfium_raw.FPDFPath_CountSegments(path_object)
        if segment_count <= 0 or len(self.straight_segments) >= MAXIMUM_PATH_SEGMENTS_PER_PAGE:
            return
        matrix = path_object.get_matrix()
        tracer = _PathTracer()
        for segment_index in range(segment_count):
            segment = pdfium_raw.FPDFPath_GetPathSegment(path_object, segment_index)
            x, y = self._frame.point(*matrix.on_point(*_segment_point(segment)))
            tracer.follow(
                pdfium_raw.FPDFPathSegment_GetType(segment),
                x,
                y,
                bool(pdfium_raw.FPDFPathSegment_GetClose(segment)),
            )
        self.straight_segments.extend(tracer.straight_segments)
        self.curve_segment_count += tracer.bezier_point_count // BEZIER_POINTS_PER_CURVE


class _PathTracer:
    """Turns a path's segment list into straight line segments and a count of curve points."""

    def __init__(self) -> None:
        self.straight_segments: list[LineSegment] = []
        self.bezier_point_count = 0
        self._current_point: tuple[float, float] | None = None
        self._subpath_start: tuple[float, float] | None = None

    def follow(self, segment_type: int, x: float, y: float, closes_subpath: bool) -> None:
        if segment_type == pdfium_raw.FPDF_SEGMENT_MOVETO:
            self._subpath_start = (x, y)
        elif segment_type == pdfium_raw.FPDF_SEGMENT_LINETO:
            self._add_line_to(x, y)
        elif segment_type == pdfium_raw.FPDF_SEGMENT_BEZIERTO:
            self.bezier_point_count += 1
        self._current_point = (x, y)
        if closes_subpath and self._subpath_start is not None:
            self._add_line_to(*self._subpath_start)
            self._current_point = self._subpath_start

    def _add_line_to(self, x: float, y: float) -> None:
        if self._current_point is None:
            return
        start_x, start_y = self._current_point
        self.straight_segments.append(LineSegment(start_x=start_x, start_y=start_y, end_x=x, end_y=y))


def _segment_point(segment: Any) -> tuple[float, float]:
    x = ctypes.c_float()
    y = ctypes.c_float()
    pdfium_raw.FPDFPathSegment_GetPoint(segment, x, y)
    return x.value, y.value


def _font_base_name(text_object: Any) -> str:
    try:
        return str(text_object.get_font().get_base_name())
    except pdfium.PdfiumError:
        return ""


def _padded_pixel_box(box: NormalisedBox, size: PageSize) -> tuple[int, int, int, int]:
    left = max(0, math.floor(box.x0 * size.width) - CROP_PADDING_PIXELS)
    top = max(0, math.floor(box.y0 * size.height) - CROP_PADDING_PIXELS)
    right = min(int(size.width), math.ceil(box.x1 * size.width) + CROP_PADDING_PIXELS)
    bottom = min(int(size.height), math.ceil(box.y1 * size.height) + CROP_PADDING_PIXELS)
    return left, top, max(right, left + 1), max(bottom, top + 1)
