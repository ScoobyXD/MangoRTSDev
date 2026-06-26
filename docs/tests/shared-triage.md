Last updated: 2026-06-26

# Shared Triage Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (frontend helper coverage exists for mailbox-capable Shared Triage rows; rule IDs are not fully mapped to automated tests yet)

## Business Logic

ST1 - Shared Triage shows shared inbox folders and mailboxes that are visible to the current user.
ST2 - Normal users only see shared inbox folders where effective access grants at least view access.
ST3 - Dev admins and company admins can see all shared inbox folders with admin-level effective access; company managers follow shared inbox resource permissions.
ST4 - Creating a shared inbox folder requires company access, a nonblank name, and edit access to the selected parent when the folder is nested.
ST5 - Creating a shared inbox initializes default access as no access and gives the creator edit access.
ST6 - Shared inbox folders and mailbox entries use the same tree model, with mailbox-capable entries identified by a shared inbox entry type, account email, and company email connection link.
ST7 - Renaming, moving, or changing mailbox linkage for a shared inbox folder requires edit access.
ST8 - Deleting a shared inbox folder requires edit access.
ST9 - Protected shared inbox folders cannot be renamed or deleted.
ST10 - Deleting a mailbox-capable shared inbox removes the Shared Triage work surface and its shared inbox permissions/GVIC rows, but does not automatically revoke the reusable company-owned mailbox credential.
ST11 - Reading shared inbox folders and messages uses the company-owned shared mailbox grant instead of the viewer's personal mailbox grant.
ST12 - Shared mailbox caches are scoped by shared account/grant so one shared mailbox does not leak into another.
ST13 - Sending mail from a shared inbox requires edit access to that shared inbox.
ST14 - View-only shared inbox access can read mailbox content but cannot send from that mailbox.
ST15 - Reading shared inbox access settings requires manager/admin authority and view access to the shared inbox.
ST16 - Updating shared inbox access settings requires manager/admin authority and edit access to the shared inbox.
ST17 - Shared inbox access settings return default access, explicit access grants, GVIC assignments, effective access, whether the actor can edit permissions, and whether the actor can edit manager permissions.
ST18 - Updating shared inbox access changes resource access grants/default access and must not convert GVIC assignments into permission grants.
ST19 - Shared inbox access grants support user and group principals.
ST20 - If shared inbox access storage is unavailable, access endpoints return a service-unavailable error instead of silently succeeding.
ST21 - Shared inbox GVIC assignment APIs apply only to mailbox/shared inbox resources, not plain organizational folders.
ST22 - Shared Triage must not show private personal mailbox messages unless they were explicitly added through a shared inbox path.
ST23 - Shared inbox access and tree changes publish workspace events so other clients refresh.
ST24 - Company-owned shared mailbox credentials are stored in company_email_connections, not as permission-bearing users.
ST25 - A mailbox address used by a shared inbox does not need to be a Mango user and does not need company membership.
ST26 - Each mailbox-capable shared inbox stores a company_email_connection_id foreign key that points to the company-owned mailbox credential used for mail operations.
ST27 - shared_inboxes.account_email remains display/search metadata, but the credential source of truth is the company_email_connection_id link.
ST28 - Personal My Triage mailbox credentials stay in user_email_connections as personal-only rows and must not be used as the source of truth for Shared Triage mailbox access.
ST29 - Shared inbox OAuth setup or reconnect writes or updates company_email_connections for the target company and mailbox.
ST30 - Creating or reassigning a mailbox-capable shared inbox requires an existing connected company email connection for that company and account email, or starts the shared inbox OAuth repair flow for a user allowed to manage that shared inbox.
ST31 - Existing legacy user_email_connections rows with connection_scope = shared are backfilled into company_email_connections, linked to matching shared_inboxes, then removed before the legacy connection_scope column is dropped.
ST32 - Users with view or edit permission to a shared inbox can open the shared inbox without connecting that mailbox to their personal account.
ST33 - If a company-owned shared connection is missing or expired, normal permitted users see a repair-required state and do not receive a personal OAuth prompt.
ST34 - If a company-owned shared connection is missing or expired, users who can manage that shared inbox can start shared inbox OAuth reconnect for the company-owned credential.
ST35 - Shared inbox mail actions use the company-owned grant but are authorized and audited as the currently logged-in user.
ST36 - Shared inbox permissions remain stored on resource_permissions with resource_type = shared_inbox and resource_id = shared_inboxes.shared_inbox_id.
ST37 - Shared inbox GVIC assignments remain stored on resource_gvic_assignments with resource_type = shared_inbox and resource_id = shared_inboxes.shared_inbox_id.
ST38 - Email connection records do not receive Shared Triage permissions or GVIC assignments; permissions and GVIC are assigned to the shared inbox work surface.
ST39 - Plain Shared Triage folders are organizational containers only; selecting one clears mail state and must not call email folder, message list, message detail, prefetch, or load-more endpoints.
ST40 - Shared Triage mail refresh is driven by Nylas webhooks through backend communications realtime, with browser focus/visibility refresh as a safety refresh; the browser must not poll the message list every 30 seconds.
ST41 - Communications realtime events refresh the active mail-capable mailbox view only; active Shared Triage root, plain Shared Triage folders, My Work, Updates, and GVIC matrix views must not issue mail refresh GETs from those events.
ST42 - Shared Triage mailbox inboxes must continue to live-update when mailbox messages are created, updated, or deleted.
ST43 - Shared Triage mailbox inboxes must show a fixed, predictable message batch size of 20 messages per page.
ST44 - Shared Triage mailbox inboxes must immediately prefetch the next message page after the first visible page loads, without waiting for scrolling or the archive/advance action.
ST45 - Scrolling a Shared Triage mailbox inbox must not archive messages and must not load the next primary-inbox page.
ST46 - Advancing a Shared Triage mailbox inbox page is an explicit user action that archives only the messages visible on the current page.
ST47 - Advancing must display the prefetched next page before archiving the previous page whenever a prefetched page is available.
ST48 - Advancing must freeze the previous page's message IDs at click time so live updates cannot change what gets archived.
ST49 - The advance/archive action must remain immediately reusable after a page advances unless accepting the visible page would exceed the hidden archive queue limit.
ST50 - Advancing must enqueue the frozen visible message IDs for background archive work instead of waiting for those provider mutations before allowing the user to continue.
ST51 - The hidden archive queue may contain no more than 140 pending emails across queued and in-flight archive work.
ST52 - If accepting the current visible page would exceed 140 pending archive emails, the advance/archive action is disabled until enough queued archive work completes.
ST53 - Background archive work must send archive requests in two-message client batches and run those batches in parallel so the provider gate, not the UI, controls final throughput.
ST54 - Advancing must prioritize showing the prefetched next page, enqueueing the previous page, and making the action usable again before any folder metadata reconciliation.
ST55 - Folder metadata refresh after archive or unarchive is only a count/metadata reconciliation step and must not fetch the next message page or block the prefetched page from being shown.
ST56 - If folder metadata reconciliation is slow or fails after archive or unarchive, the Shared Triage mailbox list remains usable and counts can reconcile later.
ST57 - If no next page is available, advancing archives the current visible page and leaves the mailbox inbox empty until live updates or a refresh provide more messages.

