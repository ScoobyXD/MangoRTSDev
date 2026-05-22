# Backend Refactor V3

This is the project document for the deep MangoRTS backend refactor. Treat it as the source of truth for the V3 backend rebuild plan and keep it updated as work progresses.

The goal is not to patch the current handlers. The goal is to rebuild the backend around graph-derived access, domain read models, Logic Gate node assignments as the work-board source of truth, materialized notification fanout, and user-scoped workspace delivery.

## Core Decisions

### Access Model

The fundamental permission model is:

- no access: no positive effective access fact exists for this actor/resource/action
- view
- edit
- admin

V3 should prefer absence of an effective access fact for "no access." Do not build V3 around explicit deny rows unless a concrete product requirement appears. Existing legacy `no_access` values may need compatibility handling during migration, but the V3 hot path should be positive-access based.

Authorization answers one question:

```text
Does actor U have at least access level X on resource R?
```

### RACI

RACI is not a permission tier.

RACI is a domain/UI/notification routing relationship:

- Responsible
- Accountable
- Consulted
- Informed

Any RACI assignment on a resource grants edit access to that resource through the effective-access projection.

The specific R/A/C/I role controls:

- where the item appears in the UI
- whether it goes to R or ACI surfaces
- notification routing
- notification grouping/priority
- labels and filters

The core backend permission layer should not ask "is this user Responsible?" It should ask "does this user have edit access?"

### Shared Triage

Shared triage is a first-class protected resource.

Resource type:

```text
shared_triage_folder
```

Access levels:

- no access: cannot see that shared triage inbox exists
- view: can see the shared triage folder and emails/items inside it
- edit: can triage, assign, convert, move, and update shared inbox state
- admin: can manage access, RACI, settings, and deletion

Shared triage emails/items inherit access from the shared triage folder. Do not add per-email recursive permission checks.

Shared triage RACI follows the same rule as Logic Gate RACI:

```text
any shared triage RACI assignment -> edit access to that shared_triage_folder
specific R/A/C/I role -> UI and notification routing
```

### Logic Gate Node Visibility

If a user can view a Logic Gate, they can view all nodes assigned to that Logic Gate in that Logic Gate context.

This is intentional. Do not preserve behavior where a Logic Gate board shows hidden holes because a user can view the Logic Gate but lacks direct node access.

### Kanban

Kanban board/card/column must stop being a backend source of truth.

Canonical source:

```text
logic_gate_node_assignments
```

Shape:

- company_id
- logic_gate_id
- node_id
- status_key: pending | in_progress | done
- position
- is_issue
- created_by
- updated_by
- created_at
- updated_at

A Logic Gate's "Kanban board" is only a UI projection of these assignments.

## Target Architecture

### Relationship Edges

Model these as explicit authorization/domain relationship edges:

- user belongs to company
- user belongs to group
- group inherits from group
- user/group has direct grant on node
- user/group has direct grant on Logic Gate
- user/group has direct grant on shared triage folder
- user/group has RACI role on Logic Gate
- user/group has RACI role on shared triage folder
- node is assigned to Logic Gate
- node is assigned to user

### Effective Access Projection

Create or evolve an `effective_resource_access` read model:

- company_id
- user_id
- resource_type: node | logic_gate | shared_triage_folder
- resource_id
- access_level: view | edit | admin
- source_type
- source_id
- created_at / updated_at

It must support both traversal directions:

Forward:

```text
user_id -> resources they can access
```

Reverse:

```text
resource -> users who can access it
```

This can be one table with both indexes:

- `(company_id, user_id, resource_type, resource_id)`
- `(company_id, resource_type, resource_id, user_id)`

Access facts need provenance. If a user can view node N because of Logic Gate LG, store that source. If the user later loses LG access, remove only facts sourced from LG, not direct node access.

## Required Replacements

### Hot Path Permission Checks

Do not keep using recursive permission functions during every list/read. They may exist temporarily for migration/backfill, but normal reads should join against `effective_resource_access`.

Bad:

```text
ListNodes(companyID) -> filterVisibleNodes(...)
```

Good:

```text
ListVisibleNodes(companyID, actorUserID)
```

Apply this to:

