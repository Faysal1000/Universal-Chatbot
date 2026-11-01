"""Admin sign-in / sign-out with an HMAC-signed, HttpOnly session cookie."""

import asyncio
import hmac
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.api.dependencies import (
    ADMIN_API_PATH_PREFIX,
    ADMIN_SESSION_COOKIE_NAME,
    AdminSessionDependency,
    RuntimeDependency,
    require_csrf_header,
)
from app.schemas.session import LoginRequest, SessionResponse
from app.security.admin_passwords import verify_admin_password

router = APIRouter(prefix=f"{ADMIN_API_PATH_PREFIX}/session", tags=["admin: session"])


def _session_response(username: str, expires_at_unix_seconds: int) -> SessionResponse:
    return SessionResponse(
        username=username, expires_at=datetime.fromtimestamp(expires_at_unix_seconds, tz=UTC)
    )


@router.post("", response_model=SessionResponse, dependencies=[Depends(require_csrf_header)])
async def sign_in(
    login_request: LoginRequest, request: Request, response: Response, runtime: RuntimeDependency
) -> SessionResponse:
    """Check the admin credentials and set the session cookie."""
    client_address = request.client.host if request.client else "unknown"
    login_attempt_limiter = runtime.login_attempt_limiter
    if login_attempt_limiter.is_blocked(client_address):
        raise HTTPException(status_code=429, detail="Too many failed sign-in attempts; wait a minute")
    # Counted before the slow check, so parallel guesses cannot all pass is_blocked(); success resets it.
    login_attempt_limiter.record_failure(client_address)

    username_matches = hmac.compare_digest(
        login_request.username.encode("utf-8"), runtime.settings.admin_username.encode("utf-8")
    )
    # scrypt is deliberately slow: keep the event loop free, and always run it so the
    # response time does not reveal whether the username was right.
    password_matches = await asyncio.to_thread(
        verify_admin_password,
        login_request.password.get_secret_value(),
        runtime.settings.admin_password_hash.get_secret_value(),
    )
    if not (username_matches and password_matches):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    login_attempt_limiter.reset(client_address)
    session_token = runtime.admin_session_signer.issue(runtime.settings.admin_username)
    response.set_cookie(
        ADMIN_SESSION_COOKIE_NAME,
        session_token,
        max_age=runtime.settings.admin_session_ttl_seconds,
        path=ADMIN_API_PATH_PREFIX,
        secure=runtime.settings.admin_cookie_secure,
        httponly=True,
        samesite="strict",
    )
    admin_session = runtime.admin_session_signer.verify(session_token)
    if admin_session is None:  # pragma: no cover - a freshly issued token always verifies.
        raise HTTPException(status_code=500, detail="Could not create a session")
    return _session_response(admin_session.username, admin_session.expires_at_unix_seconds)


@router.get("", response_model=SessionResponse)
async def current_session(admin_session: AdminSessionDependency) -> SessionResponse:
    """Return the signed-in admin (401 if not signed in)."""
    return _session_response(admin_session.username, admin_session.expires_at_unix_seconds)


@router.delete("", status_code=204, dependencies=[Depends(require_csrf_header)])
async def sign_out(response: Response, runtime: RuntimeDependency) -> None:
    """Clear the session cookie; stateless tokens simply expire."""
    response.delete_cookie(
        ADMIN_SESSION_COOKIE_NAME,
        path=ADMIN_API_PATH_PREFIX,
        secure=runtime.settings.admin_cookie_secure,
        httponly=True,
        samesite="strict",
    )
