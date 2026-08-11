# Process Story: Pins and folders lift without covering their corner marks

A user scans root pins, expanded folders, and nested folders in the Pinned surface
↓
Every Request, Pending, In Progress, and Review square occupies the same fixed-width column whether its value has one digit, two digits, or comes from a folder total
↓
Pointing to an ordinary pin lifts that row, while pointing anywhere inside a folder lifts the complete folder frame and all of its visible contents
↓
Each folder is marked only by four small matching L-shaped corners; no full top, bottom, left, or right edge is drawn, and clicking its title never adds a gray focus rectangle
↓
In Progress uses exact opaque `rgba(254, 155, 70)` orange, while Review uses the Node icon's exact teal-to-blue vertical gradient

Last updated: 2026-08-07

# Process Story: A deliberate pin hover previews a folder before release

A user drags one existing pinned resource row over the middle of another existing pinned resource row
↓
For the first second nothing reorganizes or saves; after one continuous second over that exact target, Pinned locally previews an expanded New Folder with the target first and dragged pin second
↓
Moving away, switching to an edge zone, or ending the drag immediately removes the preview and restores both rows without sending a grouping command
↓
Only releasing the mouse while that exact preview remains armed sends the existing atomic group command
↓
The committed New Folder takes the target's parent and position, expands, and enters explicit inline rename without changing either resource's typed identity, access, or underlying data

Last updated: 2026-08-07

# Process Story: Pinned folders move reliably with Company Explorer headers

A user reaches the Pinned surface above Tower and organizes a mixed tree of personal folders and resource pins
↓
Each folder shows the Company Explorer folder icon beside its name; clicking either the disclosure or the name expands and collapses it, while only right-click Rename starts the inline name editor
↓
Each folder's accumulated Logic Gate totals share that same title row and interrupt the top hairline before the line resumes to their right
↓
When a drag starts, the exact nested row owns and retains its typed folder-or-pin entry without a draggable ancestor replacing it; the middle of a folder moves it inside, row edges place it before or after, and the root end zone brings it out of any parent even when the browser withholds custom drop data
↓
The canonical mixed sibling order saves without changing the pinned resource, folder owner, access, or typed identity

Last updated: 2026-08-07

# Process Story: Pinned Logic Gate status counts stay live through nested folders

A user opens the sidebar Pinned section with one or more pinned Logic Gates
↓
Mango reads each distinct visible Logic Gate's canonical work view and counts assigned Nodes in Request, Pending, In Progress, and Review
↓
Each Logic Gate row shows only its nonzero status squares: bright futuristic yellow for Request, a very light gray gradient for Pending, Kanban orange for In Progress, and the Node icon's cyan-to-blue gradient for Review
↓
Every containing pin folder adds the four counts from its direct and nested pinned Logic Gates, so a collapsed parent still shows the complete recursive totals
↓
Committed same-window Kanban changes and subscribed board real-time changes refresh only the affected pinned Logic Gate, then the folder totals recalculate without changing pins or relationships
↓
Zero counts, Backlogs, Done, Nodes, Projects, inaccessible stale pins, and folders without nonzero tracked work add no square

Last updated: 2026-08-06

# Process Story: Pinned uses one elevated surface with open-sided nested folder outlines

A user opens the left sidebar Pinned section
↓
One subtly elevated Pinned surface separates the personal tree from the sidebar beneath it, while individual pins and folder regions remain flat
↓
Each folder keeps compact top and bottom hairlines with short downward and upward corner returns, no continuous left or right edge, and an indented title that interrupts the top line after a short leading segment
↓
The folder's right-click Rename action alone starts inline rename, its separate disclosure control expands or collapses it, and dragging the folder or any pin uses the visible header's edge and middle drop zones at arbitrary depth
↓
A pinned resource row has no permanent colored frame and uses the same brief neutral lift as triage and Kanban cards when the user points to, focuses, or opens it; fixed status slots and the X column stay aligned across folder depths, and pointing to or keyboard-focusing an X turns it bright red
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

A user with edit access pins an existing Node, Logic Gate, Huddle Logic Gate, Huddle Node, or Project
↓
Mango stores one user-and-company-scoped pin containing the resource's exact canonical type and ID
↓
The user may create personal folders, nest folders, and move folders and pins through one mixed ordered tree
↓
Dropping one existing pinned row onto another existing pinned row atomically creates a New Folder at the target's location and places target first and dragged pin second
↓
Opening a pinned Node fills the workspace to the right of the left sidebar, while the sidebar stays visible and interactive
↓
Deleting a pin folder deletes only that folder subtree and its contained pin rows; underlying Nodes, Logic Gates, Huddle Logic Gates, Huddle Nodes, and Projects remain unchanged

Last updated: 2026-08-10

