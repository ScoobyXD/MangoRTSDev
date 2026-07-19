Last updated: 2026-07-18

# My Work Rules

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: core read path, projection sync, and permission filtering have backend coverage. `tests/frontend/pages/home/myWorkGrouping.test.ts` and `tests/frontend/modules/grouping/universalStatusGrouping.test.ts` cover the My Work grouping model and exact shared status order. `tests/frontend/pages/home/myWorkMatrixLoader.test.ts` covers matching Node and Logic Gate title patches, existing-cache convergence, version-gated pre-commit in-flight reconciliation, post-commit canonical authority, and a projection/drop result that merges only newer title commits. Rule ID mapping is partial.

## Definitions

My Work row: One `gvic_matrix_projection_table` row for one user, one GVIC role, one priority bucket, one node leaf, and one project/logic-gate path context.

Node leaf: The actual work item. `node_id` is the resource that opens as work. Projects and logic gates are never My Work leaves by themselves.

Path context: `project_id/project_name` and `logic_gate_id/logic_gate_name` are denormalized display context for the node leaf.

Active work: A standalone node is active when its node status is not `Done`. A node in a relationship with an active project, directly or through a logic gate, remains active while the project is active even if the node status is `Done`. A project is active when its project status is not `Done`. Logic gates do not add their own active status.

Projection identity: `projection_row_id` is the row identity used by canonical reads and frontend reconciliation.

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
MW11 - My Work has no realtime subscription; it loads canonical rows for the selected target users when the surface opens or explicitly refreshes.
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
MW24 - Hidden work is filtered out: the viewer needs node work access and edit access to any projected project or logic-gate context.
MW25 - My Work grouping supports account, due date, logic gate, person, project, status, and team fields.
MW26 - The default My Work grouping is project ascending.
MW27 - Saved grouping settings are scoped by company and current user.
MW28 - Malformed or duplicate saved grouping settings are normalized before use.
MW29 - Opening a My Work row routes to the node, with project and logic-gate context available for display/navigation.
MW30 - Expanding/collapsing grouping rows is separate from opening the work item.
MW31 - Drag/drop or empty-cell creation from My Work carries the selected priority and creator GVIC role into the created node.
MW32 - Semantic backend mutations write canonical/source rows and update affected hot projection rows in the same transaction.
MW33 - Normal mutations prefer exact projection row upsert/delete over broad rebuilds.
MW34 - Large fanout changes update the projection transactionally; the next canonical My Work load returns the current rows.
MW35 - My Work does not receive cross-user projection deltas. Read-time permission filtering is authoritative, and temporary cross-user staleness until navigation or refresh is accepted.
MW36 - My Work pulls only active work. Standalone nodes are active when they are not in `Done` status. Projects are active when they are not in `Done` status. A node marked `Done` remains active when it is in a relationship with an active project, either directly or through a logic gate, because the parent project is still going. Logic gates do not add their own active status.
    a. standalone Done nodes are excluded from My Work
    b. Done nodes under an active project are included
    c. Done nodes through a logic gate under an active project are included
    d. Done projects do not make their related nodes visible
