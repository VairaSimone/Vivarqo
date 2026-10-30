#!/usr/bin/env bash
set -Eeuo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the PostgreSQL source database}"
for command in pg_dump pg_restore psql createdb dropdb sha256sum node; do
  command -v "$command" >/dev/null 2>&1 || { echo "$command is required (install PostgreSQL client tools)." >&2; exit 127; }
done

source_url="$(node backend/scripts/postgres-tool-url.mjs)"
source_db="$(node -e 'const u=new URL(process.env.DATABASE_URL); process.stdout.write(decodeURIComponent(u.pathname.replace(/^\//,"")))' )"
[[ "$source_db" =~ ^[A-Za-z0-9_][A-Za-z0-9_-]{0,62}$ ]] || { echo "Could not safely determine source database name." >&2; exit 2; }
timestamp="$(date -u +%Y%m%d%H%M%S)"
target_db="vivarqo_restore_drill_${timestamp}_$$"
target_url="$(node backend/scripts/postgres-tool-url.mjs --database "$target_db")"
maintenance_url="$(node backend/scripts/postgres-tool-url.mjs --database postgres)"
temporary="$(mktemp -d "${TMPDIR:-/tmp}/vivarqo-restore-drill.XXXXXX")"
dump="$temporary/vivarqo.dump"
created=0

cleanup() {
  if [[ "$created" == "1" ]]; then
    dropdb --if-exists --maintenance-db="$maintenance_url" "$target_db" >/dev/null 2>&1 || true
  fi
  rm -rf "$temporary"
}
trap cleanup EXIT

pg_dump --format=custom --no-owner --no-acl --file="$dump" "$source_url"
pg_restore --list "$dump" >/dev/null
sha256sum "$dump" > "$dump.sha256"
sha256sum --check "$dump.sha256"

createdb --maintenance-db="$maintenance_url" "$target_db"
created=1
pg_restore --exit-on-error --no-owner --no-acl --dbname="$target_url" "$dump"

count_tables() {
  psql "$1" -XAtq -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"
}
count_migrations() {
  psql "$1" -XAtq -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"
}
source_tables="$(count_tables "$source_url")"
restored_tables="$(count_tables "$target_url")"
[[ "$source_tables" == "$restored_tables" ]] || { echo "Table count differs: source=$source_tables restored=$restored_tables" >&2; exit 1; }
source_migrations="$(count_migrations "$source_url")"
restored_migrations="$(count_migrations "$target_url")"
[[ "$source_migrations" == "$restored_migrations" && "$restored_migrations" -gt 0 ]] || { echo "Migration history differs." >&2; exit 1; }

for table in users animals import_jobs export_jobs documents finance_entries; do
  source_count="$(psql "$source_url" -XAtq -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM public.\"$table\"")"
  restored_count="$(psql "$target_url" -XAtq -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) FROM public.\"$table\"")"
  [[ "$source_count" == "$restored_count" ]] || { echo "Row count differs for $table." >&2; exit 1; }
done
echo "Backup/restore drill passed. Source unchanged; temporary database will be dropped."
echo "Tables verified: $restored_tables; successful migrations: $restored_migrations."
