"""Keep llm-gateway's view of local deployments in sync with what is actually loaded here.

The deployment manager only states the desired state ("available with this payload" or
"unavailable"); a background worker delivers it with exponential backoff, so loading a
model never waits for, or fails because of, the gateway. Calls are idempotent on the
gateway side, so retries and restarts are safe.
"""

import asyncio
import contextlib
import functools
import logging
import random
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass

import httpx

from app.config import Settings
from app.deployments.models import ReasoningControl

logger = logging.getLogger(__name__)

REGISTRATION_PATH = "/v1/local-models"
GATEWAY_REQUEST_TIMEOUT_SECONDS = 10.0
INITIAL_BACKOFF_SECONDS = 1.0


@dataclass(frozen=True, slots=True)
class RegistrationPayload:
    """Body of llm-gateway's ``PUT /v1/local-models/{deployment_name}``."""

    display_name: str
    base_url: str
    capabilities: tuple[str, ...]
    context_window_tokens: int
    max_output_tokens: int
    default_for_tasks: tuple[str, ...]
    reasoning_control: ReasoningControl | None = None
    api_protocol: str = "openai_chat_completions"

    def to_json(self) -> dict[str, object]:
        """JSON body with lists instead of tuples; an unset ``reasoning_control`` is omitted (gateway keeps its own)."""
        body = asdict(self)
        body["capabilities"] = list(self.capabilities)
        body["default_for_tasks"] = list(self.default_for_tasks)
        if self.reasoning_control is None:
            del body["reasoning_control"]
        return body


_UNAVAILABLE = None
DesiredState = RegistrationPayload | None


