"""Which extraction method parses a page, and what happens when the vision model cannot.

Policy:

1. ``document_parse`` requested, budget left and the gateway usable -> vision model (``vlm``).
2. ``document_parse`` requested but the budget is spent, the gateway rejected the request
   (non-retryable 4xx or an unusable response) or the page deadline passed -> fallback:
   scanned and hybrid pages use Tesseract, digital pages use the native text layer.
3. Nothing requested -> native text layer, except scanned pages (no text layer), which use
   Tesseract.
4. Region tasks (``table_extraction``, ``equation_ocr``, ``chart_description``) are not
   called by this service; such pages are parsed as in rule 3.

A gateway that stays unavailable (connection errors, 5xx, 429) after retries within the page
deadline is *not* a fallback case: the job fails and BullMQ retries it later, so an outage
never silently lowers parse quality.
"""

import time
from collections.abc import Callable, Collection
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Literal

from app.domain.page_classification import PageKind

PageParseMethod = Literal["native", "vlm", "ocr_tesseract"]
DOCUMENT_PARSE_TASK = "document_parse"
PAGES_WITHOUT_TEXT_LAYER: frozenset[PageKind] = frozenset({"scanned"})
PAGES_NEEDING_OCR_FALLBACK: frozenset[PageKind] = frozenset({"scanned", "hybrid"})


class FallbackReason(StrEnum):
    BUDGET_EXHAUSTED = "budget_exhausted"
    GATEWAY_REJECTED = "gateway_rejected"
    GATEWAY_DISABLED = "gateway_disabled"
    PAGE_TIMEOUT = "page_timeout"


def wants_vision_model(requested_tasks: Collection[str]) -> bool:
    return DOCUMENT_PARSE_TASK in requested_tasks


def method_without_vision_model(page_kind: PageKind) -> PageParseMethod:
    return "ocr_tesseract" if page_kind in PAGES_WITHOUT_TEXT_LAYER else "native"


def fallback_method(page_kind: PageKind) -> PageParseMethod:
    return "ocr_tesseract" if page_kind in PAGES_NEEDING_OCR_FALLBACK else "native"


@dataclass(slots=True)
class VisionCallBudget:
    """``maxVisionModelCalls`` of one batch; a page counts once however often it is retried."""

    maximum_calls: int
    used_calls: int = 0

    @property
    def is_exhausted(self) -> bool:
        return self.used_calls >= self.maximum_calls

    def spend_one_call(self) -> None:
        if self.is_exhausted:
            raise RuntimeError("vision call budget is already exhausted")
        self.used_calls += 1


@dataclass(frozen=True, slots=True)
class Deadline:
    """A point in monotonic time after which page work must stop."""

    expires_at: float
    clock: Callable[[], float] = field(default=time.monotonic, compare=False)

    @classmethod
    def after_seconds(cls, seconds: float, clock: Callable[[], float] = time.monotonic) -> "Deadline":
        return cls(expires_at=clock() + seconds, clock=clock)

    def remaining_seconds(self) -> float:
        return max(0.0, self.expires_at - self.clock())

    def has_expired(self) -> bool:
        return self.remaining_seconds() <= 0
