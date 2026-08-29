# RACI Tabs Tests

## Business Logic

RT1 - Tower shows exactly four personal Logic Gate tabs in this order: Responsible, Accountable, Consulted, and Informed.
RT2 - All four tabs start collapsed whenever Mango starts a new frontend session. Expansion state is current-session React state and is never stored in browser storage.
RT3 - A collapsed tab that has not yet been opened sends no RACI Tabs item, folder, or status-count request.
RT4 - Every collapsed-to-expanded role-tab transition performs one fresh bounded GET for only that role's root page. It does not load another role or any unopened folder, and a truncated page returns a continuation cursor instead of silently dropping rows.
RT5 - Every collapsed-to-expanded folder transition performs one fresh bounded GET for only that folder's direct-child page. Folder rows include `has_children` and recursive status totals without returning unopened descendant rows.
RT6 - Collapsing a role tab or folder discards that branch's loaded rows. A closed or never-opened branch stays unloaded and sends no branch GET until its next expansion.
RT7 - The canonical RACI Tabs tables are `raci_tabs_items` and `raci_tabs_folders`; Company Explorer, Pins, retired My Work storage, retired `user_logic_gate_shortcuts`, and browser storage are not RACI Tabs storage.
RT8 - `raci_tabs_items` has exactly `company_id`, `user_id`, `role`, `logic_gate_id`, nullable `folder_id`, `name`, `position`, `created_timestamp`, and `updated_timestamp`. It has no item ID, generic resource type, translated resource ID, permission field, or RACI policy field.
RT9 - The `raci_tabs_items` primary key is `(company_id, user_id, logic_gate_id)`. Its stored role is that user's one winning effective role under Responsible, Accountable, Consulted, then Informed priority.
RT10 - `raci_tabs_folders` has exactly `company_id`, `folder_id`, `user_id`, `role`, nullable `parent_folder_id`, `name`, `position`, `created_timestamp`, and `updated_timestamp`; `folder_id` is its primary key.
RT11 - An item or folder with a null folder or parent-folder ID is a direct child of its role tab root.
RT12 - Every item folder and folder parent reference is constrained to the same company, user, and role. Cross-company, cross-user, and cross-role moves are rejected atomically.
RT13 - Folders may nest to arbitrary depth without cycles. A folder cannot move into itself or any descendant.
RT14 - Items and folders share one mixed sibling order within a role and parent. Rows sort by position, created timestamp, name, row kind, then exact ID.
RT15 - A newly projected item copies the current Logic Gate name, receives a null folder ID, and receives a position after the existing root siblings in that user's role tab.
RT16 - `raci_tabs_items` is a derived Tower navigation copy only. Canonical RACI remains in `resource_gvic_settings` and `resource_gvic_assignments`, canonical permission remains separate, and no RACI Tabs row grants RACI or access.
RT17 - The forward migration backfills one root item for every existing effective company, user, Logic Gate, and winning role, including effective group and inherited assignments. Backfill ordering and positions are deterministic and rerunning the guarded migration cannot create duplicates.
RT18 - Giving one user one new effective role on one Logic Gate recalculates only that Logic Gate and inserts or updates exactly that user's item in the same committed business transaction.
RT19 - Giving a group an effective Logic Gate role expands the group's current nested membership and inserts or updates one item per affected effective user. Five effective members produce five user items; twenty produce twenty.
RT20 - A folder-policy or folder-parent change recalculates only Logic Gates in that folder subtree. A group-membership or parent-group change recalculates only resources assigned to that group or its affected ancestors. Company-membership removal relies on the exact cascading assignments and group memberships; none of these writes recalculates every Logic Gate in the company.
RT21 - Reconciliation compares the complete effective user-and-winning-role set. New users are inserted, removed users are deleted, unchanged users remain, and a winning-role change updates the role, clears the old folder placement, and appends the item to the new role root.
RT22 - RACI Tabs synchronization is part of the command that changed its effective input and commits or rolls back with that command. Retries are idempotent and cannot create duplicate items.
RT23 - A successful Logic Gate rename copies the committed name to every matching RACI Tabs item. Logic Gate deletion removes every matching item without deleting unrelated folders.
RT24 - Users cannot manually create, remove, rename, or change the role or Logic Gate identity of an item. Those fields follow effective RACI and the Logic Gate lifecycle; users may change only personal placement and order.
RT25 - Folder creation, rename, move, reorder, and deletion are personal organization actions requiring current company membership. They never change a Logic Gate, RACI assignment, permission, Company Explorer placement, Pin, or another user's tree.
RT26 - Deleting a folder subtree deletes only those personal folder rows, moves its contained RACI Tabs items to the same role root, and appends those items after the surviving root siblings.
RT27 - Plain click selects one visible loaded row. Ctrl-click or Command-click toggles one row, Shift-click additively selects the visible loaded range from the anchor, and Ctrl/Command plus Shift-click additively selects that range.
RT28 - Dragging a selected Logic Gate item moves the selected Logic Gate items together in visible order. Folder drag remains one folder subtree at a time, matching Company Explorer's item-batch and single-folder behavior.
RT29 - A folder header's middle drop zone moves entries inside it, its top and bottom edge zones place entries before or after it, and the role-root end zone reparents entries to root. Invalid ownership, role, or cycle input causes no partial move.
RT30 - Clicking a Logic Gate item opens that exact Logic Gate through its normal route. The destination performs its normal existence and permission checks; a copied item never bypasses denial.
RT31 - Each expanded role uses one soft elevated Tower surface. Folder and Logic Gate rows use the same brief two-pixel hover, focus, and selected-row lift as Pinned rows, without adding a permanent frame to every row.
RT32 - Folder disclosures, nesting, mixed ordering, click selection, drag previews, and drop placement visually follow the established Company Explorer and Pinned tree behavior while remaining backed only by the two RACI Tabs tables.
RT33 - Every returned Logic Gate item includes read-only Request, Pending, In Progress, and Review counts derived from canonical Logic Gate work. Backlog and Done never contribute.
RT34 - Every returned folder includes the per-status sum of all direct and descendant Logic Gate items, including unloaded and collapsed descendants. The loaded role root includes the same four totals for the complete role tab, and every Logic Gate contributes once.
RT35 - Request, Pending, In Progress, Review, and the row action slot keep the same fixed columns at every nesting depth. Each status slot is 17 pixels wide; zero leaves that slot empty instead of shifting another status.
RT36 - Request uses the Pin yellow gradient, Pending uses the Pin light-gray gradient, In Progress uses exact opaque `rgba(254, 155, 70)`, and Review uses the Node icon's `#33ddd5` to `#19a8ff` vertical gradient.
RT37 - A committed Node assignment, removal, or tracked-status move refreshes only the affected loaded Logic Gate count and recalculates its loaded ancestor and role totals. Count refresh writes no RACI Tabs item, folder, RACI, permission, or browser-storage row.
RT38 - RACI Tabs APIs derive the acting user from the authenticated company membership. A request-supplied user ID cannot read or mutate another user's items or folders.
RT39 - A committed direct-user, group, group-membership, group-parent, group-deletion, inherited-policy, or inheritance-parentage change that can change effective Logic Gate RACI emits one compact company-scoped `raci_tabs.changed` doorbell through Mango's existing durable realtime connection. The doorbell carries no tree data, grants no access, immediately refetches only expanded visible branches, discards loaded collapsed branches, and leaves never-opened branches request-free.
RT40 - Loading Mango performs zero RACI Tabs recalculations. Startup may read prepared rows only after the user opens a role.
RT41 - Opening a role or folder performs only its bounded read of prepared `raci_tabs_items` and `raci_tabs_folders` rows. No RACI Tabs GET creates defaults, repairs projection rows, starts a transaction, or recalculates RACI.
RT42 - Every ordinary RACI input mutation identifies the exact Logic Gate, Explorer folder subtree, or group-assigned resources whose effective RACI could change. The canonical schema has no ordinary company-wide RACI Tabs synchronization function or trigger.
RT43 - Home's My Processes list is derived only from the user's current effective Logic Gate RACI. Users cannot add manual shortcuts, and no shortcut API or shortcut table participates.

