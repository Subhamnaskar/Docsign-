#!/bin/bash
# Vercel build: the API runs inside this app as one serverless function.
# Set as the Build Command in vercel.json; runs from apps/web.
set -euo pipefail
cd ../..
export EMBEDDED_API=true
mkdir -p apps/web/src/pages/api
cp apps/web/vercel/api-route.ts "apps/web/src/pages/api/[...path].ts"
npx prisma generate --schema apps/api/prisma/schema.prisma
# Apply database migrations to Neon before the new version goes live
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
npm run build --workspace @docsign/web
