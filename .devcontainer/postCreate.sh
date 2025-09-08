#!/usr/bin/env bash
set -euo pipefail
echo "[postCreate] Installing server deps..."
cd server
npm i
npx prisma generate
npx prisma db push

echo "[postCreate] Installing client deps..."
cd ../client-web
npm i

echo "[postCreate] Done. You can now run:
  - (pane 1) cd server && npm run dev
  - (pane 2) cd client-web && npm run dev"
