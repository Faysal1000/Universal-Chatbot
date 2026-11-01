"""Request examples shown in Swagger UI (``/docs``) for one-click "Try it out" testing."""

from typing import Any

# 32x32 solid red PNG. Tiny 1x1 images are avoided on purpose: Hugging Face image
# processors cannot infer the channel axis of a (1, 1, 3) array.
SAMPLE_IMAGE_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR42u3NMQEAAAQAMATRP5QwSvBtBZbTHZ8q"
    "ngkEAoFAIBAIBIIrC9KAAVhVsgYjAAAAAElFTkSuQmCC"
)

SINGLE_EMBEDDING_EXAMPLES: dict[str, dict[str, Any]] = {
    "search_query": {
        "summary": "Text: search query",
        "value": {"type": "text", "text": "How does multimodal semantic search work?", "task": "query"},
    },
    "document_with_title": {
        "summary": "Text: document passage with title",
        "value": {
            "type": "text",
            "text": "EmbeddingGemma 2 encodes text and images into a shared vector space.",
            "task": "document",
            "title": "EmbeddingGemma Overview",
        },
    },
    "image": {
        "summary": "Image (raw Base64 PNG)",
        "value": {"type": "image", "image_base64": SAMPLE_IMAGE_BASE64},
    },
    "text_and_image": {
        "summary": "Text + image (joint embedding)",
        "value": {
            "type": "text_image",
            "text": "A small solid red square.",
            "image_base64": SAMPLE_IMAGE_BASE64,
            "task": "document",
            "title": "Red Square",
        },
    },
}

BATCH_EMBEDDING_EXAMPLES: dict[str, dict[str, Any]] = {
    "mixed_modalities": {
        "summary": "Query, document, and image in one call",
        "value": {
            "items": [
                {"type": "text", "text": "vector retrieval for RAG", "task": "query"},
                {
                    "type": "text",
                    "text": "Passages are stored in Postgres.",
                    "task": "document",
                    "title": "RAG Guide",
                },
                {"type": "image", "image_base64": SAMPLE_IMAGE_BASE64},
            ]
        },
    },
}
