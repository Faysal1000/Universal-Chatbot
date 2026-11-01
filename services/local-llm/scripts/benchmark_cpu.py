"""Measure real speed through a running local-llm: seconds per page for a document parser
deployment and tokens per second for chat deployments.

    LOCAL_LLM_INFERENCE_API_KEY=... python scripts/benchmark_cpu.py \
        --base-url http://localhost:8095 --parser nemotron-parse --chat qwen3.5-0.8b \
        --pdf tests/fixtures/sample-document.pdf --pages 1 --repeats 3
"""

import argparse
import base64
import os
import statistics
import time
from dataclasses import dataclass
from pathlib import Path

import httpx
import pymupdf

CHAT_PROMPT = "Explain in about one hundred words how a retrieval-augmented chatbot answers a question."
REQUEST_TIMEOUT_SECONDS = 1800.0


@dataclass(frozen=True)
class Measurement:
    """One timed request."""

    seconds: float
    completion_tokens: int


def render_page_data_uris(pdf_path: Path, page_count: int, dots_per_inch: int) -> list[str]:
    """PNG data URIs of the first ``page_count`` pages."""
    with pymupdf.open(pdf_path) as document:
        pages = [document[index] for index in range(min(page_count, document.page_count))]
        return [
            "data:image/png;base64," + base64.b64encode(page.get_pixmap(dpi=dots_per_inch).tobytes("png")).decode()
            for page in pages
        ]


def time_completion(client: httpx.Client, body: dict[str, object]) -> Measurement:
    """POST one non-streamed completion and time it end to end."""
    started_at = time.perf_counter()
    response = client.post("/v1/chat/completions", json=body)
    response.raise_for_status()
    return Measurement(time.perf_counter() - started_at, int(response.json()["usage"]["completion_tokens"]))


def benchmark_parser(client: httpx.Client, deployment: str, page_data_uris: list[str], repeats: int) -> None:
    """Report seconds per page and pages per minute."""
    measurements = [
        time_completion(
            client,
            {
                "model": deployment,
                "messages": [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": data_uri}}]}],
            },
        )
        for _ in range(repeats)
        for data_uri in page_data_uris
    ]
    seconds_per_page = statistics.median(measurement.seconds for measurement in measurements)
    print(
        f"{deployment}: {seconds_per_page:.1f} s/page (median of {len(measurements)}), "
        f"{60 / seconds_per_page:.1f} pages/min, "
        f"{statistics.median(m.completion_tokens for m in measurements):.0f} tokens/page"
    )


def benchmark_chat(client: httpx.Client, deployment: str, repeats: int) -> None:
    """Report generated tokens per second (including prompt processing)."""
    measurements = [
        time_completion(
            client,
            {
                "model": deployment,
                "messages": [{"role": "user", "content": CHAT_PROMPT}],
                "max_tokens": 160,
                "temperature": 0,
            },
        )
        for _ in range(repeats)
    ]
    tokens_per_second = statistics.median(m.completion_tokens / m.seconds for m in measurements)
    print(f"{deployment}: {tokens_per_second:.1f} tokens/s (median of {len(measurements)})")


def main() -> None:
    """Parse arguments and run the requested benchmarks."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8095")
    parser.add_argument("--parser", help="Document-parser deployment name, e.g. nemotron-parse")
    parser.add_argument("--chat", action="append", default=[], help="Chat deployment name (repeatable)")
    parser.add_argument("--pdf", type=Path, default=Path("tests/fixtures/sample-document.pdf"))
    parser.add_argument("--pages", type=int, default=1)
    parser.add_argument("--dpi", type=int, default=150)
    parser.add_argument("--repeats", type=int, default=3)
    arguments = parser.parse_args()

    headers = {"Authorization": f"Bearer {os.environ['LOCAL_LLM_INFERENCE_API_KEY']}"}
    with httpx.Client(base_url=arguments.base_url, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS) as client:
        if arguments.parser:
            page_data_uris = render_page_data_uris(arguments.pdf, arguments.pages, arguments.dpi)
            benchmark_parser(client, arguments.parser, page_data_uris, arguments.repeats)
        for chat_deployment in arguments.chat:
            benchmark_chat(client, chat_deployment, arguments.repeats)


if __name__ == "__main__":
    main()
