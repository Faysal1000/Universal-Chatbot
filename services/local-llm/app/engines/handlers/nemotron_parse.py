"""NVIDIA Nemotron Parse: one page image in, raw markup (text, classes, bounding boxes) out.

The prompt is a sequence of task tokens, not natural language. Decoding follows the
model card: greedy, ``repetition_penalty`` 1.1, special tokens kept so callers can
recover classes and boxes with NVIDIA's ``postprocessing.postprocess_document``.
"""

import base64
import copy
import re
from io import BytesIO

import torch
from PIL import Image
from transformers import AutoModel, AutoProcessor, GenerationConfig, PreTrainedModel, PreTrainedTokenizerBase

from app.engines.base import LoadRequest
from app.engines.handlers.base import PreparedGeneration
from app.errors import InvalidRequestError
from app.images import ImageLimits, decode_data_uri_image, downscale_to_pixel_budget
from app.schemas.openai import ChatCompletionRequest

NEMOTRON_PARSE_MODEL_TYPE = "nemotron_parse"
DEFAULT_TASK_PROMPT = "</s><s><predict_bbox><predict_classes><output_markdown><predict_text_in_pic>"
# Model-card ceiling for a dense page; longer outputs are truncated with finish_reason "length".
MAX_NEW_TOKENS = 8744
SMOKE_TEST_IMAGE_SIDE_PIXELS = 64
SMOKE_TEST_MAX_TOKENS = 4
_TASK_PROMPT_PATTERN = re.compile(r"^(<[^<>\s]+>)+$")
_TASK_TOKEN_PATTERN = re.compile(r"<[^<>\s]+>")


class NemotronParseHandler:
    """Validates page requests and builds Nemotron Parse ``generate()`` inputs."""

    def __init__(
        self,
        model: PreTrainedModel,
        processor: AutoProcessor,
        generation_config: GenerationConfig,
        load_request: LoadRequest,
        image_limits: ImageLimits,
        max_page_pixels: int,
    ) -> None:
        self._model = model
        self._processor = processor
        self._generation_config = generation_config
        self._load_request = load_request
        self._image_limits = image_limits
        self._max_page_pixels = max_page_pixels
        self._allowed_task_tokens = _collect_task_tokens(processor.tokenizer)

    @classmethod
    def load(cls, load_request: LoadRequest, image_limits: ImageLimits, max_page_pixels: int) -> "NemotronParseHandler":
        """Load weights, processor and the model's own generation defaults."""
        model_directory = load_request.model_directory
        model = AutoModel.from_pretrained(
            model_directory, trust_remote_code=True, dtype=getattr(torch, load_request.dtype)
        )
        model.to(load_request.device).eval()
        processor = AutoProcessor.from_pretrained(model_directory, trust_remote_code=True)
        generation_config = GenerationConfig.from_pretrained(model_directory)
        return cls(model, processor, generation_config, load_request, image_limits, max_page_pixels)

    @property
    def model(self) -> PreTrainedModel:
        """The loaded model, already on its device."""
        return self._model

    @property
    def tokenizer(self) -> PreTrainedTokenizerBase:
        """Tokenizer used to decode generated tokens."""
        tokenizer: PreTrainedTokenizerBase = self._processor.tokenizer
        return tokenizer

    @property
    def is_vision(self) -> bool:
        """Every request carries exactly one page image."""
        return True

    @property
    def is_document_parser(self) -> bool:
        """Each request parses one page."""
        return True

    @property
    def has_thinking_switch(self) -> bool:
        """The parser takes task tokens, not a chat template."""
        return False

    def prepare(self, request: ChatCompletionRequest) -> PreparedGeneration:
        """One page image plus an optional task-token prompt become model inputs."""
        page_image = self._read_single_page_image(request)
        task_prompt = self._read_task_prompt(request)
        model_inputs = self._processor(
            images=[page_image], text=task_prompt, return_tensors="pt", add_special_tokens=False
        )
        prompt_token_count = int(model_inputs["input_ids"].shape[-1])
        max_new_tokens = min(request.requested_max_tokens or MAX_NEW_TOKENS, MAX_NEW_TOKENS)
        generation_config = copy.deepcopy(self._generation_config)
        generation_config.max_new_tokens = max_new_tokens
        return PreparedGeneration(
            model_inputs={name: self._to_model_device(tensor) for name, tensor in model_inputs.items()},
            generation_options={"generation_config": generation_config},
            prompt_token_count=prompt_token_count,
            max_new_tokens=max_new_tokens,
            skip_special_tokens=False,
        )

    def smoke_test_request(self) -> ChatCompletionRequest:
        """A blank page proves the encoder and decoder both run."""
        blank_page = Image.new("RGB", (SMOKE_TEST_IMAGE_SIDE_PIXELS, SMOKE_TEST_IMAGE_SIDE_PIXELS), "white")
        png_buffer = BytesIO()
        blank_page.save(png_buffer, format="PNG")
        data_uri = "data:image/png;base64," + base64.b64encode(png_buffer.getvalue()).decode("ascii")
        return ChatCompletionRequest.model_validate(
            {
                "model": self._load_request.deployment_name,
                "messages": [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": data_uri}}]}],
                "max_tokens": SMOKE_TEST_MAX_TOKENS,
            }
        )

    def _read_single_page_image(self, request: ChatCompletionRequest) -> Image.Image:
        image_urls = request.all_image_urls()
        if len(image_urls) != 1:
            raise InvalidRequestError(
                f"Nemotron Parse takes exactly one page image per request; received {len(image_urls)}"
            )
        page_image = decode_data_uri_image(image_urls[0], self._image_limits)
        # Encoder cost grows faster than linearly with pixels; boxes are normalised, so this is invisible to callers.
        return downscale_to_pixel_budget(page_image, self._max_page_pixels)

    def _read_task_prompt(self, request: ChatCompletionRequest) -> str:
        """The caller's task tokens, or the full-parse default when no text is sent."""
        prompt_text = "".join(
            text for message in request.messages if message.role == "user" for text in message.text_parts()
        ).strip()
        if not prompt_text:
            return DEFAULT_TASK_PROMPT
        if not _TASK_PROMPT_PATTERN.fullmatch(prompt_text):
            raise InvalidRequestError("Nemotron Parse prompts are task tokens only, for example " + DEFAULT_TASK_PROMPT)
        unknown_tokens = sorted(set(_TASK_TOKEN_PATTERN.findall(prompt_text)) - self._allowed_task_tokens)
        if unknown_tokens:
            raise InvalidRequestError(f"Unknown Nemotron Parse task tokens: {', '.join(unknown_tokens)}")
        return prompt_text

    def _to_model_device(self, tensor: torch.Tensor) -> torch.Tensor:
        """Move to the model's device; floating inputs (pixels) also take the model's dtype."""
        if tensor.is_floating_point():
            return tensor.to(device=self._model.device, dtype=self._model.dtype)
        return tensor.to(self._model.device)


def _collect_task_tokens(tokenizer: PreTrainedTokenizerBase) -> frozenset[str]:
    """Every special or added token, which is the set a task prompt may be built from."""
    added_tokens = set(tokenizer.get_added_vocab().keys())
    return frozenset(added_tokens | set(tokenizer.all_special_tokens))
