"""Render one PDF page to a PNG and/or a ``data:image/png;base64,...`` URI file.

The document-parser sends pages to ``document_parse`` exactly like this.

    python scripts/render_page.py tests/fixtures/sample-document.pdf --page 1 --dpi 150 \
        --png /tmp/page.png --data-uri /tmp/page.datauri
"""

import argparse
import base64
from pathlib import Path

import pymupdf


def render_page_png(pdf_path: Path, page_number: int, dots_per_inch: int) -> bytes:
    """PNG bytes of the 1-based ``page_number`` rendered at ``dots_per_inch``."""
    with pymupdf.open(pdf_path) as document:
        pixmap = document[page_number - 1].get_pixmap(dpi=dots_per_inch)
        png_bytes: bytes = pixmap.tobytes("png")
        return png_bytes


def main() -> None:
    """Parse arguments, render, and write the requested outputs."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--dpi", type=int, default=150)
    parser.add_argument("--png", type=Path)
    parser.add_argument("--data-uri", type=Path)
    arguments = parser.parse_args()

    png_bytes = render_page_png(arguments.pdf, arguments.page, arguments.dpi)
    if arguments.png:
        arguments.png.write_bytes(png_bytes)
    if arguments.data_uri:
        arguments.data_uri.write_text("data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii"))


if __name__ == "__main__":
    main()
