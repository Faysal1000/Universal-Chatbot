from app.domain.geometry import Rectangle
from app.domain.ocr_layout import OcrWord, group_words_into_text_boxes, score_ocr_quality


def a_word(text: str, paragraph: int, line: int, left: float, confidence: float = 90.0) -> OcrWord:
    return OcrWord(
        text=text,
        confidence=confidence,
        rectangle=Rectangle(left, line * 50, left + 80, line * 50 + 30),
        block_number=1,
        paragraph_number=paragraph,
        line_number=line,
    )


def test_words_group_into_paragraph_boxes_and_lines() -> None:
    words = [
        a_word("Hello", 1, 1, 0),
        a_word("world", 1, 1, 100),
        a_word("again", 1, 2, 0),
        a_word("Next", 2, 1, 0),
    ]

    boxes = group_words_into_text_boxes(words)

    assert [[line.text for line in box.lines] for box in boxes] == [["Hello world", "again"], ["Next"]]
    assert boxes[0].lines[0].rectangle == Rectangle(0, 50, 180, 80)
    assert boxes[0].lines[0].size == 30


def test_quality_is_mean_confidence_as_a_fraction() -> None:
    assert score_ocr_quality([a_word("a", 1, 1, 0, 80), a_word("b", 1, 1, 0, 100)]) == 0.9


def test_quality_ignores_unscored_words_and_is_none_without_words() -> None:
    assert score_ocr_quality([a_word("a", 1, 1, 0, -1)]) is None
    assert score_ocr_quality([]) is None
