"""Encryption at rest for provider API keys and extra-header values.

Fernet (AES-128-CBC + HMAC-SHA256) keyed by ``LLM_GATEWAY_ENCRYPTION_KEY``. Plaintext
secrets never reach the database or any API response.
"""

import json

from cryptography.fernet import Fernet, InvalidToken


class SecretCipher:
    """Encrypts provider secrets before they are written to Postgres."""

    def __init__(self, fernet_key: str) -> None:
        self._fernet = Fernet(fernet_key.encode("ascii"))

    def encrypt_text(self, plaintext: str) -> bytes:
        """Encrypt a UTF-8 string."""
        return self._fernet.encrypt(plaintext.encode("utf-8"))

    def decrypt_text(self, ciphertext: bytes) -> str:
        """Decrypt to a UTF-8 string; raises ``ValueError`` if the key does not match."""
        try:
            return self._fernet.decrypt(ciphertext).decode("utf-8")
        except InvalidToken as invalid_token:
            raise ValueError(
                "Stored secret cannot be decrypted with LLM_GATEWAY_ENCRYPTION_KEY"
            ) from invalid_token

    def encrypt_headers(self, headers: dict[str, str]) -> bytes:
        """Encrypt a header-name to header-value mapping as one JSON document."""
        return self.encrypt_text(json.dumps(headers, sort_keys=True))

    def decrypt_headers(self, ciphertext: bytes) -> dict[str, str]:
        """Inverse of :meth:`encrypt_headers`."""
        decoded_headers: dict[str, str] = json.loads(self.decrypt_text(ciphertext))
        return decoded_headers
