Last updated: 2026-06-30

# Kanban Board Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (frontend Kanban command/helper coverage and saved-view backend coverage exist; rule IDs are not fully mapped to automated tests yet)

## Scope

These rules cover Kanban board behavior, with extra detail for Logic Gate Kanban boards. A Logic Gate Kanban board is the Kanban work board opened for a Logic Gate, usually using board ID `logic-gate:{logicGateID}`.

## Business Logic

### Board Identity And Data Ownership

KB1 - A Logic Gate Kanban board displays node work assigned to one Logic Gate.
KB2 - A Logic Gate Kanban board uses the Logic Gate as the owning resource for access and persistence.
KB3 - Logic Gate Kanban board contents are not independent per-user board copies; every authorized user sees the same underlying cards, columns, statuses, and card order.
KB4 - User-specific grouping and Date Added sort settings do not belong to the Kanban board record and do not belong to a specific Logic Gate.
KB5 - User-specific grouping and Date Added sort settings are saved in one user-owned `saved_views` row so the same user's Logic Gate Kanban view applies across all Logic Gate Kanban boards.
KB6 - Generic Kanban board card APIs remain node-card APIs. Logic Gate work state should continue to use Logic Gate assignment/work-item commands where those command paths exist.
KB7 - Deleting a node removes its Kanban card placements and Logic Gate Kanban projection rows.
KB8 - Deleting a Logic Gate removes the Logic Gate Kanban board/work placements owned by that Logic Gate.
KB9 - Logic Gate Kanban board reads must be permission-filtered by the owning Logic Gate.
KB10 - Users without view access to the owning Logic Gate must not receive card rows, projection deltas, saved board state, or card metadata for that Logic Gate board.

### Columns, Status, And Card State

KB11 - The visible Kanban columns are the status lanes for the board.
KB12 - A card's column is the visible status unless the card is explicitly marked as an issue.
KB13 - Issue cards visually override normal status display as `Issue` wherever issue-specific card state is shown.
KB14 - The requested column is a special Logic Gate lane for work proposed to the Logic Gate owner.
KB15 - The backlog column is a special Logic Gate lane for declined, canceled, or unaccepted requested work.
KB16 - Logic Gate Kanban cards require a priority when they are created or dropped into a Logic Gate board.
KB17 - Moving a Logic Gate Kanban card to another column updates the Logic Gate assignment status.
KB18 - Reordering cards in a column updates sparse card position values without changing the underlying node.
KB19 - Reordering columns updates column position values and does not alter card membership.
KB20 - Column width, height, and color layout for Logic Gate Kanban can remain a local display overlay and must not be confused with grouping preferences.

### Saved Grouping Preferences

