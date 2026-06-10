# Backend Refactor V4

## Purpose

V3 created the right foundation, but `main` is not fixed yet. V4 is the project to finish the backend permission rebuild and remove the old hot paths.

The goal is not to keep patching individual endpoints. The goal is to make effective access the authoritative runtime permission model, move the product onto consolidated resource APIs, and delete or hard-disable the legacy Kanban/map/v1 permission behavior that keeps dragging the backend back into per-request recursive checks.

## Current State

Main has meaningful progress:

- `effective_resource_access` exists.
- Forward and reverse access indexes exist.
- V2 node and Logic Gate consolidated views exist.
- Logic Gate work endpoints exist.
- Logic Gate access can grant contextual visibility to assigned nodes.
- RACI assignments can become edit access facts.
- Shared triage is represented as a protected resource.
- Some visible list queries now join against effective access instead of loading everything first.

Main is still not fixed:

- `requireEntityView`, `requireEntityEdit`, and `requireEntityAdmin` still call the old recursive permission path.
- Many active v1 routes still use the old authorization model.
- Legacy Kanban routes and card authorization still exist.
- Map layout is still active and still loops through positions doing per-entity checks.
- Effective access is rebuilt with a full-company projection after mutations.
- Projection refresh is best-effort from HTTP handlers, not a transactional correctness guarantee.
- Notifications are improved, but still lean on read-time visibility checks.
- Workspace snapshots still include legacy map/Kanban surfaces.

## Architecture Rules

These are the non-negotiable rules for V4.

- Runtime authorization must use effective access.
- No access is the absence of a positive effective access fact.
- The only positive resource access levels are `view`, `edit`, and `admin`.
- RACI is not a fourth permission tier.
- Any RACI assignment grants edit access to the assigned resource.
- RACI still matters for UI grouping and notification routing.
- Shared triage must be a first-class protected resource with `view`, `edit`, and `admin`.
- Shared triage descendants inherit access from their parent shared triage folder.
- If a user can view a Logic Gate, they can view nodes assigned to that Logic Gate in that context.
- Kanban is not its own protected domain. Kanban is a UI projection of Logic Gate node assignments.
- Lists must query visible rows directly. Do not load all company rows and filter them in Go.
- Notification and workspace fanout must use reverse effective access lookups.
- Full rebuilds are allowed as repair tools. They must not be required for normal correctness.

## Target Model

V4 should treat permissions as graph-derived access facts.

Source relationships:

- user belongs to company
- user belongs to group
- group belongs to parent group
- user or group has grant on resource
- user is assigned to node
- user is assigned to Logic Gate RACI role
- user or group is assigned to shared triage RACI role
- Logic Gate contains node assignment
- shared triage folder contains descendant folders/items

Derived facts:

- user can view/edit/admin node
- user can view/edit/admin Logic Gate
- user can view/edit/admin shared triage folder
- user can view contextual nodes through Logic Gate access
- resource can list users who should receive notification/workspace fanout

Runtime checks should be simple:

```text
Does user X have at least level Y on resource Z?
```

That check should be one indexed access lookup, not recursive group traversal, not per-row function calls, and not an endpoint-specific special case.

## V4 Definition Of Done

V4 is complete when all of these are true:

- Request handlers no longer call `UserCanAccessEntity`.
- Request handlers no longer call `ListAccessibleEntityIDs`.
- Protected list endpoints do not load all company entities before filtering.
- Hot-path authorization uses `UserHasEffectiveAccess` or a replacement effective-access API.
- Effective access updates happen in the same transaction as the source mutation.
- `refreshEffectiveAccessProjection` is removed from correctness paths.
- Full effective access rebuild exists only as a repair/admin command.
- V2 consolidated node and Logic Gate APIs cover the frontend read workflow.
- Legacy Kanban board/card permission logic is removed, disabled, or converted into thin compatibility wrappers over Logic Gate work.
- Map layout is disabled or removed from active workspace behavior until the map rewrite happens.
- Notifications are created and routed from event targets plus reverse effective access.
- Shared triage routes enforce effective access.
- Tests fail if legacy recursive permission paths are used by new hot endpoints.

## Progress Tracker

Status values:

- `[ ]` Not started
- `[~]` In progress
- `[x]` Done
- `[!]` Blocked

### Phase 0 - Baseline Audit

