#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to the CI PostgreSQL service}"
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

ADMIN_URL="$(node -e 'const u = new URL(process.env.DATABASE_URL); u.pathname = "/postgres"; u.searchParams.delete("schema"); process.stdout.write(u.toString());')"

database_url_for() {
  TARGET_DATABASE="$1" node -e 'const u = new URL(process.env.DATABASE_URL); u.pathname = "/" + process.env.TARGET_DATABASE; u.searchParams.delete("schema"); process.stdout.write(u.toString());'
}

DB_EMPTY="vivarqo_schema_empty"
DB_BASELINE="vivarqo_schema_baseline"
DB_PARTIAL="vivarqo_schema_partial"
DB_DRIFTED="vivarqo_schema_drifted"
DBS=("$DB_EMPTY" "$DB_BASELINE" "$DB_PARTIAL" "$DB_DRIFTED")
LOG_FILE="$(mktemp)"

cleanup() {
  for db in "${DBS[@]}"; do
    dropdb --if-exists --maintenance-db="$ADMIN_URL" "$db" >/dev/null 2>&1 || true
  done
  rm -f "$LOG_FILE"
}
trap cleanup EXIT

recreate_database() {
  local db="$1"
  dropdb --if-exists --maintenance-db="$ADMIN_URL" "$db" >/dev/null 2>&1 || true
  createdb --maintenance-db="$ADMIN_URL" "$db"
}

expect_ensure_failure() {
  local url="$1"
  local expected="$2"
  if DATABASE_URL="$url" pnpm db:ensure >"$LOG_FILE" 2>&1; then
    echo "Expected database ensure to fail with: $expected" >&2
    exit 1
  fi
  if ! grep -Fq "$expected" "$LOG_FILE"; then
    echo "Database ensure failed for an unexpected reason; expected: $expected" >&2
    cat "$LOG_FILE" >&2
    exit 1
  fi
}

echo "Schema drill 1/4: empty database receives every versioned migration."
recreate_database "$DB_EMPTY"
EMPTY_URL="$(database_url_for "$DB_EMPTY")"
DATABASE_URL="$EMPTY_URL" pnpm db:ensure

echo "Schema drill 2/4: complete consolidated SQL schema is safely baselined."
recreate_database "$DB_BASELINE"
BASELINE_URL="$(database_url_for "$DB_BASELINE")"
psql "$BASELINE_URL" -v ON_ERROR_STOP=1 -f backend/database/schema.sql >/dev/null
DATABASE_URL="$BASELINE_URL" pnpm db:ensure

echo "Schema drill 3/4: partial untracked schema is rejected without migration."
recreate_database "$DB_PARTIAL"
PARTIAL_URL="$(database_url_for "$DB_PARTIAL")"
psql "$PARTIAL_URL" -v ON_ERROR_STOP=1 -c 'CREATE TABLE users (id UUID PRIMARY KEY);' >/dev/null
expect_ensure_failure "$PARTIAL_URL" "partial or outdated untracked schema"
MIGRATION_TABLE="$(psql "$PARTIAL_URL" -v ON_ERROR_STOP=1 -tAc "SELECT to_regclass('public._prisma_migrations') IS NULL")"
if [[ "${MIGRATION_TABLE//[[:space:]]/}" != "t" ]]; then
  echo "Partial database was unexpectedly modified with Prisma migration history." >&2
  exit 1
fi

echo "Schema drill 4/4: completed migration history with a missing index is rejected."
recreate_database "$DB_DRIFTED"
DRIFTED_URL="$(database_url_for "$DB_DRIFTED")"
DATABASE_URL="$DRIFTED_URL" pnpm db:ensure
psql "$DRIFTED_URL" -v ON_ERROR_STOP=1 -c 'DROP INDEX public.animals_user_name_idx;' >/dev/null
expect_ensure_failure "$DRIFTED_URL" "missing index: animals_user_name_idx"

echo "Schema drill 4b/4: an index with the expected name but wrong key definition is rejected."
psql "$DRIFTED_URL" -v ON_ERROR_STOP=1 -c 'CREATE INDEX animals_user_name_idx ON animals (user_id);' >/dev/null
expect_ensure_failure "$DRIFTED_URL" "wrong index key definition: animals_user_name_idx"

echo "Database schema initialization drill passed."
