# MangoRTS Database Migrations

MangoRTS has a native Go migration command for CI/ECS environments where `psql` is not available in the backend image:

```text
backend/cmd/miraeopus-migrate
```

The API image in `backend/Dockerfile` remains API-only. Build migration tasks with `backend/Dockerfile.migrations`, which contains the migration binary plus `backend/db/schema.sql` and `backend/db/migrations`.

## Configuration

The command reads the same database environment variable names as the API:

- `DB_HOST` - required
- `DB_PASSWORD` - required
- `DB_PORT` - defaults to `5432`
- `DB_USER` - defaults to `postgres`
- `DB_NAME` - defaults to `postgres`
- `DB_SSLMODE` - defaults to `require`
- `DB_CONNECT_TIMEOUT_SECONDS` - defaults to `5`

Production tasks should set all database values explicitly and source `DB_PASSWORD` from Secrets Manager or the task secret configuration. Do not write production database passwords into local files, Terraform variables, docs, or shell history.

## Modes

Default mode is `migrate`. This is intentionally conservative for existing production databases: it creates `schema_migrations` if needed, reads applied filenames, and applies only pending files from `db/migrations` in filename order.

## Source Of Truth Standard

MangoRTS uses both migration history and a current schema snapshot:

- `backend/db/migrations/` is the append-only change history. Every durable schema repair belongs here, even if the same SQL also exists in a DBeaver/runbook file.
- `backend/db/schema.sql` is the current canonical schema snapshot for reviewed fresh-database bootstrap and object inventory.
- `schema_migrations` is only a ledger of recorded filenames. It is not proof that the live database physically has every expected table, column, constraint, index, function, trigger, and type.

For a normal existing database, run pending migrations.

For a brand-new database, prefer one of these two reviewed paths:

1. Apply `backend/db/schema.sql` with `-baseline-migrations` after confirming the snapshot is the intended current schema.
2. Replay all migrations from empty and compare the resulting schema to `backend/db/schema.sql`.

Do not create production by cloning dev schema drift or by blindly importing dev `schema_migrations`. Before calling a new database ready, compare the actual object inventory against the canonical schema: tables, columns, primary keys, foreign keys, check constraints, unique constraints, indexes, functions, triggers, enum/custom types, defaults, nullability, and extensions. Use `backend/db/schema_inventory.sql` and `scripts/compare_schema_inventory.py`; the runbook is `docs/infra/mangorts-schema-audit.md`.

Available flags:

```text
-schema db/schema.sql
-migrations db/migrations
-mode schema|migrate|all
-dry-run
-baseline-migrations
-start-at 20260701_example.sql
-start-after 20260701_example.sql
```

Use `-mode schema` for a fresh empty database bootstrap from the canonical schema. It executes `schema.sql` in one transaction and ensures `schema_migrations` exists afterward.

Use `-mode schema -baseline-migrations` only for a reviewed fresh empty database when `schema.sql` already represents all migrations currently in `backend/db/migrations/`. This records the current migration filenames in `schema_migrations` in the same transaction, so the next normal deploy only runs future migrations.

Use `-mode migrate` for normal deploys. Each pending `.sql` file is applied in its own transaction and then recorded in `schema_migrations`.

Use `-mode all` only when you intentionally want to run schema bootstrap and then run migrations in the same invocation. The current `schema.sql` is canonical/current, so replaying historical migrations after it may be inappropriate unless those migrations are known to be compatible with that target.

## Local Run

From `backend/`:

```powershell
$env:DB_HOST="<db-writer-endpoint>"
$env:DB_PORT="5432"
$env:DB_USER="<db-user>"
$env:DB_NAME="<db-name>"
$env:DB_SSLMODE="require"
$env:DB_PASSWORD="<set-from-your-secret-source>"

go run ./cmd/miraeopus-migrate -dry-run
go run ./cmd/miraeopus-migrate -mode migrate
```

Fresh empty database bootstrap:

```powershell
go run ./cmd/miraeopus-migrate -mode schema -baseline-migrations
```

Anchor a migration reconciliation after validating the existing schema state:

```powershell
go run ./cmd/miraeopus-migrate -dry-run -start-at 20260505_auth_identity_and_memberships.sql
go run ./cmd/miraeopus-migrate -start-at 20260505_auth_identity_and_memberships.sql
```

## Migration Image

Build locally from the repo root or from `backend/`:

```powershell
docker build -f backend/Dockerfile.migrations -t mangorts-migrate:local backend
```

or:

```powershell
cd backend
docker build -f Dockerfile.migrations -t mangorts-migrate:local .
```

The image entrypoint is `/miraeopus-migrate`. The working directory is `/app`, so the default paths resolve to `/app/db/schema.sql` and `/app/db/migrations`.

## ECS One-Off Task

For production, CI should build and push the migration image separately from the API image, then run it as a one-off ECS task in the same VPC networking path that can reach the database.

Use the backend task's database environment and secrets configuration, but override the container command for the desired mode:

```json
["-dry-run"]
```

Then, after review:

```json
["-mode", "migrate"]
```

For a confirmed fresh empty production database built from the canonical schema snapshot, use:

```json
["-mode", "schema", "-baseline-migrations"]
```

The command uses PostgreSQL advisory locking during execution, skips filenames already present in `schema_migrations`, and does not require `psql` in the container.
