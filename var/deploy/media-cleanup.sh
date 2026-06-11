#!/bin/bash
# PostSider — Media cleanup script
# Removes orphaned files from MinIO older than 90 days
# 
# Add to crontab on VPS:
#   0 3 * * * /path/to/postsider/var/deploy/media-cleanup.sh >> /var/log/postsider-cleanup.log 2>&1
#
# This uses MinIO Client (mc) to list and remove old objects.
# Alternatively, configure MinIO lifecycle rules via the MinIO Console (port 9001).

set -e

# Load env
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Source production env for MinIO credentials
source "$PROJECT_DIR/.env.production" 2>/dev/null || true

MINIO_ALIAS="postsider-cleanup"
MINIO_HOST="${MINIO_ENDPOINT:-http://127.0.0.1:9000}"
BUCKET="${MINIO_BUCKET:-postsider-media}"
DAYS_TO_KEEP=${MEDIA_RETENTION_DAYS:-90}

echo "[$(date)] Starting media cleanup — removing files older than ${DAYS_TO_KEEP} days"

# Configure mc alias
docker exec postsider-minio mc alias set ${MINIO_ALIAS} ${MINIO_HOST} "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" 2>/dev/null

# Remove objects older than retention period
docker exec postsider-minio mc rm --recursive --force --older-than "${DAYS_TO_KEEP}d" ${MINIO_ALIAS}/${BUCKET}/ 2>/dev/null || true

echo "[$(date)] Cleanup complete"
