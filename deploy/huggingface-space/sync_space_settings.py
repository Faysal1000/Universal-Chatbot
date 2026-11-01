"""Writes the Space's secrets and variables from the workflow environment, so GitHub is their only source.

Every deploy sets all secrets (a missing one fails the deploy) and every variable; a variable that
is unset in GitHub is removed from the Space.
"""

import os

from huggingface_hub import HfApi

SECRET_NAMES = (
    "DATABASE_URL",
    "S3_ENDPOINT",
    "S3_REGION",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "LLM_GATEWAY_ENCRYPTION_KEY",
    "RAG_CLIENT_HASH_SECRET",
    "ADMIN_CONSOLE_ADMIN_PASSWORD_HASH",
    "HF_TOKEN",
)

VARIABLE_NAMES = (
    "ADMIN_CONSOLE_ADMIN_USERNAME",
    "CHAT_WIDGET_ALLOWED_ORIGINS",
    "CHAT_RUNTIME_BOT_NAME",
    "CHAT_RUNTIME_BRAND_ACCENT",
    "CHAT_RUNTIME_BRAND_LOGO_URL",
)


def main() -> None:
    space = os.environ["SPACE"]
    hub = HfApi(token=os.environ["HF_DEPLOY_TOKEN"])
    missing_secrets = [name for name in SECRET_NAMES if not os.environ.get(name)]
    if missing_secrets:
        raise SystemExit(f"Set these GitHub secrets first: {', '.join(missing_secrets)}")
    for name in SECRET_NAMES:
        hub.add_space_secret(space, name, os.environ[name])
        print(f"secret {name} set")
    space_variables = hub.get_space_variables(space)
    for name in VARIABLE_NAMES:
        if value := os.environ.get(name):
            hub.add_space_variable(space, name, value)
            print(f"variable {name} set")
        elif name in space_variables:
            hub.delete_space_variable(space, name)
            print(f"variable {name} removed")


if __name__ == "__main__":
    main()
