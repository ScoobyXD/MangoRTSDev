# Process Story: Pinned uses one elevated surface with thin nested folder outlines

A user opens the left sidebar Pinned section
↓
One subtly elevated Pinned surface separates the personal tree from the sidebar beneath it, while individual pins and folder regions remain flat
↓
Each folder uses a hairline neutral outline whose indented title interrupts the top line after a short leading segment; nested folders repeat that outline with progressively indented content and no folder icon
↓
A single click on a folder title starts inline rename, its separate disclosure control expands or collapses it, and dragging the folder or any pin keeps the existing mixed-order reparenting behavior at arbitrary depth
↓
A pinned resource row has no permanent colored frame and uses the same brief neutral lift as triage and Kanban cards when the user points to, focuses, or opens it
↓
All organization, ownership, ordering, deletion, resource identity, API, and database rules remain unchanged

Last updated: 2026-08-06

# Process Story: The universal picker starts with the user's Pinned tree

A user types `#` in a Node, Logic Gate, or Project editor
↓
The shared universal picker reads the same complete company-and-user-scoped `/v1/user-pins` tree used by the sidebar
↓
With no search text, folders and pins retain their stored mixed order and nested indentation in one scrollable Pinned list
↓
The list follows the existing pin snapshot rules, including saved names and stale pins; selecting a stale link target still fails through the normal destination relationship command
↓
Typing a query switches to permission-filtered workspace search, with matching pins placed first and duplicate typed resources removed
↓
No recent-use record, browser cache, second pin store, or database migration is created

Last updated: 2026-08-05

# Process Story: A user organizes personal pins into a nested tree

A user with edit access pins an existing Node, Logic Gate, or Project
↓
Mango stores one user-and-company-scoped pin containing the resource's exact canonical type and ID
↓
The user may create personal folders, nest folders, and move folders and pins through one mixed ordered tree
↓
Dropping one existing pinned row onto another existing pinned row atomically creates a New Folder at the target's location and places target first and dragged pin second
↓
Opening a pinned Node starts the Node popup fullscreen, while other Node launch sources keep their normal windowed behavior
↓
Deleting a pin folder deletes only that folder subtree and its contained pin rows; underlying Nodes, Logic Gates, and Projects remain unchanged

Last updated: 2026-08-05

# Pin Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (backend nested-folder lifecycle, atomic grouping, owner and cycle rejection, permission-edge coverage, canonical schema audit, frontend flat and recursive tree planning, subtree removal, DB-backed API/no-cache behavior, internal-drag precedence, fullscreen pinned-Node launch, and Pinned DOM presentation/one-click rename/lift coverage exist; `tests/frontend/app/timelineState.test.ts` covers PIN29 local pin-title reconciliation and stale persisted-response overlay; frontend right-click menu and browser DOM drag choreography still needs mapped automation)

## Business Logic