- [ ] List every active route that calls `requireEntityView`, `requireEntityEdit`, `requireEntityAdmin`, `visibleEntityIDSet`, `filterVisibleNodes`, `filterVisibleLogicGates`, `requireKanbanCardView`, or `ListAccessibleEntityIDs`.
- [ ] List every store method that still calls the recursive DB permission function.
- [ ] List every frontend callsite still using old v1 node, Logic Gate, projection, Kanban, map, and workspace endpoints.
- [ ] Confirm the current migration state for `effective_resource_access`.
- [ ] Add a short audit note to this document with the exact remaining legacy callsites.

### Phase 1 - Make Effective Access Transactional

- [ ] Introduce a transaction-safe effective access writer API.
- [ ] Add a helper like `ReplaceEffectiveFactsForSource(tx, companyID, sourceType, sourceID, facts)`.
- [ ] Use source-scoped replacement instead of full-company delete/rebuild during normal mutations.
- [ ] Update direct user/group grants to write effective facts in the same transaction.
- [ ] Update group membership changes to recalculate affected group-derived facts.
- [ ] Update node assignee changes to write/remove node edit facts.
- [ ] Update Logic Gate RACI changes to write/remove Logic Gate edit facts.
- [ ] Update shared triage RACI changes to write/remove shared triage edit facts.
- [ ] Update Logic Gate node assignment changes to write/remove contextual node view facts.
- [ ] Update shared triage folder hierarchy changes to recalculate descendant inherited facts.
- [ ] Keep full-company rebuild as a repair path only.
- [ ] Add tests proving access revocation is visible immediately after transaction commit.

### Phase 2 - Replace Runtime Authorization

- [ ] Create one backend authorization helper for effective access checks.
- [ ] Replace `requireEntityView` hot-path behavior with effective access.
- [ ] Replace `requireEntityEdit` hot-path behavior with effective access.
- [ ] Replace `requireEntityAdmin` hot-path behavior with effective access.
- [ ] Keep 404-vs-403 behavior consistent: invisible resources return not found, visible-but-insufficient resources return forbidden.
- [ ] Remove admin bypasses that depend on separate handler logic, or represent them through company-level effective access facts.
- [ ] Add tests that panic or fail if v2 handlers call `UserCanAccessEntity`.
- [ ] Add tests for `view`, `edit`, `admin`, and no-access outcomes.

### Phase 3 - Finish Visible Query Migration

- [ ] Make node list queries join directly against effective access for normal users.
- [ ] Make Logic Gate list queries join directly against effective access for normal users.
- [ ] Make company explorer node item queries join directly against effective access.
- [ ] Make company explorer Logic Gate item queries join directly against effective access.
- [ ] Make shared triage folder/item queries join directly against effective access.
- [ ] Make workspace snapshots use effective access joins for every protected surface.
- [ ] Delete Go-side bulk filtering from protected list paths once query coverage exists.
- [ ] Add regression tests proving hidden nodes, Logic Gates, and shared triage folders do not leak through list endpoints.

### Phase 4 - Move The Product To Consolidated V2 APIs

- [ ] Treat `/v2/nodes/{id}/view` as the canonical node read endpoint.
- [ ] Treat `/v2/logic-gates/{id}/view` as the canonical Logic Gate read endpoint.
- [ ] Treat `/v2/logic-gates/{id}/work` as the canonical Logic Gate work/Kanban endpoint.
- [ ] Confirm node view includes details, projections, relationships, Logic Gate assignments, and content-change state behind one access check.
- [ ] Confirm Logic Gate view includes details, projections, RACI, relationships, and work behind one access check.
- [ ] Move frontend reads off old v1 detail/projection endpoints.
- [ ] Add telemetry or logs for remaining legacy endpoint use during migration.
- [ ] Decide whether old v1 endpoints become disabled, admin-only repair routes, or thin wrappers over v2.

### Phase 5 - Delete Or Neutralize Legacy Kanban

- [ ] Stop treating Kanban boards as separately protected resources.
- [ ] Make Logic Gate work status the source of truth: pending, in progress, done, plus issue metadata if needed.
- [ ] Replace card mutation authorization with Logic Gate edit access.
- [ ] Replace card reads with Logic Gate work reads.
- [ ] Remove `requireKanbanCardView` from active request paths.
- [ ] Remove board/card visibility filtering from active request paths.
- [ ] Keep compatibility IDs only where needed for data migration or old clients.
- [ ] Add tests proving v2 Logic Gate work does not call Kanban board/card read methods.

### Phase 6 - Disable Map Until Rewrite

