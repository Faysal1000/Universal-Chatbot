"""Streaming model calls: provider SSE in, ``chat.completion.chunk`` SSE out.

The provider stream is read until the first client-visible payload *before* the
response is committed, so failures that happen before any output can still be retried
or move to the next chain step. After the first byte has been sent, a failure is
reported in-stream as an OpenAI-style ``{"error": ...}`` event followed by ``[DONE]``,
and :class:`CommittedStreamFailure` tells the orchestrator the chain must stop.
"""

import asyncio
import contextlib
from collections.abc import AsyncGenerator, AsyncIterator
from dataclasses import dataclass

from starlette.types import Send

from app.core.errors import GatewayAtCapacityError, UpstreamError, UpstreamProtocolError, UpstreamServerError
from app.inference.asgi_responses import send_event_payloads, send_event_stream_end, send_event_stream_start
from app.inference.attempt_chain import CLIENT_CLOSED_REQUEST_STATUS, ModelAttemptChain
from app.inference.model_caller import CommittedStreamFailure, ModelCaller
from app.inference.upstream_http import raise_for_upstream_status, translate_transport_errors
from app.metrics.request_metric import CLIENT_DISCONNECTED_ERROR_CLASS
from app.protocols.adapter_base import ProtocolAdapter, StreamTranslator
from app.protocols.server_sent_events import ServerSentEvent, iterate_server_sent_events
from app.protocols.types import JsonObject, PreparedUpstreamRequest

EVENT_STREAM_CONTENT_TYPE = "text/event-stream"


@dataclass(slots=True)
class StreamAttempt:
    """State of one attempt; once committed, the attempt can no longer be retried."""

    translator: StreamTranslator
    has_committed_response: bool = False

    async def send_payloads(self, send: Send, event_payloads: list[str]) -> None:
        """Send payloads to the caller."""
        await send_event_payloads(send, event_payloads)