PIN1 - Pins are stored in the database, scoped by company and user, not browser cache.
PIN2 - The canonical resource-pin table is pins; a pin row has a single primary key pin ID plus company ID, user ID, optional parent folder ID, resource type, resource ID, name, position, and created timestamp.
PIN3 - Supported pinned resource types are node, logic gate, and project.
PIN4 - Creating a pin requires company access and current edit access to the target resource.
PIN5 - The pin name is a snapshot resolved from the server resource name or title at pin time.
PIN6 - A user can only have one pin for the same company, resource type, and resource ID.
PIN7 - Listing pins reads the user's company pins directly from the pins table and does not join to live resource tables.
PIN8 - Listing pins does not hide stale, deleted, renamed, or no-longer-permitted resources.
PIN9 - Opening a pin uses the normal resource route, so missing permission is handled by the destination view with a permission denial.
PIN10 - Unpin deletes only the current user's pin in the current company.
PIN11 - Folder and pin sibling order is persisted in the database and can be changed by dragging rows within the Pinned section.
PIN12 - Resource right-click menus put Open in new browser tab first and Pin second for pinnable resources.
PIN13 - Pinned-resource right-click menus put Open in new browser tab first and Unpin second.
PIN14 - The sidebar pin section must not read, write, hydrate, or recover pins from browser storage.
PIN15 - The canonical frontend pin API surface is /v1/user-pins, /v1/user-pins/{pin_id}, /v1/user-pins/layout, /v1/user-pin-folders, /v1/user-pin-folders/{folder_id}, and /v1/user-pin-folders/group. Legacy /v1/pins, /v1/user-pins/order, pinsApi, SIDEBAR_PINS_KEY, label, and addedAt compatibility are not allowed.
PIN16 - The user_pins table is not canonical and must be dropped; backend storage reads and writes the pins table.
PIN17 - Only pinned nodes and pinned logic gates are valid email drop targets; pinned projects and empty pin-section space are not email drop targets.
PIN18 - Dropping triage or shared-triage email on a pinned logic gate uses the existing communications conversion path to create node(s) in that logic gate, including the normal priority, permission, GVIC, local cache patching, and event behavior.
PIN19 - Dropping triage or shared-triage email on a pinned node attaches the email to that existing node through the existing node conversion path and must not create a duplicate node.
PIN20 - Dropping a node on a pinned logic gate assigns the existing node to that logic gate through the normal logic-gate node assignment path and must not duplicate the node.
PIN21 - Valid pinned email/node drop targets are recognized during dragover from drag MIME types alone; full payload parsing happens only on drop so browser dragover data restrictions do not show a stop cursor over valid pinned nodes or logic gates.
PIN22 - Successful pinned email/node drops show a short green confirmation banner in the pin section and then clear automatically.
PIN23 - Successful pinned email conversion is applied once from the committed response to the visible Home triage list and local message caches. It does not depend on a broad conversion/workspace realtime echo, and My Triage/Shared Triage do not refresh repeatedly for the same drop; a later exact-mailbox provider update remains independently eligible for canonical reconciliation.
PIN24 - Pinned email conversion preserves one exact drag mailbox key through the communications conversion request and Home result event: My Triage sends normalized `account_email`; Shared Triage sends `shared_inbox_id` and suppresses any personal account parameter.
PIN25 - Successful pinned email conversion updates Home from the committed response without publishing a workspace browser event or repeatedly reloading the workspace panel.
PIN26 - Successful pinned or Explorer email conversion must keep converted source email rows visible and must not trigger row removal, post-removal fill, message-length prefetch, or stale prefetched-page top-up for those rows.
PIN27 - Successful pinned email conversion must set source emails to unstarred through the source mailbox scope, return `unstarred_message_ids`, and reconcile Home locally without blanking, refilling, or repeatedly reloading My Triage or Shared Triage.
PIN28 - Pinned-node and pinned-Logic-Gate email conversions persist mailbox provenance in the resulting attached-email projection: personal mail stores `account_email`, and Shared Triage mail stores both `shared_inbox_id` and `account_email` for later scoped reads and mutations.
PIN29 - After a successful same-window Node or Logic Gate rename, the visible matching sidebar pin name converges from the concrete committed-title event. This is a local label patch only: project pins are unaffected, no pin HTTP write occurs, and the durable pin-name snapshot/listing rules remain unchanged.
PIN30 - The canonical personal folder table is pin_folders. Every folder belongs to one company membership and one user, may have one owner-scoped parent folder, and may nest to arbitrary depth without cycles.
PIN31 - Folders and pins share one mixed sibling order within each parent. A complete user tree is loaded in one read; Pinned folders do not use Company Explorer lazy loading.
PIN32 - Dropping an existing pinned row onto the middle of another existing pinned row atomically creates New Folder in the target's current parent, at the target's current position, with the target at position 1000 and dragged pin at position 2000.
PIN33 - Pin-on-pin grouping follows the target when pins start in different folders. The dragged pin moves from its old parent; the one-pin-per-user/company/resource rule still prevents duplicates.
PIN34 - Deleting a pin folder deletes its descendant folders and contained pin rows only. It never deletes, recycles, or changes the underlying Node, Logic Gate, or Project.
PIN35 - Moving a folder into itself or one of its descendants is rejected atomically. Every move, reorder, and grouping command rejects cross-company and cross-user entry IDs.
PIN36 - Creating a pin folder, nested folder, renaming a folder, and deleting a folder are personal organization actions that require company membership but do not grant or change access to pinned resources.
PIN37 - Expanded Pinned folder IDs and inline-rename state live only in current React session state and are never stored in browser storage.
PIN38 - Internal pinned-row drag identity takes precedence over email and external Node drag payloads. Pin-on-pin grouping must not invoke email conversion or Node-to-Logic-Gate assignment.
PIN39 - The middle of a folder is an inside drop; row edges are before/after drops. External supported resources may create or move a pin into a folder or sibling location, but an arbitrary unpinned resource dropped on a pin does not auto-create a folder.
PIN40 - Opening a Node from the Pinned section starts a fresh fullscreen Node popup instance. Opening that Node from other routes, the dock, Explorer, Home, or another existing source remains windowed unless that source independently requests fullscreen.
PIN41 - A blank Universal picker reads the same complete `/v1/user-pins` tree as the sidebar and renders every supported pin in stored mixed order with folder nesting in one scrollable list.
PIN42 - Universal picker pin rows preserve PIN5-PIN9 snapshot and stale-pin behavior. Opening a reference follows the normal destination route; using a pin as a link target must still pass the business command's current permission and existence checks.
PIN43 - Typed Universal picker search may place matching pins before workspace results and deduplicates the exact `resource_type + resource_id` pair. It never changes pin position, name, folder ownership, or persistence.
PIN44 - The Universal picker does not create recent-use data, browser pin caches, a second pin endpoint, or another database table. `/v1/user-pins` remains the only read source for its blank Pinned section.
PIN45 - The sidebar Pinned tree is one subtly elevated surface. Folder regions, subfolder regions, and ordinary pin rows are not separate elevated cards and do not have permanent colored frames.
PIN46 - Every Pinned folder uses one hairline neutral outline with no folder icon. Its indented title interrupts the top outline after a short leading horizontal segment, and each nested folder repeats the same treatment with progressively indented content.
PIN47 - A single click on a Pinned folder title starts inline rename while its separate disclosure control expands or collapses the folder. Folder and pin rows remain draggable through the existing mixed-order layout commands, including moving into, out of, and between arbitrary nesting depths.
PIN48 - Pointing to, keyboard-focusing, or opening a pinned resource gives its otherwise flat row a brief neutral two-pixel lift. Keyboard focus and valid drag placement remain temporary interaction indicators and must not restore a permanent colored item frame.

