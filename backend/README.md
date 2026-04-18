# MiraeOpus Backend (Canonical Aurora MVP)

This backend now targets the canonical Aurora PostgreSQL schema (`nodes`, `node_information`, `logic_gates`, `operations`, etc.).

## Run locally

```bash
cd backend
go run ./cmd/miraeopus-api
```

Server starts on `:8080` by default.

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

## Bootstrap canonical schema

### Windows PowerShell (recommended for Windows laptops)

```powershell
./scripts/apply_canonical_schema.ps1
./scripts/check_db_ready.ps1
```

### macOS/Linux

```bash
./scripts/apply_canonical_schema.sh
./scripts/check_db_ready.sh
```

Or directly:

```bash
psql "host=$DB_HOST port=${DB_PORT:-5432} user=$DB_USER dbname=$DB_NAME sslmode=${DB_SSLMODE:-require}" \
  -f db/schema.sql
```

## API endpoints (MVP canonical set)

- `GET /healthz`
- `POST /v1/nodes`
- `GET /v1/nodes/{node_id}?company_id={uuid}`
- `POST /v1/nodes/{node_id}/information`
- `POST /v1/logic-gates`
- `POST /v1/operations`
- `GET /v1/operations/{operation_id}?company_id={uuid}`

### Request examples

Create node:

```bash
curl -X POST http://localhost:8080/v1/nodes \
  -H 'content-type: application/json' \
  -d '{"company_id":"11111111-1111-1111-1111-111111111111","header":"Customer onboarding"}'
```

Add node information:

```bash
curl -X POST http://localhost:8080/v1/nodes/<node_id>/information \
  -H 'content-type: application/json' \
  -d '{"company_id":"11111111-1111-1111-1111-111111111111","type":"Status","information":"Waiting on legal"}'
```

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
