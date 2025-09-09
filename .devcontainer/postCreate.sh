#!/usr/bin/env bash
set -euo pipefail

echo "[postCreate] Installing server deps + Prisma..."
cd server
npm i
npx prisma generate
npx prisma db push

echo "[postCreate] Installing client deps..."
cd ../client-web
npm i

echo
echo "[postCreate] Ready."
echo "Open two terminals and run:"
echo "  1) cd server && npm run dev"
echo "  2) cd client-web && npm run dev"
