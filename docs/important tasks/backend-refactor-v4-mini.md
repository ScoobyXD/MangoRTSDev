# Backend Refactor V4 Mini

## Purpose

V4 Mini is a narrow cleanup project. It is not the full backend rebuild.

It exists to fix three specific problems:

1. The old `requireEntityView`, `requireEntityEdit`, and `requireEntityAdmin` path is still live and still calls recursive `UserCanAccessEntity`.
2. Old v1 node, Logic Gate, projection, Kanban, map, and workspace endpoints are still registered.
3. Legacy Kanban routes still exist, including the old card authorization pattern.

The goal is to stop the worst backend behavior quickly: recursive permission checks on active routes, old endpoint surfaces staying alive by accident, and Kanban continuing to behave like its own permission domain.

## Scope

In scope:

- Replace active entity authorization helpers with effective access.
- Preserve correct no-access behavior.
- Decide which old v1 routes stay active, become compatibility wrappers, or get disabled.
- Disable map behavior for now.
- Remove legacy Kanban authorization from active request paths.
- Point product traffic toward V2 node views, V2 Logic Gate views, and V2 Logic Gate work.
- Add focused tests proving the old paths are not used.

Out of scope:

- Full transactional effective-access rebuild.
- Full notification rewrite.
- Full shared triage rewrite.
- Full map rewrite.
- Full deletion of historical Kanban tables.
- Broad frontend redesign.

## Architecture Rules

- Active product authorization must use effective access.
- No access means no positive effective access fact.
- Positive access levels are `view`, `edit`, and `admin`.
- Invisible resources should return not found.
- Visible resources with insufficient access should return forbidden.
- Kanban is not a protected backend domain. It is a UI projection of Logic Gate work.
- Map is out of scope and should be disabled until its rewrite.
- Legacy endpoints must be intentional: disabled, compatibility-gated, or wrapped over the new model.

## Definition Of Done

V4 Mini is done when:

- `requireEntityView`, `requireEntityEdit`, and `requireEntityAdmin` no longer call `UserCanAccessEntity`.
- Active node, Logic Gate, and projection read workflows use effective access.
- Old v1 endpoint registration has been reviewed and reduced to intentional compatibility behavior.
- Map routes are disabled or feature-gated off by default.
- Workspace snapshots do not include map/Kanban legacy payloads by default.
- `/v1/kanban/*` no longer runs legacy card/board authorization logic.
- `requireKanbanCardView` is removed from active request paths.
- Tests prove the selected active routes do not call recursive legacy permission checks.
- This document has a final journal entry saying exactly what was changed and what remains deferred.

## Progress Tracker

Status values:

- `[ ]` Not started
- `[~]` In progress
- `[x]` Done
- `[!]` Blocked

### Phase 1 - Replace Recursive Entity Authorization

Problem solved by this phase:

`requireEntityView`, `requireEntityEdit`, and `requireEntityAdmin` are still live and still call recursive `UserCanAccessEntity`.

Tasks:

- [x] Audit all active callers of `requireEntityView`.
- [x] Audit all active callers of `requireEntityEdit`.
- [x] Audit all active callers of `requireEntityAdmin`.
- [x] Replace helper internals with effective-access checks.
- [x] Preserve company membership validation before entity checks.
- [x] Preserve 404 for invisible resources.
- [x] Preserve 403 for visible-but-insufficient access.
- [x] Add tests for no access, view, edit, and admin.
- [x] Add a guard test that fails if a selected active route calls `UserCanAccessEntity`.
- [x] Update the project journal with the exact callsites changed.

Success criteria:

- Active entity read/write/delete checks no longer recurse through the old DB permission function.
- Existing handlers can keep using `requireEntityView/Edit/Admin`, but those helpers must now be backed by effective access.

### Phase 2 - Make Old V1 Surfaces Intentional

Problem solved by this phase:

The v1 node, Logic Gate, projection, Kanban, map, and workspace endpoints are still registered even though the product should be moving to consolidated V2 workflows.

Tasks:

- [x] Audit active `/v1/nodes/*` detail/projection routes.
- [x] Audit active `/v1/logic-gates/*` detail/projection routes.
- [x] Audit active `/v1/map-layout` and `/v1/map-entity-batches` routes.
- [x] Audit workspace snapshot payloads for map and Kanban data.
- [x] Audit frontend callsites still using old v1 node, Logic Gate, projection, Kanban, map, and workspace APIs.
- [x] Decide for each old route: keep as effective-access compatibility, wrap over V2/consolidated behavior, or disable.
- [x] Prefer `/v2/nodes/{id}/view` for node read workflows.
- [x] Prefer `/v2/logic-gates/{id}/view` for Logic Gate read workflows.
- [ ] Prefer `/v2/logic-gates/{id}/work` for Logic Gate work/Kanban workflows.
- [x] Disable map routes by default.
- [x] Remove map payloads from normal workspace snapshots by default.
- [x] Remove Kanban legacy payloads from normal workspace snapshots by default.
- [x] Add tests for disabled/gated route behavior and workspace snapshot shape.
- [x] Update the project journal with the final route policy.

Success criteria:

- Old v1 routes are not accidentally part of the product surface.
- Anything still registered has an explicit compatibility reason and uses effective access.
- Map is not active by default.

### Phase 3 - Neutralize Legacy Kanban Authorization

Problem solved by this phase:

Legacy Kanban routes still exist, including the old card authorization pattern that loads board cards and checks linked entities.

Tasks:

- [ ] Audit all `/v1/kanban/*` route registrations.
- [ ] Audit all callers of `requireKanbanCardView`.
- [ ] Decide whether `/v1/kanban/*` returns disabled responses or compatibility responses.
- [ ] If disabled, return a clear disabled/retired response for old Kanban routes.
- [ ] If compatibility-wrapped, map reads and mutations to Logic Gate work.
- [ ] Ensure Kanban-like reads require Logic Gate view access.
- [ ] Ensure Kanban-like mutations require Logic Gate edit access.
- [ ] Remove `requireKanbanCardView` from active request paths.
- [ ] Stop loading full board card lists to authorize one card.
- [ ] Add tests proving old Kanban card authorization does not execute.
- [ ] Update the project journal with the final Kanban policy.

Success criteria:

- Kanban is no longer treated as an independent permission system.
- Active Kanban-like behavior is backed by Logic Gate work and Logic Gate effective access.
- The old card authorization pattern is gone from active paths.

## Project Journal

### Entry 1 - Created Mini Scope

V4 Mini was created as a short, practical alternative to the full V4 plan.

The mini project only targets:

- recursive entity authorization helpers
- accidental old v1 route surfaces
- legacy Kanban authorization

Anything beyond that belongs in the full V4 tracker.

### Entry 2 - Phase 1 Follow-up And Phase 2 Route Policy

Phase 1 follow-up:

- `backend/internal/http/entity_permission_handlers.go`
  - `requireEntityView`, `requireEntityEdit`, and `requireEntityAdmin` now authorize through `UserHasEffectiveAccess`.
  - `visibleEntityIDSet` now uses `ListEffectiveResourceIDsForUser`, not `ListAccessibleEntityIDs`.
  - Direct no-view/no-positive-effective-access responses return HTTP 404 with `You do not have access to this resource.`
  - Visible-but-insufficient edit/admin responses return HTTP 403 with `You do not have access to perform this action.`
- `backend/internal/http/consolidated_view_handlers.go`
  - `/v2/nodes/{id}/view` and `/v2/logic-gates/{id}/view` use the same generic 404 no-access body.
- `backend/internal/http/logic_gate_work_handlers.go`
  - `/v2/logic-gates/{id}/work` edit/admin denial now uses the generic action-denied body, and no-view remains a generic 404.
- `backend/internal/http/communications_shared_inbox_handlers.go`
  - Shared inbox folder access now uses effective access and the same generic no-access/action-denied response bodies.
- `backend/internal/http/http_helpers.go`
  - Added `writeErrorMessage` for generic access-denied JSON bodies.

Phase 2 route policy:

- `/v1/nodes` and `/v1/logic-gates`
  - Kept as effective-access compatibility list/create routes.
  - GET list responses continue to omit resources without view access.
- `/v1/nodes/{id}` and `/v1/logic-gates/{id}`
  - Kept as effective-access compatibility detail/mutation routes.
  - Read workflows should prefer `/v2/nodes/{id}/view` and `/v2/logic-gates/{id}/view`.
