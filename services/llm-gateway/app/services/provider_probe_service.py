"""Live checks against a provider: list its models, or send one tiny test completion.

Probes are admin actions: they are never recorded in request metrics and they work
for disabled providers and models.
"""

import time

import httpx

from app.core.errors import GatewayError, UpstreamError
from app.inference.upstream_http import (
    decode_json_object,
    raise_for_upstream_status,
    translate_transport_errors,
)
from app.persistence.tables import ProviderModelRecord, ProviderRecord
from app.protocols.registry import adapter_for
from app.protocols.types import JsonObject, UpstreamTarget
from app.routing.provider_registry import build_upstream_target, parse_api_protocol
from app.schemas.providers import ConnectionTestResponse, DiscoveredModelResponse
from app.security.secret_cipher import SecretCipher
from app.services.errors import ProviderUnreachableError

DISCOVERY_TIMEOUT_SECONDS = 20
CONNECTION_TEST_PROMPT = "Reply with the single word: pong"
CONNECTION_TEST_MAX_OUTPUT_TOKENS = 64
CONNECTION_TEST_PREVIEW_CHARACTERS = 200


class ProviderProbeService:
    """Use cases behind ``discover-models`` and ``models/{id}/test``."""

    def __init__(self, http_client: httpx.AsyncClient, secret_cipher: SecretCipher) -> None:
        self._http_client = http_client
        self._secret_cipher = secret_cipher

    async def discover_models(self, provider: ProviderRecord) -> list[DiscoveredModelResponse]:
        """Call the provider's models endpoint; nothing is saved."""
        target = self._provider_level_target(provider)
        adapter = adapter_for(target.api_protocol)
        models_url, request_headers = adapter.build_models_list_request(target)
        try:
            with translate_transport_errors():
                upstream_response = await self._http_client.get(
                    models_url, headers=request_headers, timeout=target.request_timeout_seconds
                )
            await raise_for_upstream_status(upstream_response, adapter)
            discovered_models = adapter.parse_models_list(decode_json_object(upstream_response))
        except UpstreamError as upstream_error:
            status_text = (
                f" (HTTP {upstream_error.upstream_status_code})"
                if upstream_error.upstream_status_code
                else ""
            )
            raise ProviderUnreachableError(
                f"Could not list models{status_text}: {upstream_error.client_message}"
            ) from upstream_error
        existing_model_ids = {provider_model.model_id for provider_model in provider.models}
        return [
            DiscoveredModelResponse(
                model_id=discovered_model.model_id,
                display_name=discovered_model.display_name,
                already_added=discovered_model.model_id in existing_model_ids,
            )
            for discovered_model in discovered_models
        ]

    async def test_model(
        self, provider: ProviderRecord, provider_model: ProviderModelRecord
    ) -> ConnectionTestResponse:
        """Send a minimal completion; failures are reported in the result, not raised."""
        target = build_upstream_target(provider, provider_model, self._secret_cipher)
        adapter = adapter_for(target.api_protocol)
        test_request: JsonObject = {
            "model": target.model_id,
            "messages": [{"role": "user", "content": CONNECTION_TEST_PROMPT}],
        }
        if target.api_protocol == "anthropic_messages":
            test_request["max_tokens"] = CONNECTION_TEST_MAX_OUTPUT_TOKENS  # Required by the protocol.
        started_monotonic = time.monotonic()
        upstream_status: int | None = None
        try:
            prepared_request = adapter.build_request(test_request, target)
            with translate_transport_errors():
                upstream_response = await self._http_client.post(
                    prepared_request.url,
                    json=prepared_request.json_body,
                    headers=prepared_request.headers,
                    timeout=target.request_timeout_seconds,
                )
            upstream_status = upstream_response.status_code
            await raise_for_upstream_status(upstream_response, adapter)
            chat_completion, token_usage = adapter.translate_response(
                decode_json_object(upstream_response), target, "connection-test", 0
            )
        except GatewayError as test_error:
            return ConnectionTestResponse(
                success=False,
                latency_ms=_elapsed_ms(started_monotonic),
                http_status=upstream_status,
                message=test_error.client_message,
            )
        return ConnectionTestResponse(
            success=True,
            latency_ms=_elapsed_ms(started_monotonic),
            http_status=upstream_status,
            message="Model responded successfully",
            response_preview=_assistant_text(chat_completion)[:CONNECTION_TEST_PREVIEW_CHARACTERS],
            input_tokens=token_usage.input_tokens,
            output_tokens=token_usage.output_tokens,
        )

    def _provider_level_target(self, provider: ProviderRecord) -> UpstreamTarget:
        """A target for provider-wide calls (model discovery) that need no specific model."""
        return UpstreamTarget(
            provider_id=provider.provider_id,
            provider_display_name=provider.display_name,
            base_url=provider.base_url,
            api_protocol=parse_api_protocol(provider.api_protocol),
            api_key=(
                self._secret_cipher.decrypt_text(provider.encrypted_api_key)
                if provider.encrypted_api_key
                else None
            ),
            extra_headers=(
                self._secret_cipher.decrypt_headers(provider.encrypted_extra_headers)
                if provider.encrypted_extra_headers
                else {}
            ),
            request_timeout_seconds=min(provider.request_timeout_seconds, DISCOVERY_TIMEOUT_SECONDS),
            max_concurrent_requests=provider.max_concurrent_requests,
            model_pk=0,
            model_id="",
        )


def _elapsed_ms(started_monotonic: float) -> float:
    return round((time.monotonic() - started_monotonic) * 1000, 1)


def _assistant_text(chat_completion: JsonObject) -> str:
    choices = chat_completion.get("choices") or []
    assistant_message = choices[0].get("message", {}) if choices else {}
    return str(assistant_message.get("content") or assistant_message.get("reasoning_content") or "")
