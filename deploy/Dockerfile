FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 build-essential pkg-config && rm -rf /var/lib/apt/lists/*

FROM base AS build
COPY package.json package-lock.json* tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
COPY scripts ./scripts
RUN npx tsc -p tsconfig.json && npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
ENV APP_ROOT=/app
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY src/ui ./src/ui
COPY data ./data
# Bake precomputed cache (products + embeddings + data hash). The bge-m3/e5
# model itself still downloads on first start (~50-150 MB) into the cache volume.
# If the host doesn't have these files, build still succeeds; pipeline.init()
# will run ingestion at startup as a fallback.
COPY deploy/runtime-cache/ ./cache/
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/src/api/server.js"]
