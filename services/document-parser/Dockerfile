# syntax=docker/dockerfile:1.7
# ------------------------------------------------------------------------------
# document-parser image (CPU only, no PyTorch).
#   Runtime:  docker build -t document-parser:local .
#   Tests:    docker build --target test -t document-parser:test . && docker run --rm document-parser:test
# ------------------------------------------------------------------------------
ARG PYTHON_IMAGE=python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337

# ----- Build stage: install the pinned dependencies into an isolated venv -----
FROM ${PYTHON_IMAGE} AS dependency-builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VIRTUAL_ENV=/opt/venv
RUN python -m venv "${VIRTUAL_ENV}"
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

COPY requirements.txt .
RUN pip install --no-deps -r requirements.txt && pip check

# ----- Runtime base: Tesseract (eng + ben) and the venv, nothing else -----
FROM ${PYTHON_IMAGE} AS runtime-base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:${PATH}" \
    # Tesseract's OpenMP threads oversubscribe small hosts; one thread per page is faster.
    OMP_THREAD_LIMIT=1 \
    DOCUMENT_PARSER_HOST=0.0.0.0 \
    DOCUMENT_PARSER_PORT=8090

RUN apt-get update \
    && apt-get install --yes --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-ben \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 parser \
    && useradd --system --uid 10001 --gid parser --home-dir /nonexistent --shell /usr/sbin/nologin parser

COPY --from=dependency-builder /opt/venv /opt/venv
WORKDIR /service

# ----- Test stage: full suite including the real Tesseract tests -----
FROM runtime-base AS test

RUN apt-get update \
    && apt-get install --yes --no-install-recommends fonts-lohit-beng-bengali \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir --no-deps -r requirements-dev.txt
COPY pyproject.toml ./
COPY app ./app
COPY scripts ./scripts
COPY tests ./tests
# Contract tests read ../rag/contracts, outside this build context; they run on the host/CI.
ENV PYTHONDONTWRITEBYTECODE=1
CMD ["pytest", "-p", "no:cacheprovider", "--ignore", "tests/unit/test_contracts.py"]

# ----- Runtime stage: unprivileged, read-only-filesystem friendly -----
FROM runtime-base AS runtime

COPY --chown=root:root app ./app

USER 10001:10001
EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.environ['DOCUMENT_PARSER_PORT']}/health/live\", timeout=4)"]

CMD ["python", "-m", "app"]
