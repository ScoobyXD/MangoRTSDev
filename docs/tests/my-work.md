Last updated: 2026-06-21

# My Work Rules

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: core read path, projection sync, permission filtering, and realtime delta behavior have backend coverage. Rule ID mapping is partial.

## Definitions

My Work row: One `gvic_matrix_projection_table` row for one user, one GVIC role, one priority bucket, one node leaf, and one project/logic-gate path context.

Node leaf: The actual work item. `node_id` is the resource that opens as work. Projects and logic gates are never My Work leaves by themselves.

Path context: `project_id/project_name` and `logic_gate_id/logic_gate_name` are denormalized display context for the node leaf.

Active work: A standalone node is active when its node status is not `Done`. A node in a relationship with an active project, directly or through a logic gate, remains active while the project is active even if the node status is `Done`. A project is active when its project status is not `Done`. Logic gates do not add their own active status.

Projection identity: `projection_row_id` is the row identity used by reads, deltas, realtime payloads, and frontend reconciliation.

## Business Logic

MW1 - My Work shows active node-leaf work derived from effective GVIC assignments, not the Updates notification feed.
MW2 - My Work includes only generated, verified, consulted, and informed GVIC roles.
MW3 - The Me scope targets the current user.
MW4 - The Team scope targets users in the selected user group, including descendant group members.
MW5 - The All scope targets all users in the company.
MW6 - Target user IDs are deduped before loading My Work data.
MW7 - Each target user loads independently so one failed target does not blank successful target results.
MW8 - If all target loads fail, My Work shows a full failure state.
MW9 - If some target loads fail, My Work preserves successful results and shows a scoped partial-failure warning.
MW10 - My Work cache keys include company, surface scope, and target user IDs.
MW11 - Realtime My Work subscriptions are scoped per target user and reconcile rows by `projection_row_id`.
MW12 - My Work matrix cells group work by `gvic_assignment` and `priority`.
MW13 - Role buckets sort generated, verified, consulted, then informed.
MW14 - Priority buckets sort 1, 2, 3, 4, 5, then no priority.
MW15 - Projects and logic gates are display/path context only; they must not appear as standalone My Work leaves.
MW16 - `node_id` is the actual work item for every My Work row.
MW17 - If a node is assigned to a logic gate, My Work uses the logic gate GVIC assignment for that node path.
MW18 - If a node is not assigned to a logic gate, My Work uses the node GVIC assignment.
MW19 - A person or group can have only one GVIC assignment per node or logic gate.
MW20 - My Work GET reads flat projection rows directly from `gvic_matrix_projection_table`.
MW21 - The backend must not recursively build a tree for My Work reads.
MW22 - The frontend must not lazy-fetch My Work branches to derive the matrix.
MW23 - The projection row carries denormalized `node_name`, path context, row status, due date, accounts, timestamps, and `sort_order`.
MW24 - Hidden work is filtered out: the viewer needs node work access and view access to any projected project or logic-gate context.
MW25 - My Work grouping supports account, due date, person, project, status, and team fields.
MW26 - The default My Work grouping is project ascending.
MW27 - Saved grouping settings are scoped by company and current user.
MW28 - Malformed or duplicate saved grouping settings are normalized before use.
MW29 - Opening a My Work row routes to the node, with project and logic-gate context available for display/navigation.
MW30 - Expanding/collapsing grouping rows is separate from opening the work item.
MW31 - Drag/drop or empty-cell creation from My Work carries the selected priority and creator GVIC role into the created node.
MW32 - Semantic backend mutations write canonical/source rows and update affected hot projection rows in the same transaction.
MW33 - Normal mutations prefer exact projection row upsert/delete over broad rebuilds.
MW34 - Large fanout changes may emit bounded refetch signals instead of many row deltas.
MW35 - Realtime sends exact row deltas when safe; permission-sensitive delivery must re-check access before sending rows.
MW36 - My Work pulls only active work. Standalone nodes are active when they are not in `Done` status. Projects are active when they are not in `Done` status. A node marked `Done` remains active when it is in a relationship with an active project, either directly or through a logic gate, because the parent project is still going. Logic gates do not add their own active status.
    a. standalone Done nodes are excluded from My Work
    b. Done nodes under an active project are included
    c. Done nodes through a logic gate under an active project are included
    d. Done projects do not make their related nodes visible
MW37 - Expanding or collapsing a grouping row is scoped to the exact matrix cell where the user clicked; the same grouping label/path in another role or priority cell must not change.
MW38 - The My Work grouping UI includes a Projects toggle. Turning Projects off hides project grouping/path display while preserving node leaves and logic-gate display context.