class GatewayRegistrar:
    """Delivers registration changes to llm-gateway in the background, retrying until they succeed."""

    def __init__(
        self,
        settings: Settings,
        http_client: httpx.AsyncClient | None = None,
        random_jitter: Callable[[], float] = random.random,
    ) -> None:
        self._is_enabled = settings.is_gateway_registration_enabled
        self._max_backoff_seconds = settings.gateway_retry_max_backoff_seconds
        self._random_jitter = random_jitter
        self._http_client = http_client or _build_http_client(settings)
        self._http_client.headers.update(_authorization_headers(settings))
        # The key the gateway must send back to /v1 here; the gateway stores it encrypted.
        self._upstream_api_key = settings.inference_api_key
        self._pending_changes: dict[str, DesiredState] = {}
        self._local_ready_names: Callable[[], set[str]] = set
        self._needs_reconciliation = False
        self._wake_event = asyncio.Event()
        self._worker: asyncio.Task[None] | None = None

    def start(self, local_ready_names: Callable[[], set[str]]) -> None:
        """Start the worker; the first job marks stale gateway registrations unavailable."""
        if not self._is_enabled:
            logger.info("llm-gateway registration disabled (LOCAL_LLM_GATEWAY_BASE_URL not set)")
            return
        self._local_ready_names = local_ready_names
        self._needs_reconciliation = True
        self._worker = asyncio.create_task(self._deliver_forever(), name="gateway-registration")
        self._wake_event.set()

    def mark_available(self, deployment_name: str, payload: RegistrationPayload) -> None:
        """Register (or update) a ready deployment."""
        self._queue_change(deployment_name, payload)

    def mark_unavailable(self, deployment_name: str) -> None:
        """Tell the gateway to stop routing to an unloaded or failed deployment."""
        self._queue_change(deployment_name, _UNAVAILABLE)

    async def stop(self, flush_timeout_seconds: float) -> None:
        """Try to deliver pending changes for a short while, then stop the worker."""
        if self._worker is None:
            return
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._deliver_pending_once(), timeout=flush_timeout_seconds)
        self._worker.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._worker
        await self._http_client.aclose()

    def _queue_change(self, deployment_name: str, desired_state: DesiredState) -> None:
        if not self._is_enabled:
            return
        self._pending_changes[deployment_name] = desired_state
        self._wake_event.set()

    async def _deliver_forever(self) -> None:
        failed_attempts = 0
        while True:
            await self._wake_event.wait()
            self._wake_event.clear()
            if await self._deliver_pending_once():
                failed_attempts = 0
                continue
            failed_attempts += 1
            await self._wait_before_retry(failed_attempts)

    async def _deliver_pending_once(self) -> bool:
        """Try every pending change once; return True when nothing is left to deliver."""
        if self._needs_reconciliation and await self._try(self._reconcile, "reconcile"):
            self._needs_reconciliation = False
        for deployment_name, desired_state in list(self._pending_changes.items()):
            if await self._try(functools.partial(self._deliver, deployment_name, desired_state), "register"):
                # Only drop the change if no newer one arrived while this call was in flight.
                if self._pending_changes.get(deployment_name, "missing") is desired_state:
                    del self._pending_changes[deployment_name]
        return not self._pending_changes and not self._needs_reconciliation

    async def _try(self, operation: Callable[[], Awaitable[None]], operation_name: str) -> bool:
        try:
            await operation()
        except (httpx.HTTPError, GatewayRejectedError) as error:
            logger.warning(
                "llm-gateway sync failed; will retry", extra={"operation": operation_name, "error": str(error)}
            )
            return False
        return True

    async def _deliver(self, deployment_name: str, desired_state: DesiredState) -> None:
        if desired_state is _UNAVAILABLE:
            response = await self._http_client.post(f"{REGISTRATION_PATH}/{deployment_name}/unavailable")
            # 404: the gateway never knew this deployment, which is already the desired state.
            _raise_unless_success(response, also_accept=(404,))
            logger.info("Marked deployment unavailable on llm-gateway", extra={"deployment": deployment_name})
            return
        response = await self._http_client.put(
            f"{REGISTRATION_PATH}/{deployment_name}", json=self._registration_body(desired_state)
        )
        _raise_unless_success(response)
        logger.info(
            "Registered deployment with llm-gateway",
            extra={
                "deployment": deployment_name,
                "claimed_default_routes": response.json().get("claimed_default_routes"),
            },
        )

    def _registration_body(self, payload: RegistrationPayload) -> dict[str, object]:
        """The payload plus this service's inference key, sent on every call so a key rotation reaches the gateway."""
        return {**payload.to_json(), "api_key": self._upstream_api_key.get_secret_value()}

    async def _reconcile(self) -> None:
        """Mark unavailable every gateway registration that is not ready here (after a restart or crash)."""
        response = await self._http_client.get(REGISTRATION_PATH)
        _raise_unless_success(response)
        ready_names = self._local_ready_names()
        for registered in _registered_deployments(response.json()):
            name = str(registered["deployment_name"])
            if registered.get("is_available") and name not in ready_names and name not in self._pending_changes:
                self._pending_changes[name] = _UNAVAILABLE

    async def _wait_before_retry(self, failed_attempts: int) -> None:
        backoff_seconds = min(self._max_backoff_seconds, INITIAL_BACKOFF_SECONDS * 2 ** (failed_attempts - 1))
        # Jitter spreads retries so restarted replicas do not hit the gateway in lockstep.
        await asyncio.sleep(backoff_seconds * (0.5 + self._random_jitter() / 2))
        self._wake_event.set()


class GatewayRejectedError(Exception):
    """llm-gateway answered with a status that means the change was not applied."""


def _raise_unless_success(response: httpx.Response, also_accept: tuple[int, ...] = ()) -> None:
    if response.is_success or response.status_code in also_accept:
        return
    raise GatewayRejectedError(
        f"{response.request.method} {response.request.url.path} -> {response.status_code}: {response.text[:300]}"
    )


def _registered_deployments(response_body: object) -> list[dict[str, object]]:
    """``GET /v1/local-models`` returns a JSON list of deployments."""
    if not isinstance(response_body, list):
        raise GatewayRejectedError("GET /v1/local-models did not return a list")
    return [item for item in response_body if isinstance(item, dict)]


def _authorization_headers(settings: Settings) -> dict[str, str]:
    registration_key = settings.gateway_registration_api_key
    return {"Authorization": f"Bearer {registration_key.get_secret_value()}"} if registration_key else {}


def _build_http_client(settings: Settings) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=settings.gateway_base_url or "http://gateway-registration-disabled",
        timeout=GATEWAY_REQUEST_TIMEOUT_SECONDS,
    )
