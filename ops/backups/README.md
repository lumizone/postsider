# PostSider off-site backup runbook

This directory is deliberately **not activated** yet. It contains the production-ready backup job for the moment a Backblaze B2 bucket and restricted S3 key are created.

## What it protects

- `postsider` PostgreSQL logical dump
- Temporal PostgreSQL logical dump
- the MinIO media volume
- n8n state from `/root/.n8n`

All data is encrypted client-side by Restic before it leaves the VPS.

## Activation on the production VPS

1. Install Restic from the distribution package repository.
2. Create a B2 bucket dedicated to backups and an application key restricted to that bucket.
3. Copy `postsider-backup.env.example` to `/etc/postsider-backup.env`, fill the B2 S3 endpoint, key ID, secret and repository location, then run `chmod 600 /etc/postsider-backup.env`.
4. Generate a separate Restic repository password into `/etc/postsider-backup.password`, set that path as `RESTIC_PASSWORD_FILE`, then run `chmod 600 /etc/postsider-backup.password`.
5. Initialize the empty repository once with `restic init` using the environment file.
6. Install `backup-postsider.sh` as `/usr/local/sbin/backup-postsider` (`chmod 700`) and schedule it with a systemd timer.
7. Run the job manually once during a maintenance window: it stops the configured application writers and file services, leaves both PostgreSQL containers up for logical dumps, then restarts only containers it stopped even if the job fails. Verify `restic snapshots`, then restore one database dump and one media object into a disposable directory before considering the setup complete.

## Safety properties

- The job refuses to run without root, a config file, Restic, all B2 variables, explicit database/container/user configuration, explicit data paths and a readable repository password.
- Application writers and file stores listed in `BACKUP_QUIESCE_CONTAINERS` are stopped before the logical dumps and volume copy; an EXIT trap restarts exactly those that were running when the job began.
- Database dumps are made to a temporary directory which is removed after the snapshot.
- Stable `postsider`/`production` tags plus `POSTSIDER_BACKUP_HOST` are used with Restic `--group-by host,tags`, so retention keeps 30 daily, 12 weekly and 12 monthly restore points for this deployment.
- Every run executes a 5% Restic read-data check.

Do not commit the real environment file, B2 secret or Restic password.
