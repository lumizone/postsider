#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# PostSider — Production deploy script (VPS)
# ─────────────────────────────────────────────────────────────────────────────
# What it does:
#   1. Verifies prerequisites (docker + compose plugin).
#   2. Ensures .env.production exists; auto-fills any remaining CHANGE_ME
#      placeholders with strong random secrets (a timestamped backup is kept).
#   3. Builds the image with the NEXT_PUBLIC_* build args baked in.
#   4. Starts the full stack and waits for the app to become healthy.
#
# Database migrations run automatically inside the container on startup
# (pm2-run → prisma-migrate-deploy). For the very first install, create the
# initial admin afterwards:  ./deploy.sh --bootstrap   (or see README).
#
# Usage:
#   ./deploy.sh              # build + deploy
#   ./deploy.sh --bootstrap  # build + deploy, then create the first admin user
#   ./deploy.sh --no-build   # (re)start without rebuilding the image
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_FILE=".env.production"
COMPOSE_FILE="docker-compose.production.yaml"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

BOOTSTRAP=false
DO_BUILD=true
for arg in "$@"; do
  case "$arg" in
    --bootstrap) BOOTSTRAP=true ;;
    --no-build)  DO_BUILD=false ;;
    -h|--help)   sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

log()  { printf '\033[1;34m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 1. Prerequisites ─────────────────────────────────────────────────────────
log "Checking prerequisites"
command -v docker >/dev/null 2>&1 || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "the docker compose plugin is not installed"
command -v openssl >/dev/null 2>&1 || die "openssl is required to generate secrets"
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "${ENV_FILE}.example" ]]; then
    cp "${ENV_FILE}.example" "$ENV_FILE"
    warn "Created $ENV_FILE from ${ENV_FILE}.example — review it and set your domain + OAuth keys."
  else
    die "$ENV_FILE not found and no ${ENV_FILE}.example to copy from."
  fi
fi
ok "Prerequisites OK"

# ── 2. Auto-fill remaining CHANGE_ME secrets ─────────────────────────────────
# Replaces VAR=...CHANGE_ME... lines with a freshly generated secret. Values you
# already set by hand are left untouched. A backup is written before any change.
fill_secret() {
  local var="$1" value="$2"
  if grep -qE "^${var}=.*CHANGE_ME" "$ENV_FILE"; then
    # Escape & and / for sed replacement safety.
    local esc=${value//\\/\\\\}; esc=${esc//&/\\&}; esc=${esc//\//\\/}
    sed -i.bak "s/^${var}=.*/${var}=\"${esc}\"/" "$ENV_FILE"
    ok "Generated ${var}"
  fi
}

if grep -qE "CHANGE_ME" "$ENV_FILE"; then
  log "Filling remaining CHANGE_ME placeholders with random secrets"
  cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
  fill_secret JWT_SECRET        "$(openssl rand -base64 64 | tr -d '\n')"
  fill_secret ENCRYPTION_KEY    "$(openssl rand -base64 32 | tr -d '\n')"
  fill_secret POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  fill_secret MINIO_ACCESS_KEY  "postsider-$(openssl rand -hex 8)"
  fill_secret MINIO_SECRET_KEY  "$(openssl rand -hex 32)"
  fill_secret DBGATE_PASSWORD   "$(openssl rand -hex 16)"
  rm -f "${ENV_FILE}.bak"
fi

# Any CHANGE_ME left now is a non-secret placeholder the operator must set
# (e.g. domain-specific or provider values) — warn but don't block.
if grep -qE "CHANGE_ME" "$ENV_FILE"; then
  warn "Some CHANGE_ME values remain in $ENV_FILE — review them:"
  grep -nE "CHANGE_ME" "$ENV_FILE" | sed 's/^/    /' || true
fi

# ── 3. Load env so compose can interpolate build args ────────────────────────
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
[[ -n "${NEXT_PUBLIC_BACKEND_URL:-}" ]] || die "NEXT_PUBLIC_BACKEND_URL is empty in $ENV_FILE"

# ── 4. Build + start ─────────────────────────────────────────────────────────
if $DO_BUILD; then
  log "Building image (NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL)"
  "${COMPOSE[@]}" build
fi

log "Starting stack"
"${COMPOSE[@]}" up -d

# ── 5. Wait for health ───────────────────────────────────────────────────────
log "Waiting for the app container to become healthy (up to ~3 min)"
deadline=$(( $(date +%s) + 180 ))
while true; do
  status=$(docker inspect --format '{{.State.Health.Status}}' postsider-app 2>/dev/null || echo "starting")
  case "$status" in
    healthy) ok "App is healthy"; break ;;
    unhealthy) die "App became unhealthy. Check logs: ${COMPOSE[*]} logs postsider" ;;
  esac
  [[ $(date +%s) -lt $deadline ]] || { warn "Timed out waiting for health. Tail logs with: ${COMPOSE[*]} logs -f postsider"; break; }
  sleep 5
done

# ── 6. Optional: bootstrap first admin ───────────────────────────────────────
if $BOOTSTRAP; then
  log "Creating the first admin user"
  # Run the compiled CLI directly. `pnpm bootstrap` would try to rebuild from
  # source, which isn't present in the slim runtime image.
  BOOT="apps/commands/dist/apps/commands/src/bootstrap.main.js"
  docker exec -it postsider-app node "$BOOT" bootstrap \
    || warn "Bootstrap failed — run it manually: docker exec -it postsider-app node $BOOT bootstrap"
fi

ok "Deploy complete."
echo "   Next: point your host reverse proxy (Caddy/nginx) at 127.0.0.1:5000 with HTTPS."
echo "   Logs: ${COMPOSE[*]} logs -f postsider"
