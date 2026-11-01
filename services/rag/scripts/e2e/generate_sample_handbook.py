"""Generates test/fixtures/sample-handbook.pdf, the document of the end-to-end run.

Page 1 is plain digital text, page 2 mixes two columns, a table and a formula (routed to
Nemotron Parse), page 3 is a scanned image of text (no text layer).

Run with any Python that has reportlab and Pillow, e.g. the document-parser virtualenv:
    ../document-parser/.venv/bin/python scripts/e2e/generate_sample_handbook.py
"""

import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

OUTPUT_PATH = Path(__file__).resolve().parents[2] / "test" / "fixtures" / "sample-handbook.pdf"
PAGE_WIDTH, PAGE_HEIGHT = A4


def write_paragraph(
    pdf: canvas.Canvas, text: str, x: float, y: float, width_chars: int, size: int = 11
) -> float:
    pdf.setFont("Helvetica", size)
    words, line = text.split(), ""
    for word in words:
        if len(line) + len(word) + 1 > width_chars:
            pdf.drawString(x, y, line)
            y -= size * 1.45
            line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        pdf.drawString(x, y, line)
        y -= size * 1.45
    return y - size * 0.6


def first_page(pdf: canvas.Canvas) -> None:
    pdf.setFont("Helvetica-Bold", 20)
    pdf.drawString(2 * cm, PAGE_HEIGHT - 3 * cm, "Acme Analytics Employee Handbook")
    y = PAGE_HEIGHT - 4.5 * cm
    sections = [
        (
            "1 Annual leave",
            "Every full-time employee receives 24 working days of paid annual leave per calendar year. "
            "Up to 5 unused days may be carried over to the next year and must be used before 31 March.",
        ),
        (
            "2 Remote work",
            "Employees may work remotely on Tuesdays and Thursdays. Fully remote arrangements need "
            "written approval from the department head and are reviewed every six months.",
        ),
        (
            "3 Office hours",
            "The Dhaka office is open from 9:00 to 17:30, Sunday to Thursday. Core collaboration "
            "hours are 11:00 to 15:00, when everyone is expected to be reachable.",
        ),
        (
            "4 Probation",
            "New employees serve a probation period of six months. During probation the notice period "
            "is two weeks; after confirmation it is one month.",
        ),
    ]
    for heading, body in sections:
        pdf.setFont("Helvetica-Bold", 14)
        pdf.drawString(2 * cm, y, heading)
        y = write_paragraph(pdf, body, 2 * cm, y - 18, 90)
    pdf.showPage()


def second_page(pdf: canvas.Canvas) -> None:
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(2 * cm, PAGE_HEIGHT - 2.5 * cm, "5 Travel and expenses")
    left = (
        "Business travel must be booked through the travel desk at least seven days in advance. Economy class "
        "is used for flights shorter than six hours; business class needs director approval."
    )
    right = (
        "Receipts must be submitted within 30 days of the trip. Claims without receipts are not reimbursed, "
        "except taxi fares below 500 BDT, which may be declared in the expense form."
    )
    write_paragraph(pdf, left, 2 * cm, PAGE_HEIGHT - 3.6 * cm, 42, 10)
    write_paragraph(pdf, right, 11 * cm, PAGE_HEIGHT - 3.6 * cm, 42, 10)

    table_top = PAGE_HEIGHT - 8 * cm
    rows = [
        ("Expense", "Daily limit (BDT)", "Approval"),
        ("Hotel, Dhaka", "9,000", "Manager"),
        ("Hotel, outside Dhaka", "6,500", "Manager"),
        ("Meals", "2,500", "None"),
        ("International per diem", "USD 60", "Director"),
    ]
    column_x = [2 * cm, 8 * cm, 13 * cm]
    for row_index, row in enumerate(rows):
        y = table_top - row_index * 0.9 * cm
        pdf.setFont("Helvetica-Bold" if row_index == 0 else "Helvetica", 10)
        for column_index, cell in enumerate(row):
            pdf.drawString(column_x[column_index] + 4, y + 8, cell)
        pdf.line(2 * cm, y, 18 * cm, y)
    pdf.line(2 * cm, table_top + 0.9 * cm, 18 * cm, table_top + 0.9 * cm)
    for x in [*column_x, 18 * cm]:
        pdf.line(x, table_top + 0.9 * cm, x, table_top - (len(rows) - 1) * 0.9 * cm)

    pdf.setFont("Helvetica-Bold", 14)
    pdf.drawString(2 * cm, PAGE_HEIGHT - 15 * cm, "6 Overtime")
    write_paragraph(
        pdf,
        "Overtime is paid at one and a half times the hourly rate, computed as:",
        2 * cm,
        PAGE_HEIGHT - 16 * cm,
        90,
    )
    pdf.setFont("Times-Italic", 14)
    pdf.drawString(5 * cm, PAGE_HEIGHT - 17.5 * cm, "P = 1.5 × (S / 160) × H")
    write_paragraph(
        pdf,
        "where S is the monthly base salary and H the approved overtime hours.",
        2 * cm,
        PAGE_HEIGHT - 18.7 * cm,
        90,
    )
    pdf.showPage()


def third_page(pdf: canvas.Canvas) -> None:
    """A page that is only a picture of text, as a scanner would produce."""
    image = Image.new("L", (1240, 1754), color=245)
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 34)
        heading_font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 44)
    except OSError:
        font = heading_font = ImageFont.load_default()
    draw.text((120, 140), "7 Health insurance", fill=20, font=heading_font)
    lines = [
        "All confirmed employees are covered by group health insurance",
        "from Green Delta Insurance. The annual coverage limit is",
        "300,000 BDT per employee, including spouse and up to two",
        "children. Claims are submitted through the HR portal within",
        "15 days of discharge from hospital.",
    ]
    for index, line in enumerate(lines):
        draw.text((120, 240 + index * 60), line, fill=30, font=font)
    image = image.rotate(0.6, fillcolor=245)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    pdf.drawImage(ImageReader(buffer), 0, 0, width=PAGE_WIDTH, height=PAGE_HEIGHT)
    pdf.showPage()


def main() -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(OUTPUT_PATH), pagesize=A4)
    pdf.setTitle("Acme Analytics Employee Handbook")
    first_page(pdf)
    second_page(pdf)
    third_page(pdf)
    pdf.save()
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
