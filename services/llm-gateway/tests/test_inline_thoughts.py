"""Leading ``<thought>`` blocks in content become ``reasoning_content``."""

import json

import pytest

from app.protocols.openai_chat_completions.inline_thoughts import (
    InlineThoughtSplitter,
    move_inline_thoughts_to_reasoning,
    split_inline_thoughts,
)
from app.protocols.openai_chat_completions.stream_translation import ChatCompletionsStreamTranslator
from app.protocols.server_sent_events import ServerSentEvent


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("<thought>Reply with pong.</thought>\n\npong", ("Reply with pong.", "pong")),
        ("  <think>plan</think>answer", ("plan", "answer")),
        ("plain answer", ("", "plain answer")),
        ("answer with <thought>later</thought> tags", ("", "answer with <thought>later</thought> tags")),
        ("<thought>cut off by max_tokens", ("cut off by max_tokens", "")),
    ],
)
def test_complete_answers_are_split(text: str, expected: tuple[str, str]) -> None:
    assert split_inline_thoughts(text) == expected


def test_tags_split_across_stream_chunks_are_recognised() -> None:
    splitter = InlineThoughtSplitter()
    pieces = [splitter.split(chunk) for chunk in ["<tho", "ught>Thinking", " hard</th", "ought>po", "ng"]]
    pieces.append(splitter.flush())

    assert "".join(reasoning for reasoning, _ in pieces) == "Thinking hard"
    assert "".join(answer for _, answer in pieces) == "pong"


def test_message_reasoning_is_moved_out_of_content() -> None:
    message: dict[str, object] = {"role": "assistant", "content": "<thought>why</thought>pong"}

    assert move_inline_thoughts_to_reasoning(message) is True
    assert message == {"role": "assistant", "content": "pong", "reasoning_content": "why"}


def test_streamed_thoughts_arrive_as_reasoning_deltas() -> None:
    translator = ChatCompletionsStreamTranslator("chatcmpl-1", 0, "gemma", client_wants_usage=False)
    contents = ["<thought>wh", "y</thought>", "pong"]
    deltas = []
    for position, content in enumerate(contents):
        finish_reason = "stop" if position == len(contents) - 1 else None
        chunk = {"choices": [{"index": 0, "delta": {"content": content}, "finish_reason": finish_reason}]}
        result = translator.translate_event(ServerSentEvent(event_name=None, data=json.dumps(chunk)))
        deltas.extend(json.loads(payload)["choices"][0]["delta"] for payload in result.client_payloads)

    assert "".join(delta.get("reasoning_content", "") for delta in deltas) == "why"
    assert "".join(delta["content"] for delta in deltas) == "pong"


def _stream(chunks: list[dict[str, object]], *, ends_with_done: bool = False) -> list[dict[str, str]]:
    translator = ChatCompletionsStreamTranslator("chatcmpl-1", 0, "gemma", client_wants_usage=False)
    events = [json.dumps(chunk) for chunk in chunks] + (["[DONE]"] if ends_with_done else [])
    deltas = []
    for data in events:
        result = translator.translate_event(ServerSentEvent(event_name=None, data=data))
        deltas.extend(json.loads(payload)["choices"][0]["delta"] for payload in result.client_payloads)
    return deltas


def _content_chunk(content: str, finish_reason: str | None = None) -> dict[str, object]:
    return {"choices": [{"index": 0, "delta": {"content": content}, "finish_reason": finish_reason}]}


def test_a_separate_finish_chunk_releases_held_text() -> None:
    finish_chunk = {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
    deltas = _stream([_content_chunk("<th"), finish_chunk])

    assert "".join(delta.get("content", "") for delta in deltas) == "<th"


def test_the_done_marker_releases_held_text() -> None:
    deltas = _stream([_content_chunk("<thought>still thinking")], ends_with_done=True)

    assert "".join(delta.get("reasoning_content", "") for delta in deltas) == "still thinking"


def test_whitespace_after_the_thought_is_dropped_across_chunks() -> None:
    splitter = InlineThoughtSplitter()
    pieces = [splitter.split(chunk) for chunk in ["<thought>x</thought>", "\n\n", " pong", " now"]]

    assert "".join(answer for _, answer in pieces) == "pong now"
