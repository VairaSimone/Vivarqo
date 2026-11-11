#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

for environment_file in .env.production .env.staging; do
  if [[ -e "$environment_file" ]]; then
    echo "$environment_file already exists; refusing to overwrite it during CI validation." >&2
    exit 2
  fi
done

temporary="$(mktemp -d)"
cleanup() {
  rm -f .env.production .env.staging
  rm -rf "$temporary"
}
trap cleanup EXIT

create_environment() {
  local environment="$1"
  local project="$2"
  local domain="$3"
  local node_environment="$4"
  local retention="$5"
  local secrets_dir="$temporary/$environment-secrets"
  local backup_dir="$temporary/$environment-backups"

  mkdir -p "$secrets_dir" "$backup_dir"
  chmod 700 "$secrets_dir" "$backup_dir"
  for secret in postgres_admin_password postgres_app_password csrf_secret resend_api_key stripe_secret_key stripe_webhook_secret vapid_private_key s3_access_key_id s3_secret_access_key; do
    printf 'ci-only-secret-value-not-for-use\n' > "$secrets_dir/$secret"
    chmod 0444 "$secrets_dir/$secret"
  done

  cat > ".$environment" <<EOF
VIVARQO_ENV_FILE=../../../.$environment
COMPOSE_PROJECT_NAME=$project
VIVARQO_NODE_ENV=$node_environment
VIVARQO_SECRETS_DIR=$secrets_dir
VIVARQO_BACKUP_DIR=$backup_dir
PUBLIC_DOMAIN=$domain
ACME_EMAIL=ops@example.test
APP_ORIGIN=https://$domain
API_ORIGIN=https://$domain
TRUST_PROXY_HOPS=2
DATABASE_NAME=vivarqo_$environment
DATABASE_ADMIN_USER=vivarqo_${environment}_admin
DATABASE_USER=vivarqo_${environment}_app
DATABASE_PORT=5432
EMAIL_FROM=noreply@example.test
STRIPE_PRICE_ID=price_ci_only
VAPID_PUBLIC_KEY=ci-only-public-vapid-key
VAPID_SUBJECT=mailto:push@example.test
S3_ENDPOINT=https://s3.example.test
S3_REGION=eu-west-1
S3_BUCKET=vivarqo-ci-$environment
PRIVATE_STORAGE_PATH=/app/var/private
EXPORT_MAX_ARCHIVE_BYTES=21474836480
EXPORT_MAX_ENTRIES=100000
BACKUP_RETENTION_DAYS=$retention
BACKUP_INTERVAL_SECONDS=86400
EOF
  chmod 600 ".$environment"
}

validate_environment() {
  local environment_file="$1"
  local output_file="$2"
  docker compose --env-file "$environment_file" -f backend/infra/docker/compose.production.yaml config --format json > "$output_file"
  node - "$output_file" <<'NODE'
const fs = require("node:fs");
const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const services = config.services ?? {};
const published = Object.entries(services)
  .filter(([, service]) => (service.ports ?? []).some((port) => port.published))
  .map(([name]) => name);
if (published.length !== 1 || published[0] !== "caddy") {
  throw new Error("Only Caddy may publish host ports; found: " + published.join(", "));
}
for (const name of ["postgres", "migrate", "api", "web", "worker", "backup"]) {
  if (!services[name]) throw new Error("Missing production service: " + name);
  if ((services[name].ports ?? []).length > 0) {
    throw new Error(name + " must not publish host ports");
  }
}
const healthcheck = JSON.stringify(services.postgres.healthcheck ?? {});
if (!healthcheck.includes("$POSTGRES_USER") || !healthcheck.includes("$POSTGRES_DB")) {
  throw new Error("PostgreSQL healthcheck must defer variable expansion to the container");
}
const networks = config.networks ?? {};
if (networks.database?.internal !== true || networks.frontend?.internal !== true) {
  throw new Error("Database and frontend Docker networks must be internal");
}
if (services.api.environment?.DATABASE_USER === services.migrate.environment?.DATABASE_USER) {
  throw new Error("API and migration services must use different PostgreSQL roles");
}
if (services.api.environment?.DATABASE_PASSWORD_FILE !== "/run/secrets/postgres_app_password") {
  throw new Error("API must use the application database password secret");
}
if (services.worker.environment?.DATABASE_PASSWORD_FILE !== "/run/secrets/postgres_app_password") {
  throw new Error("Worker must use the application database password secret");
}
if (services.migrate.environment?.DATABASE_PASSWORD_FILE !== "/run/secrets/postgres_admin_password") {
  throw new Error("Migrations must use the separate database administration secret");
}
if (services.worker.healthcheck?.disable !== true || services.migrate.healthcheck?.disable !== true) {
  throw new Error("Worker and one-shot migrations must not inherit the API HTTP healthcheck");
}
for (const name of [
  "postgres_admin_password", "postgres_app_password", "csrf_secret", "resend_api_key",
  "stripe_secret_key", "stripe_webhook_secret", "vapid_private_key",
  "s3_access_key_id", "s3_secret_access_key",
]) {
  if (!config.secrets?.[name]?.file) throw new Error("Missing file-backed Docker secret: " + name);
}
console.log("Network, exposed ports, DB roles, healthcheck and secrets validated.");
NODE
}

create_environment production vivarqo-ci vivarqo.example.test production 30
validate_environment .env.production "$temporary/production-compose.json"

create_environment staging vivarqo-ci-staging staging.vivarqo.example.test staging 14
validate_environment .env.staging "$temporary/staging-compose.json"

echo "Production and staging Docker Compose configurations are valid."
