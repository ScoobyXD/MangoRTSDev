Last updated: 2026-07-16

# Updates Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: saved-views API coverage exists for Updates Project, Logic Gate, and Status grouping fields. `tests/frontend/modules/grouping/universalStatusGrouping.test.ts` covers the exact shared status order and Updates wiring. `tests/frontend/pages/home/updatesSelection.test.ts` covers row selection, individual Seen successor/reload decisions, and U74's pure current Logic Gate label and saved grouping-label/sort resolution. `tests/frontend/pages/home/updatesGrouping.test.ts` covers U81's built-in grouping chain, U82's shared GVIC/Priority group-title presentation, U83's initial full expansion with manual-collapse preservation, and the U84/U85 control and sidebar layout contracts. Current Node/Logic Gate mounted row, panel, and open-action wiring is not a mounted behavior test. Other rule IDs are not mapped to automated tests yet.
- Automated Regression Summary: `tests/frontend/pages/home/updatesGrouping.test.ts` also covers U86's unassigned-last priority order and U87's wider title allocation within the unchanged row width.

## Business Logic

U1 - Updates is an event, mention, and notification feed, not the My Work active GVIC workload surface.
U2 - Update groups include unread notifications only.
U3 - Update group filters support all, urgent, mention, and update/update aliases.
U4 - The urgent filter includes urgent mentions only.
U5 - The mention filter includes normal mentions only.
U6 - The update filter excludes normal and urgent mention notifications.
U7 - Notification list, summary, read-state, and delete operations are scoped to the current user and company.
U8 - Mark-all-read operations can be filtered by notification type, surface, role, logic gate, and node.
U9 - An individual notification can be marked read or unread without changing unrelated notifications.
U10 - Deleting one notification removes only that notification for the current user.
U11 - Clearing notifications can be scoped and publishes a cleared notification event.
U12 - Notification summary returns total unread count plus role, type, and logic gate unread counts.
U13 - Update group root responses return group shells without loading all child notifications.
U14 - Update group branch responses require a valid group root ID and return the nested group for that branch.
U15 - Group paths prefer project, then logic gate, then node when all contexts exist.
U16 - Notifications with multiple project contexts appear under each unique project path.
U17 - Notifications without a project, logic gate, or node context fall under the fallback Updates group.
U18 - Update group IDs are stable and use updates/<field>:<id> or updates/update:all shapes.
U19 - Groups sort by project, logic gate, node, then fallback update groups, with labels sorted alphabetically within each type.
U20 - Notifications sort newest first, then by title or ID to keep ordering stable.
U21 - Updates visibility filters out notifications whose project, logic gate, or node is not viewable by the current user.
U22 - Malformed legacy notification IDs are ignored or sanitized before access checks so the feed does not crash.
U23 - One app-lifetime notification coordinator owns `notifications:user:{user_id}`. Every first or reconnect `subscription.accepted` performs one coalesced canonical notification-summary reconciliation; a later local handler joining an already accepted shared scope receives immediate acceptance, and created/deleted/cleared hints use the same coalescer to update urgent `!`, normal `@`, and regular unread badges.
U24 - Updates registers with the notification coordinator only while open. First/reconnect subscription acceptance reconciles notification summary only and does not reload the feed. External notification-created/deleted/cleared hints run one canonical feed load at a time with at most one queued final load; they never overlap or restart a slow load and cause no feed request while closed. HTTP-first local Seen keeps its existing optimistic no-reload behavior.
U25 - Updates saved grouping views persist Project, Logic Gate, and Status grouping fields through the saved-views API.
U26 - The update trigger canon is limited to the rules in U27 through U49; adding a new update trigger requires updating this file.
U27 - Adding a node to a Logic Gate creates an update, whether the node is created directly, an existing node is assigned, or an email is converted into a node in that Logic Gate.
U28 - Moving a node from one Logic Gate status or state to another creates an update.
U29 - The screen or API entry point does not create a separate update category: Logic Gate Work, GVIC Matrix, Kanban, and Home actions are classified by the semantic action they perform.
U30 - A normal @ mention in a node text box creates a mention update for the mentioned user.
U31 - An urgent ! mention in a node text box creates an urgent mention update for the mentioned user.
U32 - A normal @ mention in node chat creates a mention update for the mentioned user.
U33 - An urgent ! mention in node chat creates an urgent mention update for the mentioned user.
U34 - Any new node chat message creates a chat-message update even when it contains no @ mention or ! mention.
U35 - A normal @ mention in the Logic Gate text editor creates a mention update for the mentioned user.
U36 - An urgent ! mention in the Logic Gate text editor creates an urgent mention update for the mentioned user.
U37 - Logic Gates do not have a chat surface for Updates purposes; only the Logic Gate text editor can create Logic Gate mention updates.
U38 - Attaching an email directly to a node creates an attached-email update.
U39 - Dropping or merging an email-node card onto an existing node creates the same attached-email update as a direct node email attachment.
U40 - Removing a node from a Logic Gate creates an update.
U41 - Deleting a node creates an update.
U42 - GVIC assignment changes on update-relevant nodes or Logic Gates create updates.
U43 - Permission or access changes on update-relevant nodes or Logic Gates create updates.
U44 - Node field changes create updates only for work-relevant field changes such as status, due date, priority, and similar non-name work fields.
U45 - Rename-only changes do not create updates, including node renames, Logic Gate renames, and project renames.
U46 - Logic Gate issue-flag changes do not create updates; the issue-flag feature is not part of the Updates trigger canon.
U47 - Project-level notifications are not part of the Updates trigger canon yet, including project create, delete, rename, GVIC, and permission changes.
U48 - Shared triage and shared inbox GVIC assignment changes create updates.
U49 - Shared triage and shared inbox permission or access changes create updates.
U50 - Update row copy keeps the actor first, the specific verb second, and the primary non-Logic-Gate object named where one exists. Individual update rows do not render a Logic Gate icon, label, or trailing Logic Gate context.
U51 - Logic Gate IDs and labels remain available for grouping, filtering, resource opening, sorting, and navigation, but are not repeated inside individual Updates row copy. Node rows still name the node; a direct Logic Gate notification uses concise action copy without a per-row Logic Gate chip or label.
U52 - Update row tone is determined by update type: urgent mentions reserve red with a ! marker, normal mentions reserve orange with an @ marker, new/added/appended actions use blue, changed/updated actions use purple, and deleted/removed actions use dark mellow red.
U53 - Mention tones override other row tones for the notification sent to the mentioned user: urgent ! mention is highest priority, then normal @ mention, then the underlying chat, editor, field, or attachment action.
U54 - Status and priority values shown inside update rows must reuse the same shared visual tokens as node status and node priority controls; Updates must not hardcode separate status or priority colors, fonts, icons, or pill styles.
U55 - Entity icons shown inside update rows must come from a shared app icon registry or equivalent shared token source for nodes, emails, folders, projects, and future reusable entities; Updates must not define local copies of those icons. Logic Gate icons remain shared for grouping headers and other resource surfaces, but U51 excludes them from individual row copy.
U56 - Assignment and permission tones follow the exact action subtype: newly assigned, newly granted, or newly attached uses blue; changed or updated uses purple; removed or revoked uses dark mellow red.
U57 - The canonical row wording in the Update Row Copy table is the source of truth for update display text; changing row wording requires updating this file.
U58 - A mention inserted in a node text editor or Logic Gate text editor becomes a committed inline mention chip when the user selects the mention target; later typing near that chip must edit surrounding text, not mutate the committed mention target.
U59 - Text editor mention notifications are idempotent per committed mention occurrence, mention kind, mentioned user, entity, and information block; autosaves or later character edits around an existing committed mention must not send duplicate mention notifications.
U60 - If a user adds a new committed mention occurrence to the same information block later, that new occurrence can create one new mention notification.
U61 - Seeing a single update removes that notification from Updates for the current user; it must not reappear on refresh as a merely read row.
U62 - The Updates header has a Seen all action that asks for confirmation before removing all current-user Updates notifications in the current company.
U63 - Updates rows support Company Explorer-style multi-selection: normal click selects one row and activates it, Ctrl-click or Command-click toggles one row, and Shift-click additively selects the visible range from the selection anchor.
U64 - Right-clicking an Updates row opens an Updates context menu with seen actions for the selected rows and for all rows; destructive multi-row seen actions ask for confirmation before removing notifications.
U65 - Text editor mention row previews show the text block containing the specific new @ or ! mention occurrence; older mention blocks or unrelated editor text in the same saved document must not appear in that new row preview.
U66 - Seeing an individual update hides that row locally without reloading the whole Updates feed; the list must not blink away and come back for the current user's own Seen action.
U67 - Updates saved grouping view rows render under the Updates entry in the Key Views sidebar, not in the Updates header. + Add new opens the floating grouping editor for a new saved grouping view without navigating the main content area to Updates. Existing views expose Edit, Rename, and Delete commands, and view rows reorder by drag. Updates may have zero saved grouping rows.
U68 - Activating an Updates row that opens the node preview panel keeps keyboard focus on the Updates row list; Up and Down arrow keys continue moving through visible rows across grouping boundaries instead of moving the caret inside the node editor.
U69 - The Home sidebar Updates tab shows separate live unread badges for urgent ! mentions, normal @ mentions, and non-mention update notifications using notification summary counts: urgent comes from `mention.urgent_created`, @ comes from `mention.created`, and regular updates come from total unread minus those mention counts. These badges are display state only, not a second notification source of truth, and must increment or decrement after notification-created, Seen, and Seen all reconciliation.
U70 - Attachment-related update rows may reference attachment IDs, email IDs, node IDs, and preview metadata, but Updates payloads must not carry file bytes, data URLs, base64 blobs, or S3 object contents.
U71 - Seeing an individual update removes the clicked row, then automatically selects, focuses, and activates the next remaining visible row below. When that successor references a node/information target, Updates immediately opens/highlights that successor in the right-hand node preview; repeated Seen therefore advances both the list cursor and preview together. If no row remains below, Updates clears the list selection without jumping upward and retains the clicked row's node preview as the bottom-of-list fallback.
U72 - Updates Status grouping consumes the shared universal status contract also used by My Work and Project Logic Gates / Nodes. A real status carried by a status-bearing notification is authoritative for that event row; arbitrary comment/mention prose and backend placeholders such as `a new status` or `a new state` are never status values. When no real event status exists, Updates falls back to the currently resolved node status, then the distinct No status group. Ascending recognized order is In Progress, Review, Pending, Requested, Backlog, Done. Verify aliases normalize to Review, Request/Requests normalize to Requested, Backlogs/Back Logs/Backlogged normalize to Backlog, and completed/closed/archived aliases normalize to Done. Descending reverses recognized nonterminal groups while Done remains final; unknown nonblank statuses and No status remain before Done.
U73 - A pending local notification delete/clear marker tracks whether HTTP and socket observers have claimed it. HTTP-first success emits once with its local optimistic source and a matching socket echo emits nothing; after both observers claim, the marker is removed so a distinct later clear is not suppressed. Socket-first commit emits once with a canonical non-local source so mounted Updates fetches even if the HTTP response is lost/rejected; duplicate socket frames remain suppressed while that lost response is pending. A failed HTTP request with no socket emits no update and releases its marker.
U74 - A successful same-window Node or Logic Gate rename creates no notification under U45 and never rewrites the historical `NotificationItem.title` or `body_preview`. Mounted Updates resolves the current Node label from Home's locally converged entity cache for Node row/panel copy and the open action. For Logic Gates, the current title supplies saved Logic Gate grouping headers, alphabetical sort values, and the open action, but U51 keeps that title out of individual row copy.
U75 - Email-collaboration chat uses the existing Node chat trigger canon rather than a parallel notification subsystem. A new chat may create the normal chat-message update for already authorized participants under U34; the newly mentioned user's row is a normal or urgent mention update and mention tone overrides the underlying chat tone under U53.
U76 - A normal email-chat mention uses `mention.created` and canonical copy `{User} mentioned you on <email icon> {Email subject}`; an urgent email-chat mention uses `mention.urgent_created` and `{User} urgently mentioned you on <email icon> {Email subject}`. It must not describe the private collaboration Node as a Logic Gate work Node.
U77 - One accepted user-group mention creates at most one mention notification for each newly snapshotted member, excluding the actor and deduplicating overlap with direct/other-group mentions. Retrying the same committed chat write or later changing group membership does not duplicate, add, or retract those historical notifications.
U78 - Email-collaboration notification metadata may include collaboration ID, Node ID, provider message/thread ID, source mailbox discriminator, chat information ID, and selection-anchor metadata needed for authorized navigation, but never provider credentials, message/attachment bytes, presigned URLs, or storage keys.
U79 - Email collaboration mention/chat rows use the shared email icon token required by U55. Activating an authorized row opens the email collaboration at the referenced message/chat anchor with the same underlying Node chat; a revoked/deleted/inaccessible target fails closed instead of falling back to an unrelated Node or mailbox.
U80 - Summary-only acceptance/reconnect reconciliation never clears or replaces mounted Updates feed state. A real external notification change may revalidate roots/branches in the background, but applies the canonical result atomically and preserves current grouping expansion, selection, active preview, and visible rows on failure; row-only refreshes do not re-expand groups the user collapsed.
U81 - Priority is an Updates grouping field accepted by frontend normalization, Key Views saved-view editing, and backend saved-view validation. The built-in Updates tab's exact default chain is Date -> GVIC -> Priority -> Logic Gate. Existing/custom saved views, including an explicit empty grouping stack, retain their persisted fields/order/directions and are never overwritten by the built-in default.
U82 - GVIC and Priority grouping titles render as compact elevated rectangular entity surfaces instead of plain text. GVIC titles reuse the shared Generated cyan, Verified pink, Consulted purple, and Informed green editor palette; Other, No GVIC, and unknown roles use the same raised pattern with a neutral slate accent. Priority titles reuse the exact shared node-priority border, gradient, text color, and glow for their value. These presentation surfaces do not change disclosure, grouping order, row identity, or resource navigation.
U83 - Opening the built-in Updates tab or activating any saved Updates grouping view expands every group at every nested level. A later feed refresh also opens newly introduced groups by default, while U80 still keeps any group the user explicitly collapsed closed until the user reopens it, chooses Expand all, or activates a different grouping view.
U84 - The Updates page header provides Collapse all and Expand all actions. Collapse all closes every currently rendered grouping level, and Expand all opens every currently rendered grouping level without changing the active grouping view, filter, selection, or notification data.
U85 - The elevated Updates sidebar rectangle is divided into two equal halves: the Updates icon/title occupies the left half, and the right half is divided into three equal live-count cells for urgent ! mentions, normal @ mentions, and regular updates. Each icon and number has its own fixed, centered row with visible breathing room between them. A zero-count cell stays neutral; a nonzero urgent cell uses a four-stop fiery red-orange gradient, a nonzero normal-mention cell uses a four-stop teal-blue gradient, and a nonzero regular-update cell uses a four-stop yellow-orange gradient. The active gradients use the same light-leading-edge, saturated-middle, and darker-trailing-edge treatment as Mango's Node and Company Explorer folder icons.
U86 - Priority grouping orders assigned priorities by their numeric value: 1, 2, 3, 4, then 5 in ascending order. The shared `Unassigned to a Logic Gate` priority-zero group and any equivalent no-priority fallback always remain after assigned priorities, including when the saved grouping direction is descending.
U87 - An Updates row keeps its existing horizontal width and fixed time/Seen controls. Within that unchanged row, the Node title area consumes the remaining title-line space after the actor/action copy and before any priority/status tokens, and truncates only at that available edge instead of using an early fixed-width cap.