## Scenarios

### Scenario ST-S1: Shared Inbox Visibility

Business logic covered:
- ST1
- ST2
- ST3
- ST6
- ST22
- ST32

Given:
- A company has several shared inbox folders and mailbox-capable shared inboxes.
- User A has view access to one shared inbox and no access to another.
- A company admin and a company manager belong to the same company.

Expected:
- User A only sees the shared inboxes where effective access grants view or higher.
- User A does not see private personal mailbox messages in Shared Triage.
- The company admin sees shared inboxes with admin-level effective access.
- The company manager sees only shared inboxes where effective access grants view or higher.
- Mailbox-capable entries and plain folder entries are represented in the same tree without mixing their mailbox behavior.
- User A opens a visible shared inbox without connecting that mailbox to User A's personal account.

### Scenario ST-S2: Create, Rename, Move, And Delete Shared Inbox Folders

Business logic covered:
- ST4
- ST5
- ST7
- ST8
- ST9
- ST10
- ST23
- ST26
- ST27
- ST30

Given:
- A user can edit one shared inbox parent folder and only view another parent folder.
- A protected shared inbox folder exists.
- A mailbox-capable shared inbox has a linked company email connection.

Expected:
- Creating under the editable parent succeeds and gives the creator edit access while leaving default access as no access.
- Creating under the view-only parent fails.
- Rename, move, and mailbox linkage changes require edit access.
- Protected shared inbox folders cannot be renamed or deleted.
- Deleting a mailbox-capable shared inbox removes the Shared Triage work surface without treating the company email connection as a user permission record.
- Successful changes publish workspace refresh events.

