# ─────────────────────────────────────────────────────────────────────────────
# @postsider/mcp — remote (Streamable HTTP) container image
# ─────────────────────────────────────────────────────────────────────────────
# Self-contained: the build context is THIS directory (see the `postsider-mcp`
# service in docker-compose.production.yaml):
#   docker build -t postsider-mcp apps/mcp
#
# The image serves the REMOTE MCP entrypoint (`dist/http.js`): OAuth discovery
# metadata, the OpenAI domain-verification route, /healthz and the /mcp
# Streamable HTTP transport. The stdio entrypoint (`dist/index.js`) ships to
# users through npm, not through this image.
#
# Dependencies resolve from the manifest — the same ranges an `npx
# @postsider/mcp` user gets — so the container never depends on the monorepo
# lockfile or on pnpm. The SOURCE is frozen: whatever commit builds this image
# is what runs.
# ─────────────────────────────────────────────────────────────────────────────

# === Stage 1: build ===
FROM node:22.20-bookworm-slim AS build

WORKDIR /build

COPY package.json tsconfig.json ./
RUN npm install --no-audit --no-fund

COPY src ./src
RUN npm run build

# Drop devDependencies: the runtime needs the MCP SDK, zod and their tree only
# (verified: ~23 MB node_modules after this prune).
RUN npm prune --omit=dev

# === Stage 2: runtime ===
FROM node:22.20-bookworm-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app

COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/dist ./dist
COPY --from=build /build/package.json ./package.json

# The base image ships an unprivileged `node` user; nothing here needs root.
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "dist/http.js"]
