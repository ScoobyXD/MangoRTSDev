#!/usr/bin/env bash
set -euo pipefail

DRY_RUN="${DRY_RUN:-false}"

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *)
      echo "Usage: $0 [--dry-run]" >&2
      exit 1
      ;;
  esac
done

: "${DB_HOST:?set DB_HOST}"
: "${DB_PORT:=5432}"
: "${DB_NAME:?set DB_NAME}"
: "${DB_USER:?set DB_USER}"
: "${PGPASSWORD:?set PGPASSWORD}"
export PGSSLMODE="${PGSSLMODE:-require}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/backend/db/migrations"
START_AT="${DB_MIGRATION_START_AT:-}"
START_AFTER="${DB_MIGRATION_START_AFTER:-}"

export DB_HOST="${DB_HOST#host=}"
export DB_PASSWORD="${DB_PASSWORD:-$PGPASSWORD}"
export DB_SSLMODE="${DB_SSLMODE:-$PGSSLMODE}"

runner_args=(run ./cmd/miraeopus-migrate -migrations "$MIGRATIONS_DIR")
[[ "$DRY_RUN" == true ]] && runner_args+=(-dry-run)
[[ -n "$START_AT" ]] && runner_args+=(-start-at "$START_AT")
[[ -n "$START_AFTER" ]] && runner_args+=(-start-after "$START_AFTER")

cd "$REPO_ROOT/backend"
exec go "${runner_args[@]}"
