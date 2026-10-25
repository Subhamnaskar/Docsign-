# Website + API in one container, for free hosts with a single service
# (Render free). Build from the repository root:
#   docker build -f deploy/render/Dockerfile -t docsign .
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/api apps/api
COPY apps/web apps/web
RUN npx prisma generate --schema apps/api/prisma/schema.prisma && npm run build --workspace @docsign/api
# The website reaches the API inside the same container
ENV API_URL=http://127.0.0.1:4000 NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace @docsign/web

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 API_URL=http://127.0.0.1:4000 KEYS_DIR=/app/.keys WORKER_MODE=inline
COPY --from=build /app /app
COPY deploy/render/start.sh /app/start.sh
RUN chmod +x /app/start.sh
CMD ["/app/start.sh"]
