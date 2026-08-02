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


### Entity field labels (2026-07-21)

`entity_fields` stores company-scoped reusable label definitions with case-insensitively unique names, validated colors, and stable display positions. `entity_field_assignments` is the projection table for assigning those definitions to exactly one Project, Node, or Logic Gate. Its check constraint enforces the target type/column pairing, its generated `resource_id` supports one generic lookup path, and its composite foreign keys prevent cross-company assignments.

The additive migration is `backend/db/migrations/20260721_entity_fields.sql`. Apply it through the normal reviewed migration workflow before deploying an API version that reads or writes entity fields. No agent task should apply it to a live database. Deleting a field or target entity cascades only its assignment rows.

Incremental migrations:

```text
backend/db/migrations/
```

### Permanent Tiptap textbox storage contract (2026-08-01)

`workspace_editor_formats` remains the company/workspace cutover gate. A `tiptap_json/ready` row is valid only when schema version 1 is selected, expected and converted counts match, all three owner rollout gates are ready or active, validation/cutover timestamps exist, and the active rows in the permanent textbox tables match the converted count.

Current editor documents live only in `node_textboxes`, `project_textboxes`, and `logic_gate_textboxes`. Manual saves live only in `node_textboxes_history`, `project_textboxes_history`, and `logic_gate_textboxes_history`. Ordinary commits update `body_json` and `revision` in the current table and enqueue realtime delivery in the same transaction. They do not create automatic operation or version copies. The one-GiB owner limit counts active `body_json` values only; attachment objects and manual history do not count.

The generic JSON document/operation/version tables and the owner-specific Project/Logic Gate document/operation/version tables were retired after the textbox cutover. Migration `20260801_z_retire_legacy_editor_storage.sql` refuses to drop any of the nine tables when one still contains rows, then removes empty remnants and repoints cutover and size-limit functions at the permanent textbox tables. The canonical schema never creates the retired tables. Email bodies, drafts, signatures, imported snapshots, display, and delivery remain rich HTML in their existing domain tables.

Schema version 1 includes the additive inline atom `mangoEntityLink` with required `entityType`, `entityId`, and `label` attributes. The strict API validator permits only `node`, `logic_gate`, or `project`, requires bounded nonblank identity/display values, and permits the atom only where inline content is valid. Existing legacy editor documents persist the equivalent canonical `data-mango-entity-*` attributes inside their already-owned rich-HTML columns.

Inline entity links add no database tables, columns, seed data, placement rows, or denormalized entity-link records. Their durable identity is stored inside the existing editor document payload. The editor's combined search is a read-only Company Explorer query mode over existing resource status/timestamps and authorization predicates. Migration `20260722_editor_entity_search_indexes.sql` enables PostgreSQL's trusted `pg_trgm` extension and adds GIN indexes for `lower(nodes.name)`, `lower(projects.name)`, and `lower(logic_gates.header)` so contains search does not depend on full sequential name scans. The canonical schema carries the same extension and indexes; deployment must apply this additive migration before relying on the optimized production query plan.

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

Current dev Cognito note: the Terraform user pool does not explicitly set `username_configuration.case_sensitive = false`.
Treat MangoRTS auth emails as lowercase canonical values when creating Cognito users, creating invitations, and seeding DB users.
The app still uses the Cognito `sub` claim as the internal identity key.

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

## Permanent editor textbox storage (2026-08-01)

Node, Project, and Logic Gate current documents use `node_textboxes`, `project_textboxes`, and `logic_gate_textboxes`. Their manual history uses the matching `_history` tables. The former generic and owner-specific document/operation/version tables are no longer runtime storage and are absent from the canonical schema.

`editor_conversion_runs/items`, `editor_shadow_comparisons`, `editor_rollout_gates`, and `editor_rollback_exports` remain transitional rollout evidence for a later retention decision. No default rollout rows are created.

Migration `20260728_zz_retire_yjs_storage.sql` removed the abandoned Yjs update/checkpoint tables, sequence columns, verification pins, and cleanup functions. `mangorts_prepare_company_editor_purge` remains the explicit first step of company deletion and removes restrictive Node v2 comment-attachment, email, and attachment links in dependency order; the caller must execute it and company deletion in one transaction.
