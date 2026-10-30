#!/usr/bin/env bash
set -Eeuo pipefail

# The CI runner may also have an older PostgreSQL client on /usr/bin.
# Prefer the project/server PostgreSQL 18 client when the PGDG package exists.
if [[ -x /usr/lib/postgresql/18/bin/pg_dump ]]; then
  PATH="/usr/lib/postgresql/18/bin:$PATH"
  export PATH
fi

if [[ "$#" -ne 1 ]]; then
  echo "Usage: CONFIRM_RESTORE=YES DATABASE_URL=... $0 <backup.dump>" >&2
  exit 2
fi
: "${DATABASE_URL:?Set DATABASE_URL to an empty PostgreSQL restore target}"
[[ "${CONFIRM_RESTORE:-}" == "YES" ]] || { echo "Set CONFIRM_RESTORE=YES to confirm." >&2; exit 2; }
backup="$1"
[[ -f "$backup" && -r "$backup" ]] || { echo "Backup not found or not readable." >&2; exit 2; }
[[ -f "${backup}.sha256" ]] || { echo "A SHA-256 sidecar is required." >&2; exit 1; }
for command in pg_restore psql node sha256sum; do
  command -v "$command" >/dev/null 2>&1 || { echo "$command is required." >&2; exit 127; }
done

PG_DATABASE_URL="$(node backend/scripts/postgres-tool-url.mjs)"
expected="$(awk 'NR==1 {print $1}' "${backup}.sha256")"
actual="$(sha256sum "$backup" | awk '{print $1}')"
[[ "$expected" =~ ^[a-fA-F0-9]{64}$ && "$expected" == "$actual" ]] || { echo "Backup checksum mismatch." >&2; exit 1; }
pg_restore --list "$backup" >/dev/null

existing="$(psql "$PG_DATABASE_URL" -XAtq -v ON_ERROR_STOP=1 -c \
  "SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')")"
[[ "$existing" == "0" ]] || { echo "Restore target contains $existing public objects; refusing to overwrite." >&2; exit 1; }

pg_restore --exit-on-error --no-owner --no-acl --dbname="$PG_DATABASE_URL" "$backup"
psql "$PG_DATABASE_URL" -Xv ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF to_regclass('public.users') IS NULL OR to_regclass('public.animals') IS NULL OR to_regclass('public._prisma_migrations') IS NULL THEN
    RAISE EXCEPTION 'Restored database is missing required Vivarqo tables';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'Restored database has no successfully applied Prisma migration';
  END IF;
END
$$;
SQL
echo "Restore completed; core schema and migration checks passed."
