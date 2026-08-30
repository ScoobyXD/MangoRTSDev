# MangoRTS Database Migrations

MangoRTS has a native Go migration command for CI/ECS environments where `psql` is not available in the backend image:

```text
backend/cmd/miraeopus-migrate
```

The API image in `backend/Dockerfile` remains API-only. Build migration tasks with `backend/Dockerfile.migrations`, which contains the migration binary plus `backend/db/schema.sql`, `backend/db/schema_inventory.sql`, and `backend/db/migrations`.

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

`-mode audit` opens a read-only repeatable-read transaction and reports the connected PostgreSQL `server_version`, `server_version_num`, public-table count, migration-ledger differences, filtered physical-schema inventory SHA-256, and repository-schema SHA-256. The inventory hash excludes grants and `schema_migrations` objects. The repository hash covers normalized contents of `schema.sql`, `schema_inventory.sql`, and every sorted migration filename/content. Environment-specific operator guards must reject an unsupported server version before allowing a later write task.

## Source Of Truth Standard

### 20260718 Tiptap JSON foundation

`backend/db/migrations/20260718_tiptap_json_foundation.sql` adds the inactive workspace format gate and the JSON document, operation, and version tables. It does not insert gate rows, convert HTML, or flip a workspace. Apply it through the normal reviewed migration process before deploying code that reads the new gate; do not run it manually against production from an agent task.

The later human-run conversion/cutover is separate: drain editor writes or enter a maintenance window, back up legacy HTML, insert/update the workspace gate to `converting`, convert every document, validate document/attachment/count parity, record validation, atomically set `tiptap_json/ready`, verify old-client rejection and all surfaces, then make the approved rollback/go-forward decision. Do not route individual new production documents to JSON during conversion.

### 20260719 Tiptap annotation positions

`backend/db/migrations/20260719_zz_tiptap_annotation_positions.sql` adds bounded JSONB annotation-position arrays to the inactive canonical document, stable-operation, and immutable-version tables. Positions are accepted atomically with their document revision so mapped comment/change/chat/highlight ranges do not revert after reload. Apply this migration through the normal reviewed deployment process before enabling code that commits JSON editor documents. It does not convert HTML, insert gate rows, flip a workspace, or touch email HTML storage.


### 20260721 retired entity labels and 20260827 Entities

`backend/db/migrations/20260721_entity_fields.sql` is retained only as migration history for the retired reusable-label feature. `backend/db/migrations/20260827_entities.sql` strictly drops those old `entity_fields` and `entity_field_assignments` tables, then creates the new company-scoped `entity_types`, `entity_folders`, `entity_field_types`, `entities`, and `entity_fields` tables. This cutover does not preserve or translate old label data. Apply it through the normal reviewed migration process before deploying the Entities API; never apply it to a live database from an agent task.

### 20260829 Action Item delegation and Source

`backend/db/migrations/20260829_action_item_delegation_source.sql` is the immutable shipped migration that added Assigned by and the former `action_item_sources` table. `backend/db/migrations/20260829_z_action_item_source_entity_field.sql` is the forward-only cutover to the protected `source` / `Source` / `resource` Entity Field. This development-only cutover intentionally discards legacy Source rows and recycled Source payloads, creates one null Source field for each existing Action Item, removes the old objects, and leaves Entity Fields as the sole Source authority. Apply it through the normal migration task. Never manually rerun or replace the historical file, and never apply this rollout to a live database from an agent task.

### 20260829 My Work Node completion transition

`backend/db/migrations/20260829_my_work_node_completion_transition.sql` adds the persisted nullable `nodes.completion_transition_timestamp`, backfills it once from immutable Node snapshots with the Node creation timestamp as the completed-row fallback, and creates its partial History index. Apply it through the normal reviewed migration workflow before deploying My Work Node History reads. The backfill and nonconcurrent index creation may hold transactional locks, and no agent task applies it to a live database.

MangoRTS uses both migration history and a current schema snapshot:

- `backend/db/migrations/` is the append-only change history. Every durable schema repair belongs here, even if the same SQL also exists in a DBeaver/runbook file.
- `backend/db/schema.sql` is the current canonical, data-free PostgreSQL 17 schema snapshot for reviewed fresh-database bootstrap and object inventory.
- `schema_migrations` is only a ledger of recorded filenames. It is not proof that the live database physically has every expected table, column, constraint, index, function, trigger, and type.

For a normal existing database, run pending migrations.

