#!/usr/bin/env bash
set -euo pipefail

: "${DB_HOST:?set DB_HOST}"
: "${DB_PORT:=5432}"
: "${DB_NAME:?set DB_NAME}"
: "${DB_USER:?set DB_USER}"
: "${PGPASSWORD:?set PGPASSWORD}"
export PGSSLMODE="${PGSSLMODE:-require}"
: "${COGNITO_SUBJECT:?set COGNITO_SUBJECT}"
: "${DEV_COMPANY_ID:?set DEV_COMPANY_ID}"
: "${DEV_COMPANY_NAME:=MangoRTS Dev Company}"
: "${DEV_USER_EMAIL:=}"
: "${DEV_ROLE:=owner}"

DB_HOST="${DB_HOST#host=}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 \
  -v "company_id=$DEV_COMPANY_ID" \
  -v "company_name=$DEV_COMPANY_NAME" \
  -v "cognito_subject=$COGNITO_SUBJECT" \
  -v "user_email=$DEV_USER_EMAIL" \
  -v "membership_role=$DEV_ROLE" \
  -f "$REPO_ROOT/backend/db/seed_dev_auth_membership.sql"

echo "Seeded MangoRTS dev company membership."
