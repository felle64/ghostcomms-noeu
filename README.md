# GhostComms • NoEU (Switzerland) — MVP

Private 1:1 chat (Signal-style) with end-to-end encryption plumbing points and metadata-minimal relay.
Hosting target: **Switzerland**. Ephemeral messages: **ON by default**. Attachment cap: **10 MB**.

## Quick start (local)
```bash
# 0) Install deps once
npm run bootstrap

# 1) One command dev stack (runs server + client together)
npm run dev

# OR run pieces individually
npm run dev:server   # inside server/
npm run dev:client   # inside client-web/
```

Open http://localhost:5173

### Helper scripts
- `npm run build` — builds both server and client bundles
- `npm run docker:up` — builds images and starts the full docker stack
- `npm run docker:offline` — runs db + API + web containers only (no Cloudflare)
- `npm run docker:down` — stops the stack
- `npm run docker:logs` — tails compose logs
- `VITE_API_URL=<url> npm run docker:up` — override the API origin baked into the web image (defaults to `http://server:8080` for offline use)

### Environment notes
- `CORS_ORIGINS` (comma-separated) controls what web origins Fastify will trust. Defaults cover `https://app.nfktech.com` and `http://localhost:5173`. Set it when testing from other hosts or custom domains.

## Docker (local)
```bash
docker compose up --build
# Cloudflare tunnel is optional; add it only when ready:
# COMPOSE_PROFILES=edge docker compose up cloudflared
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