## Scenarios

### Scenario PIN-S1: Create And List Pins

Business logic covered:
- PIN1
- PIN2
- PIN3
- PIN4
- PIN5
- PIN6
- PIN7
- PIN29

Given:
- A user has company access.
- The user can view a node, a logic gate, and a project, pins them, and then successfully renames the Node and Logic Gate in the same window.

Expected:
- The user can pin each supported resource type.
- Each created pin stores company ID, user ID, resource type, resource ID, name, position, and created timestamp.
- Pinning the same resource again does not create a duplicate pin.
- Loading the sidebar pin section reads those pins from the pin table.
- The visible Node and Logic Gate pin names update immediately without changing order/recency or writing the pin row; the project pin and durable snapshot remain unchanged.

### Scenario PIN-S2: Permission Changes After Pinning

Business logic covered:
- PIN4
- PIN8
- PIN9

Given:
- A user pins a resource while they have edit access.
- The user's edit access is later removed.

Expected:
- The pin remains visible in the sidebar pin section.
- Selecting or opening the pin uses the normal resource view.
- The destination view denies access with the normal permission message.
- The user cannot create a new pin for a resource they cannot currently view.

### Scenario PIN-S3: Reorder And Unpin

Business logic covered:
- PIN10
- PIN11

Given:
- A user has multiple pins in the same company.

