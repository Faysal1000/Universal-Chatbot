"""Interfaces the use cases depend on; adapters implement them, tests replace them."""

from dataclasses import dataclass
from types import TracebackType
from typing import Protocol, Self

from app.domain.geometry import NormalisedBox, PageSize
from app.domain.ocr_layout import OcrWord
from app.domain.page_layout import PageLayoutSnapshot
from app.domain.parse_strategy import Deadline
from app.domain.text_layer_blocks import TextBox
from app.domain.vision_blocks import NemotronBlock


@dataclass(frozen=True, slots=True)
class StoredObject:
    bucket: str
    key: str


class ObjectStorage(Protocol):
    def read_object(self, location: StoredObject, maximum_bytes: int) -> bytes:
        """Raise ``PermanentJobError`` (missing, too large) or ``RetryableJobError``."""
        ...

    def read_object_if_exists(self, location: StoredObject) -> bytes | None: ...

    def write_object(self, location: StoredObject, body: bytes, content_type: str) -> None: ...


class RenderedPage(Protocol):
    """A page rendered to pixels; ``size`` is in pixels."""

    @property
    def size(self) -> PageSize: ...

    def to_png(self) -> bytes: ...

    def crop_to_png(self, box: NormalisedBox) -> bytes: ...

    def close(self) -> None: ...


class PdfDocument(Protocol):
    @property
    def page_count(self) -> int: ...

    def inspect_page(self, page_number: int) -> PageLayoutSnapshot: ...

    def render_page(self, page_number: int, dots_per_inch: int) -> RenderedPage: ...

    def __enter__(self) -> Self: ...

    def __exit__(
        self,
        exception_type: type[BaseException] | None,
        exception: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...


class PdfOpener(Protocol):
    def open_document(self, pdf_bytes: bytes) -> PdfDocument:
        """Raise ``PermanentJobError`` for encrypted or corrupt documents."""
        ...


class ImageToPdfConverter(Protocol):
    def convert_to_pdf(self, image_bytes: bytes, maximum_pages: int) -> bytes: ...


class NativeTextExtractor(Protocol):
    def extract_text_boxes(self, pdf_bytes: bytes, page_number: int) -> tuple[list[TextBox], PageSize]: ...


class OcrTimeoutError(Exception):
    """Tesseract did not finish within the time it was given."""


class OcrEngine(Protocol):
    def recognise_words(self, page: RenderedPage, timeout_seconds: float) -> list[OcrWord]: ...


class GatewayRejectedError(Exception):
    """A non-retryable answer (4xx or an unusable body): retrying the same page cannot help."""

    def __init__(self, message: str, *, disables_gateway: bool) -> None:
        super().__init__(message)
        self.disables_gateway = disables_gateway


class GatewayDeadlineExceededError(Exception):
    """The page deadline passed before the gateway produced an answer."""


class GatewayUnavailableError(Exception):
    """Transient failures persisted through every retry the deadline allowed."""


class DocumentParseGateway(Protocol):
    def parse_page_image(self, png_bytes: bytes, deadline: Deadline) -> str:
        """Nemotron's raw markup for one page image."""
        ...


class NemotronPostprocessor(Protocol):
    def postprocess(self, markup: str, image_size: PageSize) -> list[NemotronBlock]: ...


class ProgressReporter(Protocol):
    def report_progress(self, pages_done: int, pages_total: int) -> None: ...
