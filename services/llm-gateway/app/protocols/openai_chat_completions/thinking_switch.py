"""Turns OpenAI ``reasoning_effort`` into a chat template's ``enable_thinking`` switch.

Callers stay model-agnostic: they send ``reasoning_effort`` (or nothing), and models whose
``reasoning_control`` is ``enable_thinking`` receive the template switch their server expects.
"""

from app.protocols.types import JsonObject

# Absent or null also means "do not think": thinking is opt-in for these templates.
_EFFORTS_MEANING_OFF = frozenset({"none"})


def replace_reasoning_effort_with_thinking_switch(upstream_body: JsonObject) -> None:
    """Drop ``reasoning_effort`` and set ``chat_template_kwargs.enable_thinking``.

    A caller's own ``chat_template_kwargs.enable_thinking`` wins over the translated value.
    """
    reasoning_effort = upstream_body.pop("reasoning_effort", None)
    caller_template_kwargs = upstream_body.get("chat_template_kwargs")
    template_kwargs = dict(caller_template_kwargs) if isinstance(caller_template_kwargs, dict) else {}
    template_kwargs.setdefault("enable_thinking", is_thinking_requested(reasoning_effort))
    upstream_body["chat_template_kwargs"] = template_kwargs


def is_thinking_requested(reasoning_effort: object) -> bool:
    """Any effort other than absent, null or ``"none"`` turns thinking on."""
    return isinstance(reasoning_effort, str) and reasoning_effort not in _EFFORTS_MEANING_OFF
