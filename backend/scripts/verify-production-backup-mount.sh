#!/usr/bin/env bash
set -Eeuo pipefail

backup_dir="${1:-}"
if [[ -z "$backup_dir" ]]; then
  echo "Usage: sudo backend/scripts/verify-production-backup-mount.sh /mnt/vivarqo-prod-backups" >&2
  exit 2
fi
if [[ "$backup_dir" != /* ]]; then
  echo "Backup directory must be an absolute path." >&2
  exit 2
fi

for command in docker mountpoint stat; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "$command is required on the production Docker host." >&2
    exit 127
  }
done

if [[ ! -d "$backup_dir" ]]; then
  echo "Backup directory does not exist: $backup_dir" >&2
  exit 2
fi
if ! mountpoint -q "$backup_dir"; then
  echo "Backup directory is not a mount point. Mount a dedicated persistent disk/volume before starting Vivarqo." >&2
  exit 1
fi

docker_root="$(docker info --format '{{.DockerRootDir}}')"
if [[ ! -d "$docker_root" ]]; then
  echo "Docker data root is unavailable; cannot verify backup-device separation." >&2
  exit 1
fi

backup_device="$(stat -c '%d' "$backup_dir")"
docker_device="$(stat -c '%d' "$docker_root")"
if [[ "$backup_device" == "$docker_device" ]]; then
  echo "Backup storage and Docker data root are on the same filesystem device. Use a separate disk/volume." >&2
  exit 1
fi

printf 'Verified: backup mount %s is on a different filesystem from Docker data root %s.\n' "$backup_dir" "$docker_root"
printf 'Next: configure encrypted off-host replication and test restore on a different host.\n'
