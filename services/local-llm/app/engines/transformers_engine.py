"""In-process Transformers engine: runs ``generate()`` on a dedicated thread and streams text back.

Each deployment owns a single-thread executor, so one slow model never starves another
or the event loop. Client disconnects and deadlines stop generation through a stopping
criterion instead of leaving a thread generating for nobody.
"""

import asyncio
import contextlib
import gc
import logging
import threading
import time
from collections.abc import AsyncIterator, Mapping
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import torch
from transformers import PreTrainedTokenizerBase, StoppingCriteria, StoppingCriteriaList, TextStreamer

from app.deployments.models import ResolvedDevice
from app.engines.base import GenerationObserver, GenerationStats, LoadRequest
from app.engines.handlers.base import PreparedGeneration, TransformersHandler
from app.engines.handlers.chat import ChatHandler
from app.engines.handlers.nemotron_parse import NEMOTRON_PARSE_MODEL_TYPE, NemotronParseHandler
from app.engines.sse import SSE_DONE, ChunkFactory, encode_sse_error, encode_sse_event
from app.errors import InferenceFailedError, InferenceTimeoutError, LocalLlmError
from app.images import ImageLimits
from app.schemas.openai import (
    AssistantMessage,
    ChatCompletion,
    ChatCompletionRequest,
    Choice,
    FinishReason,
    Usage,
    new_completion_id,
    unix_timestamp,
)

logger = logging.getLogger(__name__)

_END_OF_STREAM = object()


class TransformersEngine:
    """Loads Hugging Face safetensors models with the handler for their model family."""

    def __init__(
        self,
        image_limits: ImageLimits,
        request_timeout_seconds: float,
        parser_max_page_pixels: Mapping[ResolvedDevice, int],
    ) -> None:
        self._image_limits = image_limits
        self._request_timeout_seconds = request_timeout_seconds
        self._parser_max_page_pixels = parser_max_page_pixels

    async def load(self, load_request: LoadRequest) -> "TransformersLoadedModel":
        """Load on a worker thread (it blocks for seconds to minutes)."""
        torch.set_num_threads(load_request.cpu_threads)
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"generate-{load_request.deployment_name}")
        try:
            handler = await asyncio.get_running_loop().run_in_executor(executor, self._load_handler, load_request)
        except BaseException:
            executor.shutdown(wait=False)
            raise
        return TransformersLoadedModel(handler, load_request, executor, self._request_timeout_seconds)

    def _load_handler(self, load_request: LoadRequest) -> TransformersHandler:
        if load_request.resolved_model.model_type == NEMOTRON_PARSE_MODEL_TYPE:
            max_page_pixels = self._parser_max_page_pixels[load_request.device]
            return NemotronParseHandler.load(load_request, self._image_limits, max_page_pixels)
        return ChatHandler.load(load_request, self._image_limits)