# Pin Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (backend nested-folder lifecycle, atomic grouping, owner and cycle rejection, permission-edge coverage, canonical schema audit, frontend flat and recursive tree planning, subtree removal, DB-backed API/no-cache behavior, internal-drag precedence and retained drop identity, one-second pin-group preview/cancel/drop-only commitment, right-of-sidebar pinned-Node launch, Pinned DOM presentation/explicit context-menu rename/click-to-toggle folder headers/four corner-only marks/pin-row and folder hover lift/exact fixed-width status columns coverage, and exact Logic Gate status counts, exact orange and Node-icon Review colors, zero suppression, recursive folder totals, and live refresh coverage exist; `tests/frontend/app/timelineState.test.ts` covers PIN29 local pin-title reconciliation and stale persisted-response overlay; full browser pointer drag choreography still needs mapped automation)

## Business Logic

PIN1 - Pins are stored in the database, scoped by company and user, not browser cache.
PIN2 - The canonical resource-pin table is pins; a pin row has a single primary key pin ID plus company ID, user ID, optional parent folder ID, resource type, resource ID, name, position, and created timestamp.
PIN3 - Supported pinned resource types are node, logic gate, huddle logic gate, huddle node, and project.
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
PIN17 - Only pinned nodes and pinned normal logic gates are valid email drop targets; pinned Huddle Logic Gates, pinned Huddle Nodes, pinned projects, and empty pin-section space are not email drop targets.
PIN18 - Dropping triage or shared-triage email on a pinned logic gate uses the existing communications conversion path to create node(s) in that logic gate, including the normal priority, permission, RACI, local cache patching, and event behavior.
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
PIN32 - Holding an existing pinned row over the middle of another existing pinned row for one continuous second arms grouping. Releasing while that exact target remains armed atomically creates New Folder in the target's current parent, at the target's current position, with the target at position 1000 and dragged pin at position 2000. Releasing before the delay does not group.
PIN33 - Pin-on-pin grouping follows the target when pins start in different folders. The dragged pin moves from its old parent; the one-pin-per-user/company/resource rule still prevents duplicates.
PIN34 - Deleting a pin folder deletes its descendant folders and contained pin rows only. It never deletes, recycles, or changes the underlying Node, Logic Gate, or Project.
PIN35 - Moving a folder into itself or one of its descendants is rejected atomically. Every move, reorder, and grouping command rejects cross-company and cross-user entry IDs.
PIN36 - Creating a pin folder, nested folder, renaming a folder, and deleting a folder are personal organization actions that require company membership but do not grant or change access to pinned resources.
PIN37 - Expanded Pinned folder IDs and inline-rename state live only in current React session state and are never stored in browser storage.
PIN38 - Internal pinned-row drag identity takes precedence over email and external Node drag payloads. Pin-on-pin grouping must not invoke email conversion or Node-to-Logic-Gate assignment.
PIN39 - The middle of a folder is an inside drop; row edges are before/after drops. External supported resources may create or move a pin into a folder or sibling location, but an arbitrary unpinned resource dropped on a pin does not auto-create a folder.
PIN40 - Opening a Node from the Pinned section starts a fresh popup that fills every viewport pixel to the right of the primary left sidebar and its resize handle. The sidebar remains visible, pointer-interactive, and keyboard-focusable. The full-screen control keeps that exact Node popup mounted and visible while expanding it across the full viewport with the standard full-screen geometry, and leaving full screen restores the right-of-sidebar layout. Opening that Node from other routes, the dock, Explorer, Home, or another existing source keeps that source's established layout.
PIN41 - A blank Universal picker reads the same complete `/v1/user-pins` tree as the sidebar and renders every supported pin in stored mixed order with folder nesting in one scrollable list.
PIN42 - Universal picker pin rows preserve PIN5-PIN9 snapshot and stale-pin behavior. Opening a reference follows the normal destination route; using a pin as a link target must still pass the business command's current permission and existence checks.
PIN43 - Typed Universal picker search may place matching pins before workspace results and deduplicates the exact `resource_type + resource_id` pair. It never changes pin position, name, folder ownership, or persistence.
PIN44 - The Universal picker does not create recent-use data, browser pin caches, a second pin endpoint, or another database table. `/v1/user-pins` remains the only read source for its blank Pinned section.
PIN45 - The sidebar Pinned tree is one subtly elevated surface. Folder regions, subfolder regions, and ordinary pin rows do not have permanent colored frames or independent resting elevation. Pointing anywhere inside one folder temporarily lifts that complete folder frame and its visible contents; pointing to an ordinary pin row temporarily lifts that row without lifting unrelated rows.
PIN46 - Every Pinned folder shows the standard Company Explorer folder icon immediately left of its title and is marked only by four isolated L-shaped corners. Every corner has a six-pixel horizontal segment and a five-pixel vertical return; the bottom corners mirror the top corners in the proper orientation. No continuous top, bottom, left, or right edge is drawn, all corners remain inset two pixels from the containing row, and every nested folder repeats the treatment.
PIN47 - Single-clicking a Pinned folder title expands or collapses that folder exactly like its disclosure control and never starts inline rename or draws a gray focus rectangle around the title. Double-clicking does not start rename. Only choosing Rename from that folder's right-click menu starts the inline name editor.
PIN48 - Pinned resource rows temporarily lift by two pixels when pointed to, keyboard-focused, or opened, then return to rest. Keyboard focus and valid drag placement may also show their normal interaction indicators without restoring a permanent colored item frame.
PIN49 - Pinned folder corner marks and rows use compact spacing without crowding: the top-left horizontal corner segment stays short, the disclosure arrow sits close to the folder title, and nested indentation remains clear. Request, Pending, In Progress, Review, and X each own one fixed right-side column across every nesting depth; every status square is exactly 17 pixels wide regardless of digit count, and a zero status keeps its column empty rather than shifting another square. Pointing to or keyboard-focusing a pin's X turns the X character and its outline bright red without changing unpin behavior.
PIN50 - A pinned Logic Gate's status counts derive read-only from its canonical Logic Gate work cards: Request counts `requested`, Pending counts `pending`, In Progress counts `in_progress`, and Review counts `review`. Backlog and Done cards are not included in these four counters.
PIN51 - The four counters keep Request, Pending, In Progress, Review order. Request uses `#fffbd1` to `#fff24d` to yellow `#facc15`; Pending uses super-light gray `#ffffff` to `#f1f5f9` to `#d9e0e8`; In Progress is the exact solid opaque color `rgba(254, 155, 70)`; Review uses the Node icon's exact vertical gradient from `#33ddd5` to `#19a8ff`. A counter square contains only its number, and a zero counter renders no square.
PIN52 - Status squares appear on pinned Logic Gate rows only. Pinned Node and Project rows never show Logic Gate work counts, and a Logic Gate with zero in all four tracked statuses keeps the normal row with no status squares.
PIN53 - A pin folder's counters are the per-status sum of every pinned Logic Gate directly inside it and inside all descendant pin folders. Each Logic Gate contributes once to every ancestor folder; collapsed state does not change the total, and moving the pin makes its contribution follow the persisted current parent tree.
PIN54 - Folder status squares follow the same zero suppression as Logic Gate rows. A folder whose direct and nested pins contain no accessible nonzero tracked Logic Gate work shows the normal folder UI without counters; Node pins, Project pins, root-level Logic Gates, inaccessible stale Logic Gates, Backlog, and Done add nothing to that folder.
PIN55 - The sidebar loads each distinct pinned Logic Gate's canonical work view when the pin set or company changes, listens to the existing same-window Kanban-content event and the exact board real-time scope, and reloads only the affected Logic Gate after committed changes. Recalculation writes no pin, folder, relationship, assignment, cache fallback, or browser storage record, and a failed or forbidden work read clears that gate's displayed contribution without hiding its pin.
PIN56 - The Pinned surface renders above Tower in the left sidebar. Moving that surface changes no persisted pin or Tower data.
PIN57 - A Pinned folder's drag hitbox is its visible header, not the expanded descendant frame. The header middle is an inside drop; its top and bottom edges are before and after drops in the folder's parent; and the Pinned root end zone reparents an entry to root. A nested row's drag start must not bubble into and replace its typed identity with a draggable ancestor folder. Pinned retains that exact internal entry through drop, as Company Explorer retains its active drag payload, so a browser withholding custom `DataTransfer` content at release cannot turn a displayed valid target into a no-op. These zones allow pins and folders to reorder, move into a folder, move between folders, or come out of any parent while the cycle and owner rules remain enforced.
PIN58 - After the one-second middle hover in PIN32, Pinned shows a current-session-only expanded New Folder preview at the target row, with the target first and dragged pin second. The dragged row temporarily appears only in that preview. No API, database, pin, or folder change occurs until drop. Leaving that target, entering a non-middle zone, or ending the drag cancels the timer and preview immediately and sends no grouping command; only dropping the exact dragged pin on the exact armed target may invoke the atomic group command.
PIN59 - Opening a `huddle_logic_gate` or `huddle_node` pin opens the exact matching Huddle surface. Huddle pins use the normal personal pin lifecycle but do not become email or Node drop targets and do not contribute normal Logic Gate Kanban status counts.

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
- Permission, RACI assignment, local cache patching, and event behavior come from the existing conversion and assignment paths rather than a pin-specific backend shortcut.

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
- PIN58

