#!/usr/bin/env bash
set -Eeuo pipefail

: "${RESTIC_REPOSITORY:?Set RESTIC_REPOSITORY}"
: "${RESTIC_PASSWORD_FILE:?Set RESTIC_PASSWORD_FILE}"
: "${RESTIC_SNAPSHOT:?Set RESTIC_SNAPSHOT to an explicit snapshot ID}"
: "${VIVARQO_BACKUP_DIR:?Set VIVARQO_BACKUP_DIR to the original absolute backup path}"
: "${VIVARQO_RESTORE_ROOT:?Set VIVARQO_RESTORE_ROOT to a new empty restore directory}"

for command in restic find sha256sum pg_restore; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Required command not found: $command" >&2
    exit 127
  }
done

[[ -s "$RESTIC_PASSWORD_FILE" ]] || {
  echo "Restic password file is missing or empty" >&2
  exit 2
}
[[ "$VIVARQO_BACKUP_DIR" == /* && "$VIVARQO_BACKUP_DIR" != "/" ]] || {
  echo "VIVARQO_BACKUP_DIR must be an absolute non-root path" >&2
  exit 2
}
[[ "$VIVARQO_RESTORE_ROOT" == /* && "$VIVARQO_RESTORE_ROOT" != "/" ]] || {
  echo "VIVARQO_RESTORE_ROOT must be an absolute non-root path" >&2
  exit 2
}
mkdir -p "$VIVARQO_RESTORE_ROOT"
[[ -d "$VIVARQO_RESTORE_ROOT" && ! -L "$VIVARQO_RESTORE_ROOT" ]] || {
  echo "Restore root must be a real directory, not a symlink" >&2
  exit 2
}
if [[ -n "$(find "$VIVARQO_RESTORE_ROOT" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  echo "Restore root is not empty; refusing to overwrite existing files" >&2
  exit 2
fi

export RESTIC_PASSWORD_FILE
restic snapshots "$RESTIC_SNAPSHOT" >/dev/null

echo "Restoring snapshot $RESTIC_SNAPSHOT into $VIVARQO_RESTORE_ROOT"
restic restore "$RESTIC_SNAPSHOT" --target "$VIVARQO_RESTORE_ROOT" --include "$VIVARQO_BACKUP_DIR"

restored_backup_dir="${VIVARQO_RESTORE_ROOT}${VIVARQO_BACKUP_DIR}"
[[ -d "$restored_backup_dir" ]] || {
  echo "Expected backup directory was not restored: $restored_backup_dir" >&2
  exit 3
}

mapfile -d '' archives < <(find "$restored_backup_dir" -maxdepth 1 -type f -name 'vivarqo-*.dump' -print0)
(("${#archives[@]}" > 0)) || {
  echo "Snapshot contains no PostgreSQL dumps" >&2
  exit 3
}

for archive in "${archives[@]}"; do
  [[ -s "${archive}.sha256" ]] || {
    echo "Missing checksum sidecar: ${archive}.sha256" >&2
    exit 3
  }
  (cd "$(dirname "$archive")" && sha256sum --check "$(basename "$archive").sha256")
  pg_restore --list "$archive" >/dev/null
  printf 'Verified restore candidate: %s\n' "$archive"
done

echo "Files restored and verified. No database was modified."
echo "Create a NEW empty PostgreSQL database, then restore the selected dump with pg_restore."
