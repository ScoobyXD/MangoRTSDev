# V2 Node And GVIC Migration

## Objective

Migrate the app from the legacy RACI and node assignee model into the V2 node/GVIC model with no backwards compatibility.

This is a bridge-burning migration:

- No old RACI role strings are accepted after migration.
- No old `raci_*` API fields, route names, type names, events, or UI labels remain.
- No old `Verify` status key remains.
- No old node `title` field remains.
- No old node `assignee_user_id` / Person In Charge behavior remains.
- No old `status_color` column remains on `nodes`.

The migration must preserve existing customer data by transforming it into the new model before deleting old columns, constraints, routes, and code paths.

## Phase Strategy

Execute this as two phases.

Phase 1 builds the new model, migrates the data, switches backend and frontend runtime paths to the new GVIC/node contracts, and proves the app works against the new tables and payloads.

Phase 2 deletes the old RACI/RACIO, Person In Charge, `Verify`, node `title`, and node `status_color` code paths.

Phase 1 may temporarily leave old files, tests, handlers, or helpers in the repo while the new path is being built and verified. It must not add compatibility aliases, compatibility views, compatibility endpoints, or fallback parsing for old role/status/payload names. By the end of Phase 1, normal app runtime should use the new GVIC/node model. By the end of Phase 2, old code is deleted.

## New Vocabulary

### Work Statuses

| Old | New |
| --- | --- |
| `Verify` / `verify` | `Review` / `review` |

The canonical status key is `review`. The display label is `Review`.

Do not keep normalization aliases for `verify`, `verification`, or `v` after the migration. Existing data must be migrated to `review`.

### GVIC Roles

| Old RACI | New GVIC |
| --- | --- |
| `responsible` | `generated` |
| `accountable` | `verified` |
| `consulted` | `consulted` |
| `informed` | `informed` |

The canonical roles are:

- `generated`
- `verified`
- `consulted`
- `informed`

Do not accept `responsible` or `accountable` after the migration. Existing data must be migrated.

### Node Fields

| Old | New |
| --- | --- |
| `nodes.title` | `nodes.name` |
| JSON `title` | JSON `name` |
| UI label `Title` for nodes | UI label `Name` |
| `nodes.assignee_user_id` | node-level GVIC `generated` assignment |
| Person In Charge | GVIC assignments |
| `nodes.status_color` | deleted |

## Data Model

### Source Of Truth: `resource_gvic_assignments`

This table stores configured GVIC assignments. It is the only write target for GVIC assignment mutations.

Suggested schema:

```sql
create table resource_gvic_assignments (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  role text not null,
  principal_type text not null,
  principal_id uuid not null,
  created_timestamp timestamptz not null default now(),
  updated_timestamp timestamptz not null default now(),
  constraint resource_gvic_assignments_resource_type_chk
    check (resource_type in ('node', 'logic_gate', 'project', 'shared_triage_folder')),
  constraint resource_gvic_assignments_role_chk
    check (role in ('generated', 'verified', 'consulted', 'informed')),
  constraint resource_gvic_assignments_principal_type_chk
    check (principal_type in ('user', 'group')),
  primary key (company_id, resource_type, resource_id, role, principal_type, principal_id)
);
```

No `created_by_user_id` column is needed.

`principal_type='group'` stores the configured group assignment. Do not expand group assignments into user rows in this source table.

### Projection: `resource_gvic_effective_assignments`

This table stores the expanded user-level effective result. It is derived data, maintained transactionally by source-of-truth mutations and group/node relationship mutations.

Suggested schema:

