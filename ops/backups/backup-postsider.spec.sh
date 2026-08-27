#!/usr/bin/env bash
# Shell-level regression tests for backup quiesce validation.
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
script="$repo_root/ops/backups/backup-postsider.sh"
if [[ $EUID -ne 0 ]]; then
  printf 'SKIP: backup script requires root; run this test as root\n'
  exit 0
fi
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/bin" "$tmp_dir/minio" "$tmp_dir/n8n"
printf 'restic-password\n' >"$tmp_dir/restic-password"
cat >"$tmp_dir/backup.env" <<EOF
RESTIC_REPOSITORY=s3:https://example.invalid/postsider
RESTIC_PASSWORD_FILE=$tmp_dir/restic-password
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
POSTSIDER_BACKUP_HOST=test-host
POSTGRES_CONTAINER=postgres
POSTGRES_DATABASE=postsider
POSTGRES_USER=postsider
TEMPORAL_POSTGRES_CONTAINER=temporal-postgres
TEMPORAL_POSTGRES_USER=temporal
MINIO_DATA_DIR=$tmp_dir/minio
N8N_DATA_DIR=$tmp_dir/n8n
BACKUP_QUIESCE_CONTAINERS="writer-a writer-b"
EOF

cat >"$tmp_dir/bin/docker" <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "\$*" >>"$tmp_dir/docker.log"
case "\$1" in
  inspect)
    if [[ "\$4" == writer-a ]]; then
      printf 'true\n'
    else
      printf 'docker inspect failed\n' >&2
      exit 1
    fi
    ;;
  stop)
    exit 0
    ;;
  *)
    printf 'unexpected docker invocation: %s\n' "\$*" >&2
    exit 99
    ;;
esac
EOF
cat >"$tmp_dir/bin/restic" <<'EOF'
#!/usr/bin/env bash
exit 99
EOF
chmod +x "$tmp_dir/bin/docker" "$tmp_dir/bin/restic"

set +e
PATH="$tmp_dir/bin:$PATH" POSTSIDER_BACKUP_CONFIG="$tmp_dir/backup.env" bash "$script" >"$tmp_dir/stdout" 2>"$tmp_dir/stderr"
status=$?
set -e

[[ $status -ne 0 ]] || { printf 'expected backup script to fail when inspect fails\n' >&2; exit 1; }
[[ -f "$tmp_dir/docker.log" ]] || { printf 'backup script did not invoke docker\n' >&2; exit 1; }
if [[ -f "$tmp_dir/docker.log" ]] && grep -qx 'stop writer-a' "$tmp_dir/docker.log"; then
  printf 'backup stopped writer-a before validating writer-b\n' >&2
  exit 1
fi
printf 'PASS: inspect failure prevents all container stops\n'
