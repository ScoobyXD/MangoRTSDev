# V6 Backend Refactor Project Tracker

## Purpose

This document tracks the V6 backend refactor for MangoRTS.

The goal is to stop projection side effects from spreading across unrelated commands as nodes, Logic Gates, Projects, RACIO, Kanban, Company Explorer, and future read surfaces continue to share the same source entities.

V6 is not a backend rewrite. It is a precision refactor around one architecture rule:

```text
Source writes and affected projection writes happen together in the same transaction.
Projection changes are row-level precise.
Projection tables are never broadly rebuilt during normal product writes.
```

## Core Problem

Nodes and Logic Gates exist independently of Projects, but many UI surfaces display derived views of those same entities.

One source mutation can affect many read models:

```text
nodes
logic_gates
node_logic_gate_assignments
resource_permissions
RACIO assignments
project_relationships
```

These source rows can affect:

```text
node_projection_table
logic_gate_projection_table
kanban_board_projection
racio_matrix_projection
project_management_timeline_projection
project_relationship_projection
company explorer read scopes
editor realtime scopes
workspace read-version scopes
```

The risk is that each command manually remembers only the projections it knew about when it was written. Every new surface then increases the chance that a node, Logic Gate, assignment, permission, or relationship mutation forgets to patch one dependent projection.

## Vocabulary

Use these names consistently.

```text
Source table
  A durable table that owns truth, such as nodes, logic_gates, node_logic_gate_assignments, projects, project_relationships, resource_permissions, or RACI assignment tables.

Projection table
  A denormalized read table maintained by transactional writes from source changes.

Projection delta
  A row-level upsert, patch, or delete describing exactly what changed in a projection.

Projection delta dependency
  A code-level rule saying which projection rows depend on a source row change.

Projection delta dependency helper
  A transaction-scoped Go function that applies precise projection side effects for one source-entity dependency class.

Affected projection row
  A projection row identified by exact source keys, such as node_id, logic_gate_id, assignment_id, project_id, relationship_id, user_id, or board_id.
```

Do not use the word "rebuild" for normal product write behavior.

Approved wording:

```text
patch affected projection rows
sync exact projection rows
apply projection delta dependencies
upsert affected projection rows
delete affected projection rows
```

Disallowed wording for normal writes:

```text
rebuild projection table
rebuild project projection
recompute everything
rescan all projects
```

Admin repair scripts or one-time migrations may backfill projection tables, but those are outside normal product writes.

## Core Decision

The dependency list lives in Go code, not in database tables.

The database stores:

```text
source rows
projection rows
event rows
indexes for exact dependency lookups
```

Go code owns:

```text
when a node title changes, which projections are patched
when a Logic Gate header changes, which projections are patched
when a node Logic Gate assignment moves, which projections are patched
when a project relationship changes, which projections are patched
when permissions change, which read scopes and projection rows are affected
```

Do not add a generic database rule engine for this. The dependency behavior needs custom SQL, before/after projection reads, projection-specific delta shaping, event row creation, authorization implications, and focused tests.

## Original Projects Problem Closure

V6 must close all three original Projects backend gaps.

### 1. Project Relationship Projection Staleness

Problem:

```text
project_relationship_projection can become stale when a related node, Logic Gate, or node Logic Gate assignment changes outside the Project command path.
```

Required V6 outcome:

```text
Every source command that can affect Project Summary relationship display must call a projection delta dependency helper that patches exact project_relationship_projection rows before commit.
```

### 2. Missing Precise Project Relationship Deltas

Problem:

```text
Project relationship changes currently rely on workspace invalidation/refetch behavior instead of a precise Project relationship projection delta stream.
```

Required V6 outcome:

```text
project_relationship_projection must emit row-level upsert/delete/patch deltas for Project Summary subscribers.
```

### 3. Create From Project Is Not Atomic

Problem:

```text
Creating a node or Logic Gate from a Project is currently a multi-call composition: create the resource, then associate it with the Project.
```

Required V6 outcome:

```text
Project-scoped create commands must create the node or Logic Gate source row, create the project_relationships source row, patch every affected projection row, append all projection delta event rows, and commit as one transaction.
```

## Target File

Create the central dependency layer here:

```text
backend/internal/store/projection_delta_dependencies.go
```

