# MiraeOpus Backend (Go MVP Skeleton)

This is the first backend scaffold for the Case source-of-truth model.

## Run

```bash
go run ./cmd/miraeopus-api
```

Server starts on `:8080` by default.

### Persistence mode

- If `DB_HOST` is **not** set, backend uses in-memory repository.
- If `DB_HOST` is set, backend attempts PostgreSQL via `database/sql` (`postgres` driver) with:
  - `DB_HOST`
  - `DB_PORT` (default: `5432`)
  - `DB_USER` (default: `postgres`)
  - `DB_PASSWORD`
  - `DB_NAME` (default: `postgres`)
  - `DB_SSLMODE` (default: `require`)

### Schema bootstrap (PostgreSQL mode)

```bash
psql "host=$DB_HOST port=${DB_PORT:-5432} user=$DB_USER dbname=$DB_NAME sslmode=${DB_SSLMODE:-require}" \
  -f db/schema.sql
```

## Endpoints

- `GET /healthz`
- `POST /v1/cases`
- `GET /v1/cases/:caseId`
- `POST /v1/cases/:caseId/children`
- `POST /v1/cases/:caseId/artifacts`
- `DELETE /v1/cases/:caseId/artifacts/:artifactId`

## Notes

- In-memory repo is still available for demos/tests.
- PostgreSQL repository is now supported for source-of-truth persistence.
- Designed to map directly to Case + Child Cases + Artifact link/unlink + Activity timeline.
