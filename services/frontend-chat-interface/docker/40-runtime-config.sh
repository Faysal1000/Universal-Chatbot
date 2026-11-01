#!/bin/sh
# Writes runtime-config.js from CHAT_RUNTIME_* so one image can target any backend without a rebuild.
# CHAT_RUNTIME_CONFIG_FILE moves the file out of the web root (the Hugging Face Space serves it from /tmp).
# Runs from the nginx image's /docker-entrypoint.d hook before nginx starts (as the unprivileged nginx user).
set -eu

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/</\\u003c/g'
}

target=${CHAT_RUNTIME_CONFIG_FILE:-/usr/share/nginx/html/runtime-config.js}
{
  printf 'window.__CHAT_RUNTIME_CONFIG__ = {'
  printf '"apiBaseUrl":"%s",' "$(json_escape "${CHAT_RUNTIME_API_BASE_URL:-}")"
  printf '"botName":"%s",' "$(json_escape "${CHAT_RUNTIME_BOT_NAME:-}")"
  printf '"brandAccent":"%s",' "$(json_escape "${CHAT_RUNTIME_BRAND_ACCENT:-}")"
  printf '"brandLogoUrl":"%s"' "$(json_escape "${CHAT_RUNTIME_BRAND_LOGO_URL:-}")"
  printf '};\n'
} > "$target"
echo "runtime-config: wrote $target"
