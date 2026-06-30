Last updated: 2026-06-29

# Kanban Board Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: 0% (rule IDs are not mapped to automated tests yet)

## Scope

These rules cover Kanban board behavior, with extra detail for Logic Gate Kanban boards. A Logic Gate Kanban board is the Kanban work board opened for a Logic Gate, usually using board ID `logic-gate:{logicGateID}`.

## Business Logic

### Board Identity And Data Ownership

KB1 - A Logic Gate Kanban board displays node work assigned to one Logic Gate.
KB2 - A Logic Gate Kanban board uses the Logic Gate as the owning resource for access and persistence.
KB3 - Logic Gate Kanban board contents are not independent per-user board copies; every authorized user sees the same underlying cards, columns, statuses, and card order.
KB4 - User-specific grouping and Date Added sort settings do not belong to the Kanban board record and do not belong to a specific Logic Gate.
KB5 - User-specific grouping and Date Added sort settings are saved as user preferences so the same user's selected Logic Gate Kanban view applies across all Logic Gate Kanban boards.
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
KB26 - Grouping must not create matrix cells that can mutate status, priority, due date, or account by dropping into a cell.
KB27 - Card-to-card and card-to-column drag/drop continues to use normal Kanban movement semantics while grouping is active.
KB28 - Grouping supports these fields only: priority, due date, by person, and account.
KB29 - Grouping supports ascending and descending direction for each grouping level.
KB30 - The visible grouping popover does not show a saved-view selector, new-view button, delete button, save button, or saved-view name field, and nested grouping rows must remain inside the popover boundary.
KB31 - A saved grouping must not contain the same field more than once.
KB32 - A grouping stack may contain multiple grouping levels.
KB33 - Logic Gate Kanban does not inject mandatory grouping rows; every grouping row is optional and user-controlled.
KB34 - Due date grouping uses the card/node due date and places missing dates under `No due date`.
KB35 - Date Added is not a grouping field; it is a separate Asc/Desc sort control that orders visible cards by the card-added datetime.
KB36 - By-person grouping uses the person who originally created or transferred the card into the current Logic Gate, not department, HR group, team, or GVIC role name.
KB37 - Missing by-person provenance is grouped under `No person`.
KB38 - Account grouping uses assigned accounts. A card with multiple accounts can appear in each matching account subgroup.
KB39 - A card with no account appears under `No account`.
KB40 - Priority grouping uses node/card priority values 1 through 5 and places missing priority under `No priority`.
KB41 - Saved Logic Gate Kanban groupings must use `principal = user`.
KB42 - Saved Logic Gate Kanban groupings must reject group/team principals.
KB43 - Saved Logic Gate Kanban groupings must reject fields that belong to My Work, Updates, or Kanban status-only behavior, such as project, logic gate, team, type, or status.
KB44 - Saved Logic Gate Kanban extra groupings use `saved_views.surface = logic_gate_kanban`.
KB45 - The active Logic Gate Kanban saved grouping is selected through a per-user saved-view preference row.
KB46 - The preference is keyed by company, surface, and user, not by board ID and not by Logic Gate ID.
KB47 - Changing optional grouping rows or Date Added sort direction immediately saves the current user settings without an explicit Save action.
KB48 - Saved Logic Gate Kanban views persist the user's optional grouping stack plus `settings.date_added_sort_direction`; Date Added must not be written as a grouping row.
KB49 - The saved optional grouping stack from one Logic Gate must apply when the same user opens another Logic Gate Kanban board.
KB50 - Another user in the same company can choose different optional Logic Gate Kanban groupings and Date Added sort direction without changing the first user's preference.
KB51 - If a user has no selected Logic Gate Kanban saved view, the board renders ungrouped until the user adds grouping rows.

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
- User A toggles the Date Added sort control to the desired direction.
- User A then opens Logic Gate B's Kanban board.
- User B opens either Logic Gate Kanban board.

Expected:
- User A sees the same optional priority and by-person grouping rows on Logic Gate B.
- User A sees the same saved Date Added sort direction on Logic Gate B.
- User A's optional grouping stack is saved without pressing a Save button.
- Date Added remains a separate sort control and is saved as `settings.date_added_sort_direction`, not as a grouping row.
- The visible Group popover does not show saved-view selection, New, Delete, Save, or saved-view name controls.
- User A's selected grouping is stored through a user preference for `logic_gate_kanban`.
- User B does not inherit User A's selected grouping.
- User B does not inherit User A's Date Added sort direction.
- No Logic Gate board row stores the selected grouping.

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

Given:
- A Logic Gate Kanban board has cards in pending, in progress, review, done, requested, and backlog columns.
- The selected grouping is priority, due date, by person, and account.
- Date Added sorting is active in ascending or descending order.
- A search or account filter is active.

Expected:
- Each existing column still renders as a Kanban column.
- Subgroup headers appear inside each column for the currently visible cards.
- Cards inside each visible list follow the active Date Added sort direction.
- Dropping a card on another card or into a column keeps normal Kanban movement behavior.
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
- Date Added is not written as a saved-view grouping.