Use exact names. These functions should be transaction-scoped and should return projection deltas plus any additional event-row inputs required by non-generic projection streams.

Target names:

```go
applyNodeProjectionDeltaDependenciesTx(...)
applyLogicGateProjectionDeltaDependenciesTx(...)
applyNodeLogicGateAssignmentProjectionDeltaDependenciesTx(...)
applyProjectRelationshipProjectionDeltaDependenciesTx(...)
applyProjectProjectionDeltaDependenciesTx(...)
applyResourcePermissionProjectionDeltaDependenciesTx(...)
```

Names for narrower internal functions should include the affected projection:

```go
syncProjectRelationshipProjectionForRelationshipTx(...)
syncProjectRelationshipProjectionForNodeTx(...)
syncProjectRelationshipProjectionForLogicGateTx(...)
syncProjectRelationshipProjectionForNodeLogicGateAssignmentTx(...)
deleteProjectRelationshipProjectionForRelationshipTx(...)
```

## Transaction Pattern

Every source mutation that affects projections should follow this shape:

```text
1. Begin transaction.
2. Read affected projection rows before the source write.
3. Write source table rows.
4. Apply projection delta dependency helpers for the exact changed source keys.
5. Read affected projection rows after the source write.
6. Diff before and after projection rows.
7. Append event rows for the resulting projection deltas.
8. Commit.
```

The command must not publish directly before commit.

The command must not scan or refresh unrelated projection rows.

## Dependency Matrix

This matrix is the source of truth for V6 implementation.

### Node Source Changes

Source examples:

```text
nodes.title
nodes.status
nodes.status_color
nodes.assignee_user_id
nodes.priority
nodes.due_date
node account assignments
node information/editor writes
node deletion
```

Required dependencies:

```text
kanban_board_projection rows for node_id
racio_matrix_projection rows for node_id when RACIO display depends on node state
project_management_timeline_projection rows for node_id
project_relationship_projection rows where node_id or resource_id = node_id
editor projection deltas for node editor information changes only
workspace read-version scopes for node list and company explorer when relevant
```

### Logic Gate Source Changes

Source examples:

```text
logic_gates.header
logic_gates default fields
logic gate RACI assignments
logic gate information/editor writes
logic gate deletion
```

Required dependencies:

```text
kanban_board_projection rows for logic_gate_id when gate context affects display
racio_matrix_projection rows for logic_gate_id
project_management_timeline_projection rows for logic_gate_id
project_relationship_projection rows where logic_gate_id or resource_id = logic_gate_id
editor projection deltas for Logic Gate editor information changes only
workspace read-version scopes for Logic Gate list and company explorer when relevant
```

### Node Logic Gate Assignment Source Changes

Source examples:

```text
node_logic_gate_assignments inserted
node_logic_gate_assignments moved to another logic_gate_id
node_logic_gate_assignments.status_key changed
node_logic_gate_assignments.position changed
node_logic_gate_assignments.is_issue changed
node_logic_gate_assignments deleted
```

Required dependencies:

```text
kanban_board_projection row for node_id and logic_gate_id
racio_matrix_projection rows if assignment context affects RACIO display
project_management_timeline_projection rows if assignment context affects timeline display
project_relationship_projection rows for node_id and assignment_id
workspace read-version scopes for nodes, Logic Gates, and Projects when relevant
```

### Project Source Changes

Source examples:

```text
projects.name
projects.status
projects.account_id
projects.team_id
project deletion
project information/editor writes
```

Required dependencies:

```text
project list snapshot/read-version scopes
company explorer project folder scopes
project_projection_table for project editor information writes
editor projection deltas for project editor information changes
project_relationship_projection project_name or project metadata fields if stored there
```

The project list can continue reading from `projects` plus account/team joins unless derived rollups are added later.

### Project Relationship Source Changes

Source examples:

```text
project_relationships inserted
project_relationships position changed
project_relationships resource changed
project_relationships deleted
```

Required dependencies:

```text
project_relationship_projection row for relationship_id
project relationship projection delta events
project summary read-version scope
related node or Logic Gate relationship panels if they show associated Projects
```

### Resource Permission Source Changes

Source examples:

```text
resource_permissions changed
resource_access_grants changed
entity_access_permissions changed
```

Required dependencies:

```text
workspace read-version scopes for affected entity type
company explorer folder item visibility scopes
projection stream permission revoke/refetch messages when active subscribers lose access
project_relationship_projection visibility should be filtered by project access and target entity access
```

## Project Relationship Projection Design

Keep `project_relationship_projection` as the row-level read model for Project Summary relationship display.

It does not mean Projects own nodes or Logic Gates. It means the Project Summary UI has a stable projected row to patch and diff.

Target columns:

```text
company_id
project_id
project_name
relationship_id
resource_type
resource_id
logic_gate_id
node_id
assignment_id
display_title
status
status_color
position
resource_created_timestamp
relationship_created_timestamp
relationship_updated_timestamp
projection_updated_timestamp
```

Required indexes:

```text
(company_id, project_id, position, lower(display_title), relationship_id)
(company_id, relationship_id)
(company_id, resource_type, resource_id)
(company_id, node_id)
(company_id, logic_gate_id)
(company_id, assignment_id)
```

The `assignment_id` should come from `node_logic_gate_assignments` for node-associated rows. If the source relationship is directly to a Logic Gate, `assignment_id` is null.

## Projection Delta Event Contract

V6 should add a project relationship projection delta lane, or extend the existing projection delta event shape with a dedicated projection name.

Target projection name:

```text
project_relationship
```

Target scope examples:

```text
project:{project_id}
resource:node:{node_id}
resource:logic_gate:{logic_gate_id}
```

Minimum message payload:

```json
{
  "type": "projection_delta",
  "projection": "project_relationship",
  "scope": "project:{project_id}",
  "company_id": "{company_id}",
  "projection_sequence": 123,
  "deltas": [
    {
      "operation": "upsert",
      "row_key": {
        "project_id": "{project_id}",
        "relationship_id": "{relationship_id}"
      },
      "row": {}
    }
  ]
}
```

The same committed source write may emit multiple projection delta event rows when it affects multiple projection lanes.

Example:

```text
Move node between Logic Gates
  -> kanban_board projection delta
  -> project_relationship projection delta
  -> project_management_timeline projection delta if affected
```

## Project-Scoped Create Commands

V6 must add atomic backend commands for creating resources from a Project context.

These commands are not frontend compositions. They are store-layer commands with one transaction.

Target command names:

```go
CreateNodeAssociatedWithProject(...)
CreateLogicGateAssociatedWithProject(...)
```

If implementation needs shared internals, use transaction-scoped internal functions with exact names:

```go
createNodeAssociatedWithProjectTx(...)
createLogicGateAssociatedWithProjectTx(...)
```

Required behavior for `CreateNodeAssociatedWithProject`:

```text
1. Begin transaction.
2. Create the node source row.
3. Create optional node information/projection rows if the request includes initial editor content.
4. Optionally create node_logic_gate_assignments if the request includes an initial Logic Gate context.
5. Create project_relationships for the new node.
6. Apply node projection delta dependencies for the new node.
7. Apply node Logic Gate assignment projection delta dependencies if an assignment was created.
8. Apply project relationship projection delta dependencies for the new project relationship.
9. Append every projection delta event row.
10. Commit.
```

Required behavior for `CreateLogicGateAssociatedWithProject`:

```text
1. Begin transaction.
2. Create the Logic Gate source row.
3. Create optional Logic Gate information/projection rows if the request includes initial editor content.
4. Create project_relationships for the new Logic Gate.
5. Apply Logic Gate projection delta dependencies for the new Logic Gate.
6. Apply project relationship projection delta dependencies for the new project relationship.
7. Append every projection delta event row.
8. Commit.
```

Required API behavior:

```text
The HTTP/API layer may expose these as project subresource routes or existing batch command routes, but the store layer must provide atomic commands. The frontend must not be required to make multiple writes to get a consistent Project-created resource.
```

Suggested route shape if no better existing command surface exists:

```text
POST /v1/projects/{project_id}/nodes
POST /v1/projects/{project_id}/logic-gates
```

## Phase Count

V6 has two phases. Do not split this into more phases unless a blocker proves the scope cannot fit.

## Phase 1 - Create Projection Delta Dependency Layer

Goal:

Build the central dependency layer and make Project relationship projection a first-class precise projection.

Tasks:

- [x] Add `backend/internal/store/projection_delta_dependencies.go`.
- [x] Define typed inputs for node, Logic Gate, node Logic Gate assignment, project, project relationship, and permission dependency helpers.
- [x] Add `assignment_id` to `project_relationship_projection`.
- [x] Add exact lookup indexes for project relationship projection dependency keys.
- [x] Implement `syncProjectRelationshipProjectionForRelationshipTx`.
- [x] Implement `syncProjectRelationshipProjectionForNodeTx`.
- [x] Implement `syncProjectRelationshipProjectionForLogicGateTx`.
- [x] Implement `syncProjectRelationshipProjectionForNodeLogicGateAssignmentTx`.
- [x] Implement `deleteProjectRelationshipProjectionForRelationshipTx`.
- [x] Add project relationship projection delta row types.
- [x] Add project relationship projection delta event payload encoding/decoding.
- [x] Add event worker support for project relationship projection delta delivery.
- [x] Wire project relationship create/update/delete commands through `applyProjectRelationshipProjectionDeltaDependenciesTx`.
- [ ] Wire project editor information writes through `applyProjectProjectionDeltaDependenciesTx` if any duplicated event logic remains.
- [x] Add focused tests proving project relationship projection rows are patched by exact relationship/node/Logic Gate/assignment keys.
- [x] Add tests proving no normal product write does a broad project relationship projection rebuild.

Success criteria:

- Creating a project relationship writes `project_relationships`, writes exactly one affected `project_relationship_projection` row, appends a delta, and commits atomically.
- Deleting a project relationship deletes exactly one affected projection row and emits a delete delta.
- A node-associated project relationship stores the current `assignment_id` when the node has a Logic Gate assignment.
- A node-associated project relationship updates its `assignment_id`, `logic_gate_id`, status, color, and grouping fields when that node assignment changes.
- A Logic Gate-associated project relationship updates display fields when that Logic Gate changes.
- Tests can identify the precise projection row keys touched by each dependency helper.

## Phase 2 - Migrate Existing Source Mutations Into Dependency Helpers

Goal:

Remove scattered projection side-effect knowledge from source mutation commands and route it through the V6 projection delta dependency layer.

Tasks:

- [x] Update node create/update/delete paths to call `applyNodeProjectionDeltaDependenciesTx`.
- [x] Update node information/editor paths only where editor projection event logic is duplicated or inconsistent.
- [x] Update Logic Gate create/update/delete paths to call `applyLogicGateProjectionDeltaDependenciesTx`.
- [x] Update Logic Gate information/editor paths only where editor projection event logic is duplicated or inconsistent.
- [x] Update assign/move/remove/toggle node Logic Gate assignment paths to call `applyNodeLogicGateAssignmentProjectionDeltaDependenciesTx`.
- [x] Update node account assignment paths to call the node dependency helper instead of hand-assembling every affected projection.
- [x] Update RACIO assignment paths to call the Logic Gate dependency helper where source changes affect shared read surfaces.
- [x] Update permission mutation paths to call `applyResourcePermissionProjectionDeltaDependenciesTx`.
- [x] Add `CreateNodeAssociatedWithProject` as an atomic store command.
- [x] Add `CreateLogicGateAssociatedWithProject` as an atomic store command.
- [x] Add HTTP/API routes or command endpoints for project-scoped node and Logic Gate creation.
- [x] Ensure project-scoped create commands append all node, Logic Gate, assignment, editor, project relationship, workspace, and projection delta event rows before commit.
- [x] Keep existing Kanban, RACIO, editor, and project management delta event contracts stable unless the dependency helper requires an additive event shape.
- [x] Delete or privatize old ad hoc projection sync callsites once their behavior is covered by dependency helpers.
- [x] Add guard tests for representative commands showing source write, projection writes, and event rows happen in one transaction.
- [x] Add rollback tests proving failed projection dependency application rolls back the source write.
- [x] Add regression tests for node rename, Logic Gate rename, assignment move, project relationship add/delete, project-scoped create, and permission revoke.

Success criteria:

- Existing product commands still write source and projection rows in one transaction.
- Projection delta event rows are emitted from one dependency path per source mutation class.
- No active command hand-rolls project relationship projection updates outside the dependency layer.
- No active command performs broad projection table rebuilds during normal product writes.
- Existing Kanban/RACIO/Project Management/editor realtime behavior remains compatible.
- Project Summary receives precise relationship projection deltas when associated nodes, Logic Gates, or assignments change.
- Creating a node or Logic Gate from a Project is atomic and never leaves a created resource without its project relationship or projected Project Summary row.

