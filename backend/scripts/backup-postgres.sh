#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the PostgreSQL database to back up}"

# Prisma URLs commonly include ?schema=public. libpq (pg_dump/pg_restore)
# doesn't use that Prisma-only parameter, so remove only the schema parameter
# while preserving SSL and all other connection options.
normalize_pg_url() {
  local input="$1" base query item output="" separator=""
  if [[ "$input" != *\?* ]]; then
    printf '%s' "$input"
    return
  fi
  base="${input%%\?*}"
  query="${input#*\?}"
  IFS='&' read -r -a items <<< "$query"
  for item in "${items[@]}"; do
    [[ -z "$item" || "${item%%=*}" == "schema" ]] && continue
    output+="$separator$item"
    separator='&'
  done
  if [[ -n "$output" ]]; then printf '%s?%s' "$base" "$output"; else printf '%s' "$base"; fi
}
pg_database_url="$(normalize_pg_url "$DATABASE_URL")"

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

pg_dump --format=custom --no-owner --no-acl --file="$destination" "$pg_database_url"
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

# Rotate local backups only after the new archive passed pg_restore --list and
# its checksum has been written. The cleanup is restricted to this app's prefix.
retention_days="${BACKUP_RETENTION_DAYS:-30}"
if [[ ! "$retention_days" =~ ^[1-9][0-9]*$ ]]; then
  echo "BACKUP_RETENTION_DAYS must be a positive integer." >&2
  exit 2
fi
while IFS= read -r -d '' old_backup; do
  rm -f -- "$old_backup" "${old_backup}.sha256"
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'vivarqo-*.dump' -mtime "+${retention_days}" -print0)
