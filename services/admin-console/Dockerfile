# syntax=docker/dockerfile:1.7

# ── Build: the SPA bundle and the compiled BFF ─────────────────────────────────────────────────────────
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
# Path the SPA is served under; a reverse proxy that mounts the console at /admin/ sets it to /admin/.
ARG ADMIN_CONSOLE_BASE_PATH=/
RUN ADMIN_CONSOLE_BASE_PATH="$ADMIN_CONSOLE_BASE_PATH" npm run build && npm prune --omit=dev --no-audit --no-fund

# ── Runtime: Node serves the API and the static bundle as an unprivileged user ─────────────────────────
FROM node:24-alpine AS runtime
LABEL org.opencontainers.image.title="admin-console" \
      org.opencontainers.image.description="Single admin UI of the Universal Chatbot platform (SPA + BFF)"
ENV NODE_ENV=production \
    ADMIN_CONSOLE_HOST=0.0.0.0 \
    ADMIN_CONSOLE_PORT=8080 \
    ADMIN_CONSOLE_STATIC_DIRECTORY=/app/dist/web
WORKDIR /app
COPY --from=build --chown=root:root /app/package.json ./
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/server/main.js"]