## Non-Goals

- Do not rewrite all backend endpoints.
- Do not move projection dependency rules into database tables.
- Do not make Projects own nodes or Logic Gates.
- Do not replace source tables with projection tables.
- Do not add broad table rebuilds to normal product writes.
- Do not redesign frontend Project Summary UI in this backend refactor.
- Do not replace the event table/event worker architecture.

## Implementation Notes For Future Agents

Before editing, inspect these current files:

```text
backend/internal/store/postgres_kanban.go
backend/internal/store/postgres_kanban_projection.go
backend/internal/store/postgres_nodes.go
backend/internal/store/postgres_logic_gates.go
backend/internal/store/postgres_project_management.go
backend/internal/store/postgres_projects.go
backend/internal/store/event_rows.go
backend/internal/http/event_worker.go
backend/internal/http/projection_deltas.go
backend/internal/store/workspace_read_versions.go
backend/db/schema.sql
backend/db/migrations/20260610_projects.sql
```

The current best example of the desired pattern is the node Logic Gate assignment flow:

```text
source write to node_logic_gate_assignments
precise projection write to kanban_board_projection
before/after projection diff
projection delta event rows appended before commit
```

V6 generalizes that pattern. It does not replace it with a rebuild.

## Definition Of Done

V6 is complete when:

- `projection_delta_dependencies.go` is the central implementation point for source-to-projection dependency rules.
- Project relationship projection has `assignment_id` and exact dependency-key indexes.
- Project relationship projection emits precise deltas.
- Node, Logic Gate, node Logic Gate assignment, project relationship, and permission mutations route projection side effects through dependency helpers.
- Project-scoped node and Logic Gate create commands are atomic store commands.
- Tests prove source writes and projection writes commit or roll back together.
- Tests prove normal product writes do not rebuild projection tables.
- This document has a final journal entry with completed files, remaining exceptions, and any intentionally deferred dependency classes.

## Project Journal

### 2026-06-10 - Tracker Created

Created V6 as a two-phase backend refactor focused on projection delta dependencies. The core direction is to keep dependency rules in Go code, keep projection tables as precise read models, and make Projects another transactional dependent projection rather than a new owner of nodes or Logic Gates.

### 2026-06-10 - Phase 1 Projection Delta Dependency Layer

Implemented the Phase 1 project relationship projection dependency layer. Added `projection_delta_dependencies.go`, exact project relationship projection sync/delete helpers, `assignment_id` projection support, dependency-key indexes, project relationship projection delta row/event encoding, and event worker delivery for the `project_relationship` lane.

Project relationship create/update/delete now route through `applyProjectRelationshipProjectionDeltaDependenciesTx` and append durable project relationship projection delta event rows in the same transaction as the source write. Focused tests cover exact row keys, assignment IDs, delete deltas, schema indexes, dependency helper names, and no broad project relationship projection maintenance.

The conditional project editor information wiring remains unchanged in this pass; existing project editor event writes are still direct editor projection events and were not part of the requested project relationship projection Phase 1 scope.

### 2026-06-10 - Phase 2 Source Mutation Migration

Migrated node, Logic Gate, node Logic Gate assignment, node account assignment, RACIO assignment, permission, and delete paths onto the projection dependency helpers. The dependency layer now owns Kanban, RACIO, Project Management, and Project relationship projection fanout for those source mutation classes and returns mixed projection deltas for durable event row writes in the same transaction.

Added atomic `CreateNodeAssociatedWithProject` and `CreateLogicGateAssociatedWithProject` store commands plus `POST /v1/projects/{project_id}/nodes` and `POST /v1/projects/{project_id}/logic-gates`. The node command supports optional initial editor information and optional initial Logic Gate assignment context; the Logic Gate command supports optional initial editor information. Both commands create source rows, project relationship rows, affected projections, projection delta event rows, and workspace domain events before commit.

Added Phase 2 guard, rollback, and regression tests covering migrated command wiring, project-scoped create commit/rollback behavior, project relationship add/delete deltas, optional initial assignment relationship keys, and no broad project relationship projection rebuilds in normal product writes.
