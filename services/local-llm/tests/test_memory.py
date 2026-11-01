"""Memory estimates and device admission."""

import pytest

from app.deployments.memory import MemoryLedger, estimate_required_bytes, resolve_dtype
from app.errors import GpuUnavailableError, InsufficientMemoryError
from tests.conftest import GIBIBYTE, resolved_model

BOTH_DEVICES = frozenset({"cpu", "cuda"})


def both(required_bytes: int) -> dict[str, int]:
    """The same requirement on every device."""
    return {"cpu": required_bytes, "cuda": required_bytes}


CPU_ONLY = frozenset({"cpu"})


def test_bfloat16_halves_the_estimate_of_float32_weights() -> None:
    model = resolved_model("nvidia/Nemotron-3.5-Parse", parameter_count=630_800_504)

    bfloat16_bytes = estimate_required_bytes(model, "bfloat16", 16_384)
    float32_bytes = estimate_required_bytes(model, "float32", 16_384)

    assert 1.5 * GIBIBYTE < bfloat16_bytes < 2.5 * GIBIBYTE
    assert float32_bytes - bfloat16_bytes == pytest.approx(630_800_504 * 2 * 1.2, rel=0.01)


def test_auto_dtype_is_float32_on_cpu_and_bfloat16_on_gpu() -> None:
    assert resolve_dtype("auto", "cpu") == "float32"
    assert resolve_dtype("auto", "cuda") == "bfloat16"
    assert resolve_dtype("bfloat16", "cpu") == "bfloat16"


def test_auto_prefers_the_gpu_when_it_fits() -> None:
    ledger = MemoryLedger({"cpu": 8 * GIBIBYTE, "cuda": 4 * GIBIBYTE})

    reservation = ledger.reserve("qwen", "auto", both(2 * GIBIBYTE), BOTH_DEVICES)

    assert reservation.device == "cuda"


def test_auto_falls_back_to_cpu_when_the_gpu_is_full() -> None:
    ledger = MemoryLedger({"cpu": 8 * GIBIBYTE, "cuda": 4 * GIBIBYTE})
    ledger.reserve("parser", "gpu", both(3 * GIBIBYTE), BOTH_DEVICES)

    reservation = ledger.reserve("qwen", "auto", both(2 * GIBIBYTE), BOTH_DEVICES)

    assert reservation.device == "cpu"


def test_a_model_that_fits_nowhere_is_refused_with_the_numbers() -> None:
    ledger = MemoryLedger({"cpu": 4 * GIBIBYTE})
    ledger.reserve("parser", "cpu", both(3 * GIBIBYTE), CPU_ONLY)

    with pytest.raises(InsufficientMemoryError) as raised:
        ledger.reserve("qwen", "auto", both(2 * GIBIBYTE), CPU_ONLY)

    assert raised.value.details == {"required_bytes": {"cpu": 2 * GIBIBYTE}, "free_bytes": {"cpu": 1 * GIBIBYTE}}


def test_requesting_a_gpu_without_one_is_an_error() -> None:
    ledger = MemoryLedger({"cpu": 8 * GIBIBYTE})

    with pytest.raises(GpuUnavailableError):
        ledger.reserve("qwen", "gpu", both(GIBIBYTE), CPU_ONLY)


def test_re_reserving_does_not_count_the_owner_against_itself() -> None:
    ledger = MemoryLedger({"cpu": 4 * GIBIBYTE})
    ledger.reserve("parser", "cpu", both(3 * GIBIBYTE), CPU_ONLY)

    reservation = ledger.reserve("parser", "cpu", both(4 * GIBIBYTE), CPU_ONLY)

    assert reservation.reserved_bytes == 4 * GIBIBYTE


def test_a_failed_re_reservation_keeps_the_existing_one() -> None:
    ledger = MemoryLedger({"cpu": 4 * GIBIBYTE})
    ledger.reserve("parser", "cpu", both(3 * GIBIBYTE), CPU_ONLY)

    with pytest.raises(InsufficientMemoryError):
        ledger.reserve("parser", "cpu", both(5 * GIBIBYTE), CPU_ONLY)

    reservation = ledger.reservation_of("parser")
    assert reservation is not None
    assert reservation.reserved_bytes == 3 * GIBIBYTE


def test_rename_moves_a_swap_candidate_to_the_live_name() -> None:
    ledger = MemoryLedger({"cpu": 4 * GIBIBYTE})
    ledger.reserve("parser#next", "cpu", both(GIBIBYTE), CPU_ONLY)

    ledger.rename("parser#next", "parser")

    assert ledger.reservation_of("parser#next") is None
    assert ledger.free_bytes("cpu") == 3 * GIBIBYTE
