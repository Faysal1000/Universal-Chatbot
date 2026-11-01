"""Object keys the parser writes; all live under the run's ``outputPrefix`` so retries overwrite."""

from uuid import UUID


def converted_source_key(output_prefix: str) -> str:
    return f"{output_prefix}source.pdf"


def page_render_key(output_prefix: str, page_number: int) -> str:
    return f"{output_prefix}pages/{page_number}.png"


def vision_markup_cache_key(output_prefix: str, page_number: int) -> str:
    """Raw Nemotron output of a page, reused when a retried batch reaches the page again."""
    return f"{output_prefix}pages/{page_number}.document_parse.txt"


def crop_key(output_prefix: str, block_id: UUID) -> str:
    return f"{output_prefix}crops/{block_id}.png"


def manifest_key(output_prefix: str, batch_number: int) -> str:
    return f"{output_prefix}blocks-{batch_number:04d}.jsonl"
