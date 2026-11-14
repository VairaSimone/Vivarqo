#!/usr/bin/env bash
set -Eeuo pipefail

secrets_dir="${1:-/etc/vivarqo/secrets}"
umask 077
mkdir -p "$secrets_dir"
chmod 700 "$secrets_dir"
command -v openssl >/dev/null 2>&1 || { echo "openssl is required" >&2; exit 127; }

create_random_secret() {
  local name="$1"
  local target="$secrets_dir/$name"
  if [[ ! -e "$target" ]]; then
    openssl rand -hex 48 > "$target"
    echo "Generated $name"
  else
    echo "Keeping existing $name"
  fi
  # Standalone Compose mounts host files directly. The directory stays 0700
  # and root-owned on the host; read permission is needed by postgres/node
  # users inside only the containers to which the secret is mounted.
  chmod 0444 "$target"
}

create_random_secret postgres_admin_password
create_random_secret postgres_app_password
create_random_secret postgres_backup_password
create_random_secret csrf_secret

cat <<EOF
Created/verified database and CSRF secrets in: $secrets_dir
Provision provider secrets in this directory via your secret manager:
  brevo_api_key
  stripe_secret_key
  stripe_webhook_secret
  vapid_private_key
  s3_access_key_id
  s3_secret_access_key

Set each file mode to 0444 while keeping this host directory root-owned mode 0700.
Do not commit this directory or put secret values in an environment file.
Use distinct secret directories for staging and production.
EOF
