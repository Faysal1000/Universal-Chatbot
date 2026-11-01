import pytest

from app.domain.parse_strategy import (
    Deadline,
    VisionCallBudget,
    fallback_method,
    method_without_vision_model,
    wants_vision_model,
)
from tests.support.doubles import FakeClock


def test_only_document_parse_requests_the_vision_model() -> None:
    assert wants_vision_model(["document_parse"])
    assert not wants_vision_model(["table_extraction"])
    assert not wants_vision_model([])


@pytest.mark.parametrize(
    ("page_kind", "method"), [("digital", "native"), ("hybrid", "native"), ("scanned", "ocr_tesseract")]
)
def test_method_without_vision_model(page_kind: str, method: str) -> None:
    assert method_without_vision_model(page_kind) == method  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("page_kind", "method"),
    [("digital", "native"), ("hybrid", "ocr_tesseract"), ("scanned", "ocr_tesseract")],
)
def test_fallback_method(page_kind: str, method: str) -> None:
    assert fallback_method(page_kind) == method  # type: ignore[arg-type]


def test_budget_is_spent_one_call_at_a_time() -> None:
    budget = VisionCallBudget(maximum_calls=1)

    budget.spend_one_call()

    assert budget.is_exhausted
    with pytest.raises(RuntimeError):
        budget.spend_one_call()


def test_zero_budget_is_exhausted_from_the_start() -> None:
    assert VisionCallBudget(maximum_calls=0).is_exhausted


def test_deadline_counts_down_with_the_clock() -> None:
    clock = FakeClock()
    deadline = Deadline.after_seconds(10, clock=clock)

    clock.advance(4)
    assert deadline.remaining_seconds() == 6
    clock.advance(7)
    assert deadline.has_expired()
    assert deadline.remaining_seconds() == 0