class TransformersLoadedModel:
    """A Transformers model in memory, serving OpenAI Chat Completions."""

    def __init__(
        self,
        handler: TransformersHandler,
        load_request: LoadRequest,
        executor: ThreadPoolExecutor,
        request_timeout_seconds: float,
    ) -> None:
        self._handler: TransformersHandler | None = handler
        self._load_request = load_request
        self._executor = executor
        self._request_timeout_seconds = request_timeout_seconds
        self._is_vision = handler.is_vision
        self._is_document_parser = handler.is_document_parser
        self._has_thinking_switch = handler.has_thinking_switch
        self._memory_bytes = int(handler.model.get_memory_footprint())

    @property
    def device(self) -> ResolvedDevice:
        """Where the model runs."""
        return self._load_request.device

    @property
    def is_vision(self) -> bool:
        """True when the model accepts images."""
        return self._is_vision

    @property
    def is_document_parser(self) -> bool:
        """True for page parsers (Nemotron Parse)."""
        return self._is_document_parser

    @property
    def has_thinking_switch(self) -> bool:
        """True when the chat template reads ``enable_thinking``."""
        return self._has_thinking_switch

    def is_alive(self) -> bool:
        """In-process models stay alive until unloaded."""
        return self._handler is not None

    def measured_memory_bytes(self) -> int:
        """Bytes held by parameters and buffers."""
        return self._memory_bytes

    async def complete(self, request: ChatCompletionRequest, observer: GenerationObserver) -> dict[str, Any]:
        """Generate the whole answer and return a ``chat.completion`` body."""
        generation = _Generation(self._require_handler(), request, observer)
        prepared = await self._prepare(generation)
        text_pieces = [piece async for piece in self._run(generation, prepared)]
        completion = ChatCompletion(
            id=new_completion_id(),
            created=unix_timestamp(),
            model=request.model,
            choices=[
                Choice(
                    message=AssistantMessage(content="".join(text_pieces)),
                    finish_reason=generation.finish_reason,
                )
            ],
            usage=generation.usage,
        )
        return completion.model_dump()

    async def stream(self, request: ChatCompletionRequest, observer: GenerationObserver) -> AsyncIterator[bytes]:
        """Stream ``chat.completion.chunk`` events.

        Invalid input raises before the first event (so it becomes an HTTP error); failures after
        the first event are sent as an SSE error event.
        """
        generation = _Generation(self._require_handler(), request, observer)
        prepared = await self._prepare(generation)
        chunk_factory = ChunkFactory(request.model)
        yield encode_sse_event(chunk_factory.role_chunk())
        try:
            async for text_piece in self._run(generation, prepared):
                yield encode_sse_event(chunk_factory.content_chunk(text_piece))
        except LocalLlmError as error:
            yield encode_sse_error(error.client_message, error.error_code)
            yield SSE_DONE
            return
        yield encode_sse_event(chunk_factory.finish_chunk(generation.finish_reason))
        if request.includes_stream_usage:
            yield encode_sse_event(chunk_factory.usage_chunk(generation.usage))
        yield SSE_DONE

    async def run_smoke_test(self) -> None:
        """Generate a few tokens through the normal request path."""
        handler = self._require_handler()
        await self.complete(handler.smoke_test_request(), _SilentObserver())

    async def unload(self) -> None:
        """Release weights and the generation thread."""
        if self._handler is None:
            return
        self._handler = None
        # A generation still running would block the event loop until it finishes.
        await asyncio.to_thread(self._executor.shutdown, True)
        gc.collect()
        if self._load_request.device == "cuda":
            torch.cuda.empty_cache()

    async def _run(self, generation: "_Generation", prepared: PreparedGeneration) -> AsyncIterator[str]:
        """Run ``generate()`` on the executor and yield decoded text as it is produced."""
        loop = asyncio.get_running_loop()
        text_queue: asyncio.Queue[object] = asyncio.Queue()
        streamer = _QueueTextStreamer(
            self._require_handler().tokenizer, loop, text_queue, skip_special_tokens=prepared.skip_special_tokens
        )
        generation_future = loop.run_in_executor(self._executor, generation.generate, prepared, streamer)
        generation_future.add_done_callback(lambda _: loop.call_soon_threadsafe(text_queue.put_nowait, _END_OF_STREAM))
        deadline = loop.time() + self._request_timeout_seconds
        try:
            while (text_piece := await _next_piece(text_queue, deadline - loop.time())) is not _END_OF_STREAM:
                yield str(text_piece)
            await generation_future
        except TimeoutError as error:
            raise InferenceTimeoutError() from error
        except Exception as error:
            logger.exception("Generation failed", extra={"deployment": self._load_request.deployment_name})
            raise InferenceFailedError() from error
        finally:
            # The slot is released only after the thread stops, so requests never overlap on the model.
            generation.cancel()
            with contextlib.suppress(Exception):
                await asyncio.shield(generation_future)
            generation.record(streamer.generated_token_count)

    async def _prepare(self, generation: "_Generation") -> PreparedGeneration:
        try:
            return await asyncio.get_running_loop().run_in_executor(self._executor, generation.prepare)
        except LocalLlmError:
            raise
        except Exception as error:
            logger.exception("Request preparation failed", extra={"deployment": self._load_request.deployment_name})
            raise InferenceFailedError("The request could not be prepared for this model") from error

    def _require_handler(self) -> TransformersHandler:
        if self._handler is None:
            raise InferenceFailedError("The model has been unloaded")
        return self._handler


