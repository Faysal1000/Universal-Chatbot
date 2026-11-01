"""Authentication of callers (the RAG backend) with the single gateway API key.

Accepts ``Authorization: Bearer <key>`` (what OpenAI SDKs send) or ``X-API-Key``; the
comparison is constant-time so response timing reveals nothing about the key.
"""

import hmac


def extract_caller_api_key(authorization_header: str | None, api_key_header: str | None) -> str | None:
    """Return the key from ``Authorization: Bearer`` (preferred) or ``X-API-Key``."""
    if authorization_header:
        scheme, _, credentials = authorization_header.partition(" ")
        if scheme.lower() == "bearer" and credentials.strip():
            return credentials.strip()
    if api_key_header and api_key_header.strip():
        return api_key_header.strip()
    return None


def is_valid_caller_api_key(provided_api_key: str | None, expected_api_key: str) -> bool:
    """Constant-time comparison; missing and wrong keys are indistinguishable."""
    if provided_api_key is None:
        return False
    return hmac.compare_digest(provided_api_key.encode("utf-8"), expected_api_key.encode("utf-8"))