## Update Row Copy And Visual Language

### Tone Rules

| Update type | Marker or icon rule | Tone |
| --- | --- | --- |
| Urgent mention | ! marker is reserved for urgent mentions only | Red |
| Normal mention | @ marker is reserved for normal mentions only | Orange |
| New, added, appended, attached, converted, assigned, or granted | Use the relevant shared entity/action icon | Blue |
| Changed, updated, moved, or edited | Use the relevant shared entity/action icon | Purple |
| Removed, deleted, revoked, or detached | Use the relevant shared entity/action icon | Dark mellow red |

### Shared Inline Tokens

Status and priority chips in Updates must match the node UI status and priority controls exactly. They are shared design tokens, not Updates-specific styling. The visual cues below describe the shared node UI tokens that Updates must consume; they are not a separate Updates styling table.

| Node status token | Shared visual cue |
| --- | --- |
| Requested | Yellow status cue |
| Backlog | Purple status cue |
| Pending | Muted gray status cue |
| In Progress | Orange status cue |
| Review | Blue status cue |
| Done | Green status cue |

| Node priority token | Shared visual cue |
| --- | --- |
| 1 URGENT(<1hr) | Red urgent priority cue |
| 2 By end of day | Warm red or orange priority cue |
| 3 Tomorrow | Green or teal priority cue |
| 4 Sprint (1 week) | Blue or indigo priority cue |
| 5 Later (low priority) | Purple low-priority cue |
| Unassigned to a Logic Gate | Muted gray unassigned cue |

