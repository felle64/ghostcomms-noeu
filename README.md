# GhostComms • NoEU (Switzerland) — MVP

Private 1:1 chat (Signal-style) with end-to-end encryption plumbing points and metadata-minimal relay.
Hosting target: **Switzerland**. Ephemeral messages: **ON by default**. Attachment cap: **10 MB**.

## Quick start (local)
```bash
# 1) Server
cd server
cp .env.example .env  # fill DATABASE_URL and JWT_SECRET
npm i
npm run db:push
npm run dev

# 2) Client (in another terminal)
cd ../client-web
npm i
npm run dev
```

Open http://localhost:5173

## Docker (local)
```bash
docker compose up --build
```

## Deploy notes (CH)
- Use a Swiss VPS or AWS eu-central-2 (Zurich) with Postgres and S3-compatible object storage in Switzerland.
- Terminate TLS at a reverse proxy (nginx or Caddy). Point client VITE_API_URL to your https API origin.
- Run `server/jobs` prune task (cron) to delete expired envelopes immediately after delivery or TTL.

## Env defaults
- Ephemeral default: **on** (client will auto-delete on read; server drops content after delivery)
- Attachment max: **10 MB**
- No phone numbers; users add contacts via QR / invite codes.
```

