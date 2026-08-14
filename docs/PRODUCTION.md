# PostSider — Production Operations Guide

## Deployment

### First deployment

```bash
# On your VPS:
git clone <repo-url> /opt/postsider
cd /opt/postsider

# Deploy (generates secrets, starts services, sets up nginx + SSL)
chmod +x deploy.sh
./deploy.sh

# Set up automated backups
./var/deploy/setup-backup-cron.sh
```

### Updating

```bash
cd /opt/postsider
git pull origin main

# Rebuild and restart (migrations run automatically on startup)
sudo ./deploy.sh
```

---

## Database Migrations

PostSider uses **Prisma Migrate** for schema changes.

### Development workflow

```bash
# After modifying schema.prisma, create a new migration:
pnpm prisma-migrate-dev --name describe_your_change

# Check migration status:
pnpm prisma-migrate-status
```

### Production deployment

Migrations run automatically on app startup via `pnpm prisma-migrate-deploy`.
The root `deploy.sh` creates a pre-deploy PostgreSQL dump, tags the previous
image for rollback, recreates the stack, and fails hard if the app health gate
does not pass. Use `sudo ./deploy.sh --no-build` only for env-only restarts.

### Legacy Postiz data preflight

Before upgrading an existing Postiz database, remap legacy `Post.creationMethod`
values while the old enum still exists:

```sql
BEGIN;
UPDATE "Post"
SET "creationMethod" = 'API'
WHERE "creationMethod" IN ('MCP', 'AUTOPOST');
COMMIT;
```

The already-applied migration `20260628160000_remove_stripped_ai_models`
removes those enum values without a pre-update. If either value remains,
`migrate deploy` fails before it can reach a follow-up migration. Fresh
databases do not need this step. Do not modify that applied migration because
Prisma verifies its checksum.

### Baselining an existing database

If you already have a production database created with `prisma db push`:

```bash
# Mark the baseline migration as already applied (don't run the SQL):
pnpm dlx prisma@6.5.0 migrate resolve --applied 0_init \
  --schema ./libraries/nestjs-libraries/src/database/prisma/schema.prisma
```

---

## Backup & Restore

### Automated backups

Backups run every 6 hours via cron (set up by `setup-backup-cron.sh`).

- **Location:** `/opt/postsider-backups/`
- **Format:** `postsider_YYYYMMDD_HHMMSS.sql.gz` (pg_dump custom format, gzipped)
- **Retention:** 30 days
- **Log:** `/var/log/postsider-backup.log`
- **Scope:** PostgreSQL only. MinIO media is not included and needs a separate
  object-storage or Docker-volume backup.

### Manual backup

```bash
./var/deploy/backup.sh
```

### Restore from backup

```bash
# List available backups
./var/deploy/restore.sh

# Restore a specific backup (DESTRUCTIVE — drops current DB)
./var/deploy/restore.sh /opt/postsider-backups/postsider_20260610_120000.sql.gz
```

### Off-site backup (recommended)

Enable MinIO upload in backup.sh:

```bash
MINIO_BACKUP=true ./var/deploy/backup.sh
```

Or sync to external S3:

```bash
# Add to cron after backup.sh:
aws s3 sync /opt/postsider-backups/ s3://your-bucket/postsider-backups/ --storage-class STANDARD_IA
```

---

## Monitoring

### Health check

```bash
curl https://app.postsider.com/api/health
```

Response:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "startedAt": "2026-06-10T12:00:00.000Z",
  "uptime": 3600,
  "checks": {
    "redis": "ok",
    "database": "ok",
    "temporal": "ok"
  }
}
```

Worker health is a separate endpoint inside the app container:

```bash
docker exec postsider-app wget -qO- http://127.0.0.1:3002/health/workers
```

It must report `32/32` healthy workers in the current production image. Check
the `main` task queue for active pollers and zero backlog:

```bash
addr=$(docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' postsider-temporal)
docker exec postsider-temporal temporal task-queue describe --task-queue main --address "$addr:7233"
```

### Logs

```bash
# Application logs
docker compose -f docker-compose.production.yaml logs -f postsider

# All services
docker compose -f docker-compose.production.yaml logs -f

# Temporal workflows
# Open http://127.0.0.1:8080 (via SSH tunnel)
ssh -L 8080:127.0.0.1:8080 your-vps
```

### Sentry

Error tracking is configured via `@sentry/nestjs`. Set `NEXT_PUBLIC_SENTRY_DSN` in `.env.production` to enable.

---

## Disaster Recovery

### Database is down

```bash
# Check PostgreSQL status
docker compose -f docker-compose.production.yaml ps postsider-postgres

# Restart PostgreSQL
docker compose -f docker-compose.production.yaml restart postsider-postgres

# If data is corrupted — restore from backup:
docker compose -f docker-compose.production.yaml stop postsider
./var/deploy/restore.sh /opt/postsider-backups/postsider_LATEST.sql.gz
```

### Redis is down

```bash
# Redis is non-critical (rate limiting, caching). App degrades gracefully.
docker compose -f docker-compose.production.yaml restart postsider-redis
```

### MinIO is down

```bash
# Uploaded media becomes unavailable. Posts still publish but without images.
docker compose -f docker-compose.production.yaml restart postsider-minio
```

### Temporal is down

```bash
# Scheduled posts won't publish until Temporal recovers.
# Temporal auto-retries workflows once back online.
docker compose -f docker-compose.production.yaml restart temporal
```

### Full server recovery

1. Provision new VPS with Docker + nginx
2. Clone repository
3. Copy `.env.production` from backup (or regenerate via `deploy.sh`)
4. Restore database from latest `/opt/postsider-backups/` backup
5. Restore the separately backed-up MinIO media volume or objects
6. Run `sudo ./deploy.sh`

---

## Security

### Access control

- **pgAdmin**: Accessible only via SSH tunnel or IP whitelist (see `nginx-vps.conf`)
- **Temporal UI**: Localhost only (port 8080, access via SSH tunnel)
- **MinIO Console**: Localhost only (port 9001)

### Secret rotation

```bash
# Generate new JWT_SECRET (invalidates all sessions):
openssl rand -base64 64

# Generate new ENCRYPTION_KEY (requires re-encrypting provider credentials):
openssl rand -base64 32

# After changing secrets, restart:
docker compose -f docker-compose.production.yaml restart postsider
```

### SSL renewal

Certbot auto-renews via systemd timer. Verify:

```bash
sudo certbot renew --dry-run
```
