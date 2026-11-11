#!/usr/bin/env bash
set -Eeuo pipefail

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${DATABASE_USER:?DATABASE_USER is required}"
: "${DATABASE_PASSWORD_FILE:?DATABASE_PASSWORD_FILE is required}"
[[ "$POSTGRES_USER" != "$DATABASE_USER" ]] || {
  echo "The application DB role must differ from the migration/admin role." >&2
  exit 2
}
[[ -r "$DATABASE_PASSWORD_FILE" ]] || {
  echo "The application DB password secret is unreadable." >&2
  exit 2
}

export VIVARQO_APP_PASSWORD
VIVARQO_APP_PASSWORD="$(cat "$DATABASE_PASSWORD_FILE")"
[[ -n "$VIVARQO_APP_PASSWORD" ]] || {
  echo "The application DB password secret is empty." >&2
  exit 2
}

psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --set=admin_user="$POSTGRES_USER" \
  --set=app_user="$DATABASE_USER" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<'SQL'
\getenv app_password VIVARQO_APP_PASSWORD

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE',
  :'app_user', :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')
\gexec

SELECT format(
  'ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE',
  :'app_user', :'app_password'
)
\gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_user') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_user') \gexec
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'app_user') \gexec
SELECT format('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %I', :'app_user') \gexec

ALTER DEFAULT PRIVILEGES FOR ROLE :"admin_user" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"admin_user" IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app_user";
SQL

unset VIVARQO_APP_PASSWORD
