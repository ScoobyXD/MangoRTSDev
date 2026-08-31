# Backend Workspace Read and Cache Notes

Last updated: 2026-08-30

## Action Item and My Work contracts

`POST /v1/action-items` accepts an optional `source` object with exact `resource_type` and `resource_id`. Source is allowed only for Node, Process, Project, Huddle Node, Huddle Board, and KPI editor owners. The backend validates the same-company endpoint and current actor access and creates the Action Item and Source atomically. Omitting `source` keeps direct Entities-page creation valid and leaves Source unset.

`GET /v1/action-items/{entity_id}/source?company_id={company_id}` returns the current permission-safe Source projection or `null`. It resolves the current resource name and never returns a hidden, missing, recycled, permanently deleted, or unset identity.

`GET /v1/huddle-nodes/{huddle_node_id}/action-items?company_id={company_id}&scope=created` returns exact-Node Source provenance, including completed items. `scope=due&viewing_date=YYYY-MM-DD` filters the owning Huddle Board's current rollup to incomplete Action Items whose Completion due date is on or before the cutoff and excludes exact IDs from the created scope.

Huddle Node create, list, get, update, recycle, and restore responses carry required `huddle_date`. Create always assigns the current America/Los_Angeles business day on the server and accepts no client date override; update validates and persists a supplied calendar date.

Open Huddle Action Item surfaces subscribe through the existing realtime spine. A Node uses `huddle-action-items:{huddle_node_id}` and requires current Edit access to that exact Node. A Board uses `huddle-board-action-items:{huddle_logic_gate_id}` and requires current Edit access to that exact Board. Both receive compact `huddle_action_items.changed` invalidations and then reread their canonical HTTP list; the socket payload is never list truth.

Huddle presentation settings reuse `/v1/saved-views` through `huddle_logic_gate_action_items`, `huddle_node_created_action_items`, and `huddle_node_due_action_items`. The retired `huddle_node_action_items` surface is invalid.

`GET /v1/my-work` accepts one optional canonical `subject_user_id`. When omitted, the subject is the authenticated viewer. A selected subject must be a current member of the requested company; that subject determines work candidacy while the authenticated viewer continues to determine resource access and permission-safe inline context. Process status counts include only child Nodes the viewer may access. The legacy `user_id` and `target_user_id` parameters remain invalid. The endpoint accepts `role` only with the `nodes` or `processes` section and accepts `perspective=mine|delegated` only with the `action_items` section. Node and Process roles default independently to Responsible, Action Items default to Mine, and every cursor is bound to its company, subject, viewer, section, selector, grouping, ordering, and History mode.

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