MW37 - Expanding or collapsing a grouping row is scoped to the exact matrix cell where the user clicked; the same grouping label/path in another role or priority cell must not change.
MW38 - Project and Logic Gate are normal My Work grouping fields. Removing either field from the grouping stack hides that grouping/path section while preserving node leaves and any remaining path context.
MW39 - Dragging a node from one My Work cell to another preserves an existing logic-gate relationship when the dragged row already came from a logic gate; the drop updates that same logic gate GVIC assignment and node priority context instead of moving the node out of the gate or creating a different gate.
MW40 - Dragging a node without existing logic-gate context between My Work cells updates the node's own priority and GVIC assignment without attaching it to a logic gate.
MW41 - The My Work node context menu is a compact command list with Open in new browser tab, Rename, Pin, and Delete. Delete is visually separated from the non-destructive commands.
MW42 - A node deleted from My Work may be hidden optimistically while the delete request is pending. On delete failure the hidden row is restored; on success My Work is refreshed.
MW43 - Updates grouping supports project, logic gate, and status as normal grouping fields, and those fields persist through the saved-views API. Updates remains an event/mention feed and must not share My Work's active-work semantics.
MW44 - My Work saved grouping views persist through the saved-views API. `logic_gate` is a valid My Work saved-view grouping field and must round-trip through save and reload.
MW45 - My Work remembers the selected saved view per company and current user so returning to the My Work tab does not reset to the first saved view.
MW46 - My Work saved grouping view rows render under the My Work entry in the Key Views sidebar, not in the My Work header. + Add new opens the floating grouping editor for a new saved view without navigating the main content area to My Work. Existing views expose Edit, Rename, and Delete commands, and saved-view rows reorder by drag. My Work may have zero saved grouping rows. The Me, My Team, and All scope tabs remain in the My Work header.
MW47 - Me, My Team, and All scope menus open from click and close after selecting a scope or clicking outside the scope menu.
MW48 - The active My Work saved-view row is visibly highlighted.
MW49 - Right-clicking a My Work saved-view row exposes Edit, Rename, and Delete commands. Renames persist to the saved-view name and drag reorder persists through saved-view `position`.
MW50 - Dragging a node between My Work cells updates both target priority and target GVIC role. A logic-gate-backed node must keep the same logic-gate relationship while moving, for example from priority 1 Generated to priority 3 Consulted.
MW51 - My Work Status grouping consumes the shared universal status contract also used by Updates and Project Logic Gates / Nodes. Ascending recognized order is In Progress, Review, Pending, Requested, Backlog, Done. Verify/Verification/Verified normalize to Review, Request/Requests normalize to Requested, Backlogs/Back Logs/Backlogged normalize to Backlog, and Complete/Completed/Closed/Archived normalize to Done. Descending reverses recognized nonterminal groups while Done remains final; unknown nonblank statuses and the distinct No status group remain before Done.
MW52 - The app-wide committed-title registry records the company/entity key and monotonic title-commit version; My Work consumes that shared state rather than maintaining a second registry. A matching Node rename updates current work-row titles, and a matching Logic Gate rename updates path/group labels. The app-lifetime coordinator patches existing My Work matrix caches immediately. A matrix request applies only title commits newer than the version captured when that request began, so a pre-commit in-flight result cannot restore an old label while a request begun after the commit remains authoritative canonical truth. Node-drop projection responses capture the shared title version before the request and merge only newer local Node or Logic Gate title commits while still applying assignment, priority, and other non-title fields, including for newly introduced rows. This does not create a My Work WebSocket subscription or trigger a canonical reload; other companies and unrelated resources remain unchanged.
MW53 - Projects is the first fixed subview under My Work in the Key Views sidebar and no longer appears as a top-level Entities button. Selecting it opens the Project Management page. It is available to every user, cannot be dragged, renamed, edited, or deleted, and all user-created My Work saved views remain ordered below it.

## Projection Maintenance

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
No My Work WebSocket message is emitted. The initiating command patches or reloads its concrete local surface; other sessions see the projection on their next open or refresh.


## Scenarios

### Scenario MW-S1: Scope Loading And Partial Failure

Business logic covered:
- MW1 through MW11

Given:
- A company has users, nested user groups, and active node GVIC work.
- One target user's My Work request succeeds and another target user's request fails.
- The surface loads canonical My Work rows for the selected target users.

Expected:
- My Work includes generated, verified, consulted, and informed assignments and does not show notification-feed-only Updates.
- Me, My Team, and All scopes resolve the correct target users.
- Duplicate target user IDs are loaded once.
- Successful target results remain visible when another target fails.
- A full failure state appears only when every target fails.
- Cache keys separate company, selected scope, and target users.
- No WebSocket subscription is created; canonical rows are reconciled for the selected target users.

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
- Standalone node paths with closed, archived, done, complete, or completed status are excluded unless an active project context keeps the node visible.
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
- MW25 through MW31, MW37 through MW51, MW53

Given:
- A user changes My Work grouping settings.
- Saved API-backed grouping settings include duplicates or malformed fields.
- The user switches between saved My Work views and leaves/re-enters the My Work tab.
- The user opens and closes My Work grouping settings from the My Work sidebar saved-view rows and scope menus.
- The user selects the fixed Projects subview under My Work.
- The user right-clicks a saved My Work view.
- The user opens work rows and creates work from a priority/role cell.
- The user right-clicks a My Work node.
- The user drags both logic-gate-backed and standalone nodes between matrix cells.
- A user changes Updates grouping settings.