Entity icons in Updates must also be shared tokens. Individual row copy may use `<node icon>`, `<email icon>`, `<folder icon>`, and `<project icon>`; `<logic gate icon>` remains available to Logic Gate grouping headers and other resource surfaces but is not rendered inside individual rows. `{Shared Surface}` means the relevant shared triage or shared inbox surface.

### Canonical Row Copy

| Update event | Tone | Canonical row text |
| --- | --- | --- |
| Node added to Logic Gate | Blue | `{User} added <node icon> {Node} {Priority} {Status}` |
| Node requested to Logic Gate | Blue | `{User} requested <node icon> {Node} {Priority}` |
| Email converted into node | Blue | `{User} turned <email icon> email into <node icon> {Node}` |
| Node moved status | Purple | `{User} updated <node icon> {Node} to {Status}` |
| Normal mention in node text box | Orange @ | `{User} mentioned you in <node icon> {Node}` |
| Urgent mention in node text box | Red ! | `{User} urgently mentioned you in <node icon> {Node}` |
| Normal mention in node chat | Orange @ | `{User} mentioned you in chat on <node icon> {Node}` |
| Urgent mention in node chat | Red ! | `{User} urgently mentioned you in chat on <node icon> {Node}` |
| New node chat message | Blue | `{User} sent chat on <node icon> {Node}` |
| Normal mention in email collaboration chat | Orange @ | `{User} mentioned you on <email icon> {Email subject}` |
| Urgent mention in email collaboration chat | Red ! | `{User} urgently mentioned you on <email icon> {Email subject}` |
| New email collaboration chat message | Blue | `{User} sent chat on <email icon> {Email subject}` |
| Normal mention in Logic Gate text editor | Orange @ | `{User} mentioned you` |
| Urgent mention in Logic Gate text editor | Red ! | `{User} urgently mentioned you` |
| Email attached directly to node | Blue | `{User} attached <email icon> email to <node icon> {Node}` |
| Email-node card dropped or merged onto node | Blue | `{User} attached <email icon> email to <node icon> {Node}` |
| Node removed from Logic Gate | Dark mellow red | `{User} removed <node icon> {Node}` |
| Node deleted | Dark mellow red | `{User} deleted <node icon> {Node}` |
| GVIC assigned on node | Blue | `{User} assigned {Assignee} as {GVIC Role} on <node icon> {Node}` |
| GVIC changed on node | Purple | `{User} changed {Assignee}'s GVIC role to {GVIC Role} on <node icon> {Node}` |
| GVIC removed from node | Dark mellow red | `{User} removed {Assignee}'s GVIC role from <node icon> {Node}` |
| GVIC assigned on Logic Gate | Blue | `{User} assigned {Assignee} as {GVIC Role}` |
| GVIC changed on Logic Gate | Purple | `{User} changed {Assignee}'s GVIC role to {GVIC Role}` |
| GVIC removed from Logic Gate | Dark mellow red | `{User} removed {Assignee}'s GVIC role` |
| Permission granted on node | Blue | `{User} gave {Subject} access to <node icon> {Node}` |
| Permission changed on node | Purple | `{User} changed {Subject}'s access on <node icon> {Node}` |
| Permission revoked on node | Dark mellow red | `{User} removed {Subject}'s access from <node icon> {Node}` |
| Permission granted on Logic Gate | Blue | `{User} gave {Subject} access` |
| Permission changed on Logic Gate | Purple | `{User} changed {Subject}'s access` |
| Permission revoked on Logic Gate | Dark mellow red | `{User} removed {Subject}'s access` |
| Node priority changed | Purple | `{User} updated <node icon> {Node} to {Priority}` |
| Node due date changed | Purple | `{User} changed the due date on <node icon> {Node} to {Due Date}` |
| Other update-relevant node field changed | Purple | `{User} changed {Field} on <node icon> {Node}` |
| Shared triage or shared inbox GVIC assigned | Blue | `{User} assigned {Assignee} as {GVIC Role} on <folder icon> {Shared Surface}` |
| Shared triage or shared inbox GVIC changed | Purple | `{User} changed {Assignee}'s GVIC role to {GVIC Role} on <folder icon> {Shared Surface}` |
| Shared triage or shared inbox GVIC removed | Dark mellow red | `{User} removed {Assignee}'s GVIC role from <folder icon> {Shared Surface}` |
| Shared triage or shared inbox permission granted | Blue | `{User} gave {Subject} access to <folder icon> {Shared Surface}` |
| Shared triage or shared inbox permission changed | Purple | `{User} changed {Subject}'s access on <folder icon> {Shared Surface}` |
| Shared triage or shared inbox permission revoked | Dark mellow red | `{User} removed {Subject}'s access from <folder icon> {Shared Surface}` |