KB21 - The old grouped matrix board is removed from the Logic Gate Kanban group button.
KB22 - Clicking the Logic Gate Kanban `Group` button opens grouping settings instead of switching the board into a separate matrix view.
KB23 - Grouping renders subgroup headers inside each existing Kanban column.
KB24 - Grouping must not remove, duplicate, or hide cards beyond the user's active search and account filters.
KB25 - Grouping must not replace normal Kanban columns.
KB26 - Grouping must not recreate the old matrix cells; only explicitly supported grouped drops may mutate a grouped field.
KB27 - Card-to-card and card-to-column drag/drop continues to use normal Kanban movement semantics while grouping is active.
KB28 - Grouping supports these fields only: priority, due date, by person, and account.
KB29 - Grouping supports ascending and descending direction for each grouping level.
KB30 - The visible grouping popover does not show a saved-view selector, new-view button, delete button, save button, or saved-view name field, and nested grouping rows must remain inside the popover boundary.
KB31 - A saved grouping must not contain the same field more than once.
KB32 - A grouping stack may contain multiple grouping levels.
KB33 - Logic Gate Kanban does not inject mandatory grouping rows; every grouping row is optional and user-controlled.
KB34 - Due date grouping uses the card/node due date and places missing dates under `No due date`.
KB35 - Date Added is not a grouping field; it is a separate checkable sort control that can be enabled or disabled, with Asc/Desc direction available while enabled.
KB36 - By-person grouping uses the person who originally created or transferred the card into the current Logic Gate, not department, HR group, team, or GVIC role name.
KB37 - Missing by-person provenance is grouped under `No person`.
KB38 - Account grouping uses assigned accounts. A card with multiple accounts can appear in each matching account subgroup.
KB39 - A card with no account appears under `No account`.
KB40 - Priority grouping uses node/card priority values 1 through 5 and places missing priority under `No priority`.
KB41 - Saved Logic Gate Kanban groupings must use `principal = user`.
KB42 - Saved Logic Gate Kanban groupings must reject group/team principals.
KB43 - Saved Logic Gate Kanban groupings must reject fields that belong to My Work, Updates, or Kanban status-only behavior, such as project, logic gate, team, type, or status.
KB44 - Saved Logic Gate Kanban extra groupings use `saved_views.surface = logic_gate_kanban`.
KB45 - Each user has at most one active Logic Gate Kanban saved view row per company, keyed by `surface = logic_gate_kanban`, `principal = user`, and that user's `principal_id`.
KB46 - Logic Gate Kanban must not use or require a `saved_view_preferences` table; loading a Logic Gate Kanban board applies the user's `logic_gate_kanban` row directly.
KB47 - Changing optional grouping rows, Date Added enabled state, or Date Added sort direction immediately saves the current user settings without an explicit Save action.
KB48 - Saved Logic Gate Kanban views persist the user's optional grouping stack plus `settings.date_added_sort_enabled` and `settings.date_added_sort_direction`; Date Added must not be written as a grouping row.
KB49 - The saved optional grouping stack from one Logic Gate must apply when the same user opens another Logic Gate Kanban board.
KB50 - Another user in the same company can choose different optional Logic Gate Kanban groupings, Date Added enabled state, and Date Added sort direction without changing the first user's saved Logic Gate Kanban view row.
KB51 - If a user has no Logic Gate Kanban saved view row, the board renders ungrouped with Date Added enabled ascending until the user changes grouping or Date Added sort settings.

### Card Provenance Footer

KB52 - Logic Gate Kanban cards display muted footer metadata at the bottom of the card.
KB53 - Request status text such as `Request pending` or `Request sent to {person}` appears on the bottom-right of the card footer.
KB54 - Placement provenance appears on the bottom-right of the card footer.
KB55 - Placement provenance text must use the exact prefix `from: ` followed by the person's display name.
KB56 - Placement provenance text includes the initial Logic Gate card/assignment creation month/day and local time without a year, such as `6/23 1:45 p.m.`.
KB57 - The by-person display must resolve to a company user's display name when available.
KB58 - If the display name is unavailable, the by-person display may fall back to email or user ID.
KB59 - The by-person footer must not show department names, HR groups, user groups, teams, GVIC role names, or generic ownership labels.
KB60 - A first assignment into a Logic Gate records the actor user as the placed-by user.
KB61 - Moving a card within the same Logic Gate preserves the original placed-by user.
KB62 - Moving or transferring a card into a different Logic Gate records the transfer actor as the placed-by user for the new Logic Gate.
KB63 - Converting an email or triage item into a Logic Gate Kanban card records the converting actor as the placed-by user.
KB64 - Existing historical rows with no placed-by user may render without a by-person footer until provenance is available.

### Requested Work Flow

KB65 - Nodes dropped or created into a Logic Gate requested column store the requesting user.
KB66 - The generated user for the Logic Gate sees accept and decline actions for requested nodes sent by another user.
KB67 - Accepting a requested node moves it to pending and clears the request sender.
KB68 - Declining a requested node moves it to backlog and clears the request sender.
KB69 - The requesting user sees request-sent status on the requested card.
KB70 - The requesting user can cancel the request, which moves the card back to backlog.
KB71 - Request metadata and placed-by metadata are separate fields and must not overwrite each other.
KB72 - A requested card can still show `from: {person} {date/time}` in the footer when placement provenance exists.

