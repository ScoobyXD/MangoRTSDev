#!/usr/bin/env bash
set -euo pipefail

: "${DB_HOST:?set DB_HOST}"
: "${DB_PORT:=5432}"
: "${DB_NAME:?set DB_NAME}"
: "${DB_USER:?set DB_USER}"
: "${PGPASSWORD:?set PGPASSWORD}"
DB_HOST="${DB_HOST#host=}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION_PATH="$REPO_ROOT/backend/db/migrations/20260424_node_relationship_guards.sql"

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" --set=sslmode=require -v ON_ERROR_STOP=1 -f "$MIGRATION_PATH"

echo "✅ node relationship guard constraints applied from backend/db/migrations/20260424_node_relationship_guards.sql"
