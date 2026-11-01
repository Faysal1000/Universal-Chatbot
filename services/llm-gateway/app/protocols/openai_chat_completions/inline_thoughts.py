"""Move a leading ``<thought>…</thought>`` (or ``<think>…</think>``) block out of ``content``.

Some models put their reasoning inline instead of in a separate field: Gemma on Google's
OpenAI-compatible endpoint wraps it in ``<thought>``, DeepSeek-R1 style templates in ``<think>``.
Callers should get it in ``reasoning_content`` like every other provider's reasoning.
Only a block at the very start of the answer counts; tags later in the text are content.
"""

from enum import Enum, auto

THOUGHT_TAGS = {"<thought>": "</thought>", "<think>": "</think>"}


class _Phase(Enum):
    UNDECIDED = auto()
    THINKING = auto()
    ANSWERING = auto()


class InlineThoughtSplitter:
    """Splits streamed content into (reasoning, answer) pieces, holding back partial tags."""

    def __init__(self) -> None:
        self._phase = _Phase.UNDECIDED
        self._pending = ""
        self._closing_tag = ""
        self._is_trimming_answer_start = False

    def split(self, text: str) -> tuple[str, str]:
        """Return the reasoning and answer text that can be released after ``text``."""
        if self._phase is _Phase.ANSWERING:
            return "", self._release_answer(text)
        self._pending += text
        if self._phase is _Phase.UNDECIDED:
            self._decide_phase()
        return self._release_pending()

    def flush(self) -> tuple[str, str]:
        """Release whatever is still held back once the answer has ended."""
        if self._phase is _Phase.THINKING:
            return self._take_pending(), ""
        return "", self._take_pending()

    def _decide_phase(self) -> None:
        start = self._pending.lstrip()
        for opening_tag, closing_tag in THOUGHT_TAGS.items():
            if start.startswith(opening_tag):
                self._phase = _Phase.THINKING
                self._closing_tag = closing_tag
                self._pending = start.removeprefix(opening_tag)
                return
            if opening_tag.startswith(start):
                return
        self._phase = _Phase.ANSWERING

    def _release_pending(self) -> tuple[str, str]:
        if self._phase is _Phase.THINKING:
            return self._release_thinking()
        if self._phase is _Phase.ANSWERING:
            return "", self._take_pending()
        return "", ""

    def _release_thinking(self) -> tuple[str, str]:
        reasoning, closing_tag, answer = self._pending.partition(self._closing_tag)
        if closing_tag:
            self._phase = _Phase.ANSWERING
            self._pending = ""
            self._is_trimming_answer_start = True
            return reasoning, self._release_answer(answer)
        releasable_length = max(len(self._pending) - len(self._closing_tag) + 1, 0)
        reasoning = self._pending[:releasable_length]
        self._pending = self._pending[releasable_length:]
        return reasoning, ""

    def _release_answer(self, text: str) -> str:
        """Drop the whitespace between the thought block and the answer, whichever chunk it lands in."""
        if self._is_trimming_answer_start:
            text = text.lstrip()
            self._is_trimming_answer_start = text == ""
        return text

    def _take_pending(self) -> str:
        released, self._pending = self._pending, ""
        return released


def split_inline_thoughts(text: str) -> tuple[str, str]:
    """Split a complete answer into its leading thought block and the rest."""
    splitter = InlineThoughtSplitter()
    reasoning, answer = splitter.split(text)
    remaining_reasoning, remaining_answer = splitter.flush()
    return reasoning + remaining_reasoning, answer + remaining_answer


def move_inline_thoughts_to_reasoning(message: dict[str, object]) -> bool:
    """Move a leading thought block from a full ``message`` into ``reasoning_content``."""
    content = message.get("content")
    if not isinstance(content, str):
        return False
    reasoning, answer = split_inline_thoughts(content)
    if answer == content:
        return False
    message["content"] = answer
    if reasoning:
        message["reasoning_content"] = str(message.get("reasoning_content") or "") + reasoning
    return True
