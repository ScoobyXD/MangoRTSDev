Last updated: 2026-07-09

# Shared Triage Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (backend coverage exists for destructive delete vs remove-only and OAuth linkage; frontend helper coverage exists for mailbox-capable Shared Triage rows; `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts` covers unified editor adapter mounting and full rich-control exposure for Shared Triage compose/reply; rule IDs are not fully mapped to automated tests yet)

## Business Logic

ST1 - Shared Triage shows shared inbox folders and mailboxes that are visible to the current user.
ST2 - Normal `company_user` users only see shared inbox folders where effective access grants at least view access, and this folder-listing path must work without relying on a dev-admin or company-admin bypass.
ST3 - Dev admins and company admins can see all shared inbox folders with admin-level effective access; company managers and normal users follow Shared Triage resource policy from default access, direct user grants, and group grants.
ST4 - Creating a Shared Triage folder or mailbox-capable shared inbox requires manager/admin authority, a nonblank name, and edit access to the selected parent when the item is nested.
ST5 - Creating a Shared Triage folder or mailbox-capable shared inbox does not create private creator grants; access remains controlled by the resource default and `resource_permissions` exception rows.
ST6 - Shared inbox folders and mailbox entries use the same tree model, with mailbox-capable entries identified by a shared inbox entry type, account email, and company email connection link.
ST7 - Renaming or moving a Shared Triage folder requires edit access; creating or changing mailbox linkage also requires manager/admin authority.
ST8 - Deleting a shared inbox folder requires edit access.
ST9 - Protected shared inbox folders cannot be renamed or deleted.
ST10 - Deleting a mailbox-capable shared inbox is destructive: it removes the Shared Triage work surface, any Shared Triage mailbox rows sharing the same company email connection, shared inbox permissions/GVIC rows, and the linked company_email_connections credential.
ST11 - Reading shared inbox folders and messages uses the company-owned shared mailbox grant instead of the viewer's personal mailbox grant.
ST12 - Shared mailbox caches are scoped by shared account/grant so one shared mailbox does not leak into another.
ST13 - Sending mail from a shared inbox requires edit access to that shared inbox.
ST14 - View-only shared inbox access can read mailbox content but cannot send from that mailbox.
ST15 - Reading shared inbox access settings requires manager/admin authority and view access to the shared inbox.
ST16 - Updating shared inbox access settings requires manager/admin authority and edit access to the shared inbox.
ST17 - Shared inbox access settings return default access, explicit access grants, GVIC assignments, effective access, whether the actor can edit permissions, and whether the actor can edit manager permissions.
ST18 - Updating shared inbox access changes `resource_permissions` exception rows/default access and must not convert GVIC assignments into permission grants; GVIC assignments are notification/My Work/update routing data and must not grant Shared Triage view/edit access, elevate view to edit, or authorize delete/mutation actions.
ST19 - Shared inbox access grants support user and group principals, and group grants resolve from `company_user_groups` and `company_user_group_members` source data instead of requiring a derived group closure/projection table to be populated after schema reset.
ST20 - If required Shared Triage access or folder-list storage is unavailable, access and folder-list endpoints return service unavailable with `shared_inbox_storage_unavailable`, not a silent success or generic `failed_to_list_shared_inboxes` error.
ST21 - Shared inbox GVIC assignment APIs apply only to mailbox/shared inbox resources, not plain organizational folders.
ST22 - Shared Triage must not show private personal mailbox messages unless they were explicitly added through a shared inbox path.
ST23 - Shared inbox access and tree changes publish workspace events so other clients refresh.
ST24 - Company-owned shared mailbox credentials are stored in company_email_connections, not as permission-bearing users.
ST25 - A mailbox address used by a shared inbox does not need to be a Mango user and does not need company membership.
ST26 - Each mailbox-capable shared inbox stores a company_email_connection_id foreign key that points to the company-owned mailbox credential used for mail operations.
ST27 - shared_inboxes.account_email remains display/search metadata, but the credential source of truth is the company_email_connection_id link.
ST28 - Personal My Triage mailbox credentials stay in user_email_connections as personal-only rows and must not be used as the source of truth for Shared Triage mailbox access.
ST29 - Shared inbox OAuth setup or reconnect writes or updates company_email_connections for the target company and mailbox.
ST30 - Creating or reassigning a mailbox-capable shared inbox requires manager/admin authority and an existing connected company email connection for that company and account email, or starts the shared inbox OAuth repair flow for a manager/admin.
ST31 - Existing legacy user_email_connections rows with connection_scope = shared are backfilled into company_email_connections, linked to matching shared_inboxes, then removed before the legacy connection_scope column is dropped.
ST32 - Users with view or edit permission to a shared inbox can open the shared inbox without connecting that mailbox to their personal account.
ST33 - If a company-owned shared connection is missing or expired, normal permitted users see a repair-required state and do not receive a personal OAuth prompt.
ST34 - If a company-owned shared connection is missing or expired, managers/admins who can edit that shared inbox can start shared inbox OAuth reconnect for the company-owned credential.
ST35 - Shared inbox mail actions use the company-owned grant but are authorized and audited as the currently logged-in user.
ST36 - Shared inbox permissions remain stored on resource_permissions with resource_type = shared_inbox and resource_id = shared_inboxes.shared_inbox_id; Shared Triage folder permissions use resource_type = shared_inbox_folder, and `shared_triage_folder` may appear only as a legacy resource-type alias, not as a table name.
ST37 - Shared inbox GVIC assignments remain stored on resource_gvic_assignments with resource_type = shared_inbox and resource_id = shared_inboxes.shared_inbox_id.
ST38 - Email connection records do not receive Shared Triage permissions or GVIC assignments; permissions and GVIC are assigned to the shared inbox work surface.
ST39 - Plain Shared Triage folders are organizational containers only; selecting one clears mail state and must not call email folder, message list, message detail, prefetch, or load-more endpoints.
ST40 - Shared Triage mail reconciliation is driven by Nylas webhooks through backend communications realtime; browser focus and visibility-change events must not refresh the message list, and the browser must not poll the message list every 30 seconds.
ST41 - Communications realtime events reconcile the active mail-capable mailbox view only; active Shared Triage root, plain Shared Triage folders, My Work, Updates, and GVIC matrix views must not issue mail refresh GETs from those events.
ST42 - Shared Triage mailbox inboxes must continue to live-reconcile mailbox messages when they are created, updated, or deleted without replacing the whole visible message list.
ST43 - Shared Triage mailbox inboxes must show a fixed, predictable message batch size of 12 messages per page.
ST44 - Shared Triage mailbox inboxes must immediately prefetch the next message page after the first visible page loads, without waiting for scrolling or the archive/advance action.
ST45 - Scrolling a Shared Triage mailbox inbox must not archive messages and must not load the next primary-inbox page.
ST46 - Advancing a Shared Triage mailbox inbox page is an explicit user action that archives only the messages visible on the current page.
ST47 - Advancing must display the prefetched next page before archiving the previous page whenever a prefetched page is available.
ST48 - Advancing must freeze the previous page's message IDs at click time so live updates cannot change what gets archived.
ST49 - The advance/archive action must remain immediately reusable after a page advances unless accepting the visible page would exceed the hidden archive queue limit.
ST50 - Advancing must enqueue the frozen visible message IDs through one page-level background archive request instead of waiting for those provider mutations before allowing the user to continue.
ST51 - The hidden archive queue may contain no more than 140 pending emails across queued and in-flight archive work.
ST52 - If accepting the current visible page would exceed 140 pending archive emails, the advance/archive action is disabled until enough queued archive work completes.
ST53 - Background archive work must be accepted by the backend in one request per advanced page; provider mutations run from a backend archive job worker behind the backend provider gate instead of occupying multiple browser request lanes.
ST54 - Advancing must prioritize showing the prefetched next page, enqueueing the previous page, and making the action usable again before any folder metadata reconciliation.
ST55 - Folder metadata refresh after archive or unarchive is only a count/metadata reconciliation step, must be coalesced across archive confirmations, and must not clear or duplicate an in-flight folder metadata request.
ST56 - Folder metadata reconciliation must not fetch the next message page or block the prefetched page from being shown.
ST57 - If folder metadata reconciliation is slow or fails after archive or unarchive, the Shared Triage mailbox list remains usable and counts can reconcile later.
ST58 - If no next page is available, advancing archives the current visible page and leaves the mailbox inbox empty until live updates or a refresh provide more messages.
ST59 - Backend or provider events caused by Shared Triage archive work must be identifiable as archive confirmations instead of generic mailbox updates.
ST60 - Archive confirmations for the frozen previous Shared Triage page must not trigger a full message-list reload or blank the currently visible prefetched page.
ST61 - Star and unstar actions in Shared Triage must optimistically update the visible message state and Starred count before backend or provider confirmation returns.
ST62 - Backend or provider confirmations caused by local Shared Triage star and unstar actions must reconcile caches/counts without triggering a full message-list reload or blanking the active Inbox or Starred tab.
ST63 - Shared Triage mailbox activation must not launch background workspace repair GET storms for inaccessible or stale logic gate IDs referenced by node rows.
ST64 - If an accepted background archive mutation fails or never confirms, the source email must not be deleted and may remain or reappear in the shared inbox after refresh/reconciliation.
ST65 - Selecting another shared-inbox email, focusing the email body/detail pane, or returning focus from the detail pane to the list must not reload, blank, or replace the visible message list.
ST66 - The normal full-list replacement path for a Shared Triage mailbox is initial page/list load, browser refresh, or an explicit list identity change such as mailbox, search, unread filter, account, company, or selected Shared Triage mailbox.
ST67 - A communications realtime message.created event with a message ID must fetch that one message and insert it into the current date-sorted shared-inbox list when it matches the active filters; it must not reload the whole list.
ST68 - Communications realtime message.updated, message.opened, and message.deleted events with a message ID must update, reconcile, or remove only the affected visible or selected message; they must not reload the whole list when the affected message is not visible.
ST69 - Communications realtime message events without a message ID must not trigger a full Shared Triage message-list reload; the next explicit page/list load reconciles anything that could not be handled as a single-message update.
ST70 - A background Shared Triage archive response may return Accepted only after the backend has written a durable archive job and job-item rows for the accepted message IDs.
ST71 - Accepted Shared Triage archive job items must survive API process restart and be claimable by a backend worker until each item reaches archived or failed.
ST72 - The backend archive worker must claim pending or retryable Shared Triage job items with a processing lease so concurrent workers do not mutate the same active item at the same time.
ST73 - Retryable Shared Triage archive failures such as provider rate limits or transient provider errors must be recorded with attempt count, last error, and next available time instead of being dropped from memory.
ST74 - Final Shared Triage archive failures must be recorded on the job item and emit an archive-failed communications event; successful items must emit archive confirmation events.
ST75 - Duplicate active Shared Triage archive submissions for the same actor, shared inbox, account, and message must not create duplicate active job items or duplicate provider archive attempts.
ST76 - Shared Triage archive jobs must preserve company/shared-inbox scope and use the company-owned shared mailbox grant, not the actor's personal mailbox grant.
ST77 - Accepted background Shared Triage archive job IDs are pending work, not confirmed archive mutations; they must not be applied to the current visible shared-inbox message-list cache until an explicit user action or later full reload reconciles provider state.
ST78 - Removing a mailbox-capable shared inbox from Shared Triage without deleting the email connection is a separate remove action: it removes the Shared Triage work surface and shared inbox permissions/GVIC rows while preserving the company_email_connections credential.
ST79 - Dragging a Shared Triage mailbox email into a Logic Gate, Company Explorer Logic Gate row, Kanban column, project relationship panel, or project Logic Gate group must preserve `shared_inbox_id` through the drag payload and conversion API request; the supported cross-window boundary is Chrome window/tab to Chrome window/tab, and cross-browser application drag/drop is not a documented business requirement unless a separate compatibility rule and test are added. Company Explorer folders are not Shared Triage email conversion targets.
ST80 - Shared Triage email conversion uses the company-owned shared mailbox grant for message detail reads; it must not require or fall back to the actor's personal mailbox connection.
ST81 - A successful Shared Triage email conversion creates the same direct email-created Kanban node/card semantics as My Triage when a Logic Gate is targeted, including the visible email-origin marker and later email-transfer behavior; project-only conversion creates an email-origin project node relationship.
ST82 - Local Shared Triage conversion echoes from communications realtime and workspace realtime must be reconciled from the conversion response; they must not blank, fully reload, reuse stale prefetched pages, or repeatedly refetch the shared mailbox message list or Home workspace panel.
ST83 - Successful local Shared Triage email conversion keeps converted source email rows visible, patches their Logic Gate icon state from the conversion result when present, suppresses matching local `triage.converted` echoes by `shared_inbox_id`, and tolerates a matching unscoped realtime echo without invalidating all communications message page/detail caches, removing rows, or triggering post-removal fill/message-length prefetch. This conversion/cache/realtime/prefetch path is regression-prone and must be protected whenever email conversion, star/unstar, row-removal, or pagination refill behavior changes.
ST84 - Successful local Shared Triage email conversion into a Company Explorer Logic Gate must show a temporary green success banner over the Company Explorer section; other Logic Gate conversion surfaces must show a temporary success banner or notice.
ST85 - When a dragged Shared Triage email is converted into a Logic Gate, Company Explorer Logic Gate, Kanban column, project, pinned Logic Gate, or non-Explorer eligible node target, the source email is set to unstarred through the company-owned shared mailbox grant after workspace conversion succeeds. The response returns `unstarred_message_ids`, and Shared Triage applies those IDs locally without full-list replacement, stale prefetched-page top-up, or repeated shared mailbox GETs.
ST86 - Conversion-driven Shared Triage unstar reconciliation must use the same local echo discipline as conversion: the Starred source card de-stars immediately, the local mutation is remembered under both the scoped `shared_inbox_id` key and a fallback unscoped key, and later backend/provider confirmations must not blank, refill, or fully reload the active Shared Triage list when the realtime payload omits `shared_inbox_id`.
ST87 - Unread Shared Triage email rows keep their outer unread outline/highlight, but the small top-left colored dot is reserved for the currently selected email only; unread but unselected rows must not show that dot.
ST88 - Sent email read receipts from Shared Triage use Nylas open tracking on outbound shared mailbox sends by sending `tracking_options.opens = true` through the company-owned shared grant.
ST89 - Shared mailbox `message.opened` receipts are stored in the company email connection/shared mailbox receipt scope, not in the viewer's personal user receipt scope.
ST90 - Shared mailbox receipt realtime events include `shared_inbox_id` and are published only to users with view access to the linked Shared Triage mailbox work surface.
ST91 - A shared `message.opened` receipt with a message ID must reconcile only the affected visible or selected sent message and must not trigger a full Shared Triage message-list reload, top-up, or prefetch.
ST92 - Sent shared mailbox messages without a stored receipt must not show a green `Not opened` indicator; the UI shows `Seen` only after a stored open signal, with timestamp/count details when available.
ST93 - Multiple Shared Triage mailbox work surfaces that point at the same company email connection share receipt state for the same provider message, while realtime events remain scoped to each linked `shared_inbox_id` audience.
ST94 - Nylas shared receipt support requires a public `/nylas/webhook` destination for the same Nylas app/client ID used by company-owned shared mailbox sends, and that webhook must subscribe to the Message tracking `message.opened` trigger.
ST95 - The Nylas dashboard Message tracking group may be configured with all 3 triggers selected: `message.opened`, `message.link_clicked`, and `thread.replied`; the current Shared Triage receipt contract consumes only `message.opened`, so link-clicked and thread-replied webhook deliveries must not create or mutate shared read-receipt state unless a future feature explicitly adds that behavior.
ST96 - The backend `NYLAS_WEBHOOK_SECRET` must match the secret returned by the configured Nylas webhook destination, and the Nylas app/environment must support message tracking; without that webhook secret and tracking-capable app, shared sends can request `tracking_options.opens = true` but the product will not receive usable receipt updates.
ST97 - The Postgres visible Shared Triage folder list query must pass exactly the SQL arguments it references; stale extra arguments must be regression-covered because they prevent non-admin Shared Triage folder loading before permission logic is reached.
ST98 - Selecting a mailbox-capable Shared Triage row must not clear the existing mail list, folder counts, Inbox count, or Starred count only because the selected shared-inbox metadata has not resolved yet.
ST99 - When the selected Shared Triage row resolves to a mailbox-capable shared inbox, the UI must load that mailbox's folders, messages, Inbox count, and Starred count without requiring the user to select another shared inbox first.
ST100 - Disconnecting a Shared Triage mailbox requires an explicit point-of-click confirmation popover before the shared mailbox disconnect mutation runs.
ST101 - Shared Triage reply drafts are unique per company, user, shared inbox scope, and original message ID; opening Reply on the same shared source email resumes the existing draft instead of creating another draft row.
ST102 - A saved Shared Triage reply draft stores or reloads the original shared message context, and reopening the draft shows the original email being answered above the compose editor.
ST103 - Shared Triage compose supports To, Cc, Bcc, Reply, Reply All, and Forward; Reply All excludes the active shared mailbox address from generated recipients.
ST104 - Shared Triage scheduled sends are saved as scheduled drafts with the selected `shared_inbox_id`, use the company-owned shared grant when due while the app is open, and delete the scheduled draft only after send succeeds.
ST105 - Shared Triage compose and reply use the unified editor semantics shared with node, Logic Gate, project, and attached-email reply editor surfaces, including numbered/alphanumeric list, indent/outdent, bullet list, checklist, font size, bold, underline, hyperlink creation, paste cleanup, Delete/Backspace, and copy/cut/paste behavior.
ST106 - Shared Triage compose stores rich editor content as sanitized rich HTML, while legacy plain text drafts continue to load and send as escaped/linkified HTML.
ST107 - Shared Triage received email detail must display Cc recipients when the provider returns them; Bcc is displayed only when it is present on messages the viewer is allowed to see.
ST108 - Links in Shared Triage email bodies, forwarded/replied original-message previews, sent reply bodies, and shared email signatures must open in a new browser tab when clicked.
ST109 - Node editor, logic-gate editor, and inline comment/chat text opened from Shared Triage workflows must auto-detect plain HTTP(S) or `www.` links, render them as blue underlined link text, and open them on a normal left click.
ST110 - The Shared Triage All mailbox control is a dropdown with All and Spam folder options; the selected option is visually highlighted and marked, and Spam loads the provider spam/junk mailbox through the selected shared grant.
ST111 - Shared Triage Spam mailbox reads are scoped by `shared_inbox_id` and the company-owned shared mailbox connection; Spam messages must not leak between shared inboxes or into the primary inbox filter.
ST112 - View-only Shared Triage users may read Spam when they can view the mailbox, but sending, scheduled sending, reply, reply-all, forward, Bcc, and draft send actions still require edit access to that shared inbox.
ST113 - Shared Triage email drag/drop supports same-account Chrome window/tab drops onto Company Explorer Logic Gates, Logic Gate Kanban columns, project relationship panels, and Logic Gate groups inside a project; project drops create email-origin project node relationships, and Kanban or project drops open the created node popup after conversion succeeds.
ST114 - Shared Triage mailbox rows group messages by provider/Nylas `thread_id` when present so replies in the same shared conversation appear as one visible inbox item instead of duplicate rows; messages without a thread ID remain single-message rows.
ST115 - A grouped Shared Triage row uses the newest loaded message as the visible row representative while unread, starred, attachment, and thread-count indicators roll up from the loaded messages in that thread.
ST116 - Selecting a Shared Triage thread row opens a scrollable, full-height conversation detail pane that hydrates the thread through Nylas thread `message_ids` plus individual message-detail reads for HTML bodies, all scoped to the selected `shared_inbox_id` and company-owned shared grant.
ST117 - Shared Triage rich compose send must preserve sanitized block indentation, including indent/outdent and blockquote-style indents, so sent shared email HTML does not flatten intended paragraph indentation.
ST118 - Expired or revoked company-owned Shared Triage mailbox provider credentials return a Shared Triage reconnect/repair state, not a Mango auth logout; permitted users remain signed in and managers/admins with edit access can repair the shared connection. Shared mailbox folder, message-list, message-detail, send, archive, star, and draft endpoints must not represent provider reauthorization as a Mango session `401`, `unauthorized`, terminal-auth, logout, or login-redirect response; they must return a recoverable provider-specific response, such as `409 nylas_reauth_required`.
ST119 - Any future change to unified editor semantics must apply to Shared Triage compose and reply through the shared editor behavior, not through a separate shared-compose-only implementation.

