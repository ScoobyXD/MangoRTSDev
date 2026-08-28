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

Canonical schema snapshot:

```text
backend/db/schema.sql
```

Fresh databases must apply this snapshot only through the guarded migration
runner with `-mode schema -baseline-migrations -require-empty-database`.


### Entities (2026-08-27)

The current Entity system uses five company-scoped tables: `entity_types`, `entity_folders`, `entity_field_types`, `entities`, and `entity_fields`. Folders form a same-company, same-type parent-child tree. Field types belong to an entity type and may be scoped to one folder; they are defaults copied from the type root through the selected folder path when an entity is created. The copied entity fields are independent and may then be added, edited, retyped, reordered, or deleted without changing the defaults.

Migration `backend/db/migrations/20260827_entities.sql` strictly removes the retired reusable-label `entity_fields` table and `entity_field_assignments`, then creates the new Entity schema. It is a destructive cutover with no compatibility layer or data conversion. Apply it only through the normal reviewed migration workflow before deploying the Entities API. No agent task should apply it to a live database.

Incremental migrations:

```text
backend/db/migrations/
```

### Permanent Tiptap textbox storage contract (2026-08-02)

The editor cutover is complete. `GET /v1/editor-data-format` reports the permanent `tiptap_json/ready` contract directly; runtime behavior no longer depends on a database rollout or workspace-format row.

Current editor documents live only in `node_textboxes`, `project_textboxes`, and `logic_gate_textboxes`. Manual saves live only in `node_textboxes_history`, `project_textboxes_history`, and `logic_gate_textboxes_history`. Ordinary commits update `body_json` and `revision` in the current table and enqueue realtime delivery in the same transaction. They do not create automatic operation or version copies. The one-GiB owner limit counts active `body_json` values only; attachment objects and manual history do not count.

The generic JSON document/operation/version tables and the owner-specific Project/Logic Gate document/operation/version tables were retired after the textbox cutover. Migration `20260801_z_retire_legacy_editor_storage.sql` refuses to drop any of the nine tables when one still contains rows, then removes empty remnants and repoints cutover and size-limit functions at the permanent textbox tables. The canonical schema never creates the retired tables. Email bodies, drafts, signatures, imported snapshots, display, and delivery remain rich HTML in their existing domain tables.

Migration `20260802_retire_node_v2_and_legacy_editor.sql` strictly removes the remaining ten editor cutover/HTML-collaboration tables and eleven unshipped Node v2 tables. It also reduces `node_textboxes` to current JSON, ordering, revision, identity, and timestamps. The six current/history textbox tables and the existing information/projection tables remain. The migration deliberately has no missing-object skips: a missing object is schema drift that must be understood before rollout.

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

For a fresh empty DB, follow `docs/infra/mangorts-database-migrations.md` and run
the human-controlled migration task with:

```text
miraeopus-migrate -mode schema -baseline-migrations -require-empty-database
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
# Existing databases only:
./scripts/apply_db_migrations.sh --dry-run
./scripts/apply_db_migrations.sh
```

The migration runner records applied files in `schema_migrations` so migrations are not rerun on later deploys.

## Permanent editor textbox storage (2026-08-01)

Node, Project, and Logic Gate current documents use `node_textboxes`, `project_textboxes`, and `logic_gate_textboxes`. Their manual history uses the matching `_history` tables. The former generic and owner-specific document/operation/version tables are no longer runtime storage and are absent from the canonical schema.

The cutover audit, conversion, rollback, workspace-format, and HTML-collaboration tables are retired. Conversion scripts and runtime fallback routes were removed with them. Email-owned HTML remains in the email draft, signature, imported-message, and delivery domains; it is not editor collaboration storage.

Migration `20260728_zz_retire_yjs_storage.sql` removed the abandoned Yjs update/checkpoint tables, sequence columns, verification pins, and cleanup functions. Migration `20260802_retire_node_v2_and_legacy_editor.sql` removes the later Node v2 purge helper together with the unshipped Node v2 tables; normal retained-table foreign keys continue to govern company deletion.
