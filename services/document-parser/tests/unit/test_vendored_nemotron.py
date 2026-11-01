"""The vendored NVIDIA post-processing code must stay byte-identical to the pinned revision."""

import hashlib
from pathlib import Path

VENDOR_DIRECTORY = Path(__file__).resolve().parents[2] / "app" / "adapters" / "vendor" / "nemotron_parse"


def read_recorded_checksums() -> dict[str, str]:
    lines = (VENDOR_DIRECTORY / "SHA256SUMS").read_text(encoding="utf-8").splitlines()
    return {path: digest for digest, path in (line.split("  ", 1) for line in lines if line.strip())}


def test_every_vendored_file_matches_its_recorded_sha256() -> None:
    recorded_checksums = read_recorded_checksums()

    actual_checksums = {
        path: hashlib.sha256((VENDOR_DIRECTORY / path).read_bytes()).hexdigest()
        for path in recorded_checksums
    }

    assert actual_checksums == recorded_checksums


def test_no_unrecorded_python_files_are_vendored() -> None:
    vendored_python_files = {
        str(path.relative_to(VENDOR_DIRECTORY)) for path in VENDOR_DIRECTORY.rglob("*.py")
    }

    assert vendored_python_files <= set(read_recorded_checksums())


def test_licence_is_shipped_with_the_code() -> None:
    assert "OpenMDW" in (VENDOR_DIRECTORY / "LICENSE").read_text(encoding="utf-8")