### Search, Filters, And Live Updates

KB73 - Search filters cards before subgrouping is built.
KB74 - Account filters cards before subgrouping is built.
KB75 - Subgroup headers should reflect only the cards currently visible after search and account filters.
KB76 - Kanban projection live deltas must include placed-by metadata when it changes.
KB77 - A projection delta that changes card placement, title, priority, due date, issue state, accounts, requested-by, placed-by, or creation timestamp must update the rendered card without requiring a full page refresh.
KB78 - Sequence gaps, invalid deltas, or permission uncertainty may trigger a targeted Kanban board refresh.

### Date Added, Manual Order, And Grouped Drops

KB79 - When Date Added sorting is enabled, visible card order is driven by card-added datetime and card-to-card drops must not write manual vertical position changes.
KB80 - When Date Added sorting is disabled, card-to-card drops within a column can manually reorder visible cards by writing sparse card position values.
KB81 - Dragging a card to another status column must remain available whether Date Added sorting is enabled or disabled.
KB82 - A grouped Logic Gate Kanban board can update priority by dropping a card onto a supported priority group header or onto a card in a different visible priority group.
KB83 - Priority grouped drops update real priority values 1 through 5 only.
KB84 - Dropping onto `No priority` does not clear priority until clear-priority drop semantics are deliberately designed.
KB85 - Priority grouped drops can also move the card to the target status column when the target priority group is in a different column.
KB86 - When Date Added sorting is enabled, priority grouped drops update priority and status but do not write a manual position.
KB87 - When Date Added sorting is disabled, priority grouped drops may also write a manual sparse position so the moved card lands at the visible drop point.
KB88 - Person, due date, and account grouping headers remain display group headers and must not silently mutate those fields by card drop until explicit field-specific semantics are designed.
KB89 - A Kanban card created directly from an email-to-Logic-Gate conversion exposes `created_from_email = true` and shows a visible email icon on the card.
KB90 - A normal node card that merely has an email attached must not show the direct-email-created icon unless that card itself was created as the email node.
KB91 - Dragging a direct email-created card over another card shows a full-card email attachment target state, while normal card reordering continues to show the before/after insertion marker.
KB92 - Dropping a direct email-created card onto a different target node card transfers the email to the target node, creates or updates the target email attachment placement, and adds the target node's attached-email projection.
KB93 - After a successful email-card transfer, the source email-created Kanban card and its temporary source node are deleted.
KB94 - Email-card transfer does not restore the email to My Triage and does not delete the target node or target card.
KB95 - Multi-card drags, non-email-created source cards, same-card drops, and same-node drops must not run email-card transfer semantics.
KB96 - Direct email-created Kanban cards can originate from My Triage or from a mailbox-capable Shared Triage inbox; the visible email-origin marker and transfer behavior are the same after creation.
KB97 - Email-card transfer uses the stored direct email-node provenance and board/card IDs; it must not require the actor to have a connected personal mailbox at transfer time.
KB98 - When a local email-to-Logic-Gate conversion has already updated the board from the POST response, matching immediate communications/workspace events must not force repeated Home workspace panel reloads, and the source mail list must not be refreshed, refilled from stale prefetched pages, or message-length-prefetched by broad communications cache invalidation.
KB99 - The initial email-to-Logic-Gate conversion sets the source email to unstarred and returns `unstarred_message_ids` for local Home reconciliation; later direct email-card transfer between Kanban cards uses stored email-node provenance only and must not perform another mailbox star/unstar mutation.

## Scenarios

### Scenario KB-S1: User Changes Logic Gate Kanban Grouping

