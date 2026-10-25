# Web app and website. Build from the repository root:
#   docker build -f apps/web/Dockerfile --build-arg API_URL=http://api:4000 -t docsign-web .
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace @docsign/web
COPY apps/web apps/web
# Where server-side code reaches the API (the browser uses the same origin, /api)
ARG API_URL=http://api:4000
ENV API_URL=$API_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace @docsign/web

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app /app
ARG API_URL=http://api:4000
ENV API_URL=$API_URL
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "@docsign/web"]
