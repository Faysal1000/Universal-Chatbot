# syntax=docker/dockerfile:1.7
# ------------------------------------------------------------------------------
# LLM gateway image.
#   docker build -t llm-gateway .
#   docker build --target fake-provider -t llm-gateway-fake-provider .   # demo/testing only
# The same image runs migrations: `python -m alembic upgrade head`.
# ------------------------------------------------------------------------------
ARG PYTHON_VERSION=3.12

# ----- Build stage: resolve and install dependencies into an isolated venv -----
FROM python:${PYTHON_VERSION}-slim AS dependency-builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VIRTUAL_ENV=/opt/venv
RUN python -m venv "${VIRTUAL_ENV}"
ENV PATH="${VIRTUAL_ENV}/bin:${PATH}"

COPY requirements.txt .
RUN pip install -r requirements.txt

# ----- Runtime stage: minimal image running as an unprivileged user -----
FROM python:${PYTHON_VERSION}-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:${PATH}" \
    LLM_GATEWAY_HOST=0.0.0.0 \
    LLM_GATEWAY_PORT=4000

RUN groupadd --system --gid 10001 gateway \
    && useradd --system --uid 10001 --gid gateway --home-dir /nonexistent --shell /usr/sbin/nologin gateway

COPY --from=dependency-builder /opt/venv /opt/venv
WORKDIR /service
COPY --chown=root:root alembic.ini ./
COPY --chown=root:root migrations ./migrations
COPY --chown=root:root app ./app

USER 10001:10001
EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.environ['LLM_GATEWAY_PORT']}/health/live\", timeout=4)"]

CMD ["python", "-m", "app"]

# ----- Optional: fake multi-protocol LLM provider for demos without real API keys -----
FROM runtime AS fake-provider
COPY --chown=root:root tests/__init__.py tests/fake_provider.py ./tests/
EXPOSE 9100
HEALTHCHECK NONE
CMD ["python", "-m", "uvicorn", "tests.fake_provider:fake_provider_app", "--host", "0.0.0.0", "--port", "9100"]

# ----- Default target: a plain `docker build .` builds the last stage, so it must be the gateway -----
FROM runtime
