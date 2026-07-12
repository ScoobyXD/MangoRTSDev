Last updated: 2026-07-12

# Updates Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: saved-views API coverage exists for Updates Project, Logic Gate, and Status grouping fields. `tests/frontend/modules/grouping/universalStatusGrouping.test.ts` covers the exact shared status order and Updates wiring. Frontend selection tests cover row selection and individual Seen successor/reload decisions. Other rule IDs are not mapped to automated tests yet.

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
U23 - One app-lifetime notification coordinator owns `notifications:user:{user_id}`. A created, deleted, or cleared hint coalesces one canonical summary reconciliation and immediately updates the urgent `!`, normal `@`, and regular unread badges.
U24 - Updates registers with the notification coordinator only while open. An external notification hint coalesces one canonical feed reconciliation while open and causes no feed request while closed; local Seen keeps its existing optimistic no-reload behavior.
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
U50 - Update row copy follows the shape "{User} did {action} on {thing} in {context}"; the actor appears first, the specific verb appears second, and the primary object and workspace context are named in the row.
U51 - Node updates with Logic Gate context must name both the node and the Logic Gate in the row text, even when the row is already visually grouped under that Logic Gate.
U52 - Update row tone is determined by update type: urgent mentions reserve red with a ! marker, normal mentions reserve orange with an @ marker, new/added/appended actions use blue, changed/updated actions use purple, and deleted/removed actions use dark mellow red.
U53 - Mention tones override other row tones for the notification sent to the mentioned user: urgent ! mention is highest priority, then normal @ mention, then the underlying chat, editor, field, or attachment action.
U54 - Status and priority values shown inside update rows must reuse the same shared visual tokens as node status and node priority controls; Updates must not hardcode separate status or priority colors, fonts, icons, or pill styles.
U55 - Entity icons shown inside update rows must come from a shared app icon registry or equivalent shared token source for nodes, emails, Logic Gates, folders, projects, and future reusable entities; Updates must not define local copies of those icons.
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
U71 - Seeing an individual update activates the next remaining visible row below it and opens that row's node preview when it references a node, so the user can continue down the list with repeated Seen actions. If no row remains below, Updates clears the active row and node preview instead of jumping upward.
U72 - Updates Status grouping consumes the shared universal status contract also used by My Work and Project Logic Gates / Nodes. A real status carried by a status-bearing notification is authoritative for that event row; arbitrary comment/mention prose and backend placeholders such as `a new status` or `a new state` are never status values. When no real event status exists, Updates falls back to the currently resolved node status, then the distinct No status group. Ascending recognized order is In Progress, Review, Pending, Requested, Backlog, Done. Verify aliases normalize to Review, Request/Requests normalize to Requested, Backlogs/Back Logs/Backlogged normalize to Backlog, and completed/closed/archived aliases normalize to Done. Descending reverses recognized nonterminal groups while Done remains final; unknown nonblank statuses and No status remain before Done.

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

Entity icons in Updates must also be shared tokens. At minimum, the shared icon set must cover `<node icon>`, `<email icon>`, `<logic gate icon>`, `<folder icon>`, and `<project icon>`. `{Shared Surface}` means the relevant shared triage or shared inbox surface.

### Canonical Row Copy

