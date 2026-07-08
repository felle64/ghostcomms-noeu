# GhostComms — the "I forgot how everything works" guide

Private 1:1 chat (Signal-style) with end-to-end encryption and a metadata-minimal relay server. No phone numbers or email — just a username + password. Messages are ephemeral by default: the server deletes an encrypted envelope the moment it's delivered (or after a 24h TTL if the recipient never comes online).

**Current state (last commit: "local only use, for now"):** everything works locally. The Cloudflare tunnel / `app.nfktech.com` deploy stuff exists but is opt-in and not the active setup.

---

## TL;DR — how do I start it?

### Option A: Everything in Docker (easiest, no setup)

```bash
npm run docker:offline
```

That builds and starts **db + server + web** (skips Cloudflare). Then open **http://localhost:5173**. The API is on http://localhost:8080. Stop with Ctrl+C; data survives in the `dbdata` Docker volume.

### Option B: Local dev with hot reload (for actually coding)

```bash
# 1) Install deps (once per clone)
npm run bootstrap

# 2) Start a Postgres that matches server/.env (user postgres / pass postgres / db ghostcomms)
docker compose -f .devcontainer/docker-compose.yml up -d db

# 3) Push the Prisma schema to the db (once, and after schema changes)
cd server && npx prisma db push && cd ..

# 4) Run server (tsx watch) + client (vite) together
npm run dev
```

Open **http://localhost:5173**. Server runs on :8080, Vite on :5173. The client auto-detects: if it's served on :5173 it talks to :8080 (see [client-web/src/api.ts](client-web/src/api.ts)).

### Trying it out

Open two browsers (or one normal + one incognito, since identity keys live in localStorage). Sign up as two different users, then in Chats add the other person by **username** and start messaging. Messages are E2E-encrypted in the browser before they ever hit the server.

---

## What is this, architecturally?

```
client-web (React + Vite, :5173)          server (Fastify, :8080)         Postgres
┌─────────────────────────────┐   HTTPS   ┌──────────────────────┐   ┌─────────────┐
│ tweetnacl (X25519 box)      │ ───────►  │ auth, prekeys,       │──►│ users,      │
│ encrypt/decrypt in browser  │           │ device registry      │   │ devices,    │
│ Dexie (IndexedDB) for       │    WS     ├──────────────────────┤   │ encrypted   │
│ local message history       │ ◄───────► │ relay: store & fwd   │   │ envelopes   │
└─────────────────────────────┘           │ encrypted envelopes  │   │ (ephemeral) │
                                          └──────────────────────┘   └─────────────┘
```

- **The server never sees plaintext.** Clients fetch each other's public keys (`/prekeys/:deviceId`), encrypt with `nacl.box` (X25519 + XSalsa20-Poly1305), and the server only stores/forwards opaque ciphertext blobs ("envelopes").
- **Delivery:** messages go over a WebSocket. If the recipient is online, delivered instantly and the envelope row is deleted immediately. If offline, the envelope is queued in Postgres and pushed as backlog when they reconnect (then deleted). TTL is `EPHEMERAL_TTL_SECONDS` (default 24h).
- **Identity:** username + password (hashed server-side). Each browser/device generates its own Curve25519 identity keypair, kept in **localStorage** — so the same user in a different browser is a different *device*. Logging in with new keys registers a new device; same keys reuse the existing one.
- **Local history:** the client keeps decrypted messages in IndexedDB via Dexie ([client-web/src/storage/db.ts](client-web/src/storage/db.ts)); the server keeps nothing after delivery.

## Repo layout

| Path | What it is |
|---|---|
| [server/](server/) | Fastify 5 + TypeScript API & WS relay. Prisma 6 + PostgreSQL. |
| [server/src/routes.ts](server/src/routes.ts) | All HTTP endpoints (see API section below). |
| [server/src/ws.ts](server/src/ws.ts) | WebSocket relay: auth via `?token=JWT`, backlog drain, store-and-forward, delivery ACKs. |
| [server/prisma/schema.prisma](server/prisma/schema.prisma) | User, Device, OneTimePrekey, Envelope, LinkingSession, HistoryArchive, Attachment. |
| [client-web/](client-web/) | React 19 + Vite 7 SPA. |
| [client-web/src/crypto/signal.ts](client-web/src/crypto/signal.ts) | Client crypto: identity keys, prekey fetch, nacl box encrypt/decrypt. |
| [client-web/src/screens/](client-web/src/screens/) | Login, Chats, Thread (messaging UI), QRAdd, DeviceManagement. |
| [client-web/src/api.ts](client-web/src/api.ts) | API base URL resolution + fetch/WS helpers. |
| [scripts/dev.sh](scripts/dev.sh) | Runs server + client dev processes together (`npm run dev`). |
| [scripts/docker-offline.sh](scripts/docker-offline.sh) | `docker compose up` for db+server+web only (no Cloudflare). |
| [docker-compose.yml](docker-compose.yml) | Full stack incl. optional `cloudflared` tunnel (profile `edge`). |
| [secrets/](secrets/) | `pg_password.txt`, `jwt_secret.txt`, `cf_tunnel_token.txt` — read by docker compose as file secrets. **Not for git.** |
| [.devcontainer/](.devcontainer/) | Devcontainer + a simple Postgres on :5432 that matches `server/.env` (handy for local dev, see Option B). |

