# MangoRTS Database V2

MangoRTS dev reuses the existing AWS PostgreSQL/Aurora database if it is confirmed safe for dev.

## Required Runtime Config

The ECS task receives:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_SSLMODE=require`
- `DB_PASSWORD` from Secrets Manager

Do not put database passwords in Terraform variables, GitHub secrets, docs, or shell history.

## Schema

Bootstrap schema:

```text
backend/db/schema.sql
```

Incremental migrations:

```text
backend/db/migrations/
```

Auth and membership tables were added in:

```text
backend/db/migrations/20260505_auth_identity_and_memberships.sql
```

## Tenant/Company Isolation

Current business tables are company-scoped with `company_id`.

When auth is enabled:

- API clients still send `company_id`.
- Backend validates that the Cognito user is a member of that company.
- Requests for companies outside the user membership return `403`.

This is the dev foundation. Later production hardening should add role-specific authorization, invitation flows, audit events, and migration tooling for company lifecycle operations.

## Phase 7 Command Sheet

Run database setup from a machine that can reach the DB endpoint. Keep passwords out of source control and set `PGPASSWORD` only in your terminal session.

Set connection variables for the real AWS dev DB:

```powershell
$env:AWS_REGION="us-west-1"
$env:DB_HOST="<aws-db-writer-endpoint>"
$env:DB_PORT="5432"
$env:DB_NAME="mangorts"
$env:DB_USER="mangorts_app"
$env:DB_PASSWORD_SECRET_ARN="<secrets-manager-db-password-arn>"

$secret = aws secretsmanager get-secret-value `
  --region $env:AWS_REGION `
  --secret-id $env:DB_PASSWORD_SECRET_ARN `
  --query SecretString `
  --output text

try {
  $json = $secret | ConvertFrom-Json
  $password = $json.password
  if (-not $password) { $password = $json.DB_PASSWORD }
  if (-not $password) { $password = $json.db_password }
  if (-not $password) { $password = $json.PGPASSWORD }
  if (-not $password) { $password = $secret }
} catch {
  $password = $secret
}

$env:PGPASSWORD=$password
$env:PGSSLMODE="require"
```

For a fresh empty DB:

```powershell
.\scripts\apply_canonical_schema.ps1
```

For an existing DB:

```powershell
.\scripts\apply_db_migrations.ps1 -DryRun
.\scripts\apply_db_migrations.ps1
```

If the dry run lists migrations that were already manually applied before `schema_migrations` existed, start at the first unapplied migration:

```powershell
$env:DB_MIGRATION_START_AT="20260505_auth_identity_and_memberships.sql"
.\scripts\apply_db_migrations.ps1 -DryRun
.\scripts\apply_db_migrations.ps1
Remove-Item Env:\DB_MIGRATION_START_AT
```

After the Cognito dev user exists, fetch its subject and seed membership:

```powershell
$env:COGNITO_USER_POOL_ID="<cognito-user-pool-id>"
$env:DEV_USER_EMAIL="dev@example.com"
$env:DEV_COMPANY_ID="11111111-1111-1111-1111-111111111111"
$env:DEV_COMPANY_NAME="MangoRTS Dev Company"
$env:DEV_ROLE="owner"

$user = aws cognito-idp admin-get-user `
  --region $env:AWS_REGION `
  --user-pool-id $env:COGNITO_USER_POOL_ID `
  --username $env:DEV_USER_EMAIL | ConvertFrom-Json

$env:COGNITO_SUBJECT = ($user.UserAttributes | Where-Object { $_.Name -eq "sub" }).Value
.\scripts\seed_dev_auth_membership.ps1
```

Shell equivalents:

```bash
export DB_HOST="<aws-db-writer-endpoint>"
export DB_PORT="5432"
export DB_NAME="mangorts"
export DB_USER="mangorts_app"
export PGPASSWORD="<db-password>"
./scripts/apply_canonical_schema.sh
# or, for existing DBs:
./scripts/apply_db_migrations.sh --dry-run
./scripts/apply_db_migrations.sh
```

The migration runner records applied files in `schema_migrations` so migrations are not rerun on later deploys.