U88 - Email-node chat continues to use the existing node comment/mention event path. Committed normal or urgent mentions create the established Updates event only after the atomic chat-and-participant transaction succeeds; metadata may navigate to the exact authorized node/chat/email reply but must not imply provider recipient or mailbox participation.

## Scenarios

### Scenario U-S1: Grouped Unread Feed

Business logic covered:
- U1
- U2
- U3
- U4
- U5
- U6
- U13
- U14
- U15
- U16
- U17
- U18
- U19
- U20

Given:
- A user has unread urgent mentions, normal mentions, and non-mention update notifications.
- Some notifications are attached to project, logic gate, and node context.
- Some notifications have multiple project contexts.
- Some notifications have no workspace context.

Expected:
- Updates shows unread notifications only and does not behave like My Work.
- The all, urgent, mention, and update filters return the correct notification types.
- The root request returns only grouped shells.
- A branch request for a valid root ID returns the nested branch and notifications.
- Group paths follow project, logic gate, then node where available.
- Multi-project notifications appear once under each unique project path.
- Unanchored notifications appear under the fallback Updates group.
- Group IDs and ordering remain stable.
- Notifications are ordered newest first with deterministic tie-breaking.

### Scenario U-S2: Visibility And Bad Legacy IDs

Business logic covered:
- U21
- U22