- nodes
- Logic Gates
- shared triage folders/items
- company explorer items
- work item inbox reads
- Logic Gate work views
- notification recipient selection
- workspace event fanout

### Logic Gate Work Endpoints

Build new v2 endpoints around Logic Gate node assignments:

- `GET /v2/logic-gates/{id}/work`
- `POST /v2/logic-gates/{id}/nodes`
- `PUT /v2/logic-gates/{id}/nodes/{node_id}/state`
- `DELETE /v2/logic-gates/{id}/nodes/{node_id}`

Authorization:

- view Logic Gate -> view work board and assigned nodes
- edit Logic Gate -> add/move/remove assigned nodes
- admin Logic Gate -> destructive/admin operations

Do not require separate Kanban board/card permissions.

### Consolidated Read Models

Opening a node or Logic Gate should not trigger multiple authorization paths.

Create consolidated read endpoints:

- `GET /v2/nodes/{id}/view`
  Returns node details, projection/editor data, change state, assignment metadata, and permissions needed by UI.

- `GET /v2/logic-gates/{id}/view`
  Returns Logic Gate details, projection/editor data, RACI, assignments/work board summary, and permissions needed by UI.

Each endpoint checks effective access once at the top and then loads associated data through trusted domain read models.

### Notifications

Notifications should be materialized by event fanout.

Flow:

```text
domain event happens
-> notification projector determines recipients using reverse effective access / RACI routing facts
-> insert notification rows for recipients
-> user notification reads query only notifications where recipient_user_id = actor
```

Do not call recursive permission checks inside notification list/count/summary queries.

If permissions change:

- expire/delete affected notifications via permission-change projector, or
- use a cheap join against `effective_resource_access`

Do not re-run recursive visibility logic per notification row.

### Workspace Events

Workspace streams/snapshots should become user-scoped.

Bad:

```text
broadcast company event to everyone, then clients/handlers filter
```

Good:

```text
resource changed
-> find affected users through reverse effective access
-> update user-scoped workspace read version
-> push event only to authorized users
```

### Map

Temporarily remove map from active product behavior.

Do not drop tables yet. But:

- disable map routes or return empty/disabled responses
- remove map data from active/default workspace snapshots
- prevent map code from influencing the new v2 architecture

## Implementation Phases

### Phase 1: Audit And Design

- [x] Audit current backend files.
- [x] Update this document with exact legacy paths to replace.
- [x] Produce a concrete architecture/design note for graph-derived effective access.
- [x] Define the first implementation slice.

Files to inspect first:

- `backend/internal/http/entity_permission_handlers.go`
- `backend/internal/store/postgres_entity_permissions.go`
- `backend/db/schema.sql`
- `backend/internal/http/node_handlers.go`
- `backend/internal/http/logic_gate_handlers.go`
- `backend/internal/http/kanban_handlers.go`
- `backend/internal/http/logic_gate_arena_handlers.go`
- `backend/internal/http/workspace_handlers.go`
- `backend/internal/notifications/service.go`
- `backend/internal/store/postgres_notifications.go`
- `backend/internal/store/postgres_node_logic_gate_assignments.go`
- `backend/internal/store/postgres_kanban.go`
- shared triage / communications handlers and stores

### Phase 2: Effective Access Foundation

- [x] Add effective access schema/migration/read model.
- [x] Add projector/backfill logic from existing grants, groups, memberships, RACI, assignees, shared triage access, and Logic Gate assignments.
- [x] Add tests for direct grants.
- [x] Add tests for group grants.
- [x] Add tests for nested groups.
- [x] Add tests proving any RACI assignment grants edit access.
- [x] Add tests for Logic Gate inherited node visibility.
- [x] Add tests for shared triage folder/item inheritance.
- [x] Add tests for revoke/reprojection behavior.

First concrete slice:

1. Add `effective_resource_access` as a separate read model, not a rename of `resource_access_grants`.
2. Add store methods for:
   - `UserHasEffectiveAccess(company_id, user_id, resource_type, resource_id, access_level)`
   - `ListEffectiveResourceIDsForUser(company_id, user_id, resource_type, access_level, resource_ids)`
   - `ListEffectiveUsersForResource(company_id, resource_type, resource_id, access_level)`
