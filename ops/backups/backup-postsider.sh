#!/usr/bin/env bash
# Creates an encrypted, consistent Restic snapshot of PostSider state.
# Run as root only after /etc/postsider-backup.env has been configured.
set -Eeuo pipefail

CONFIG_FILE="${POSTSIDER_BACKUP_CONFIG:-/etc/postsider-backup.env}"

fail() {
  printf 'backup: %s\n' "$*" >&2
  exit 1
}

[[ $EUID -eq 0 ]] || fail 'must run as root so Docker volume data can be read'
[[ -r "$CONFIG_FILE" ]] || fail "missing configuration: $CONFIG_FILE"
# shellcheck disable=SC1090
source "$CONFIG_FILE"

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
: "${POSTSIDER_BACKUP_HOST:?POSTSIDER_BACKUP_HOST is required}"
: "${POSTGRES_CONTAINER:?POSTGRES_CONTAINER is required}"
: "${POSTGRES_DATABASE:?POSTGRES_DATABASE is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${TEMPORAL_POSTGRES_CONTAINER:?TEMPORAL_POSTGRES_CONTAINER is required}"
: "${TEMPORAL_POSTGRES_USER:?TEMPORAL_POSTGRES_USER is required}"
: "${MINIO_DATA_DIR:?MINIO_DATA_DIR is required}"
: "${N8N_DATA_DIR:?N8N_DATA_DIR is required}"
: "${BACKUP_QUIESCE_CONTAINERS:?BACKUP_QUIESCE_CONTAINERS is required}"

[[ -r "$RESTIC_PASSWORD_FILE" ]] || fail "cannot read RESTIC_PASSWORD_FILE: $RESTIC_PASSWORD_FILE"
[[ -d "$MINIO_DATA_DIR" ]] || fail "missing MinIO data: $MINIO_DATA_DIR"
[[ -d "$N8N_DATA_DIR" ]] || fail "missing n8n data: $N8N_DATA_DIR"
command -v restic >/dev/null || fail 'restic is not installed'
command -v docker >/dev/null || fail 'docker is not installed'

read -r -a quiesce_containers <<<"$BACKUP_QUIESCE_CONTAINERS"
((${#quiesce_containers[@]})) || fail 'BACKUP_QUIESCE_CONTAINERS cannot be empty'

tmp_dir="$(mktemp -d)"
stopped_containers=()
cleanup() {
  local exit_status=$?
  local container

  # Start only containers that this run found running and stopped. This keeps a
  # deliberately stopped service stopped while still recovering after failures.
  for ((i = ${#stopped_containers[@]} - 1; i >= 0; i--)); do
    container="${stopped_containers[i]}"
    if ! docker start "$container" >/dev/null; then
      printf 'backup: failed to restart %s; restart it immediately\n' "$container" >&2
      exit_status=1
    fi
  done
  rm -rf "$tmp_dir"
  trap - EXIT
  exit "$exit_status"
}
trap cleanup EXIT

# Validate every target before stopping any writer. In particular, do not treat
# a failed `docker inspect` as a stopped container: that would make a partial
# quiesce look safe while writers are still changing files.
for container in "${quiesce_containers[@]}"; do
  [[ "$container" != "$POSTGRES_CONTAINER" && "$container" != "$TEMPORAL_POSTGRES_CONTAINER" ]] ||
    fail 'database containers must not be in BACKUP_QUIESCE_CONTAINERS'
  if ! docker inspect --format '{{.State.Running}}' "$container" >/dev/null; then
    fail "cannot inspect quiesce container: $container"
  fi
done

# Stop application writers and file stores before dumping/copying volumes. The
# database containers remain up so pg_dump produces portable logical backups.
for container in "${quiesce_containers[@]}"; do
  if [[ "$(docker inspect --format '{{.State.Running}}' "$container")" == 'true' ]]; then
    docker stop "$container" >/dev/null
    stopped_containers+=("$container")
  fi
done

docker exec "$POSTGRES_CONTAINER" \
  pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DATABASE" >"$tmp_dir/postsider.dump"
docker exec "$TEMPORAL_POSTGRES_CONTAINER" \
  pg_dumpall -U "$TEMPORAL_POSTGRES_USER" >"$tmp_dir/temporal.sql"

# Tags and the explicit host are stable. Group by the same dimensions during
# retention so every run contributes to one daily/weekly/monthly history.
restic backup \
  --host "$POSTSIDER_BACKUP_HOST" \
  --tag postsider \
  --tag production \
  "$tmp_dir" \
  "$MINIO_DATA_DIR" \
  "$N8N_DATA_DIR"

restic forget --prune \
  --host "$POSTSIDER_BACKUP_HOST" \
  --tag postsider \
  --group-by host,tags \
  --keep-daily 30 \
  --keep-weekly 12 \
  --keep-monthly 12

restic check --read-data-subset=5%
printf 'backup: completed %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
