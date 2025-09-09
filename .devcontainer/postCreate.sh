#!/usr/bin/env bash
set -euo pipefail

<<<<<<< HEAD
echo "[postCreate] CWD: $(pwd)"
ls -la

=======
>>>>>>> 413b0abf8380649c9458003d6bad144ec5134aaf
echo "[postCreate] Installing server deps + Prisma..."
cd server
npm i
npx prisma generate
npx prisma db push

echo "[postCreate] Installing client deps..."
cd ../client-web
npm i

echo "[postCreate] Ready:"
echo "  • Terminal 1: cd server && npm run dev   (API -> 8080)"
echo "  • Terminal 2: cd client-web && npm run dev (Vite -> 5173)"
