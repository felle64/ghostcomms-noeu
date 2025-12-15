#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to run the dev environment." >&2
  exit 1
fi

echo "Starting GhostComms dev stack (server + client)..."
echo "Tip: run 'npm run bootstrap' once per clone to install dependencies."

cleanup() {
  trap - INT TERM EXIT
  if [[ -n "${SERVER_PID:-}" ]]; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${CLIENT_PID:-}" ]]; then
    kill "${CLIENT_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup INT TERM EXIT

(cd "${ROOT_DIR}/server" && npm run dev) &
SERVER_PID=$!

(cd "${ROOT_DIR}/client-web" && npm run dev) &
CLIENT_PID=$!

wait -n "${SERVER_PID}" "${CLIENT_PID}"
STATUS=$?

cleanup
exit "${STATUS}"
