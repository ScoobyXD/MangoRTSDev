# Backend Refactor V3

This is the project document for the deep MangoRTS backend refactor. Treat it as the source of truth for the V3 backend rebuild plan and keep it updated as work progresses.

The goal is not to patch the current handlers. The goal is to rebuild the backend around graph-derived access, domain read models, Logic Gate node assignments as the work-board source of truth, materialized notification fanout, and user-scoped workspace delivery.

## Starter Prompt

Give this prompt to the next Codex instance:

```text
Read `docs/important tasks/backend-refactor-v3.md` first. Treat that file as the canonical project document and progress tracker for the MangoRTS backend V3 refactor.

Do not start by making random code changes. First, audit the current backend against the V3 document, update the tracker in that document with what you learn, and propose the first concrete implementation slice.

The V3 direction is:
- permissions become graph-derived effective access, not repeated procedural checks;
- no positive access fact means no access;
- positive access levels are `view`, `edit`, and `admin`;
- RACI is not a permission tier;
- any RACI assignment grants edit access to its resource;
- RACI role only controls UI bucket, notification routing, and prioritization;
- shared triage is a first-class protected resource with view/edit/admin access;
- shared triage emails/items inherit access from their shared triage folder;
- Logic Gate access grants contextual visibility to all nodes assigned to that Logic Gate;
- Kanban is not a backend domain and must become a projection of Logic Gate node assignments;
- notification and workspace delivery should use reverse effective access/fanout instead of per-read recursive permission checks.

Use `docs/important tasks/backend-refactor-v3.md` to keep track of decisions, phase status, work completed, open questions, and next steps. If you implement a slice, update the document in the same branch.
```

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

- [ ] Audit current backend files.
- [ ] Update this document with exact legacy paths to replace.
- [ ] Produce a concrete architecture/design note for graph-derived effective access.
- [ ] Define the first implementation slice.

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

- [ ] Add effective access schema/migration/read model.
- [ ] Add projector/backfill logic from existing grants, groups, memberships, RACI, assignees, shared triage access, and Logic Gate assignments.
- [ ] Add tests for direct grants.
- [ ] Add tests for group grants.
- [ ] Add tests for nested groups.
- [ ] Add tests proving any RACI assignment grants edit access.
- [ ] Add tests for Logic Gate inherited node visibility.
- [ ] Add tests for shared triage folder/item inheritance.
- [ ] Add tests for revoke/reprojection behavior.

### Phase 3: Visible Query Methods

- [ ] Add v2 visible query methods.
- [ ] Replace company-wide list-then-filter paths with SQL visible queries.
- [ ] Keep old endpoints compatible where necessary, but route internals through the new read model.
- [ ] Stop adding new Go-side filtering after loading full company datasets.

### Phase 4: Logic Gate Work Rebuild

- [ ] Add Logic Gate work endpoints using `logic_gate_node_assignments`.
- [ ] Treat old Kanban tables/routes as compatibility only.
- [ ] Stop using Kanban board/card as source of truth.
- [ ] Remove separate Kanban board/card permission checks from the new path.

### Phase 5: Consolidated Views

- [ ] Add consolidated node view endpoint.
- [ ] Add consolidated Logic Gate view endpoint.
- [ ] Ensure frontend can open a node with one backend read.
- [ ] Ensure frontend can open a Logic Gate with one backend read.

### Phase 6: Notifications And Workspace Fanout

- [ ] Rebuild notification recipient materialization around reverse effective access and RACI routing.
- [ ] Remove recursive permission calls from notification list/count/summary hot paths.
- [ ] Rebuild workspace event/snapshot delivery around user-scoped reverse access fanout.

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

## Open Questions

- Should a Logic Gate editor be allowed to edit full node content for nodes assigned to the Logic Gate, or only assignment state/position?
- Should legacy explicit `no_access` rows be migrated into absence of facts, or retained only as a compatibility deny source during the transition?
