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

DB_HOST="${DB_HOST#host=}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/backend/db/migrations"
START_AT="${DB_MIGRATION_START_AT:-}"
START_AFTER="${DB_MIGRATION_START_AFTER:-}"

psql_base=(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME")

sql_literal() {
  local value="$1"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

"${psql_base[@]}" -v ON_ERROR_STOP=1 \
  -c "create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now());"

mapfile -t applied_versions < <("${psql_base[@]}" -At -c "select version from schema_migrations;")
declare -A applied=()
for version in "${applied_versions[@]}"; do
  [[ -n "$version" ]] && applied["$version"]=1
done

pending=()
should_apply=false
if [[ -z "$START_AT" && -z "$START_AFTER" ]]; then
  should_apply=true
fi

while IFS= read -r migration; do
  name="$(basename "$migration")"
  if [[ -n "$START_AFTER" && "$should_apply" == false ]]; then
    if [[ "$name" == "$START_AFTER" ]]; then
      should_apply=true
    fi
    continue
  fi
  if [[ -n "$START_AT" && "$should_apply" == false ]]; then
    if [[ "$name" == "$START_AT" ]]; then
      should_apply=true
    else
      continue
    fi
  fi
  if [[ -n "${applied[$name]:-}" ]]; then
    continue
  fi
  pending+=("$migration")
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | sort)

if [[ "${#pending[@]}" -eq 0 ]]; then
  echo "No pending migrations."
  exit 0
fi

echo "Pending migrations:"
for migration in "${pending[@]}"; do
  echo " - $(basename "$migration")"
done

if [[ "$DRY_RUN" == true ]]; then
  echo "Dry run only; no migrations applied."
  exit 0
fi

for migration in "${pending[@]}"; do
  name="$(basename "$migration")"
  echo "Applying $name..."
  "${psql_base[@]}" -v ON_ERROR_STOP=1 --single-transaction -f "$migration"
  version_literal="$(sql_literal "$name")"
  "${psql_base[@]}" -v ON_ERROR_STOP=1 \
    -c "insert into schema_migrations(version) values ($version_literal) on conflict (version) do nothing;"
done

echo "Database migrations applied."
