#!/bin/bash
# Starts the API (port 4000, internal) and the website (the host's $PORT).
# If either stops, the container exits so the host restarts it.
set -e
WEB_PORT="${PORT:-3000}"

cd /app/apps/api
npx prisma migrate deploy --schema prisma/schema.prisma

# Small heaps: free instances have 512 MB for both processes
PORT=4000 NODE_OPTIONS="--max-old-space-size=230" node dist/index.js &
cd /app/apps/web
NODE_OPTIONS="--max-old-space-size=170" npx next start -p "$WEB_PORT" &

wait -n
exit 1