Given:
- A user has notifications attached to resources they can view and resources they cannot view.
- Some old notifications contain malformed resource IDs.

Expected:
- Notifications for inaccessible resources do not appear in the feed.
- Malformed legacy IDs are ignored or sanitized before access checks.
- The feed still returns valid visible notifications instead of failing the whole request.

### Scenario U-S3: Read State, Delete, And Notification Coordination

Business logic covered:
- U7
- U8
- U9
- U10
- U11
- U12
- U23
- U24
- U73

Given:
- A user has unread notifications across several surfaces and roles.
- Another user has separate notifications in the same company.
- The notification socket may first accept, reconnect, or echo a local delete/clear command; in one case the server commit/socket hint arrives before a lost or rejected HTTP response for Updates-local Seen.

Expected:
- List, summary, read, unread, and delete operations affect only the current user's company-scoped notifications.
- Mark-all-read applies only the requested filters.
- Marking one notification read or unread does not change unrelated notifications.
- Deleting one notification removes only that notification.
- Clearing notifications can be scoped and publishes a cleared event.
- Summary counts update after read/delete operations.
- First subscription acceptance and reconnect acceptance each coalesce one canonical summary refresh; a late handler on an accepted shared scope receives its own immediate acceptance.
- First and reconnect acceptance update summary only. Only while Updates is open, real external notification hints run one feed request at a time with at most one queued final request; a closed Updates view performs no feed request.
- HTTP-first local delete/clear plus its matching socket echo emits at most one summary update and, subject to optimistic source filtering, at most one open-feed update.
- Socket-first plus a lost/rejected HTTP response emits exactly one summary update and one mounted Updates feed update; HTTP failure with no socket emits neither.
- The coordinator does not fabricate feed rows, and local Seen preserves its no-reload behavior.

