# MiraeOpus Backend (Go MVP Skeleton)

This is the first backend scaffold for the Case source-of-truth model.

## Run

```bash
go run ./cmd/miraeopus-api
```

Server starts on `:8080` by default.

## Endpoints

- `GET /healthz`
- `POST /v1/cases`
- `GET /v1/cases/:caseId`
- `POST /v1/cases/:caseId/children`
- `POST /v1/cases/:caseId/artifacts`
- `DELETE /v1/cases/:caseId/artifacts/:artifactId`

## Notes

- Current implementation uses an in-memory repository for speed.
- PostgreSQL-first schema is prepared in `db/schema.sql` for the next step.
- Designed to map directly to Case + Child Cases + Artifact link/unlink + Activity timeline.
