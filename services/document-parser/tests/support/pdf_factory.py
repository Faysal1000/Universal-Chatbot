"""Builds realistic test PDFs and images with reportlab and Pillow (no network, no fixtures on disk)."""

import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle

BENGALI_FONT_CANDIDATES = (
    Path("/usr/share/fonts/truetype/noto/NotoSansBengali-Regular.ttf"),
    Path("/usr/share/fonts/truetype/lohit-bengali/Lohit-Bengali.ttf"),
    Path("/System/Library/Fonts/Supplemental/Bangla Sangam MN.ttc"),
    Path("/System/Library/Fonts/KohinoorBangla.ttc"),
)
BENGALI_SENTENCE = "ঢাকা অঞ্চলে বিক্রয় বৃদ্ধি পেয়েছে এবং গ্রাহক সন্তুষ্টি বেড়েছে"
BODY_TEXT = (
    "Our service grew steadily throughout the year. Customers adopted the new plans quickly, "
    "and support response times improved in every region. "
)


def build_report_pdf() -> bytes:
    """Page 1: title, section heading, paragraphs, a bullet list and a ruled pricing table."""
    styles = getSampleStyleSheet()
    pricing_table = Table(
        [
            ["Plan", "Monthly price", "Seats"],
            ["Starter", "$19", "1"],
            ["Business", "$49", "10"],
            ["Enterprise", "$99", "100"],
        ]
    )
    pricing_table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black)]))
    story = [
        Paragraph("Quarterly Service Report", styles["Title"]),
        Paragraph("Introduction", styles["Heading2"]),
        Paragraph(BODY_TEXT * 3, styles["BodyText"]),
        Paragraph("• Faster onboarding for new customers", styles["BodyText"]),
        Paragraph("• Lower churn in the business segment", styles["BodyText"]),
        Spacer(1, 12),
        pricing_table,
        Paragraph("Outlook", styles["Heading2"]),
        Paragraph(BODY_TEXT * 2, styles["BodyText"]),
    ]
    return _build_single_column(story)


def build_two_column_pdf() -> bytes:
    styles = getSampleStyleSheet()
    buffer = io.BytesIO()
    page_width, page_height = A4
    column_width = (page_width - 3 * 54) / 2
    frames = [
        Frame(54, 54, column_width, page_height - 108, id="left"),
        Frame(54 * 2 + column_width, 54, column_width, page_height - 108, id="right"),
    ]
    document = BaseDocTemplate(
        buffer, pagesize=A4, pageTemplates=[PageTemplate(id="two-columns", frames=frames)]
    )
    document.build([Paragraph(BODY_TEXT * 4, styles["BodyText"]) for _ in range(6)])
    return buffer.getvalue()


def build_formula_pdf() -> bytes:
    buffer = io.BytesIO()
    pdf_canvas = canvas.Canvas(buffer, pagesize=A4)
    pdf_canvas.setFont("Helvetica", 12)
    pdf_canvas.drawString(72, 760, "The energy of the system satisfies the following relation for every x:")
    pdf_canvas.drawString(
        72, 730, "\u2200x \u2208 X: \u2211 f(x) \u2264 \u222b g(x) dx and \u2202f/\u2202x \u2260 0"
    )
    pdf_canvas.showPage()
    pdf_canvas.save()
    return buffer.getvalue()


def build_bar_chart_pdf() -> bytes:
    buffer = io.BytesIO()
    pdf_canvas = canvas.Canvas(buffer, pagesize=A4)
    pdf_canvas.setFont("Helvetica", 10)
    pdf_canvas.drawString(72, 780, "Revenue by year")
    for index, (label, height) in enumerate((("2021", 120), ("2022", 180), ("2023", 240), ("2024", 300))):
        left = 100 + index * 80
        pdf_canvas.rect(left, 400, 40, height, fill=1)
        pdf_canvas.drawString(left + 5, 385, label)
    pdf_canvas.line(90, 400, 440, 400)
    pdf_canvas.showPage()
    pdf_canvas.save()
    return buffer.getvalue()


def build_bengali_pdf() -> bytes | None:
    """A digital page whose text layer is Bengali, or ``None`` when no Bengali font is installed."""
    font_path = next((path for path in BENGALI_FONT_CANDIDATES if path.exists()), None)
    if font_path is None:
        return None
    pdfmetrics.registerFont(TTFont("TestBengali", str(font_path), subfontIndex=0))
    buffer = io.BytesIO()
    pdf_canvas = canvas.Canvas(buffer, pagesize=A4)
    pdf_canvas.setFont("TestBengali", 14)
    for line_index in range(5):
        pdf_canvas.drawString(72, 760 - line_index * 24, BENGALI_SENTENCE)
    pdf_canvas.showPage()
    pdf_canvas.save()
    return buffer.getvalue()


def build_text_image(
    lines: list[str], size: tuple[int, int] = (1654, 2339), font_size: int = 40
) -> Image.Image:
    """A white A4 page at 200 DPI with black text, like a scanned letter."""
    image = Image.new("RGB", size, "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=font_size)
    for line_index, line in enumerate(lines):
        draw.text((150, 200 + line_index * int(font_size * 1.6)), line, fill="black", font=font)
    return image


def encode_image(image: Image.Image, image_format: str, **save_options: object) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format=image_format, **save_options)
    return buffer.getvalue()


def build_scanned_pdf(lines: list[str]) -> bytes:
    """An image-only page (no text layer), as produced by a scanner without OCR."""
    image = build_text_image(lines)
    return encode_image(image, "PDF", resolution=200.0)


def build_encrypted_pdf() -> bytes:
    buffer = io.BytesIO()
    pdf_canvas = canvas.Canvas(buffer, pagesize=A4, encrypt="user-password")
    pdf_canvas.drawString(72, 760, "Confidential")
    pdf_canvas.showPage()
    pdf_canvas.save()
    return buffer.getvalue()


def build_multi_page_pdf(page_count: int) -> bytes:
    buffer = io.BytesIO()
    pdf_canvas = canvas.Canvas(buffer, pagesize=A4)
    for page_index in range(page_count):
        pdf_canvas.drawString(72, 760, f"Page {page_index + 1} of the appendix with enough words to read.")
        pdf_canvas.showPage()
    pdf_canvas.save()
    return buffer.getvalue()


def _build_single_column(story: list[object]) -> bytes:
    from reportlab.platypus import SimpleDocTemplate

    buffer = io.BytesIO()
    SimpleDocTemplate(buffer, pagesize=A4).build(story)
    return buffer.getvalue()
