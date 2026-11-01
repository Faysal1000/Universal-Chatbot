import pytest
from PIL import Image

from app.adapters.image_conversion import PillowImageToPdfConverter
from app.adapters.pdfium_document import PdfiumOpener
from app.domain.errors import FailureCode, PermanentJobError
from tests.support.pdf_factory import build_text_image, encode_image

CONVERTER = PillowImageToPdfConverter(maximum_image_pixels=50_000_000)


def page_sizes(pdf_bytes: bytes) -> list[tuple[float, float]]:
    with PdfiumOpener().open_document(pdf_bytes) as document:
        return [
            (snapshot.page_size.width, snapshot.page_size.height)
            for snapshot in (document.inspect_page(number) for number in range(1, document.page_count + 1))
        ]


def test_png_with_dpi_becomes_a_page_of_matching_size() -> None:
    png = encode_image(build_text_image(["Hello"], size=(1700, 2200)), "PNG", dpi=(200, 200))

    [(width, height)] = page_sizes(CONVERTER.convert_to_pdf(png, maximum_pages=5))

    assert (round(width), round(height)) == (612, 792)


def test_jpeg_without_dpi_gets_an_a4_height() -> None:
    jpeg = encode_image(Image.new("RGB", (800, 1169), "white"), "JPEG")

    [(_, height)] = page_sizes(CONVERTER.convert_to_pdf(jpeg, maximum_pages=5))

    assert round(height) == 842


def test_multi_frame_tiff_becomes_one_page_per_frame() -> None:
    frames = [Image.new("L", (400, 600), shade) for shade in (255, 200, 150)]
    tiff = encode_image(frames[0], "TIFF", save_all=True, append_images=frames[1:])

    assert len(page_sizes(CONVERTER.convert_to_pdf(tiff, maximum_pages=5))) == 3


def test_too_many_frames_fail_permanently() -> None:
    frames = [Image.new("1", (100, 100)) for _ in range(3)]
    tiff = encode_image(frames[0], "TIFF", save_all=True, append_images=frames[1:])

    with pytest.raises(PermanentJobError) as raised:
        CONVERTER.convert_to_pdf(tiff, maximum_pages=2)

    assert raised.value.code is FailureCode.TOO_MANY_PAGES


def test_oversized_image_fails_permanently() -> None:
    png = encode_image(Image.new("RGB", (2000, 2000)), "PNG")

    with pytest.raises(PermanentJobError) as raised:
        PillowImageToPdfConverter(maximum_image_pixels=1_000_000).convert_to_pdf(png, maximum_pages=1)

    assert raised.value.code is FailureCode.SOURCE_TOO_LARGE


def test_garbage_bytes_fail_as_corrupt() -> None:
    with pytest.raises(PermanentJobError) as raised:
        CONVERTER.convert_to_pdf(b"not an image", maximum_pages=1)

    assert raised.value.code is FailureCode.CORRUPT_DOCUMENT
