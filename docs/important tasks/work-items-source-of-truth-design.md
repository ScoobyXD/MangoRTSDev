# Work Items Source Of Truth Design

Date: 2026-05-19

Branch: `work-items/source-of-truth-design`

## Decision

Keep Logic Gate work ownership Kanban-card-backed for the next implementation branches. Do not add `work_items` or `node_logic_gate_assignments` now.

This is not a permanent lock against a future source table. It is a decision that the current product problems are command ownership and drift control, not a missing relational row. The existing Logic Gate card row already carries the user-visible assignment facts that MangoRTS needs today: Logic Gate membership, status column, issue state, and board position. Nodes already carry priority and assignee. Adding a second source table now would create dual-write and backfill risk before the command surface is complete.

The next work should make the existing model harder to misuse:

- route Home, Kanban, inbox, and future email conversion through semantic work-item commands;
- keep raw Kanban card writes as compatibility or generic-board paths;
- enforce one set of read and write invariants for Logic Gate work state;
- add targeted tests around assignment, movement, issue toggles, removal, priority, and assignee policy.

## Current Behavior

### Logic Gate Membership And Status

Logic Gate membership is represented by a `kanban_cards` row whose `logic_gate_id` is not null. That card points to:

- `company_id`
- `board_id`
- `card_id`
- `column_id`
- `node_id`
- `logic_gate_id`
- `is_issue`
- `position`

The schema already supports this as a source row:

- `kanban_boards.logic_gate_id` attaches one Kanban board to one Logic Gate.
- `idx_kanban_boards_logic_gate` enforces one attached board per Logic Gate.
- `idx_kanban_cards_one_logic_gate_card_per_node` enforces one Logic Gate card per node.
- `idx_kanban_cards_column_position` supports board/column ordering.

Status is read from the card first:

1. `kanban_cards.is_issue = true` means the node displays as `Issue`.
2. Otherwise the card's `column_id` resolves to the Kanban column title and color.
3. If no Logic Gate card exists, node direct `status` and `status_color` are the fallback.

The Postgres node read model uses a lateral join to the latest Logic Gate card, and the memory repository derives the same shape before returning nodes.

### Node Direct Fields

Direct node fields are still needed, but they are not all the same kind of truth:

- `nodes.status` and `nodes.status_color` are fallback or denormalized derived values. They are useful for nodes not currently assigned to a Logic Gate and for compatibility with older reads.
- `nodes.priority` is the current priority source of truth.
- `nodes.assignee_user_id` is the current person/assignee source of truth.

The assignment command updates `nodes.priority` only when the caller explicitly sets priority. It assigns `nodes.assignee_user_id` using the first Responsible Logic Gate RACI user policy. If a Logic Gate has no Responsible user, the current implementation leaves the existing assignee unchanged.

### Command Paths

The completed assignment-command slice added:

- `kanban.Service.AssignNodeToLogicGateStatus`
- `store.AssignNodeToLogicGateStatus`
- `POST /v1/work-items/logic-gate-assignments`
- frontend `assignNodeToLogicGateStatus`
- Home Logic Gate inbox drop flow using that command

The Postgres implementation performs the card upsert/move, node status sync, first Responsible assignment, and optional priority update in one transaction. The service appends a semantic domain event after the repository command, but that append is still best-effort and should move into the atomic event pattern later.

Some paths still bypass the semantic command:

- generic Kanban card APIs still move, toggle issue state, and delete cards directly;
- Home bulk node status update still finds a column, calls `upsertKanbanCard`, then calls `updateNode`;
- email conversion still creates nodes, folder items, node map positions, Kanban cards, email links, projections, triage deletes, node status sync, and first Responsible assignment inside store-level orchestration.

## Why Not Add A New Table Now

A new source table would be justified if the current row could not express the domain. For the current one-node-to-one-Logic-Gate model, it can.

The existing card-backed model is sufficient for now because:

- it already has tenant scope, node identity, Logic Gate identity, status column, issue flag, and position;
- it already has uniqueness constraints for one attached board per Logic Gate and one Logic Gate assignment per node;
- it is already used by Kanban, Logic Gate Arena, node read derivation, and email conversion;
- it can support headless agent commands once the command/API surface is finished;
- the immediate drift risk comes from multiple write paths, not from lack of a row.

Adding `work_items` or `node_logic_gate_assignments` now would force compatibility reads, backfill, rollback, dual writes, event fanout, and UI migration before the team has finished the semantic command boundary. That would increase complexity before it reduces risk.

## Target Command And API Surface

The public API should be semantic work-item commands even while the persistence model remains Kanban-card-backed.

### Assign Or Upsert

Use the existing endpoint:

`POST /v1/work-items/logic-gate-assignments`

