#!/usr/bin/env bash
set -Eeuo pipefail

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGUSER:?PGUSER must be the PostgreSQL administrator in this CI-only drill}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${DATABASE_NAME:?DATABASE_NAME is required}"

app_role="vivarqo_backup_drill_app"
backup_role="vivarqo_backup_drill_reader"
restore_db="vivarqo_backup_drill_restore"
probe_table="vivarqo_backup_rls_probe"
temporary="$(mktemp -d)"
archive="$temporary/vivarqo-backup-role-drill.dump"
app_password_file="$temporary/app-password"
backup_password_file="$temporary/backup-password"
cleanup() {
  psql --no-psqlrc --set=ON_ERROR_STOP=1 --username "$PGUSER" --dbname "$DATABASE_NAME" \
    --command "DROP TABLE IF EXISTS public.$probe_table" >/dev/null 2>&1 || true
  dropdb --if-exists --username "$PGUSER" "$restore_db" >/dev/null 2>&1 || true
  rm -rf "$temporary"
}
trap cleanup EXIT

printf '%s\n' 'ci-only-app-role-password-2026' > "$app_password_file"
printf '%s\n' 'ci-only-backup-role-password-2026' > "$backup_password_file"
chmod 600 "$app_password_file" "$backup_password_file"

POSTGRES_USER="$PGUSER" \
POSTGRES_DB="$DATABASE_NAME" \
DATABASE_USER="$app_role" \
DATABASE_PASSWORD_FILE="$app_password_file" \
DATABASE_BACKUP_USER="$backup_role" \
DATABASE_BACKUP_PASSWORD_FILE="$backup_password_file" \
  bash backend/infra/docker/init-app-role.sh

psql --no-psqlrc --set=ON_ERROR_STOP=1 --username "$PGUSER" --dbname "$DATABASE_NAME" <<SQL
DROP TABLE IF EXISTS public.$probe_table;
CREATE TABLE public.$probe_table (
  id integer PRIMARY KEY,
  payload text NOT NULL
);
INSERT INTO public.$probe_table (id, payload) VALUES (1, 'visible-to-app'), (2, 'backup-only');
ALTER TABLE public.$probe_table ENABLE ROW LEVEL SECURITY;
CREATE POLICY vivarqo_backup_probe_app_policy ON public.$probe_table
  FOR SELECT TO $app_role USING (id = 1);
SQL

app_rows="$(PGPASSWORD="$(cat "$app_password_file")" psql --no-psqlrc --tuples-only --no-align \
  --username "$app_role" --dbname "$DATABASE_NAME" \
  --command "SELECT count(*) FROM public.$probe_table")"
backup_rows="$(PGPASSWORD="$(cat "$backup_password_file")" psql --no-psqlrc --tuples-only --no-align \
  --username "$backup_role" --dbname "$DATABASE_NAME" \
  --command "SELECT count(*) FROM public.$probe_table")"

[[ "$app_rows" == "1" ]] || {
  echo "Application role did not respect its RLS policy (expected 1 row, got $app_rows)." >&2
  exit 1
}
[[ "$backup_rows" == "2" ]] || {
  echo "Backup role did not read all rows (expected 2 rows, got $backup_rows)." >&2
  exit 1
}

if PGPASSWORD="$(cat "$backup_password_file")" psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --username "$backup_role" --dbname "$DATABASE_NAME" \
  --command "INSERT INTO public.$probe_table (id, payload) VALUES (3, 'must-not-write')" >/dev/null 2>&1; then
  echo "Backup role unexpectedly has write privileges." >&2
  exit 1
fi

PGPASSWORD="$(cat "$backup_password_file")" pg_dump \
  --host="$PGHOST" --port="$PGPORT" --username="$backup_role" \
  --dbname="$DATABASE_NAME" --format=custom --no-owner --no-acl --file="$archive"
pg_restore --list "$archive" >/dev/null

createdb --username "$PGUSER" "$restore_db"
pg_restore --exit-on-error --username "$PGUSER" --dbname="$restore_db" \
  --no-owner --no-acl "$archive"
restored_rows="$(psql --no-psqlrc --tuples-only --no-align --username "$PGUSER" \
  --dbname "$restore_db" --command "SELECT count(*) FROM public.$probe_table")"
[[ "$restored_rows" == "2" ]] || {
  echo "Restored backup did not contain all RLS-protected rows (expected 2, got $restored_rows)." >&2
  exit 1
}

role_flags="$(psql --no-psqlrc --tuples-only --no-align --username "$PGUSER" --dbname "$DATABASE_NAME" \
  --command "SELECT (SELECT rolsuper::text || ':' || rolbypassrls::text FROM pg_roles WHERE rolname = '$app_role') || '|' || (SELECT rolsuper::text || ':' || rolbypassrls::text FROM pg_roles WHERE rolname = '$backup_role')")"
[[ "$role_flags" == "false:false|false:true" ]] || {
  echo "Unexpected database role flags: $role_flags" >&2
  exit 1
}

echo "Application RLS, backup BYPASSRLS read-only access, pg_dump and full restore all passed."