Business logic covered:
- KB4
- KB5
- KB21
- KB22
- KB28
- KB29
- KB30
- KB33
- KB35
- KB41
- KB44
- KB45
- KB46
- KB47
- KB48
- KB49
- KB50
- KB51

Given:
- User A opens Logic Gate A's Kanban board.
- User A opens the Group popover.
- User A sees no mandatory grouping rows.
- User A adds priority ascending and by person descending as optional grouping rows.
- User A disables or enables the Date Added checkbox.
- User A toggles the Date Added sort control to the desired direction.
- User A then opens Logic Gate B's Kanban board.
- User B opens either Logic Gate Kanban board.

Expected:
- User A sees the same optional priority and by-person grouping rows on Logic Gate B.
- User A sees the same saved Date Added enabled state on Logic Gate B.
- User A sees the same saved Date Added sort direction on Logic Gate B.
- User A's optional grouping stack is saved without pressing a Save button.
- Date Added remains a separate sort control and is saved as `settings.date_added_sort_enabled` and `settings.date_added_sort_direction`, not as a grouping row.
- The visible Group popover does not show saved-view selection, New, Delete, Save, or saved-view name controls.
- User A's selected grouping is stored directly in User A's single `saved_views` row for `logic_gate_kanban`.
- User B does not inherit User A's selected grouping.
- User B does not inherit User A's Date Added enabled state.
- User B does not inherit User A's Date Added sort direction.
- No Logic Gate board row stores the selected grouping.
- No `saved_view_preferences` table or row is used for Logic Gate Kanban grouping.

### Scenario KB-S2: Grouping Renders Inside Columns

Business logic covered:
- KB23
- KB24
- KB25
- KB26
- KB27
- KB31
- KB32
- KB33
- KB34
- KB35
- KB36
- KB37
- KB38
- KB39
- KB40
- KB73
- KB74
- KB75
- KB79
- KB80
- KB81
- KB82
- KB83
- KB84
- KB85
- KB86
- KB87
- KB88

Given:
- A Logic Gate Kanban board has cards in pending, in progress, review, done, requested, and backlog columns.
- The selected grouping is priority, due date, by person, and account.
- Date Added sorting is active in ascending or descending order.
- A search or account filter is active.

Expected:
- Each existing column still renders as a Kanban column.
- Subgroup headers appear inside each column for the currently visible cards.
- Cards inside each visible list follow the active Date Added sort direction.
- Dropping a card into another status column updates status even while Date Added sorting is active.
- Dropping a card onto another card in the same column does not manually reorder while Date Added sorting is active.
- Disabling Date Added sorting restores manual card-to-card vertical reorder inside the visible column/group order.
- Dropping a card into a supported priority group updates the card's priority to that group value.
- Dropping a card into a supported priority group in another column updates both priority and status.
- Priority grouped drops write manual position only when Date Added sorting is disabled.
- Dropping onto `No priority`, by-person, due-date, or account group headers does not silently mutate those fields.
- No matrix cells are shown.
- Hidden cards do not contribute to subgroup headers or counts.

### Scenario KB-S3: From-Person Footer

Business logic covered:
- KB51
- KB52
- KB53
- KB54
- KB55
- KB56
- KB57
- KB58
- KB59
- KB60
- KB61
- KB62
- KB63
- KB64
- KB71
- KB72

Given:
- User A creates or transfers a node into a Logic Gate Kanban board.
- The card is later moved between statuses by User B.
- The card is later transferred to another Logic Gate by User B.

Expected:
- The first Logic Gate card shows `from: User A {month/day local time}`.
- Moving within the same Logic Gate keeps `from: User A {original month/day local time}`.
- The transferred card in the target Logic Gate shows `from: User B {transfer month/day local time}`.
- Request status text appears on the bottom-right when present.
- The by-person footer stays on the bottom-right and does not truncate the timestamp.

### Scenario KB-S4: Requested Card Flow