Expected:
- Supported My Work grouping fields are account, due date, logic gate, person, project, status, and team.
- The default grouping is project ascending.
- Status ascending renders In Progress, Review, Pending, Requested, Backlog, then Done; descending reverses the nonterminal recognized groups but keeps Done at the bottom.
- Legacy Verify and Backlogged spellings join the Review and Backlog groups rather than creating duplicate status groups.
- API-backed saved grouping views are isolated by company and user.
- Logic Gate grouping saves and reloads through the saved-views API.
- The selected saved view is restored when returning to My Work.
- Malformed or duplicate settings are normalized.
- The saved-view rows are shown under the My Work entry in the Key Views sidebar when they exist, and the floating grouping editor opens from + Add new or right-click Edit.
- Projects is always the first subview under My Work, opens Project Management, has no edit/rename/delete or drag behavior, and user-created saved views stay below it; Projects is absent from the top-level Entities section.
- Me, My Team, and All stay in the My Work header and do not share the saved grouping view row real estate.
- Me, My Team, and All open on click and close on outside click or after a scope is selected.
- The active saved view row is highlighted.
- Right-clicking a saved view can edit, rename, or delete it; rename and drag reorder changes persist.
- Opening a row navigates to the node with available path context.
- Expanding a group does not accidentally open the work item.
- Collapsing or expanding a group in one matrix cell does not collapse or expand matching groups in any other cell.
- Project and Logic Gate grouping can be removed independently without removing node leaves.
- Removing every grouping is valid and leaves the saved view ungrouped.
- The My Work node context menu shows Open in new browser tab, Rename, Pin, and Delete, with Delete separated.
- Created work receives the selected priority and creator GVIC role.
- A dropped node that already belongs to a logic gate keeps that logic-gate relationship and visibly remains under that logic gate after the move.
- A dropped node appears in the target priority and GVIC role cell after the move.
- A dropped standalone node updates its own target priority and GVIC role and remains standalone.
- Deleting a My Work node hides it optimistically, restores it on failure, and refreshes My Work on success.
- Updates grouping supports Project, Logic Gate, and Status as ordinary grouping choices while staying separate from My Work active-work grouping.

### Scenario MW-S4: Transactional Projection Without Realtime

Business logic covered:
- MW32 through MW35

Given:
- A semantic backend mutation changes canonical/source My Work data.
- The mutation affects one or more node leaf projection rows.
- A later reader may or may not have permission to see those rows.

Expected:
- Canonical/source rows and exact affected projection rows are updated in the same transaction.
- Canonical projection rows preserve stable `projection_row_id` identities.
- No GVIC/My Work realtime event or `event_rows` record is emitted.
- The next open, navigation, or explicit refresh reads the current projection.
- Unauthorized readers do not receive hidden nodes or hidden path contexts from the canonical API.

### Scenario MW-S5: Same-Window Committed Titles Patch Mounted Rows

Business logic covered:
- MW52

Given:
- My Work is already mounted with matrix cells containing a Node row and a Logic Gate path label.
- The same Node or Logic Gate is renamed successfully from another surface in the same browser window.
- My Work may be unmounted with a fresh 30-second matrix cache entry, or a pre-rename matrix request may resolve after the title event.
- An unrelated-resource or other-company committed-title event may also arrive.

Expected:
- The matching Node work-row title changes immediately from the local committed-title event.
- The matching Logic Gate path/group label changes immediately wherever that context is present in the mounted matrix cells.
- A cache hit, remount, or late response from a request begun before the rename retains the committed current label instead of restoring stale row data.
- A canonical request begun after the title commit may replace the local label with its later canonical result; the local override is not a permanent display-row mask.
- A node-drop projection response applies role, priority, and other non-title fields while merging Node or Logic Gate title commits newer than the version captured before that drop request; newly introduced rows are covered, and a later response begun after the commit remains authoritative.
- Existing matrix identity and unrelated grouping fields remain unchanged.
- Unrelated-resource and other-company labels remain unchanged.
- No My Work WebSocket subscription is created and no canonical My Work request is issued for this label-only convergence.
