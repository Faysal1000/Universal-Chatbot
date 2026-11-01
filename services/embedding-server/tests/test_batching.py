import asyncio

import pytest

from app.batching import DynamicBatcher
from app.config import Settings
from app.errors import InferenceFailedError, ServiceAtCapacityError, ServiceUnavailableError
from app.model import EncoderInput
from tests.conftest import FakeEmbeddingBackend


def text_inputs(count: int, prefix: str = "item") -> list[EncoderInput]:
    return [EncoderInput(text=f"{prefix} {index}") for index in range(count)]


async def test_concurrent_requests_are_coalesced_into_one_batch(
    fake_backend: FakeEmbeddingBackend, app_settings: Settings
) -> None:
    batcher = DynamicBatcher(
        fake_backend, app_settings.model_copy(update={"batch_collection_window_milliseconds": 50})
    )
    batcher.start()

    async def embed_one(index: int) -> None:
        with batcher.reserve(1) as reservation:
            await reservation.embed([EncoderInput(text=f"text {index}")])

    await asyncio.gather(*(embed_one(index) for index in range(5)))
    await batcher.stop(drain_timeout_seconds=1)

    assert [len(batch) for batch in fake_backend.received_batches] == [5]
    assert batcher.pending_item_count == 0


async def test_results_preserve_request_order(
    fake_backend: FakeEmbeddingBackend, app_settings: Settings
) -> None:
    batcher = DynamicBatcher(fake_backend, app_settings)
    batcher.start()
    inputs = [EncoderInput(text="a" * length) for length in (3, 1, 2)]
    with batcher.reserve(3) as reservation:
        vectors = await reservation.embed(inputs)
    await batcher.stop(drain_timeout_seconds=1)
    assert [vector[1] for vector in vectors] == [3.0, 1.0, 2.0]


async def test_modalities_are_never_mixed_in_a_batch(
    fake_backend: FakeEmbeddingBackend, app_settings: Settings
) -> None:
    from app.images import normalise_base64_image
    from tests.conftest import encode_test_image

    image = normalise_base64_image(encode_test_image(), app_settings)
    batcher = DynamicBatcher(
        fake_backend, app_settings.model_copy(update={"batch_collection_window_milliseconds": 30})
    )
    batcher.start()
    with batcher.reserve(3) as reservation:
        await reservation.embed([EncoderInput(text="t"), EncoderInput(image=image), EncoderInput(text="u")])
    await batcher.stop(drain_timeout_seconds=1)

    for batch in fake_backend.received_batches:
        assert len({encoder_input.modality for encoder_input in batch}) == 1
    assert sorted(len(batch) for batch in fake_backend.received_batches) == [1, 2]


async def test_admission_is_bounded(fake_backend: FakeEmbeddingBackend, app_settings: Settings) -> None:
    batcher = DynamicBatcher(fake_backend, app_settings.model_copy(update={"max_pending_items": 4}))
    batcher.start()
    held_reservation = batcher.reserve(3)
    with pytest.raises(ServiceAtCapacityError):
        batcher.reserve(2)
    with held_reservation:
        pass  # Exiting without submitting returns the slots.
    assert batcher.pending_item_count == 0
    batcher.reserve(4).__exit__(None, None, None)
    await batcher.stop(drain_timeout_seconds=1)


async def test_reserve_fails_when_worker_not_running(
    fake_backend: FakeEmbeddingBackend, app_settings: Settings
) -> None:
    batcher = DynamicBatcher(fake_backend, app_settings)
    with pytest.raises(ServiceUnavailableError):
        batcher.reserve(1)


async def test_inference_failure_is_reported_and_slots_released(
    fake_backend: FakeEmbeddingBackend, app_settings: Settings
) -> None:
    batcher = DynamicBatcher(fake_backend, app_settings)
    batcher.start()
    fake_backend.fail_next_batch = True
    with pytest.raises(InferenceFailedError), batcher.reserve(2) as reservation:
        await reservation.embed(text_inputs(2))
    assert batcher.pending_item_count == 0
    assert batcher.is_healthy  # One failed batch must not kill the worker.
    await batcher.stop(drain_timeout_seconds=1)


async def test_cancelled_jobs_are_skipped_and_released(
    fake_backend: FakeEmbeddingBackend, app_settings: Settings
) -> None:
    batcher = DynamicBatcher(fake_backend, app_settings)
    batcher.start()
    fake_backend.release_inference.clear()  # Block the first batch inside the model.

    async def embed(prefix: str) -> None:
        with batcher.reserve(1) as reservation:
            await reservation.embed([EncoderInput(text=prefix)])

    blocking_request = asyncio.create_task(embed("first"))
    await asyncio.sleep(0.05)
    abandoned_request = asyncio.create_task(embed("abandoned"))
    await asyncio.sleep(0.01)
    abandoned_request.cancel()
    fake_backend.release_inference.set()
    await blocking_request
    await asyncio.gather(abandoned_request, return_exceptions=True)
    await batcher.stop(drain_timeout_seconds=1)

    embedded_texts = [item.text for batch in fake_backend.received_batches for item in batch]
    assert embedded_texts == ["first"]
    assert batcher.pending_item_count == 0


async def test_stop_drains_queued_work(fake_backend: FakeEmbeddingBackend, app_settings: Settings) -> None:
    batcher = DynamicBatcher(fake_backend, app_settings.model_copy(update={"inference_batch_size": 1}))
    batcher.start()
    with batcher.reserve(3) as reservation:
        pending_embedding = asyncio.create_task(reservation.embed(text_inputs(3)))
        await asyncio.sleep(0)
        await batcher.stop(drain_timeout_seconds=5)
        assert len(await pending_embedding) == 3
    assert not batcher.is_healthy
    assert not batcher.has_crashed
