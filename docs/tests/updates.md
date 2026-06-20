Last updated: 2026-06-20

# Updates Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: 0% (rule IDs are not mapped to automated tests yet)

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
