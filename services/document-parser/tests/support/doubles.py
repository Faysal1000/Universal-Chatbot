"""In-memory test doubles for the application ports."""

from dataclasses import dataclass, field

from app.application.ports import OcrTimeoutError, RenderedPage, StoredObject
from app.domain.errors import FailureCode, PermanentJobError
from app.domain.geometry import Rectangle
from app.domain.ocr_layout import OcrWord
from app.domain.parse_strategy import Deadline


@dataclass
class StoredBody:
    body: bytes
    content_type: str


class InMemoryObjectStorage:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], StoredBody] = {}

    def put(self, bucket: str, key: str, body: bytes, content_type: str = "application/octet-stream") -> None:
        self.objects[(bucket, key)] = StoredBody(body, content_type)

    def body_of(self, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)].body

    def read_object(self, location: StoredObject, maximum_bytes: int) -> bytes:
        stored = self.objects.get((location.bucket, location.key))
        if stored is None:
            raise PermanentJobError(FailureCode.SOURCE_NOT_FOUND, f"object {location.key} does not exist")
        if len(stored.body) > maximum_bytes:
            raise PermanentJobError(FailureCode.SOURCE_TOO_LARGE, "too large")
        return stored.body

    def read_object_if_exists(self, location: StoredObject) -> bytes | None:
        stored = self.objects.get((location.bucket, location.key))
        return stored.body if stored is not None else None

    def write_object(self, location: StoredObject, body: bytes, content_type: str) -> None:
        self.put(location.bucket, location.key, body, content_type)


class ScriptedGateway:
    """Returns (or raises) the scripted outcomes in order and records every request."""

    def __init__(self, *outcomes: str | Exception) -> None:
        self._outcomes = list(outcomes)
        self.received_images: list[bytes] = []

    def parse_page_image(self, png_bytes: bytes, deadline: Deadline) -> str:
        self.received_images.append(png_bytes)
        outcome = self._outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class FakeOcrEngine:
    """Recognises a fixed list of words (one paragraph, one line per word group)."""

    def __init__(
        self, lines: list[str] | None = None, confidence: float = 90.0, times_out: bool = False
    ) -> None:
        self._lines = lines or []
        self._confidence = confidence
        self._times_out = times_out
        self.calls: list[tuple[int, int]] = []

    def recognise_words(self, page: RenderedPage, timeout_seconds: float) -> list[OcrWord]:
        self.calls.append((int(page.size.width), int(page.size.height)))
        if self._times_out:
            raise OcrTimeoutError("Tesseract process timeout")
        return [
            OcrWord(
                text=word,
                confidence=self._confidence,
                rectangle=Rectangle(
                    100 + word_index * 120,
                    100 + line_index * 60,
                    200 + word_index * 120,
                    140 + line_index * 60,
                ),
                block_number=1,
                paragraph_number=1,
                line_number=line_index + 1,
            )
            for line_index, line in enumerate(self._lines)
            for word_index, word in enumerate(line.split())
        ]


@dataclass
class RecordingProgressReporter:
    reports: list[tuple[int, int]] = field(default_factory=list)

    def report_progress(self, pages_done: int, pages_total: int) -> None:
        self.reports.append((pages_done, pages_total))


class FakeClock:
    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds
