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
KB4 - User-specific grouping settings do not belong to the Kanban board record and do not belong to a specific Logic Gate.
KB5 - User-specific grouping settings are saved as user preferences so the same user's selected Logic Gate Kanban grouping applies across all Logic Gate Kanban boards.
KB6 - Generic Kanban board card APIs remain node-card APIs. Logic Gate work state should continue to use Logic Gate assignment/work-item commands where those command paths exist.
KB7 - Deleting a node removes its Kanban card placements and Logic Gate Kanban projection rows.
KB8 - Deleting a Logic Gate removes the Logic Gate Kanban board/work placements owned by that Logic Gate.
KB9 - Logic Gate Kanban board reads must be permission-filtered by the owning Logic Gate.
KB10 - Users without view access to the owning Logic Gate must not receive card rows, projection deltas, saved board state, or card metadata for that Logic Gate board.

### Columns, Status, And Card State

KB11 - The visible Kanban columns are the status lanes for the board.
KB12 - A card's column is the visible status unless the card is explicitly marked as an issue.
KB13 - Issue cards visually override status grouping as `Issue` when grouped by status.
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
KB28 - Grouping supports these fields only: status, priority, due date, by person, and account.
KB29 - Grouping supports ascending and descending direction for each grouping level.
KB30 - A saved grouping may contain multiple grouping levels.
KB31 - A saved grouping must not contain the same field more than once.
KB32 - Status grouping uses the card's current Kanban status lane, with issue cards grouped as `Issue`.
KB33 - Priority grouping uses node/card priority values 1 through 5 and places missing priority under `No priority`.
KB34 - Due date grouping uses the card/node due date and places missing dates under `No due date`.
KB35 - By-person grouping uses the person who originally created or transferred the card into the current Logic Gate, not department, HR group, team, or GVIC role name.
KB36 - Missing by-person provenance is grouped under `No person`.
KB37 - Account grouping uses assigned accounts. A card with multiple accounts can appear in each matching account subgroup.
KB38 - A card with no account appears under `No account`.
KB39 - Saved Logic Gate Kanban groupings use `saved_views.surface = logic_gate_kanban`.
KB40 - Saved Logic Gate Kanban groupings must use `principal = user`.
KB41 - Saved Logic Gate Kanban groupings must reject group/team principals.
KB42 - Saved Logic Gate Kanban groupings must reject fields that belong to My Work or Updates only, such as project or logic gate grouping fields.
KB43 - The active Logic Gate Kanban saved grouping is selected through a per-user saved-view preference row.
KB44 - The preference is keyed by company, surface, and user, not by board ID and not by Logic Gate ID.
KB45 - Selecting a saved Logic Gate Kanban grouping on one Logic Gate must apply when the same user opens another Logic Gate Kanban board.
KB46 - Another user in the same company can choose a different selected Logic Gate Kanban grouping without changing the first user's preference.
KB47 - Deleting a selected saved grouping clears the user's selected Logic Gate Kanban grouping preference.
KB48 - If a user has no selected Logic Gate Kanban grouping, the board renders ungrouped.

### Card Provenance Footer

KB49 - Logic Gate Kanban cards display muted footer metadata at the bottom of the card.
KB50 - Request status text such as `Request pending` or `Request sent to {person}` appears on the bottom-left of the card footer.
KB51 - Placement provenance appears on the bottom-right of the card footer.
KB52 - Placement provenance text must use the exact prefix `by: ` followed by the person's display name.
KB53 - The by-person display must resolve to a company user's display name when available.
KB54 - If the display name is unavailable, the by-person display may fall back to email or user ID.
KB55 - The by-person footer must not show department names, HR groups, user groups, teams, GVIC role names, or generic ownership labels.
KB56 - A first assignment into a Logic Gate records the actor user as the placed-by user.
KB57 - Moving a card within the same Logic Gate preserves the original placed-by user.
KB58 - Moving or transferring a card into a different Logic Gate records the transfer actor as the placed-by user for the new Logic Gate.
KB59 - Converting an email or triage item into a Logic Gate Kanban card records the converting actor as the placed-by user.
KB60 - Existing historical rows with no placed-by user may render without a by-person footer until provenance is available.

### Requested Work Flow

KB61 - Nodes dropped or created into a Logic Gate requested column store the requesting user.
KB62 - The generated user for the Logic Gate sees accept and decline actions for requested nodes sent by another user.
KB63 - Accepting a requested node moves it to pending and clears the request sender.
KB64 - Declining a requested node moves it to backlog and clears the request sender.
KB65 - The requesting user sees request-sent status on the requested card.
KB66 - The requesting user can cancel the request, which moves the card back to backlog.
KB67 - Request metadata and placed-by metadata are separate fields and must not overwrite each other.
KB68 - A requested card can still show `by: {person}` in the footer when placement provenance exists.

### Search, Filters, And Live Updates

KB69 - Search filters cards before subgrouping is built.
KB70 - Account filters cards before subgrouping is built.
KB71 - Subgroup headers should reflect only the cards currently visible after search and account filters.
KB72 - Kanban projection live deltas must include placed-by metadata when it changes.
KB73 - A projection delta that changes card placement, title, priority, due date, issue state, accounts, requested-by, or placed-by must update the rendered card without requiring a full page refresh.
KB74 - Sequence gaps, invalid deltas, or permission uncertainty may trigger a targeted Kanban board refresh.

## Scenarios

### Scenario KB-S1: User Saves Logic Gate Kanban Grouping

Business logic covered:
- KB4
- KB5
- KB21
- KB22
- KB28
- KB29
- KB30
- KB39
- KB40
- KB43
- KB44
- KB45
- KB46
- KB48

Given:
- User A opens Logic Gate A's Kanban board.
- User A creates a saved grouping with priority ascending and by person descending.
- User A selects that saved grouping.
- User A then opens Logic Gate B's Kanban board.
- User B opens either Logic Gate Kanban board.

Expected:
- User A sees the same selected grouping on Logic Gate B.
- User A's selected grouping is stored as a user preference for `logic_gate_kanban`.
- User B does not inherit User A's selected grouping.
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
- KB69
- KB70
- KB71

Given:
- A Logic Gate Kanban board has cards in pending, in progress, review, done, requested, and backlog columns.
- The selected grouping is priority, due date, by person, and account.
- A search or account filter is active.

Expected:
- Each existing column still renders as a Kanban column.
- Subgroup headers appear inside each column for the currently visible cards.
- Dropping a card on another card or into a column keeps normal Kanban movement behavior.
- No matrix cells are shown.
- Hidden cards do not contribute to subgroup headers or counts.

### Scenario KB-S3: By-Person Footer

Business logic covered:
- KB49
- KB50
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
- KB67
- KB68

Given:
- User A creates or transfers a node into a Logic Gate Kanban board.
- The card is later moved between statuses by User B.
- The card is later transferred to another Logic Gate by User B.

Expected:
- The first Logic Gate card shows `by: User A`.
- Moving within the same Logic Gate keeps `by: User A`.
- The transferred card in the target Logic Gate shows `by: User B`.
- Request status text remains on the bottom-left when present.
- The by-person footer stays on the bottom-right.

### Scenario KB-S4: Requested Card Flow

Business logic covered:
- KB14
- KB15
- KB61
- KB62
- KB63
- KB64
- KB65
- KB66
- KB67
- KB68

Given:
- A Logic Gate has a generated user.
- Another user drops or creates a node into the requested column.

Expected:
- The requested card records the requesting user.
- The generated user can accept the request to pending.
- The generated user can decline the request to backlog.
- The requester can cancel the request to backlog.
- Requester metadata clears after accept, decline, or cancel.
- Placed-by metadata remains separate and can still display as `by: {person}`.

### Scenario KB-S5: Saved Grouping Validation

Business logic covered:
- KB28
- KB31
- KB39
- KB40
- KB41
- KB42
- KB47

Given:
- A client attempts to save a Logic Gate Kanban grouping.

Expected:
- Fields outside status, priority, due date, by person, and account are rejected.
- Duplicate grouping fields are rejected.
- Group/team principals are rejected.
- User principals are accepted.
- Deleting the selected saved grouping clears the user's selected preference.
