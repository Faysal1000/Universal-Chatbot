"""scrypt hashing for the single admin password (Python standard library only).

Hash format: ``scrypt:<n>:<r>:<p>:<salt_b64>:<hash_b64>``. It contains no ``$``, so it
can be pasted into ``.env`` / docker compose files without escaping.
"""

import base64
import binascii
import hashlib
import hmac
import secrets

_PASSWORD_HASH_PREFIX = "scrypt"  # noqa: S105 - algorithm tag, not a secret.
_SCRYPT_COST = 2**15
_SCRYPT_BLOCK_SIZE = 8
_SCRYPT_PARALLELISM = 1
_SCRYPT_KEY_BYTES = 32
_SCRYPT_MAX_MEMORY_BYTES = 128 * 1024 * 1024


def hash_admin_password(password: str) -> str:
    """Return a self-describing scrypt hash for ``LLM_GATEWAY_ADMIN_PASSWORD_HASH``."""
    salt = secrets.token_bytes(16)
    derived_key = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_COST,
        r=_SCRYPT_BLOCK_SIZE,
        p=_SCRYPT_PARALLELISM,
        dklen=_SCRYPT_KEY_BYTES,
        maxmem=_SCRYPT_MAX_MEMORY_BYTES,
    )
    return ":".join(
        [
            _PASSWORD_HASH_PREFIX,
            str(_SCRYPT_COST),
            str(_SCRYPT_BLOCK_SIZE),
            str(_SCRYPT_PARALLELISM),
            base64.b64encode(salt).decode("ascii"),
            base64.b64encode(derived_key).decode("ascii"),
        ]
    )


def is_valid_password_hash_format(password_hash: str) -> bool:
    """Cheap structural check used at startup so a typo fails fast, not at first login."""
    hash_parts = password_hash.split(":")
    return len(hash_parts) == 6 and hash_parts[0] == _PASSWORD_HASH_PREFIX and all(hash_parts[1:])


def verify_admin_password(password: str, password_hash: str) -> bool:
    """Return whether ``password`` matches ``password_hash`` (constant-time compare)."""
    try:
        prefix, cost, block_size, parallelism, salt_b64, expected_key_b64 = password_hash.split(":")
        if prefix != _PASSWORD_HASH_PREFIX:
            return False
        expected_key = base64.b64decode(expected_key_b64)
        derived_key = hashlib.scrypt(
            password.encode("utf-8"),
            salt=base64.b64decode(salt_b64),
            n=int(cost),
            r=int(block_size),
            p=int(parallelism),
            dklen=len(expected_key),
            maxmem=_SCRYPT_MAX_MEMORY_BYTES,
        )
    except (ValueError, binascii.Error):
        return False
    return hmac.compare_digest(derived_key, expected_key)
