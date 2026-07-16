Last updated: 2026-07-13

# Pin Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (backend lifecycle, permission-edge coverage, canonical pins table audit, frontend DB-backed API/no-cache coverage, and frontend pin drop helper coverage exists; `tests/frontend/app/timelineState.test.ts` covers PIN29 local pin-title reconciliation and stale persisted-response overlay; frontend menu and browser DOM drag behavior still needs mapped automation)

## Business Logic

PIN1 - Pins are stored in the database, scoped by company and user, not browser cache.
PIN2 - The canonical database table is pins; a pin row has a single primary key pin ID plus company ID, user ID, resource type, resource ID, name, position, and created timestamp.
PIN3 - Supported pinned resource types are node, logic gate, and project.
PIN4 - Creating a pin requires company access and current edit access to the target resource.
PIN5 - The pin name is a snapshot resolved from the server resource name or title at pin time.
PIN6 - A user can only have one pin for the same company, resource type, and resource ID.
PIN7 - Listing pins reads the user's company pins directly from the pins table and does not join to live resource tables.
PIN8 - Listing pins does not hide stale, deleted, renamed, or no-longer-permitted resources.
PIN9 - Opening a pin uses the normal resource route, so missing permission is handled by the destination view with a permission denial.
PIN10 - Unpin deletes only the current user's pin in the current company.
PIN11 - Pin order is persisted in the database and can be changed by dragging pins within the pin section.
PIN12 - Resource right-click menus put Open in new browser tab first and Pin second for pinnable resources.
PIN13 - Pinned-resource right-click menus put Open in new browser tab first and Unpin second.
PIN14 - The sidebar pin section must not read, write, hydrate, or recover pins from browser storage.
PIN15 - The only frontend pin API surface is /v1/user-pins, /v1/user-pins/{pin_id}, and /v1/user-pins/order; legacy /v1/pins, pinsApi, SIDEBAR_PINS_KEY, label, and addedAt pin compatibility are not allowed.
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
