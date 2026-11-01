# syntax=docker/dockerfile:1.7
# ------------------------------------------------------------------------------
# local-llm image: FastAPI + Transformers + llama.cpp (llama-server) in one image.
#   CPU (default, any arch):  docker build -t local-llm:cpu .
#   NVIDIA GPU (amd64):       docker build --build-arg INFERENCE_DEVICE=cuda -t local-llm:cuda .
# The CUDA image also runs on hosts without a GPU: every deployment falls back to CPU.
# ------------------------------------------------------------------------------
ARG INFERENCE_DEVICE=cpu
# llama.cpp b11977 (2026-10-29), pinned by digest so a rebuild never changes the engine silently.
ARG LLAMA_CPP_CPU_IMAGE=ghcr.io/ggml-org/llama.cpp:server@sha256:01c2bc28d51291536df2ccebe5c6af1cdec9ea9b2bd98ac59556408caf96d3f8
ARG LLAMA_CPP_CUDA_IMAGE=ghcr.io/ggml-org/llama.cpp:server-cuda@sha256:0283744a35a6e7698b4f7a2d63360233dc769ece51e84bdba7aa187a33978276

# ----- llama.cpp binaries (llama-server + its dynamically loaded ggml backends) -----
FROM ${LLAMA_CPP_CPU_IMAGE} AS llama-cpp-cpu
FROM ${LLAMA_CPP_CUDA_IMAGE} AS llama-cpp-cuda
FROM llama-cpp-${INFERENCE_DEVICE} AS llama-cpp

# ----- Python base per device -----
FROM python:3.12-slim-trixie AS python-base-cpu

FROM nvidia/cuda:12.8.1-runtime-ubuntu24.04 AS python-base-cuda
RUN apt-get update \
    && apt-get install --yes --no-install-recommends python3.12 python3.12-venv \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/python3.12 /usr/local/bin/python

FROM python-base-${INFERENCE_DEVICE} AS python-base

# ----- Build stage: resolve and install dependencies into an isolated venv -----
FROM python-base AS dependency-builder
ARG INFERENCE_DEVICE
# Override with an exact pin (e.g. "==2.15.0") for fully reproducible builds.
ARG TORCH_VERSION_SPECIFIER=">=2.9,<3"
ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VIRTUAL_ENV=/opt/venv
RUN python -m venv "${VIRTUAL_ENV}"
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"
# torch and torchvision install together so their versions match. The CPU wheel skips ~3 GB of CUDA libraries.
RUN if [ "${INFERENCE_DEVICE}" = "cpu" ]; then \
        pip install "torch${TORCH_VERSION_SPECIFIER}" torchvision --index-url https://download.pytorch.org/whl/cpu; \
    else \
        pip install "torch${TORCH_VERSION_SPECIFIER}" torchvision --index-url https://download.pytorch.org/whl/cu128; \
    fi
COPY requirements.txt .
RUN pip install -r requirements.txt

# ----- Runtime stage: minimal image running as an unprivileged user -----
FROM python-base AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:${PATH}" \
    # Model weights and trusted remote code are cached here; mount a volume so restarts skip downloads.
    HF_HOME=/var/cache/huggingface \
    HF_HUB_DISABLE_TELEMETRY=1 \
    # Hugging Face's Xet transfer client has been seen to stall mid-download; plain HTTP resumes reliably.
    HF_HUB_DISABLE_XET=1 \
    TOKENIZERS_PARALLELISM=false \
    LD_LIBRARY_PATH=/opt/llama.cpp \
    LOCAL_LLM_HOST=0.0.0.0 \
    LOCAL_LLM_PORT=8000 \
    LOCAL_LLM_STATE_DIRECTORY=/var/lib/local-llm \
    LOCAL_LLM_LLAMA_SERVER_BINARY=/opt/llama.cpp/llama-server

# libgomp1: OpenMP for llama.cpp's CPU backend; libcurl4: llama-server links it (downloads are done by Python).
RUN apt-get update \
    && apt-get install --yes --no-install-recommends libgomp1 libcurl4 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 localllm \
    && useradd --system --uid 10001 --gid localllm --home-dir /nonexistent --shell /usr/sbin/nologin localllm \
    && mkdir -p "${HF_HOME}" "${LOCAL_LLM_STATE_DIRECTORY}" \
    && chown localllm:localllm "${HF_HOME}" "${LOCAL_LLM_STATE_DIRECTORY}"

COPY --from=dependency-builder /opt/venv /opt/venv
COPY --from=llama-cpp --chown=root:root /app/ /opt/llama.cpp/
WORKDIR /service
COPY --chown=root:root app ./app

USER 10001:10001
EXPOSE 8000

# Liveness only; readiness (Nemotron loaded) is /health/ready. The first boot downloads ~2.5 GB.
HEALTHCHECK --interval=30s --timeout=5s --start-period=600s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.environ['LOCAL_LLM_PORT']}/health/live\", timeout=4)"]

CMD ["python", "-m", "app"]