## Projection Sync Events

The hot projection is updated transactionally for these source mutations:
- node rename, status, due date, priority, accounts, deletion, or inactive status changes
- logic gate rename, GVIC assignment changes, node move into/out of a logic gate, deletion, or inactive status changes
- project rename, project relationship changes, deletion, or inactive status changes
- node GVIC assignment changes
- permission changes affecting the node or path context

Node rename/status/due date/priority/accounts changed: update/rebuild rows where node_id = X.
Logic gate renamed: update all rows where logic_gate_id = X.
Project renamed: update all rows where project_id = X.
Node moved into/out of a logic gate: rebuild all projection rows for that node.
Logic gate GVIC assignment changed: rebuild rows for all current nodes in that logic gate.
Node GVIC assignment changed: rebuild rows for that node, but only matters when the node is not deferring to a logic gate.
Project relationship changed: rebuild affected node rows under that project/gate relationship.
Project/logic gate/node deleted or archived/done: delete or rebuild affected rows.
Realtime: emit deltas keyed by projection_row_id; for big fanout changes, emit a scoped refetch for affected users instead of thousands of row patches.


## Scenarios

### Scenario MW-S1: Scope Loading And Partial Failure

Business logic covered:
- MW1 through MW11

Given:
- A company has users, nested user groups, and active node GVIC work.
- One target user's My Work request succeeds and another target user's request fails.
- Realtime GVIC matrix events arrive for one target user.

Expected:
- My Work includes generated, verified, consulted, and informed assignments and does not show notification-feed-only Updates.
- Me, Team, and All scopes resolve the correct target users.
- Duplicate target user IDs are loaded once.
- Successful target results remain visible when another target fails.
- A full failure state appears only when every target fails.
- Cache keys separate company, selected scope, and target users.
- Realtime reconciles only rows for the target user affected by the event.

### Scenario MW-S2: Flat Rows, Roles, Priority, And Visibility

Business logic covered:
- MW12 through MW24, MW36

Given:
- A user has GVIC assignments on nodes and logic gates.
- Some nodes are assigned to logic gates and some are standalone.
- Some project contexts are active and some are closed/archived/done.
- Some assigned nodes or path contexts are not viewable by the current viewer.

Expected:
- Cells are grouped by role and priority.
- Roles sort generated, verified, consulted, informed.
- Priorities sort 1 through 5, then no priority.
- Closed, archived, done, complete, and completed node paths are excluded.
- Closed, archived, done, complete, and completed project contexts are excluded.
- A standalone `Done` node is excluded.
- A node marked `Done` remains visible when it is in a relationship with an active project.
- A node under a `Done` project is excluded.
- Direct project assignments do not create My Work rows.
- Direct logic-gate assignments do not create My Work rows without a node leaf.
- Logic gate GVIC assignment controls a node path when the node is assigned to that logic gate.
- Node GVIC assignment controls a standalone node path.
- Hidden nodes or hidden path contexts do not appear.

### Scenario MW-S3: Grouping, Open Behavior, And Creation

Business logic covered:
- MW25 through MW31, MW37 through MW38

Given:
- A user changes My Work grouping settings.
- Saved local grouping settings include duplicates or malformed fields.
- The user opens work rows and creates work from a priority/role cell.

Expected:
- Supported grouping fields are account, due date, person, project, status, and team.
- The default grouping is project ascending.
- Saved grouping settings are isolated by company and user.
- Malformed or duplicate settings are normalized.
- Opening a row navigates to the node with available path context.
- Expanding a group does not accidentally open the work item.
- Collapsing or expanding a group in one matrix cell does not collapse or expand matching groups in any other cell.
- The Projects toggle hides project group/path display without removing node leaves or logic-gate context.
- Created work receives the selected priority and creator GVIC role.

### Scenario MW-S4: Transactional Projection And Realtime

Business logic covered:
- MW32 through MW35

Given:
- A semantic backend mutation changes canonical/source My Work data.
- The mutation affects one or more node leaf projection rows.
- Subscribed users may or may not still have permission to see those rows.

Expected:
- Canonical/source rows and exact affected projection rows are updated in the same transaction.
- Projection deltas use `projection_row_id`.
- Realtime sends authorized exact row upserts/deletes when bounded.
- Large fanout or ambiguous permission changes can request a bounded refetch.
- Unauthorized viewers do not receive row payloads for hidden nodes or hidden path contexts.
