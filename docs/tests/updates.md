Last updated: 2026-06-30

# Updates Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: saved-views API coverage exists for Updates Project and Logic Gate grouping fields. Other rule IDs are not mapped to automated tests yet.

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
U23 - Realtime notification created, deleted, and cleared events preserve affected scopes and trigger feed refreshes.
U24 - Read-state changes refetch the feed instead of locally inventing or mutating unrelated feed rows.
U25 - Updates saved grouping views persist Project and Logic Gate grouping fields through the saved-views API.
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
U66 - Updates saved grouping view rows render under the Updates sidebar tab. Add new + opens the floating grouping editor for a new view, and right-clicking an existing view exposes Edit, Rename, and Delete commands.

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

### Scenario U-S3: Read State, Delete, Summary, And Realtime

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
- Realtime events trigger refetches instead of fabricated local feed rows.

### Scenario U-S4: Saved Grouping Views

Business logic covered:
- U25, U66

Given:
- A user saves an Updates view grouped by Project and Logic Gate.
- The user opens an Updates saved view from the sidebar saved-view rows.
- The user leaves and later reloads Updates saved views.

Expected:
- Project and Logic Gate grouping fields save through the saved-views API.
- The saved fields reload in the same grouping order and direction.
- Unknown Updates grouping fields are rejected instead of silently stored.
- Updates saved-view rows are shown under the Updates sidebar tab, and the floating grouping editor opens from Add new + or right-click Edit.
- Right-clicking a saved Updates view can edit, rename, or delete it.

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
- Clicking Seen on one row removes that notification permanently from the Updates feed for that user.
- Clicking Seen all asks for confirmation, then removes all current-user Updates notifications for the company.
- Ctrl-click or Command-click toggles row selection, and Shift-click additively selects the visible range from the selection anchor.
- Right-clicking a row opens an Updates context menu with seen actions for the selected rows and all rows, with confirmation before multi-row removal.
