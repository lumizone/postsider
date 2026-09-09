#!/bin/bash
# PostSider — Setup automated backup cron job
# Run once on the VPS after deployment.
#
# Usage:
#   chmod +x var/deploy/setup-backup-cron.sh
#   ./var/deploy/setup-backup-cron.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_SCRIPT="${SCRIPT_DIR}/backup.sh"

if [ ! -f "${BACKUP_SCRIPT}" ]; then
  echo "ERROR: backup.sh not found at ${BACKUP_SCRIPT}"
  exit 1
fi

chmod +x "${BACKUP_SCRIPT}"

# Create log directory
sudo mkdir -p /var/log
sudo touch /var/log/postsider-backup.log

# Add cron job (every 6 hours)
CRON_LINE="0 */6 * * * ${BACKUP_SCRIPT} >> /var/log/postsider-backup.log 2>&1"

# Check if already installed
if crontab -l 2>/dev/null | grep -qF "${BACKUP_SCRIPT}"; then
  echo "✔ Backup cron already installed."
else
  (crontab -l 2>/dev/null; echo "${CRON_LINE}") | crontab -
  echo "✔ Backup cron installed: every 6 hours"
fi

echo ""
echo "  Schedule: 0 */6 * * * (every 6 hours)"
echo "  Script:   ${BACKUP_SCRIPT}"
echo "  Log:      /var/log/postsider-backup.log"
echo "  Storage:  /opt/postsider-backups/ (30 days retention)"
echo ""
echo "  To test immediately: ${BACKUP_SCRIPT}"
echo "  To view cron: crontab -l"