## Nylas Configuration Contract

Shared mailbox read receipts depend on both outbound send tracking and webhook delivery for the company-owned shared grant. The expected Nylas webhook configuration for this contract is:

- Webhook destination URL: the backend `/nylas/webhook` route for the active environment, for example `https://api.dev.<domain>/nylas/webhook` in dev or a public HTTPS tunnel URL for localhost.
- Required trigger: Message tracking `message.opened`.
- Accepted full Message tracking selection: `message.opened`, `message.link_clicked`, and `thread.replied` selected together.
- Backend secret: `NYLAS_WEBHOOK_SECRET` set to the webhook secret returned by that Nylas destination.
- Current product behavior: only `message.opened` writes shared read-receipt summaries and fans out shared-inbox realtime updates; `message.link_clicked` and `thread.replied` are allowed in Nylas but are ignored for read receipts.

## Email Threading Contract

Shared Triage uses Nylas `thread_id` and thread `message_ids` to group related messages into one inbox row and to load the selected conversation history. Message bodies still come from single-message detail reads because list/thread responses can omit full HTML bodies. Every thread, message, and body read must remain scoped to the selected `shared_inbox_id` and company-owned shared mailbox grant.

## Scenarios

### Scenario ST-S1: Shared Inbox Visibility

Business logic covered:
- ST1
- ST2
- ST3
- ST6
- ST22
- ST32
- ST97

