# MangoRTS Database

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

## Applying Migrations

Run migrations from a machine that can reach the DB endpoint:

```powershell
$env:DB_SSLMODE="require"
psql "host=$env:DB_HOST port=$env:DB_PORT user=$env:DB_USER dbname=$env:DB_NAME sslmode=$env:DB_SSLMODE" -f backend/db/migrations/20260505_auth_identity_and_memberships.sql
```

Future work should replace manual SQL execution with an ordered migration runner in CI/CD.