Expected:
- Dragging pins within the pin section saves the new order in the database.
- Reloading the page preserves the saved order.
- Unpin removes only that pin for the current user and company.

### Scenario PIN-S4: Context Menu Actions

Business logic covered:
- PIN12
- PIN13

Given:
- A user right-clicks a pinnable node, logic gate, or project from Company Explorer, a node surface, board cards, Updates, or My Work.
- A user right-clicks an item in the pin section.

Expected:
- Resource menus show Open in new browser tab as the first action.
- Resource menus show Pin as the second action.
- Pin-section menus show Open in new browser tab as the first action.
- Pin-section menus show Unpin as the second action.

### Scenario PIN-S5: User And Company Isolation

Business logic covered:
- PIN1
- PIN6
- PIN10

Given:
- Two users belong to the same company.
- One user belongs to two companies.

Expected:
- Each user sees only their own pins.
- The same resource can be pinned independently by different users.
- A user's pins in one company do not appear in another company.

### Scenario PIN-S6: No Browser Cache Fallback

Business logic covered:
- PIN1
- PIN7
- PIN14
- PIN15
- PIN16

Given:
- A user pins a resource in the sidebar.
- The browser has any old localStorage or sessionStorage sidebar-pin data.
- The user opens the same account and company in a fresh incognito session.

Expected:
- Creating a pin sends the write to the DB-backed user-pins API.
- The pin is visible only when the user-pins API returns it from the database.
- Old browser storage cannot make a pin appear in the sidebar.
- If the API write fails, the frontend does not persist a UI-only pin in browser storage.
- A fresh incognito session shows the same pins as a normal session after the database row exists.
- DBeaver queries against public.pins show the saved rows, and public.user_pins does not remain as the app's storage table.

### Scenario PIN-S7: Valid Drop Targets For Pinned Nodes And Logic Gates

Business logic covered:
- PIN17
- PIN18
- PIN19
- PIN20
- PIN21
- PIN22
- PIN23
- PIN24
- PIN25
- PIN26
- PIN27
- PIN28

Given:
- A user has pinned a node, a logic gate, and a project.
- The user drags selected email from My Triage or Shared Triage.
- The user drags an existing node from a node-capable surface.

Expected:
- Email over the pinned node and pinned logic gate shows a valid drop target.
- Email over the pinned project or empty pin-section space is not accepted.
- Dragover acceptance uses the triage-email and node drag MIME types without requiring message or node IDs to be readable until drop.
- Dropping email on the pinned logic gate opens the normal priority selection, then creates node(s) in that logic gate through the communications conversion path.
- Dropping email on the pinned node opens the normal priority selection, then attaches the email to that existing node without creating a duplicate node.
- If the email was dragged from Shared Triage, the conversion request includes the source shared inbox ID and uses the shared mailbox conversion path.
- The resulting attached-email projection records the source account email and, for Shared Triage, the shared inbox ID so later thread, attachment, reply, draft, and calendar actions use the originating grant.
- The conversion response includes successfully unstarred IDs in `unstarred_message_ids`, the backend sets those emails to unstarred through the personal or shared mailbox grant, and Home applies the unstar locally while keeping the converted row visible.
- Dropping a node on the pinned logic gate assigns the existing node to the logic gate through the normal assignment endpoint without creating a duplicate node.
- Successful drops show a short green confirmation banner in the pin section.
- The visible Home triage list and workspace panel handle the committed conversion response locally by keeping the source email row visible and patching its Logic Gate icon state without communications cache invalidation, stale prefetched-page top-up, post-removal fill, message-length prefetch, or repeated reloads.
- Permission, GVIC assignment, local cache patching, and event behavior come from the existing conversion and assignment paths rather than a pin-specific backend shortcut.

### Scenario PIN-S8: Nested Folder Tree And Mixed Ordering

