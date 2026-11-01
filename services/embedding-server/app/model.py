"""EmbeddingGemma 2 model loading and thread-safe inference.

All methods here are blocking and must be called from dedicated worker threads,
never directly from the asyncio event loop.
"""

import copy
import logging
import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

import numpy as np
import numpy.typing as npt

from app.config import Settings
from app.errors import InputTooLongError
from app.images import NormalisedImage, open_normalised_image

logger = logging.getLogger(__name__)

EmbeddingMatrix = npt.NDArray[np.float32]

_WARM_UP_TEXT = "warm-up"


@dataclass(frozen=True, slots=True)
class EncoderInput:
    """One item ready for the encoder: text, an image, or an interleaved pair."""

    text: str | None = None
    image: NormalisedImage | None = None

    def __post_init__(self) -> None:
        if self.text is None and self.image is None:
            raise ValueError("EncoderInput requires text, an image, or both")

    @property
    def modality(self) -> str:
        """Batching key: only items of the same modality are encoded together."""
        if self.text is not None and self.image is not None:
            return "text_image"
        return "image" if self.image is not None else "text"


class EmbeddingBackend(Protocol):
    """The subset of model behaviour the service depends on (enables test doubles)."""

    device: str

    def validate_text_token_budget(self, text: str) -> None:
        """Raise ``InputTooLongError`` when ``text`` exceeds the token budget."""

    def encode_batch(self, encoder_inputs: Sequence[EncoderInput]) -> EmbeddingMatrix:
        """Return one L2-normalised float32 row per input."""


class EmbeddingModel:
    """Thread-safe wrapper around a Sentence Transformers multimodal model.

    Token counting uses a private copy of the tokenizer guarded by its own lock, so
    request validation never waits behind a long-running GPU batch. Inference is
    serialised by a separate lock because a single model instance is not re-entrant.
    """

    def __init__(
        self,
        sentence_transformer: Any,
        device: str,
        settings: Settings,
        out_of_memory_error_types: tuple[type[BaseException], ...] = (),
        release_accelerator_memory: Callable[[], None] | None = None,
    ) -> None:
        self._sentence_transformer = sentence_transformer
        self.device = device
        self._settings = settings
        self._out_of_memory_error_types = out_of_memory_error_types
        self._release_accelerator_memory = release_accelerator_memory
        self._inference_lock = threading.Lock()

        shared_tokenizer = sentence_transformer.tokenizer
        try:
            self._token_counting_tokenizer = copy.deepcopy(shared_tokenizer)
            self._tokenizer_lock = threading.Lock()
        except Exception:  # noqa: BLE001 - any copy failure falls back to sharing safely.
            logger.warning("Tokenizer could not be copied; token counting will share the inference lock")
            self._token_counting_tokenizer = shared_tokenizer
            self._tokenizer_lock = self._inference_lock

    def count_text_tokens(self, text: str) -> int:
        """Return the number of tokens ``text`` occupies, including special tokens."""
        with self._tokenizer_lock:
            tokenized = self._token_counting_tokenizer(
                text,
                add_special_tokens=True,
                truncation=False,
                return_attention_mask=False,
            )
        token_ids = tokenized["input_ids"]
        if token_ids and isinstance(token_ids[0], list):
            return len(token_ids[0])
        return len(token_ids)

    def validate_text_token_budget(self, text: str) -> None:
        """Reject text longer than ``max_text_tokens`` instead of silently truncating it."""
        token_count = self.count_text_tokens(text)
        if token_count > self._settings.max_text_tokens:
            raise InputTooLongError(
                f"Text uses {token_count} tokens; the maximum is "
                f"{self._settings.max_text_tokens}. Split long content into smaller chunks."
            )

    def encode_batch(self, encoder_inputs: Sequence[EncoderInput]) -> EmbeddingMatrix:
        """Encode a same-modality batch, halving it on accelerator out-of-memory errors.

        Raises:
            RuntimeError: If the model returns an unexpected shape or non-finite values.
        """
        if not encoder_inputs:
            return np.empty((0, self._settings.embedding_dimension), dtype=np.float32)
        try:
            return self._encode_validated(encoder_inputs)
        except self._out_of_memory_error_types:
            if self._release_accelerator_memory is not None:
                self._release_accelerator_memory()
            if len(encoder_inputs) == 1:
                raise
            midpoint = len(encoder_inputs) // 2
            logger.warning(
                "Accelerator out of memory; retrying as two smaller batches",
                extra={"batch_size": len(encoder_inputs)},
            )
            return np.concatenate(
                [
                    self.encode_batch(encoder_inputs[:midpoint]),
                    self.encode_batch(encoder_inputs[midpoint:]),
                ]
            )

    def warm_up(self) -> None:
        """Run one tiny inference so the first real request does not pay JIT/allocation cost."""
        self.encode_batch([EncoderInput(text=_WARM_UP_TEXT)])

    def _encode_validated(self, encoder_inputs: Sequence[EncoderInput]) -> EmbeddingMatrix:
        """Materialise images, run the model, and verify the output matrix."""
        opened_images = []
        model_inputs: list[dict[str, Any]] = []
        try:
            for encoder_input in encoder_inputs:
                model_input: dict[str, Any] = {}
                if encoder_input.text is not None:
                    model_input["text"] = encoder_input.text
                if encoder_input.image is not None:
                    pil_image = open_normalised_image(encoder_input.image)
                    opened_images.append(pil_image)
                    model_input["image"] = pil_image
                model_inputs.append(model_input)

            with self._inference_lock:
                raw_embeddings = self._sentence_transformer.encode(
                    model_inputs,
                    batch_size=len(model_inputs),
                    show_progress_bar=False,
                    convert_to_numpy=True,
                    normalize_embeddings=True,
                    truncate_dim=self._settings.embedding_dimension,
                )
        finally:
            for pil_image in opened_images:
                pil_image.close()

        embedding_matrix = np.asarray(raw_embeddings, dtype=np.float32)
        expected_shape = (len(encoder_inputs), self._settings.embedding_dimension)
        if embedding_matrix.shape != expected_shape:
            raise RuntimeError(
                f"Unexpected embedding shape {embedding_matrix.shape}; expected {expected_shape}"
            )
        if not np.isfinite(embedding_matrix).all():
            raise RuntimeError("Model produced non-finite embedding values")
        return embedding_matrix