```sql
create table resource_gvic_effective_assignments (
  company_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  role text not null,
  user_id uuid not null,
  source_resource_type text not null,
  source_resource_id uuid not null,
  source_principal_type text not null,
  source_principal_id uuid not null,
  inheritance_type text not null,
  updated_timestamp timestamptz not null default now(),
  constraint resource_gvic_effective_assignments_resource_type_chk
    check (resource_type in ('node', 'logic_gate', 'project', 'shared_triage_folder')),
  constraint resource_gvic_effective_assignments_role_chk
    check (role in ('generated', 'verified', 'consulted', 'informed')),
  constraint resource_gvic_effective_assignments_source_principal_type_chk
    check (source_principal_type in ('user', 'group')),
  constraint resource_gvic_effective_assignments_inheritance_type_chk
    check (inheritance_type in ('direct', 'logic_gate_inherited')),
  primary key (
    company_id,
    resource_type,
    resource_id,
    role,
    user_id,
    source_resource_type,
    source_resource_id,
    source_principal_type,
    source_principal_id,
    inheritance_type
  )
);
```

Reads that need "who currently has GVIC on this thing?" should read this projection table.

Writes must never target this table directly from HTTP handlers. It is only updated by backend sync logic inside the same transaction as source-of-truth changes.

## Node GVIC Inheritance Rules

Nodes have configured GVIC rows in `resource_gvic_assignments`.

Effective node GVIC is determined as follows:

1. Standalone node: effective rows come from the node's configured GVIC.
2. Node linked to a logic gate: effective rows come from the linked logic gate's configured GVIC.
3. Direct node GVIC rows remain stored while the node is linked to a logic gate, but they are inactive and do not produce effective rows.
4. If the node is later unlinked from the logic gate, direct node GVIC rows become effective again.

Because `node_logic_gate_assignments` currently allows one active logic gate per node, the inheritance decision should be single-source. If that rule changes later, this document must be revisited before implementation.

## Group Expansion Rules

Configured group assignments stay as group rows in `resource_gvic_assignments`.

Effective assignment expansion must include:

- direct group members
- members of descendant groups
- users added to descendant groups after the GVIC assignment was created
- users removed from descendant groups after the GVIC assignment was created

Do not mutate `resource_gvic_assignments` when group membership changes. Group membership changes update `resource_gvic_effective_assignments`.

The implementation should use a group closure strategy for precise and efficient expansion:

```sql
company_user_group_closure (
  company_id uuid not null,
  ancestor_group_id uuid not null,
  descendant_group_id uuid not null,
  depth integer not null,
  primary key (company_id, ancestor_group_id, descendant_group_id)
)
```

If this table does not exist, add it. If the existing group model already has equivalent closure support, reuse that instead of adding a duplicate.

## Write Model

POST and PUT handlers write source-of-truth data and maintain exact projection rows in the same transaction.

They do not full rebuild projection tables during normal runtime mutations.

Canonical flow:

```text
begin tx
  determine affected resource keys
  read current effective rows for those keys
  write source-of-truth rows
  derive next effective rows for those keys from source tables
  diff current vs next
  delete removed effective rows
  insert added effective rows
  append projection/event rows for changed users/resources
commit
```

The only acceptable full rebuild is the one-time migration/backfill or an explicit repair/admin job.

## Affected Resource Keys

Projection recompute is scoped by resource key:

```text
(company_id, resource_type, resource_id)
```

### GVIC Source Mutations

| Mutation | Affected resource keys |
| --- | --- |
| Node GVIC changed | that node |
| Logic gate GVIC changed | that logic gate plus nodes currently linked to that logic gate |
| Project GVIC changed | that project |
| Shared triage GVIC changed | that shared triage folder |

### Node Logic Gate Mutations

| Mutation | Affected resource keys |
| --- | --- |
| Node linked to logic gate | that node |
| Node unlinked from logic gate | that node |
| Node moved from one logic gate to another | that node |

The logic gate resource itself is not changed by linking or unlinking a node. Only the node's inherited effective GVIC changes.

### Group Membership Mutations

For a member add/remove in group `G`:

1. Find `G` plus all ancestor groups of `G`.
2. Find `resource_gvic_assignments` rows where `principal_type='group'` and `principal_id` is in that ancestor set.
3. Recompute only those resources.

