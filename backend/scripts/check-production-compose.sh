#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
if [[ -e .env.production ]]; then
  echo ".env.production already exists; refusing to overwrite it during CI validation." >&2
  exit 2
fi
temporary="$(mktemp -d)"
cleanup() { rm -f .env.production; rm -rf "$temporary"; }
trap cleanup EXIT

secrets_dir="$temporary/secrets"
backup_dir="$temporary/backups"
mkdir -p "$secrets_dir" "$backup_dir"
chmod 700 "$secrets_dir" "$backup_dir"
for name in postgres_admin_password postgres_app_password csrf_secret resend_api_key stripe_secret_key stripe_webhook_secret vapid_private_key s3_access_key_id s3_secret_access_key; do
  printf 'ci-only-secret-value-not-for-use\n' > "$secrets_dir/$name"
  chmod 0444 "$secrets_dir/$name"
done

cat > .env.production <<EOF
VIVARQO_ENV_FILE=../../../.env.production
COMPOSE_PROJECT_NAME=vivarqo-ci
VIVARQO_NODE_ENV=production
VIVARQO_SECRETS_DIR=$secrets_dir
VIVARQO_BACKUP_DIR=$backup_dir
PUBLIC_DOMAIN=vivarqo.example.test
ACME_EMAIL=ops@example.test
APP_ORIGIN=https://vivarqo.example.test
API_ORIGIN=https://vivarqo.example.test
TRUST_PROXY_HOPS=2
DATABASE_NAME=vivarqo
DATABASE_ADMIN_USER=vivarqo_admin
DATABASE_USER=vivarqo_app
DATABASE_PORT=5432
EMAIL_FROM=noreply@example.test
STRIPE_PRICE_ID=price_ci_only
VAPID_PUBLIC_KEY=ci-only-public-vapid-key
VAPID_SUBJECT=mailto:push@example.test
S3_ENDPOINT=https://s3.example.test
S3_REGION=eu-west-1
S3_BUCKET=vivarqo-ci
PRIVATE_STORAGE_PATH=/app/var/private
EXPORT_MAX_ARCHIVE_BYTES=21474836480
EXPORT_MAX_ENTRIES=100000
BACKUP_RETENTION_DAYS=30
BACKUP_INTERVAL_SECONDS=86400
EOF
chmod 600 .env.production

docker compose --env-file .env.production -f backend/infra/docker/compose.production.yaml config --quiet
echo "Production Docker Compose configuration is valid."
