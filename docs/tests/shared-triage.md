Last updated: 2026-06-20

# Shared Triage Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: 0% (rule IDs are not mapped to automated tests yet)

## Business Logic

ST1 - Shared Triage shows shared inbox folders and mailboxes that are visible to the current user.
ST2 - Normal users only see shared inbox folders where effective access grants at least view access.
ST3 - Company managers and dev admins can see shared inbox folders with admin-level effective access.
ST4 - Creating a shared inbox folder requires company access, a nonblank name, and edit access to the selected parent when the folder is nested.
ST5 - Creating a shared inbox initializes default access as no access and gives the creator edit access.
ST6 - Shared inbox folders and mailbox entries use the same tree model, with mailbox-capable entries identified by an account email or shared connection.
ST7 - Renaming, moving, or changing mailbox linkage for a shared inbox folder requires edit access.
ST8 - Deleting a shared inbox folder requires edit access.
ST9 - Protected shared inbox folders cannot be renamed or deleted.
ST10 - Deleting a mailbox-capable shared inbox attempts to remove the backing Nylas shared grant, but the folder deletion result must still be reported clearly.
ST11 - Reading shared inbox folders and messages uses the shared mailbox grant instead of the viewer's personal mailbox grant.
ST12 - Shared mailbox caches are scoped by shared account/grant so one shared mailbox does not leak into another.
ST13 - Sending mail from a shared inbox requires edit access to that shared inbox.
ST14 - View-only shared inbox access can read mailbox content but cannot send from that mailbox.
ST15 - Reading shared inbox access settings requires view access to the shared inbox.
ST16 - Updating shared inbox access settings requires edit/admin-level permission management access.
ST17 - Shared inbox access settings return default access, explicit access grants, GVIC assignments, effective access, and whether the actor can edit permissions.
ST18 - Updating shared inbox access changes resource access grants/default access and must not convert GVIC assignments into permission grants.
ST19 - Shared inbox access grants support user and group principals.
ST20 - If shared inbox access storage is unavailable, access endpoints return a service-unavailable error instead of silently succeeding.
ST21 - Shared inbox GVIC assignment APIs apply only to mailbox/shared inbox resources, not plain organizational folders.
ST22 - Shared Triage must not show private personal mailbox messages unless they were explicitly added through a shared inbox path.
ST23 - Shared inbox access and tree changes publish workspace events so other clients refresh.

## Scenarios

### Scenario ST-S1: Shared Inbox Visibility

Business logic covered:
- ST1
- ST2
- ST3
- ST6
- ST22

Given:
- A company has several shared inbox folders and mailbox-capable shared inboxes.
- User A has view access to one shared inbox and no access to another.
- A company manager belongs to the same company.

Expected:
- User A only sees the shared inboxes where effective access grants view or higher.
- User A does not see private personal mailbox messages in Shared Triage.
- The company manager sees shared inboxes with admin-level effective access.
- Mailbox-capable entries and plain folder entries are represented in the same tree without mixing their mailbox behavior.

### Scenario ST-S2: Create, Rename, Move, And Delete Shared Inbox Folders

Business logic covered:
- ST4
- ST5
- ST7
- ST8
- ST9
- ST10
- ST23

Given:
- A user can edit one shared inbox parent folder and only view another parent folder.
- A protected shared inbox folder exists.
- A mailbox-capable shared inbox has a backing shared mailbox grant.

Expected:
- Creating under the editable parent succeeds and gives the creator edit access while leaving default access as no access.
- Creating under the view-only parent fails.
- Rename, move, and mailbox linkage changes require edit access.
- Protected shared inbox folders cannot be renamed or deleted.
- Deleting a mailbox-capable shared inbox attempts grant cleanup and reports the folder deletion result.
- Successful changes publish workspace refresh events.

### Scenario ST-S3: Shared Mailbox Read And Send

Business logic covered:
- ST11
- ST12
- ST13
- ST14

Given:
- User A has view access to Shared Inbox 1.
- User B has edit access to Shared Inbox 1.
- Shared Inbox 2 uses a different shared mailbox grant.

Expected:
- Reading Shared Inbox 1 uses its shared grant, not either user's personal mailbox grant.
- Cached folders/messages for Shared Inbox 1 do not appear under Shared Inbox 2.
- User A can read Shared Inbox 1 but cannot send from it.
- User B can send from Shared Inbox 1.

### Scenario ST-S4: Shared Inbox Access Settings

Business logic covered:
- ST15
- ST16
- ST17
- ST18
- ST19
- ST20

Given:
- A shared inbox has default access, user grants, group grants, and GVIC assignments.
- One user has view access and another has permission-management access.
- The access store can be available or unavailable.

Expected:
- The view-only user can read access settings but cannot update them.
- The permission manager can update default access and explicit resource grants.
- The response includes default access, explicit grants, GVIC assignments, effective access, and can-edit-permissions.
- GVIC assignments are not converted into resource permission grants.
- User and group grants are both accepted.
- If storage is unavailable, the endpoint returns service unavailable.

### Scenario ST-S5: Shared Inbox GVIC Scope

Business logic covered:
- ST21

Given:
- The company has a mailbox-capable shared inbox and a plain shared inbox folder.

Expected:
- GVIC assignments can be managed for the mailbox/shared inbox resource.
- GVIC assignments are rejected for a plain organizational folder when that resource is not a mailbox/shared inbox.
