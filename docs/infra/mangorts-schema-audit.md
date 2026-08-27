# MangoRTS Schema Parity Audit

Use this workflow to prove that two PostgreSQL databases have the same material
schema. For fresh QA, first prove that the canonical schema replays exactly on a
disposable PostgreSQL 17 database, then align dev to that canonical inventory.
The blocking hosted comparison is a fresh aligned-dev inventory against a fresh
QA inventory produced from the same Git commit before the API, users, or
synthetic data are added.

`schema_migrations` is a separate ledger audit. Matching filenames do not prove
that the physical schema matches.

## What Is Compared

`backend/db/schema_inventory.sql` is the sole catalog definition. It inventories:

- schemas, extensions, tables, views, materialized views, and sequences;
- columns, including name, type, nullability, default, identity, generated,
  collation, and storage settings;
- primary, foreign, unique, check, exclusion, and constraint-trigger constraints;
- indexes, predicates, expressions, triggers, functions, procedures, enum/domain
  types, sequence ownership, and row-level security policies;
- grants as optional separate objects.

Physical column order is deliberately absent. The comparator uses the exact
unordered set of column identities and the exact object count. The same columns
in a different physical order pass; a missing or extra column fails.

Function definitions normalize Windows and Unix line endings before hashing.
This removes operating-system-only differences without hiding SQL differences.

By default, both the audit hash and offline comparator exclude grant objects and
any identity containing `schema_migrations`. This keeps environment-specific
access grants and the migration ledger out of physical application-schema parity.
Use `--include-grants` or `--include-schema-migrations` only for their separate
audits.

## Freshness Rules

A QA parity result is valid only when all of these are true:

1. Both inventories were made within the approved window, normally 24 hours.
2. Both report PostgreSQL 17.x from the connected servers.
3. Both report the same Git commit and repository schema fingerprint.
4. The repository fingerprint matches the current `schema.sql`,
   `schema_inventory.sql`, and every migration filename/content.
5. The filtered inventory SHA-256 values match.
6. The stamped `metadata.environment` values are exactly `dev` and `qa` for their
   respective exports.

The tracked historical files under `tmp/schema-audit-*.json` do not contain this
freshness metadata and are not accepted for a QA gate. Never rename or reuse an
old export to make it look current.

## Preferred QA Gate

The migration image contains `schema.sql`, `schema_inventory.sql`, and all
migrations. Its `-mode audit` command runs one read-only repeatable-read database
transaction and logs:

- connected `server_version` and `server_version_num`;
- migration-ledger counts;
- `schema_inventory_objects` and `schema_inventory_sha256`;
- `repository_schema_sha256`.

Run a fresh dev audit first with the database-enforced read-only export helper
below, then validate its stamped metadata against the current repository. Record
only the two SHA-256 values; never retrieve or print a writer password. Do not use
an old writer-backed ECS audit as the dev reference.

The QA sequence is then:

1. Bootstrap the canonical snapshot in a disposable PostgreSQL 17 database and
   require its inventory to match the reviewed canonical target exactly.
2. Run the guarded dev alignment as a separate human database operation, then
   export a fresh read-only dev inventory and require it to match canonical.
3. Run the empty QA audit from the exact migration image commit and require
   PostgreSQL 17.x, `public_tables=0`, and the dev repository fingerprint.
4. A human runs the transactional `-mode schema -baseline-migrations` task.
5. Before starting the API or creating any users/data, run the final QA audit.
6. Require the QA inventory SHA-256 to equal fresh dev and require both migration
   ledger difference counts to be zero.

`scripts/qa_run_database_task.ps1` enforces these values from completed CloudWatch
logs. It never reads or prints the ECS database secret. The hosted bootstrap
switch remains human-only because that task receives a writer credential.

An already-bootstrapped QA catalog that fails parity must remain offline and use
the reviewed QA reset procedure. The old one-migration reconciliation shortcut
is not valid after later repository migrations.

## Create A Stamped Read-Only Export

Use `scripts/export_schema_inventory.ps1` only from an already approved network
path to dev or QA. Do not create a bastion or make RDS public for this export.

The helper accepts only `dev` or `qa`, rejects a production-marked host, requires
PostgreSQL 17.x, forces read-only transactions, and checks the connected role for
database/schema/table/sequence write powers, ownership, dangerous role flags, and
executable security-definer functions. It refuses the export when any checked
capability is present.

Set these environment values from the designated database-enforced read-only
credential. Use either `PGPASSWORD` or an explicit existing `PGPASSFILE`; the
credential must not belong to a writer, backend, owner, admin, or migration role
and must never be pasted into source control or chat. The helper does not read a
password file itself, and `psql` is forbidden from opening an interactive password
prompt.

```powershell
$env:DB_HOST = "<approved-dev-or-qa-host>"
$env:DB_PORT = "5432"
$env:DB_NAME = "<approved-database>"
$env:DB_USER = "<designated-read-only-user>"
$env:DB_SSLMODE = "require"
$env:PGSSLMODE = "require"
# Preferred when an approved read-only libpq password file already exists:
$env:PGPASSFILE = Join-Path $env:APPDATA "postgresql\pgpass.conf"
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
# Otherwise, set PGPASSWORD privately in this process from the read-only source.

.\scripts\export_schema_inventory.ps1 `
  -EnvironmentLabel dev `
  -ExpectedHost $env:DB_HOST `
  -ExpectedDatabase $env:DB_NAME `
  -ExpectedReadOnlyUser $env:DB_USER `
  -OutputPath .\tmp\schema-audit-dev-fresh.json `
  -ConfirmDatabaseEnforcedReadOnlyCredential
```

Repeat for QA with QA-only values and a different output path. The helper writes
the inventory envelope and all required metadata automatically. It prints hashes,
not secrets.

## Offline Full Comparison

When both fresh stamped exports are available, run:

```powershell
python scripts\compare_schema_inventory.py `
  --expected .\tmp\schema-audit-dev-fresh.json `
  --actual .\tmp\schema-audit-qa-fresh.json `
  --expected-label dev `
  --actual-label qa `
  --require-postgres-major 17 `
  --require-same-commit `
  --require-current-repository `
  --require-expected-environment dev `
  --require-actual-environment qa `
  --max-export-age-hours 24 `
  --output-md .\tmp\schema-audit-dev-qa-report.md
```

Exit code `0` means metadata and compared objects pass. Exit code `1` means an
object is missing, extra, or different. Exit code `2` means the freshness,
PostgreSQL version, commit, repository fingerprint, or embedded hash gate failed.

The report lists exact object identities when hashes differ. Compare grants
separately when needed:

```powershell
python scripts\compare_schema_inventory.py `
  --expected .\tmp\schema-audit-dev-fresh.json `
  --actual .\tmp\schema-audit-qa-fresh.json `
  --include-grants
```

## Optional Disposable Precheck

A human or agent may apply the current `backend/db/schema.sql` and migration
baseline to an isolated disposable local PostgreSQL 17 database, then run
`schema_inventory.sql` to check the canonical projection before QA exists. This
local replay is required release evidence, but it is not a permanent environment
and does not replace fresh aligned-dev-versus-QA catalog parity. Agents must not
run the schema write on hosted dev or QA or receive a hosted writer credential.

PostgreSQL 18 can exercise the tooling locally, but it is not release evidence for
the PostgreSQL 17.x QA target.

## Limits

This gate compares schema, not row data, business-data correctness, query plans,
database parameters, extension binaries, server configuration, or application
behavior. Grants and `schema_migrations` are excluded by default and require their
own review. A hash mismatch is a stop, not permission to repair a hosted database
from an agent session.
