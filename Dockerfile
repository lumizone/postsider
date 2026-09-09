# ─────────────────────────────────────────────────────────────────────────────
# PostSider — Production Multi-Stage Dockerfile
# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Install dependencies + build
# Stage 2: Minimal runtime image (no build tools, no devDependencies)
# ─────────────────────────────────────────────────────────────────────────────

# === Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:22.20-bookworm-slim AS builder

# Next.js inlines NEXT_PUBLIC_* variables into the client bundle at BUILD time.
# They must be present here, not just at runtime, otherwise the browser falls
# back to http://localhost:3000 and every API call from the dashboard fails.
ARG NEXT_PUBLIC_VERSION
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_SELF_HOSTED="true"
ARG NEXT_PUBLIC_TELEGRAM_BOT_NAME
ARG NEXT_PUBLIC_DISABLE_REGISTRATION
ENV NEXT_PUBLIC_VERSION=$NEXT_PUBLIC_VERSION
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_SELF_HOSTED=$NEXT_PUBLIC_SELF_HOSTED
ENV NEXT_PUBLIC_TELEGRAM_BOT_NAME=$NEXT_PUBLIC_TELEGRAM_BOT_NAME
ENV NEXT_PUBLIC_DISABLE_REGISTRATION=$NEXT_PUBLIC_DISABLE_REGISTRATION

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    make \
    python3-pip \
    bash \
    openssl \
  && rm -rf /var/lib/apt/lists/*

RUN npm --no-update-notifier --no-fund --global install pnpm@10.6.1

WORKDIR /build

# Copy package files first for better layer caching. All workspace packages
# must be present so `pnpm install --frozen-lockfile` matches the lockfile
# importers (apps/backend, apps/commands, apps/frontend, apps/orchestrator,
# apps/sdk, apps/mcp). The libraries/* dirs are not pnpm packages (no package.json) —
# they are shared source consumed via TS path aliases and arrive with COPY . .
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/backend/package.json apps/backend/
COPY apps/frontend/package.json apps/frontend/
COPY apps/commands/package.json apps/commands/
COPY apps/orchestrator/package.json apps/orchestrator/
COPY apps/sdk/package.json apps/sdk/
COPY apps/mcp/package.json apps/mcp/

# The root postinstall hook runs `prisma generate`, which needs the schema.
# Copy it before install so the hook succeeds (and native deps like bcrypt
# still build — so we can't use --ignore-scripts here).
COPY libraries/nestjs-libraries/src/database/prisma libraries/nestjs-libraries/src/database/prisma

# Install all dependencies (including dev for build)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma client
RUN pnpm run prisma-generate

# Build everything (backend + orchestrator)
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm run build

# Build the commands app (CLI used by `pnpm bootstrap` to create the first admin)
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm --filter ./apps/commands run build

# Build frontend
RUN pnpm --filter ./apps/frontend run build

# Prune devDependencies
RUN pnpm prune --prod


# === Stage 2: Runtime ────────────────────────────────────────────────────────
FROM node:22.20-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    openssl \
    wget \
    tini \
  && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN addgroup --system postsider \
  && adduser --system --ingroup postsider --home /app --shell /usr/sbin/nologin postsider \
  && mkdir -p /uploads /var/log/nginx /var/lib/nginx /run \
  && chown -R postsider:postsider /uploads /var/log/nginx /var/lib/nginx /run

RUN npm --no-update-notifier --no-fund --global install pnpm@10.6.1 pm2

WORKDIR /app

# Copy built application from builder
COPY --from=builder --chown=postsider:postsider /build/node_modules ./node_modules
COPY --from=builder --chown=postsider:postsider /build/package.json ./package.json
COPY --from=builder --chown=postsider:postsider /build/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder --chown=postsider:postsider /build/pnpm-workspace.yaml ./pnpm-workspace.yaml

# Backend
COPY --from=builder --chown=postsider:postsider /build/apps/backend/dist ./apps/backend/dist
COPY --from=builder --chown=postsider:postsider /build/apps/backend/package.json ./apps/backend/package.json

# Frontend (built Next.js)
COPY --from=builder --chown=postsider:postsider /build/apps/frontend/.next ./apps/frontend/.next
COPY --from=builder --chown=postsider:postsider /build/apps/frontend/public ./apps/frontend/public
COPY --from=builder --chown=postsider:postsider /build/apps/frontend/package.json ./apps/frontend/package.json
COPY --from=builder --chown=postsider:postsider /build/apps/frontend/next.config.mjs ./apps/frontend/next.config.mjs
# NOTE: apps/frontend/node_modules is intentionally NOT copied. With
# node-linker=hoisted (.npmrc) and no workspace: deps in the frontend, pnpm
# places all third-party deps (next, react, ...) in the ROOT node_modules
# (copied above). apps/frontend/node_modules is never created; next start
# resolves deps from the root via Node's upward module resolution.

# Orchestrator (Temporal worker: scheduled publishing + token refresh)
COPY --from=builder --chown=postsider:postsider /build/apps/orchestrator/dist ./apps/orchestrator/dist
COPY --from=builder --chown=postsider:postsider /build/apps/orchestrator/package.json ./apps/orchestrator/package.json

# Commands app
COPY --from=builder --chown=postsider:postsider /build/apps/commands/dist ./apps/commands/dist
COPY --from=builder --chown=postsider:postsider /build/apps/commands/package.json ./apps/commands/package.json

# Libraries (needed at runtime for Prisma schema + shared modules)
COPY --from=builder --chown=postsider:postsider /build/libraries ./libraries

# Prisma generated client
COPY --from=builder --chown=postsider:postsider /build/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=postsider:postsider /build/node_modules/@prisma ./node_modules/@prisma

# Nginx config
COPY --chown=postsider:postsider var/docker/nginx.conf /etc/nginx/nginx.conf

# Prisma migrations (for prisma migrate deploy)
COPY --from=builder --chown=postsider:postsider /build/libraries/nestjs-libraries/src/database/prisma/migrations ./libraries/nestjs-libraries/src/database/prisma/migrations

# Scripts
COPY --from=builder --chown=postsider:postsider /build/scripts ./scripts

# pm2 process definitions (starts each app as `node` directly — see the file)
COPY --from=builder --chown=postsider:postsider /build/ecosystem.config.js ./ecosystem.config.js

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=60s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/api/health || exit 1

# Drop root: the `postsider` user existed since the beginning but was never
# switched to, so pm2 and all three node apps ran as root — with 512MB uploads
# and a public API that is more blast radius than this container needs. nginx
# binds :5000 (unprivileged) and /run, /var/log/nginx, /var/lib/nginx, /uploads
# and /app are all postsider-owned above. pm2 state moves to /app/.pm2.
ENV PM2_HOME=/app/.pm2
USER postsider

# Use tini as init process for proper signal handling
ENTRYPOINT ["tini", "--"]

# Start nginx + application via pm2.
#
# `exec` (and NOT going through `pnpm run pm2`) is deliberate: it makes
# pm2-runtime the direct child of tini, so a `docker stop` SIGTERM actually
# reaches the supervisor and each app gets its kill_timeout to drain. Routed
# through pnpm the signal died in the wrapper chain and everything was SIGKILLed
# 10s later. pm2-runtime also keeps pm2 in the foreground, so no `pm2 logs` tail
# is needed to hold the container open.
CMD ["sh", "-c", "nginx && pnpm run prisma-migrate-deploy && exec pm2-runtime start ecosystem.config.js"]

EXPOSE 5000
