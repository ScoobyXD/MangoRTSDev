# MiraeOpus Backend (Canonical Aurora MVP)

This backend now targets the canonical Aurora PostgreSQL schema (`nodes`, `node_information`, `logic_gates`, `operations`, etc.).

## Run locally

```bash
cd backend
go run ./cmd/miraeopus-api
```

Server starts on `:8080` by default.

If you also want to use the UI, start the frontend in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Then open the printed Vite URL (usually `http://localhost:5173`).

## Where env vars are stored

This backend reads variables from your **process environment** at runtime (`os.Getenv`), not from a
database table and not from a committed config file by default.

- If you set env vars in your current terminal session, they live only for that session.
- If you set env vars with a user/system profile setting, they persist across sessions.

Quick examples:

### Windows PowerShell (current terminal only)

```powershell
$env:APP_ENV="staging"
$env:DB_HOST="your-aurora-endpoint.rds.amazonaws.com"
$env:DB_PORT="5432"
$env:DB_USER="postgres"
$env:DB_PASSWORD="your-password"
$env:DB_NAME="postgres"
$env:DB_SSLMODE="require"
go run ./cmd/miraeopus-api
```

### macOS/Linux (current terminal only)

```bash
export APP_ENV=staging
export DB_HOST=your-aurora-endpoint.rds.amazonaws.com
export DB_PORT=5432
export DB_USER=postgres
export DB_PASSWORD=your-password
export DB_NAME=postgres
export DB_SSLMODE=require
go run ./cmd/miraeopus-api
```

A template is provided at `backend/.env.example` so you can copy values in one place.
Note: the app does **not** auto-load `.env`; you still need to export/set vars before `go run`.

## Professional setup (startup/enterprise)

Using PowerShell exports is fine for quick local runs, but not how you should run staging/prod.

- **Local development**: use `backend/.env.example` as a template, then load from your shell profile or tool like `direnv`.
- **Containers (ECS/Fargate)**: inject non-secret values as env vars and secrets (like `DB_PASSWORD`) from AWS Secrets Manager.
- **Staging/Production**: keep secrets in a managed secret store, grant access via IAM task role, rotate credentials, and avoid manual terminal exports.

This repo already follows that production pattern in Terraform task definitions (environment + secrets).
See `infra/terraform/ecs.tf` and `docs/backend-production-config.md` for the exact approach.

## Database mode and safety behavior

- `APP_ENV=dev` (default): if `DB_HOST` is missing/unreachable, backend can fall back to in-memory repo.
- `APP_ENV=staging` or `APP_ENV=prod`: backend is **fail-fast** and requires working PostgreSQL.
- You can explicitly allow fallback with `ALLOW_INMEMORY_FALLBACK=true` for temporary demos only.

Required DB env vars when using PostgreSQL:
- `DB_HOST`
- `DB_PORT` (default `5432`)
- `DB_USER` (default `postgres`)
- `DB_PASSWORD`
- `DB_NAME` (default `postgres`)
- `DB_SSLMODE` (default `require`)

`DB_HOST` must be the raw Aurora endpoint hostname (not prefixed with `host=`).

If you ever see `sql: unknown driver "postgres"`, the backend is being opened with the wrong
driver name. This project uses the pgx stdlib SQL driver (`github.com/jackc/pgx/v5/stdlib`), so
the driver passed to `sql.Open` must be `pgx`, not `postgres`.

To verify your local checkout has dependencies and builds:

```bash
cd backend
go mod tidy
go test ./...
```

## Bootstrap canonical schema

### Windows PowerShell (recommended for Windows laptops)

```powershell
./scripts/apply_canonical_schema.ps1
./scripts/apply_node_relationship_guards.ps1
./scripts/check_db_ready.ps1
```

### macOS/Linux

```bash
./scripts/apply_canonical_schema.sh
./scripts/apply_node_relationship_guards.sh
./scripts/check_db_ready.sh
```

Or directly:

```bash
psql "host=$DB_HOST port=${DB_PORT:-5432} user=$DB_USER dbname=$DB_NAME sslmode=${DB_SSLMODE:-require}" \
  -f db/schema.sql
```

For existing databases that were created before relationship guard constraints were added, run:

```bash
./scripts/apply_node_relationship_guards.sh
```

These guards enforce:
- only Parent<->Child or Peer<->Peer relationship position pairs
- no self-relationships (`node_id_a <> node_id_b`)

For existing databases that were created before blank-information guards were added, run:

```powershell
psql "host=$env:DB_HOST port=$env:DB_PORT user=$env:DB_USER dbname=$env:DB_NAME sslmode=$env:DB_SSLMODE" -f .\db\migrations\20260501_nonblank_information_guards.sql
```

These guards reject new whitespace-only `node_information`, `node_projection_table`,
`logic_gate_information`, and `logic_gate_projection_table` rows while leaving any old
accidental blank rows untouched.

For existing databases that were created before logic-gate information projections were added, run:

```powershell
psql "host=$env:DB_HOST port=$env:DB_PORT user=$env:DB_USER dbname=$env:DB_NAME sslmode=$env:DB_SSLMODE" -f .\db\migrations\20260501_logic_gate_projection_table.sql
```

For existing databases that were created before workspace folders were added, run:

```powershell
psql "host=$env:DB_HOST port=$env:DB_PORT user=$env:DB_USER dbname=$env:DB_NAME sslmode=$env:DB_SSLMODE" -f .\db\migrations\20260501_workspace_folders.sql
```

