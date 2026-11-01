"""Write the OpenAPI contract of the admin and inference APIs to ``contracts/local-llm.openapi.json``.

The admin console generates its TypeScript types from a copy of this file; regenerate it whenever a
route or schema changes (``tests/test_contract.py`` fails until you do):

    python -m scripts.export_openapi
"""

import json
import tempfile
from pathlib import Path
from typing import Any

from app.config import Settings
from app.main import create_app

CONTRACT_PATH = Path(__file__).resolve().parent.parent / "contracts" / "local-llm.openapi.json"
# Placeholders only build the app; the schema does not depend on them.
PLACEHOLDER_INFERENCE_KEY = "contract-export-inference-key-placeholder"
PLACEHOLDER_ADMIN_KEY = "contract-export-admin-key-placeholder-0000"


def build_openapi_document() -> dict[str, Any]:
    """The OpenAPI document exactly as the running service serves it."""
    with tempfile.TemporaryDirectory() as state_directory:
        settings = Settings(
            _env_file=None,
            inference_api_key=PLACEHOLDER_INFERENCE_KEY,
            admin_api_key=PLACEHOLDER_ADMIN_KEY,
            state_directory=Path(state_directory),
        )
        return create_app(settings).openapi()


def render_contract(document: dict[str, Any]) -> str:
    """Stable, diff-friendly JSON."""
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def main() -> None:
    """Regenerate the contract file."""
    CONTRACT_PATH.write_text(render_contract(build_openapi_document()), encoding="utf-8")
    print(f"Wrote {CONTRACT_PATH}")


if __name__ == "__main__":
    main()