Given:
- A company has several shared inbox folders and mailbox-capable shared inboxes.
- User A has view access to one shared inbox and no access to another.
- A company admin and a company manager belong to the same company.

Expected:
- User A only sees the shared inboxes where effective access grants view or higher.
- User A does not see private personal mailbox messages in Shared Triage.
- The company admin sees shared inboxes with admin-level effective access.
- The company_user folder-listing path works without a dev-admin or company-admin bypass.
- The company manager sees only shared inboxes where effective access grants view or higher through default, direct user, or group grants.
- Mailbox-capable entries and plain folder entries are represented in the same tree without mixing their mailbox behavior.
- User A opens a visible shared inbox without connecting that mailbox to User A's personal account.
- The visible Shared Triage folder query succeeds for User A without SQL argument-count errors.

### Scenario ST-S1B: Shared Mailbox Provider Reauth Does Not Log Out Mango

Business logic covered:
- ST11
- ST33
- ST34
- ST118

Given:
- A user has view access to a mailbox-capable Shared Triage inbox.
- The company-owned shared mailbox provider grant has expired or been revoked.
- The user selects that Shared Triage inbox.

Expected:
- Folder, message-list, message-detail, send, archive, star, and draft reads or writes return a provider reauth-required response, such as `409 nylas_reauth_required`, not a Mango session `401`, `unauthorized`, terminal-auth, logout, or login-redirect response.
- The user remains signed in to Mango.
- The UI shows the Shared Triage reconnect/repair state for the shared mailbox.
- A manager/admin with edit access can start the shared inbox OAuth reconnect flow.

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
- ST78

