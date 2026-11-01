# syntax=docker/dockerfile:1.7

# ── Build: install deps reproducibly, then produce the static bundle ─────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
# Build-time defaults only; per-environment values are injected at runtime (see docker/40-runtime-config.sh).
ARG VITE_CHAT_BOT_NAME="Universal Assistant"
ARG VITE_CHAT_BRAND_ACCENT="#6d5dfc"
ARG VITE_CHAT_BATCH_QUIET_MIN_MS=1000
ARG VITE_CHAT_BATCH_QUIET_MAX_MS=2000
ARG VITE_CHAT_BATCH_MAX_WAIT_MS=10000
ENV VITE_CHAT_BOT_NAME=$VITE_CHAT_BOT_NAME \
    VITE_CHAT_BRAND_ACCENT=$VITE_CHAT_BRAND_ACCENT \
    VITE_CHAT_BATCH_QUIET_MIN_MS=$VITE_CHAT_BATCH_QUIET_MIN_MS \
    VITE_CHAT_BATCH_QUIET_MAX_MS=$VITE_CHAT_BATCH_QUIET_MAX_MS \
    VITE_CHAT_BATCH_MAX_WAIT_MS=$VITE_CHAT_BATCH_MAX_WAIT_MS
RUN npm run build && find dist -name '*.map' -delete

# ── Runtime: static files on unprivileged nginx (runs as uid 101, listens on 8080) ───────────────────────
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
LABEL org.opencontainers.image.title="frontend-chat-interface" \
      org.opencontainers.image.description="End-user chat UI for the Universal Chatbot RAG platform"
COPY --chown=nginx:nginx docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=nginx:nginx docker/templates/ /etc/nginx/templates/
# Origins the browser may call (API, presigned images). Override per deployment, e.g. "https://rag.example.com".
ENV CHAT_RUNTIME_CSP_CONNECT_SRC="https:"
COPY --chown=nginx:nginx docker/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