def _resolve_device(requested_device: str, cuda_is_available: bool) -> str:
    """Map the configured device preference onto an available device."""
    if requested_device == "cuda":
        if not cuda_is_available:
            raise RuntimeError("EMBEDDING_SERVER_DEVICE=cuda was configured, but CUDA is unavailable")
        return "cuda"
    if requested_device == "cpu":
        return "cpu"
    return "cuda" if cuda_is_available else "cpu"


def load_model(settings: Settings) -> EmbeddingModel:
    """Download (if needed), load, and warm up the configured embedding model.

    Heavy imports are deferred so tests and tooling can import this module without
    PyTorch installed.
    """
    import torch
    from sentence_transformers import SentenceTransformer

    device = _resolve_device(settings.device, torch.cuda.is_available())
    if device == "cpu" and settings.cpu_inference_threads is not None:
        torch.set_num_threads(settings.cpu_inference_threads)

    # EmbeddingGemma 2 recommends bfloat16 or float32; float16 degrades quality.
    model_dtype = torch.bfloat16 if device == "cuda" and torch.cuda.is_bf16_supported() else torch.float32
    logger.info(
        "Loading embedding model",
        extra={
            "model_name": settings.model_name,
            "model_revision": settings.model_revision or "latest",
            "device": device,
            "dtype": str(model_dtype),
        },
    )

    huggingface_token = settings.huggingface_token.get_secret_value() if settings.huggingface_token else None
    sentence_transformer = SentenceTransformer(
        settings.model_name,
        device=device,
        revision=settings.model_revision,
        token=huggingface_token,
        trust_remote_code=False,
        config_kwargs={"audio_config": None},  # Keep text + vision towers; drop audio.
        model_kwargs={"torch_dtype": model_dtype},
    )
    sentence_transformer.eval()

    embedding_model = EmbeddingModel(
        sentence_transformer,
        device=device,
        settings=settings,
        out_of_memory_error_types=(torch.cuda.OutOfMemoryError,) if device == "cuda" else (),
        release_accelerator_memory=torch.cuda.empty_cache if device == "cuda" else None,
    )
    embedding_model.warm_up()
    return embedding_model