3. Add a deterministic full-company backfill/projector that derives positive `view`/`edit`/`admin` facts from current grants, group membership/inheritance, company admins, node assignees, Logic Gate RACI, shared triage RACI, and Logic Gate node assignments.
4. Keep legacy `resource_access_grants` as the editable grant source for now. Treat `no_access` as a migration compatibility input only; do not write `no_access` to the new read model.
5. Add tests for direct user grants, direct group grants, nested group inheritance, RACI-to-edit, shared-triage folder inheritance, Logic Gate assigned-node contextual visibility, and source-specific revoke/reprojection.

This slice should not replace HTTP handlers yet except through a narrow compatibility path if needed for testability. The goal is to land the read model and prove that it can answer both forward and reverse access questions before moving hot-path reads.

### Phase 3: Visible Query Methods

- [x] Add v2 visible query methods for nodes and Logic Gates.
- [x] Add v2 visible query methods for shared triage folders, company explorer reads, and work item reads.
- [x] Replace company-wide list-then-filter paths with SQL visible queries.
- [x] Keep old endpoints compatible where necessary, but route internals through the new read model.
- [x] Stop adding new Go-side filtering after loading full company datasets.

### Phase 4: Logic Gate Work Rebuild

- [x] Add Logic Gate work endpoints using `logic_gate_node_assignments`.
- [x] Treat old Kanban tables/routes as compatibility only.
- [x] Stop using Kanban board/card as source of truth.
- [x] Remove separate Kanban board/card permission checks from the new path.

### Phase 5: Consolidated Views

- [x] Add consolidated node view endpoint.
- [x] Add consolidated Logic Gate view endpoint.
- [x] Ensure frontend can open a node with one backend read.
- [x] Ensure frontend can open a Logic Gate with one backend read.

### Phase 6: Notifications And Workspace Fanout

- [ ] Rebuild notification recipient materialization around reverse effective access and RACI routing.
- [ ] Remove recursive permission calls from notification list/count/summary hot paths.
- [ ] Rebuild workspace event/snapshot delivery around user-scoped reverse access fanout.

## Current Backend Audit

Audit date: 2026-05-22.

### Existing Access Implementation

- `backend/db/schema.sql` already has `resource_access_grants` for `node`, `logic_gate`, and `shared_triage_folder`, with `user` and `group` principals and legacy access levels including `no_access`.
- `backend/db/schema.sql` has `mangorts_user_can_access_resource(...)`, which computes access recursively at read time from grants, group descendants, shared-triage folder ancestry, and company-admin roles. This is not the V3 effective-access projection.
- `backend/internal/store/postgres_entity_permissions.go` exposes the same model through `UserCanAccessEntity` and `ListAccessibleEntityIDs`. `ListAccessibleEntityIDs` still runs recursive SQL per request over the requested resource set.
- `backend/internal/store/repository.go` names the legacy API as `EntityPermissionRepository`; V3 needs a new effective-access repository surface rather than overloading this interface.
- `backend/internal/store/memory_entity_permissions.go` mirrors the legacy grant behavior for tests and will need an in-memory effective-access projection for unit coverage.
- `backend/db/migrations/20260521_resource_access_grants.sql`, `20260521_zzzz_resource_access_no_access.sql`, `20260521_zzzzz_assignment_edit_access.sql`, `20260521_zzz_admin_role_default_resource_access.sql`, `20260521_zz_shared_triage_default_edit_access.sql`, and `20260521_z_node_logic_gate_default_full_access.sql` are migration history for the current grant/procedural model. Treat these as legacy inputs, not the final V3 access architecture.

### Legacy Hot Paths To Replace

- `backend/internal/http/entity_permission_handlers.go`
  - `requireEntityAccess`, `requireEntityView`, `requireEntityEdit`, and `requireEntityAdmin` call `UserCanAccessEntity`.
  - `visibleEntityIDSet` calls `ListAccessibleEntityIDs`.
  - `filterVisibleNodes`, `filterVisibleLogicGates`, `filterVisibleWorkItemLogicGates`, `filterVisibleNodeMapPositions`, `filterVisibleLogicGateMapPositions`, `filterVisibleCompanyExplorerFolderItems`, `filterVisibleKanbanBoards`, and `filterVisibleKanbanCards` are list-then-filter helpers.
  - `requireKanbanBoardView` and `requireKanbanCardView` preserve Kanban-specific access checks and should not exist on the new Logic Gate work path.
