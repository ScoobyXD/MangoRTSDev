# MangoRTS Backend (Canonical Aurora MVP)

The Go module and binary still use the older `miraeopus` internal name. The product name and AWS resource naming are MangoRTS.

This backend now targets the canonical Aurora PostgreSQL schema (`nodes`, `node_information`, `logic_gates`, Kanban, communications, etc.).

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
See `infra/aws-dev/ecs_alb.tf` and `docs/mangorts-dev-platform.md` for the current AWS dev approach.

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

## Auth mode

Local development leaves auth disabled unless explicitly configured.

For AWS dev:

```text
AUTH_MODE=cognito
AWS_REGION=<db/app region>
COGNITO_USER_POOL_ID=<user pool id>
COGNITO_CLIENT_ID=<spa app client id>
COGNITO_TOKEN_USE=access
```

When Cognito auth is enabled, `/healthz` remains public and `/v1/*` requires a valid Cognito access token. Requests with `company_id` are allowed only when the authenticated Cognito subject has a row in `company_memberships` for that company.

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
./scripts/apply_db_migrations.ps1
./scripts/check_db_ready.ps1
```

### macOS/Linux

```bash
./scripts/apply_canonical_schema.sh
./scripts/apply_db_migrations.sh
./scripts/check_db_ready.sh
```

Or directly:

```bash
psql "host=$DB_HOST port=${DB_PORT:-5432} user=$DB_USER dbname=$DB_NAME sslmode=${DB_SSLMODE:-require}" \
  -f db/schema.sql
```

For existing databases that were created before relationship guard constraints were added, run the generic migration runner:

```bash
./scripts/apply_db_migrations.sh
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

For existing databases that were created before Company Explorer folders were added, run:

```powershell
psql "host=$env:DB_HOST port=$env:DB_PORT user=$env:DB_USER dbname=$env:DB_NAME sslmode=$env:DB_SSLMODE" -f .\db\migrations\20260501_company_explorer_folders.sql
```

For existing databases that still have the abandoned workspace-context tables or old workspace-named folder tables, run:

```powershell
psql "host=$env:DB_HOST port=$env:DB_PORT user=$env:DB_USER dbname=$env:DB_NAME sslmode=$env:DB_SSLMODE" -f .\db\migrations\20260502_company_explorer_cleanup.sql
```

For existing databases that were created before Company Explorer row ordering was added, run:

```powershell
psql "host=$env:DB_HOST port=$env:DB_PORT user=$env:DB_USER dbname=$env:DB_NAME sslmode=$env:DB_SSLMODE" -f .\db\migrations\20260503_company_explorer_positions.sql
```

Company Explorer final-tree storage must not allow node placements. The current `company_explorer_items.target_type` constraint is `project` or `logic_gate` only; nodes are source-of-truth workspace resources that may appear in search or Logic Gate/Kanban work views, not as Company Explorer rows. If a database ever received the removed `20260706_company_explorer_email_node_items.sql` migration, remove any `target_type='node'` rows and restore `company_explorer_items_target_type_chk` to `('project', 'logic_gate')` before using final Explorer reads.

For existing databases that were created before shared map layout persistence was added, run:

```powershell
psql "host=$env:DB_HOST port=$env:DB_PORT user=$env:DB_USER dbname=$env:DB_NAME sslmode=$env:DB_SSLMODE" -f .\db\migrations\20260502_map_layout_positions.sql
```

These tables store the latest shared Node Map and Logic Gate Map positions by company/entity so UI users and headless agents read and write the same canonical layout.

For existing databases that may contain multiple editor `Text box` projection rows for the same node or logic gate, run:

```powershell
psql "host=$env:DB_HOST port=$env:DB_PORT user=$env:DB_USER dbname=$env:DB_NAME sslmode=$env:DB_SSLMODE" -f .\db\migrations\20260504_editor_text_projection_canonical.sql
```

