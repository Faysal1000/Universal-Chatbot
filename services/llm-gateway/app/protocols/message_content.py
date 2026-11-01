"""Small helpers for reading Chat Completions JSON safely."""

from app.protocols.types import JsonObject


def optional_int(value: object) -> int | None:
    """Return ``value`` if it is an int (not bool), else ``None``."""
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def message_content_as_text(content: object) -> str:
    """Flatten Chat Completions message content (string or parts) to plain text."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            str(part.get("text", ""))
            for part in content
            if isinstance(part, dict) and part.get("type") in {"text", "input_text", "output_text"}
        )
    return str(content)


def copy_if_present(
    source: JsonObject, destination: JsonObject, source_key: str, destination_key: str
) -> None:
    """Copy ``source[source_key]`` to ``destination[destination_key]`` when set."""
    if source.get(source_key) is not None:
        destination[destination_key] = source[source_key]