Given:
- A company manager can edit one shared inbox parent folder and only view another parent folder.
- A regular user can edit the same editable parent folder.
- A protected shared inbox folder exists.
- A mailbox-capable shared inbox has a linked company email connection.

Expected:
- The manager can create under the editable parent, and the new item stays governed by default access plus `resource_permissions` exceptions.
- The regular user cannot create Shared Triage folders or shared inbox mailboxes even with edit access.
- Creating under the view-only parent fails for the manager.
- Rename and move require edit access; mailbox linkage changes require manager/admin authority and edit access.
- Protected shared inbox folders cannot be renamed or deleted.
- Deleting a mailbox-capable shared inbox removes the Shared Triage work surface and linked company email connection everywhere.
- Removing a mailbox-capable shared inbox from Shared Triage removes the work surface but keeps the company email connection available for reuse.
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
- GVIC assignments are not converted into resource permission grants and do not grant view/edit access, elevate view-only access, or authorize delete/mutation actions.
- User and group grants are both accepted, and group grants resolve from source group membership tables rather than a derived group projection table.
- Permissions and GVIC rows target the shared inbox resource, not the company email connection.
- Shared Triage folder permissions use the `shared_inbox_folder` resource type, mailbox permissions use the `shared_inbox` resource type, and `shared_triage_folder` is not treated as a table name.
- If storage is unavailable, the endpoint returns service unavailable with `shared_inbox_storage_unavailable`.

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
- Loading the Shared Triage folder tree does not depend on GVIC projection tables such as `resource_gvic_effective_assignments`.

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
- When OAuth is started to repair or reassign an existing Shared Triage mailbox entry, the callback updates that existing shared_inboxes row instead of only creating or updating company_email_connections.
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
- ST65
- ST66
- ST67
- ST68
- ST69