### Scenario U-S4: Saved Grouping Views

Business logic covered:
- U25
- U67
- U72
- U82

Given:
- The user opens the built-in Updates tab, then saves a custom Updates view grouped by Project, Logic Gate, and Status and separately saves an explicitly empty grouping stack.
- Rows include recognized statuses, a legacy Verify or Backlogged spelling, and a status-changing event whose node has since moved again.
- The user opens an Updates saved view from the sidebar saved-view rows.
- The user leaves and later reloads Updates saved views.

Expected:
- The built-in tab defaults exactly to Date, GVIC, Priority, then Logic Gate, and Priority is available in the grouping picker.
- GVIC and Priority grouping titles are raised rectangular entity surfaces: GVIC uses its shared editor role palette (with neutral slate for Other or unassigned values), and Priority uses the exact shared node-priority palette for that number rather than generic plain text.
- Project, Logic Gate, Priority, and Status grouping fields save through the saved-views API.
- The saved fields reload in the same grouping order and direction.
- The status-changing row groups by the status recorded on that event; rows without an event status use the current resolved node status and otherwise No status.
- Comment and mention prose that happens to contain phrases such as `moved to` or `changed ... to` never creates a synthetic status group, and legacy `a new status/state` copy falls back to the current node status.
- Status ascending renders In Progress, Review, Pending, Requested, Backlog, then Done; descending reverses the nonterminal recognized groups but keeps Done at the bottom.
- Legacy Verify and Backlogged spellings join the Review and Backlog groups rather than creating duplicate groups.
- Updates saved grouping views live under the Updates entry in the Key Views sidebar, where users can add, activate, edit, rename, reorder, and delete saved grouping rows.
- Unknown Updates grouping fields are rejected instead of silently stored.
- Removing every Updates grouping is valid; the saved view reloads with a blank grouping stack instead of restoring the built-in default chain.
- Updates saved-view rows are shown under the Updates sidebar tab when they exist, and the floating grouping editor opens from + Add new or right-click Edit.
- Right-clicking a saved Updates view can edit, rename, or delete it, and drag reorder persists through saved-view position.

### Scenario U-S5: Authoritative Update Trigger Canon

Business logic covered:
- U26
- U27
- U28
- U29
- U30
- U31
- U32
- U33
- U34
- U35
- U36
- U37
- U38
- U39
- U40
- U41
- U42
- U43
- U44
- U45
- U46
- U47
- U48
- U49

Given:
- A user can see a node, Logic Gate, and shared triage surface.
- Another user performs node-to-Logic-Gate actions, node chat actions, editor mention actions, email attachment actions, GVIC changes, permission changes, node deletion, rename-only changes, issue-flag changes, and project-level changes.

Expected:
- Updates are created only by the positive trigger rules in U27, U28, U30 through U36, U38 through U44, U48, and U49.
- Node-added and node-moved updates are classified by the semantic work action, not by whether the action came from Logic Gate Work, GVIC Matrix, Kanban, Home, or another entry point.
- Node text box, node chat, and Logic Gate text editor mentions create normal or urgent mention updates according to @ or ! mention syntax.
- Node chat messages create updates even when they do not mention anyone.
- Direct node email attachment and email-node-card drop or merge produce the same attached-email update category.
- Node removal, node deletion, update-relevant GVIC changes, update-relevant permission changes, and non-name node field changes create updates.
- Shared triage and shared inbox GVIC or permission changes create updates.
- Logic Gate chat, rename-only changes, Logic Gate issue-flag changes, and project-level changes remain explicit non-triggers under U37 and U45 through U47.