| Update event | Tone | Canonical row text |
| --- | --- | --- |
| Node added to Logic Gate | Blue | `{User} added <node icon> {Node} {Priority} {Status} to <logic gate icon> {Logic Gate}` |
| Node requested to Logic Gate | Blue | `{User} requested <node icon> {Node} {Priority} to <logic gate icon> {Logic Gate}` |
| Email converted into node | Blue | `{User} turned <email icon> email into <node icon> {Node} and added to <logic gate icon> {Logic Gate}` |
| Node moved status | Purple | `{User} updated <node icon> {Node} to {Status} in <logic gate icon> {Logic Gate}` |
| Normal mention in node text box | Orange @ | `{User} mentioned you in <node icon> {Node} in <logic gate icon> {Logic Gate}` |
| Urgent mention in node text box | Red ! | `{User} urgently mentioned you in <node icon> {Node} in <logic gate icon> {Logic Gate}` |
| Normal mention in node chat | Orange @ | `{User} mentioned you in chat on <node icon> {Node} in <logic gate icon> {Logic Gate}` |
| Urgent mention in node chat | Red ! | `{User} urgently mentioned you in chat on <node icon> {Node} in <logic gate icon> {Logic Gate}` |
| New node chat message | Blue | `{User} sent chat on <node icon> {Node} in <logic gate icon> {Logic Gate}` |
| Normal mention in Logic Gate text editor | Orange @ | `{User} mentioned you in <logic gate icon> {Logic Gate}` |
| Urgent mention in Logic Gate text editor | Red ! | `{User} urgently mentioned you in <logic gate icon> {Logic Gate}` |
| Email attached directly to node | Blue | `{User} attached <email icon> email to <node icon> {Node} in <logic gate icon> {Logic Gate}` |
| Email-node card dropped or merged onto node | Blue | `{User} attached <email icon> email to <node icon> {Node} in <logic gate icon> {Logic Gate}` |
| Node removed from Logic Gate | Dark mellow red | `{User} removed <node icon> {Node} from <logic gate icon> {Logic Gate}` |
| Node deleted | Dark mellow red | `{User} deleted <node icon> {Node} from <logic gate icon> {Logic Gate}` |
| GVIC assigned on node | Blue | `{User} assigned {Assignee} as {GVIC Role} on <node icon> {Node} in <logic gate icon> {Logic Gate}` |
| GVIC changed on node | Purple | `{User} changed {Assignee}'s GVIC role to {GVIC Role} on <node icon> {Node} in <logic gate icon> {Logic Gate}` |
| GVIC removed from node | Dark mellow red | `{User} removed {Assignee}'s GVIC role from <node icon> {Node} in <logic gate icon> {Logic Gate}` |
| GVIC assigned on Logic Gate | Blue | `{User} assigned {Assignee} as {GVIC Role} on <logic gate icon> {Logic Gate}` |
| GVIC changed on Logic Gate | Purple | `{User} changed {Assignee}'s GVIC role to {GVIC Role} on <logic gate icon> {Logic Gate}` |
| GVIC removed from Logic Gate | Dark mellow red | `{User} removed {Assignee}'s GVIC role from <logic gate icon> {Logic Gate}` |
| Permission granted on node | Blue | `{User} gave {Subject} access to <node icon> {Node} in <logic gate icon> {Logic Gate}` |
| Permission changed on node | Purple | `{User} changed {Subject}'s access on <node icon> {Node} in <logic gate icon> {Logic Gate}` |
| Permission revoked on node | Dark mellow red | `{User} removed {Subject}'s access from <node icon> {Node} in <logic gate icon> {Logic Gate}` |
| Permission granted on Logic Gate | Blue | `{User} gave {Subject} access to <logic gate icon> {Logic Gate}` |
| Permission changed on Logic Gate | Purple | `{User} changed {Subject}'s access on <logic gate icon> {Logic Gate}` |
| Permission revoked on Logic Gate | Dark mellow red | `{User} removed {Subject}'s access from <logic gate icon> {Logic Gate}` |
| Node priority changed | Purple | `{User} updated <node icon> {Node} to {Priority} in <logic gate icon> {Logic Gate}` |
| Node due date changed | Purple | `{User} changed the due date on <node icon> {Node} to {Due Date} in <logic gate icon> {Logic Gate}` |
| Other update-relevant node field changed | Purple | `{User} changed {Field} on <node icon> {Node} in <logic gate icon> {Logic Gate}` |
| Shared triage or shared inbox GVIC assigned | Blue | `{User} assigned {Assignee} as {GVIC Role} on <folder icon> {Shared Surface}` |
| Shared triage or shared inbox GVIC changed | Purple | `{User} changed {Assignee}'s GVIC role to {GVIC Role} on <folder icon> {Shared Surface}` |
| Shared triage or shared inbox GVIC removed | Dark mellow red | `{User} removed {Assignee}'s GVIC role from <folder icon> {Shared Surface}` |
| Shared triage or shared inbox permission granted | Blue | `{User} gave {Subject} access to <folder icon> {Shared Surface}` |
| Shared triage or shared inbox permission changed | Purple | `{User} changed {Subject}'s access on <folder icon> {Shared Surface}` |
| Shared triage or shared inbox permission revoked | Dark mellow red | `{User} removed {Subject}'s access from <folder icon> {Shared Surface}` |

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

Given:
- A user has unread notifications across several surfaces and roles.
- Another user has separate notifications in the same company.

Expected:
- List, summary, read, unread, and delete operations affect only the current user's company-scoped notifications.
- Mark-all-read applies only the requested filters.
- Marking one notification read or unread does not change unrelated notifications.
- Deleting one notification removes only that notification.
- Clearing notifications can be scoped and publishes a cleared event.
- Summary counts update after read/delete operations.
- The one notification coordinator coalesces one summary refresh and, only while Updates is open, one canonical feed refresh; it does not fabricate feed rows.

### Scenario U-S4: Saved Grouping Views

Business logic covered:
- U25
- U67
- U72

Given:
- A user saves an Updates view grouped by Project, Logic Gate, and Status.
- Rows include recognized statuses, a legacy Verify or Backlogged spelling, and a status-changing event whose node has since moved again.
- The user opens an Updates saved view from the sidebar saved-view rows.
- The user leaves and later reloads Updates saved views.

Expected:
- Project, Logic Gate, and Status grouping fields save through the saved-views API.
- The saved fields reload in the same grouping order and direction.
- The status-changing row groups by the status recorded on that event; rows without an event status use the current resolved node status and otherwise No status.
- Comment and mention prose that happens to contain phrases such as `moved to` or `changed ... to` never creates a synthetic status group, and legacy `a new status/state` copy falls back to the current node status.
- Status ascending renders In Progress, Review, Pending, Requested, Backlog, then Done; descending reverses the nonterminal recognized groups but keeps Done at the bottom.
- Legacy Verify and Backlogged spellings join the Review and Backlog groups rather than creating duplicate groups.
- Updates saved grouping views live under the Updates entry in the Key Views sidebar, where users can add, activate, edit, rename, reorder, and delete saved grouping rows.
- Unknown Updates grouping fields are rejected instead of silently stored.
- Removing every Updates grouping is valid; the saved view reloads with a blank grouping stack instead of restoring default Project and Logic Gate grouping.
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
- Some rows include node, email, Logic Gate, folder, or project entity icons.

Expected:
- Each update row uses the canonical row text from the Update Row Copy table.
- Node updates with Logic Gate context name both the node and the Logic Gate.
- Urgent mentions use the reserved red ! treatment.
- Normal mentions use the reserved orange @ treatment.
- New, added, appended, attached, converted, assigned, or granted actions use blue.
- Changed, updated, moved, or edited actions use purple.
- Removed, deleted, revoked, or detached actions use dark mellow red.
- Mention rows use mention tone instead of the underlying chat, editor, field, or attachment tone.
- Status and priority chips match the shared node UI tokens exactly.
- Entity icons are pulled from the shared app icon registry or equivalent shared token source, not from Updates-local hardcoding.

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
- After Seen hides one row, the next remaining visible row below it becomes active and its node preview opens when the row references a node, allowing repeated Seen actions to continue down the list.
- If no row remains below the Seen row, the active row and node preview clear instead of jumping upward.
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