Reason: if a parent group is assigned to a resource, adding a user to a descendant group changes that user's effective assignment on the parent-assigned resource.

### Group Parent Mutations

For a group parent change:

1. Capture affected closure pairs before the change.
2. Write the group parent change and closure update.
3. Capture affected closure pairs after the change.
4. Compute the symmetric difference.
5. Use changed ancestor group IDs to find assigned resources.
6. Recompute only those resources.

## Effective Derivation

For each affected resource key, derive effective rows from source state.

### Direct Resource Derivation

For non-node resources and standalone nodes:

```text
configured user rows
union
configured group rows expanded to users through group closure and group members
```

Rows get `inheritance_type='direct'`.

### Node Linked To Logic Gate Derivation

For node resources linked to a logic gate:

```text
linked logic gate configured user rows
union
linked logic gate configured group rows expanded to users through group closure and group members
```

Rows are written with:

- `resource_type='node'`
- `resource_id=<node_id>`
- `source_resource_type='logic_gate'`
- `source_resource_id=<logic_gate_id>`
- `inheritance_type='logic_gate_inherited'`

The node's own configured GVIC rows are ignored for effective output while the link exists.

## Migration Plan

### 1. Create New GVIC Tables

Create:

- `resource_gvic_assignments`
- `resource_gvic_effective_assignments`
- group closure table if needed

Add strict constraints for new resource types and new GVIC roles only.

Do not create compatibility views with old RACI names.

### 2. Migrate `resource_raci_assignments`

Insert all old rows into `resource_gvic_assignments` with role transformation:

```text
responsible -> generated
accountable -> verified
consulted -> consulted
informed -> informed
```

Map:

```text
resource_type -> resource_type
resource_id -> resource_id
subject_type -> principal_type
subject_id -> principal_id
created_timestamp -> created_timestamp
```

Then drop `resource_raci_assignments` after verifying row counts.

### 3. Migrate Logic Gate RACI Rows

If `logic_gate_raci_assignments` still exists independently, migrate it into `resource_gvic_assignments` with:

```text
resource_type='logic_gate'
resource_id=logic_gate_id
principal_type='user'
principal_id=user_id
```

Use the same role transformation.

Drop `logic_gate_raci_assignments` after all backend code uses `resource_gvic_assignments`.

### 4. Migrate Shared Triage RACI Rows

If shared triage still has separate RACI user/group tables, migrate them into `resource_gvic_assignments` with:

```text
resource_type='shared_triage_folder'
resource_id=folder_id
```

Use the same role transformation.

Drop old shared triage RACI tables after all backend code uses `resource_gvic_assignments`.

### 5. Migrate Node Assignees To Node GVIC

For each node with `assignee_user_id is not null`, insert:

```text
resource_type='node'
resource_id=node_id
role='generated'
principal_type='user'
principal_id=assignee_user_id
```

After the migration and code update, drop:

- `nodes.assignee_user_id`
- any node assignee display/cache columns
- assignee fields from kanban/projection models where they only supported Person In Charge

### 6. Rename Node Title To Name

Rename:

```text
nodes.title -> nodes.name
```

Then update all source code and API contracts:

- Go domain structs
- store inputs/results
- HTTP request/response payloads
- frontend TypeScript types
- editor UI
- kanban card display
- project management display
- Company Explorer display
- tests and fixtures

Do not return both `title` and `name`.

### 7. Drop Node Status Color

Drop:

```text
nodes.status_color
```

Remove:

- Go fields
- JSON fields
- frontend fields
- projection columns if they exist only to mirror node status color
- UI color editing for node status

Kanban/work status coloring should come from canonical status definitions, not node rows.

### 8. Migrate Verify To Review

Migrate all persisted values:

- `kanban_columns.title='Verify'` to `Review`
- `node_logic_gate_assignments.status_key='verify'` to `review`
- `nodes.status='Verify'` to `Review`
- projection rows carrying `Verify` or `verify`
- tests and fixtures

Then update strict constants:

