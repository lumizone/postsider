#!/bin/bash
# PostSider SaaS — VPS Deployment Script
# Run this on your VPS after cloning the repo
#
# Prerequisites:
#   - Docker + Docker Compose installed
#   - nginx installed on host
#   - certbot installed for SSL
#   - Domain DNS pointing to VPS IP:
#     - app.postsider.com → VPS_IP
#     - db.postsider.com  → VPS_IP
#
# Usage:
#   chmod +x var/deploy/deploy.sh
#   ./var/deploy/deploy.sh

set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PostSider SaaS — Production Deployment"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ─── 1. Generate secure passwords if not set ─────────────────────────────────
if grep -q "CHANGE_ME" .env.production; then
    echo "⚠️  Detected placeholder passwords in .env.production"
    echo "   Generating secure random values..."
    
    JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
    ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '\n')
    DB_PASSWORD=$(openssl rand -base64 24 | tr -d '\n/+=')
    MINIO_KEY=$(openssl rand -hex 10)
    MINIO_SECRET=$(openssl rand -base64 32 | tr -d '\n/+=')
    DBGATE_PWD=$(openssl rand -base64 16 | tr -d '\n/+=')

    sed -i "s|CHANGE_ME_GENERATE_WITH_openssl_rand_base64_64|${JWT_SECRET}|g" .env.production
    sed -i "s|CHANGE_ME_GENERATE_WITH_openssl_rand_base64_32|${ENCRYPTION_KEY}|g" .env.production
    sed -i "s|CHANGE_ME_DB_PASSWORD|${DB_PASSWORD}|g" .env.production
    sed -i "s|CHANGE_ME_MINIO_ACCESS_KEY|${MINIO_KEY}|g" .env.production
    sed -i "s|CHANGE_ME_MINIO_SECRET_KEY|${MINIO_SECRET}|g" .env.production
    sed -i "s|CHANGE_ME_DBGATE_PASSWORD|${DBGATE_PWD}|g" .env.production

    echo "   ✔ Passwords generated and saved to .env.production"
    echo ""
    echo "   ┌─────────────────────────────────────────────┐"
    echo "   │  SAVE THESE CREDENTIALS SOMEWHERE SAFE:     │"
    echo "   │                                             │"
    echo "   │  DbGate:  login / ${DBGATE_PWD}"
    echo "   │  DB User: postsider / ${DB_PASSWORD}"
    echo "   │  MinIO:   ${MINIO_KEY} / ${MINIO_SECRET}"
    echo "   └─────────────────────────────────────────────┘"
    echo ""
fi

# ─── 2. Create dynamicconfig for Temporal ────────────────────────────────────
mkdir -p dynamicconfig
if [ ! -f dynamicconfig/development-sql.yaml ]; then
    cat > dynamicconfig/development-sql.yaml << 'EOF'
system.forceSearchAttributesCacheRefreshOnRead:
  - value: true
    constraints: {}
EOF
    echo "✔ Temporal dynamic config created"
fi

# ─── 3. Start services ──────────────────────────────────────────────────────
echo ""
echo "Starting PostSider stack..."
docker compose -f docker-compose.production.yaml --env-file .env.production up -d --build

echo ""
echo "Waiting for services to be healthy..."
sleep 10

# ─── 4. Run database migrations ─────────────────────────────────────────────
echo ""
echo "Running Prisma migrations..."
docker compose -f docker-compose.production.yaml exec postsider \
    npx prisma migrate deploy --schema ./libraries/nestjs-libraries/src/database/prisma/schema.prisma

# ─── 5. Bootstrap first admin (only if DB is empty) ─────────────────────────
echo ""
echo "Bootstrapping admin user..."
docker compose -f docker-compose.production.yaml exec postsider \
    pnpm run bootstrap 2>/dev/null || echo "   (skipped — users already exist)"

# ─── 6. Setup nginx on host ─────────────────────────────────────────────────
echo ""
if [ ! -f /etc/nginx/sites-available/postsider.conf ]; then
    echo "Setting up nginx..."
    sudo cp var/deploy/nginx-vps.conf /etc/nginx/sites-available/postsider.conf
    sudo ln -sf /etc/nginx/sites-available/postsider.conf /etc/nginx/sites-enabled/postsider.conf
    sudo nginx -t && sudo systemctl reload nginx
    echo "✔ nginx configured"
    
    echo ""
    echo "Setting up SSL with certbot..."
    sudo certbot --nginx -d app.postsider.com -d db.postsider.com --non-interactive --agree-tos -m admin@postsider.com || \
        echo "⚠️  Certbot failed — run manually: sudo certbot --nginx -d app.postsider.com -d db.postsider.com"
else
    echo "✔ nginx config already exists, skipping"
fi

# ─── 7. Status ──────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✔ PostSider SaaS is running!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  App:        https://app.postsider.com"
echo "  Database:   https://db.postsider.com"
echo "  MinIO UI:   http://127.0.0.1:9001 (localhost only)"
echo "  Temporal:   http://127.0.0.1:8080 (localhost only)"
echo ""
echo "  Useful commands:"
echo "    docker compose -f docker-compose.production.yaml logs -f postsider"
echo "    docker compose -f docker-compose.production.yaml restart postsider"
echo "    docker compose -f docker-compose.production.yaml down"
echo ""