### Scenario ST-S3: Shared Mailbox Read And Send

Business logic covered:
- ST11
- ST12
- ST13
- ST14
- ST24
- ST25
- ST28
- ST35

Given:
- User A has view access to Shared Inbox 1.
- User B has edit access to Shared Inbox 1.
- Shared Inbox 2 uses a different shared mailbox grant.
- The mailbox address for Shared Inbox 1 is not a Mango user.

Expected:
- Reading Shared Inbox 1 uses its company-owned shared grant, not either user's personal mailbox grant.
- The mailbox address does not need a Mango user record or company membership.
- Cached folders/messages for Shared Inbox 1 do not appear under Shared Inbox 2.
- User A can read Shared Inbox 1 but cannot send from it.
- User B can send from Shared Inbox 1.
- User B's send action is authorized and audited as User B while using the shared grant.

### Scenario ST-S4: Shared Inbox Access Settings

Business logic covered:
- ST15
- ST16
- ST17
- ST18
- ST19
- ST20
- ST36
- ST37
- ST38

Given:
- A shared inbox has default access, user grants, group grants, and GVIC assignments.
- One regular user has view access and a company manager has edit access.
- The access store can be available or unavailable.

Expected:
- The regular view-only user cannot read or update access settings.
- The company manager can update default access and explicit resource grants for regular company users.
- The response includes default access, explicit grants, GVIC assignments, effective access, can-edit-permissions, and can-edit-manager-permissions.
- GVIC assignments are not converted into resource permission grants.
- User and group grants are both accepted.
- Permissions and GVIC rows target the shared inbox resource, not the company email connection.
- If storage is unavailable, the endpoint returns service unavailable.

### Scenario ST-S5: Shared Inbox GVIC Scope

Business logic covered:
- ST21
- ST37
- ST38

Given:
- The company has a mailbox-capable shared inbox and a plain shared inbox folder.

Expected:
- GVIC assignments can be managed for the mailbox/shared inbox resource.
- GVIC assignments are rejected for a plain organizational folder when that resource is not a mailbox/shared inbox.
- GVIC assignments do not move when the shared inbox is reconnected to the same or a different company email connection.

### Scenario ST-S6: Company-Owned Shared Mailbox Connection Setup

Business logic covered:
- ST24
- ST25
- ST26
- ST27
- ST28
- ST29
- ST30
- ST31

Given:
- An admin starts shared inbox OAuth for support@example.com in Company A.
- support@example.com is not a Mango user.
- Company A has a Shared Triage mailbox entry for support@example.com.
- Legacy shared-scope user email connection rows may already exist from older shared inbox setup flows.

Expected:
- The OAuth callback writes or updates company_email_connections for Company A and support@example.com.
- The shared inbox stores company_email_connection_id and keeps account_email only as display/search metadata.
- The shared inbox does not require support@example.com to exist as a Mango user.
- Personal My Triage credentials in user_email_connections remain separate from the company-owned shared connection.
- Legacy shared-scope rows are backfilled into company_email_connections, linked to matching shared inboxes, removed from user_email_connections, and followed by dropping the legacy connection_scope column.
- Creating or reassigning a mailbox-capable shared inbox fails or starts shared OAuth repair when no connected company email connection exists.

### Scenario ST-S7: Shared Connection Missing Or Expired

Business logic covered:
- ST33
- ST34
- ST35

Given:
- A shared inbox is visible to User A and User B.
- User A has view access only.
- User B can manage mail for that shared inbox.
- The company-owned shared connection is missing, disconnected, or reauth-required.

Expected:
- User A sees a shared inbox repair-required state and is not asked to connect the mailbox to User A's personal account.
- User B can start the shared inbox reconnect flow for the company-owned credential.
- After reconnect, permitted users open the same shared inbox without personal OAuth.
- Mail operations still use the company-owned grant and the current user's identity for authorization and audit.

### Scenario ST-S8: Shared Folder Selection And Mail Refresh

Business logic covered:
- ST6
- ST11
- ST12
- ST22
- ST39
- ST40
- ST41

Given:
- Shared Triage contains a plain parent folder and a mailbox-capable shared inbox entry under that folder.
- The mailbox-capable shared inbox has entry_type = shared_inbox, an account email, and a linked company email connection.
- The browser has an active communications realtime subscription.

Expected:
- Selecting the plain parent folder clears any previous mail list and selected message state.
- Selecting the plain parent folder does not call email folders, message list, message detail, prefetch, or load-more endpoints.
- Selecting the plain parent folder does not retry mail GETs when the row has no mailbox connection because folders are not mailbox resources.
- Selecting the mailbox-capable shared inbox may load mail using the company-owned shared grant.
- Nylas message.created, message.updated, message.deleted, and message.opened events may refresh the active mailbox-capable shared inbox.
- Those realtime events do not trigger mail GETs while Shared Triage root, a plain Shared Triage folder, My Work, Updates, or a GVIC matrix view is active.
- Focus or visibility return may refresh the active mailbox-capable mail view, but there is no browser-side 30-second message polling loop.

### Scenario ST-S9: Shared Mailbox Paging And Explicit Archive Advance

Business logic covered:
- ST42
- ST43
- ST44
- ST45
- ST46
- ST47
- ST48
- ST49
- ST50
- ST51
- ST52
- ST53
- ST54
- ST55
- ST56
- ST57

Given:
- A user opens a mailbox-capable Shared Triage inbox with view access to the shared mailbox.
- The shared mailbox has more than 20 messages available.
- The first visible page and the next page can be read from the mailbox provider.

Expected:
- The visible page contains no more than 20 messages.
- The next page is prefetched after the visible page loads.
- Created, updated, and deleted message events still refresh the active mailbox view live.
- Scrolling the visible page does not archive any messages and does not append another primary-inbox page.
- Clicking the advance action freezes the currently visible message IDs, shows the prefetched next page, and enqueues only the frozen previous-page IDs for background archive.
- The frozen previous-page IDs are sent in two-message client batch requests that run in parallel in the background.
- The advance action becomes usable again immediately after the next page is shown and the previous page is queued.
- The hidden archive queue accepts at most 100 pending emails; if adding the current page would exceed that limit, the advance action is disabled until enough background archive work completes.
- Folder metadata refresh runs after the primary archive-and-next work as reconciliation only; it does not fetch the next email page.
- If the archive request fails after the next page is shown, the user remains on the next page and sees an archive failure.
- If there is no next page, clicking the advance action archives the visible page and leaves the list empty until more messages arrive or a refresh reloads the inbox.
