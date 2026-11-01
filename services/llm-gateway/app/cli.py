"""Operator commands that need no running server.

python -m app.cli hash-password          # prompts twice, prints LLM_GATEWAY_ADMIN_PASSWORD_HASH
python -m app.cli generate-secrets       # prints fresh keys, secrets and database passwords
"""

import argparse
import getpass
import secrets
import sys

from cryptography.fernet import Fernet

from app.security.admin_passwords import hash_admin_password

MINIMUM_ADMIN_PASSWORD_LENGTH = 12


def _hash_password_command() -> int:
    password = getpass.getpass("Admin password: ")
    if len(password) < MINIMUM_ADMIN_PASSWORD_LENGTH:
        print(f"Password must be at least {MINIMUM_ADMIN_PASSWORD_LENGTH} characters.", file=sys.stderr)
        return 1
    if getpass.getpass("Repeat password: ") != password:
        print("Passwords do not match.", file=sys.stderr)
        return 1
    print(f"LLM_GATEWAY_ADMIN_PASSWORD_HASH={hash_admin_password(password)}")
    return 0


def _generate_secrets_command() -> int:
    print(f"LLM_GATEWAY_API_KEY={secrets.token_urlsafe(48)}")
    print(f"LLM_GATEWAY_REGISTRATION_API_KEY={secrets.token_urlsafe(48)}")
    print(f"LLM_GATEWAY_ADMIN_SESSION_SECRET={secrets.token_urlsafe(48)}")
    print(f"LLM_GATEWAY_ENCRYPTION_KEY={Fernet.generate_key().decode('ascii')}")
    # URL-safe, so they can be embedded in LLM_GATEWAY_DATABASE_URL without escaping.
    print(f"LLM_GATEWAY_DATABASE_PASSWORD={secrets.token_urlsafe(32)}")
    print(f"LLM_GATEWAY_POSTGRES_SUPERUSER_PASSWORD={secrets.token_urlsafe(32)}")
    return 0


def main(arguments: list[str] | None = None) -> int:
    """Parse ``arguments`` and run the chosen command; returns the exit code."""
    argument_parser = argparse.ArgumentParser(prog="python -m app.cli", description=__doc__)
    command_parsers = argument_parser.add_subparsers(dest="command", required=True)
    command_parsers.add_parser("hash-password", help="Hash the admin password for the .env file")
    command_parsers.add_parser("generate-secrets", help="Generate API key, session secret and encryption key")
    parsed_arguments = argument_parser.parse_args(arguments)
    if parsed_arguments.command == "hash-password":
        return _hash_password_command()
    return _generate_secrets_command()


if __name__ == "__main__":
    sys.exit(main())
