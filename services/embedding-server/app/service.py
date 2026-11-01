"""Request orchestration: admission, input preparation, batching, and deadlines."""

import asyncio
import logging
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor

from app.batching import DynamicBatcher
from app.config import Settings
from app.errors import EmbeddingTimeoutError, InvalidInputError
from app.images import NormalisedImage, normalise_base64_image
from app.model import EmbeddingBackend, EncoderInput
from app.schemas import EmbeddingInput, EmbeddingTask, ImageInput, TextImageInput, TextInput

logger = logging.getLogger(__name__)

# EmbeddingGemma 2 places the image at this marker inside the token sequence.
IMAGE_PLACEHOLDER_MARKER = "<|image|>"


def format_text_for_task(text: str, task: EmbeddingTask, title: str | None) -> str:
    """Apply the EmbeddingGemma prompt template for the requested retrieval task."""
    if task == "query":
        return f"task: search result | query: {text}"
    if task == "document":
        return f"title: {title or 'none'} | text: {text}"
    return text


class EmbeddingService:
    """Turns validated API items into embeddings under bounded concurrency and time.

    Image decoding and token counting run on dedicated, bounded thread pools so they
    cannot exhaust the default executor or compete with the inference thread.
    """

    def __init__(
        self,
        embedding_backend: EmbeddingBackend,
        batcher: DynamicBatcher,
        settings: Settings,
    ) -> None:
        self._embedding_backend = embedding_backend
        self._batcher = batcher
        self._settings = settings
        self._image_decode_executor = ThreadPoolExecutor(
            max_workers=settings.image_decode_concurrency,
            thread_name_prefix="embedding-image-decode",
        )
        # Token counting is serialised by the tokenizer lock, so one thread suffices.
        self._tokenization_executor = ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="embedding-tokenize"
        )

    def close(self) -> None:
        """Release thread pools; queued-but-unstarted preparation work is cancelled."""
        self._image_decode_executor.shutdown(wait=False, cancel_futures=True)
        self._tokenization_executor.shutdown(wait=False, cancel_futures=True)

    async def embed_items(self, items: Sequence[EmbeddingInput]) -> list[list[float]]:
        """Embed ``items`` in order, enforcing admission limits and the request deadline.

        Raises:
            ServiceAtCapacityError: The pending-work budget is exhausted.
            ServiceUnavailableError: The worker is not running.
            InvalidInputError: An item failed validation (``item_index`` is set).
            EmbeddingTimeoutError: The request exceeded ``request_timeout_seconds``.
            InferenceFailedError: The model failed for this request's batch.
        """
        try:
            async with asyncio.timeout(self._settings.request_timeout_seconds):
                with self._batcher.reserve(len(items)) as reservation:
                    encoder_inputs = await self._prepare_all_items(items)
                    embedding_vectors = await reservation.embed(encoder_inputs)
        except TimeoutError as timeout_error:
            raise EmbeddingTimeoutError() from timeout_error
        return [embedding_vector.tolist() for embedding_vector in embedding_vectors]

    async def _prepare_all_items(self, items: Sequence[EmbeddingInput]) -> list[EncoderInput]:
        """Prepare every item concurrently; nothing is enqueued unless all succeed."""
        preparation_tasks = [
            asyncio.create_task(self._prepare_item(item), name=f"prepare-item-{item_index}")
            for item_index, item in enumerate(items)
        ]
        try:
            preparation_results = await asyncio.gather(*preparation_tasks, return_exceptions=True)
        except asyncio.CancelledError:
            for preparation_task in preparation_tasks:
                preparation_task.cancel()
            raise

        prepared_inputs: list[EncoderInput] = []
        for item_index, preparation_result in enumerate(preparation_results):
            if isinstance(preparation_result, InvalidInputError):
                raise preparation_result.for_item(item_index) from preparation_result
            if isinstance(preparation_result, BaseException):
                raise preparation_result
            prepared_inputs.append(preparation_result)
        return prepared_inputs

    async def _prepare_item(self, item: EmbeddingInput) -> EncoderInput:
        """Format, token-check, and/or decode one item off the event loop."""
        if isinstance(item, TextInput):
            formatted_text = format_text_for_task(item.text, item.task, item.title)
            await self._validate_token_budget(formatted_text)
            return EncoderInput(text=formatted_text)

        if isinstance(item, ImageInput):
            return EncoderInput(image=await self._normalise_image(item.image_base64))

        if isinstance(item, TextImageInput):
            formatted_text = format_text_for_task(item.text, item.task, item.title)
            formatted_text = f"{formatted_text} {IMAGE_PLACEHOLDER_MARKER}"
            await self._validate_token_budget(formatted_text)
            return EncoderInput(
                text=formatted_text,
                image=await self._normalise_image(item.image_base64),
            )

        # Unreachable: the discriminated union admits only the three types above.
        raise InvalidInputError("Unsupported embedding input type")

    async def _validate_token_budget(self, formatted_text: str) -> None:
        await asyncio.get_running_loop().run_in_executor(
            self._tokenization_executor,
            self._embedding_backend.validate_text_token_budget,
            formatted_text,
        )

    async def _normalise_image(self, encoded_image: str) -> NormalisedImage:
        return await asyncio.get_running_loop().run_in_executor(
            self._image_decode_executor,
            normalise_base64_image,
            encoded_image,
            self._settings,
        )
