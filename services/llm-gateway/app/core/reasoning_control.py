"""How a model is told whether to reason, set per model by the admin or local-llm.

* ``reasoning_effort``: the OpenAI field is passed on as the caller sent it.
* ``enable_thinking``: chat templates with a thinking switch (Qwen-style, served by
  vLLM or llama.cpp) get ``chat_template_kwargs.enable_thinking`` instead.
"""

from typing import Literal, TypeGuard, get_args

ReasoningControl = Literal["reasoning_effort", "enable_thinking"]
DEFAULT_REASONING_CONTROL: ReasoningControl = "reasoning_effort"
ENABLE_THINKING_CONTROL: ReasoningControl = "enable_thinking"
REASONING_CONTROLS: tuple[str, ...] = get_args(ReasoningControl)


def is_reasoning_control(value: str) -> TypeGuard[ReasoningControl]:
    """Whether a stored string (guarded by a CHECK constraint) is a known control."""
    return value in REASONING_CONTROLS
