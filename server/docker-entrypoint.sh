#!/bin/sh
set -e

# Expand *_FILE envs to real values
if [ -n "$JWT_SECRET_FILE" ] && [ -f "$JWT_SECRET_FILE" ]; then
  export JWT_SECRET="$(cat "$JWT_SECRET_FILE")"
fi

if [ -n "$DATABASE_URL" ]; then
  # replace placeholder __PW__ with secret value, if provided
  if [ -f "/run/secrets/pg_password" ]; then
    PW="$(cat /run/secrets/pg_password)"
    export DATABASE_URL="$(echo "$DATABASE_URL" | sed "s/__PW__/$PW/")"
  fi
fi

# Ensure DB is migrated and client generated (safe if already in sync)
npx prisma db push
node dist/index.js
