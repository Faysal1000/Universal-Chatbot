"""Shared fixtures. Environment is set before any ``app`` import reads settings."""

import os

# Never let tests pick up a developer's real Hugging Face token from .env.
os.environ["EMBEDDING_SERVER_HUGGINGFACE_TOKEN"] = ""
os.environ["EMBEDDING_SERVER_EMBEDDING_DIMENSION"] = "768"
os.environ["EMBEDDING_SERVER_ENABLE_API_DOCS"] = "false"
os.environ["EMBEDDING_SERVER_API_KEY"] = "test-only-secret-key-do-not-use-in-production-123456"
os.environ["EMBEDDING_SERVER_LOG_FORMAT"] = "text"
os.environ["EMBEDDING_SERVER_MAX_TEXT_TOKENS"] = "64"

import base64
import threading
from collections.abc import Sequence
from io import BytesIO

import numpy as np
import pytest
from PIL import Image

from app.config import Settings, settings
from app.errors import InputTooLongError
from app.model import EmbeddingMatrix, EncoderInput

TEST_API_KEY = os.environ["EMBEDDING_SERVER_API_KEY"]


class FakeEmbeddingBackend:
    """Deterministic stand-in for EmbeddingModel; records every batch it receives."""

    device = "cpu"

    def __init__(self, app_settings: Settings, inference_delay_seconds: float = 0.0) -> None:
        self._settings = app_settings
        self.inference_delay_seconds = inference_delay_seconds
        self.received_batches: list[list[EncoderInput]] = []
        self.fail_next_batch = False
        self.release_inference = threading.Event()
        self.release_inference.set()

    def validate_text_token_budget(self, text: str) -> None:
        token_count = len(text.split())
        if token_count > self._settings.max_text_tokens:
            raise InputTooLongError(
                f"Text uses {token_count} tokens; the maximum is "
                f"{self._settings.max_text_tokens}. Split long content into smaller chunks."
            )

    def encode_batch(self, encoder_inputs: Sequence[EncoderInput]) -> EmbeddingMatrix:
        self.release_inference.wait(timeout=10)
        self.received_batches.append(list(encoder_inputs))
        if self.fail_next_batch:
            self.fail_next_batch = False
            raise RuntimeError("simulated model failure")
        rows = np.zeros((len(encoder_inputs), self._settings.embedding_dimension), dtype=np.float32)
        for row_index, encoder_input in enumerate(encoder_inputs):
            rows[row_index, 0] = 1.0
            rows[row_index, 1] = float(len(encoder_input.text or ""))
        return rows


def encode_test_image(image_format: str = "PNG", size: tuple[int, int] = (12, 12), mode: str = "RGB") -> str:
    image_buffer = BytesIO()
    Image.new(mode, size, "white").save(image_buffer, format=image_format)
    return base64.b64encode(image_buffer.getvalue()).decode("ascii")


@pytest.fixture
def app_settings() -> Settings:
    return settings


@pytest.fixture
def fake_backend(app_settings: Settings) -> FakeEmbeddingBackend:
    return FakeEmbeddingBackend(app_settings)