This keeps append-only information history, deletes duplicate hot `Text box` projection rows after keeping the newest one, and adds partial unique indexes so the current one-document Editor contract stays deterministic for browsers and headless API clients.

## API endpoints (MVP canonical set)

Communications invitation response:

- `POST /v1/communications/calendar-invites/respond?company_id={uuid}&shared_inbox_id={uuid}` accepts an authorized source `message_id` and `yes`, `maybe`, or `no`. Shared-mailbox calls carry the exact `shared_inbox_id` and suppress the personal selector; personal calls omit `shared_inbox_id` and carry the selected normalized lowercase `account_email` query parameter. The backend authorizes that exact mailbox identity, resolves raw iCalendar data and the message UID to exactly one provider event, and does not accept grant, calendar, or provider event IDs from callers.

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
- `GET /v1/company-explorer/folders?company_id={uuid}&folder_kind=node|logic_gate|communications`
- `POST /v1/company-explorer/folders`
- `PUT /v1/company-explorer/folders/{folder_id}` (rename with `name`, move with `parent_folder_id`, reorder with `position`, or combine those fields)
- `DELETE /v1/company-explorer/folders/{folder_id}?company_id={uuid}`
- `GET /v1/company-explorer/folder-items?company_id={uuid}&folder_id={uuid}&item_type=node|logic_gate`
- `POST /v1/company-explorer/folder-items` (assign/move item; moving to a different folder level deletes relationships touching that node or logic gate)
- `DELETE /v1/company-explorer/folder-items?company_id={uuid}&item_type=node|logic_gate&item_id={uuid}`
- `GET /v1/map-layout?company_id={uuid}&map_type=node|logic_gate`
- `PUT /v1/map-layout`
- `POST /v1/map-entity-batches` (create node/logic-gate map entities with optional folder placement, relationships, and positions in one command)
- `GET /v1/kanban/boards?company_id={uuid}&after_position=0&limit=100`
- `POST /v1/kanban/boards`
- `PUT /v1/kanban/boards/{board_id}`
- `GET /v1/kanban/columns?company_id={uuid}&board_id={board_id}`
- `POST /v1/kanban/columns`
- `PUT /v1/kanban/columns/{column_id}`
- `DELETE /v1/kanban/columns/{column_id}?company_id={uuid}&board_id={board_id}`
- `GET /v1/kanban/cards?company_id={uuid}&board_id={board_id}&column_id={column_id}&after_position=0&limit=200`
- `POST /v1/kanban/cards`
- `PUT /v1/kanban/cards/{card_id}`
- `DELETE /v1/kanban/cards/{card_id}?company_id={uuid}&board_id={board_id}`

Node and logic-gate deletes are API-first cleanup commands. `DELETE /v1/nodes/{node_id}`
and `DELETE /v1/logic-gates/{logic_gate_id}` remove relationships, explorer placements,
map positions, projections, and any Kanban card placements for that item.

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
curl -X POST http://localhost:8080/v1/company-explorer/folders \
  -H 'content-type: application/json' \
  -d '{"company_id":"11111111-1111-1111-1111-111111111111","folder_kind":"node","name":"Customer onboarding"}'

curl -X POST http://localhost:8080/v1/company-explorer/folder-items \
  -H 'content-type: application/json' \
  -d '{"company_id":"11111111-1111-1111-1111-111111111111","folder_id":"<folder_id>","item_type":"node","item_id":"<node_id>","position":1000}'

curl -X PUT http://localhost:8080/v1/company-explorer/folders/<child_folder_id> \
  -H 'content-type: application/json' \
  -d '{"company_id":"11111111-1111-1111-1111-111111111111","parent_folder_id":"<parent_folder_id>","position":2000}'

curl -X PUT http://localhost:8080/v1/company-explorer/folders/<folder_id> \
  -H 'content-type: application/json' \
  -d '{"company_id":"11111111-1111-1111-1111-111111111111","name":"Renamed folder"}'