Purpose:

- assign a node to a Logic Gate;
- choose status by `status` or `column_id`;
- set board position;
- optionally set priority;
- optionally set issue state;
- assign a person using the current `first_responsible` policy.

Required inputs:

- `company_id`
- `logic_gate_id`
- `node_id`

Optional inputs:

- `status`
- `column_id`
- `position`
- `priority` where omitted means unchanged and null means clear
- `is_issue`
- `node_title`
- `description_snapshot`
- `assignee_policy`, currently only `first_responsible`

Future explicit-person input:

- `assignee_user_id`, validated against company membership, can update `nodes.assignee_user_id` without redesigning RACI. It should be mutually exclusive with `assignee_policy` unless a later product decision defines precedence.

Response:

- canonical card
- canonical node read model after derived status, priority, and assignee changes

### Move Existing Assignment

Target endpoint:

`POST /v1/work-items/logic-gate-assignments/move`

Purpose:

- move the existing Logic Gate assignment for a node to another status, position, or Logic Gate;
- preserve the one-Logic-Gate-card-per-node invariant;
- return the updated card and node.

Inputs:

- `company_id`
- `node_id`
- `logic_gate_id` for the target Logic Gate
- optional `from_logic_gate_id` for concurrency protection
- `status` or `column_id`
- `position`
- optional `priority`
- optional `assignee_policy` or future `assignee_user_id`

Implementation on the current model:

- if the target Logic Gate is unchanged, update the card's column/position through the work-item command service;
- if the target Logic Gate changes, delete any other Logic Gate card for the node and upsert the target card in the same transaction;
- recompute node read fields before returning.

### Remove Assignment

Target endpoint:

`POST /v1/work-items/logic-gate-assignments/remove`

Purpose:

- remove the node from its Logic Gate work assignment;
- keep generic Kanban card deletion from being the product command for Logic Gate ownership.

Inputs:

- `company_id`
- `node_id`
- optional `logic_gate_id` for concurrency protection
- optional `fallback_status` and `fallback_status_color` if the caller wants direct node fallback state after removal

Required behavior:

- delete the Logic Gate card;
- recompute node read status from any remaining Logic Gate assignment, or clear/set direct fallback fields deterministically;
- leave priority and assignee unchanged unless the request explicitly clears or changes them.

### Issue Toggle

Target endpoint:

`POST /v1/work-items/logic-gate-assignments/issue`

Purpose:

- set or clear issue state for a node's Logic Gate assignment.

Inputs:

- `company_id`
- `node_id`
- optional `logic_gate_id`
- `is_issue`

Required behavior:

- update `kanban_cards.is_issue`;
- return node status as `Issue` when true;
- return the column-derived status when false.

### Inbox And Home Parity

Home and inbox flows should call the same command surface as Kanban and headless clients.

Near-term parity targets:

- Home Logic Gate inbox drops already use `POST /v1/work-items/logic-gate-assignments`.
- Home bulk status changes should stop calling `upsertKanbanCard` plus `updateNode`; they should call the move command.
- Inbox issue toggles should call the issue command.
- Inbox removal should call the remove command.

### Future Email Conversion

Email conversion should eventually become a product command, but not in this branch.

Target shape:

`POST /v1/work-items/from-email`

Required behavior:

- create or select the node;
- create required folder item, map position, email link, and projection rows;
- call the same Logic Gate assignment command internally for card/status/assignee/priority behavior;
- delete or mark the triage item only after the whole command succeeds;
- emit the same semantic work-item events as direct assignment.

## Event Taxonomy

While persistence remains Kanban-backed, events should describe work-item intent rather than low-level table names.

Semantic event types:

- `work_item.logic_gate_assignment_saved`
- `work_item.logic_gate_assignment_moved`
- `work_item.logic_gate_assignment_removed`
- `work_item.logic_gate_issue_toggled`
- `work_item.logic_gate_priority_changed`
- `work_item.logic_gate_assignee_changed`
- `work_item.email_converted_to_logic_gate`

Minimum payload fields:

- `company_id`
- `logic_gate_id`
- `node_id`
- `board_id`
- `card_id`
- `column_id`
- `status`
- `position`
- `is_issue`
- `priority`
- `assignee_user_id`
- `actor_user_id`
- `idempotency_key`

Compatibility workspace events such as `kanban_card_upserted` and `node_updated` can remain during migration. The event-plane follow-up should make the semantic event append atomic with the command commit.

## Invariants To Enforce