- `backend/internal/http/node_handlers.go`
  - `handleNodes` loads `ListNodes(companyID)` and then calls `filterVisibleNodes`.
  - node details/projections/content-change handlers check entity access separately at entry.
  - V3 replacement target: `GET /v2/nodes/{id}/view` plus visible SQL list methods.
- `backend/internal/http/logic_gate_handlers.go`
  - list/search loads Logic Gates and then calls `filterVisibleLogicGates`.
  - detail/projection/RACI handlers check access separately at entry.
  - V3 replacement target: `GET /v2/logic-gates/{id}/view` plus visible SQL list methods.
- `backend/internal/http/kanban_handlers.go`
  - board/card reads use `ListKanbanBoards`, `ListKanbanColumns`, and `ListKanbanCards` plus Kanban-specific visibility filters.
  - card mutations require both board visibility and direct node visibility.
  - V3 replacement target: Logic Gate work endpoints backed by `logic_gate_node_assignments`; Kanban routes remain compatibility only.
- `backend/internal/http/logic_gate_arena_handlers.go`
  - `handleLogicGateArena` checks Logic Gate view, then loads the compatibility Kanban board/columns/cards.
  - This is the closest current endpoint shape to `GET /v2/logic-gates/{id}/work`, but it still uses Kanban as the read source.
- `backend/internal/http/workspace_handlers.go`
  - full snapshots load company-wide nodes and Logic Gates and then filter in Go.
  - scoped snapshots still include map and Kanban scopes.
  - V3 replacement target: user-scoped workspace snapshots and fanout keyed by reverse effective access.
- `backend/internal/http/company_explorer_handlers.go`
  - explorer reads rely on folder/item loads plus visible entity filtering.
  - V3 replacement target: SQL-backed visible explorer reads joined to effective access.
- `backend/internal/http/work_item_read_handlers.go`
  - work inbox reads are closer to a projection, but final visibility still depends on the legacy filtering helpers.
- `backend/internal/http/communications_shared_inbox_handlers.go`
  - shared inbox CRUD/access/RACI uses `UserCanAccessEntity` for `shared_triage_folder`.
  - `sharedInboxRaciAssignmentsToAccessPermissions` converts any shared inbox RACI assignment to edit access, matching the V3 rule, but stores it as legacy grants.
- `backend/internal/http/communications_triage_handlers.go`
  - personal triage remains user-owned.
  - conversion/revert paths still emit Kanban/card workspace events, so shared triage and Logic Gate work need to be separated from Kanban compatibility.
- `backend/internal/notifications/service.go`
  - event processing materializes notification rows, which is directionally right.
  - recipient selection is still driven mostly by RACI lists, node assignees, and explicit payload recipients.
  - `recipientCanSeeNotification` calls `UserCanAccessEntity` for each recipient/target before insert. V3 should replace this with reverse effective-access recipient queries and permission-change cleanup.
- `backend/internal/store/postgres_notifications.go`
  - notification list/count/summary reads are already recipient-indexed and do not appear to run recursive permission checks in the read hot path.
  - The weak point is projector-time recipient authorization in `backend/internal/notifications/service.go`.
- `backend/internal/store/postgres_node_logic_gate_assignments.go`
  - `logic_gate_node_assignments` exists with the V3 shape and supports assignment reads/writes.
  - This is the correct canonical source for Logic Gate work, but much of the HTTP surface still reads/writes compatibility Kanban rows.
- `backend/internal/store/postgres_kanban.go`
  - Logic Gate assignment methods exist, but they still maintain/read `kanban_boards`, `kanban_columns`, and `kanban_cards` compatibility rows.
  - `AssignNodeToLogicGateStatus`, `MoveLogicGateNodeAssignment`, `RemoveLogicGateNodeAssignment`, and `SetLogicGateNodeAssignmentIssue` are useful transitional methods, but the v2 work read path should read assignments directly.