- backend status constants
- backend status normalization
- frontend status unions
- frontend status labels
- kanban colors
- My Work grouping
- Home/GVIC status matrix
- project management status display

Do not accept `verify`, `verification`, or `v`.

### 9. Backfill Effective GVIC Projection

After source rows are migrated:

1. Build group closure.
2. Populate `resource_gvic_effective_assignments` for every resource with configured GVIC.
3. Populate inherited effective GVIC for nodes currently linked to logic gates.
4. Verify row counts and sampled resources.

This is the only normal full projection backfill.

### 10. Delete Old Code Paths

Remove old RACI code instead of wrapping it:

- old route names
- old event names
- old payload fields
- old TypeScript aliases
- old Go constants
- old test helpers
- old UI copy
- old projection names if they contain RACI/RACIO

Rename the remaining concept to GVIC everywhere.

## API Contract

Use a generic GVIC resource API for all supported resources.

```text
GET  /v1/resources/{resource_type}/{resource_id}/gvic
PUT  /v1/resources/{resource_type}/{resource_id}/gvic
POST /v1/resources/{resource_type}/{resource_id}/gvic/add
POST /v1/resources/{resource_type}/{resource_id}/gvic/remove
GET  /v1/resources/{resource_type}/{resource_id}/gvic/effective
```

`GET /gvic` returns configured source rows, including group rows.

`PUT /gvic` replaces configured source rows for that resource and syncs effective projection rows for the affected resource keys.

`POST /add` and `POST /remove` are idempotent source mutations and sync effective projection rows for the affected resource keys.

`GET /effective` returns expanded user-level effective rows.

No endpoint should be named `raci` or `racio`.

Payload field names:

```json
{
  "gvic_assignments": [
    {
      "role": "generated",
      "principal_type": "user",
      "principal_id": "..."
    }
  ]
}
```

Do not use `raci_assignments`, `subject_type`, or `subject_id` in the new public contract. Use `principal_type` and `principal_id`.

## Permissions And Access

Effective GVIC should feed permission checks through `resource_gvic_effective_assignments`.

Access policy should be explicit and implemented in one backend policy module. Suggested default mapping:

- `generated`: view/edit
- `verified`: view/edit
- `consulted`: view
- `informed`: view

If admin behavior is needed, keep it separate from GVIC roles. Do not invent a fifth GVIC role for admin.

Company admins and dev admins can still bypass through the existing company/admin role model.

## Projection Maintenance

Every mutation that changes effective GVIC must update the exact affected projection rows transactionally. My Work/GVIC has no browser realtime scope, projection event row, or sequence. The initiating browser uses the source-shaped committed response; other sessions read current rows on open/navigation/manual refresh.

## Runtime Sync Functions

Implement a backend sync boundary similar to:

```text
syncResourceGVICEffectiveAssignmentsTx(ctx, tx, companyID, affectedResources)
```

Required behavior:

1. Deduplicate affected resource keys.
2. Read current effective rows for those resource keys.
3. Derive next rows for those exact resource keys.
4. Diff current vs next.
5. Delete removed rows.
6. Insert added rows.
7. Return the source-shaped result and any exact changed-row information still required by the initiating command; do not publish a generic browser event.

Do not expose this function to HTTP as a write endpoint.

## Implementation Order

### Phase 1: Build, Migrate, Switch, And Test

Phase 1 is the functional migration. The app should run on the new model by the end of this phase.

1. Add migrations for new GVIC tables and strict constraints.
2. Add backend source/projection sync functions with tests.
3. Add migration data transforms for RACI to GVIC, node assignee to node GVIC, node title to name, status color removal, and verify to review.
4. Update backend domain/store/API/events/projections to write and read the new GVIC/node contracts.
5. Update frontend API/types/UI/routes to use the new GVIC/node contracts.
6. Update Company Explorer, Home, My Work, kanban, editor, project management, shared triage, notifications, and realtime invalidation to work from the new contracts.
7. Run backend and frontend tests.
8. Run manual smoke tests for node editor, logic gate work board, GVIC assignment picker, group assignment, group membership change, shared triage, project views, and My Work/GVIC views.

