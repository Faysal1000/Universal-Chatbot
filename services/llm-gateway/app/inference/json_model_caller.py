"""Non-streaming model calls: one JSON request, one translated ``chat.completion`` response."""

import asyncio

from starlette.types import Send

from app.core.errors import GatewayAtCapacityError, UpstreamError
from app.inference.asgi_responses import send_json_response
from app.inference.attempt_chain import CLIENT_CLOSED_REQUEST_STATUS, ModelAttemptChain
from app.inference.model_caller import ModelCaller
from app.inference.upstream_http import (
    decode_json_object,
    raise_for_upstream_status,
    translate_transport_errors,
)
from app.metrics.request_metric import CLIENT_DISCONNECTED_ERROR_CLASS
from app.protocols.adapter_base import ProtocolAdapter
from app.protocols.types import JsonObject, PreparedUpstreamRequest, TokenUsage


class JsonModelCaller(ModelCaller):
    """Retries the whole call on retryable failures; nothing reaches the caller until success."""

    async def serve(
        self, adapter: ProtocolAdapter, chat_request: JsonObject, chain: ModelAttemptChain, send: Send
    ) -> None:
        """Call the model until it succeeds or its attempts are exhausted."""
        prepared_request = self.prepare_request(adapter, chat_request, chain)
        recorder = self._dependencies.metrics_recorder
        while True:
            chain.attempt_count += 1
            try:
                chat_completion, token_usage = await self._call_once(adapter, prepared_request, chain)
            except UpstreamError as upstream_error:
                if await self.wait_before_retry(chain, upstream_error):
                    continue
                recorder.record(chain.to_metric(int(upstream_error.http_status), error=upstream_error))
                raise
            except GatewayAtCapacityError as capacity_error:
                recorder.record(chain.to_metric(int(capacity_error.http_status), error=capacity_error))
                raise
            except asyncio.CancelledError:
                recorder.record(
                    chain.to_metric(CLIENT_CLOSED_REQUEST_STATUS, error_class=CLIENT_DISCONNECTED_ERROR_CLASS)
                )
                raise
            recorder.record(chain.to_metric(200, token_usage=token_usage))
            await send_json_response(send, 200, chat_completion, chain.response_headers())
            return

    async def _call_once(
        self, adapter: ProtocolAdapter, prepared_request: PreparedUpstreamRequest, chain: ModelAttemptChain
    ) -> tuple[JsonObject, TokenUsage]:
        async with self._dependencies.concurrency_limiter.slot(chain.target):
            with translate_transport_errors():
                upstream_response = await self._dependencies.http_client.post(
                    prepared_request.url,
                    json=prepared_request.json_body,
                    headers=prepared_request.headers,
                    timeout=self.upstream_timeout(chain),
                )
        await raise_for_upstream_status(upstream_response, adapter)
        return adapter.translate_response(
            decode_json_object(upstream_response),
            chain.target,
            chain.request_context.completion_id,
            chain.request_context.created_unix_seconds,
        )
