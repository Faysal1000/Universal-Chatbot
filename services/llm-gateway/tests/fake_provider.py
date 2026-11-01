"""A fake LLM provider speaking all three upstream protocols, for tests and local demos.

Base URLs:
    OpenAI Chat Completions / Responses:  http://<host>/openai/v1
    Anthropic Messages:                   http://<host>/anthropic/v1

The model name selects behaviour:
    any name          -> succeeds ("Hello from <protocol> <model>")
    fail-500 / fail-429 / fail-401 / fail-400 -> always fails with that status
    flaky-<n>         -> fails with 503 for the first <n> calls, then succeeds
    slow              -> waits 0.3 s before each streamed token
    tool-caller       -> answers with a tool call to "get_weather"
    stream-error      -> streams one token, then an in-stream error event

Run standalone (for docker compose demos):
    python -m uvicorn tests.fake_provider:fake_provider_app --port 9100
"""

import asyncio
import json
from collections import defaultdict
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

fake_provider_app = FastAPI(title="Fake LLM provider")
call_counts_by_model: defaultdict[str, int] = defaultdict(int)
received_requests: list[dict[str, Any]] = []

INPUT_TOKENS = 12
CACHED_INPUT_TOKENS = 4
WORD_DELAY_SECONDS = 0.02


def _reply_words(protocol: str, model: str) -> list[str]:
    return ["Hello ", "from ", f"{protocol} ", f"{model}"]


def _forced_failure(model: str) -> JSONResponse | None:
    call_counts_by_model[model] += 1
    if model.startswith("fail-"):
        status_code = int(model.removeprefix("fail-"))
        return JSONResponse(status_code=status_code, content={"error": {"message": f"forced {status_code}"}})
    if model.startswith("flaky-") and call_counts_by_model[model] <= int(model.removeprefix("flaky-")):
        return JSONResponse(status_code=503, content={"error": {"message": "temporarily overloaded"}})
    return None


def _sse(payload: dict[str, Any], event_name: str | None = None) -> str:
    event_line = f"event: {event_name}\n" if event_name else ""
    return f"{event_line}data: {json.dumps(payload)}\n\n"


def _word_delay(model: str) -> float:
    return 0.3 if model == "slow" else WORD_DELAY_SECONDS


@fake_provider_app.get("/openai/v1/models")
@fake_provider_app.get("/anthropic/v1/models")
async def list_models() -> dict[str, Any]:
    """Both protocols use ``{"data": [{"id": ...}]}``."""
    return {
        "object": "list",
        "data": [{"id": "fake-small"}, {"id": "fake-large", "display_name": "Fake Large"}],
    }


# ----- OpenAI Chat Completions -----


@fake_provider_app.post("/openai/v1/chat/completions", response_model=None)
async def chat_completions(request: Request) -> JSONResponse | StreamingResponse:
    """Chat Completions with usage (in the final chunk when include_usage is set)."""
    body = await request.json()
    received_requests.append({"path": "chat/completions", "body": body, "headers": dict(request.headers)})
    model = str(body["model"])
    if (failure := _forced_failure(model)) is not None:
        return failure
    words = _reply_words("chat", model)
    usage = {
        "prompt_tokens": INPUT_TOKENS,
        "completion_tokens": len(words),
        "total_tokens": INPUT_TOKENS + len(words),
        "prompt_tokens_details": {"cached_tokens": CACHED_INPUT_TOKENS},
    }
    if model == "tool-caller":
        message: dict[str, Any] = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "get_weather", "arguments": '{"city":"Paris"}'},
                }
            ],
        }
    else:
        message = {"role": "assistant", "content": "".join(words)}
    if not body.get("stream"):
        return JSONResponse(
            {
                "id": "chatcmpl-fake",
                "object": "chat.completion",
                "created": 1,
                "model": model,
                "choices": [{"index": 0, "message": message, "finish_reason": "stop"}],
                "usage": usage,
            }
        )

    async def stream_chunks() -> AsyncIterator[str]:
        def chunk(delta: dict[str, Any], finish_reason: str | None = None) -> dict[str, Any]:
            return {
                "id": "chatcmpl-fake",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": model,
                "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
            }

        yield _sse(chunk({"role": "assistant", "content": ""}))
        for word_index, word in enumerate(words):
            await asyncio.sleep(_word_delay(model))
            yield _sse(chunk({"content": word}))
            if model == "stream-error" and word_index == 0:
                yield _sse({"error": {"message": "model crashed mid-stream", "type": "server_error"}})
                return
        yield _sse(chunk({}, "stop"))
        if (body.get("stream_options") or {}).get("include_usage"):
            yield _sse(
                {"id": "chatcmpl-fake", "object": "chat.completion.chunk", "choices": [], "usage": usage}
            )
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream_chunks(), media_type="text/event-stream")


# ----- OpenAI Responses -----


