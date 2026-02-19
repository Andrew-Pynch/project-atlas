#!/usr/bin/env bash
set -euo pipefail

DOMAIN="local.projects"
TARGET_PORT="${ATLAS_WEB_PORT:-3340}"
HOSTS_LINE="127.0.0.1 ${DOMAIN}"

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required to configure ${DOMAIN} in /etc/hosts"
  exit 1
fi

if ! grep -qE "^[[:space:]]*127\.0\.0\.1[[:space:]]+${DOMAIN}([[:space:]]|$)" /etc/hosts; then
  echo "Adding ${DOMAIN} -> 127.0.0.1 to /etc/hosts"
  echo "${HOSTS_LINE}" | sudo tee -a /etc/hosts >/dev/null
else
  echo "/etc/hosts already contains ${DOMAIN}"
fi

if command -v caddy >/dev/null 2>&1; then
  CADDY_SNIPPET="/etc/caddy/Caddyfile.d/project-atlas-local.projects"
  echo "Configuring Caddy reverse proxy for ${DOMAIN}"
  sudo mkdir -p /etc/caddy/Caddyfile.d
  cat <<CADDY | sudo tee "${CADDY_SNIPPET}" >/dev/null
${DOMAIN} {
  reverse_proxy 127.0.0.1:${TARGET_PORT}
}
CADDY
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl reload caddy || sudo systemctl restart caddy || true
  fi
else
  echo "Caddy not found. ${DOMAIN} will still resolve; run app directly on localhost:${TARGET_PORT}."
fi

echo "Done. Open http://${DOMAIN} after running: bun run local"