## Process Story: Effective Logic Gate RACI appears in a lazy personal tree

A user or group gains an effective Responsible, Accountable, Consulted, or Informed role on a Logic Gate
↓
The canonical pointer policy remains authoritative while the same committed command copies one root RACI Tabs item for each affected effective user
↓
Mango starts with all four Tower tabs collapsed and sends no RACI Tabs content request until the user opens one role
↓
Opening that role freshly loads only its root page, and opening a folder freshly loads only that folder's direct children while recursive status totals remain visible
↓
The user selects and drags Logic Gate items through nested personal folders without changing the Logic Gate, its RACI, its permission, Company Explorer, or Pins

Last updated: 2026-08-28

## Scenarios

### Scenario RT-S1: Individual, group, and inherited assignments synchronize copied items

Business logic covered:
- RT7 through RT24
- RT38

Given:
- Alice receives a direct Responsible assignment on one Logic Gate.
- A nested group with twenty effective members receives a Consulted assignment on another Logic Gate.
- A parent-policy change affects many inherited Logic Gates, and one affected user already reaches a higher role.
- A later role removal, role change, group-membership change, Logic Gate rename, and Logic Gate deletion occur.

Expected:
- Alice receives one Responsible root item.
- Each of the twenty effective group members receives one item for the group-backed Logic Gate.
- Every inherited effect is copied despite the accepted bulk-write cost, while canonical group and inherited RACI remain pointers.
- Each user has at most one item per Logic Gate, using the deterministic winning role.
- Removed effective users lose their items; a winning-role change moves the item to the new role root.
- Rename updates copied names, deletion removes copied items, and no copied row grants RACI or permission.
- Every synchronization commits or rolls back with the business command and is safe to retry.
- Each relevant commit sends only a compact `raci_tabs.changed` doorbell to current company members; expanded branches refresh and closed branches wait for their next expansion.