Business logic covered:
- PIN11
- PIN15
- PIN30
- PIN31
- PIN35
- PIN36
- PIN37
- PIN39

Given:
- A user has root pins, root folders, nested folders, and pins inside several parents.

Expected:
- The API returns the complete personal folder-and-pin tree.
- Root and nested folder creation use the actor's membership identity, not a request-supplied user ID.
- Folders and pins sort together by position and stable tie breakers.
- Middle-of-folder drops move entries inside; row-edge drops reorder before or after.
- A folder cannot move into itself or a descendant.
- IDs owned by another user or company are rejected without a partial move.
- Reload preserves database layout while expansion remains current-session state only.

### Scenario PIN-S9: Drag One Pin Onto Another

Business logic covered:
- PIN6
- PIN32
- PIN33
- PIN35
- PIN38

Given:
- A dragged pin and target pin may start at root, in the same folder, or in different folders.
- A drag payload may also contain the resource MIME used by older pin drop actions.

Expected:
- The internal pin drag wins.
- One transaction creates New Folder in the target parent at the target position.
- Target is first and dragged pin is second.
- The new folder expands and enters inline rename.
- Different-parent grouping removes the dragged pin from its old parent.
- Failure rolls back the new folder and both moves.
- Email conversion and Node-to-Logic-Gate assignment do not run.

### Scenario PIN-S10: Delete Folder Without Deleting Resources

Business logic covered:
- PIN7
- PIN8
- PIN10
- PIN34

Given:
- A folder contains nested folders and pins whose resources may still exist, be stale, or no longer be permitted.

Expected:
- The user sees a confirmation explaining that contained pin records will be removed.
- Confirming deletes the folder subtree and contained pins.
- Underlying Nodes, Logic Gates, and Projects are not deleted, recycled, renamed, or permission-changed.
- Pins and folders outside the subtree remain.

### Scenario PIN-S11: Pinned Node Opens Fullscreen

Business logic covered:
- PIN9
- PIN40

Given:
- A Node popup was previously used windowed.
- The user opens a Node from Pinned and later opens the same Node from another source.

Expected:
- The Pinned launch uses a fresh popup instance and starts fullscreen.
- Toggling fullscreen off returns to normal popup geometry.
- The non-Pinned launch keeps its established windowed default.

### Scenario PIN-S12: Universal Picker Uses Pinned Instead Of Recents

Business logic covered:
- PIN41
- PIN42
- PIN43
- PIN44

Given:
- The user's Pinned tree contains nested folders, Node, Logic Gate, and Project pins, including a stale saved label.

Expected:
- Typing `#` in a resource editor shows every supported pin in its stored mixed order and nesting without calculating recent usage.
- Typing a query uses permission-filtered workspace search, keeps matching pins first, and removes duplicate typed identities.
- A stale pin remains visible under the pin snapshot contract, while a `##` relationship command still rejects a missing or unauthorized target.
- No pin row, browser cache, recent-use record, API, or schema is added or changed.

### Scenario PIN-S13: Elevated Pinned Surface And Outlined Folder Hierarchy

Business logic covered:
- PIN45
- PIN46
- PIN47
- PIN48

Given:
- The user's Pinned tree contains root pins, a folder, a nested folder, and pins inside both folder depths.

Expected:
- The whole Pinned section is one elevated surface, while pin rows and folder regions are not independently elevated.
- Normal pin rows have no permanent colored frame and briefly lift by two pixels when pointed to, keyboard-focused, or opened.
- Folder and subfolder boundaries are hairline-thin neutral outlines with no folder icons.
- Each folder title starts after a short top-border lead-in, and nested folder content and titles are visibly indented from their parent.
- Clicking a folder title once starts inline rename; its separate disclosure control remains responsible for expand and collapse.
- Dragging pins or folders still reorders and reparents the existing tree through the canonical layout commands, including moves into, out of, and between nested folders.
- No pin identity, folder ownership, deletion behavior, endpoint, database table, or database row contract changes.