## API endpoints (MVP canonical set)

- `GET /healthz`
- `POST /v1/nodes`
- `GET /v1/nodes/{node_id}?company_id={uuid}`
- `POST /v1/nodes/{node_id}/information`
- `GET /v1/nodes/{node_id}/projection?company_id={uuid}`
- `GET /v1/logic-gates?company_id={uuid}`
- `POST /v1/logic-gates`
- `GET /v1/logic-gates/{logic_gate_id}?company_id={uuid}`
- `PUT /v1/logic-gates/{logic_gate_id}`
- `DELETE /v1/logic-gates/{logic_gate_id}?company_id={uuid}`
- `POST /v1/logic-gates/{logic_gate_id}/information`
- `GET /v1/logic-gates/{logic_gate_id}/projection?company_id={uuid}`
- `GET /v1/logic-gate-relationships?company_id={uuid}`
- `POST /v1/logic-gate-relationships`
- `DELETE /v1/logic-gate-relationships/{logic_gate_relationship_id}?company_id={uuid}`
- `GET /v1/workspace/folders?company_id={uuid}&folder_kind=node|logic_gate`
- `POST /v1/workspace/folders`
- `PUT /v1/workspace/folders/{folder_id}`
- `DELETE /v1/workspace/folders/{folder_id}?company_id={uuid}`
- `GET /v1/workspace/folder-items?company_id={uuid}&folder_id={uuid}&item_type=node|logic_gate`
- `POST /v1/workspace/folder-items`
- `DELETE /v1/workspace/folder-items?company_id={uuid}&item_type=node|logic_gate&item_id={uuid}`
- `POST /v1/operations`
- `GET /v1/operations/{operation_id}?company_id={uuid}`

### Request examples

Create node:

```bash
curl -X POST http://localhost:8080/v1/nodes \
  -H 'content-type: application/json' \
  -d '{"company_id":"11111111-1111-1111-1111-111111111111","title":"Customer onboarding"}'
```

Create logic gate:

```bash
curl -X POST http://localhost:8080/v1/logic-gates \
  -H 'content-type: application/json' \
  -d '{"company_id":"11111111-1111-1111-1111-111111111111","header":"Validate intake"}'
```

Create logic gate relationship:

```bash
curl -X POST http://localhost:8080/v1/logic-gate-relationships \
  -H 'content-type: application/json' \
  -d '{"company_id":"11111111-1111-1111-1111-111111111111","logic_gate_id_a":"<source_gate_id>","logic_gate_id_b":"<target_gate_id>","a_position":"Input","b_position":"Output"}'
```

Add node information:

```bash
curl -X POST http://localhost:8080/v1/nodes/<node_id>/information \
  -H 'content-type: application/json' \
  -d '{"company_id":"11111111-1111-1111-1111-111111111111","type":"Status","information":"Waiting on legal"}'
```

Add or update logic gate text information with a stable projection key:

```bash
curl -X POST http://localhost:8080/v1/logic-gates/<logic_gate_id>/information \
  -H 'content-type: application/json' \
  -d '{"company_id":"11111111-1111-1111-1111-111111111111","type":"Text box","information":"Validate required fields","information_id":"<stable_textbox_uuid>"}'
```

Read latest projected logic gate information:

```bash
curl "http://localhost:8080/v1/logic-gates/<logic_gate_id>/projection?company_id=11111111-1111-1111-1111-111111111111"
```

Create a folder and move a node into it:

```bash
curl -X POST http://localhost:8080/v1/workspace/folders \
  -H 'content-type: application/json' \
  -d '{"company_id":"11111111-1111-1111-1111-111111111111","folder_kind":"node","name":"Customer onboarding"}'

curl -X POST http://localhost:8080/v1/workspace/folder-items \
  -H 'content-type: application/json' \
  -d '{"company_id":"11111111-1111-1111-1111-111111111111","folder_id":"<folder_id>","item_type":"node","item_id":"<node_id>"}'

curl -X PUT http://localhost:8080/v1/workspace/folders/<child_folder_id> \
  -H 'content-type: application/json' \
  -d '{"company_id":"11111111-1111-1111-1111-111111111111","parent_folder_id":"<parent_folder_id>"}'
```

Folder rows are API-backed so headless agents can create the same explorer structure as the UI.
`workspace_folder_items` keeps one placement per node or logic gate, matching file-explorer move semantics.
Folder moves reject self/descendant parents to keep the hierarchy acyclic.

Create operation:

```bash
curl -X POST http://localhost:8080/v1/operations \
  -H 'content-type: application/json' \
  -d '{
    "company_id":"11111111-1111-1111-1111-111111111111",
    "node_id":"<node_id>",
    "status":"In Progress",
    "start_timestamp":"2026-04-18T00:00:00Z"
  }'
```


### Workspace context event/projection contract

For cross-module context synchronization, backend now supports:

- `POST /v1/workspace/context-events` for append-only context mutation writes
- `GET /v1/workspace/context-projections` for latest read projection by `company_id`, `workspace_id`, `context_id`
- `GET /v1/workspace/context-deltas` for ordered event deltas after a provided sequence

Required event fields:
- `company_id`
- `workspace_id`
- `context_id`
- `source_module_id`
- `sequence`
- `user_action_type`

Schema SQL (includes workspace context tables):
- `backend/db/schema.sql`
