"""Every ``examples`` entry of the shared JSON Schemas validates against the generated models."""

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel

from app.contracts.generated.block_manifest_record_v1 import BlockManifestRecord
from app.contracts.generated.job_envelope_v1 import JobEnvelope
from app.contracts.generated.parse_inspect_v1 import ParseInspectPayload, ParseInspectResult
from app.contracts.generated.parse_pages_v1 import ParsePagesPayload, ParsePagesResult

SERVICE_DIRECTORY = Path(__file__).resolve().parents[2]
CONTRACTS_DIRECTORY = SERVICE_DIRECTORY.parent / "rag" / "contracts"


def load_examples(schema_file_name: str) -> list[dict[str, Any]]:
    schema = json.loads((CONTRACTS_DIRECTORY / schema_file_name).read_text(encoding="utf-8"))
    examples: list[dict[str, Any]] = schema["examples"]
    assert examples, f"{schema_file_name} has no examples"
    return examples


EXAMPLE_CASES: list[tuple[str, str | None, type[BaseModel]]] = [
    ("job-envelope.v1.schema.json", None, JobEnvelope),
    ("block-manifest-record.v1.schema.json", None, BlockManifestRecord),
    ("parse-inspect.v1.schema.json", "payload", ParseInspectPayload),
    ("parse-inspect.v1.schema.json", "result", ParseInspectResult),
    ("parse-pages.v1.schema.json", "payload", ParsePagesPayload),
    ("parse-pages.v1.schema.json", "result", ParsePagesResult),
]


@pytest.mark.parametrize(("schema_file_name", "example_part", "model"), EXAMPLE_CASES)
def test_schema_examples_validate(
    schema_file_name: str, example_part: str | None, model: type[BaseModel]
) -> None:
    for example in load_examples(schema_file_name):
        instance = example[example_part] if example_part else example

        validated = model.model_validate(instance)

        assert model.model_validate(validated.model_dump(mode="json")) == validated


def test_unknown_fields_are_rejected() -> None:
    record = load_examples("block-manifest-record.v1.schema.json")[0] | {"unexpected": True}

    with pytest.raises(ValueError, match="unexpected"):
        BlockManifestRecord.model_validate(record)


def test_generated_models_match_the_contracts() -> None:
    completed = subprocess.run(
        [sys.executable, "scripts/generate_contract_models.py", "--check"],
        cwd=SERVICE_DIRECTORY,
        capture_output=True,
        text=True,
        check=False,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr
