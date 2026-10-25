# API (and in-process background worker). Build from the repository root:
#   docker build -f apps/api/Dockerfile -t docsign-api .
FROM node:24-bookworm-slim AS build
WORKDIR /app
# Prisma's query engine needs OpenSSL
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace @docsign/api
COPY apps/api apps/api
RUN npx prisma generate --schema apps/api/prisma/schema.prisma && npm run build --workspace @docsign/api

FROM node:24-bookworm-slim
WORKDIR /app/apps/api
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 4000
# Apply database migrations, then start. Background jobs run inside (WORKER_MODE=inline).
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node dist/index.js"]