For a brand-new database, apply `backend/db/schema.sql` with `-baseline-migrations` after confirming the snapshot is the intended current schema. Historical replay from empty is an optional disposable audit only after proving that the full history is reconstructable; it is not the fresh QA bootstrap path.

Do not create a new environment by cloning dev schema drift or by blindly importing dev `schema_migrations`. A canonical snapshot may be regenerated from a reviewed, schema-only PostgreSQL 17 dump only after every difference from the prior canonical snapshot has been classified. Run `scripts/sanitize_pg_dump_schema.py`; never copy rows, owners, grants, tablespaces, database commands, or the migration ledger into the snapshot. Remove retired objects and repair missing required objects before approving it. Prove that the sanitized snapshot bootstraps an empty PostgreSQL 17 database and produces an identical physical inventory.

Before calling a new environment ready, first align the source environment to that reviewed canonical inventory. Then compare fresh same-commit source and target hashes: tables, exact unordered column names/counts, primary keys, foreign keys, check constraints, unique constraints, indexes, functions, triggers, enum/custom types, defaults, nullability, and extensions. Physical column order is not drift. Use `backend/db/schema_inventory.sql`, the audit hashes, and `scripts/compare_schema_inventory.py`; the runbook is `docs/infra/mangorts-schema-audit.md`.

Available flags:

```text
-schema db/schema.sql
-inventory db/schema_inventory.sql
-migrations db/migrations
-mode audit|schema|migrate|all
-dry-run
-baseline-migrations
-require-empty-database
-start-at 20260701_example.sql
-start-after 20260701_example.sql
```

Use `-mode schema` for a fresh empty database bootstrap from the canonical schema. It executes `schema.sql` in one transaction and ensures `schema_migrations` exists afterward.

Add `-require-empty-database` for every fresh hosted bootstrap. It is valid only with `-mode schema`. Before executing `schema.sql`, the runner inventories the target inside the same transaction and permits only the default `public` schema, `plpgsql` extension, and grants. Any existing application object, including `schema_migrations`, stops the command before the schema executes; the transaction then rolls back.

Use `-mode schema -baseline-migrations` only for a reviewed fresh empty database when `schema.sql` already represents all migrations currently in `backend/db/migrations/`. This records the current migration filenames in `schema_migrations` in the same transaction, so the next normal deploy only runs future migrations.

Use `-mode migrate` for normal deploys. Each pending `.sql` body and its `schema_migrations` row commit in one database transaction. The runner removes one supported top-level `BEGIN`/`COMMIT` envelope from historical files before execution inside its managed transaction and rejects nested or unsupported transaction control. It rechecks the ledger before every file so an earlier corrective migration may atomically supersede later historical files. The PowerShell and shell helpers delegate to this Go runner; they are not separate SQL execution engines.

`20260826_zzzy_process_map_actual_size_square_layout.sql` is the append-only replacement for the historical tidy, rectangular, and square Process Map data-layout migrations. It sorts before them, preserves every persisted Process dimension, preserves an enlarged Folder, grows a Folder only to its documented minimum or for containment, and applies bounded deterministic actual-size packing. In the same transaction it chooses its marker sequence above the current workspace stream and both Process Map and full-workspace read versions, verifies both read versions advanced to that marker, then records its own real filename and the three obsolete filenames. The historical file retains its original recovery-evidence writes because migration history is append-only, but those tables are not current canonical storage and the later retirement migration removes them. Do not anchor a migration run at one of the obsolete files while the corrected migration is unrecorded; the runner refuses that unsafe selection. If an obsolete layout migration already ran, the corrected migration preserves the dimensions that still exist, but it cannot reconstruct an earlier manual size without a trustworthy backup or other authoritative history.

Mango has no operator SQL rollback for this historical layout migration. Use an offline whole-database or point-in-time restore when reversal is required.

`20260828_zz_retire_unused_operational_tables.sql` directly drops `user_logic_gate_shortcuts`, `workspace_derived_domain_event_projection_checkpoints`, and the two historical Process Map recovery tables. The drops use `IF EXISTS` without `CASCADE`, so migration-history replay reaches the current retired schema, a database where the tables were already removed still converges, and an unexpected dependency stops the runner-managed transaction. The normal migration runner records the filename; there is no separate preflight or operator path.

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
go run ./cmd/miraeopus-migrate -mode schema -baseline-migrations -require-empty-database
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
["-mode", "schema", "-baseline-migrations", "-require-empty-database"]
```

The command uses PostgreSQL advisory locking during execution, skips filenames already present in `schema_migrations`, and does not require `psql` in the container.
