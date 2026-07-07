# MangoRTS Schema Audit

Use this workflow when `schema_migrations` is not enough and you need proof that
the live database physically matches the intended schema.

This workflow does not require agents to connect to prod. The prod export must be
created through Jonat's human-only or physically read-only database path.

## What It Compares

The inventory query in `backend/db/schema_inventory.sql` reads PostgreSQL catalog
tables and emits normalized JSON for:

- schemas and extensions
- tables, views, and materialized views
- columns, including type, nullability, defaults, generated flags, and identity flags
- primary keys, foreign keys, unique constraints, check constraints, and exclusion constraints
- indexes, including uniqueness, partial predicates, expressions, and full `pg_get_indexdef`
- triggers
- functions and procedures
- enum and domain types
- sequences and sequence ownership
- RLS policies
- grants as separate optional objects

The comparator ignores `schema_migrations` metadata objects and grants by default.
Use explicit flags when you want to audit those separately.

## Create The Canonical Inventory

Create a disposable empty database using the same PostgreSQL major version or
Aurora engine family as prod when possible. Apply the canonical schema, then run
the inventory query.

Example with `psql` against a scratch database:

```powershell
psql "<scratch connection string>" -v ON_ERROR_STOP=1 -f backend\db\schema.sql
psql "<scratch connection string>" -v ON_ERROR_STOP=1 -At -f backend\db\schema_inventory.sql > .\tmp\schema-audit-canonical.json
```

If you create the scratch database with the Go migration runner instead, use the
reviewed schema path:

```powershell
cd backend
go run .\cmd\miraeopus-migrate -mode schema -baseline-migrations
```

Then run `backend/db/schema_inventory.sql` against that scratch database.

## Create The Prod Inventory

Run the same `backend/db/schema_inventory.sql` query against prod through the
approved human-only or physically read-only database path. This query is read-only
catalog inspection. It must not be run from an agent session with writer/admin DB
access.

In DBeaver, run the query and save the `schema_inventory_json` cell contents to a
local JSON file, for example:

```text
tmp/schema-audit-prod.json
```

Do not paste DB passwords, connection strings, AWS tokens, or provider secrets
into the repo.

## Compare

From the repo root:

```powershell
python scripts\compare_schema_inventory.py `
  --expected .\tmp\schema-audit-canonical.json `
  --actual .\tmp\schema-audit-prod.json `
  --expected-label canonical-schema `
  --actual-label prod `
  --output-md .\tmp\schema-audit-report.md
```

Exit code `0` means the compared objects match. Exit code `1` means at least one
object is missing, extra, or different.

To compare grants as a separate security audit:

```powershell
python scripts\compare_schema_inventory.py `
  --expected .\tmp\schema-audit-canonical.json `
  --actual .\tmp\schema-audit-prod.json `
  --include-grants `
  --output-md .\tmp\schema-audit-grants-report.md
```

To include the migration ledger table in the comparison:

```powershell
python scripts\compare_schema_inventory.py `
  --expected .\tmp\schema-audit-canonical.json `
  --actual .\tmp\schema-audit-prod.json `
  --include-schema-migrations
```

## Interpreting Results

Treat these as blocking until understood:

- `Missing In Actual`: canonical object is absent from prod.
- `Different Definitions`: object exists in both places but differs physically.
- `Extra In Actual`: prod has an object not present in the canonical schema.

Some extra objects may be intentional environment metadata, but they need a
written reason. Do not mark the audit complete just because `schema_migrations`
looks current.

## Future Database Creation Standard

For production database creation, use the current canonical schema snapshot and a
deliberate migration baseline, then run this audit before traffic.

For CI/proof, periodically replay all migrations from empty and compare that
result against the canonical schema inventory. The schema snapshot is the current
projection; migrations remain the append-only history.
