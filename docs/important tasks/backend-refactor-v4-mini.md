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

- [ ] Audit all active callers of `requireEntityView`.
- [ ] Audit all active callers of `requireEntityEdit`.
- [ ] Audit all active callers of `requireEntityAdmin`.
- [ ] Replace helper internals with effective-access checks.
- [ ] Preserve company membership validation before entity checks.
- [ ] Preserve 404 for invisible resources.
- [ ] Preserve 403 for visible-but-insufficient access.
- [ ] Add tests for no access, view, edit, and admin.
- [ ] Add a guard test that fails if a selected active route calls `UserCanAccessEntity`.
- [ ] Update the project journal with the exact callsites changed.

Success criteria:

- Active entity read/write/delete checks no longer recurse through the old DB permission function.
- Existing handlers can keep using `requireEntityView/Edit/Admin`, but those helpers must now be backed by effective access.

### Phase 2 - Make Old V1 Surfaces Intentional

Problem solved by this phase:

The v1 node, Logic Gate, projection, Kanban, map, and workspace endpoints are still registered even though the product should be moving to consolidated V2 workflows.

Tasks:

- [ ] Audit active `/v1/nodes/*` detail/projection routes.
- [ ] Audit active `/v1/logic-gates/*` detail/projection routes.
- [ ] Audit active `/v1/map-layout` and `/v1/map-entity-batches` routes.
- [ ] Audit workspace snapshot payloads for map and Kanban data.
- [ ] Audit frontend callsites still using old v1 node, Logic Gate, projection, Kanban, map, and workspace APIs.
- [ ] Decide for each old route: keep as effective-access compatibility, wrap over V2/consolidated behavior, or disable.
- [ ] Prefer `/v2/nodes/{id}/view` for node read workflows.
- [ ] Prefer `/v2/logic-gates/{id}/view` for Logic Gate read workflows.
- [ ] Prefer `/v2/logic-gates/{id}/work` for Logic Gate work/Kanban workflows.
- [ ] Disable map routes by default.
- [ ] Remove map payloads from normal workspace snapshots by default.
- [ ] Remove Kanban legacy payloads from normal workspace snapshots by default.
- [ ] Add tests for disabled/gated route behavior and workspace snapshot shape.
- [ ] Update the project journal with the final route policy.

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

