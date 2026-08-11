# Backend Workspace Read and Cache Notes

Last updated: 2026-08-05

## Current workspace snapshot contract

`GET /v1/workspace/snapshot` supports the retained `full`, `company_explorer`, and `kanban` scopes. Responses contain only the entities and projections required by those products. ETags come from `workspace_read_versions`, with static and domain-event keys defined by `workspace_static_read_version_keys()` and `workspace_read_version_keys_for_domain_event(...)`.

## Request behavior

- Snapshot handlers validate company, scope, folder, board, pagination, and access before reading response rows.
- The browser does not use the full workspace snapshot for Node or Logic Gate relationship caches; those caches load their exact resource and relationship endpoints.
- Company Explorer reads stay folder/item scoped and permission filtered.
- Kanban reads stay board/resource scoped and bounded.
- A conditional request may return `304` only after the viewer's current authorization and exact read version are established.

## Hot-read visibility

Authorization must remain set-based. List and snapshot handlers should filter accessible entity IDs in bounded queries instead of calling `UserCanViewEntity` once per result row. Node and Logic Gate detail handlers should load only relationships relevant to the selected entity rather than reloading every company record.

The retained read-version row is an invalidation token, not authorization. A successful version lookup never bypasses current resource access checks.

## Observability

Request timing logs should distinguish request validation, access checks, source reads, serialization, and response writes for workspace snapshots and entity batches. Alerting should watch sustained snapshot request rates, unexpected `200`/`304` changes, high source time, and permission-filter regressions.

## Verification

- Workspace scope/ETag tests under `backend/internal/http`
- Read-version routing tests under `backend/internal/store`
- Frontend Node and Logic Gate relationship-cache tests
- Repository-wide realtime scope inventory tests
