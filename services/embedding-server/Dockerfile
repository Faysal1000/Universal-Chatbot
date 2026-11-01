# syntax=docker/dockerfile:1.7
# ------------------------------------------------------------------------------
# Embedding Server image.
#   CPU (default):  docker build -t embedding-server:cpu .
#   NVIDIA GPU:     docker build --build-arg INFERENCE_DEVICE=cuda -t embedding-server:cuda .
# ------------------------------------------------------------------------------
ARG PYTHON_VERSION=3.12

# ----- Build stage: resolve and install dependencies into an isolated venv -----
FROM python:${PYTHON_VERSION}-slim AS dependency-builder

ARG INFERENCE_DEVICE=cpu
# Override with an exact pin (e.g. "==2.9.1") for fully reproducible builds.
ARG TORCH_VERSION_SPECIFIER=">=2.6,<3"

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VIRTUAL_ENV=/opt/venv
RUN python -m venv "${VIRTUAL_ENV}"
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

# torch and torchvision are installed together so their versions always match
# (the EmbeddingGemma 2 processor needs torchvision). CPU builds use the CPU-only
# wheel index, which skips ~2 GB of CUDA libraries.
RUN if [ "${INFERENCE_DEVICE}" = "cpu" ]; then \
        pip install "torch${TORCH_VERSION_SPECIFIER}" torchvision --index-url https://download.pytorch.org/whl/cpu; \
    else \
        pip install "torch${TORCH_VERSION_SPECIFIER}" torchvision; \
    fi

COPY requirements.txt .
RUN pip install -r requirements.txt

# ----- Runtime stage: minimal image running as an unprivileged user -----
FROM python:${PYTHON_VERSION}-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:${PATH}" \
    # Model weights are cached here; mount a volume so restarts skip the download.
    HF_HOME=/var/cache/huggingface \
    HF_HUB_DISABLE_TELEMETRY=1 \
    TOKENIZERS_PARALLELISM=false \
    EMBEDDING_SERVER_HOST=0.0.0.0 \
    EMBEDDING_SERVER_PORT=8000

RUN groupadd --system --gid 10001 embedding \
    && useradd --system --uid 10001 --gid embedding --home-dir /nonexistent --shell /usr/sbin/nologin embedding \
    && mkdir -p "${HF_HOME}" \
    && chown embedding:embedding "${HF_HOME}"

COPY --from=dependency-builder /opt/venv /opt/venv
WORKDIR /service
COPY --chown=root:root app ./app

USER 10001:10001
EXPOSE 8000

# Liveness only. Uvicorn accepts connections after the model loads, so allow a long start period.
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.environ['EMBEDDING_SERVER_PORT']}/health/live\", timeout=4)"]

CMD ["python", "-m", "app"]
