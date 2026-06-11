#!/bin/bash
# PostSider — Automated PostgreSQL Backup Script
# Designed for production VPS. Run via cron every 6 hours.
#
# Usage:
#   chmod +x var/deploy/backup.sh
#   ./var/deploy/backup.sh
#
# Cron example (every 6 hours):
#   0 */6 * * * /opt/postsider/var/deploy/backup.sh >> /var/log/postsider-backup.log 2>&1
#
# Environment variables (defaults pulled from docker-compose):
#   BACKUP_DIR        — where to store backups (default: /opt/postsider-backups)
#   BACKUP_RETENTION  — days to keep old backups (default: 30)
#   PG_CONTAINER      — postgres container name (default: postsider-postgres)
#   PG_USER           — postgres user (default: postsider)
#   PG_DB             — postgres database (default: postsider_prod)
#   MINIO_BACKUP      — if "true", also upload to MinIO (default: false)

set -euo pipefail

# ─── Configuration ───────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/opt/postsider-backups}"
BACKUP_RETENTION="${BACKUP_RETENTION:-30}"
PG_CONTAINER="${PG_CONTAINER:-postsider-postgres}"
PG_USER="${PG_USER:-postsider}"
PG_DB="${PG_DB:-postsider_prod}"
MINIO_BACKUP="${MINIO_BACKUP:-false}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="postsider_${TIMESTAMP}.sql.gz"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILE}"

# ─── Setup ───────────────────────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}"

echo "[$(date -Iseconds)] Starting backup..."

# ─── Dump database ───────────────────────────────────────────────────────────
docker exec "${PG_CONTAINER}" pg_dump \
  -U "${PG_USER}" \
  -d "${PG_DB}" \
  --no-owner \
  --no-privileges \
  --format=custom \
  | gzip > "${BACKUP_PATH}"

FILESIZE=$(du -h "${BACKUP_PATH}" | cut -f1)
echo "[$(date -Iseconds)] Backup created: ${BACKUP_PATH} (${FILESIZE})"

# ─── Verify backup integrity ────────────────────────────────────────────────
if ! gzip -t "${BACKUP_PATH}" 2>/dev/null; then
  echo "[$(date -Iseconds)] ERROR: Backup file is corrupted!"
  rm -f "${BACKUP_PATH}"
  exit 1
fi

echo "[$(date -Iseconds)] Backup integrity verified."

# ─── Upload to MinIO (optional) ─────────────────────────────────────────────
if [ "${MINIO_BACKUP}" = "true" ]; then
  MINIO_ALIAS="${MINIO_ALIAS:-myminio}"
  MINIO_BUCKET="${MINIO_BACKUP_BUCKET:-postsider-backups}"

  if command -v mc &>/dev/null; then
    mc cp "${BACKUP_PATH}" "${MINIO_ALIAS}/${MINIO_BUCKET}/${BACKUP_FILE}"
    echo "[$(date -Iseconds)] Uploaded to MinIO: ${MINIO_ALIAS}/${MINIO_BUCKET}/${BACKUP_FILE}"
  else
    echo "[$(date -Iseconds)] WARNING: mc (MinIO client) not found, skipping upload."
  fi
fi

# ─── Cleanup old backups ────────────────────────────────────────────────────
DELETED=$(find "${BACKUP_DIR}" -name "postsider_*.sql.gz" -mtime +"${BACKUP_RETENTION}" -delete -print | wc -l)
if [ "${DELETED}" -gt 0 ]; then
  echo "[$(date -Iseconds)] Cleaned up ${DELETED} backup(s) older than ${BACKUP_RETENTION} days."
fi

echo "[$(date -Iseconds)] Backup complete."