class _Generation:
    """State of one request: preparation, the blocking ``generate()`` call and its outcome."""

    def __init__(
        self, handler: TransformersHandler, request: ChatCompletionRequest, observer: GenerationObserver
    ) -> None:
        self._handler = handler
        self._request = request
        self._observer = observer
        self._cancel_event = threading.Event()
        self._started_at = time.perf_counter()
        self._prompt_token_count = 0
        self._max_new_tokens = 0
        self._completion_token_count = 0
        self._is_recorded = False

    @property
    def finish_reason(self) -> FinishReason:
        """``length`` when the token budget was exhausted, otherwise ``stop``."""
        return "length" if self._completion_token_count >= self._max_new_tokens else "stop"

    @property
    def usage(self) -> Usage:
        """Token counts of this generation."""
        return Usage.from_counts(self._prompt_token_count, self._completion_token_count)

    def prepare(self) -> PreparedGeneration:
        """Handler-specific validation and tensor preparation (runs on the executor)."""
        prepared = self._handler.prepare(self._request)
        self._prompt_token_count = prepared.prompt_token_count
        self._max_new_tokens = prepared.max_new_tokens
        return prepared

    def generate(self, prepared: PreparedGeneration, streamer: "_QueueTextStreamer") -> None:
        """Blocking ``model.generate()``; tokens flow to the streamer as they are produced."""
        if prepared.seed is not None:
            torch.manual_seed(prepared.seed)
        stop_options: dict[str, Any] = (
            {"stop_strings": prepared.stop_strings, "tokenizer": self._handler.tokenizer}
            if prepared.stop_strings
            else {}
        )
        with torch.inference_mode():
            self._handler.model.generate(
                **prepared.model_inputs,
                **prepared.generation_options,
                **stop_options,
                streamer=streamer,
                stopping_criteria=StoppingCriteriaList([_CancellationCriteria(self._cancel_event)]),
            )

    def cancel(self) -> None:
        """Ask a running ``generate()`` to stop at the next token."""
        self._cancel_event.set()

    def record(self, completion_token_count: int) -> None:
        """Report the outcome to the observer exactly once."""
        if self._is_recorded:
            return
        self._is_recorded = True
        self._completion_token_count = completion_token_count
        self._observer.on_finished(
            GenerationStats(
                prompt_tokens=self._prompt_token_count,
                completion_tokens=completion_token_count,
                generation_seconds=time.perf_counter() - self._started_at,
                finish_reason=self.finish_reason,
                pages=1 if self._handler.is_document_parser and completion_token_count > 0 else 0,
            )
        )


class _QueueTextStreamer(TextStreamer):
    """Pushes decoded text to an asyncio queue from the generation thread and counts new tokens."""

    def __init__(
        self,
        tokenizer: PreTrainedTokenizerBase,
        loop: asyncio.AbstractEventLoop,
        text_queue: "asyncio.Queue[object]",
        skip_special_tokens: bool,
    ) -> None:
        super().__init__(tokenizer, skip_prompt=True, skip_special_tokens=skip_special_tokens)
        self._loop = loop
        self._text_queue = text_queue
        self.generated_token_count = 0

    def put(self, value: torch.Tensor) -> None:
        """Count generated tokens (the first call carries the prompt and is skipped)."""
        if not self.next_tokens_are_prompt:
            self.generated_token_count += int(value.shape[-1])
        super().put(value)

    def on_finalized_text(self, text: str, stream_end: bool = False) -> None:
        """Hand each decoded piece to the event loop."""
        if text:
            self._loop.call_soon_threadsafe(self._text_queue.put_nowait, text)


class _CancellationCriteria(StoppingCriteria):
    """Stops generation as soon as the request is cancelled or times out."""

    def __init__(self, cancel_event: threading.Event) -> None:
        self._cancel_event = cancel_event

    def __call__(self, input_ids: torch.LongTensor, scores: torch.FloatTensor, **kwargs: Any) -> torch.BoolTensor:
        """One flag per sequence in the batch."""
        is_cancelled = self._cancel_event.is_set()
        return torch.full((input_ids.shape[0],), is_cancelled, dtype=torch.bool, device=input_ids.device)


class _SilentObserver:
    """Smoke tests are not traffic; they do not count towards throughput."""

    def on_finished(self, stats: GenerationStats) -> None:
        """Ignored."""


async def _next_piece(text_queue: "asyncio.Queue[object]", remaining_seconds: float) -> object:
    if remaining_seconds <= 0:
        raise TimeoutError
    return await asyncio.wait_for(text_queue.get(), timeout=remaining_seconds)
