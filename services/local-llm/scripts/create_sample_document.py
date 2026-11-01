"""Create the verification document: one A4 page with headings, two columns, a table,
a formula and a Bengali paragraph, the layouts that ``document_parse`` exists for.

    python scripts/create_sample_document.py --bengali-font /path/to/kalpurush.ttf
"""

import argparse
from pathlib import Path

import pymupdf

PAGE_HTML = """
<h1>Quarterly Service Report</h1>
<p><b>Summary.</b> Requests grew steadily across both regions while latency stayed within the target.
The table below lists the main indicators, and the formula defines the availability metric.</p>
<table border="1" cellpadding="4" style="border-collapse: collapse; width: 100%;">
  <tr><th>Region</th><th>Requests</th><th>p95 latency (ms)</th><th>Availability</th></tr>
  <tr><td>Dhaka</td><td>1,204,330</td><td>182</td><td>99.95%</td></tr>
  <tr><td>Chattogram</td><td>604,118</td><td>201</td><td>99.91%</td></tr>
  <tr><td>Total</td><td>1,808,448</td><td>189</td><td>99.94%</td></tr>
</table>
<p>Availability is defined as A = (T &minus; D) / T &times; 100, where T is the total minutes in
the quarter and D is the number of minutes with failed health checks.</p>
<h2>Regional notes</h2>
<p style="font-family: bangla;">ঢাকা অঞ্চলে অনুরোধের সংখ্যা আগের প্রান্তিকের তুলনায় বারো শতাংশ বেড়েছে।
চট্টগ্রামে নতুন সার্ভার যুক্ত হওয়ায় বিলম্ব কমেছে।</p>
"""

COLUMN_TEXT = (
    "Capacity planning. The ingestion pipeline processed documents in batches of sixteen pages. "
    "Scanned pages were routed to the vision model, while digital pages used native text extraction. "
    "Average parsing time per complex page fell after the model upgrade."
)


def create_sample_document(output_path: Path, bengali_font_path: Path) -> None:
    """Write the one-page verification PDF to ``output_path``."""
    document = pymupdf.open()
    page = document.new_page(width=595, height=842)
    archive = pymupdf.Archive(str(bengali_font_path.parent))
    css = f"@font-face {{font-family: bangla; src: url({bengali_font_path.name});}} body {{font-size: 11pt;}}"
    page.insert_htmlbox(pymupdf.Rect(50, 50, 545, 560), PAGE_HTML, css=css, archive=archive)
    page.insert_htmlbox(pymupdf.Rect(50, 580, 290, 800), f"<p>{COLUMN_TEXT}</p>", css="body {font-size: 10pt;}")
    page.insert_htmlbox(pymupdf.Rect(305, 580, 545, 800), f"<p>{COLUMN_TEXT}</p>", css="body {font-size: 10pt;}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    document.save(output_path)


def main() -> None:
    """Parse arguments and create the document."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bengali-font", type=Path, required=True, help="A TTF font with Bengali glyphs")
    parser.add_argument("--output", type=Path, default=Path("tests/fixtures/sample-document.pdf"))
    arguments = parser.parse_args()
    create_sample_document(arguments.output, arguments.bengali_font)


if __name__ == "__main__":
    main()