Given:
- Shared Triage contains a plain parent folder and a mailbox-capable shared inbox entry under that folder.
- The mailbox-capable shared inbox has entry_type = shared_inbox, an account email, and a linked company email connection.
- The browser has an active communications realtime subscription.

Expected:
- Selecting the plain parent folder clears any previous mail list and selected message state.
- Selecting the plain parent folder does not call email folders, message list, message detail, prefetch, or load-more endpoints.
- Selecting the plain parent folder does not retry mail GETs when the row has no mailbox connection because folders are not mailbox resources.
- Selecting the mailbox-capable shared inbox may load mail using the company-owned shared grant.
- Nylas message.created, message.updated, message.deleted, and message.opened events may reconcile individual messages in the active mailbox-capable shared inbox when they carry message IDs.
- Those realtime events do not trigger mail GETs while Shared Triage root, a plain Shared Triage folder, My Work, Updates, or a GVIC matrix view is active.
- Clicking an email row, focusing the email body, and clicking back into the list do not reload, blank, or replace the message list.
- Focus or visibility return does not refresh the active mailbox-capable mail view, and there is no browser-side 30-second message polling loop.
- Realtime message events that do not carry a message ID do not trigger a whole-list reload; the next explicit page/list load reconciles provider state.

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
- ST58
- ST59
- ST60
- ST61
- ST62
- ST63
- ST64
- ST65
- ST66
- ST67
- ST68
- ST69
- ST70
- ST71
- ST72
- ST73
- ST74
- ST75
- ST76
- ST77
- ST87