### Scenario U-S6: Canonical Update Row Copy And Visual Tokens

Business logic covered:
- U50
- U51
- U52
- U53
- U54
- U55
- U56
- U57

Given:
- A user receives update rows for node additions, node requests, email conversions, node status moves, mentions, node chat messages, email attachments, node removals, node deletions, GVIC changes, permission changes, node field changes, and shared triage changes.
- Some rows include node status and priority values.
- Some rows include node, email, folder, or project entity icons, while Logic Gate context remains present in grouping/navigation data.

Expected:
- Each update row uses the canonical row text from the Update Row Copy table.
- Node rows name the node but omit the Logic Gate icon, label, and trailing context; direct Logic Gate notifications also omit the per-row Logic Gate chip/label.
- Urgent mentions use the reserved red ! treatment.
- Normal mentions use the reserved orange @ treatment.
- New, added, appended, attached, converted, assigned, or granted actions use blue.
- Changed, updated, moved, or edited actions use purple.
- Removed, deleted, revoked, or detached actions use dark mellow red.
- Mention rows use mention tone instead of the underlying chat, editor, field, or attachment tone.
- Status and priority chips match the shared node UI tokens exactly.
- Rendered row entity icons are pulled from the shared app icon registry or equivalent shared token source, while Logic Gate icons remain available to grouping headers rather than individual row copy.

### Scenario U-S7: Seen Actions, Multi-Select, And Text Editor Mention Commit

Business logic covered:
- U58
- U59
- U60
- U61
- U62
- U63
- U64
- U65
- U66
- U68
- U69
- U71

Given:
- A user inserts an @ mention or ! mention into a node text editor or Logic Gate text editor.
- The user continues typing near the committed mention chip and the editor autosaves multiple times.
- The same user later adds a second committed mention occurrence.
- The mentioned user opens Updates and sees several update rows.

Expected:
- Selecting a mention target creates a committed inline chip in the editor.
- Later typing near the committed mention chip does not change the mentioned user or urgent/normal mention kind.
- Autosaves and character edits around an existing committed mention do not create duplicate mention notifications.
- Adding a genuinely new committed mention occurrence creates one new notification for that new occurrence.
- The new mention row's preview is scoped to the block containing that occurrence, not earlier mention blocks or unrelated editor text in the same saved document.
- Saving a text editor that still contains an older already-recorded mention occurrence does not recreate that old mention update, even if the old notification was previously Seen.
- Clicking Seen on one row removes that notification permanently from the Updates feed for that user.
- Clicking Seen on one row hides the row without a full Updates feed reload or visible blink.
- Seen removes the clicked row, automatically selects/focuses the next remaining row below, and immediately opens/highlights that successor's node and information in the right-hand preview.
- If no row remains below the Seen row, list selection clears without jumping upward and the clicked-node preview remains open.
- Clicking Seen all asks for confirmation, then removes all current-user Updates notifications for the company.
- Ctrl-click or Command-click toggles row selection, and Shift-click additively selects the visible range from the selection anchor.
- Activating a row scrolls the node preview to the referenced information without placing the caret inside the node editor.
- Up and Down arrow keys continue moving the selected row through the flattened visible Updates rows, including across nested groups.
- Right-clicking a row opens an Updates context menu with seen actions for the selected rows and all rows, with confirmation before multi-row removal.
- The Updates tab badge set shows one count for ! urgent mentions, one for @ mentions, and one for regular non-mention updates.
- The badge counts are derived from the notification summary, update when new notifications arrive, and decrement when Seen or Seen all removes matching notifications from the feed.

### Scenario U-S8: Attachment Update Rows Are Metadata Only

Business logic covered:
- U38
- U39
- U53
- U56
- U70

Given:
- A user attaches an email to a node.
- A user drops or merges an email-created card onto an existing node.
- The action creates an Updates row for another permitted viewer.

Expected:
- The Updates row uses the attached-email update category and the normal attachment/action tone rules.
- The Updates payload may reference the node, email, provider message, and Mango attachment IDs needed for navigation/rendering.
- The Updates payload does not include raw attachment bytes, data URLs, base64 strings, or S3 object contents.
- Opening the referenced attachment content requires the normal Mango attachment/content API permission check.

### Scenario U-S9: Current Node Or Logic Gate Labels Converge Without Rewriting History

Business logic covered:
- U19
- U25
- U45
- U50
- U74

