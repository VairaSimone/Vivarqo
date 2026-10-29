#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$#" -ne 1 ]]; then
  echo "Usage: CONFIRM_RESTORE=YES DATABASE_URL=... $0 <backup.dump>" >&2
  exit 2
fi
: "${DATABASE_URL:?Set DATABASE_URL to the PostgreSQL restore target}"

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

if [[ "${CONFIRM_RESTORE:-}" != "YES" ]]; then
  echo "Restore is disabled by default. Set CONFIRM_RESTORE=YES to confirm the operation." >&2
  exit 2
fi
backup_file="$1"
[[ -f "$backup_file" && -r "$backup_file" ]] || { echo "Backup file not found or not readable." >&2; exit 2; }
command -v pg_restore >/dev/null 2>&1 || { echo "pg_restore is required (install PostgreSQL client tools)." >&2; exit 127; }

if [[ -f "${backup_file}.sha256" ]]; then
  expected="$(tr -d '[:space:]' < "${backup_file}.sha256")"
  actual="$(sha256sum "$backup_file" | awk '{print $1}')"
  [[ "$expected" == "$actual" ]] || { echo "Backup checksum mismatch; restore aborted." >&2; exit 1; }
fi
pg_restore --list "$backup_file" >/dev/null || { echo "The file is not a valid PostgreSQL custom-format backup." >&2; exit 1; }

cat >&2 <<'NOTICE'
NOTICE: restore into a dedicated empty target database. This script intentionally
does not drop existing objects or use pg_restore --clean. Create a database
snapshot/backup of the target first if you need a rollback path.
NOTICE
pg_restore --exit-on-error --no-owner --no-acl --dbname="$pg_database_url" "$backup_file"
echo "Restore completed. Run the application's migration/status and smoke checks."
