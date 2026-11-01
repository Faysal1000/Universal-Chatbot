"""Vendor (or verify) NVIDIA's Nemotron Parse post-processing code at a pinned revision.

The files are copied unmodified from the Hugging Face repository ``nvidia/Nemotron-3.5-Parse``
(OpenMDW-1.1, which permits redistribution when the licence and notices are retained).
``SHA256SUMS`` records the digest of every vendored file; ``tests/unit/test_vendored_nemotron.py``
fails if a vendored file is edited locally.

Usage:
    python scripts/vendor_nemotron_postprocessing.py --write    # download and (re)vendor
    python scripts/vendor_nemotron_postprocessing.py --verify   # compare against the remote revision
"""

import argparse
import hashlib
import sys
from pathlib import Path

import httpx

REPOSITORY = "nvidia/Nemotron-3.5-Parse"
REVISION = "4035ffb1d8f8bafcdb867dfaf6f7514f101464f9"
SOURCE_DIRECTORY = "nemotron_parse"
VENDORED_FILES = (
    "__init__.py",
    "postprocessing.py",
    "tables.py",
    "engine/__init__.py",
    "engine/markdown.py",
    "engine/policies.py",
    "engine/header_inference_probe.py",
    "engine/text_cleanup.py",
    "engine/chart_caption.py",
    "engine/chart_context.py",
    "engine/caption_relocation.py",
    "engine/convert/__init__.py",
    "engine/convert/latex2html.py",
    "engine/convert/rich_table_reader.py",
    "engine/convert/rich_table_fallback.py",
    "engine/convert/hybrid_inline.py",
    "engine/convert/hybrid_cleanup.py",
    "engine/convert/semantic_styles.py",
)
LICENSE_FILE = "LICENSE"
VENDOR_DIRECTORY = Path(__file__).resolve().parent.parent / "app" / "adapters" / "vendor" / "nemotron_parse"
CHECKSUM_FILE = VENDOR_DIRECTORY / "SHA256SUMS"
DOWNLOAD_TIMEOUT_SECONDS = 30


def build_download_url(repository_path: str) -> str:
    return f"https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{repository_path}"


def download_file(client: httpx.Client, repository_path: str) -> bytes:
    response = client.get(build_download_url(repository_path), follow_redirects=True)
    response.raise_for_status()
    return response.content


def sha256_hex(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def remote_files(client: httpx.Client) -> dict[str, bytes]:
    files = {
        vendored_path: download_file(client, f"{SOURCE_DIRECTORY}/{vendored_path}")
        for vendored_path in VENDORED_FILES
    }
    files[LICENSE_FILE] = download_file(client, LICENSE_FILE)
    return files


def write_vendored_files(files: dict[str, bytes]) -> None:
    for vendored_path, content in files.items():
        destination = VENDOR_DIRECTORY / vendored_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
    checksum_lines = [f"{sha256_hex(content)}  {path}" for path, content in sorted(files.items())]
    CHECKSUM_FILE.write_text("\n".join(checksum_lines) + "\n", encoding="utf-8")


def find_mismatches(files: dict[str, bytes]) -> list[str]:
    return [
        vendored_path
        for vendored_path, content in files.items()
        if not (VENDOR_DIRECTORY / vendored_path).is_file()
        or (VENDOR_DIRECTORY / vendored_path).read_bytes() != content
    ]


def main() -> int:
    argument_parser = argparse.ArgumentParser(description=__doc__)
    mode = argument_parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true", help="download and vendor the pinned files")
    mode.add_argument("--verify", action="store_true", help="compare vendored files with the remote")
    arguments = argument_parser.parse_args()

    with httpx.Client(timeout=DOWNLOAD_TIMEOUT_SECONDS) as client:
        files = remote_files(client)
    if arguments.write:
        write_vendored_files(files)
        print(f"Vendored {len(files)} files from {REPOSITORY}@{REVISION}")
        return 0
    mismatches = find_mismatches(files)
    if mismatches:
        print(f"Vendored files differ from {REPOSITORY}@{REVISION}: {', '.join(mismatches)}")
        return 1
    print(f"All {len(files)} vendored files match {REPOSITORY}@{REVISION}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
