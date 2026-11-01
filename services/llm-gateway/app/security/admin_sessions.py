"""Stateless admin session tokens: ``<payload_b64>.<signature_b64>`` signed with HMAC-SHA256.

The token travels in an HttpOnly cookie; no server-side session store is needed.
"""

import base64
import binascii
import hashlib
import hmac
import json
import time
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class AdminSession:
    """Claims carried by a valid admin session cookie."""

    username: str
    expires_at_unix_seconds: int


class AdminSessionSigner:
    """Issues and verifies ``<payload_b64>.<signature_b64>`` session tokens (HMAC-SHA256)."""

    def __init__(self, signing_secret: str, session_ttl_seconds: int) -> None:
        self._signing_key = hashlib.sha256(b"llm-gateway-admin-session:" + signing_secret.encode()).digest()
        self._session_ttl_seconds = session_ttl_seconds

    def issue(self, username: str, now_unix_seconds: float | None = None) -> str:
        """Create a signed token valid for the configured TTL."""
        issued_at = int(now_unix_seconds if now_unix_seconds is not None else time.time())
        payload = json.dumps({"sub": username, "exp": issued_at + self._session_ttl_seconds}).encode()
        payload_b64 = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
        return f"{payload_b64}.{self._sign(payload_b64)}"

    def verify(self, session_token: str | None, now_unix_seconds: float | None = None) -> AdminSession | None:
        """Return the session if the signature is valid and it has not expired."""
        if not session_token or session_token.count(".") != 1:
            return None
        payload_b64, signature_b64 = session_token.split(".")
        if not hmac.compare_digest(signature_b64, self._sign(payload_b64)):
            return None
        try:
            claims = json.loads(base64.urlsafe_b64decode(payload_b64 + "=" * (-len(payload_b64) % 4)))
            session = AdminSession(username=str(claims["sub"]), expires_at_unix_seconds=int(claims["exp"]))
        except (ValueError, KeyError, TypeError, binascii.Error):
            return None
        current_time = now_unix_seconds if now_unix_seconds is not None else time.time()
        return session if session.expires_at_unix_seconds > current_time else None

    def _sign(self, payload_b64: str) -> str:
        signature = hmac.new(self._signing_key, payload_b64.encode("ascii"), hashlib.sha256).digest()
        return base64.urlsafe_b64encode(signature).decode("ascii").rstrip("=")
