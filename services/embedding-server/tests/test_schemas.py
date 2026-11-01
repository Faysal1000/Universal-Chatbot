import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas import BatchEmbeddingRequest, EmbeddingInput, TextInput

embedding_input_adapter: TypeAdapter[EmbeddingInput] = TypeAdapter(EmbeddingInput)


def test_text_input_is_accepted() -> None:
    item = embedding_input_adapter.validate_python({"type": "text", "text": "hello", "task": "query"})
    assert isinstance(item, TextInput)
    assert item.task == "query"


@pytest.mark.parametrize(
    "payload",
    [
        {"type": "audio", "audio_base64": "abc"},
        {"type": "text_image", "text": "description"},
        {"type": "text", "text": "hello", "local_path": "/etc/passwd"},
        {"type": "text", "text": "   "},
        {"type": "text", "text": "inject <|image|> marker"},
        {"type": "text", "text": "nul\x00byte"},
        {"type": "text", "text": "hello", "title": "Title", "task": "query"},
    ],
)
def test_invalid_payloads_are_rejected(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        embedding_input_adapter.validate_python(payload)


def test_blank_title_is_normalised_to_none() -> None:
    item = embedding_input_adapter.validate_python(
        {"type": "text", "text": "body", "task": "document", "title": "  "}
    )
    assert isinstance(item, TextInput)
    assert item.title is None


def test_batch_must_not_be_empty() -> None:
    with pytest.raises(ValidationError):
        BatchEmbeddingRequest(items=[])