Phase 1 should not leave active runtime dependency on old RACI/RACIO payloads, old node assignee fields, `Verify`, node `title`, or node `status_color`. If old code still exists at this point, it is only pending deletion in Phase 2 and should not be used by normal runtime flows.

### Phase 2: Delete Old Surfaces

Phase 2 is the bridge-burning cleanup.

1. Remove old RACI/RACIO handlers, routes, events, types, helpers, tests, and docs.
2. Remove old Person In Charge and `assignee_user_id` code from frontend and backend.
3. Remove old `Verify` constants, colors, normalizers, tests, and fixtures.
4. Remove old node `title` code and any JSON `title` payload support for nodes.
5. Remove old node `status_color` code and projection fields.
6. Remove stale migrations/test fixtures/helpers that reference old concepts unless they are intentionally historical migration tests.
7. Run the regression scans in this document and delete or justify every hit.
8. Run backend and frontend tests again.
9. Run the same manual smoke tests from Phase 1 against the cleaned repo.

Phase 2 is not complete until the repo has no backwards compatibility layer and all normal code uses GVIC, `review`, node `name`, and configured/effective GVIC assignments only.

## Test Requirements

### Migration Tests

- `resource_raci_assignments` rows migrate to `resource_gvic_assignments`.
- `logic_gate_raci_assignments` rows migrate to logic gate GVIC rows if the table exists.
- shared triage RACI rows migrate to shared triage GVIC rows.
- node `assignee_user_id` migrates to node `generated` GVIC rows.
- `Verify` columns/statuses migrate to `Review`.
- `nodes.title` becomes `nodes.name`.
- `nodes.status_color` is dropped.
- old RACI tables/columns are dropped.

### Backend Tests

- PUT configured GVIC replaces source rows and updates effective rows.
- POST add/remove are idempotent and update effective rows precisely.
- group assignment expands to descendant group members.
- adding a member to a child group updates only resources assigned to that child or its ancestors.
- removing a member removes only effective rows no longer justified by another assignment.
- moving a group between parents updates only resources assigned to changed ancestors.
- standalone node uses direct node GVIC.
- linked node inherits logic gate GVIC.
- unlinking node restores direct node GVIC.
- logic gate GVIC changes update the gate and linked nodes only.
- node direct GVIC changes while linked do not affect effective rows until unlink.
- project GVIC and shared triage GVIC use the same generic path.

### Frontend Tests

- no UI text says RACI, Responsible, Accountable, or Person In Charge.
- no UI status says Verify.
- node editor displays Name and GVIC.
- GVIC picker supports users and groups.
- group rows remain configured rows in GET `/gvic`.
- effective rows show expanded users in GET `/gvic/effective`.
- kanban and My Work use Review.

### Regression Scans

Before completion, grep the repo for these terms and remove or justify every hit:

```text
raci
racio
Responsible
Accountable
responsible
accountable
Person In Charge
person in charge
assignee_user_id
AssigneeUserID
status_color
Verify
verify
node.title
json:"title"
```

Some lowercase words like `verify` may appear in unrelated test language or documentation. Product/runtime code should not keep old status semantics.

## Acceptance Criteria

- Existing RACI data is migrated into GVIC data.
- Existing node assignees are migrated into node `generated` GVIC rows.
- Existing Verify statuses are migrated to Review.
- Nodes expose `name`, not `title`.
- Nodes no longer expose or store Person In Charge.
- Nodes no longer expose or store `status_color`.
- All GVIC resources use the generic source table.
- Effective GVIC uses `resource_gvic_effective_assignments`.
- Runtime mutations use precise affected-resource recompute, not global rebuilds.
- Old RACI/RACIO routes, payloads, constants, and UI labels are deleted.
- There is no backwards compatibility layer.