Given:
- A user opens a mailbox-capable Shared Triage inbox with view access to the shared mailbox.
- The shared mailbox has more than 12 messages available.
- The first visible page and the next page can be read from the mailbox provider.

Expected:
- The visible page contains no more than 12 messages.
- The next page is prefetched after the visible page loads.
- Created, updated, and deleted message events reconcile the affected message live without replacing the whole shared-inbox list.
- New-email realtime events with a message ID fetch that single message and insert it into the current date-sorted list when it matches the active filters.
- Updated, opened, or deleted-message realtime events touch only the affected visible or selected row when the event carries enough IDs.
- Realtime message events that do not carry a message ID do not trigger a whole-list reload; the next explicit page/list load reconciles provider state.
- Scrolling the visible page does not archive any messages and does not append another primary-inbox page.
- Clicking the advance action freezes the currently visible message IDs, shows the prefetched next page, and enqueues only the frozen previous-page IDs for background archive.
- The frozen previous-page IDs are accepted by one page-level backend archive request only after durable archive job rows are written, and provider archive mutations continue from the backend worker using the shared mailbox grant.
- The advance action becomes usable again immediately after the next page is shown and the previous page is queued.
- The hidden archive queue accepts at most 140 pending emails; if adding the current page would exceed that limit, the advance action is disabled until enough background archive work completes.
- Accepted Shared Triage archive job items survive API restart and are retried by the backend worker until each item is archived or records a final failure.
- Duplicate active archive submissions for the same actor, shared inbox, account, and message do not create duplicate active job items.
- Retryable provider failures remain recorded with attempt count, last error, and next retry time.
- Successful Shared Triage archive job items emit archive confirmations; final failed items emit archive-failed communications events.
- Folder metadata refresh runs after the primary archive-and-next work as reconciliation only; it is coalesced, does not duplicate an in-flight folder request, and does not fetch the next email page.
- Shared Triage archive confirmation events from the app backend or provider webhook reconcile pending archive bookkeeping without blanking, fully reloading, or removing rows from the currently visible prefetched page.
- Accepted background Shared Triage archive IDs are not treated as already archived in the frontend list cache; the current page remains stable while earlier page jobs drain in the backend.
- Starring or unstarring a message updates the row and Starred count locally, and the matching backend/provider confirmation does not blank or fully reload the active Inbox or Starred tab.
- Unread rows keep their unread outline, while the top-left dot is visible only on the selected email row.
- Opening or returning to a Shared Triage mailbox does not fire background logic-gate view repair requests for missing, inaccessible, or stale node-linked logic gate IDs.
- If the backend accepts the archive page but a later provider mutation fails or never confirms, the source email is not deleted and can remain or reappear after refresh.
- If the archive request fails after the next page is shown, the user remains on the next page and sees an archive failure.
- If there is no next page, clicking the advance action archives the visible page and leaves the list empty until more messages arrive or a refresh reloads the inbox.