Business logic covered:
- KB14
- KB15
- KB65
- KB66
- KB67
- KB68
- KB69
- KB70
- KB71
- KB72

Given:
- A Logic Gate has a generated user.
- Another user drops or creates a node into the requested column.

Expected:
- The requested card records the requesting user.
- The generated user can accept the request to pending.
- The generated user can decline the request to backlog.
- The requester can cancel the request to backlog.
- Requester metadata clears after accept, decline, or cancel.
- Placed-by metadata remains separate and can still display as `from: {person} {date/time}`.

### Scenario KB-S5: Saved Grouping Validation

Business logic covered:
- KB28
- KB31
- KB40
- KB41
- KB42
- KB43
- KB47
- KB48

Given:
- A client attempts to save a Logic Gate Kanban grouping.

Expected:
- Fields outside priority, due date, by person, and account are rejected.
- Date Added grouping is rejected because Date Added is a sort control, not a grouping field.
- Status grouping is rejected for Logic Gate Kanban.
- Duplicate grouping fields are rejected.
- Group/team principals are rejected.
- User principals are accepted.
- Changing valid optional grouping rows or Date Added sort direction writes the user's current Logic Gate Kanban saved view without an explicit Save button.
- Changing Date Added enabled state writes the user's current Logic Gate Kanban saved view without an explicit Save button.
- Date Added is not written as a saved-view grouping.

### Scenario KB-S6: Date Added Toggle And Drag Ordering

Business logic covered:
- KB17
- KB18
- KB35
- KB47
- KB48
- KB79
- KB80
- KB81
- KB82
- KB83
- KB85
- KB86
- KB87

Given:
- A Logic Gate Kanban board has multiple cards in the in-progress column.
- Date Added sorting is enabled.
- The board is optionally grouped by priority.
- The user drags the second visible card above the first visible card in the same status column.
- The user then drags that same card to the review column.
- The user drags a Priority 2 card onto a Priority 1 group header or card.
- The user disables Date Added sorting.
- The user drags a lower visible card above a higher visible card.

Expected:
- The same-column card-to-card drop while Date Added is enabled does not write a manual position change.
- The status-column drop while Date Added is enabled moves the card to review.
- The priority-group drop updates the card priority from 2 to 1.
- If the priority-group drop target is in another status column, the card status updates to that column too.
- With Date Added disabled, the manual vertical drop writes sparse card position and the moved card appears at the requested visible location.
- The saved view stores the Date Added enabled state and direction separately from grouping rows.

### Scenario KB-S7: Direct Email Card Transfer Onto Target Node

Business logic covered:
- KB89
- KB90
- KB91
- KB92
- KB93
- KB94
- KB95
- KB96
- KB97
- KB98
- KB99

Given:
- A user drags an email from My Triage or from a mailbox-capable Shared Triage inbox into a Logic Gate so the system creates a Pending node card from that email.
- The source email-created card shows the email icon.
- Another normal node card is visible on the same Logic Gate Kanban board.

Expected:
- Hovering the source email-created card over blank column space keeps normal card move/reorder semantics.
- Hovering the source email-created card over the normal target card shows the full-card email attachment target state, not the before/after insertion marker.
- Dropping on the target card attaches the email to the target node.
- The source email-created card disappears from the board after the transfer.
- The temporary source node created from the email is deleted.
- The target card remains on the board and does not become a direct-email-created card solely because an email was attached to it.
- The transferred email does not return to My Triage.
- The transfer works from the stored email-node provenance even if the actor's personal mailbox is not connected.
- The initial conversion sets the original source email to unstarred and reconciles Home from `unstarred_message_ids`; the later card-to-card transfer does not call the mailbox provider to star or unstar the email.
- Matching workspace events from the original local conversion do not repeatedly reload the Home workspace panel or source mail list, and do not refill the source list from stale prefetched pages, after the board has already been updated from the conversion response.
