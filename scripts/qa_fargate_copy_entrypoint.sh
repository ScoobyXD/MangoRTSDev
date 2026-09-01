#!/usr/bin/env bash
set -Eeuo pipefail
set +x
umask 077

export PGSSLMODE=require

readonly work_root=/work
readonly dump_path="$work_root/dev-full.dump"

fail() {
  printf 'STOP: %s\n' "$*" >&2
  return 1
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "missing required environment value $name"
}

cleanup() {
  rm -f -- "$dump_path"
  unset DEV_DB_PASSWORD QA_DB_PASSWORD PGPASSWORD
}
trap cleanup EXIT

require_env DEV_DB_HOST
require_env DEV_DB_PORT
require_env DEV_DB_NAME
require_env DEV_DB_USER
require_env DEV_DB_PASSWORD
require_env QA_DB_HOST
require_env QA_DB_PORT
require_env QA_DB_USER
require_env QA_DB_PASSWORD

[[ "$DEV_DB_HOST" =~ (^|[-.])dev(cluster)?([-.]|$) ]] || fail "Dev host is not visibly Dev-marked"
[[ ! "$DEV_DB_HOST" =~ (^|[-.])(qa|prod)([-.]|$) ]] || fail "Dev host contains a QA or production marker"
[[ "$QA_DB_HOST" =~ (^|[-.])qa([-.]|$) ]] || fail "QA host is not visibly QA-marked"
[[ ! "$QA_DB_HOST" =~ (^|[-.])(dev|prod)([-.]|$) ]] || fail "QA host contains a Dev or production marker"

PGPASSWORD="$DEV_DB_PASSWORD" PGOPTIONS='-c default_transaction_read_only=on' pg_dump \
  --host "$DEV_DB_HOST" \
  --port "$DEV_DB_PORT" \
  --username "$DEV_DB_USER" \
  --dbname "$DEV_DB_NAME" \
  --no-password \
  --format custom \
  --file "$dump_path"

readonly restored_database="mangorts_qa_copy_$(date -u +%Y%m%d%H%M%S)"

PGPASSWORD="$QA_DB_PASSWORD" createdb \
  --host "$QA_DB_HOST" \
  --port "$QA_DB_PORT" \
  --username "$QA_DB_USER" \
  --maintenance-db postgres \
  --no-password \
  --template template0 \
  "$restored_database"

PGPASSWORD="$QA_DB_PASSWORD" pg_restore \
  --host "$QA_DB_HOST" \
  --port "$QA_DB_PORT" \
  --username "$QA_DB_USER" \
  --dbname "$restored_database" \
  --no-password \
  --single-transaction \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  "$dump_path"

printf 'QA_COPY_RESTORED_DATABASE=%s\n' "$restored_database"
