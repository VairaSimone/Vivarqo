#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${VIVARQO_MANAGER_POSTGRES_DRILL:-}" != "1" ]]; then
  echo "Set VIVARQO_MANAGER_POSTGRES_DRILL=1 to explicitly allow stopping the local development PostgreSQL container." >&2
  exit 2
fi

compose=(docker compose -f backend/infra/docker/compose.yaml)
table="dev_manager_recovery_$"
marker="recovery-${RANDOM}-${RANDOM}-$(date +%s)"
created=0

cleanup() {
  local status=$?
  if [[ $created == 1 ]]; then
    "${compose[@]}" exec -T postgres psql -U vivarqo -d vivarqo -v ON_ERROR_STOP=1 -c "DROP TABLE IF EXISTS $table" >/dev/null 2>&1 || true
  fi
  if [[ $status -ne 0 ]]; then
    "${compose[@]}" start postgres >/dev/null 2>&1 || true
    echo "PostgreSQL recovery drill failed; container start was requested. Inspect docker compose logs postgres." >&2
  fi
  exit "$status"
}
trap cleanup EXIT

"${compose[@]}" up -d postgres
ready=0
for attempt in $(seq 1 60); do
  if "${compose[@]}" exec -T postgres pg_isready -U vivarqo -d vivarqo >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ $ready == 1 ]] || { echo "PostgreSQL did not become ready." >&2; exit 1; }

"${compose[@]}" exec -T postgres psql -U vivarqo -d vivarqo -v ON_ERROR_STOP=1 -c "CREATE TABLE $table (id integer PRIMARY KEY, marker text NOT NULL)" >/dev/null
created=1
"${compose[@]}" exec -T postgres psql -U vivarqo -d vivarqo -v ON_ERROR_STOP=1 -c "INSERT INTO $table (id, marker) VALUES (1, '$marker')" >/dev/null

echo "Stopping PostgreSQL container..."
"${compose[@]}" stop postgres >/dev/null
echo "Starting PostgreSQL container..."
"${compose[@]}" start postgres >/dev/null

ready=0
for attempt in $(seq 1 60); do
  if "${compose[@]}" exec -T postgres pg_isready -U vivarqo -d vivarqo >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ $ready == 1 ]] || { echo "PostgreSQL did not recover within 60 seconds." >&2; exit 1; }

actual=$("${compose[@]}" exec -T postgres psql -U vivarqo -d vivarqo -v ON_ERROR_STOP=1 -At -c "SELECT marker FROM $table WHERE id = 1")
[[ "$actual" == "$marker" ]] || { echo "Persistent marker mismatch: data did not survive the restart." >&2; exit 1; }
echo "PASS: PostgreSQL restarted and persistent data remained intact."
