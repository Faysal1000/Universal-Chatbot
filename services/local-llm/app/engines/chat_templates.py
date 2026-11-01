"""Facts read from a model's own chat template, so behaviour follows the model rather than its name."""

# Qwen-style templates read this variable to switch reasoning on or off.
THINKING_SWITCH_VARIABLE = "enable_thinking"


def has_thinking_switch(chat_template: str | None) -> bool:
    """True when the template reads ``enable_thinking`` (passed as ``chat_template_kwargs``)."""
    return chat_template is not None and THINKING_SWITCH_VARIABLE in chat_template