1. Logic Gate work membership comes from `kanban_cards.logic_gate_id`, not from `nodes.logic_gate_ids`.
2. `nodes.logic_gate_ids` is a read-model field derived from cards.
3. A node can have at most one active Logic Gate assignment until the product explicitly chooses multi-gate assignment.
4. Logic Gate status reads prefer `is_issue`, then card column title/color, then node direct fallback fields.
5. Assignment commands must update card state, priority, assignee, and derived node read fields in one repository transaction.
6. Direct `UpdateNode(status)` must not override card-derived status while a Logic Gate assignment exists.
7. Priority remains on `nodes.priority`; assignment commands may set or clear it, but cards do not own it.
8. Assignee remains on `nodes.assignee_user_id`; `first_responsible` is the default assignment policy.
9. Unknown nonblank status labels should not silently choose the first column once the move command is added. Blank status may default to the first/Pending column.
10. Raw Kanban card write paths are compatibility or generic-board paths. Logic Gate work surfaces should use work-item commands.
11. Remove assignment must define the node fallback status outcome explicitly. Generic card delete is not enough.
12. Command responses should include the changed card and node so clients do not need a full workspace refresh.

## Cleanup And Refactor Steps

1. Add service methods for move, remove, and issue toggle on the existing model.
2. Move Home bulk status editing from `upsertKanbanCard` plus `updateNode` to the move command.
3. Move Logic Gate Kanban card move, issue toggle, and remove flows to work-item commands. Keep generic Kanban APIs for non-Logic-Gate boards.
4. Add explicit remove semantics for node direct fallback status after assignment deletion.
5. Normalize status resolution so unknown status labels fail instead of accidentally selecting the first column.
6. Keep email conversion store-level orchestration until the email conversion command branch, but document it as a bypassing path.
7. Move Kanban/work-item domain event append into the same transaction when `events/atomic-kanban-workspace-events` runs.
8. Keep frontend component structure intact; this work is command/API migration, not component splitting.

## Tests Needed

Backend service tests:

- assign creates or updates one Logic Gate card for the node;
- moving status changes the card column and the node read status;
- moving to another Logic Gate removes the previous Logic Gate card for the node;
- issue true overrides status to `Issue`;
- issue false restores column-derived status;
- priority omitted leaves priority unchanged;
- priority null clears priority;
- priority value sets priority;
- first Responsible RACI assignment sets `nodes.assignee_user_id`;
- no Responsible user leaves assignee behavior explicit and tested;
- invalid status/column fails without patching node fields;
- remove assignment has deterministic node fallback behavior.

HTTP tests:

- assign, move, remove, and issue endpoints validate required IDs;
- priority null versus omitted is distinguishable;
- stale `from_logic_gate_id` or missing card returns a deterministic error;
- response includes both card and node.

Read-model tests:

- node status is card-derived while assigned;
- direct node status is fallback when unassigned;
- `logic_gate_ids` is card-derived;
- direct `UpdateNode(status)` cannot override card-derived status while assigned.

Frontend/API tests:

- Home bulk status uses the move command;
- Kanban issue toggle uses the issue command for Logic Gate boards;
- removal uses the remove command;
- cache invalidation stays scoped to the affected board/Logic Gate and node.

Email conversion tests, in the future command branch:

- conversion reuses assignment behavior for card/status/assignee;
- conversion emits the same semantic work-item events;
- triage rows are deleted only after successful node/card/link/projection creation.

## Risks And Revisit Triggers

Staying Kanban-backed has real limits:

- the current uniqueness model allows only one active Logic Gate assignment per node;
- card identity doubles as assignment identity, which is awkward if work ownership later spans non-Kanban surfaces;
- priority and assignee live on nodes, so queries by Logic Gate plus priority/person need joins or read models;
- status semantics depend on mutable column titles;
- generic Kanban APIs can still cause drift until migrated or guarded;
- domain event append is not yet atomic with Kanban/work-item mutations;
- email conversion remains a bypassing path until its command branch.

Revisit a dedicated `node_logic_gate_assignments` source table if any of these become product requirements:

- one node must belong to multiple Logic Gates at once;
- assignment needs lifecycle state independent of board columns;
- assignment history/audit must be first-class, not just event history;
- issue state, priority, or assignee must become per-Logic-Gate rather than per-node;
- Kanban becomes a projection of work ownership instead of the primary work surface;
- hot inbox reads require an assignment-shaped read model that cannot be served cheaply from `nodes` plus `kanban_cards`.

Until then, the better next step is command parity on the existing model.

## Next Implementation Branch

Recommended next branch:

`work-items/assignment-command-parity-existing-model`

Scope:

- implement move, remove, and issue-toggle commands on the existing Kanban-card-backed model;
- move Home bulk status and Logic Gate Kanban card operations onto those commands;
- add the tests listed above for the command surface;
- do not add migrations;
- do not add `work_items` or `node_logic_gate_assignments`;
- do not migrate email conversion yet.