```

Folder rows are API-backed so headless agents can create the same explorer structure as the UI.
`company_explorer_folder_items` keeps one placement per node or logic gate, matching file-explorer move semantics.
Folders and folder items carry sparse integer `position` values; agents can reorder with one bounded write in the common case. New folders/items append after both tables in the same parent so API-created rows preserve the mixed folder/item order users see. Folder moves reject self/descendant parents to keep the hierarchy acyclic. Folder-item moves to a different folder level remove relationships for the moved node or logic gate in the same API transaction, using indexed endpoint deletes. Folder renames use the same API path so agents do not need UI-specific behavior.

Create a Kanban column and place a node card:

```bash
curl -X POST http://localhost:8080/v1/kanban/boards \
  -H 'content-type: application/json' \
  -d '{"company_id":"11111111-1111-1111-1111-111111111111","board_id":"frame-kanban-1","title":"Customer onboarding board"}'

curl -X POST http://localhost:8080/v1/kanban/columns \
  -H 'content-type: application/json' \
  -d '{"company_id":"11111111-1111-1111-1111-111111111111","board_id":"frame-kanban-1","title":"Ready","width_px":260,"height_px":240,"item_color":"#fea94e"}'

curl -X POST http://localhost:8080/v1/kanban/cards \
  -H 'content-type: application/json' \
  -d '{"company_id":"11111111-1111-1111-1111-111111111111","board_id":"frame-kanban-1","column_id":"<column_id>","node_id":"<node_id>","node_title":"Customer onboarding"}'
```

Read a bounded card window for headless agents and the UI:

```bash
curl "http://localhost:8080/v1/kanban/cards?company_id=11111111-1111-1111-1111-111111111111&board_id=frame-kanban-1&column_id=<column_id>&after_position=0&limit=200"
```

Kanban cards are intentionally node-only and minimal: `node_id`, `node_title`, optional `description_snapshot`, position, and timestamps. Keep the hot path bounded with `company_id`, `board_id`, optional `column_id`, `after_position`, and `limit`. The previous grouped/filter query endpoint and card metadata columns were removed so filtering can be rebuilt deliberately one capability at a time.
Saved Kanban boards are metadata rows. Board contents and settings remain in the column/card APIs so UI users and headless agents operate the same model.

Kanban cards are node-only through the API. Logic gates should stay in Logic Gate Map and Company Explorer workflows, not Kanban boards.

### Shared map layout contract

Node Map and Logic Gate Map geometry is persisted as a read-optimized projection, not as browser-only state.

Read layout:

```bash
curl "http://localhost:8080/v1/map-layout?company_id=11111111-1111-1111-1111-111111111111&map_type=node"
```

Write layout:

```bash
curl -X PUT http://localhost:8080/v1/map-layout \
  -H 'content-type: application/json' \
  -d '{"company_id":"11111111-1111-1111-1111-111111111111","map_type":"node","positions":[{"entity_id":"<node_id>","x":240,"y":360}]}'
```

Use `map_type:"logic_gate"` with `entity_id:"<logic_gate_id>"` for Logic Gate Map positions. Writes are intentionally bulk and capped per request so clients can debounce drag interactions and agents can batch operations without forcing full-map rewrites.

Create a map batch:

```bash
curl -X POST http://localhost:8080/v1/map-entity-batches \
  -H 'content-type: application/json' \
  -d '{
    "company_id":"11111111-1111-1111-1111-111111111111",
    "entity_kind":"logic_gate",
    "folder_id":"<optional_logic_gate_folder_id>",
    "items":[{"client_id":"gate-a","title":"Validate intake","x":240,"y":360}],
    "relationships":[{"entity_id_a":"<existing_gate_id>","client_id_b":"gate-a","a_position":"Input","b_position":"Output"}]
  }'
```

`client_id` is request-local only. The response returns `entity_mappings`, created entities, created relationships, optional folder-item rows, and saved map positions so UI clients and headless agents can apply one durable command without follow-up layout or Explorer assignment writes.
