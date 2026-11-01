"""API-key authentication: one key for inference (llm-gateway), a different one for administration."""

import hmac
from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from pydantic import SecretStr

API_KEY_HEADER_NAME = "X-API-Key"

KeyDependency = Callable[[HTTPAuthorizationCredentials | None, str | None], Awaitable[None]]


def build_api_key_dependency(expected_api_key: SecretStr, scheme_name: str) -> KeyDependency:
    """A dependency accepting ``Authorization: Bearer <key>`` or ``X-API-Key: <key>`` in constant time."""
    expected_key_bytes = expected_api_key.get_secret_value().encode("utf-8")
    bearer_scheme = HTTPBearer(auto_error=False, scheme_name=f"{scheme_name}Bearer")
    header_scheme = APIKeyHeader(name=API_KEY_HEADER_NAME, auto_error=False, scheme_name=f"{scheme_name}Header")

    async def require_api_key(
        bearer_credentials: Annotated[HTTPAuthorizationCredentials | None, Security(bearer_scheme)],
        header_api_key: Annotated[str | None, Security(header_scheme)],
    ) -> None:
        """Identical 401 for a missing and a wrong key."""
        provided_key = bearer_credentials.credentials if bearer_credentials else header_api_key
        if provided_key is None or not hmac.compare_digest(provided_key.encode("utf-8"), expected_key_bytes):
            raise HTTPException(
                status_code=401,
                detail="Invalid or missing API key",
                headers={"WWW-Authenticate": "Bearer"},
            )

    return require_api_key
