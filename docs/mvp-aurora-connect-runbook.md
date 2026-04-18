# MVP Runbook: Connect App to Existing Aurora PostgreSQL (**Windows-first**)

You are on **Windows**. These instructions are written for Windows PowerShell first.

This runbook assumes you already have an Aurora PostgreSQL cluster and want to keep it.

## 1) Keep existing Aurora unless broken

Do **not** delete a healthy empty cluster. Reuse it and apply canonical schema.

Only recreate if there is a hard issue you cannot safely repair in-place:
- wrong VPC/subnets
- wrong security model
- wrong engine family/version policy for your org

## 2) Install tools on Windows

You need:
- PostgreSQL client tools (`psql`) available in PowerShell
- Go installed

Quick check in PowerShell:

```powershell
psql --version
go version
```

If PowerShell blocks script execution, run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

## 3) Copy values from AWS Console (exactly)

In AWS Console, open **RDS -> Databases -> your Aurora cluster** and copy:
- **Writer endpoint only** (just the hostname, no `host=` prefix) -> `DB_HOST`
- **Port** (usually `5432`) -> `DB_PORT`
- **DB username** -> `DB_USER`
- **DB name** (or use `postgres`) -> `DB_NAME`
- **DB password** -> `PGPASSWORD` and `DB_PASSWORD`

Example of valid `DB_HOST`:
- `miraerts-northerncalifornia-devcluster.cluster-xxxxxxxx.us-west-1.rds.amazonaws.com`

Do **not** set it like:
- `host=miraerts-northerncalifornia-devcluster.cluster-xxxxxxxx.us-west-1.rds.amazonaws.com`

## 4) Set environment variables in PowerShell

Run this in a PowerShell window from repo root:

```powershell
$env:DB_HOST = "<aurora-writer-endpoint>"
$env:DB_PORT = "5432"
$env:DB_NAME = "postgres"
$env:DB_USER = "<db-user>"
$env:PGPASSWORD = "<db-password>"
$env:DB_PASSWORD = $env:PGPASSWORD
$env:DB_SSLMODE = "require"
$env:APP_ENV = "staging"
```

## 5) Apply canonical schema + verify tables (Windows)

From repo root:

```powershell
./scripts/apply_canonical_schema.ps1
./scripts/check_db_ready.ps1
```

## 6) Start backend against Aurora (Windows)

```powershell
cd backend
go run ./cmd/miraeopus-api
```

## 7) Smoke test API (PowerShell)

Open a second PowerShell window at repo root and run:

```powershell
$companyId = "11111111-1111-1111-1111-111111111111"

$nodePayload = @{ company_id = $companyId; header = "MVP launch critical path" } | ConvertTo-Json
$nodeResp = Invoke-RestMethod -Method Post -Uri "http://localhost:8080/v1/nodes" -ContentType "application/json" -Body $nodePayload
$nodeResp | ConvertTo-Json -Depth 6

$nodeId = $nodeResp.node_id

$infoPayload = @{ company_id = $companyId; type = "Status"; information = "In Progress" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://localhost:8080/v1/nodes/$nodeId/information" -ContentType "application/json" -Body $infoPayload | ConvertTo-Json -Depth 6

$opPayload = @{
  company_id = $companyId
  node_id = $nodeId
  status = "In Progress"
  start_timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
} | ConvertTo-Json

$opResp = Invoke-RestMethod -Method Post -Uri "http://localhost:8080/v1/operations" -ContentType "application/json" -Body $opPayload
$opResp | ConvertTo-Json -Depth 6

$opId = $opResp.operation_id
Invoke-RestMethod -Method Get -Uri "http://localhost:8080/v1/operations/$opId?company_id=$companyId" | ConvertTo-Json -Depth 6
```

## 8) ECS wiring (when ready)

Ensure ECS task env vars are present:
- `DB_HOST`
- `DB_PORT=5432`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD` from Secrets Manager
- `DB_SSLMODE=require`
- `APP_ENV=staging` or `APP_ENV=prod`

## 9) Safety guardrails for enterprise pilots

- Never run pilot data in in-memory fallback mode.
- Keep `APP_ENV=staging|prod` so DB failures are fail-fast.
- Always include `company_id` in requests and query filters.
- If you launch PowerShell as a new window, re-set env vars (they are per-session unless persisted).
- If you see `could not translate host name "host=..."`, your `DB_HOST` included `host=` by mistake. Set only the raw endpoint hostname and rerun step 5.
- If you see `syntax error at or near "not"` on `create type if not exists`, pull latest repo changes and rerun; the schema now uses PostgreSQL-compatible `DO $$` guards for enum creation.
