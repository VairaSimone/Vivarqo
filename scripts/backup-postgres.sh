#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the PostgreSQL database to back up}"
command -v pg_dump >/dev/null 2>&1 || { echo "pg_dump is required (install PostgreSQL client tools)." >&2; exit 127; }
command -v pg_restore >/dev/null 2>&1 || { echo "pg_restore is required (install PostgreSQL client tools)." >&2; exit 127; }

BACKUP_DIR="${BACKUP_DIR:-./backups}"
umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="${BACKUP_DIR%/}/vivarqo-${timestamp}.dump"
if [[ -e "$destination" ]]; then
  echo "Backup file already exists: $destination" >&2
  exit 1
fi

pg_dump --format=custom --no-owner --no-acl --file="$destination" "$DATABASE_URL"
if ! pg_restore --list "$destination" >/dev/null; then
  rm -f "$destination"
  echo "Backup verification failed; incomplete file removed." >&2
  exit 1
fi

chmod 600 "$destination"
checksum="$(sha256sum "$destination" | awk '{print $1}')"
printf '%s\n' "$checksum" > "${destination}.sha256"
chmod 600 "${destination}.sha256"
printf 'Backup completed and verified: %s\nSHA-256: %s\n' "$destination" "$checksum"