## Root npm scripts

| Command | Does |
|---|---|
| `npm run bootstrap` | `npm install` in both `server/` and `client-web/` |
| `npm run dev` | Server (tsx watch) + client (vite) together |
| `npm run dev:server` / `dev:client` | Just one of them |
| `npm run build` | Builds server (`tsc`) and client (`vite build`) |
| `npm run docker:up` | Full docker stack with `--build` |
| `npm run docker:offline` | db + server + web only (recommended for local) |
| `npm run docker:down` | Stop the stack |
| `npm run docker:logs` | Tail compose logs |

Inside `server/`: `npm run db:push` (sync Prisma schema to db) and `npm run db:studio` (Prisma Studio GUI for poking at the database).

## Environment / config

**server/.env** (used by local dev; docker compose sets its own env inline):

| Var | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/ghostcomms` | Postgres connection |
| `JWT_SECRET` | (set in .env) | Signs the 30-day auth JWTs. Change for anything non-local. |
| `PORT` | `8080` | API + WS port |
| `EPHEMERAL_TTL_SECONDS` | `86400` | How long undelivered envelopes live |
| `CORS_ORIGINS` | `http://localhost:5173,https://app.nfktech.com` | Comma-separated allowed web origins |
| `REGION` | `CH` | Reported by `/health` |

**client-web:** `VITE_API_URL` (in `.env.local` / `.env.production`, or as a docker build arg: `VITE_API_URL=https://api.example.com npm run docker:up`). If unset, the client guesses `:8080` on the same host.

**Docker secrets:** compose reads `secrets/pg_password.txt` (Postgres password) and `secrets/cf_tunnel_token.txt` (only needed with the `edge` profile). They exist locally already; recreate them if cloning fresh.

## API surface (server, :8080)

- `GET /health` — `{ ok, region }`
- `POST /signup` — `{ username, password, deviceName?, identityKeyPubB64, signedPrekeyPubB64, oneTimePrekeysB64? }` → creates user + first device, returns JWT
- `POST /login` — same body; reuses the device if the identity key matches, otherwise registers a new device
- `GET /user/:username` — user's devices + identity public keys (for adding contacts)
- `GET /resolve/:who` — username or deviceId → most-recently-seen deviceId
- `GET /prekeys/:deviceId` — prekey bundle (consumes a one-time prekey)
- `GET /my-devices` (JWT) — list my devices
- `DELETE /device/:deviceId` (JWT) — unlink a device (not the current one)
- `GET /inbox/from/:username` (JWT) — drain queued envelopes from that user (delivers + deletes)
- `POST /media/upload`, `GET /media/:key` — **stubs, return 501** (attachments not implemented)
- **WebSocket** on the same port: connect with `?token=<jwt>`; send `{ to: usernameOrDeviceId, ciphertext: base64, contentType?, clientMsgId? }`; receive envelopes and `{ type: 'delivered', mode: 'direct'|'queued' }` ACKs

## Gotchas / things future-me should remember

- **Identity keys live in localStorage**, so "Logout" + `localStorage.clear()` throws away your device keys — next login creates a brand new device and you can't decrypt old queued messages sent to the old device.
- **Postgres credentials differ between setups:** local dev expects `postgres:postgres@localhost:5432/ghostcomms` (the devcontainer db), while the docker stack uses user `ghost`, db `ghostdb`, password from `secrets/pg_password.txt`. Don't mix them up.
- The docker server container runs `prisma db push` on startup, so its schema is always synced; for local dev you push manually.
- The crypto is **MVP-grade NaCl box, not the actual Signal protocol** — no double ratchet / forward secrecy per message, despite the `signal.ts` filename. Signed prekeys aren't actually signature-verified.
- Attachments (10 MB cap per the original spec) and the envelope-prune cron job are **not implemented** yet; expired envelope cleanup relies on delivery-time deletes.
- `server/prisma/schema_old.prisma` is a leftover; `schema.prisma` is the real one.
- Cloudflare tunnel is opt-in: `COMPOSE_PROFILES=edge docker compose up` with a token in `secrets/cf_tunnel_token.txt` (see [setup-cloudflare.sh](setup-cloudflare.sh)). The intended public hosts were `app.nfktech.com` (web) and `api.nfktech.com` (API).

## Deploy notes (the original plan)

Target was Swiss hosting (Swiss VPS or AWS eu-central-2 Zurich): Postgres + S3-compatible storage in CH, TLS at a reverse proxy or via the Cloudflare tunnel, client built with `VITE_API_URL` pointing at the HTTPS API origin, and a cron to prune expired envelopes. None of that is live right now — it's local-only for the time being.