### Scenario ST-S10: Shared Email Conversion To Logic Gate

Business logic covered:
- ST79
- ST80
- ST81
- ST82
- ST83
- ST84
- ST85
- ST86

Given:
- A user has edit access to a mailbox-capable Shared Triage inbox.
- That shared inbox has a connected company-owned mailbox grant.
- The user drags an email from that Shared Triage mailbox into a Logic Gate, Company Explorer Logic Gate row, Kanban column, project relationship panel, or project Logic Gate group.

Expected:
- The drag payload and conversion request include the selected `shared_inbox_id`.
- The backend reads the message through the shared mailbox grant and authorizes the mutation as the actor.
- The resulting Kanban card is marked as directly email-created and can later transfer its email attachment into another node card.
- Project-only drops create an email-origin project node relationship without a Logic Gate assignment; project Logic Gate drops also create the Logic Gate node/card assignment.
- Company Explorer folder rows are not email conversion targets and must not create Explorer node rows, folder items, or `company_explorer_items` rows.
- The visible Shared Triage email list and app-level communications live-freshness bridge handle the local conversion by keeping converted rows visible, patching the row/detail/cache Logic Gate icon state from the conversion result, and suppressing the matching `shared_inbox_id` scoped realtime echo, plus a matching unscoped echo if the realtime payload omits `shared_inbox_id`, without full-list replacement, communications message cache invalidation, stale prefetched-page top-up, post-removal fill, message-length prefetch, or repeated workspace/mail GET bursts.
- The backend sets converted shared source emails to unstarred through the shared mailbox grant, returns successfully updated IDs in `unstarred_message_ids`, and the Shared Triage Starred count/list reconcile locally without loading replacement Starred rows.
- A converted email dragged from Shared Triage Starred visually de-stars immediately and matching scoped or unscoped star/unstar confirmations are treated as local reconciliation, not as a reason to clear caches, refill from prefetched pages, or reload the active Shared Triage message list.
- Company Explorer drops show a temporary green success banner over the Company Explorer section after the conversion succeeds.

### Scenario ST-S11: Shared Sent Read Receipts

