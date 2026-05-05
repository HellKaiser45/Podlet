# ============================================================
# Stage 1: Build the frontend (SolidJS + Vite)
# ============================================================
FROM oven/bun:1 AS frontend-build

WORKDIR /app

# Copy root lockfile and workspace package manifests first for cache
COPY package.json bun.lockb* bun.lock* ./
COPY apps/web/package.json apps/web/package.json
COPY apps/gateway/package.json apps/gateway/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/api-client/package.json packages/api-client/package.json

RUN bun install

# Copy all source needed for the frontend build
COPY packages/ packages/
COPY apps/web/ apps/web/
COPY tsconfig.json tsconfig.json

# Build frontend with empty API URL so all requests use relative paths
ENV VITE_API_URL=""
RUN bun run --filter @podlet/web build

# ============================================================
# Stage 2: Gateway runtime
# ============================================================
FROM oven/bun:1-debian AS gateway

WORKDIR /app

# Install Node.js (for npx-based MCP tools)
RUN apt-get update && apt-get install -y curl && \
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
  apt-get install -y nodejs && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Python3 + uv (for uvx-based MCP tools)
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv && \
  pip3 install --break-system-packages uv && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests and install production deps only
COPY package.json bun.lockb* bun.lock* ./
COPY apps/gateway/package.json apps/gateway/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/api-client/package.json packages/api-client/package.json

RUN bun install --production

# Copy gateway source, shared packages, and scripts
COPY apps/gateway/ apps/gateway/
COPY packages/ packages/
COPY scripts/ scripts/
COPY tsconfig.json tsconfig.json

# Copy the built frontend from Stage 1
COPY --from=frontend-build /app/apps/web/dist /app/frontend/dist

EXPOSE 3000

ENV PODLET_DIR=/podlet-data

COPY docker-entrypoint.sh .
RUN chmod +x docker-entrypoint.sh

ENTRYPOINT ["./docker-entrypoint.sh"]