- `backend/internal/store/workspace_read_versions.go`, `backend/internal/store/postgres_workspace_event_fanout.go`, and `backend/internal/http/workspace_fanout.go`
  - workspace fanout is company-scoped today. The hub buckets by company ID, and read versions include broad workspace/map/Kanban keys.
  - V3 needs user/resource-scoped read versions and recipient fanout based on reverse effective access.

### Design Notes For Effective Access

- `resource_access_grants` remains the editable grant input table during migration.
- `effective_resource_access` is the queryable authorization read model. It should contain only positive facts: `view`, `edit`, or `admin`.
- Proposed columns:
  - `company_id`
  - `user_id`
  - `resource_type`
  - `resource_id`
  - `access_level`
  - `source_type`
  - `source_id`
  - `created_timestamp`
  - `updated_timestamp`
- Required indexes:
  - `(company_id, user_id, resource_type, resource_id)`
  - `(company_id, resource_type, resource_id, user_id)`
  - optional source cleanup index `(company_id, source_type, source_id)`
- Source provenance must be specific enough for targeted cleanup:
  - `direct_user_grant:<resource>`
  - `direct_group_grant:<grant/resource>`
  - `group_membership:<group>`
  - `group_inheritance:<ancestor_group>`
  - `company_admin:<membership>`
  - `node_assignee:<node>`
  - `logic_gate_raci:<assignment>`
  - `shared_triage_raci:<assignment>`
  - `logic_gate_assignment_visibility:<logic_gate_id/node_id>`
- If multiple sources grant access to the same user/resource, either store multiple rows by source and compute max rank in queries, or store one max row plus a second provenance table. Prefer multiple source rows at first because it makes revoke/reprojection safer and easier to test.
- `no_access` should suppress legacy grant-derived facts only where compatibility requires it. The hot path must treat missing positive facts as no access.
- Logic Gate access must project node visibility facts for every node assigned to the Logic Gate. These facts should be source-scoped to the Logic Gate assignment/access source so removing Logic Gate access does not remove direct node grants.
- Shared triage item/email reads should never project per-email permissions. They should check or join the parent `shared_triage_folder` effective access.
- RACI projectors should emit edit access, independent of role. The RACI role itself remains a domain fact for UI buckets and notification routing.
- Notification projectors should ask "who has effective access to this resource?" and then apply RACI routing metadata, not loop through candidate recipients and call recursive visibility checks.
- Workspace fanout should be rebuilt after the read model exists; doing it first would only reproduce the current company-scoped filtering problem with new names.
## Hard Constraints

- Do not drop production data.
- Do not remove legacy endpoints until replacement paths exist.
- Do not add more per-request permission recursion.
- Do not preserve Kanban as a first-class domain.
- Do not keep Go-side filtering after loading full company datasets.
- Do not treat RACI as a fourth permission tier.
- Do not add per-email permissions for shared triage items.
- Tests must cover access correctness and query behavior.
- Prefer clear v2 architecture over patching the existing handlers.

## Progress Log

Use this section to record completed slices and important decisions.

