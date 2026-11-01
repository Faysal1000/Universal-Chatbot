"""Script-based language detection for the two supported languages, Bengali and English.

Counting scripts is deterministic, dependency-free and good enough to pick the OCR/embedding
language: the corpus is Bengali and English, so a text is ``bn`` when Bengali script dominates
its letters and ``en`` otherwise.
"""

from dataclasses import dataclass

BENGALI_LANGUAGE_TAG = "bn"
ENGLISH_LANGUAGE_TAG = "en"
BENGALI_SCRIPT_FIRST_CODE_POINT = 0x0980
BENGALI_SCRIPT_LAST_CODE_POINT = 0x09FF
BENGALI_DOMINANCE_THRESHOLD = 0.5


@dataclass(frozen=True, slots=True)
class ScriptCharacterCounts:
    """Letters seen in a text, split into Bengali script and every other script."""

    bengali_characters: int = 0
    other_letters: int = 0

    def __add__(self, other: "ScriptCharacterCounts") -> "ScriptCharacterCounts":
        return ScriptCharacterCounts(
            bengali_characters=self.bengali_characters + other.bengali_characters,
            other_letters=self.other_letters + other.other_letters,
        )

    @property
    def total(self) -> int:
        return self.bengali_characters + self.other_letters


def count_script_characters(text: str) -> ScriptCharacterCounts:
    """Count Bengali-block characters (incl. vowel signs) and letters of other scripts."""
    bengali_characters = sum(1 for character in text if is_bengali_character(character))
    other_letters = sum(
        1 for character in text if character.isalpha() and not is_bengali_character(character)
    )
    return ScriptCharacterCounts(bengali_characters=bengali_characters, other_letters=other_letters)


def detect_language_from_counts(counts: ScriptCharacterCounts) -> str | None:
    """``bn`` when Bengali dominates, ``en`` for any other letters, ``None`` without letters."""
    if counts.total == 0:
        return None
    if counts.bengali_characters / counts.total > BENGALI_DOMINANCE_THRESHOLD:
        return BENGALI_LANGUAGE_TAG
    return ENGLISH_LANGUAGE_TAG


def detect_language(text: str | None) -> str | None:
    if not text:
        return None
    return detect_language_from_counts(count_script_characters(text))


def is_bengali_character(character: str) -> bool:
    return BENGALI_SCRIPT_FIRST_CODE_POINT <= ord(character) <= BENGALI_SCRIPT_LAST_CODE_POINT