class StreamingModelCaller(ModelCaller):
    """Relays a provider stream through the protocol translator with retry-before-first-byte."""

    async def serve(
        self, adapter: ProtocolAdapter, chat_request: JsonObject, chain: ModelAttemptChain, send: Send
    ) -> None:
        """Stream from the model until it succeeds or its attempts are exhausted."""
        prepared_request = self.prepare_request(adapter, chat_request, chain)
        recorder = self._dependencies.metrics_recorder
        while True:
            chain.attempt_count += 1
            chain.time_to_first_token_ms = None
            attempt = StreamAttempt(translator=self._create_translator(adapter, chain))
            try:
                await self._stream_once(adapter, prepared_request, chain, attempt, send)
            except UpstreamError as upstream_error:
                if attempt.has_committed_response:
                    await self._report_error_in_stream(attempt, upstream_error, send)
                    recorder.record(
                        chain.to_metric(
                            int(upstream_error.http_status),
                            token_usage=attempt.translator.usage,
                            error=upstream_error,
                        )
                    )
                    raise CommittedStreamFailure(upstream_error) from upstream_error
                if await self.wait_before_retry(chain, upstream_error):
                    continue
                recorder.record(chain.to_metric(int(upstream_error.http_status), error=upstream_error))
                raise
            except GatewayAtCapacityError as capacity_error:
                recorder.record(chain.to_metric(int(capacity_error.http_status), error=capacity_error))
                raise
            except asyncio.CancelledError:
                recorder.record(
                    chain.to_metric(
                        CLIENT_CLOSED_REQUEST_STATUS,
                        token_usage=attempt.translator.usage,
                        error_class=CLIENT_DISCONNECTED_ERROR_CLASS,
                    )
                )
                raise
            in_stream_error = attempt.translator.in_stream_error
            recorder.record(
                chain.to_metric(
                    200,
                    token_usage=attempt.translator.usage,
                    error_class=in_stream_error.error_class if in_stream_error else None,
                    error_message=in_stream_error.message if in_stream_error else None,
                )
            )
            if in_stream_error is not None:
                # The provider's error event already reached the caller; the chain must stop here.
                raise CommittedStreamFailure(UpstreamServerError(in_stream_error.message))
            return

    @staticmethod
    def _create_translator(adapter: ProtocolAdapter, chain: ModelAttemptChain) -> StreamTranslator:
        return adapter.create_stream_translator(
            chain.target,
            chain.request_context.completion_id,
            chain.request_context.created_unix_seconds,
            chain.request_context.client_wants_usage,
        )

    async def _stream_once(
        self,
        adapter: ProtocolAdapter,
        prepared_request: PreparedUpstreamRequest,
        chain: ModelAttemptChain,
        attempt: StreamAttempt,
        send: Send,
    ) -> None:
        async with self._dependencies.concurrency_limiter.slot(chain.target):
            with translate_transport_errors():
                async with self._open_event_stream(adapter, prepared_request, chain) as upstream_events:
                    first_payloads = await self._read_until_first_payload(
                        upstream_events, attempt.translator, chain
                    )
                    attempt.has_committed_response = True
                    await send_event_stream_start(send, chain.response_headers())
                    await attempt.send_payloads(send, first_payloads)
                    if not attempt.translator.finished:
                        await self._relay_remaining_events(upstream_events, attempt, chain, send)
        await send_event_stream_end(send)

    @contextlib.asynccontextmanager
    async def _open_event_stream(
        self, adapter: ProtocolAdapter, prepared_request: PreparedUpstreamRequest, chain: ModelAttemptChain
    ) -> AsyncIterator[AsyncGenerator[ServerSentEvent]]:
        """POST the request and yield its parsed events; always closes the provider connection."""
        http_client = self._dependencies.http_client
        upstream_request = http_client.build_request(
            "POST",
            prepared_request.url,
            json=prepared_request.json_body,
            headers={**prepared_request.headers, "Accept": EVENT_STREAM_CONTENT_TYPE},
            timeout=self.upstream_timeout(chain),
        )
        upstream_response = await http_client.send(upstream_request, stream=True)
        try:
            await raise_for_upstream_status(upstream_response, adapter)
            if EVENT_STREAM_CONTENT_TYPE not in upstream_response.headers.get("content-type", ""):
                raise UpstreamProtocolError("The model provider did not return an event stream")
            async with contextlib.aclosing(
                iterate_server_sent_events(upstream_response.aiter_lines())
            ) as events:
                yield events
        finally:
            await upstream_response.aclose()

    @staticmethod
    async def _read_until_first_payload(
        upstream_events: AsyncGenerator[ServerSentEvent],
        translator: StreamTranslator,
        chain: ModelAttemptChain,
    ) -> list[str]:
        """Consume events until the first output token; earlier errors stay retryable.

        Role-only and metadata chunks are buffered, not sent, so a failure right after them
        can still be retried or moved to the next chain step.
        """
        buffered_payloads: list[str] = []
        async for upstream_event in upstream_events:
            translation_result = translator.translate_event(upstream_event)
            if translator.in_stream_error is not None:
                raise UpstreamServerError(translator.in_stream_error.message)
            buffered_payloads.extend(translation_result.client_payloads)
            if translation_result.contains_output_token:
                chain.mark_first_token()
                return buffered_payloads
            if translator.finished:
                return buffered_payloads
        if not translator.finished:
            raise UpstreamProtocolError("The model provider closed the stream without output")
        return buffered_payloads

    @staticmethod
    async def _relay_remaining_events(
        upstream_events: AsyncGenerator[ServerSentEvent],
        attempt: StreamAttempt,
        chain: ModelAttemptChain,
        send: Send,
    ) -> None:
        async for upstream_event in upstream_events:
            translation_result = attempt.translator.translate_event(upstream_event)
            if translation_result.contains_output_token:
                chain.mark_first_token()
            await attempt.send_payloads(send, translation_result.client_payloads)
            if attempt.translator.finished:
                return
        raise UpstreamProtocolError("The model provider closed the stream before it finished")

    @staticmethod
    async def _report_error_in_stream(
        attempt: StreamAttempt, upstream_error: UpstreamError, send: Send
    ) -> None:
        """Too late to retry: tell the caller in-stream and end the response cleanly."""
        error_payload = attempt.translator.build_error_payload(
            upstream_error.error_code, upstream_error.client_message
        )
        await send_event_payloads(send, [error_payload])
        await send_event_stream_end(send)
