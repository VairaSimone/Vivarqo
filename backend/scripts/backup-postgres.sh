#!/usr/bin/env bash
set -Eeuo pipefail

# The CI runner may also have an older PostgreSQL client on /usr/bin.
# Prefer the project/server PostgreSQL 18 client when the PGDG package exists.
if [[ -x /usr/lib/postgresql/18/bin/pg_dump ]]; then
  PATH="/usr/lib/postgresql/18/bin:$PATH"
  export PATH
fi

: "${DATABASE_URL:?Set DATABASE_URL to the PostgreSQL database to back up}"
for command in pg_dump pg_restore node sha256sum; do
  command -v "$command" >/dev/null 2>&1 || { echo "$command is required (install PostgreSQL client tools)." >&2; exit 127; }
done

BACKUP_DIR="${BACKUP_DIR:-./backups}"
retention_days="${BACKUP_RETENTION_DAYS:-30}"
if [[ ! "$retention_days" =~ ^[1-9][0-9]*$ ]]; then
  echo "BACKUP_RETENTION_DAYS must be a positive integer." >&2
  exit 2
fi
umask 077
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
PG_DATABASE_URL="$(node backend/scripts/postgres-tool-url.mjs)"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
destination="${BACKUP_DIR%/}/vivarqo-${timestamp}.dump"
[[ ! -e "$destination" && ! -e "${destination}.sha256" ]] || { echo "Backup already exists: $destination" >&2; exit 1; }

temporary="${destination}.partial"
trap 'rm -f "$temporary"' EXIT
pg_dump --format=custom --no-owner --no-acl --file="$temporary" "$PG_DATABASE_URL"
pg_restore --list "$temporary" >/dev/null
mv "$temporary" "$destination"
chmod 600 "$destination"
checksum="$(sha256sum "$destination" | awk '{print $1}')"
printf '%s  %s\n' "$checksum" "$(basename "$destination")" > "${destination}.sha256"
chmod 600 "${destination}.sha256"
trap - EXIT
printf 'Backup completed and archive verified: %s\nSHA-256: %s\n' "$destination" "$checksum"
# Retention runs only after the new archive and checksum were written successfully.
# Restrict deletion to this application's verified dump naming pattern.
while IFS= read -r -d '' old_backup; do
  rm -f -- "$old_backup" "${old_backup}.sha256"
done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'vivarqo-*.dump' -mtime "+${retention_days}" -print0)
echo "Copy the dump and checksum to encrypted storage outside the database cluster."
