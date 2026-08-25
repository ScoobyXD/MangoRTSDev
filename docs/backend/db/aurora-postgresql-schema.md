# MangoRTS PostgreSQL Schema

`backend/db/schema.sql` is the executable, data-free PostgreSQL 17 schema authority. Do not copy abbreviated DDL into this document; it becomes stale and can hide missing constraints, functions, indexes, or triggers.

Use `backend/db/schema_inventory.sql` and `scripts/compare_schema_inventory.py` to compare material catalogs. Columns are compared as exact unordered sets, so physical column order is not schema drift.

The active Process Map storage authorities are:

- `process_map_placements`
- `resource_operational_relationships`
- `process_map_traces`

Their active schema contract is introduced by `20260824_process_map.sql`. Migration rules and the guarded audit process live in `docs/infra/mangorts-database-migrations.md` and `docs/infra/mangorts-schema-audit.md`.