Business logic covered:
- ST88
- ST89
- ST90
- ST91
- ST92
- ST93
- ST94
- ST95
- ST96
- ST101
- ST102
- ST103
- ST104
- ST105
- ST106
- ST107
- ST108
- ST109
- ST110
- ST111
- ST112
- ST119

Given:
- A user has edit access to a mailbox-capable Shared Triage inbox.
- The shared inbox has a connected company-owned mailbox grant.
- The user sends mail from that shared mailbox, and Nylas later emits `message.opened` webhooks for the shared grant.
- The active Nylas app has a public `/nylas/webhook` destination with Message tracking `message.opened` selected; selecting all 3 Message tracking triggers (`message.opened`, `message.link_clicked`, and `thread.replied`) is valid for this environment.
- The user composes shared replies, reply-all messages, forwards, drafts, scheduled messages, and messages containing links/rich text.
- The shared mailbox contains Inbox, All, Sent, Draft, and Spam/Junk messages.

Expected:
- Shared sends request Nylas open tracking through the company-owned shared grant.
- The configured webhook secret matches `NYLAS_WEBHOOK_SECRET`; otherwise webhook POSTs are rejected and no shared receipt summary is written.
- The backend stores open signals under the company email connection/shared mailbox scope and does not write them to the actor's personal receipt scope.
- `message.link_clicked` and `thread.replied` webhook deliveries do not create or mutate read-receipt state under the current Shared Triage contract.
- Realtime receipt events include the linked `shared_inbox_id` and are delivered only to users with view access to that shared inbox.
- The Sent mailbox shows `Seen` only for messages with a stored receipt signal; messages without a signal do not show `Not opened`.
- A `message.opened` event with a message ID updates the affected sent row/detail only and preserves the rest of the visible list and prefetched page state.
- If more than one Shared Triage mailbox entry points at the same company email connection, those entries share the stored receipt summary for the same provider message while audience fanout remains tied to each linked shared inbox.
- Replying to the same shared source email never creates more than one reply draft for that source message and shared mailbox scope.
- Reopening a shared reply draft shows the original email context above the compose editor.
- Reply, Reply All, Forward, Cc, Bcc, scheduled send, and rich compose send through the selected shared inbox scope and continue to require edit access.
- Shared rich compose controls use the unified editor behavior shared with node, Logic Gate, project, and attached-email reply editor surfaces.
- A future scheduled shared send is saved as a scheduled draft with `shared_inbox_id`, is sent through the company-owned shared grant when due while the app is open, and is deleted only after send succeeds.
- Received Cc recipients are visible in message detail.
- Shared email body/signature/original-preview links open in a new browser tab on click.
- Node editor, logic-gate editor, and inline comment/chat links render as clickable underlined links and open on single left click.
- The All mailbox dropdown can switch between All and Spam folder, with the selected option highlighted and marked.
- Spam/Junk reads stay scoped to the selected Shared Triage mailbox and do not leak into primary inbox results or other shared inboxes.

### Scenario ST-S12: Shared Mailbox Activation And Disconnect Confirmation

Business logic covered:
- ST98
- ST99
- ST100

Given:
- A user selects a mailbox-capable Shared Triage inbox.
- The Shared Triage tree row and mailbox metadata may resolve after the active view changes.
- The shared mailbox exposes a disconnect action.

Expected:
- A transiently unresolved selected shared-inbox row does not blank the current mail list or folder/count state.
- The selected row is not treated as a plain organizational folder unless the resolved row is actually a non-mailbox folder.
- Once the selected row resolves to a mailbox-capable shared inbox, folders, messages, Inbox counts, and Starred counts load for that shared mailbox.
- The user does not need to click a different shared inbox and then return to make the selected shared mailbox load.
- Clicking disconnect opens a small confirmation popover near the clicked button.
- The shared mailbox disconnect mutation runs only after the user confirms that popover.

### Scenario ST-S13: Shared Threaded Inbox Rows And Conversation Detail

Business logic covered:
- ST114
- ST115
- ST116
- ST117

Given:
- A mailbox-capable Shared Triage inbox has multiple provider messages with the same Nylas `thread_id`.
- The current user has view access to that shared inbox.
- The user with edit access sends a rich formatted shared reply with indented content.

Expected:
- The Shared Triage list shows one row for the thread, not one row per reply.
- The row preview comes from the newest loaded message while unread/starred/thread-count indicators roll up from the loaded messages in that thread.
- The right-side detail pane fills the available detail area and shows a chronological conversation history for the thread.
- Thread IDs and message bodies are loaded only through the selected `shared_inbox_id` and company-owned shared grant; the UI must not fall back to the actor's personal mailbox.
- Sent shared rich HTML preserves block indentation instead of flattening indented paragraphs.
