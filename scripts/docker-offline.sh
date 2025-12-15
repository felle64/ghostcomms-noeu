#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Starting GhostComms stack without Cloudflare (db + server + web)..."
echo "Use Ctrl+C to stop; data persists in the 'dbdata' volume."

cd "${ROOT_DIR}"
docker compose up --build db server web