- 2026-05-22: Created V3 project document. Decisions captured: no positive access fact means no access; positive levels are view/edit/admin; RACI grants edit but is otherwise UI/notification routing; shared triage is a protected resource; shared triage items inherit folder access; Logic Gate access grants contextual assigned-node visibility; Kanban is a projection, not a backend domain.
- 2026-05-22: Completed initial Phase 1 audit. Current backend uses `resource_access_grants` plus recursive `mangorts_user_can_access_resource`/`ListAccessibleEntityIDs` and Go-side list-then-filter helpers; exact legacy replacement paths, effective-access design notes, and the first implementation slice are now recorded above.
- 2026-05-22: Completed the first Phase 2 implementation slice. Added `effective_resource_access` as a separate positive-access read model with forward, reverse, and source cleanup indexes. Added `EffectiveAccessRepository` methods for point checks, user-to-resource listing, resource-to-user listing, and deterministic full-company rebuilds. Implemented memory and Postgres rebuild projectors from legacy grants, group descendants, company/dev admins, node assignees, Logic Gate RACI, shared triage RACI including group assignments, shared-triage folder descendants, and Logic Gate assigned-node contextual visibility.
- 2026-05-22: Phase 2 access projection decisions: `no_access` is consumed only as a legacy grant compatibility input and is never written to `effective_resource_access`; legacy grant projection applies the existing nearest-resource / direct-user-before-group precedence before emitting positive facts. Logic Gate assigned-node projection grants contextual `view` only. RACI still projects `edit` on the RACI resource and is not a permission tier.
- 2026-05-22: Added focused store tests for direct user grants, direct group grants, nested group inheritance, RACI-to-edit, shared-triage folder inheritance, Logic Gate assigned-node contextual visibility, and source-specific revoke/reprojection. Verified with `go test ./internal/store` and full backend `go test ./...`.
- 2026-05-22: Started Phase 3 with focused store-visible methods for nodes and Logic Gates. Added `ListVisibleNodes(companyID, userID)` and `ListVisibleLogicGates(companyID, userID)` to the store interfaces with Postgres implementations that join distinct resources from `effective_resource_access` and require at least `view`; `edit` and `admin` satisfy visibility through the existing access rank function. Added memory implementations against the effective-access read model for unit coverage. No legacy HTTP handlers were broadly replaced in this slice, and no new recursive permission checks or `ListAccessibleEntityIDs` usage were added.
- 2026-05-22: Added tests proving visible node and Logic Gate reads include direct `view`/`edit` effective grants, exclude resources without effective access, and include nodes visible only through Logic Gate assigned-node contextual access. Added source-shape coverage for the Postgres visible SQL to ensure it uses `effective_resource_access` and does not call the recursive legacy permission function. Verified with `go test ./internal/store` and full backend `go test ./...`.
- 2026-05-22: Completed the rest of Phase 3 visible query replacements for the active list/search/folder read hot paths. Added visible store methods for node and Logic Gate folder-subtree reads, Logic Gate search/query reads, shared triage folder reads, company explorer folder-item and summary reads, and work-item inbox reads. Postgres implementations query or join against `effective_resource_access`; memory implementations use the in-memory effective-access facts. No new visible store method calls `ListAccessibleEntityIDs` or `mangorts_user_can_access_resource`.
- 2026-05-22: Routed legacy-compatible HTTP reads through the new visible methods where the request has a non-admin actor: node list, Logic Gate list/search, node/Logic Gate relationship list visibility inputs, company explorer folder/item reads, shared inbox list reads, work-item inbox reads, and workspace snapshot node/Logic Gate/company-explorer payloads. Admin and unauthenticated compatibility branches keep the legacy response shapes.
- 2026-05-22: Phase 3 read-model decision: visible reads now assume `effective_resource_access` is current. Tests that mutate grants/RACI/assignments rebuild the effective-access read model before visible reads. A future slice should replace full rebuild calls with incremental projector/write-side maintenance before relying on these paths under high write volume.
- 2026-05-22: Added focused Phase 3 tests for node and Logic Gate folder/search visibility, direct `view`/`edit`/`admin` satisfying visible reads, Logic Gate assigned-node contextual node visibility, shared triage folder visibility, company explorer folder-item/summary visibility, work-item inbox no-leak behavior, and source-shape checks that the new Postgres visible paths use `effective_resource_access` without the legacy recursive permission function.
- 2026-05-22: Completed Phase 4 v2 Logic Gate work endpoints: `GET /v2/logic-gates/{id}/work`, `POST /v2/logic-gates/{id}/nodes`, `PUT /v2/logic-gates/{id}/nodes/{node_id}/state`, and `DELETE /v2/logic-gates/{id}/nodes/{node_id}`. The v2 work read uses `logic_gate_node_assignments` joined directly to node summaries, returns canonical `pending`/`in_progress`/`done` status buckets, synthesizes board/column/card compatibility fields from assignments, and does not read `kanban_boards`, `kanban_columns`, or `kanban_cards`.
- 2026-05-22: Phase 4 authorization decision: new v2 Logic Gate work handlers check `effective_resource_access` once against the Logic Gate (`view` for reads, `edit` for mutations). They do not require separate node visibility grants for assigned nodes and do not call legacy recursive access helpers or Kanban board/card access checks.
- 2026-05-22: Phase 4 compatibility decision: v2 mutations preserve existing workspace event behavior and legacy clients by using the existing assignment command path, which writes the assignment row and maintains Kanban compatibility rows/events. The v2 read path canonicalizes status keys, treats Kanban rows as a projection only, and remains assignment-backed.
- 2026-05-22: Added Phase 4 tests for v2 work read visibility, edit/admin satisfying view, no-access no-leak behavior, view-only mutation denial, edit add/move/issue/remove mutation behavior, contextual assigned-node visibility without direct node grants, no hidden node leakage, and source-shape guards preventing new v2 paths from using legacy recursive access APIs or Kanban tables as the work read source.
- 2026-05-22: Completed Phase 5 consolidated v2 view endpoints: `GET /v2/nodes/{id}/view` and `GET /v2/logic-gates/{id}/view`. Both endpoints authenticate the actor, require company membership, check root-resource `effective_resource_access` for `view` at the top, and return root permission flags (`can_view`, `can_edit`, `can_admin`) where `edit` and `admin` satisfy `view`.
- 2026-05-22: Phase 5 node view decision: the node view composes targeted detail, projection, assignment, and content-change read models. It returns node summary, information history, editor projections, relationships/counts, `logic_gate_node_assignments` metadata, unseen content changes for the actor, and root effective permission flags. It does not call `ListAccessibleEntityIDs`, `mangorts_user_can_access_resource`, or legacy entity permission checks.
- 2026-05-22: Phase 5 Logic Gate view decision: the Logic Gate view composes targeted detail/projection/RACI reads with the Phase 4 assignment-backed `LogicGateWorkView`. Assigned nodes are returned through the Logic Gate context without separate node grants. The work payload keeps synthesized board/column/card compatibility fields for existing UI contracts, but they are derived from `logic_gate_node_assignments`; the v2 read path does not read Kanban boards, columns, or cards as truth.
- 2026-05-22: Added Phase 5 tests for node and Logic Gate view access levels, no-access no-leak responses, contextual assigned-node visibility, inaccessible Logic Gate assigned-node no-leak behavior, source-shape guards against recursive legacy access paths, and guards against Kanban read methods on the new v2 paths.

