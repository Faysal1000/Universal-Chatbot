"""What a Transformers model family must provide: turning a chat request into ``generate()`` inputs."""

from dataclasses import dataclass, field
from typing import Any, Protocol

import torch
from transformers import PreTrainedModel, PreTrainedTokenizerBase

from app.schemas.openai import ChatCompletionRequest


@dataclass(slots=True)
class PreparedGeneration:
    """Tensors and options for one ``model.generate()`` call; ``generation_options`` carries the token budget."""

    model_inputs: dict[str, torch.Tensor]
    generation_options: dict[str, Any]
    prompt_token_count: int
    max_new_tokens: int
    skip_special_tokens: bool = True
    seed: int | None = None
    stop_strings: list[str] = field(default_factory=list)


class TransformersHandler(Protocol):
    """A model family's request preparation; the engine owns threading and streaming."""

    @property
    def model(self) -> PreTrainedModel:
        """The loaded model, already on its device."""

    @property
    def tokenizer(self) -> PreTrainedTokenizerBase:
        """Tokenizer used to decode generated tokens."""

    @property
    def is_vision(self) -> bool:
        """True when requests may carry images."""

    @property
    def is_document_parser(self) -> bool:
        """True when each request parses one page."""

    @property
    def has_thinking_switch(self) -> bool:
        """True when the chat template reads ``enable_thinking``."""

    def prepare(self, request: ChatCompletionRequest) -> PreparedGeneration:
        """Validate the request and build ``generate()`` inputs; raise ``InvalidRequestError`` on bad input."""

    def smoke_test_request(self) -> ChatCompletionRequest:
        """A tiny request that proves the model generates."""
