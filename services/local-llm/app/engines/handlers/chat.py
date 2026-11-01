"""Generic chat handler for any Transformers causal or image-text-to-text model with a chat template."""

from typing import Any

import torch
from PIL import Image
from transformers import (
    AutoModelForCausalLM,
    AutoModelForImageTextToText,
    AutoProcessor,
    AutoTokenizer,
    PreTrainedModel,
    PreTrainedTokenizerBase,
    ProcessorMixin,
)

from app.engines.base import LoadRequest
from app.engines.chat_templates import has_thinking_switch
from app.engines.handlers.base import PreparedGeneration
from app.errors import InvalidRequestError
from app.images import ImageLimits, decode_data_uri_image
from app.schemas.openai import ChatCompletionRequest, ChatMessage, TextContentPart

SMOKE_TEST_PROMPT = "Reply with OK."
# OpenAI's "developer" role is the newer name for "system"; chat templates only know "system".
ROLE_ALIASES = {"developer": "system"}


class ChatHandler:
    """Applies the model's chat template; images are passed to its processor when it has one."""

    def __init__(
        self,
        model: PreTrainedModel,
        text_processor: ProcessorMixin | PreTrainedTokenizerBase,
        load_request: LoadRequest,
        image_limits: ImageLimits,
    ) -> None:
        self._model = model
        self._text_processor = text_processor
        self._load_request = load_request
        self._image_limits = image_limits

    @classmethod
    def load(cls, load_request: LoadRequest, image_limits: ImageLimits) -> "ChatHandler":
        """Load weights and the tokenizer/processor from the downloaded snapshot."""
        model_directory = load_request.model_directory
        trust_remote_code = load_request.resolved_model.needs_remote_code
        torch_dtype = getattr(torch, load_request.dtype)
        text_processor: ProcessorMixin | PreTrainedTokenizerBase
        if load_request.resolved_model.is_vision:
            text_processor = AutoProcessor.from_pretrained(model_directory, trust_remote_code=trust_remote_code)
            model = AutoModelForImageTextToText.from_pretrained(
                model_directory, dtype=torch_dtype, trust_remote_code=trust_remote_code
            )
        else:
            text_processor = AutoTokenizer.from_pretrained(model_directory, trust_remote_code=trust_remote_code)
            model = AutoModelForCausalLM.from_pretrained(
                model_directory, dtype=torch_dtype, trust_remote_code=trust_remote_code
            )
        model.to(load_request.device).eval()
        return cls(model, text_processor, load_request, image_limits)

    @property
    def model(self) -> PreTrainedModel:
        """The loaded model, already on its device."""
        return self._model

    @property
    def tokenizer(self) -> PreTrainedTokenizerBase:
        """Tokenizer used to decode generated tokens."""
        if isinstance(self._text_processor, PreTrainedTokenizerBase):
            return self._text_processor
        tokenizer: PreTrainedTokenizerBase = self._text_processor.tokenizer
        return tokenizer

    @property
    def is_vision(self) -> bool:
        """True when requests may carry images."""
        return self._load_request.resolved_model.is_vision

    @property
    def is_document_parser(self) -> bool:
        """Chat models produce tokens, not pages."""
        return False

    @property
    def has_thinking_switch(self) -> bool:
        """Read from the processor's or tokenizer's chat template."""
        chat_template = getattr(self._text_processor, "chat_template", None) or self.tokenizer.chat_template
        return has_thinking_switch(chat_template if isinstance(chat_template, str) else None)

    def prepare(self, request: ChatCompletionRequest) -> PreparedGeneration:
        """Render the chat template, check the context window and map sampling options."""
        if request.all_image_urls() and not self.is_vision:
            raise InvalidRequestError(f"Deployment '{request.model}' does not accept images")
        conversation = [self._to_template_message(message) for message in request.messages]
        model_inputs = self._text_processor.apply_chat_template(
            conversation,
            add_generation_prompt=True,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
            **(request.chat_template_kwargs or {}),
        )
        prompt_token_count = int(model_inputs["input_ids"].shape[-1])
        max_new_tokens = self._max_new_tokens(request, prompt_token_count)
        return PreparedGeneration(
            model_inputs={name: tensor.to(self._model.device) for name, tensor in model_inputs.items()},
            generation_options={**_sampling_options(request), "max_new_tokens": max_new_tokens},
            prompt_token_count=prompt_token_count,
            max_new_tokens=max_new_tokens,
            seed=request.seed,
            stop_strings=_stop_strings(request),
        )

    def smoke_test_request(self) -> ChatCompletionRequest:
        """A one-word reply proves the weights and template work."""
        return ChatCompletionRequest.model_validate(
            {
                "model": self._load_request.deployment_name,
                "messages": [{"role": "user", "content": SMOKE_TEST_PROMPT}],
                "max_tokens": 2,
                "temperature": 0,
            }
        )

    def _to_template_message(self, message: ChatMessage) -> dict[str, Any]:
        role = ROLE_ALIASES.get(message.role, message.role)
        if not self.is_vision:
            return {"role": role, "content": "\n".join(message.text_parts())}
        return {"role": role, "content": self._to_template_parts(message)}

    def _to_template_parts(self, message: ChatMessage) -> list[dict[str, Any]]:
        if isinstance(message.content, str):
            return [{"type": "text", "text": message.content}]
        template_parts: list[dict[str, Any]] = []
        for part in message.content or []:
            if isinstance(part, TextContentPart):
                template_parts.append({"type": "text", "text": part.text})
            else:
                image: Image.Image = decode_data_uri_image(part.image_url.url, self._image_limits)
                template_parts.append({"type": "image", "image": image})
        return template_parts

    def _max_new_tokens(self, request: ChatCompletionRequest, prompt_token_count: int) -> int:
        context_window = self._load_request.context_window_tokens
        available_tokens = context_window - prompt_token_count
        if available_tokens < 1:
            raise InvalidRequestError(
                f"The prompt uses {prompt_token_count} tokens; the context window is {context_window}"
            )
        requested_tokens = request.requested_max_tokens or self._load_request.max_output_tokens
        return min(requested_tokens, self._load_request.max_output_tokens, available_tokens)


def _sampling_options(request: ChatCompletionRequest) -> dict[str, Any]:
    """OpenAI sampling fields as ``generate()`` keyword arguments; unset fields keep the model defaults."""
    if request.temperature == 0:
        sampling_options: dict[str, Any] = {"do_sample": False}
    elif request.temperature is not None:
        sampling_options = {"do_sample": True, "temperature": request.temperature}
    else:
        sampling_options = {}
    optional_options = {
        "top_p": request.top_p,
        "top_k": request.top_k,
        "repetition_penalty": request.repetition_penalty,
    }
    sampling_options.update({name: value for name, value in optional_options.items() if value is not None})
    return sampling_options


def _stop_strings(request: ChatCompletionRequest) -> list[str]:
    if request.stop is None:
        return []
    return [request.stop] if isinstance(request.stop, str) else list(request.stop)
