#!/usr/bin/env bash
set -Eeuo pipefail

# Restic encrypts and authenticates data client-side. The repository password
# and backend credentials must be supplied through a root-readable env file.
: "${RESTIC_REPOSITORY:?Set RESTIC_REPOSITORY to an off-host repository}"
: "${RESTIC_PASSWORD_FILE:?Set RESTIC_PASSWORD_FILE to a protected password file}"
: "${VIVARQO_BACKUP_DIR:?Set VIVARQO_BACKUP_DIR to the local PostgreSQL dump mount}"

for command in restic find sha256sum; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required command not found: $command" >&2
    exit 127
  }
done

[[ -s "$RESTIC_PASSWORD_FILE" ]] || {
  echo "Restic password file is missing or empty" >&2
  exit 2
}
[[ -d "$VIVARQO_BACKUP_DIR" ]] || {
  echo "Local PostgreSQL backup directory does not exist" >&2
  exit 2
}
mapfile -d '' archives < <(find "$VIVARQO_BACKUP_DIR" -maxdepth 1 -type f -name 'vivarqo-*.dump' -print0)
(("${#archives[@]}" > 0)) || {
  echo "No PostgreSQL dump found; refusing an empty backup" >&2
  exit 3
}
for archive in "${archives[@]}"; do
  [[ -s "${archive}.sha256" ]] || {
    echo "Missing checksum sidecar for $archive" >&2
    exit 3
  }
  (cd "$(dirname "$archive")" && sha256sum --check "$(basename "$archive").sha256")
done

export RESTIC_PASSWORD_FILE
restic snapshots >/dev/null 2>&1 || {
  echo "Restic repository is not initialized or cannot be reached. Initialize it deliberately with 'restic init'." >&2
  exit 4
}

# Include dumps and SHA-256 sidecars; never include .env files or Docker secrets.
restic backup "$VIVARQO_BACKUP_DIR" --host "${RESTIC_HOSTNAME:-vivarqo-production}" \
  --tag vivarqo --tag postgres --exclude '*.partial'

# Keep a practical low-cost history. Pruning happens only after a successful
# upload; restic repository encryption is always client-side.
restic forget --tag vivarqo --keep-daily 7 --keep-weekly 5 --keep-monthly 12 --prune
restic check
