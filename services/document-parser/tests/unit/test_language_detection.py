import pytest

from app.domain.language_detection import (
    ScriptCharacterCounts,
    count_script_characters,
    detect_language,
    detect_language_from_counts,
)


@pytest.mark.parametrize(
    ("text", "expected_language"),
    [
        ("Quarterly service report", "en"),
        ("ঢাকা অঞ্চলে বিক্রয় বৃদ্ধি পেয়েছে", "bn"),
        ("ঢাকা অঞ্চলে বিক্রয় বৃদ্ধি (sales grew)", "bn"),
        ("Revenue grew in ঢাকা this year across all regions", "en"),
        ("12345 — 67 %", None),
        ("", None),
        (None, None),
    ],
)
def test_detects_dominant_script(text: str | None, expected_language: str | None) -> None:
    assert detect_language(text) == expected_language


def test_bengali_vowel_signs_count_as_bengali() -> None:
    counts = count_script_characters("কি")  # consonant + vowel sign (a combining mark)

    assert counts == ScriptCharacterCounts(bengali_characters=2, other_letters=0)


def test_counts_add_up_across_pages() -> None:
    total = count_script_characters("abc") + count_script_characters("কখগঘঙ")

    assert detect_language_from_counts(total) == "bn"


def test_exactly_half_bengali_is_english() -> None:
    assert detect_language_from_counts(ScriptCharacterCounts(bengali_characters=5, other_letters=5)) == "en"