### Scenario RT-S2: Tabs and personal folders load and move only what the user opens

Business logic covered:
- RT1 through RT6
- RT10 through RT15
- RT25 through RT32
- RT38 through RT39

Given:
- A user starts Mango with root items, three root folders, and several nested folders in multiple role tabs.
- The user opens Responsible, later opens one Responsible folder, selects rows with plain, Shift, and Ctrl/Command clicks, and drags the selection.
- The user moves and deletes a folder, then collapses and reopens Responsible.

Expected:
- All four tabs initially remain collapsed and send no content or count request.
- Opening Responsible loads only its bounded root page; opening one folder loads only that folder's direct page.
- Unopened roles and folders remain unloaded, while returned folder rows still show `has_children` and recursive totals.
- Moving into an unopened folder updates the existing item or folder row without preloading the destination; opening that destination later performs a fresh GET. An already-expanded destination refreshes immediately after the move.
- Selection and item-batch drag follow the visible loaded order; folders move one subtree at a time.
- Invalid cross-owner, cross-role, or cyclic moves commit nothing.
- Folder deletion preserves every Logic Gate item by returning contained items to the role root.
- Collapsing discards that branch's rows, every reopening performs a fresh exact-branch GET, and no organization action changes RACI, permission, Pins, or Company Explorer.
- A RACI Tabs doorbell refetches only expanded visible branches; collapsed and never-opened branches make no immediate request.

### Scenario RT-S3: Logic Gate, folder, and role totals keep Pin alignment

Business logic covered:
- RT31 through RT37

Given:
- A loaded role contains root Logic Gates and nested folders whose Logic Gates have Nodes in Request, Pending, In Progress, Review, Backlog, and Done.
- Some descendant folders are collapsed or have never been loaded.
- A committed local or subscribed board change affects one loaded Logic Gate.

Expected:
- Logic Gate rows show only nonzero Request, Pending, In Progress, and Review squares in the exact Pin order, size, and colors.
- Empty fixed slots preserve vertical alignment across root and nested rows.
- Every folder and the loaded role root show complete recursive totals even when descendant rows are unloaded or collapsed.
- Backlog and Done never contribute.
- The affected loaded Logic Gate and its loaded totals refresh without writing any RACI Tabs organization or assignment data.
