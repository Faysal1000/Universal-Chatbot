# syntax=docker/dockerfile:1.7

# ==============================================================================
#  The whole platform in one container for a Hugging Face Docker Space.
#  Built by docker-bake.hcl: the named contexts (rag, llm-gateway, ...) are the services' own
#  runtime images. nginx on 7860 is the only public port; supervisord runs everything else.
#  PostgreSQL (with pgvector) and object storage are external (Neon, S3); Redis runs here.
# ==============================================================================
FROM node:24-trixie-slim AS node

FROM python:3.12-slim-trixie

# nginx and Redis; Tesseract for the document parser; libgomp1 and libcurl4 for llama.cpp.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        nginx redis-server tesseract-ocr tesseract-ocr-eng tesseract-ocr-ben libgomp1 libcurl4 ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && python -m venv /opt/supervisor \
    && /opt/supervisor/bin/pip install --no-cache-dir supervisor==4.3.0 \
    && useradd --uid 1000 --create-home --shell /usr/sbin/nologin user

COPY --from=node /usr/local/bin/node /usr/local/bin/node

# Each Python service keeps its own virtualenv; they are started with `<venv>/bin/python -m ...`.
COPY --from=rag /service /srv/rag
COPY --from=document-parser /opt/venv /opt/document-parser
COPY --from=document-parser /service /srv/document-parser
COPY --from=embedding-server /opt/venv /opt/embedding-server
COPY --from=embedding-server /service /srv/embedding-server
COPY --from=llm-gateway /opt/venv /opt/llm-gateway
COPY --from=llm-gateway /service /srv/llm-gateway
COPY --from=local-llm /opt/venv /opt/local-llm
COPY --from=local-llm /opt/llama.cpp /opt/llama.cpp
COPY --from=local-llm /service /srv/local-llm
COPY --from=admin-console /app /srv/admin-console
COPY --from=frontend-chat-interface /usr/share/nginx/html /srv/chat
COPY --from=frontend-chat-interface /docker-entrypoint.d/40-runtime-config.sh /opt/space/write-chat-runtime-config

# The chat's own security headers, with two changes for the Space: the browser only talks to this
# origin, and huggingface.co may frame the chat (the Space page shows the app in an iframe).
COPY --from=frontend-chat-interface /etc/nginx/templates/security-headers.inc.template /tmp/security-headers.inc
RUN mkdir -p /etc/nginx/space \
    && sed -e 's/ ${CHAT_RUNTIME_CSP_CONNECT_SRC}//g' \
           -e "s/frame-ancestors 'none'/frame-ancestors https:\/\/huggingface.co/" \
           -e '/X-Frame-Options/d' \
           /tmp/security-headers.inc > /etc/nginx/space/chat-security-headers.inc \
    && rm /tmp/security-headers.inc

COPY nginx.conf /etc/nginx/space/nginx.conf
COPY supervisord.conf /etc/supervisor/supervisord.conf
COPY entrypoint.sh /opt/space/entrypoint
RUN chmod 0755 /opt/space/entrypoint /opt/space/write-chat-runtime-config

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    HOME=/home/user \
    HF_HOME=/home/user/.cache/huggingface \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HF_HUB_DISABLE_XET=1 \
    TOKENIZERS_PARALLELISM=false \
    LD_LIBRARY_PATH=/opt/llama.cpp

USER 1000:1000
WORKDIR /home/user
EXPOSE 7860
ENTRYPOINT ["/opt/space/entrypoint"]