Given:
- A dragged pin and target pin may start at root, in the same folder, or in different folders.
- A drag payload may also contain the resource MIME used by older pin drop actions.

Expected:
- The internal pin drag wins.
- Releasing before one continuous second over the target does not group the pins.
- After one continuous second over the target middle, Pinned previews an expanded New Folder with target first and dragged pin second without sending a command.
- Moving away, entering an edge zone, or ending the drag removes the preview, restores both original rows, and sends no command.
- Releasing only while the exact preview is armed invokes grouping; custom drag data may be absent at release because the retained internal identity remains authoritative.
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

### Scenario PIN-S11: Pinned Node Fills The Workspace Beside The Sidebar

Business logic covered:
- PIN9
- PIN40

Given:
- A Node popup was previously used windowed.
- The user opens a Node from Pinned and later opens the same Node from another source.

Expected:
- The Pinned launch uses a fresh popup instance and fills the viewport from the sidebar resize handle to the right edge and from the top edge to the bottom edge.
- The left sidebar remains visible and usable while this layout is open.
- Full screen keeps the same Node visible across the full viewport instead of exposing the page underneath; toggling it off restores the right-of-sidebar layout.
- The non-Pinned launch keeps its established layout.

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

### Scenario PIN-S13: Elevated Pinned Surface And Corner-Marked Folder Hierarchy

Business logic covered:
- PIN45
- PIN46
- PIN47
- PIN48
- PIN49
- PIN56
- PIN57

Given:
- The user's Pinned tree contains root pins, a folder, a nested folder, and pins inside both folder depths.

Expected:
- The whole Pinned section is one elevated surface, while pin rows and folder regions have no independent resting elevation.
- Normal pin rows have no permanent colored frame and lift by two pixels when pointed to, keyboard-focused, or opened.
- Pointing anywhere inside a folder or subfolder lifts that complete folder frame and all visible contents by two pixels until the pointer leaves it.
- Folder and subfolder boundaries use only four inset L-shaped corner marks, each with a six-pixel horizontal segment and a five-pixel vertical return; they have no continuous edge on any side.
- Each compact folder title starts after the short top-left corner, shows the Company Explorer folder icon immediately before its name, and keeps its disclosure arrow close; nested folder content and titles remain visibly indented from their parent.
- A folder's nonzero accumulated status squares sit on the same horizontal row as its title and remain aligned with the pin-row status columns.
- Pinned renders before Tower, and the four exact 17-pixel status boxes plus X remain in fixed right-side columns regardless of nesting, digit count, or zero counts.
- Pointing to or keyboard-focusing a pin's X turns both the character and its outline bright red.
- Clicking or focusing a folder title never draws a gray rectangle. Clicking the title or its disclosure expands or collapses it without renaming; double-clicking still does not rename it, and right-clicking that folder and choosing Rename starts the inline editor.
- The visible folder header, not its expanded subtree, owns the middle/edge drop zones. The exact nested row owns drag start without an ancestor folder overwriting its identity, and Pinned retains that typed moving entry until release. Dragging pins or folders through those zones or the root end zone therefore reorders and reparents the canonical tree—including moves into, out of, and between nested folders—even when custom drop data is unavailable at release.
- No pin identity, folder ownership, deletion behavior, endpoint, database table, or database row contract changes.

### Scenario PIN-S14: Live Pinned Logic Gate Counts And Recursive Folder Totals

Business logic covered:
- PIN50
- PIN51
- PIN52
- PIN53
- PIN54
- PIN55

Given:
- An outer pin folder contains one pinned Logic Gate and an inner folder whose pinned Logic Gates have Nodes in Request, Pending, In Progress, Review, Backlog, and Done.
- The same tree also contains Node and Project pins, a zero-work Logic Gate, and an inaccessible stale Logic Gate.
- A committed Node assignment, removal, or status move changes one pinned Logic Gate locally or through its board real-time scope.

Expected:
- Each Logic Gate row shows only nonzero Request, Pending, In Progress, and Review number squares in bright yellow, super-light gray, exact `rgba(254, 155, 70)` orange, and the Node icon's teal-to-blue vertical gradient order.
- Backlog, Done, Node pins, Project pins, zero-work Logic Gates, and inaccessible stale Logic Gates show or contribute no status square.
- The inner folder sums its direct and nested Logic Gates, and the outer folder adds that complete inner total to its direct Logic Gate totals even while either folder is collapsed.
- Moving a Logic Gate pin to another folder makes subsequent totals follow the current pin tree without changing the Logic Gate assignment.
- The committed same-window event or exact board real-time message reloads only the affected pinned Logic Gate and immediately recalculates every ancestor folder.
- No pin API write, browser storage fallback, relationship copy, translated resource identity, or database/schema change is introduced.
