"""Persist deployment specs to one JSON file so admin deployments survive restarts."""

import json
import logging
import os
import tempfile
from pathlib import Path

from pydantic import TypeAdapter, ValidationError

from app.deployments.models import DeploymentSpec

logger = logging.getLogger(__name__)

STATE_FILE_NAME = "deployments.json"
STATE_FORMAT_VERSION = 1
_SPEC_LIST_ADAPTER = TypeAdapter(list[DeploymentSpec])


class DeploymentStore:
    """Atomic read/write of every :class:`DeploymentSpec` (write to a temp file, then rename)."""

    def __init__(self, state_directory: Path) -> None:
        self._state_file = state_directory / STATE_FILE_NAME

    def load_all(self) -> list[DeploymentSpec]:
        """Every stored spec; an absent file means a fresh install."""
        if not self._state_file.exists():
            return []
        try:
            stored_state = json.loads(self._state_file.read_text(encoding="utf-8"))
            return _SPEC_LIST_ADAPTER.validate_python(stored_state["deployments"])
        except (OSError, KeyError, ValueError, ValidationError) as error:
            # Starting with an empty list would silently forget every admin deployment.
            raise RuntimeError(f"Deployment state file {self._state_file} is unreadable: {error}") from error

    def save_all(self, specs: list[DeploymentSpec]) -> None:
        """Replace the stored specs atomically, so a crash never leaves a half-written file."""
        self._state_file.parent.mkdir(parents=True, exist_ok=True)
        serialised_state = json.dumps(
            {
                "version": STATE_FORMAT_VERSION,
                "deployments": [spec.model_dump(mode="json") for spec in specs],
            },
            indent=2,
        )
        file_descriptor, temporary_path = tempfile.mkstemp(dir=self._state_file.parent, prefix=".deployments-")
        try:
            with os.fdopen(file_descriptor, "w", encoding="utf-8") as temporary_file:
                temporary_file.write(serialised_state)
                temporary_file.flush()
                os.fsync(temporary_file.fileno())
            os.replace(temporary_path, self._state_file)
        except BaseException:
            Path(temporary_path).unlink(missing_ok=True)
            raise
