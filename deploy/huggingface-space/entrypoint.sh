#!/bin/sh
# Starts the platform inside the Space: maps the Space secrets onto each service's own settings,
# runs both database migrations, then hands over to supervisord.
set -eu

require() {
  for name in "$@"; do
    if [ -z "$(printenv "$name" || true)" ]; then
      echo "entrypoint: set the $name secret in GitHub and redeploy" >&2
      exit 1
    fi
  done
}

require DATABASE_URL \
  S3_ENDPOINT S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY \
  LLM_GATEWAY_ENCRYPTION_KEY RAG_CLIENT_HASH_SECRET ADMIN_CONSOLE_ADMIN_PASSWORD_HASH HF_TOKEN

random_key() {
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

mkdir -p /tmp/space/nginx "$HF_HOME" /home/user/local-llm

# Keys the services use to call each other. They never leave this container, so fresh ones on
# every boot are enough; nothing stores them.
embedding_key=$(random_key)
gateway_key=$(random_key)
gateway_admin_key=$(random_key)
registration_key=$(random_key)
local_llm_key=$(random_key)
local_llm_admin_key=$(random_key)
rag_admin_key=$(random_key)

# rag holds session-level advisory locks, which Neon's pooler (the "-pooler" host) does not keep,
# so both services use the direct host. Each driver spells "require TLS" its own way.
database_url=$(printf '%s' "${DATABASE_URL%%\?*}" | sed 's/-pooler\././')
database_address=${database_url#*://}

export HF_TOKEN
public_origin="https://${SPACE_HOST:-localhost}"

# ----- embedding-server
export EMBEDDING_SERVER_HOST=127.0.0.1 EMBEDDING_SERVER_PORT=8000 EMBEDDING_SERVER_DEVICE=cpu
export EMBEDDING_SERVER_API_KEY="$embedding_key"
export EMBEDDING_SERVER_HUGGINGFACE_TOKEN="$HF_TOKEN"
export EMBEDDING_SERVER_ENABLE_API_DOCS=false EMBEDDING_SERVER_LOG_FORMAT=json

# ----- local-llm (Nemotron Parse; admins can deploy more models from the console)
export LOCAL_LLM_HOST=127.0.0.1 LOCAL_LLM_PORT=8095
export LOCAL_LLM_PUBLIC_BASE_URL=http://127.0.0.1:8095
export LOCAL_LLM_INFERENCE_API_KEY="$local_llm_key"
export LOCAL_LLM_ADMIN_API_KEY="$local_llm_admin_key"
export LOCAL_LLM_GATEWAY_BASE_URL=http://127.0.0.1:4000
export LOCAL_LLM_GATEWAY_REGISTRATION_API_KEY="$registration_key"
export LOCAL_LLM_HUGGINGFACE_TOKEN="$HF_TOKEN"
export LOCAL_LLM_STATE_DIRECTORY=/home/user/local-llm
export LOCAL_LLM_LLAMA_SERVER_BINARY=/opt/llama.cpp/llama-server
export LOCAL_LLM_ENABLE_API_DOCS=false LOCAL_LLM_LOG_FORMAT=json
# local-llm would size models against the whole container; leave room for the other services.
other_services_memory_bytes=$((6 * 1024 * 1024 * 1024))
container_memory_limit=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo max)
if [ -z "${LOCAL_LLM_MEMORY_CAPACITY_BYTES:-}" ] && [ "$container_memory_limit" != max ] \
  && [ "$container_memory_limit" -gt $((2 * other_services_memory_bytes)) ]; then
  export LOCAL_LLM_MEMORY_CAPACITY_BYTES=$((container_memory_limit - other_services_memory_bytes))
fi

# ----- llm-gateway
export LLM_GATEWAY_HOST=127.0.0.1 LLM_GATEWAY_PORT=4000
export LLM_GATEWAY_DATABASE_URL="postgresql+asyncpg://${database_address}?ssl=require"
export LLM_GATEWAY_API_KEY="$gateway_key"
export LLM_GATEWAY_ADMIN_API_KEY="$gateway_admin_key"
export LLM_GATEWAY_REGISTRATION_API_KEY="$registration_key"
export LLM_GATEWAY_ADMIN_SESSION_SECRET="$(random_key)"
export LLM_GATEWAY_ENABLE_API_DOCS=false
# The gateway's own admin sign-in is not reachable from outside; the console uses the admin key.
export LLM_GATEWAY_ADMIN_USERNAME=admin
LLM_GATEWAY_ADMIN_PASSWORD_HASH=$(cd /srv/llm-gateway && /opt/llm-gateway/bin/python -c \
  'import secrets; from app.security.admin_passwords import hash_admin_password; print(hash_admin_password(secrets.token_urlsafe(32)))')
export LLM_GATEWAY_ADMIN_PASSWORD_HASH

# ----- rag
export RAG_HOST=127.0.0.1
export RAG_DATABASE_URL="postgresql://${database_address}?sslmode=verify-full"
export RAG_REDIS_URL=redis://127.0.0.1:6379/0
export RAG_S3_ENDPOINT="$S3_ENDPOINT" RAG_S3_REGION="${S3_REGION:-auto}" RAG_S3_BUCKET="$S3_BUCKET"
export RAG_S3_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" RAG_S3_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export RAG_S3_FORCE_PATH_STYLE=true
export RAG_EMBEDDING_SERVER_URL=http://127.0.0.1:8000 RAG_EMBEDDING_SERVER_API_KEY="$embedding_key"
export RAG_LLM_GATEWAY_URL=http://127.0.0.1:4000 RAG_LLM_GATEWAY_API_KEY="$gateway_key"
export RAG_ADMIN_API_KEY="$rag_admin_key"
export RAG_PUBLIC_CORS_ALLOWED_ORIGINS="${CHAT_WIDGET_ALLOWED_ORIGINS:-$public_origin}"
# The Space's proxy and this container's nginx each add one X-Forwarded-For entry.
export RAG_TRUSTED_PROXY_HOPS=2
export RAG_LOG_FORMAT=json

# ----- document-parser
export DOCUMENT_PARSER_HOST=127.0.0.1 DOCUMENT_PARSER_PORT=8090
export DOCUMENT_PARSER_REDIS_URL=redis://127.0.0.1:6379/0 DOCUMENT_PARSER_QUEUE_PREFIX=rag
export DOCUMENT_PARSER_S3_ENDPOINT="$S3_ENDPOINT" DOCUMENT_PARSER_S3_REGION="${S3_REGION:-auto}"
export DOCUMENT_PARSER_S3_BUCKET="$S3_BUCKET" DOCUMENT_PARSER_S3_FORCE_PATH_STYLE=true
export DOCUMENT_PARSER_S3_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID"
export DOCUMENT_PARSER_S3_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY"
export DOCUMENT_PARSER_LLM_GATEWAY_URL=http://127.0.0.1:4000 DOCUMENT_PARSER_LLM_GATEWAY_API_KEY="$gateway_key"
export DOCUMENT_PARSER_LOG_FORMAT=json

# ----- admin-console (served under /admin/ by nginx)
export ADMIN_CONSOLE_HOST=127.0.0.1 ADMIN_CONSOLE_PORT=3100
export ADMIN_CONSOLE_STATIC_DIRECTORY=/srv/admin-console/dist/web
export ADMIN_CONSOLE_ADMIN_USERNAME="${ADMIN_CONSOLE_ADMIN_USERNAME:-admin}"
export ADMIN_CONSOLE_TRUST_PROXY=true ADMIN_CONSOLE_COOKIE_SECURE=true
export ADMIN_CONSOLE_RAG_URL=http://127.0.0.1:8080 ADMIN_CONSOLE_RAG_WORKER_URL=http://127.0.0.1:8081
export ADMIN_CONSOLE_RAG_ADMIN_API_KEY="$rag_admin_key"
export ADMIN_CONSOLE_LLM_GATEWAY_URL=http://127.0.0.1:4000 ADMIN_CONSOLE_LLM_GATEWAY_ADMIN_API_KEY="$gateway_admin_key"
export ADMIN_CONSOLE_LOCAL_LLM_URL=http://127.0.0.1:8095 ADMIN_CONSOLE_LOCAL_LLM_ADMIN_API_KEY="$local_llm_admin_key"
export ADMIN_CONSOLE_EMBEDDING_SERVER_URL=http://127.0.0.1:8000
export ADMIN_CONSOLE_DOCUMENT_PARSER_URL=http://127.0.0.1:8090

# ----- chat: same origin as rag's public API
export CHAT_RUNTIME_API_BASE_URL="" CHAT_RUNTIME_CONFIG_FILE=/tmp/space/runtime-config.js
/opt/space/write-chat-runtime-config

echo "entrypoint: migrating the llm-gateway database"
(cd /srv/llm-gateway && /opt/llm-gateway/bin/python -m alembic upgrade head)
echo "entrypoint: migrating the rag database"
(cd /srv/rag && node --enable-source-maps dist/database/run-migrations.js)

exec /opt/supervisor/bin/supervisord --configuration /etc/supervisor/supervisord.conf