- [ ] Remove map data from default/full workspace snapshots, or gate it behind an explicit disabled feature flag.
- [ ] Disable `/v1/map-layout` writes while the map system is out of scope.
- [ ] Disable map entity batch behavior if it triggers protected resource loops.
- [ ] Preserve existing map code and data for later rewrite.
- [ ] Add tests proving disabled map routes do not perform per-entity permission loops.

### Phase 7 - Rebuild Notifications Around Fanout

- [ ] Define notification target extraction from domain events.
- [ ] For resource events, expand recipients from reverse effective access.
- [ ] For RACI-specific notification buckets, use RACI role facts for UI destination and priority.
- [ ] Create notification rows for intended recipients at event-processing time.
- [ ] Keep read-time effective access filtering only as a final safety guard, not as the main routing system.
- [ ] Remove notification logic that checks visibility notification-by-notification through legacy functions.
- [ ] Add tests for revocation before delivery, revocation after delivery, RACI routing, shared triage routing, and actor self-notification rules.

### Phase 8 - Shared Triage Completion

- [ ] Confirm shared triage folders use effective access for list, read, create, update, and delete behavior.
- [ ] Confirm shared triage child folders inherit from parent shared triage access.
- [ ] Confirm shared triage messages/items cannot leak when the folder is invisible.
- [ ] Confirm `view`, `edit`, `admin`, and no-access behavior exists for shared triage.
- [ ] Confirm shared triage RACI grants edit access and routes notifications.

### Phase 9 - Remove Legacy Permission System From Hot Paths

- [ ] Remove direct handler dependency on `EntityPermissionRepository` hot-path reads.
- [ ] Quarantine `UserCanAccessEntity` for migration/repair tests only.
- [ ] Remove or replace the recursive DB permission function from production runtime paths.
- [ ] Remove old Go-side filters after all callers are migrated.
- [ ] Run backend tests.
- [ ] Run full app tests.
- [ ] Add a final audit note to this document with remaining intentional legacy code, if any.

## Files To Inspect First

- `backend/internal/http/entity_permission_handlers.go`
- `backend/internal/store/postgres_effective_access.go`
- `backend/internal/store/repository.go`
- `backend/internal/http/node_handlers.go`
- `backend/internal/http/logic_gate_handlers.go`
- `backend/internal/http/consolidated_view_handlers.go`
- `backend/internal/http/logic_gate_work_handlers.go`
- `backend/internal/http/kanban_handlers.go`
- `backend/internal/http/map_layout_handlers.go`
- `backend/internal/http/workspace_handlers.go`
- `backend/internal/store/postgres_notifications.go`
- `backend/internal/store/postgres_workspace_event_fanout.go`
- `backend/db/schema.sql`
- `backend/db/migrations/20260522_effective_resource_access.sql`
- frontend callsites for `/v1/nodes`, `/v1/logic-gates`, `/v1/kanban`, `/v1/map-layout`, and workspace snapshots

## Implementation Notes

Use source-scoped effective facts.

Each derived effective access row should be traceable to a source:

```text
source_type = logic_gate_raci
source_id   = logic_gate:{logic_gate_id}:role:{role}:user:{user_id}
```

When the source changes, delete and replace facts for that source in the same transaction. This is the simplest way to get correctness without recomputing the company.

For high fanout sources, recalculate only the affected source family:

- group membership change recalculates grants and RACI facts involving that group
- Logic Gate assignment change recalculates contextual node view facts for that Logic Gate/node pair
- shared triage hierarchy change recalculates inherited facts for the affected subtree
- company admin/dev admin changes should use either company-level effective access facts or a bounded company-level source, not repeated handler bypasses

The old full rebuild should remain available as:

```text
repair effective access for company X
```

It should not be called after every normal mutation.

## Risk Register

- Stale effective access is the biggest security risk.
- A missed transactional projector call can cause invisible resources to remain visible or visible resources to disappear.
- Company admin/dev admin modeling can create write amplification if implemented as per-resource rows for every resource.
- Keeping v1 routes active makes it easy for frontend code to bypass the new model accidentally.
- Legacy Kanban compatibility can silently preserve the old bad architecture.
- Read-time notification filtering can hide bad delivery logic until scale makes it painful.

## First Success Criteria

The first useful V4 PR should do all of this:

- Add the baseline audit notes to this document.
- Add tests that prove selected v2 endpoints do not call legacy permission methods.
- Convert at least one remaining active v1 hot path from recursive permission checks to effective access.
- Replace one post-mutation full projection refresh with a transaction-scoped effective fact update.
- Leave a progress update in this tracker.

