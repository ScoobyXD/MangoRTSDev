# Process Story: Restoring Deleted Editor Textboxes

A user deletes a Node, Project, or Logic Gate that contains current textboxes and manual history. Before the owner rows are deleted, the Recycle Bin payload copies the matching final current/history rows. For a Node it also copies `node_textbox_chats`, `node_content_changes`, `node_content_change_seen`, `node_textbox_seen_snapshots`, exact `email_relationships`, and final `attachment_relationships`. Neither Node, Project, nor Logic Gate copies a legacy information/projection table.

Restore recreates the owner first, then textboxes/history, chats and seen/change rows, email relationships, and finally attachment relationships. An existing soft-retired attachment relationship is reactivated from its snapshot instead of being skipped by `ON CONFLICT`. The attachment itself must still exist; permanent last-owner cleanup remains S3-before-Postgres and retry-safe. Permanent delete removes the payload, including those final editor copies.

Old recycle payloads created before the six-table cutover are converted in place.
Their HTML-era textboxes and manual saves must pass the same text-preserving
HTML-to-Tiptap converter before legacy editor tables can be removed.

Last updated: 2026-08-04

# Recycle Bin Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: owner stamping, user-scoped list/restore, admin-scoped list/permanent delete, restore behavior, project-association preservation, generated-column-safe PostgreSQL restore, and large batch recycle flows have backend coverage. Frontend select-all and admin grouping behavior is documented here but not yet mapped to an automated frontend test.

## Business Logic

RB1 - Recycle Bin reads require a company ID.
RB2 - Recycle Bin reads, restores, and permanent deletes require an authenticated actor with access to the company.
RB3 - A recycle-bin item belongs to the user who performed the delete, stored as `deleted_by_user_id`.
RB4 - Recycle-bin ownership is based on the deletion actor, not the deleted object's creator, assignee, GVIC participant, or current viewer permissions.
RB5 - Normal users list only recycle-bin items where `company_id` and `deleted_by_user_id` both match the current actor.
RB6 - Recycle-bin rows without a deleting user are not shown in a normal user's Recycle Bin.
RB7 - Restoring recycle-bin items requires at least one recycle-bin item ID.
RB8 - Restore can only act on recycle-bin item IDs owned by the current actor in the current company.
RB9 - A cross-user restore attempt returns not found and must not restore the underlying object.
RB10 - Permanently deleting recycle-bin items requires at least one recycle-bin item ID.
RB11 - Permanent delete is destructive purge and requires dev admin or company admin authority.
RB12 - Non-admin permanent delete attempts return forbidden and must not remove recycle-bin rows.
RB13 - Company Explorer target deletion creates recycle-bin rows before deleting the underlying objects in that target's actual deletion scope. Deleting a Project removes the Project and its Project-owned associations, critical-path rows, placement, final textboxes/chats/email relationships, and attachment owner links, but it must not delete related Nodes, Logic Gates, their Node assignments, normalized email content, shared files with another owner, or their Kanban boards.
RB14 - Recycle-bin rows preserve the deleted root object's kind, ID, label, folder kind when relevant, deleter user ID, deletion timestamp, restore payload, and contained-item summary.
RB15 - Deleting a folder or logic gate records objects that are actually contained in its deletion scope so the UI can explain what will return with a restore. A project recycle item does not describe related nodes or Logic Gates as contained because those resources remain active.
RB16 - Restoring one or more recycle-bin items merges their restore payloads and restores the underlying objects, relationships, placements, and related data captured at delete time. PostgreSQL restore inserts only writable stored columns; generated columns are omitted and recomputed by PostgreSQL so an affected historical payload remains restorable.
RB17 - A successful restore removes the restored recycle-bin rows.
RB18 - A successful restore updates canonical rows, independently required domain facts, and read versions for the restored targets; it does not publish a generic workspace browser event.
RB19 - Permanent delete removes only the selected recycle-bin rows and their restore payloads; the deleted objects remain gone.
RB20 - Recycle-bin lists sort by deletion timestamp descending, then recycle-bin item ID descending.
RB21 - The frontend prunes selected recycle-bin IDs after a reload so selection cannot reference rows that disappeared.
RB22 - Restore and permanent-delete toolbar actions are disabled until at least one currently loaded item is selected.
RB23 - Select all selects every currently loaded personalized recycle-bin row.
RB24 - When every currently loaded row is already selected, the select-all control clears the selection.
RB25 - Restore and permanent-delete actions operate only on selected recycle-bin IDs in the actor's current scope.
RB26 - Dev admins and company admins list all recycle-bin rows for the company, grouped in the UI by deleting user with user-group context when available.
RB27 - Admin permanent delete can purge any selected recycle-bin row in the company, regardless of which user originally deleted it.
RB28 - Restore remains scoped to the deleting user; an admin aggregate view must not imply that an admin can restore another user's recycle-bin item unless a future rule explicitly allows it.
RB29 - Recycle payloads preserve current and manual-history rows from `node_textboxes`, `project_textboxes`, `logic_gate_textboxes`, and their three `_history` tables. Old payloads must be converted before editor cleanup; disabled automatic snapshots are not manual history and are excluded.
RB30 - A new Project recycle payload stores `project_textbox_chats` after its Project textbox owners and stores exact `email_relationships` in relationship order. It does not store `project_information` or `project_projection_table`.
RB31 - A new Logic Gate recycle payload stores `logic_gate_textboxes` and `logic_gate_textboxes_history` after the Logic Gate owner plus exact final relationships. It stores no Logic Gate chat rows and does not store `logic_gate_information` or `logic_gate_projection_table`.

## Scenarios

### Scenario RB-S1: Personalized Recycle Bin Ownership

Business logic covered:
- RB1
- RB2
- RB3
- RB4
- RB5
- RB6

Given:
- Two users belong to the same company.
- User A deletes one node.
- User B deletes a different node.

Expected:
- User A's Recycle Bin lists only the item User A deleted.
- User B's Recycle Bin lists only the item User B deleted.
- Each listed row has `deleted_by_user_id` set to the deleting actor.
- Rows with no deleting actor are hidden from normal personalized Recycle Bin reads.

### Scenario RB-S2: Restore Is User-Scoped

Business logic covered:
- RB7
- RB8
- RB9
- RB16
- RB17
- RB18

Given:
- User A has a recycle-bin item.
- User B knows or submits User A's recycle-bin item ID.

Expected:
- User B's restore request returns not found.
- The underlying object remains deleted after User B's failed restore.
- User A can restore the item.
- The object and captured relationships or placements return.
- The restored recycle-bin row is removed.
- Canonical rows and read versions are updated for the restored targets, and only independently required durable domain facts are appended; no generic workspace browser event is published.

### Scenario RB-S3: Permanent Delete Is Admin-Scoped

Business logic covered:
- RB10
- RB11
- RB12
- RB19
- RB27

Given:
- User A has a recycle-bin item.
- User B is not a dev admin or company admin and knows or submits User A's recycle-bin item ID.
- A company admin knows or submits User A's recycle-bin item ID.

Expected:
- User B's permanent-delete request returns forbidden.
- User A's recycle-bin row remains available.
- The company admin can permanently delete the item.
- After admin permanent delete, the recycle-bin row and restore payload are gone.
- The deleted object is not restored by permanent delete.

### Scenario RB-S4: Delete Payload And Contained Summary

Business logic covered:
- RB13
- RB14
- RB15
- RB16

Given:
- A user deletes a folder or logic gate with contained resources.
- A user deletes a project that is associated with existing nodes and Logic Gates.

Expected:
- The root deleted object gets one recycle-bin row owned by the deleting user.
- The row records the root object's kind, ID, label, folder kind when relevant, deleter, and timestamp.
- Folder and Logic Gate rows include contained-item summary data only for objects that will come back with restore.
- The project row does not list its related nodes or Logic Gates as contained, and those resources and their node-to-gate assignments remain available after project deletion.
- Restore rebuilds the captured underlying objects and relationships.
- Restore succeeds when a captured table has generated columns by restoring only writable stored columns and allowing PostgreSQL to recompute generated values.

### Scenario RB-S5: Selection And Bulk Actions

Business logic covered:
- RB20
- RB21
- RB22
- RB23
- RB24
- RB25

Given:
- A user has multiple personalized recycle-bin rows.
- The Recycle Bin page loads those rows.

Expected:
- Rows appear newest first.
- Restore and permanent delete are disabled with no selection.
- Select all selects every currently loaded row.
- Selecting all again clears selection.
- After reload or mutation, stale selected IDs are removed.
- Restore and permanent delete submit only the selected personalized row IDs.

### Scenario RB-S6: Admin Aggregate Recycle Bin

Business logic covered:
- RB26
- RB27
- RB28

Given:
- User A deletes one item.
- User B deletes a different item.
- A company admin opens the Recycle Bin page.

Expected:
- The admin list includes both users' recycle-bin rows.
- The UI groups rows by deleting user and displays user-group context where company user-group data is available.
- The admin can permanently delete either row.
- Restore remains available only for rows deleted by the current actor.

### Scenario RB-S7: Editor Textboxes Survive Recycle Restore

Business logic covered:

- RB16
- RB19
- RB29
- RB31

Given:

- A Node, Project, or Logic Gate has current JSON textboxes and one or more manual
  history batches.
- The user deletes that owner and later restores its recycle-bin item.

Expected:

- The recycle payload contains the owner's matching current and manual-history
  rows from the six permanent editor tables.
- Automatic snapshots are not added to manual history.
- Restore recreates the owner before its textbox rows, so foreign keys remain
  valid and current content plus manual history return together.
- A Logic Gate payload contains no legacy information/projection row and no
  speculative chat row; exact final relationships are restored in dependency order.
- Permanent delete removes the only recycled copies and does not recreate them.
