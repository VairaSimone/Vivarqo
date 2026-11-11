#!/bin/sh
set -eu

: "${POSTGRES_HOST:?POSTGRES_HOST is required}"
: "${POSTGRES_PORT:?POSTGRES_PORT is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD_FILE:?POSTGRES_PASSWORD_FILE is required}"
: "${BACKUP_RETENTION_DAYS:=30}"
: "${BACKUP_INTERVAL_SECONDS:=86400}"

case "$BACKUP_RETENTION_DAYS" in ""|*[!0-9]*) echo "BACKUP_RETENTION_DAYS must be a positive integer" >&2; exit 2 ;; esac
case "$BACKUP_INTERVAL_SECONDS" in ""|*[!0-9]*) echo "BACKUP_INTERVAL_SECONDS must be a positive integer" >&2; exit 2 ;; esac
[ "$BACKUP_RETENTION_DAYS" -ge 1 ] || { echo "BACKUP_RETENTION_DAYS must be >= 1" >&2; exit 2; }
[ "$BACKUP_INTERVAL_SECONDS" -ge 3600 ] || { echo "BACKUP_INTERVAL_SECONDS must be >= 3600" >&2; exit 2; }
[ -r "$POSTGRES_PASSWORD_FILE" ] || { echo "PostgreSQL admin password secret is unreadable" >&2; exit 2; }

umask 077
mkdir -p /backups
chmod 700 /backups
PGPASSWORD="$(cat "$POSTGRES_PASSWORD_FILE")"
[ -n "$PGPASSWORD" ] || { echo "PostgreSQL admin password secret is empty" >&2; exit 2; }
export PGPASSWORD

while :; do
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  archive="/backups/vivarqo-$timestamp.dump"
  temporary="$archive.partial"
  checksum="$archive.sha256.partial"
  hash=""

  echo "Starting Vivarqo PostgreSQL backup: $(basename "$archive")"
  if pg_dump --host="$POSTGRES_HOST" --port="$POSTGRES_PORT" \
       --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
       --format=custom --no-owner --no-acl --file="$temporary" \
    && pg_restore --list "$temporary" >/dev/null; then
    hash="$(sha256sum "$temporary" | awk '{print $1}')"
    if mv "$temporary" "$archive" \
      && printf '%s  %s\n' "$hash" "$(basename "$archive")" > "$checksum" \
      && chmod 600 "$archive" "$checksum" \
      && mv "$checksum" "$archive.sha256"; then
      echo "Backup archive created and verified: $(basename "$archive")"
      find /backups -maxdepth 1 -type f -name 'vivarqo-*.dump' -mtime "+$BACKUP_RETENTION_DAYS" -print |
        while IFS= read -r old_archive; do rm -f -- "$old_archive" "$old_archive.sha256"; done
      sleep "$BACKUP_INTERVAL_SECONDS"
      continue
    fi
  fi

  echo "Vivarqo PostgreSQL backup failed; partial artifacts removed and retry scheduled." >&2
  rm -f -- "$temporary" "$checksum" "$archive"
  sleep 300
done