Given:
- Updates is mounted with a historical notification row for a Node or Logic Gate; for the Logic Gate case, a saved view is grouped by Logic Gate.
- The same user successfully renames that Node or Logic Gate elsewhere in the same browser window.

Expected:
- The rename creates no new notification.
- The row's stored notification title and body preview remain the historical text recorded when the notification was created.
- The mounted Node row, selected Node preview label, and open-Node action immediately use the current committed Node title. The open-Logic-Gate action uses the current committed Logic Gate title without adding that title back to individual row copy.
- For the Logic Gate case, the saved Logic Gate grouping header and alphabetical grouping order use the current committed title and sort value.
- No feed reload, cross-user title socket, or generalized fan-out plane is required for this same-window convergence.

### Scenario U-S10: Email Chat Mention Notification And Navigation

Business logic covered:
- U32
- U33
- U34
- U53
- U55
- U69
- U75
- U76
- U77
- U78
- U79

Given:
- An email collaboration chat mentions one user directly and a group with overlapping current members.
- The chat may be normal or urgent, and existing participants may also receive the ordinary chat update.
- A mentioned participant opens Updates and activates the row.

Expected:
- Each distinct newly snapshotted mentioned user receives at most one normal or urgent mention notification; the actor is excluded and request retry/group changes create no duplicate.
- Mention tone overrides chat tone and contributes to the existing @ or ! badge.
- Canonical text says the actor mentioned the user on the email subject and uses the shared email icon, not a Logic Gate/Node-work sentence.
- Existing participant chat updates may use the blue email-chat row.
- The payload contains only the authorized IDs/anchor metadata needed to open the same email/Node chat and contains no credentials or file/object bytes.
- Activation opens the referenced collaboration message/chat anchor after authorization; missing or inaccessible targets fail closed.

### Scenario U-S11: Acceptance Is Non-Disruptive And Built-In Grouping Is Exact

Business logic covered:
- U23
- U24
- U25
- U66
- U80
- U81

Given:
- Updates is open with a selected row, active node preview, and a user-collapsed nested group.
- The notification socket accepts or reconnects, then a real external notification hint arrives.
- The user switches between built-in Updates and customized/explicitly ungrouped saved views.

Expected:
- Acceptance refreshes summary badges only and issues no roots/branch feed requests.
- The real hint performs one coalesced background canonical feed reconciliation without blanking visible rows, selection, preview, or expansion state; failure leaves the prior feed visible.
- Row changes do not reopen a group the user collapsed.
- Built-in Updates uses Date -> GVIC -> Priority -> Logic Gate exactly, while custom and empty stacks reload unchanged.

### Scenario U-S12: Updates Expansion Controls And Sidebar Counters

Business logic covered:
- U69
- U80
- U83
- U84
- U85

Given:
- A user opens Mango in a fresh browser session and selects the built-in Updates tab.
- The user also activates a saved Updates grouping view with multiple nested grouping levels.
- The user has zero or nonzero urgent mentions, normal mentions, and regular updates.
- The user manually collapses one group and later receives a background feed refresh.

Expected:
- The built-in Updates grouping and each newly activated saved grouping view render every available grouping level expanded.
- Collapse all closes all rendered groups, and Expand all reopens all rendered groups without changing the selected view, filter, rows, or selection.
- A background refresh preserves the one group the user explicitly collapsed while opening any newly introduced groups by default.
- The Updates sidebar rectangle gives exactly half its width to the icon/title and half to the three count cells.
- The count half is divided into three equal cells for urgent ! mentions, normal @ mentions, and regular updates, with larger icons and numbers.
- Each icon is centered above its number in a separate fixed row, with enough vertical space that the @ symbol and other icons never touch the count.
- Every zero-count cell stays neutral.
- A nonzero urgent cell uses the richer four-stop fiery red-orange gradient, a nonzero normal-mention cell uses the richer four-stop teal-blue gradient, and a nonzero regular-update cell uses the richer four-stop yellow-orange gradient.

### Scenario U-S13: Priority Order And Row Title Width

Automated regression: `tests/frontend/pages/home/updatesGrouping.test.ts`.

Business logic covered:
- U81
- U86
- U87

Given:
- Updates is grouped by Date -> GVIC -> Priority -> Logic Gate.
- One Date/GVIC branch contains priorities 1 through 5 plus the shared `Unassigned to a Logic Gate` priority-zero group.
- Several Updates rows contain long Node titles, priority/status tokens, timestamps, and Seen buttons.

Expected:
- Ascending Priority grouping renders priorities 1, 2, 3, 4, and 5 before the unassigned group.
- Descending Priority grouping renders priorities 5, 4, 3, 2, and 1 before the unassigned group.
- The outer row width, timestamp column, and Seen button stay unchanged.
- Each Node title uses the remaining title-line width and ellipsizes only when it reaches the neighboring tokens or fixed right-side controls.