@fake_provider_app.post("/openai/v1/responses", response_model=None)
async def responses(request: Request) -> JSONResponse | StreamingResponse:
    """Responses API with output items and usage."""
    body = await request.json()
    received_requests.append({"path": "responses", "body": body, "headers": dict(request.headers)})
    model = str(body["model"])
    if (failure := _forced_failure(model)) is not None:
        return failure
    words = _reply_words("responses", model)
    usage = {
        "input_tokens": INPUT_TOKENS,
        "input_tokens_details": {"cached_tokens": CACHED_INPUT_TOKENS},
        "output_tokens": len(words),
        "output_tokens_details": {"reasoning_tokens": 2},
        "total_tokens": INPUT_TOKENS + len(words),
    }
    completed_response = {
        "id": "resp_fake",
        "object": "response",
        "status": "completed",
        "model": model,
        "output": [
            {"type": "reasoning", "id": "rs_1", "summary": [{"type": "summary_text", "text": "thinking"}]},
            {
                "type": "message",
                "id": "msg_1",
                "role": "assistant",
                "content": [{"type": "output_text", "text": "".join(words)}],
            },
        ],
        "usage": usage,
    }
    if not body.get("stream"):
        return JSONResponse(completed_response)

    async def stream_events() -> AsyncIterator[str]:
        yield _sse({"type": "response.created", "response": {"id": "resp_fake", "status": "in_progress"}})
        for word in words:
            await asyncio.sleep(_word_delay(model))
            yield _sse({"type": "response.output_text.delta", "item_id": "msg_1", "delta": word})
        yield _sse({"type": "response.completed", "response": completed_response})

    return StreamingResponse(stream_events(), media_type="text/event-stream")


# ----- Anthropic Messages -----


@fake_provider_app.post("/anthropic/v1/messages", response_model=None)
async def messages(request: Request) -> JSONResponse | StreamingResponse:
    """Messages API; requires x-api-key and anthropic-version like the real one."""
    body = await request.json()
    received_requests.append({"path": "messages", "body": body, "headers": dict(request.headers)})
    if "anthropic-version" not in request.headers:
        return JSONResponse(
            status_code=400, content={"error": {"message": "anthropic-version header is required"}}
        )
    model = str(body["model"])
    if (failure := _forced_failure(model)) is not None:
        return failure
    words = _reply_words("anthropic", model)
    if model == "tool-caller":
        content: list[dict[str, Any]] = [
            {"type": "text", "text": "Let me check."},
            {"type": "tool_use", "id": "toolu_1", "name": "get_weather", "input": {"city": "Paris"}},
        ]
        stop_reason = "tool_use"
    else:
        content = [{"type": "text", "text": "".join(words)}]
        stop_reason = "end_turn"
    if not body.get("stream"):
        return JSONResponse(
            {
                "id": "msg_fake",
                "type": "message",
                "role": "assistant",
                "model": model,
                "content": content,
                "stop_reason": stop_reason,
                "usage": {
                    "input_tokens": INPUT_TOKENS - CACHED_INPUT_TOKENS,
                    "cache_read_input_tokens": CACHED_INPUT_TOKENS,
                    "output_tokens": len(words),
                },
            }
        )

    async def stream_events() -> AsyncIterator[str]:
        yield _sse(
            {
                "type": "message_start",
                "message": {
                    "id": "msg_fake",
                    "model": model,
                    "usage": {
                        "input_tokens": INPUT_TOKENS - CACHED_INPUT_TOKENS,
                        "cache_read_input_tokens": CACHED_INPUT_TOKENS,
                        "output_tokens": 1,
                    },
                },
            },
            "message_start",
        )
        yield _sse({"type": "ping"}, "ping")
        if model == "tool-caller":
            yield _sse(
                {
                    "type": "content_block_start",
                    "index": 0,
                    "content_block": {
                        "type": "tool_use",
                        "id": "toolu_1",
                        "name": "get_weather",
                        "input": {},
                    },
                },
                "content_block_start",
            )
            for partial_json in ('{"city":', ' "Paris"}'):
                yield _sse(
                    {
                        "type": "content_block_delta",
                        "index": 0,
                        "delta": {"type": "input_json_delta", "partial_json": partial_json},
                    },
                    "content_block_delta",
                )
        else:
            yield _sse(
                {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
                "content_block_start",
            )
            for word in words:
                await asyncio.sleep(_word_delay(model))
                yield _sse(
                    {
                        "type": "content_block_delta",
                        "index": 0,
                        "delta": {"type": "text_delta", "text": word},
                    },
                    "content_block_delta",
                )
        yield _sse({"type": "content_block_stop", "index": 0}, "content_block_stop")
        yield _sse(
            {
                "type": "message_delta",
                "delta": {"stop_reason": stop_reason},
                "usage": {"output_tokens": len(words)},
            },
            "message_delta",
        )
        yield _sse({"type": "message_stop"}, "message_stop")

    return StreamingResponse(stream_events(), media_type="text/event-stream")


def reset_fake_provider_state() -> None:
    """Forget call counts and captured requests between tests."""
    call_counts_by_model.clear()
    received_requests.clear()