## Open Questions

- Should a Logic Gate editor be allowed to edit full node content for nodes assigned to the Logic Gate, or only assignment state/position?
- Should legacy explicit `no_access` rows be migrated into absence of facts, or retained only as a compatibility deny source during the transition?
- Legacy RACI mutation paths still write compatibility rows into `resource_access_grants` for old hot paths. During migration, these rows are treated as editable grant input because they have no provenance; future slices should decide when to stop creating those compatibility grants or add source metadata before relying on source-specific incremental cleanup.
- Should global visible node lists expose existing assignment-derived node read-model fields (`status`, `status_color`, and `logic_gate_ids`) from all Logic Gate assignments, or only from Logic Gate contexts the actor can view? The first Phase 3 slice keeps the legacy node read model shape for compatibility and only scopes the returned node set.
- Should effective-access maintenance become incremental on each grant/RACI/assignment/company-membership write before Phase 4, or remain a full-company rebuild job until the consolidated v2 views land?
- When should the v2 Logic Gate work mutation path stop writing Kanban compatibility card/column payloads and switch workspace event consumers to assignment-native payloads?
- Should consolidated node view assignment metadata include all Logic Gate assignment IDs for a visible node, or should a later actor-scoped variant include only Logic Gates the actor can open outside node context?
- Should the consolidated view endpoints eventually become the only frontend open/read path, with v1 detail/projection endpoints kept strictly for compatibility clients?

## Next Steps

- Begin Phase 6: rebuild notification recipient materialization around reverse effective access and RACI routing.
- Rebuild workspace event/snapshot delivery around user-scoped reverse access fanout.
- Keep old Kanban routes and workspace/map-window compatibility paths as compatibility only; do not promote Kanban back into the V3 domain model or use it as a v2 work read source.
- Add incremental effective-access maintenance or an explicit projector job strategy for writes that change grants, RACI, group membership, node assignees, shared triage hierarchy, or Logic Gate assignments.
- Continue avoiding new recursive permission checks; recursive/group traversal belongs in the projector/backfill path only.
