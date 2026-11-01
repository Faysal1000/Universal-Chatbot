# syntax=docker/dockerfile:1.7
# ------------------------------------------------------------------------------
# RAG service image. One image, two processes (chosen by the container command):
#   api:     node dist/main.api.js     (default)
#   worker:  node dist/main.worker.js
#   migrate: node dist/database/run-migrations.js  (one-shot)
#
#   docker build -t rag:local .
# ------------------------------------------------------------------------------
ARG NODE_VERSION=24

# ----- Dependencies: installed once from the lockfile, cached between builds -----
FROM node:${NODE_VERSION}-bookworm-slim AS dependency-installer
WORKDIR /build
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# ----- Build: compile TypeScript, then drop dev dependencies -----
FROM dependency-installer AS builder
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ----- Runtime: minimal image running as an unprivileged user -----
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production \
    RAG_HOST=0.0.0.0 \
    RAG_PORT=8080

RUN groupadd --system --gid 10001 rag \
    && useradd --system --uid 10001 --gid rag --home-dir /nonexistent --shell /usr/sbin/nologin rag

WORKDIR /service
COPY --from=builder --chown=root:root /build/node_modules ./node_modules
COPY --from=builder --chown=root:root /build/dist ./dist
COPY --chown=root:root package.json ./
COPY --chown=root:root drizzle ./drizzle

USER 10001:10001
EXPOSE 8080

# Liveness only; readiness (/health/ready) depends on Postgres, Redis and storage.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.RAG_PORT}/health/live`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# The process installs its own SIGTERM handler and drains before exiting.
CMD ["node", "--enable-source-maps", "dist/main.api.js"]
