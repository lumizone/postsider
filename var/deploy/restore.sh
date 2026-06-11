#!/bin/bash
# PostSider — Database Restore Script
# Restores a pg_dump backup created by backup.sh
#
# Usage:
#   ./var/deploy/restore.sh /path/to/postsider_20260610_120000.sql.gz
#
# WARNING: This will DROP and recreate the database. All existing data will be lost.

set -euo pipefail

BACKUP_FILE="${1:-}"
PG_CONTAINER="${PG_CONTAINER:-postsider-postgres}"
PG_USER="${PG_USER:-postsider}"
PG_DB="${PG_DB:-postsider_prod}"

if [ -z "${BACKUP_FILE}" ]; then
  echo "Usage: $0 <backup-file.sql.gz>"
  echo ""
  echo "Available backups:"
  ls -lhtr /opt/postsider-backups/postsider_*.sql.gz 2>/dev/null || echo "  No backups found in /opt/postsider-backups/"
  exit 1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "ERROR: File not found: ${BACKUP_FILE}"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ⚠️  DATABASE RESTORE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Source:    ${BACKUP_FILE}"
echo "  Target:    ${PG_DB} @ ${PG_CONTAINER}"
echo ""
echo "  This will DESTROY all current data in ${PG_DB}."
echo ""
read -p "  Type 'RESTORE' to confirm: " CONFIRM

if [ "${CONFIRM}" != "RESTORE" ]; then
  echo "Aborted."
  exit 0
fi

echo ""
echo "[$(date -Iseconds)] Stopping PostSider app..."
docker compose -f docker-compose.production.yaml stop postsider || true

echo "[$(date -Iseconds)] Dropping and recreating database..."
docker exec "${PG_CONTAINER}" dropdb -U "${PG_USER}" --if-exists "${PG_DB}"
docker exec "${PG_CONTAINER}" createdb -U "${PG_USER}" "${PG_DB}"

echo "[$(date -Iseconds)] Restoring from backup..."
gunzip -c "${BACKUP_FILE}" | docker exec -i "${PG_CONTAINER}" pg_restore \
  -U "${PG_USER}" \
  -d "${PG_DB}" \
  --no-owner \
  --no-privileges \
  --single-transaction \
  2>&1 | tail -5

echo "[$(date -Iseconds)] Restarting PostSider app..."
docker compose -f docker-compose.production.yaml start postsider

echo ""
echo "[$(date -Iseconds)] ✔ Restore complete. Verify at https://app.postsider.com"
