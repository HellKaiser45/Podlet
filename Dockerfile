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

# Install system Chromium (for Puppeteer-based MCPs) and git
RUN apt-get update && apt-get install -y \
  chromium \
  git \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use system Chromium instead of downloading its own
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium

# Runtime caches live on the container filesystem (ephemeral) — never under $HOME,
# which is a bind-mount target at runtime. Tools (npx/uvx/bun/chromium) must not
# attempt writes outside these dirs or the mounted .podlet.
RUN mkdir -p /var/cache/podlet/npm \
             /var/cache/podlet/uv/cache \
             /var/cache/podlet/uv/tools \
             /var/cache/podlet/uv/tools-bin \
             /var/cache/podlet/uv/python \
             /var/cache/podlet/bun \
             /var/cache/podlet/xdg/cache \
             /var/cache/podlet/xdg/config \
             /var/cache/podlet/xdg/data \
  && chown -R 1000:1000 /var/cache/podlet

ENV NPM_CONFIG_CACHE=/var/cache/podlet/npm
ENV npm_config_cache=/var/cache/podlet/npm
ENV UV_CACHE_DIR=/var/cache/podlet/uv/cache
ENV UV_TOOL_DIR=/var/cache/podlet/uv/tools
ENV UV_TOOL_BIN_DIR=/var/cache/podlet/uv/tools-bin
ENV UV_PYTHON_INSTALL_DIR=/var/cache/podlet/uv/python
ENV BUN_INSTALL_CACHE_DIR=/var/cache/podlet/bun
ENV XDG_CACHE_HOME=/var/cache/podlet/xdg/cache
ENV XDG_CONFIG_HOME=/var/cache/podlet/xdg/config
ENV XDG_DATA_HOME=/var/cache/podlet/xdg/data

# Copy workspace manifests and install production deps only
COPY package.json bun.lockb* bun.lock* ./
COPY apps/gateway/package.json apps/gateway/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/api-client/package.json packages/api-client/package.json

RUN bun install

# Copy gateway source, shared packages, and scripts
COPY apps/gateway/ apps/gateway/
COPY packages/ packages/
COPY scripts/ scripts/
COPY .podlet/ .podlet/
COPY tsconfig.json tsconfig.json

# Copy the built frontend from Stage 1
COPY --from=frontend-build /app/apps/web/dist /app/frontend/dist

COPY docker-entrypoint.sh .
RUN chmod +x docker-entrypoint.sh

# No HOME is set in the image; compose propagates the host HOME so homedir()
# resolves to the same path as on the host and matches the .podlet mount.
USER 1000:1000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["bun", "run", "apps/gateway/src/start_prod_server.ts"]