- `/v1/nodes/{id}/projection` and `/v1/logic-gates/{id}/projection`
  - Kept as effective-access compatibility routes for legacy projection consumers and mutations.
  - Frontend record stores now read projections through the V2 consolidated view endpoints.
- `/v1/map-layout` and `/v1/map-entity-batches`
  - Disabled by default.
  - Temporary compatibility can be enabled with `ServerOptions.LegacyMapRoutesEnabled` or `MANGORTS_ENABLE_LEGACY_MAP_ROUTES=1`.
- `/v1/workspace/snapshot`
  - Default `company_explorer` snapshots remain the normal workspace shape and omit no-view resources/items.
  - `scope=full` now omits `node_map_positions`, `logic_gate_map_positions`, and `kanban_boards` by default.
  - Full snapshots only include map payloads when legacy map routes are enabled and `include_legacy_map=1` or `include_map_payloads=1` is set.
  - Full snapshots only include legacy Kanban boards when `include_legacy_kanban=1` or `include_kanban_payloads=1` is set.
  - Scoped map snapshots remain compatibility reads for now; direct map mutation/layout routes are disabled by default.
- `/v1/kanban/*`
  - Kept as legacy compatibility for now.
  - Full workspace snapshots no longer include legacy Kanban board payloads by default.
  - Full Kanban authorization cleanup remains Phase 3.

Frontend callsite audit:

- Updated `frontend/src/modules/node-map/NodeRecordStore.ts` to read details and projections from `/v2/nodes/{id}/view`.
- Updated `frontend/src/modules/logic-gate-map/LogicGateRecordStore.ts` to read details and projections from `/v2/logic-gates/{id}/view`.
- Remaining old v1 frontend usages are intentional for Phase 2: list/search compatibility, mutations, permissions, content-change reads, map code paths that now depend on the legacy map feature gate, and Kanban paths deferred to Phase 3.

Tests added or updated:

- `backend/internal/http/v4_mini_phase2_test.go`
  - proves no-view resources are omitted from lists and workspace snapshots
  - proves direct no-view access returns 404 with the generic no-access message
  - proves visible-but-insufficient access returns 403 with the generic action-denied message
  - proves old v1 node/Logic Gate detail/projection reads are intentional compatibility routes and do not call legacy recursive access helpers
  - proves map routes are disabled by default and full snapshots omit map/Kanban legacy payloads by default
- `backend/internal/http/server_test.go`
  - legacy map-specific tests now opt in with `ServerOptions.LegacyMapRoutesEnabled`.
  - full snapshot map payload checks now opt in with `include_legacy_map=1`.
- `backend/internal/http/communications_handlers_test.go`
  - shared inbox fixture rebuilds effective access before asserting view access.

## Files To Inspect First

- `backend/internal/http/server.go`
- `backend/internal/http/entity_permission_handlers.go`
- `backend/internal/http/node_handlers.go`
- `backend/internal/http/logic_gate_handlers.go`
- `backend/internal/http/consolidated_view_handlers.go`
- `backend/internal/http/logic_gate_work_handlers.go`
- `backend/internal/http/kanban_handlers.go`
- `backend/internal/http/map_layout_handlers.go`
- `backend/internal/http/map_entity_batch_handlers.go`
- `backend/internal/http/workspace_handlers.go`
- `backend/internal/store/postgres_effective_access.go`
- `backend/internal/store/repository.go`
- frontend callsites for `/v1/nodes`, `/v1/logic-gates`, `/v1/kanban`, `/v1/map-layout`, `/v1/map-entity-batches`, and `/v1/workspace/snapshot`

## First Implementation Prompt

Read `docs/important tasks/backend-refactor-v4-mini.md` and treat it as the project tracker.

Start with Phase 1. Audit every active caller of `requireEntityView`, `requireEntityEdit`, and `requireEntityAdmin`. Then replace those helper internals so active entity authorization uses effective access instead of recursive `UserCanAccessEntity`, preserving 404 for invisible resources and 403 for visible-but-insufficient access.

Add focused tests for no access, view, edit, and admin. Add at least one guard test proving an active route does not call `UserCanAccessEntity`. Update the project journal with the exact callsites changed before stopping.

Do not start the full V4 rebuild. Do not work on notifications or shared triage unless required by this mini scope.

