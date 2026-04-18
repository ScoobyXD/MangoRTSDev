# MVP Runbook: Connect App to Existing Aurora PostgreSQL

This runbook assumes you already have an Aurora PostgreSQL cluster and want to keep it.

## 1) Keep existing Aurora unless broken

Do **not** delete a healthy empty cluster. Reuse it and apply canonical schema.

Only recreate if there is a hard issue you cannot safely repair in-place:
- wrong VPC/subnets
- wrong security model
- wrong engine family/version policy for your org

## 2) Prepare DB credentials and connectivity

Set these env vars locally (or in CI runner / bastion host):

```bash
export DB_HOST='<aurora-writer-endpoint>'
export DB_PORT='5432'
export DB_NAME='postgres'
export DB_USER='<db-user>'
export PGPASSWORD='<db-password>'
```

Network requirements:
- Aurora SG must allow inbound 5432 from your app SG (or temporary admin host)
- Route/NACL/VPC path must permit traffic

## 3) Apply canonical schema

```bash
./scripts/apply_canonical_schema.sh
./scripts/check_db_ready.sh
```

## 4) Run backend against Aurora

```bash
export APP_ENV=staging
export DB_HOST='<aurora-writer-endpoint>'
export DB_PORT='5432'
export DB_USER='<db-user>'
export DB_PASSWORD='<db-password>'
export DB_NAME='postgres'
export DB_SSLMODE='require'

cd backend
go run ./cmd/miraeopus-api
```

## 5) Smoke test canonical API

```bash
COMPANY_ID='11111111-1111-1111-1111-111111111111'

NODE_JSON=$(curl -sS -X POST http://localhost:8080/v1/nodes \
  -H 'content-type: application/json' \
  -d "{\"company_id\":\"$COMPANY_ID\",\"header\":\"MVP launch critical path\"}")

echo "$NODE_JSON"
NODE_ID=$(echo "$NODE_JSON" | sed -n 's/.*"node_id":"\([^"]*\)".*/\1/p')

curl -sS -X POST "http://localhost:8080/v1/nodes/$NODE_ID/information" \
  -H 'content-type: application/json' \
  -d "{\"company_id\":\"$COMPANY_ID\",\"type\":\"Status\",\"information\":\"In Progress\"}"

OP_JSON=$(curl -sS -X POST http://localhost:8080/v1/operations \
  -H 'content-type: application/json' \
  -d "{\"company_id\":\"$COMPANY_ID\",\"node_id\":\"$NODE_ID\",\"status\":\"In Progress\",\"start_timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}")

echo "$OP_JSON"
OP_ID=$(echo "$OP_JSON" | sed -n 's/.*"operation_id":"\([^"]*\)".*/\1/p')

curl -sS "http://localhost:8080/v1/operations/$OP_ID?company_id=$COMPANY_ID"
```

## 6) ECS wiring (when ready)

Ensure ECS task env vars are present:
- `DB_HOST`
- `DB_PORT=5432`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD` from Secrets Manager
- `DB_SSLMODE=require`
- `APP_ENV=staging` or `APP_ENV=prod`

## 7) MVP policy guardrails for enterprise pilots

- Never run pilot data in in-memory fallback mode.
- Keep `APP_ENV=staging|prod` so DB failures are fail-fast.
- Always include `company_id` in requests and query filters.
