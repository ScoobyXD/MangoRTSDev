# Process Story: Shared Triage keeps exact access while comments start from the email

A user opens an authorized Shared Triage mailbox, and the exact shared inbox policy still controls every read and mutation. When the email already has Node associations, the right rail opens and shows each connected Node chat. Otherwise selecting text immediately opens an anchored comment; the first nonempty comment creates a floating Node with no priority and no Logic Gate. The blank hashtag bar shows only `Create floating node (a node without a Logic Gate)`, and typed text searches Nodes, Logic Gates, and Projects. Moves, force resets, live groups, deletion, and cache fingerprints continue to follow the same V2 hierarchy contract.

Last updated: 2026-08-05

# Shared Triage Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (backend coverage exists for destructive delete/remove-only, OAuth linkage, exact shared subscription authorization, publication-time revocation, and live/deleted shared-draft attachment access; `tests/frontend/pages/home/homeMailboxRealtime.test.ts` covers mailbox-capable target selection, root/plain-folder absence, cache-only first/reconnect acceptance, zero-read local mutation echoes, external metadata/detail reconciliation, coalescing, queued-final work, and navigation cancellation; `tests/frontend/pages/home/homeMailDrafts.test.ts` covers shared draft error retention/purge, scoped concurrency, and durable draft preparation before attachment upload. Unified-editor, send-time attachment, draft API, body-marking, and cache tests cover the remaining named paths; rule IDs are not fully mapped to automated tests yet.)

- Automatic shared-inbox signature insertion, cross-mailbox scope isolation, rich-body deduplication, compose-scope wiring, unified signature mounting, exact flush behavior, and stale-load/save ordering are covered by `tests/frontend/pages/home/homeCommands.test.ts`, `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts`, and `tests/frontend/modules/communications/communicationsApi.test.ts`.
- Shared conversion persistence of `shared_inbox_id` and `account_email` is covered by `backend/internal/http/communications_triage_handlers_test.go` and `backend/internal/store/communications_email_conversion_test.go`.
- Provider-only list membership for Node/email-collaboration rows, exact personal/shared source isolation, and suppression of standalone collaboration snapshots are covered by `tests/frontend/pages/home/emailCollaborationRows.test.ts`.

## Business Logic

ST1 - Shared Triage shows shared inbox folders and mailboxes that are visible to the current user.
ST2 - Normal `company_user` users only see shared inbox folders where effective access grants at least edit access, and this folder-listing path must work without relying on a dev-admin or company-admin bypass.
ST3 - Dev admins and company admins resolve all shared inbox folders to edit access; company managers and normal users follow Shared Triage resource policy from default access, direct user grants, and group grants.
ST4 - Creating a Shared Triage folder or mailbox-capable shared inbox requires manager/admin authority, a nonblank name, and edit access to the selected parent when the item is nested.
ST5 - A nested Shared Triage folder or shared inbox starts inherited with no copied edges; a root starts customized with a complete valid policy. Creation does not add a private creator grant.
ST6 - Shared inbox folders and mailbox entries use the same tree model, with mailbox-capable entries identified by a shared inbox entry type, account email, and company email connection link.
ST7 - Renaming or moving a Shared Triage folder requires edit access; creating or changing mailbox linkage also requires manager/admin authority.
ST8 - Deleting a shared inbox folder requires edit access.
ST9 - Protected shared inbox folders cannot be renamed or deleted.
ST10 - Deleting a mailbox-capable shared inbox is destructive: it removes the Shared Triage work surface, any Shared Triage mailbox rows sharing the same company email connection, both V2 settings rows and cascading policy edges, and the linked company_email_connections credential.
ST11 - Reading shared inbox folders and messages uses the company-owned shared mailbox grant instead of the viewer's personal mailbox grant.
ST12 - Shared mailbox caches are scoped by shared account/grant so one shared mailbox does not leak into another.
ST13 - Sending mail from a shared inbox requires edit access to that shared inbox.
ST14 - Shared inbox content and send actions both require edit access; a no-access user receives no mailbox content.
ST15 - Reading a shared inbox or folder permission policy uses the canonical generic permission endpoint and requires manager/admin authority plus effective Edit access.
ST16 - Updating a shared inbox or folder permission policy uses the canonical generic permission endpoint, complete-policy replacement, If-Match protection, and the same management gate.
ST17 - Permission responses expose inherited/customized mode, effective source/default/rules, reset/overwrite explanation, effective access, and permission-management capabilities. GVIC is read separately from its canonical endpoint.
ST18 - Permission and GVIC writes remain exact and separate. GVIC is notification/My Work/update routing data and never grants Shared Triage Edit access or authorizes delete/mutation actions.
ST19 - Shared inbox and folder group edges remain group pointers and resolve through current nested `company_user_groups` and `company_user_group_members` data without a derived closure or effective table.
ST20 - If required Shared Triage access or folder-list storage is unavailable, access and folder-list endpoints return service unavailable with `shared_inbox_storage_unavailable`, not a silent success or generic `failed_to_list_shared_inboxes` error.
ST21 - Canonical GVIC supports exact `shared_inbox_folder` and `shared_inbox` resources. Both use inherited/customized policy semantics; mailbox credentials are never policy principals.
ST22 - Shared Triage must not show private personal mailbox messages unless they were explicitly added through a shared inbox path.
ST23 - Policy/tree changes update canonical rows and fingerprints. Parent moves advance parent-link sequences; inherited-only Apply writes no descendant state; overwrite-all records one reset sequence; other clients resolve the result on navigation or refresh.
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
ST36 - Shared inbox permissions use `resource_permission_settings` plus canonical `resource_permissions` with resource_type `shared_inbox`; folder permissions use exact type `shared_inbox_folder`. `shared_triage_folder` is rejected after cutover.
ST37 - Shared inbox and folder GVIC use `resource_gvic_settings` plus canonical `resource_gvic_assignments` under their exact resource IDs.
ST38 - Email connection records do not receive Shared Triage permissions or GVIC assignments; permissions and GVIC are assigned to the shared inbox work surface.
ST39 - Plain Shared Triage folders are organizational containers only; selecting one clears mail state and must not call email folder, message list, message detail, prefetch, or load-more endpoints.
ST40 - Shared Triage consumes compact, permission-checked `mailbox:shared:<shared_inbox_id>` hints for only the exact selected mail-bearing shared inbox. First acceptance and reconnect acceptance invalidate reusable cache state but start zero provider reads. External message/folder hints use one-active/one-queued-final coordination only for metadata and directly identified detail; event payloads never insert or replace rows and no mail polling is used.
ST41 - Shared subscription admission requires the exact existing mail-bearing resource plus current Edit access, and publication rechecks the current exact audience. My Work, Updates, GVIC matrix, Shared Triage root/headings/group rows/plain folders, inaccessible inboxes, and inactive inboxes retain no fallback personal/mailbox subscription and issue no provider GET because of a hint.
ST42 - Navigating to a concrete shared mailbox performs its normal canonical load and installs that exact subscription. Navigating away cancels/discards captured timers and pending work, unsubscribes the old inbox, and prevents a hint or stale response from Shared Inbox A from refreshing/invalidation Shared Inbox B.
ST43 - Shared Triage mailbox inboxes must show a fixed, predictable message batch size of 12 messages per page.
ST44 - Shared Triage mailbox inboxes automatically prefetch the next message page after the selected-detail foreground path settles, without waiting for scrolling or the archive/advance action.
ST45 - Scrolling a Shared Triage mailbox inbox must not archive messages and must not load the next primary-inbox page.
ST46 - Advancing a Shared Triage mailbox inbox page is an explicit user action that archives only the messages visible on the current page.
ST47 - Advancing must display the prefetched next page before archiving the previous page whenever a prefetched page is available.
ST48 - Advancing must freeze the previous page's message IDs at click time so local list changes cannot change what gets archived.
ST49 - The advance/archive action must remain immediately reusable after a page advances unless accepting the visible page would exceed the hidden archive queue limit.
ST50 - Advancing must enqueue the frozen visible message IDs through one page-level background archive request instead of waiting for those provider mutations before allowing the user to continue.
ST51 - The hidden archive queue may contain no more than 140 pending emails across queued and in-flight archive work.
ST52 - If accepting the current visible page would exceed 140 pending archive emails, the advance/archive action is disabled until enough queued archive work completes.
ST53 - Background archive work must be accepted by the backend in one request per advanced page; provider mutations run from a backend archive job worker behind the backend provider gate instead of occupying multiple browser request lanes.
ST54 - Advancing must prioritize showing the prefetched next page, enqueueing the previous page, and making the action usable again before any folder metadata reconciliation.
ST55 - Folder metadata refresh after archive or unarchive is only a count/metadata reconciliation step, must be coalesced across committed local archive/unarchive responses and canonical archive-job reads, and must not clear or duplicate an in-flight folder metadata request.
ST56 - Folder metadata reconciliation must not fetch the next message page or block the prefetched page from being shown.
ST57 - If folder metadata reconciliation is slow or fails after archive or unarchive, the Shared Triage mailbox list remains usable and counts can reconcile later.
ST58 - If no next page is available, advancing archives the current visible page and leaves the mailbox inbox empty until a canonical refresh provides more messages.
ST59 - Shared Triage archive progress and completion are identified by durable archive job and job-item status returned from canonical archive-job reads, not by backend/provider browser events or generic mailbox updates.
ST60 - Reconciling durable archive-job status for the frozen previous Shared Triage page must not trigger a full message-list reload or blank the currently visible prefetched page.
ST61 - Star and unstar actions in Shared Triage must optimistically update the visible message state before the committed HTTP response returns.
ST62 - The committed HTTP response for a local Shared Triage star or unstar action reconciles the affected row and caches without triggering a full message-list reload or blanking the active Inbox or Starred tab. Its matching `message.updated` echo performs zero browser GETs. External message hints may invalidate future page reads and coalesce exact-inbox folder metadata, but they never replace the current displayed list.
ST63 - Shared Triage mailbox activation must not launch background workspace repair GET storms for inaccessible or stale logic gate IDs referenced by node rows.
ST64 - If an accepted background archive job item reaches failed state or remains incomplete, the source email must not be deleted and may remain or reappear on the next canonical shared-inbox load.
ST65 - Selecting another shared-inbox email, focusing the email body/detail pane, or returning focus from the detail pane to the list must not reload, blank, or replace the visible message list.
ST66 - The normal full-list replacement path for a Shared Triage mailbox is limited to initial page/list load, browser refresh, explicit retry/recovery, or an explicit list identity change. Subscription acceptance, reconnect, provider hints, notification-summary updates, focus, and visibility changes must never replace it.
ST67 - Shared mailbox WebSocket payloads carry only exact scope, trigger, and compact message/thread identifiers. They never fetch, insert, or live-patch message bodies; canonical page/list/detail reads remain authoritative.
ST68 - Local mail commands patch the affected visible or selected message from their committed response. Matching local provider echoes are consumed once without invalidation or GETs. External message hints leave the current list stable, may reconcile exact-inbox folder metadata, and reload selected detail only when its message/thread is directly identified.
ST69 - Message and folder hints are exact-cache invalidation hints carrying no provider credentials or message bodies. Exact invalidation keys include company, `shared_inbox_id`, message, thread, page, and folders; another shared inbox and personal mail caches remain intact.
ST70 - A background Shared Triage archive response may return Accepted only after the backend has written a durable archive job and job-item rows for the accepted message IDs.
ST71 - Accepted Shared Triage archive job items must survive API process restart and be claimable by a backend worker until each item reaches archived or failed.
ST72 - The backend archive worker must claim pending or retryable Shared Triage job items with a processing lease so concurrent workers do not mutate the same active item at the same time.
ST73 - Retryable Shared Triage archive failures such as provider rate limits or transient provider errors must be recorded with attempt count, last error, and next available time instead of being dropped from memory.
ST74 - Final failures and successful completions are recorded durably on archive job items and exposed through canonical job reads; they do not publish communications WebSocket events.
ST75 - Duplicate active Shared Triage archive submissions for the same actor, shared inbox, account, and message must not create duplicate active job items or duplicate provider archive attempts.
ST76 - Shared Triage archive jobs must preserve company/shared-inbox scope and use the company-owned shared mailbox grant, not the actor's personal mailbox grant.
ST77 - Accepted background Shared Triage archive job IDs are pending work, not confirmed archive mutations; they must not be applied to the current visible shared-inbox message-list cache until an explicit user action or later full reload reconciles provider state.
ST78 - Removing a mailbox-capable shared inbox from Shared Triage without deleting the email connection is a separate remove action: it removes the Shared Triage work surface and shared inbox permissions/GVIC rows while preserving the company_email_connections credential.
ST79 - Dragging a Shared Triage mailbox email into a Logic Gate, Company Explorer Logic Gate row, Kanban column, project relationship panel, or project Logic Gate group must preserve `shared_inbox_id` through the drag payload and conversion API request; the supported cross-window boundary is Chrome window/tab to Chrome window/tab, and cross-browser application drag/drop is not a documented business requirement unless a separate compatibility rule and test are added. Company Explorer folders are not Shared Triage email conversion targets.
ST80 - Shared Triage email conversion uses the company-owned shared mailbox grant for message detail reads; it must not require or fall back to the actor's personal mailbox connection.
ST81 - A successful Shared Triage email conversion creates the same direct email-created Kanban node/card semantics as My Triage when a Logic Gate is targeted, including the visible email-origin marker and later email-transfer behavior; project-only conversion creates an email-origin project node relationship.
ST82 - Local Shared Triage conversion is reconciled once from the committed response and does not depend on a broad conversion/workspace echo. The local command must not trigger a broad reload or reuse stale prefetched pages; a later exact-mailbox provider update may invalidate future reads and reconcile metadata or directly affected detail, but it does not reload the active list.
ST83 - Successful local Shared Triage email conversion keeps converted source rows visible and patches Logic Gate icon state from the committed result without invalidating communications page/detail caches, removing rows, or triggering post-removal fill/message-length prefetch.
ST84 - Successful local Shared Triage email conversion into a Company Explorer Logic Gate must show a temporary green success banner over the Company Explorer section; other Logic Gate conversion surfaces must show a temporary success banner or notice.
ST85 - When a dragged Shared Triage email is converted into a Logic Gate, Company Explorer Logic Gate, Kanban column, project, pinned Logic Gate, or non-Explorer eligible node target, the source email is set to unstarred through the company-owned shared mailbox grant after workspace conversion succeeds. The response returns `unstarred_message_ids`, and Shared Triage applies those IDs locally without full-list replacement, stale prefetched-page top-up, or repeated shared mailbox GETs.
ST86 - Conversion-driven Shared Triage unstar reconciliation uses the committed response: the Starred source card de-stars immediately, and later canonical loads must not blank or incorrectly refill the active list.
ST87 - Every unread Shared Triage email row shows the small top-left unread dot, unread text emphasis, and accessible unread state without the retired blue/thick outer card frame. Selection is independent: the entire selected card uses the established Mango selection surface, is exposed with `aria-pressed`, and remains visually distinct from unread state.
ST88 - Sent email read receipts from Shared Triage use Nylas open tracking on outbound shared mailbox sends by sending `tracking_options.opens = true` through the company-owned shared grant.
ST89 - Shared mailbox `message.opened` receipts are stored in the company email connection/shared mailbox receipt scope, not in the viewer's personal user receipt scope.
ST90 - Shared mailbox receipt webhooks update durable/cache receipt state for the correct company connection; browsers read the receipt through canonical Shared Triage APIs. A narrow invalidation hint may publish, but it carries no receipt/message body and does not replace the active list.
ST91 - If a shared `message.opened` hint names the currently selected message or thread, Home invalidates and canonically reloads only that detail so the stored receipt summary converges. It does not trigger a message-list reload, top-up, or prefetch, and an unrelated selection performs no read.
ST92 - Sent shared mailbox messages without a stored receipt must not show a green `Not opened` indicator. Only a persisted Nylas `message.opened` signal renders the compact **Likely opened** chip. Hover/focus groups repeated signals, lists every distinct occurrence in local date/time, uses provider-reported identity only when present, labels a sole-recipient attribution as **inferred**, and keeps unknown multi-recipient activity anonymous. Inbox visibility, row preview, and Mango selection never create receipt state, and the tracking-pixel signal is not guaranteed human reading.
ST93 - Multiple Shared Triage mailbox work surfaces that point at the same company email connection share receipt state for the same provider message, with read-time authorization on each linked shared inbox.
ST94 - Nylas shared receipt support requires a public `/nylas/webhook` destination for the same Nylas app/client ID used by company-owned shared mailbox sends, and that webhook must subscribe to the Message tracking `message.opened` trigger.
ST95 - The Nylas dashboard Message tracking group may be configured with all 3 triggers selected: `message.opened`, `message.link_clicked`, and `thread.replied`; the current Shared Triage receipt contract consumes only `message.opened`, so link-clicked and thread-replied webhook deliveries must not create or mutate shared read-receipt state unless a future feature explicitly adds that behavior.
ST96 - The backend `NYLAS_WEBHOOK_SECRET` must match the secret returned by the configured Nylas webhook destination, and the Nylas app/environment must support message tracking; without that webhook secret and tracking-capable app, shared sends can request `tracking_options.opens = true` but the product will not receive usable receipt updates.
ST97 - The Postgres visible Shared Triage folder list query must pass exactly the SQL arguments it references; stale extra arguments must be regression-covered because they prevent non-admin Shared Triage folder loading before permission logic is reached.
ST98 - Selecting a mailbox-capable Shared Triage row must not clear the existing mail list, folder state, or Inbox count only because the selected shared-inbox metadata has not resolved yet.
ST99 - When the selected Shared Triage row resolves to a mailbox-capable shared inbox, the UI must load that mailbox's folders, messages, and Inbox count without requiring the user to select another shared inbox first.
ST100 - Disconnecting a Shared Triage mailbox requires an explicit point-of-click confirmation popover before the shared mailbox disconnect mutation runs.
ST101 - Shared Triage reply drafts are unique per company, user, shared inbox scope, and original message ID; opening Reply on the same shared source email resumes the existing draft instead of creating another draft row.
ST102 - A saved Shared Triage reply draft stores or reloads the original shared message context, and reopening the draft shows the original email being answered above the compose editor.
ST103 - Shared Triage compose supports To, Cc, Bcc, Reply, Reply All, and Forward; Reply All excludes the active shared mailbox address from generated recipients. Forward is a distinct draft kind that targets the exact chosen message, does not send `reply_to_message_id`, and combines authored content with the locked sanitized original plus copied source attachments under EMAIL102.
ST104 - Shared Triage scheduled sends are saved as scheduled drafts with the selected `shared_inbox_id`, use the company-owned shared grant when due while the app is open, and delete the scheduled draft only after send succeeds.
ST105 - Shared Triage compose and reply use the unified editor semantics shared with node, Logic Gate, project, attached-email reply, and signature editor surfaces, including automatic numbering, indent guides, bullet list, checklist, font size, bold, underline, italic, text highlight/No highlight, left/center/right alignment, table, links, paste cleanup, Delete/Backspace, and copy/cut/paste behavior. The visible controls use the complete shared toolbar inventory rather than a shared-compose-only implementation.
ST106 - Shared Triage compose stores rich editor content as sanitized rich HTML, while legacy plain text drafts continue to load and send as escaped/linkified HTML.
ST107 - Shared Triage received email detail must display Cc recipients when the provider returns them; Bcc is displayed only when it is present on messages the viewer is allowed to see.
ST108 - Links in Shared Triage email bodies, forwarded/replied original-message previews, sent reply bodies, and shared email signatures must open in a new browser tab when clicked.
ST109 - Node editor, logic-gate editor, and inline comment/chat text opened from Shared Triage workflows must auto-detect plain HTTP(S) or `www.` links, render them as blue underlined link text, and open them on a normal left click.
ST110 - The Shared Triage All mailbox control is a dropdown with All and Spam folder options; the selected option is visually highlighted and marked, and Spam loads the provider spam/junk mailbox through the selected shared grant.
ST111 - For Google shared mailboxes, Primary always uses `in:inbox -category:social -category:promotions`, with grouped user search and unread-only folded into that same native expression and the same exclusion enforced on fresh, refreshed, cached, and locally reconciled responses. All, Starred, Archive, and Spam retain their exact Gmail-native buckets under the selected `shared_inbox_id`; Spam, Social, and Promotions never leak into Primary or another shared inbox.
ST112 - Reading Spam and sending, scheduled sending, reply, reply-all, forward, Bcc, and draft send actions all require edit access to the exact shared inbox; no-access users receive none of its mailbox content.
ST113 - Shared Triage email drag/drop supports same-account Chrome window/tab drops onto Company Explorer Logic Gates, Logic Gate Kanban columns, project relationship panels, and Logic Gate groups inside a project; project drops create email-origin project node relationships, and Kanban or project drops open the created node popup after conversion succeeds.
ST114 - Shared Triage mailbox rows group messages by provider/Nylas `thread_id` when present so replies in the same shared conversation appear as one visible inbox item instead of duplicate rows; messages without a thread ID remain single-message rows.
ST115 - A grouped Shared Triage row uses the newest loaded message as the visible row representative while unread, starred, attachment, and thread-count indicators roll up from the loaded messages in that thread.
ST116 - Selecting a Shared Triage thread row resolves authoritative membership from Nylas thread `message_ids`, loads bounded preview metadata through structured `thread_id` pages, and uses individual detail reads for full HTML bodies under the exact `shared_inbox_id` and company-owned grant. Thread preview listing never combines `thread_id` with Gmail mailbox-native search. A selected single-message reader fills all remaining detail-pane height even when its body is short.
ST117 - Shared Triage rich compose send must preserve sanitized block indentation, explicit line breaks, blank lines, and spacing, including indent/outdent and blockquote-style indents, so sent shared email HTML does not flatten intended paragraph indentation or collapse the body into one long line.
ST118 - Expired or revoked company-owned Shared Triage mailbox provider credentials return a Shared Triage reconnect/repair state, not a Mango auth logout; permitted users remain signed in and managers/admins with edit access can repair the shared connection. Shared mailbox folder, message-list, message-detail, send, archive, star, draft, calendar event-detail, and calendar RSVP endpoints must not represent provider reauthorization as a Mango session `401`, `unauthorized`, terminal-auth, logout, or login-redirect response; they must return a recoverable provider-specific response, such as `409 nylas_reauth_required`.
ST119 - Any future change to unified editor semantics or shared editor format/outline controls must apply to Shared Triage compose and reply through the shared editor behavior and shared toolbar controls, not through a separate shared-compose-only implementation.
ST120 - Shared Triage compose/reply file attachments must follow `docs/tests/attachments.md`: files upload to Mango attachments before durable draft/send state is saved, references remain scoped to the selected `shared_inbox_id`, normal payloads do not store raw base64 `content`, and the draft API rejects embedded inline file bytes before persistence.
ST121 - Shared Triage compose/reply inline body images use the unified rich-editor image attachment path and remain durable Mango attachment references until the backend send boundary, while normal file attachments use the shared-mail attachment path.
ST122 - Incoming shared provider attachments can stay provider-referenced as mailbox metadata, but when converted into work, attached to a node, or otherwise made durable Mango work context, bytes must be cached/persisted into Mango S3 and stored as Mango attachment references under the company/shared mailbox scope.
ST123 - Mango-generated shared outgoing email HTML is marked as a Mango email body. When send-time preparation rewrites internal inline-image references, local Shared Triage Sent/reply caches must keep the provider-ready CID HTML plus metadata-only Mango attachment references when the provider response omits body or attachment metadata; they must not restore pre-send `mango-attachment:` HTML or cache raw attachment bytes.
ST124 - Shared Triage Inbox, All, Sent, and thread/detail views must preserve Mango-authored line breaks, spaces, and indentation when displaying sent or received copies of Mango-generated email bodies; this is a Mango display/cache contract and must not weaken the outbound shared email formatting that recipients receive. Once a detail or thread body is hydrated, later list, summary, star/read, or other preview-shaped payloads must not overwrite that hydrated body with a flattened snippet, and the detail pane must prefer a loading state over showing a snippet as if it were the full body.
ST125 - Shared Triage conversation detail renders the canonical conversation oldest to newest by provider timestamp with a deterministic message-ID tie-breaker, expands the newest message, and brings it into view; a locally sent reply merges at the chronological end immediately, including when the provider omits its initial timestamp or thread ID.
ST126 - Every message card in a Shared Triage conversation exposes Reply, Reply All, and Forward actions for that exact provider message. Recipients, original context, `reply_to_message_id`, stable draft identity, and shared-inbox scope come from the chosen card rather than implicitly from the latest message.
ST127 - The Shared Triage conversation detail pane is the only vertical scroll container for a thread. Every expanded email body auto-sizes from the complete body and document-root dimensions, grows to its full rendered content without clipping, and must not have its own scrollbar or a fixed shallow body viewport.
ST128 - The newest shared conversation card is expanded by default and older cards are collapsed to headers. When a new inbound or outbound message joins the selected thread it becomes expanded and the previously expanded cards collapse; manual expansion must not introduce nested scrolling.
ST129 - The shared reply editor has a useful minimum/default height, can be resized vertically, and automatically saves and restores the user's clamped height preference for that shared mailbox scope; layout changes must not squeeze it below the minimum.
ST130 - Clicking a Shared Triage email row while compose/reply is open quietly preserves the current shared draft, exits compose, selects the clicked row, and displays its detail on the first click without reloading or blanking the list.
ST131 - Shared compose/reply font-size, Bold, Underline, Italic, Highlight/**No highlight**, alignment, and table controls preserve the editor selection when toolbar focus changes. Font size and highlight apply to selected text or pending collapsed-caret typing; **No highlight** clears selected/pending highlight; inline controls toggle off as well as on; and hover/focus/active styling applies only to the individual control. Enter commits a numeric font-size value once, while Escape cancels it without a blur commit.
ST132 - At shared send time, each authorized `mango-attachment:` image reference is deduplicated, resolved from Mango S3 under the selected `shared_inbox_id`, assigned a unique alphanumeric content ID, added as an inline provider attachment, and rewritten to `cid:` in outbound HTML through the company-owned shared grant. Missing or unauthorized references fail the send.

## Nylas Configuration Contract

Shared mailbox read receipts depend on both outbound send tracking and webhook delivery for the company-owned shared grant. The expected Nylas webhook configuration for this contract is:

- Webhook destination URL: the backend `/nylas/webhook` route for the active environment, for example `https://api.dev.<domain>/nylas/webhook` in dev or a public HTTPS tunnel URL for localhost.
- Required trigger: Message tracking `message.opened`.
- Accepted full Message tracking selection: `message.opened`, `message.link_clicked`, and `thread.replied` selected together.
- Backend secret: `NYLAS_WEBHOOK_SECRET` set to the webhook secret returned by that Nylas destination.
- Current product behavior: only `message.opened` writes shared read-receipt summaries; `message.link_clicked` and `thread.replied` are ignored for read receipts. A narrow mailbox invalidation hint may publish, but `message.opened` never schedules a full active-list refresh.

## Email Threading Contract

Shared Triage uses Nylas `thread_id` to group related messages into one inbox row. The selected detail resolves authoritative membership from the provider thread's `message_ids`, uses bounded thread-filtered pages for previews, and fetches any missing member detail so sent replies and older history cannot disappear behind the first page. Subject similarity is never a fallback. Detail cards are newest first, the newest expands while older cards collapse, and expanded cards auto-size inside the thread's single scroll surface. Every preview, message, body, attachment, and send remains scoped to the selected `shared_inbox_id` and company-owned shared mailbox grant.

ST133 - Shared Triage automatically inserts the default signature scoped to the exact selected `shared_inbox_id` exactly once into each new compose, reply, and reply-all editor. A late database load may backfill only the matching still-open new draft while preserving typed text; personal or other shared-inbox signatures must never leak into it, and reopening a saved draft must not add or replace a signature.
ST134 - Shared Triage thread inspection exposes expand-all, To/Cc/Bcc, authenticated image download/fullscreen, immediate reply focus, and bounded vertical resizing under the selected shared-inbox scope. Pointer-up, pointer-cancel, lost capture, or window blur ends resizing. A calendar invitation uses the shared EMAIL103 event card with authoritative title, time/timezone, organizer, guests, location, saved RSVP, meeting join/copy controls, and provider calendar link when available; RSVP controls prevent duplicate submission and show selected state only after provider success.
ST135 - Shared remote-draft reconciliation keeps the newest reply draft for each user/shared-inbox/source-message scope, deletes superseded remote duplicates, and restores saved Reply All To/Cc/Bcc addressing without adding the active shared mailbox or duplicate recipients.
ST136 - Shared Save Draft and Send flush the mounted unified editor first and persist or submit the exact sanitized HTML returned by that flush, including the user's final DOM edit.
ST137 - The shared-inbox signature editor is a `shared_inbox_id`-scoped unified rich editor using the complete shared toolbar, including font-size, Bold, Underline, Italic, Highlight/**No highlight**, alignment, and table controls. Save Signature persists the exact flushed HTML; stale loads cannot overwrite newer edits, empty remote rows remain authoritative, and failed saves retain ordered shared-inbox pending sync without overtaking newer saves or leaking across inboxes.
ST138 - Shared primary-inbox prefetch builds a bounded logical page of at most 12 unique thread rows, stops on repeated tokens or the provider-page budget, and keys all work by company, `shared_inbox_id`, mailbox, filters, and page token.
ST139 - Shared Advance directly consumes the exact matching prefetch, awaiting matching in-flight work rather than duplicating it; personal or another shared inbox's prefetched page must never be reused.
ST140 - Shared prefetch and provider mark-read yield foreground priority to the selected shared detail request while retaining immediate optimistic unread UI.
ST141 - Clicking a different shared thread replaces prior conversation state immediately, and stale work from the previous `shared_inbox_id` or thread cannot repopulate it.
ST142 - Shared thread history uses bounded preview pages and lazy scoped body/attachment hydration. Collapsed cards issue no provider or Mango attachment-content reads; Expand all intentionally hydrates all cards.
ST143 - Signed, deduplicated shared message/folder provider webhooks invalidate only the exact linked shared-inbox cache and publish to its current authorized audience; users revoked after subscribing receive no later hints. Acceptance/reconnect start zero reads. External hints reconcile only exact-inbox folder metadata and directly identified selected detail through one active request plus at most one queued final request; the visible list remains stable and the invalidation generation fences pre-hint results from reusable future cache state. Equivalent shared-inbox metadata replacement retains the same socket/coordinator lifetime without repeating acceptance.
ST144 - A shared mailbox hint received while another Home/shared view is selected issues no provider GET. Navigation cancels/discards the prior exact request key, and returning to that shared inbox performs its canonical load; Shared Inbox A cannot refresh, invalidate, display an error in, or reuse prefetched/detail state from Shared Inbox B. A delayed/queued hint for selected message or thread A rechecks that exact selection before detail reconciliation and cannot wake newly selected unrelated detail B.
ST145 - Selecting an unread shared email by pointer, Enter, or Space immediately removes its unread dot/frame, updates the selected card and unread counter, and persists through the exact shared provider command. Stale responses cannot resurrect unread; failure rolls the row/counter back and surfaces the established error.
ST146 - Shared conversation detail uses provider `thread.message_ids` to hydrate sent and received members missing from the bounded preview page, deduplicates IDs, and stays scoped to the exact shared inbox/company grant. Provider thread or exact reply metadata may establish membership; subject similarity never does, forwarded unrelated mail is not absorbed, and unresolved one-offs remain valid.
ST147 - Ordinary shared-inbox durable draft list/get/create/update/delete operations require the exact `shared_inbox_id` plus effective edit access. Scope is immutable, the stored account is canonicalized from the shared inbox, known IDs from personal/other shared scopes cannot be read, changed, reassigned, or deleted, and browser fallback is filtered to the active inbox with only explicit pending-sync migration. The Shared Triage Drafts tab renders that collection plus active collaboration shared drafts for which the current user is a permanent participant under EMAIL65 through EMAIL69; it never lists a private personal draft, an unauthorized collaboration draft, or provider Drafts.
ST148 - Private personal drafts never appear in Shared Triage, and ordinary drafts for Shared Inbox A never appear in B. Collaboration shared drafts are the explicit participant-authorized exception and must display their immutable source mailbox rather than masquerading as an ordinary draft in the selected inbox. Ordinary shared-inbox edit permission permits list/get and draft-attachment reads, edit permission is required for create/update/delete and attachment mutation, and company manager status alone never grants another user's personal-draft attachment access.
ST149 - A Shared Triage row shows the established accessible thread indicator on its left only when canonical/loaded conversation count is greater than one; a one-off or unproven count shows no icon.
ST150 - Shared read-on-open timers, optimistic overlays, and mutation responses use the authenticated company/user/shared-inbox scope plus provider message ID. Identical provider IDs in personal or other shared scopes cannot cancel or overlay one another, and a completion may update only the exact captured mailbox/filter and selection generation; stale failures cannot clear, refresh, or display errors in the newly selected inbox.
ST151 - Shared Triage email cards use the same compact triage-row implementation as My Triage. Horizontal card padding is no more than 6 CSS pixels per side, and the left indicator rail is no more than 20 CSS pixels wide while retaining the approximately 9-pixel unread dot, thread indicator, keyboard focus, and drag hit behavior.
ST152 - The top sender/subject line reserves only the actual width of its top-right timestamp/action metadata. The body/snippet line flows beneath that metadata across the remaining card width to within 8 CSS pixels of the right edge; no fixed empty right metadata column or decorative spacer may shorten every line.
ST153 - Compact spacing preserves the shared-inbox card contract: unread dot/frame, selected pressed surface, conditional thread icon, ellipsis, scope-correct commands, and pointer/keyboard/drag affordances remain distinct and usable.
ST154 - Shared Triage email rows come only from the selected shared inbox's canonical provider list. Mention participation alone grants Node/chat access; it does not grant mailbox navigation or create a Shared Triage or My Triage email row for a participant whose accessible provider mailbox did not return the message.
ST155 - When a canonical Shared Triage provider row matches a collaboration by exact shared inbox plus provider thread/message identity, Mango annotates that provider row with collaboration/Node identity. Provider unread/starred/attachment/thread state remains authoritative, and no collaboration snapshot may become a separate, fallback, or cross-inbox row.
ST156 - Opening an authorized shared row that already has one or more accessible Node associations opens the full-height right comment rail and shows every connected Node chat. An unassociated row stays full width until text selection or a per-message comment action opens the rail. There is no global Chat button. Reading, closing, and abandoning an empty composer create nothing. If no Node is associated, the first nonempty comment creates a floating Node with no priority and no Logic Gate. Exact-shared-inbox validation and acknowledged save precede clearing the draft. Shared Triage and Node use the same canonical message-linked ChatPane history.
ST157 - Selecting email text is step 1: it immediately opens the comment rail and creates an exact message/quote/offset anchor. Typing is step 2. Each reply card exposes an unanchored per-message comment icon before its three-dot menu. With one associated Node the comment targets it; with several, Shared Triage asks which connected Node owns the comment or offers a new floating Node. Enter resolves or creates that Node's exact-message text box. Activating an anchor navigates to the correct card without a second conversation scrollbar or source-content changes.
ST158 - Reply All exposes Create Shared Draft for the exact selected source message. Every permanent participant can see the resulting revisioned shared draft in Drafts/My Drafts with its source shared inbox identified, but only collaboration participation authorizes that draft and no participant gains unrelated shared-inbox access.
ST159 - Collaboration shared drafts are immediate-send only under EMAIL68. Their compose footer omits scheduled send and the ordinary Shared Triage browser scheduler excludes them; this does not change scheduled-send behavior for ordinary shared-inbox drafts.
ST160 - Unsynchronized shared fallback drafts survive Mango `401`, unclassified `403`, provider reauthorization/disconnection `409`, `5xx`, and network failures. Only explicit access/company revocation, shared-inbox deletion, or conversion to a non-mail-bearing row purges that exact inbox; personal and other shared scopes remain intact.
ST161 - Shared draft loads use exact-inbox generations plus local revisions. An older load cannot overwrite a newer load, save, delete, remote save completion, personal account, or another shared inbox; stale callers return current exact-scope state.
ST162 - Shared compose persists the live exact-inbox draft before attachment upload/link. Draft attachment reads and mutations require current Edit access, but every operation also requires that exact draft to remain live. Deletion revokes draft-only access even for manager/admin bypass attempts; an independent sent-message link remains authorized by its own resource.
ST163 - Shared Triage chat shows the EMAIL77 compact participant roster from durable collaboration provenance. Mentioning a same-company user grants Node-chat participation only; it never changes shared mailbox recipients, CC/BCC, delivery, or provider subscription.
ST164 - A Shared Triage floating-Node ensure or first-comment failure follows EMAIL78: source email and rail remain open; text, mentions, reply target, attachments, chosen Node-chat target, stable requested Node ID, and email anchor remain recoverable; no saved comment appears before backend acknowledgement; and retry stays in the exact shared inbox scope.
ST165 - The exact shared-inbox signature, including authenticated Mango image references, is durably saved and automatically appended once to every new compose, Reply, and Reply All for that inbox. Settings eagerly render its authenticated image preview; late hydration preserves live typing, and rerender, autosave, restored drafts, reply-mode switches, or another shared inbox never duplicate or replace it.
ST166 - A shared read-on-open provider command survives ordinary mailbox-tab, search, unread-only, and Home-view navigation under its captured exact shared inbox. Its response is barred from a newly selected inbox/list/selection, but navigation cannot cancel the provider mutation while retaining a false optimistic overlay.
ST167 - Shared folder metadata is owned by company plus exact shared inbox, independent of Primary/Starred/Sent, search, and unread-only filters. A filter transition accepts an in-flight exact-inbox folder response; an inbox transition rejects it and performs destination reconciliation.
ST168 - Signed shared message/folder webhooks distinguish legitimate zero-delivery from authorization infrastructure failure. No subscriber or no currently authorized viewer is acknowledged as a no-op. Existence/audience timeout or repository error releases deduplication and returns a retryable failure so a transient authorization outage does not permanently lose the exact-inbox hint. Retrying the same `message.opened` payload reuses its first receipt timestamp and does not inflate the signal count.
ST169 - Shared Triage conversation headers show only the subject. Collapsed messages show sender/date/snippet and hide From/To/Cc/Bcc; activating the accessible disclosure reveals that exact message's labeled participants, full body, attachments, and actions without changing reply target, provider thread membership, or source inbox.
ST170 - Ordinary shared-inbox compose/reply, due scheduled-draft execution, and collaboration shared-draft send all enter EMAIL90's centralized ten-second pre-dispatch gate. The elevated non-green action row appears in the established triage notice area with a right-to-left countdown; accessible Send now dispatches only that attempt immediately through the exact shared grant and existing collaboration claim/idempotency path, while Undo sends no provider request and preserves the durable draft/revision. For a due scheduled draft, Undo also clears the persisted send time so the scheduler cannot retry it; expiry dispatches once when neither action has already settled the attempt.
ST171 - Shared Triage uses the same responsive mail-control row as My Triage: compact search controls on the left, visible unread count plus Unread only and accessible Newest/Oldest ordering on the right, and clean wrapping at narrow widths. Newest first is the default. Oldest loads the complete exact-shared-inbox filtered tab in bounded provider pages before choosing visible page membership, so Inbox, Starred, My Drafts, All, Spam, and Sent show the true oldest or newest conversations while preserving thread condensation, search/unread scope, and the primary 12-conversation archive-page limit.
ST172 - Shared Triage loads every folder-metadata page before deriving its Inbox-only counter. The exact provider total wins; if absent, the active unfiltered Inbox shows the loaded message count with a `+` while more pages remain and retains that fallback across tabs for the same shared mailbox. Starred has no counter. Shared Triage uses the same full-height new-message body plus stable three-slot Sent header as My Triage. The disabled Archive page/go-next control remains visible in Sent, exact shared-inbox authorization is unchanged, sent Mango inline images receive an independent shared-inbox/message link, and controlled typing never reloads an unchanged hydrated image.
ST173 - A shared-inbox signature's display derivative may hydrate Settings/compose, but send requires current Edit authorization and validates only that inbox signature's coherent original bucket/key/size/SHA record before CID multipart. Success promotes the exact shared-inbox/message inline link for Sent; missing/corrupt original state never falls back to display or a browser object URL.
ST174 - Shared timer-expiry and Send now dispatches use the same company-owned grant and backend closure once and surface the same failure. A failed signature-image send preserves the current shared compose/draft or collaboration revision, reports no false success, and exposes only the classified public code plus sanitized server correlation.
ST175 - With a prefetched page available, Shared Triage Archive page and go next swaps to that page before any new message-list read and submits exactly one background archive request for the frozen previous 12 IDs. The next bounded prefetch and durable archive-job/folder reads are separately expected work; none may replace or blink the displayed page.
ST176 - For archive, unarchive, star, read, and delete, the initiating browser records exact shared-inbox scope, provider trigger, and message ID before dispatch. After a successful shared send returns its provider message ID, the browser records the expected `message.created` echo before local list/detail reconciliation. A matching provider echo is consumed once, expires within a bounded time, is removed when a command fails, and causes zero cache invalidations, browser GETs, list replacements, or UI refreshes. Suppression remains browser-local so other currently authorized viewers receive the external-change hint.
ST177 - A genuinely external shared message create/update/delete invalidates cached future page data, may coalesce one exact-inbox folder metadata read, and may reload directly identified selected detail. It never reloads or replaces the currently displayed 12-row page; the change appears on the next explicit canonical list load.
ST178 - Opening shared Sent, Starred, All, Archive, or another non-primary tab performs one initial newest-first message-page load. If the filtered/condensed result has a next page but no usable scroll range, Mango automatically appends pages until scrolling is possible or the provider is exhausted; otherwise additional pages require near-bottom scroll intent. Separate selected-detail/thread reads remain expected.
ST179 - Shared mailbox subscription acceptance/reconnect and global notification-summary events start zero mail list, folder, collaboration, page, or detail GETs. They may only mark reusable cache state stale for the next explicit read.
ST180 - The normal Archive button in an open Shared Triage message advances to and opens the row immediately below the archived row, falling back to the previous row only when the archived row was last. This is separate from Archive page and go next.
ST181 - A known Shared Triage thread never first renders as a standalone selected message while canonical membership is loading. It shows a stable Loading conversation shell, then mounts the complete timeline, and does not start a competing child body hydration during the parent detail request.
ST182 - Shared Triage All and other non-primary tabs must remain scrollable whenever more provider pages exist; thread condensation cannot strand the user on a short first page.
ST183 - Oldest order requests the complete filtered shared-mailbox tab with internal provider pages of at most 200 messages, rejects repeated cursors instead of returning a partial result, deduplicates provider message IDs, and preserves the exact `shared_inbox_id`.
ST180 - Automated realtime regression tests must assert request budgets for Shared Triage as well as personal mail: local mutation echo bursts and acceptance/reconnect produce zero reads, while external bursts cannot request a message-list replacement.
ST184 - Shared Triage keeps Inbox, Starred, Sent, and All/Spam in four equal top positions, with Compose, My Drafts, and Archive page/next always occupying three equal lower positions. Inactive lower controls use shared light gradient tints; only the selected Compose or My Drafts destination becomes fully saturated. Archive page/next remains in the third slot and is disabled instead of removed outside Inbox, while All and Spam expose a full-row hover/focus highlight with no dead option gap.

ST185 - Once a Shared Triage conversation has one or more email Nodes, its row and associated reply cards show an accessible Node indicator immediately after mutation. Activating it opens that Node at the clicked provider message without leaking outside shared-inbox authorization. The top toolbar has one compact hashtag destination search and no global Chat button. Pressing # focuses it. While blank, the only result is `Create floating node (a node without a Logic Gate)`, which submits immediately without priority or Logic Gate. As soon as the user types, results search current/existing Nodes, Logic Gates, and Projects. Existing Nodes submit directly; Logic Gate destinations require priority, and Projects require priority plus a Logic Gate. Success stays on the email under a temporary green overlay, reconciles every connected Node chat, and preserves the authorized durable thread route, exact message-linked text box, shared accent, and no transient `not_found` card.
ST185 interaction detail - A provider-only row is accepted with its Nylas message ID; existing-Node import creates and returns the internal `email_message_id` before the exact-message text box is written. Direct imports immediately add the Node indicator to the Shared Triage header, mailbox card, loaded replies, and connected-chat list. A later reply without an internal ID is imported even when the thread already has Nodes. Priority choices are pre-open only for Logic Gate and Project destinations; floating creation bypasses them.
ST186 - In a shared-inbox email collaboration, every chat comment authored by the current user has an inline Edit action after it is sent. Other participants' comments have no Edit action even when they share Node Edit access. Saving stays inside the exact shared-inbox/collaboration authorization boundary, preserves the source email/message linkage and attachment/reply metadata, applies newly resolved mentions atomically, and displays Edited after canonical reconciliation.
ST187 - For a navigable Shared Triage mailbox, the canonical provider message page for the exact company, `shared_inbox_id`, mailbox, search, unread filter, and page token is authoritative for list membership. A Node/email-collaboration snapshot may annotate a matching provider message or thread with Node/chat identity, but it must never manufacture a Shared Triage row when that exact provider result contains no match.
ST188 - After normal Archive or Archive page and go next removes a shared-inbox message from the displayed page, no same-source collaboration snapshot, stale Inbox/unread metadata, cached detail, prefetch result, selection change, or list merge may reinsert it. The row may reappear only when a later canonical provider list actually returns it, including after a real archive-job failure; the user must never need to click the stale row to make it disappear.
ST189 - Attaching a shared-inbox email or thread to a Node changes collaboration metadata and chat access, not provider mailbox membership. If the provider still returns another unarchived message in the same thread, that canonical message may carry the Node indicator; the stored collaboration snapshot alone is never proof that any message remains in Inbox.
ST190 - No collaboration-only My Triage fallback exists for a participant who cannot navigate the immutable source shared inbox. The participant retains collaboration Node/chat and stored-thread access without receiving an email-list row. Automated coverage must prove matching-row annotation, missing-row suppression after archive and refresh, thread matching, exact-shared-inbox isolation, and suppression outside the selected provider mailbox.

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
- User A has edit access to one shared inbox and no access to another.
- A company admin and a company manager belong to the same company.

Expected:
- User A only sees the shared inboxes where effective access grants view or higher.
- User A does not see private personal mailbox messages in Shared Triage.
- The company admin sees shared inboxes with edit effective access.
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
- A user has edit access to a mailbox-capable Shared Triage inbox.
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
- Creating under the no-access parent fails for the manager.
- Rename and move require edit access; mailbox linkage changes require manager/admin authority and edit access.
- Protected shared inbox folders cannot be renamed or deleted.
- Deleting a mailbox-capable shared inbox removes the Shared Triage work surface and linked company email connection everywhere.
- Removing a mailbox-capable shared inbox from Shared Triage removes the work surface but keeps the company email connection available for reuse.
- The committed HTTP response patches the initiating browser's affected Shared Triage tree and mailbox state locally. Other clients reconcile on their next canonical tree load or navigation; no workspace refresh event is emitted.

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
- User A has edit access to Shared Inbox 1.
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
- One regular user has edit access and a company manager has edit access.
- The access store can be available or unavailable.

Expected:
- The regular no-access user cannot read or update access settings.
- The company manager can update default access and explicit resource grants for regular company users.
- The response includes default access, explicit grants, GVIC assignments, effective access, can-edit-permissions, and can-edit-manager-permissions.
- GVIC assignments are not converted into resource permission grants and do not grant edit access or authorize delete/mutation actions.
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
- User A has edit access only.
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
- The browser opens a mailbox-capable Shared Triage surface through canonical HTTP APIs.

Expected:
- Selecting the plain parent folder clears any previous mail list and selected message state.
- Selecting the plain parent folder does not call email folders, message list, message detail, prefetch, or load-more endpoints.
- Selecting the plain parent folder does not retry mail GETs when the row has no mailbox connection because folders are not mailbox resources.
- Selecting the mailbox-capable shared inbox may load mail using the company-owned shared grant.
- Nylas message/folder webhooks update only exact-inbox backend/frontend cache state and reconcile only the currently open mail-bearing shared inbox; event payloads never mutate visible rows directly.
- Hints received in My Work, Updates, GVIC, root/headings/plain folders, another shared inbox, or another mail tab trigger no provider GET and install no fallback personal subscription.
- Clicking an email row, focusing the email body, and clicking back into the list do not reload, blank, or replace the message list.
- Focus or visibility return does not refresh the active mailbox-capable mail view, and there is no browser-side 30-second message polling loop.
- First acceptance and reconnect perform zero provider reads. Signed external message/folder hints share one exact-scope coalescer for metadata and directly identified detail only; the visible list remains stable.

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
- ST138
- ST139
- ST140

Given:
- A user opens a mailbox-capable Shared Triage inbox with edit access to the shared mailbox.
- The shared mailbox has more than 12 messages available.
- The first visible page and the next page can be read from the mailbox provider.

Expected:
- The visible page contains no more than 12 messages.
- After the selected shared detail request gets foreground priority, the next page is prefetched as a bounded logical page of at most 12 unique thread rows; filling stops on a repeated provider token or the configured request budget.
- Provider hints never inject or patch untrusted message payloads directly. Acceptance/reconnect perform zero reads, and external message/folder hints reconcile only exact-inbox metadata or directly identified detail through one active request plus at most one queued final request.
- Mail committed during initial connection or disconnection appears on the next explicit canonical list load; acceptance invalidates reusable cache state without polling or replacing the current page.
- Local committed commands patch affected visible rows; narrow provider hints invalidate only exact company/shared-inbox/message/thread/page/folder cache keys.
- Every unread row keeps its dot and text emphasis without a blue/thick outer frame, while the selected row uses the distinct full-card Mango selection surface. Opening by pointer or keyboard clears unread/count immediately, and failure rolls back visibly.
- Scrolling the visible page does not archive any messages and does not append another primary-inbox page.
- Clicking the advance action freezes the currently visible message IDs, directly consumes (or awaits) the matching company/shared-inbox-scoped prefetched logical page without duplicating provider reads, and enqueues only the frozen previous-page IDs for background archive.
- The frozen previous-page IDs are accepted by one page-level backend archive request only after durable archive job rows are written, and provider archive mutations continue from the backend worker using the shared mailbox grant.
- The advance action becomes usable again immediately after the next page is shown and the previous page is queued.
- The hidden archive queue accepts at most 140 pending emails; if adding the current page would exceed that limit, the advance action is disabled until enough background archive work completes.
- Accepted Shared Triage archive job items survive API restart and are retried by the backend worker until each item is archived or records a final failure.
- Duplicate active archive submissions for the same actor, shared inbox, account, and message do not create duplicate active job items.
- Retryable provider failures remain recorded with attempt count, last error, and next retry time.
- Successful and final-failed Shared Triage archive job items expose durable state through canonical job reconciliation without communications WebSocket events.
- Folder metadata refresh runs after the primary archive-and-next work as reconciliation only; it is coalesced, does not duplicate an in-flight folder request, and does not fetch the next email page.
- Canonical archive-job reads reconcile pending Shared Triage archive bookkeeping from durable job-item state without blanking, fully reloading, or removing rows from the currently visible prefetched page.
- Accepted background Shared Triage archive IDs are not treated as already archived in the frontend list cache; the current page remains stable while earlier page jobs drain in the backend.
- Starring or unstarring a message updates the row locally, and the committed HTTP response reconciles that concrete state. Its provider echo produces zero GETs; a later external hint leaves the list stable while invalidating future reads and coalescing metadata.
- Every unread row keeps its top-left dot and text emphasis without a blue/thick outer frame. Selection is a separate full-card surface, and pointer/keyboard open clears the selected thread card's loaded unread members immediately while scoped provider writes reconcile.
- Opening or returning to a Shared Triage mailbox does not fire background logic-gate view repair requests for missing, inaccessible, or stale node-linked logic gate IDs.
- If the backend accepts the archive page but a durable job item later reaches failed state or remains incomplete, the source email is not deleted and can remain or reappear on the next canonical load.
- If the archive request fails after the next page is shown, the user remains on the next page and sees an archive failure.
- If there is no next page, clicking the advance action enqueues the visible page and leaves the list empty until a later canonical load finds more inbox messages.

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
- ST113

Given:
- A user has edit access to a mailbox-capable Shared Triage inbox.
- That shared inbox has a connected company-owned mailbox grant.
- The user drags an email from that Shared Triage mailbox into a Logic Gate, Company Explorer Logic Gate row, Kanban column, project relationship panel, or project Logic Gate group.

Expected:
- The drag payload and conversion request include the selected `shared_inbox_id`.
- The backend reads the message through the shared mailbox grant and authorizes the mutation as the actor.
- The resulting Kanban card is marked as directly email-created and can later transfer its email attachment into another node card.
- Project-only drops create an email-origin project node relationship without a Logic Gate assignment; project Logic Gate drops also create the Logic Gate node/card assignment.
- Same-account Chrome window/tab drops onto Kanban or project surfaces open the committed node popup after conversion succeeds.
- Company Explorer folder rows are not email conversion targets and must not create Explorer node rows, folder items, or `company_explorer_items` rows.
- The visible Shared Triage email list handles the local conversion from the committed result by keeping converted rows visible and patching row/detail/cache Logic Gate icon state without full-list replacement, communications cache invalidation, stale prefetched-page top-up, post-removal fill, message-length prefetch, or repeated workspace/mail GET bursts.
- The backend sets converted shared source emails to unstarred through the shared mailbox grant, returns successfully updated IDs in `unstarred_message_ids`, and the Shared Triage list reconciles locally without loading replacement Starred rows.
- A converted email dragged from Shared Triage Starred visually de-stars immediately from the committed conversion/unstar response. A matching local echo produces no GET; a later external hint leaves the list stable and cannot reuse stale prefetched data or cause repeated GET bursts.
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
- ST136

Given:
- A user has edit access to a mailbox-capable Shared Triage inbox.
- The shared inbox has a connected company-owned mailbox grant.
- The user sends mail from that shared mailbox, and Nylas later emits `message.opened` webhooks for the shared grant.
- The active Nylas app has a public `/nylas/webhook` destination with Message tracking `message.opened` selected; selecting all 3 Message tracking triggers (`message.opened`, `message.link_clicked`, and `thread.replied`) is valid for this environment.
- The user composes shared replies, reply-all messages, forwards, drafts, scheduled messages, and messages containing links/rich text.
- The shared provider mailbox contains Inbox, All, Sent, and Spam/Junk messages, while Mango contains database drafts scoped to the selected shared inbox.

Expected:
- Shared sends request Nylas open tracking through the company-owned shared grant.
- The configured webhook secret matches `NYLAS_WEBHOOK_SECRET`; otherwise webhook POSTs are rejected and no shared receipt summary is written.
- The backend stores open signals under the company email connection/shared mailbox scope and does not write them to the actor's personal receipt scope.
- `message.link_clicked` and `thread.replied` webhook deliveries do not create or mutate read-receipt state under the current Shared Triage contract.
- Canonical receipt reads remain scoped to the linked shared inbox and require edit access.
- The Sent mailbox shows **Likely opened** only for messages with a stored receipt signal; repeated occurrences and supportable/inferred/anonymous attribution follow ST92, while messages without a signal do not show `Not opened`.
- A selected affected Sent detail canonically reloads from its compact exact-mailbox `message.opened` hint while unrelated selections and cached list rows remain untouched.
- If more than one Shared Triage mailbox entry points at the same company email connection, those entries share the stored receipt summary for the same provider message while read-time authorization remains tied to each linked shared inbox.
- Replying to the same shared source email never creates more than one reply draft for that source message and shared mailbox scope.
- Reopening a shared reply draft shows the original email context above the compose editor.
- Reply, Reply All, Forward, Cc, Bcc, scheduled send, and rich compose send through the selected shared inbox scope and continue to require edit access.
- Shared rich compose controls use the unified editor behavior and complete shared segmented format/outline toolbar used by node, Logic Gate, project, and attached-email reply surfaces.
- Save Draft and Send flush the compose editor and use the exact returned sanitized HTML.
- A future scheduled shared send is saved as a scheduled draft with `shared_inbox_id`, is sent through the company-owned shared grant when due while the app is open, and is deleted only after send succeeds.
- Received Cc recipients are visible in message detail.
- Shared email body/signature/original-preview links open in a new browser tab on click.
- Node editor, logic-gate editor, and inline comment/chat links render as clickable underlined links and open on single left click.
- The All mailbox dropdown can switch between All and Spam folder, with the selected option highlighted and marked.
- Spam/Junk reads stay scoped to the selected Shared Triage mailbox and do not leak into primary inbox results or other shared inboxes.
- Google Primary always excludes Social and Promotions on fresh loads, `refresh=true`, cached responses, and local reconciliation; those messages remain available in All or Starred as appropriate.
- Shared Drafts reads the selected inbox's Mango database collection and never requests the provider Draft mailbox.

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
- Once the selected row resolves to a mailbox-capable shared inbox, folders, messages, and the Inbox count load for that shared mailbox.
- The user does not need to click a different shared inbox and then return to make the selected shared mailbox load.
- Clicking disconnect opens a small confirmation popover near the clicked button.
- The shared mailbox disconnect mutation runs only after the user confirms that popover.

### Scenario ST-S13: Shared Threaded Inbox Rows And Conversation Detail

Business logic covered:
- ST114
- ST115
- ST116
- ST117
- ST123
- ST124
- ST125
- ST126
- ST127
- ST128
- ST141
- ST142

Given:
- A mailbox-capable Shared Triage inbox has multiple provider messages with the same Nylas `thread_id`.
- The current user has edit access to that shared inbox.
- The user with edit access sends a rich formatted shared reply with indented content, explicit line breaks, and blank lines.
- The provider send response may omit the body even though Mango submitted rich HTML.

Expected:
- The Shared Triage list shows one row for the thread, not one row per reply.
- The sent body keeps the user's line breaks, spacing, and indentation in the outgoing HTML.
- The row preview comes from the newest loaded message while unread/starred/thread-count indicators roll up from the loaded messages in that thread.
- The right-side detail pane fills the available detail area and shows the conversation newest first with a deterministic tie-breaker.
- The newest card is expanded and older cards are collapsed; a newly received or locally sent reply moves to the top, expands immediately, and collapses previously expanded cards.
- Each card's Reply, Reply All, and Forward actions target that card's message ID while retaining the selected shared-inbox scope.
- The thread detail pane owns the only vertical scrollbar; every expanded body auto-sizes to its full rendered height without an iframe/card scrollbar.
- A short plain-text message fills the remaining right-side detail height, while a long promotional HTML message expands to its complete document height and remains fully reachable through the detail-pane scrollbar.
- Thread IDs and message bodies are loaded only through the selected `shared_inbox_id` and company-owned shared grant; the UI must not fall back to the actor's personal mailbox.
- The selected shared message detail is the foreground read. Thread history starts from bounded structured `thread_id` list previews without Gmail-native mailbox search; authoritative members absent from those previews are recovered immediately through exact-ID reads in the selected shared inbox, while preview-resolved older bodies are fetched only when their card is expanded or Expand all is chosen.
- Selecting a row from another shared thread immediately replaces the prior conversation cards, while same-thread reconciliation may preserve already hydrated detail; no personal/shared cache entry is reused across scopes.
- Sent shared rich HTML preserves block indentation instead of flattening indented paragraphs.
- Local shared Sent/reply caches keep provider-ready Mango HTML when the send response omits body content, including CID-rewritten inline-image HTML rather than stale internal attachment URLs.
- Mango's own shared Inbox, All, Sent, thread, and detail displays preserve Mango-authored line breaks, spaces, and indentation instead of flattening the same email body into one sentence.
- Once the selected shared message or thread has a hydrated body, list refreshes, read/star changes, and preview-only cache writes preserve that hydrated structure instead of replacing it with the row snippet.
- While a full detail body is being fetched, the detail pane may show a loading placeholder but must not present the shared inbox preview snippet as the full structured body.

### Scenario ST-S13B: Shared Signature Is Applied Automatically

Business logic covered:
- ST133

Given:
- A user with edit access opens a new compose, reply, or reply-all editor in a Shared Triage mailbox with a saved default signature.
- The shared signature may finish loading after the new editor opens.

Expected:
- The signature for that exact `shared_inbox_id` appears once without requiring the user to press Insert Signature.
- Personal signatures and signatures from other shared inboxes never appear in the draft.
- If the signature arrives late, it is appended once to the matching still-open new draft without removing text already typed.
- Reopened saved drafts are not mutated, and rich-editor serialization cannot cause a duplicate signature.

### Scenario ST-S13C: Shared Signature Uses The Unified Editor

Business logic covered:
- ST120
- ST131
- ST137

Given:
- A user with edit access opens the signature editor for a shared inbox, formats text with the shared font-size, Bold, Underline, Italic, Highlight/No highlight, alignment, or table controls, and saves.
- A signature load, legacy backfill, failed retry, or newer save may overlap that edit.

Expected:
- The signature editor uses the same unified rich editor host, semantics, formatting controller, and toolbar as shared compose/reply; it is not a native textarea.
- Font-size, inline-format, highlight/No highlight, alignment, and table controls operate on the preserved selection or appropriate collapsed-caret/context semantics.
- Save Signature persists the exact flushed sanitized HTML for that `shared_inbox_id` and reports success only after the remote save succeeds.
- Stale hydration cannot overwrite the newer local edit, an empty remote row remains authoritative, and pending retries/backfills are serialized before newer saves without replacing them.
- Personal signatures and edits or pending retries from another shared inbox never leak into the selected shared-inbox scope.
- Embedded inline file bytes are rejected before durable signature persistence.

### Scenario ST-S14: Shared Mail Attachments Use Mango Attachments

Business logic covered:
- ST13
- ST14
- ST80
- ST81
- ST105
- ST106
- ST120
- ST121
- ST122
- ST123
- ST132

Given:
- A user attaches files to a Shared Triage compose, reply, reply-all, forward, or scheduled draft.
- A user pastes an inline image into the Shared Triage compose/reply body.
- A shared mailbox provider message with attachments is converted into work or attached to a node.

Expected:
- File attachments upload to Mango attachments before durable draft/send state is saved.
- Shared draft/send payloads store Mango attachment references, not raw base64 attachment content.
- The draft API rejects embedded inline file bytes before durable storage.
- Attachment references preserve the selected `shared_inbox_id` and company-owned shared mailbox scope.
- Converting a shared message to a node persists `shared_inbox_id` and `account_email` in the attached-email projection; later node thread reads, downloads, replies, Reply All exclusion, and calendar RSVP stay on that shared grant.
- Inline body images use the unified rich-editor image attachment path and durable shared drafts keep Mango attachment references.
- At send time the backend deduplicates inline references, authorizes and reads the S3 bytes under the selected `shared_inbox_id`, creates matching inline provider/CID attachments, rewrites image sources to `cid:`, and sends through the company-owned shared grant.
- The send response/cache fallback contains provider-ready CID HTML and metadata-only attachment references, never raw bytes; missing or unauthorized references reject the send visibly.
- Current attached-email/conversion projections do not persist provider attachment bytes; before a shared provider attachment becomes a durable Mango-owned resource, it must be cached into Mango S3 and represented by Mango attachment references under the company/shared mailbox scope.

### Scenario ST-S15: Shared Reply Target, Editor Controls, And Compose Transition

Business logic covered:
- ST101
- ST102
- ST105
- ST126
- ST129
- ST130
- ST131
- ST135
- ST136

Given:
- A user with edit access has a multi-message Shared Triage thread open.
- The user resizes the reply editor, formats selected text, or has an unsent shared compose/reply draft open.

Expected:
- Choosing Reply, Reply All, or Forward on an older card builds the action from that exact message and resumes only that message's stable shared draft.
- Reconciliation removes older remote reply drafts for the same shared-inbox/source-message scope, and reopening Reply All restores saved To/Cc/Bcc recipients with active-mailbox exclusion intact.
- The reply editor never collapses below its minimum, saves its resized height automatically, and restores the preference for that shared mailbox scope.
- Font-size and highlight apply to the preserved selection or pending collapsed-caret typing style; Bold, Underline, and Italic toggle on/off; **No highlight** clears selected/pending highlight; alignment and table actions use the preserved context; active indicators follow the selection or pending state.
- Saving, transitioning away, or sending flushes the mounted editor first so the final edit cannot be lost to stale compose state.
- Clicking a different shared email row quietly saves the active shared draft, closes compose, and shows the clicked message on the first click without replacing the visible list.

### Scenario ST-S16: Shared Thread Inspection And Calendar Event Card

Business logic covered:
- ST107
- ST114
- ST116
- ST118
- ST126
- ST127
- ST128
- ST129
- ST134

Given:
- A user with edit access opens a Shared Triage thread containing Cc/Bcc metadata, screenshots, attachments, or an iCalendar invitation.

Expected:
- `Expand all threads` expands the complete shared conversation.
- Every message displays To, Cc, and provider-visible Bcc metadata when present.
- Reply all uses the exact selected message and includes every visible reply-to/from, To, and Cc recipient once.
- Selecting a screenshot exposes Download and double-click opens a full-screen preview.
- Reply/Reply all focuses the shared unified editor immediately; pointer-up, pointer-cancel, lost capture, and window blur all terminate vertical resize.
- The shared event card shows available title, local time plus provider timezone, organizer, guests, location, current response, Join meeting, Copy link, and Open calendar. Accept, Tentative, and Decline use the shared inbox grant, require edit access, prevent duplicate submission while pending, and show saved state only after provider success.
- An expired/revoked shared grant, missing calendar scope, or provider failure leaves the RSVP unselected and presents a recoverable shared-mailbox reconnect/provider error without logging the user out of Mango.
- A user with edit access can inspect the invite and send an RSVP; a no-access user receives neither the invite nor its actions.

### Scenario ST-S17: Live Arrival, Complete Shared History, Read State, And Draft Isolation

Business logic covered:
- ST40
- ST41
- ST67
- ST69
- ST87
- ST114
- ST116
- ST143
- ST144
- ST145
- ST146
- ST147
- ST148
- ST149
- ST150
- ST160
- ST161
- ST162

Given:
- An external sender starts a shared-mailbox conversation, an authorized Mango editor replies, and another message commits after the initial list but before first exact-inbox subscription acceptance.
- Shared Inbox A and Shared Inbox B both have durable drafts, and users with no-access/edit access plus a company manager without personal-draft ownership attempt exact-ID operations.
- Recoverable and definitive draft-list errors occur; overlapping exact-inbox loads complete out of order while a local save/delete occurs.
- A shared draft attachment is read while active, the viewer loses permission, the draft is deleted, and an independent sent-message link remains.

Expected:
- The signed provider webhook publishes only to the exact current authorized shared-inbox audience. Acceptance/reconnect perform zero provider reads; the between-list-and-acceptance message appears on the next explicit list load, and later hints coordinate metadata/direct-detail work only.
- Root/headings/plain folders, another view, and Shared Inbox B make no GET for A. Navigation cancels A's timer/request key before B loads, and an unrelated new message does not refetch selected detail.
- Conversation detail includes the original inbound, shared sent reply, and newest inbound even when a member was missing from the first preview page. Provider identity is authoritative; an unrelated forward/subject match is not merged and no data crosses shared inbox scopes.
- Pointer, Enter, and Space open use the same optimistic read path, immediately clear unread styling/count, stay read after success, and accurately roll back with an error after failure.
- The multi-message row shows the accessible thread icon; a one-message row does not.
- For ordinary inbox drafts, a viewer may list/get only A's database drafts and attachments and only an editor may create/update/delete or mutate them. A cannot enumerate or take over B/private-personal IDs; only a permanent-participant collaboration draft is the explicit cross-surface exception and it labels its true source. Provider drafts never appear, scope cannot be reassigned on conflict or soft-delete reuse, and a shared account-email spoof is replaced by the canonical inbox account.
- Recoverable auth/provider/service/network errors retain pending drafts; only explicit revocation, deleted inbox, or non-mail-bearing scope purges A. Out-of-order loads cannot overwrite saves, deletes, B, or personal storage.
- Compose persists the live exact-inbox draft before attachment upload. Permission revocation denies the former editor, and draft deletion denies every draft-scoped actor including manager/admin attempts while the independent sent-message link stays valid.

### Scenario ST-S18: Compact Shared Triage Cards

Business logic covered:
- ST87
- ST149
- ST151
- ST152
- ST153

Given:
- Shared Triage renders unread/read, selected/unselected, one-message, multi-message, draggable, and long-subject/snippet cards.

Expected:
- Shared Triage uses the same compact row component and measurements as My Triage: no more than 6 CSS pixels of horizontal outer padding and no more than a 20-pixel left indicator rail.
- The unread dot remains at the top left without creating a wide text gutter, while selection, thread, keyboard, and drag states remain distinct and operable.
- Top-line text reserves only actual timestamp/action width.
- Snippet/body preview continues beneath the timestamp to within 8 CSS pixels of the right edge and no fixed empty right column remains.

### Scenario ST-S19: Shared-Source Comments, Connected Node Chats, And Draft Access

Business logic covered:
- ST147
- ST148
- ST154
- ST155
- ST156
- ST157
- ST158
- ST159
- ST163
- ST164

Given:
- An authorized Shared Triage user selects text or uses a per-message comment action; the email may have zero, one, or several Node associations.
- One permanent participant can navigate the source shared inbox; another cannot.
- A participant is also a provider/shared-inbox viewer and therefore receives both canonical provider and virtual collaboration list inputs.
- A floating-Node ensure or first-comment request may fail before a retry succeeds.

Expected:
- The navigable source Shared Triage shows one provider-owned conversation row annotated with collaboration identity. The participant without mailbox navigation receives no My Triage or Shared Triage email row and opens the stored thread through the collaboration Node.
- Collaboration participation does not reveal the shared folder tree, unrelated messages, or another shared inbox.
- An associated row opens the right rail and shows all connected Node chats. An unassociated row opens it on selection or the per-message comment action. Closing it or changing exact message, mailbox, or view makes no durable mutation.
- With one association, the rail targets that Node. With several, it asks which Node owns the comment or offers a new floating Node, then renders that Node's canonical ChatPane rows and deduplicated participant roster rather than provider recipients or current group members.
- A failed ensure leaves no partial durable artifacts; a creation/write failure preserves the chat composer context, never inserts a false saved row before backend acknowledgement, re-enables retry, and translates `failed_to_create_email_collaboration` or `email_collaboration_storage_not_ready` into actionable text.
- Selection anchors target the exact shared message and immediately open the rail, but selection and an abandoned empty composer create no Node. The first nonempty unassociated comment creates a floating Node with `priority = null` and no Logic Gate.
- Create Shared Draft uses the exact Reply All source message and every permanent participant sees one revisioned draft with its source shared inbox labeled.
- The collaboration shared draft cannot be scheduled and sends only after the server claims its current revision; ordinary shared-inbox drafts retain their existing scheduling behavior.
- Private personal drafts and ordinary drafts from another shared inbox remain absent; guessed collaboration or draft IDs remain denied.

### Scenario ST-S20: Shared Signature Image And Start-Action Reliability

Business logic covered:
- ST121
- ST133
- ST137
- ST165

Given:
- Shared Inbox A has a saved signature containing a Mango image, while Shared Inbox B and the user's personal account have different signatures.
- An authorized editor opens settings and starts New compose, Reply, and Reply All while signature hydration overlaps typing or draft restoration.

Expected:
- Settings immediately show the image through A's authenticated `email_signature` attachment context, and Save durably persists the exact flushed sanitized HTML.
- Every A start action receives A's signature exactly once; B and personal scopes never leak into it.
- Late completion preserves typed/restored content, and autosave, rerender, or reply-mode changes cannot duplicate or replace the signature.

### Scenario ST-S21: Shared Navigation Ownership And Webhook Retry

Business logic covered:
- ST166
- ST167
- ST168

Given:
- Shared Inbox A queues provider mark-read and folder work, list filters change, and the user later selects Shared Inbox B.
- A signed Shared Inbox A webhook runs with no subscribers, no authorized local viewer, and a transient audience lookup failure before redelivery.

Expected:
- Captured mark-read for A is not canceled by navigation and cannot patch B's visible state.
- Filter changes preserve A's valid folder work; the exact-inbox change rejects it and loads B.
- Empty audiences are acknowledged as legitimate no-ops. Lookup failure is returned as retryable failure, deduplication is released, and redelivery may publish after authorization recovers without counting an identical open signal twice.
### Scenario ST-S22: Clean Shared Thread Disclosure, Likely-Opened Occurrences, And Undo Send

Business logic covered:
- ST87
- ST92
- ST169
- ST170

Given:
- An unread multi-message Shared Triage conversation contains different participants per message, a sent message has multiple stored open signals, and an ordinary or collaboration shared draft is submitted.

Expected:
- The unread dot/emphasis remains but no unread card has the blue/thick frame; selection and keyboard state remain independent.
- The overall header shows only the subject. Collapsed rows hide recipient details, while expanding one row reveals only that message's From/To/Cc/Bcc, body, files, and exact-message actions.
- **Likely opened** appears only from persisted provider open signals; the focused/hovered chip groups repeated signals, lists local occurrence times, uses provider identity only when reported, labels sole-recipient attribution as inferred, and otherwise remains anonymous.
- The non-green action row appears immediately. No shared-send HTTP request starts for ten seconds unless Send now is activated; Send now dispatches that exact attempt once, Undo prevents it and preserves the draft/revision, a due draft is unscheduled durably, and expiry sends once through the exact shared source and existing authoritative claim path when the attempt is still pending.

### Scenario ST-S23: Responsive Shared Mail Controls And List Ordering

Business logic covered:
- ST43
- ST111
- ST166
- ST171

Given:
- One exact shared inbox Primary page contains read and unread conversations with different timestamps, including older conversations outside the provider's first page.
- The authorized viewer searches, enables Unread only, toggles Oldest/Newest ordering, and narrows the pane.

Expected:
- Shared Triage renders the same compact left search group and right unread/filter/order group as My Triage, wrapping cleanly without obscuring controls or changing authorization scope.
- Newest is the initial visible/icon/accessible state; toggling changes all three to Oldest and back.
- Search and unread-only remain exact-shared-inbox provider filters. Oldest loads and deduplicates the complete filtered tab before choosing the oldest 12 conversation rows; Newest restores the true newest 12. Thread condensation, source inbox, and Archive page's 12-row limit remain intact.

### Scenario ST-S24: Shared Counter, Sent Image, Typing, And Header Stability

Business logic covered:
- ST172

Given:
- An authorized shared mailbox has provider folders split across pages and a sent draft containing a signature or pasted image.
- The user types beside the hydrated image, switches to Sent, and resizes the shared-mail pane.

Expected:
- The Shared Triage Inbox counter includes later folder pages when an exact total exists and otherwise shows a truthful loaded-count fallback; Starred has no counter. Compose uses the available detail height, and ordinary typing produces no image refetch or flash.
- Sent retains Compose/Sent/Archive-page geometry with archive disabled, and the inline image remains authorized through the shared-inbox/message link after draft cleanup.

### Scenario ST-S25: Shared Signature Send Integrity And Failure Recovery

Business logic covered:
- ST165
- ST170
- ST172
- ST173
- ST174

Given:
- An editable shared inbox has a saved signature image with distinct display and original objects.
- The user sends through timer expiry and Send now, then exercises an original open/stream failure.

Expected:
- Each choice dispatches once through the same exact shared grant; success sends the checksum-validated original as CID and Sent resolves it through the promoted shared-inbox/message link.
- Failure returns the same safe backend result, retains the shared draft/revision and compose, does not claim success, and can be correlated without logging filenames, bodies, bytes, credentials, or storage/provider details.

### Scenario ST-S26: Stable Shared Mail Page And Bounded Requests

Business logic covered:
- ST31
- ST33
- ST40
- ST62
- ST66
- ST68
- ST143
- ST175
- ST176
- ST177
- ST178
- ST179
- ST180
- ST181
- ST182
- ST183

Given:
- Shared Triage displays 12 messages and has already prefetched the next 12.
- An editor clicks Archive page and go next, then stars, opens/reads, deletes, and sends messages while Nylas delivers matching echoes to current viewers.
- The shared subscription reconnects, a notification summary updates, an external sender changes the inbox, and the editor later opens shared All or Sent with a short condensed first page and a next token.
- The editor opens a known thread and then presses the normal Archive button while another row is below it.

Expected:
- The prefetched page appears immediately; the click issues one archive submission and no list GET before the swap. The initiating browser consumes matching local echoes with no GET or visible refresh, while another authorized viewer still receives an external hint.
- Acceptance, reconnect, and notification-summary updates issue no mail GETs. The external hint may perform one coalesced folder read and an exact selected-detail read, but never a message-list read or replacement.
- A short non-primary list appends enough pages to create a scroll range or reaches provider exhaustion; once scrollable, further pages require near-bottom intent.
- The known thread shows one loading shell before the full timeline, with no competing child body request. Normal Archive opens the row below, while Archive page/go-next keeps its separate fixed-page path.

### Scenario ST-S27: Symmetric Shared Mailbox Actions

Business logic covered:
- ST184

Given:
- An authorized Shared Triage mailbox is open and the All/Spam menu is expanded.

Expected:
- Sent occupies the third equal top slot and My Drafts the second equal lower slot; Compose and Archive/next complete the symmetric lower row in every mailbox tab.
- The lower actions use light shared gradients until selected, only one destination is fully saturated, and Archive/next remains visible but disabled outside Inbox. Both dropdown rows visibly highlight on pointer hover and keyboard focus.

### Scenario ST-S28: Edit A Shared Collaboration Comment

Business logic covered:
- ST186

Given:
- Shared Triage Chat is open for an authorized shared-inbox collaboration with comments from multiple participants.

When:
- The current user edits a comment they sent and another participant observes the mounted chat.

Expected:
- Edit is available only to the exact stored author, regardless of the other participant's Node Edit access.
- Saving preserves shared-inbox/email/message linkage and all attachment/reply/source metadata while updating text and resolved mentions.
- The edit remains inside existing shared-inbox and collaboration authorization, and the observing participant converges through the exact Node chat refresh.
- Failure retains the author's draft without displaying an uncommitted value as canonical.

Shared UI/realtime coverage lives in `tests/frontend/modules/editor/editorTextBlockChatNavigation.test.tsx` and `tests/frontend/modules/realtime/realtimeWebSocket.test.ts`; backend authorization is covered by `backend/internal/http/chat_comment_edit_test.go`.

### Scenario ST-S29: Archived Node-Linked Email Stays Out Of Shared Triage

Business logic covered:
- ST46
- ST58
- ST64
- ST175
- ST187
- ST188
- ST189
- ST190

Given:
- One navigable shared Inbox page contains an ordinary message and a message or thread attached to a Node.
- The collaboration record retains an older provider-independent snapshot whose folder metadata still says Inbox.
- The next exact-shared-inbox provider page has already been prefetched.

When:
- An authorized editor archives the Node-linked row normally or uses Archive page and go next, and the background archive job succeeds through the exact shared grant.
- The next page is displayed, collaboration rows are merged, selection changes, and the shared Inbox is later refreshed canonically.

Expected:
- The exact shared provider page alone decides Inbox membership. The stale collaboration snapshot cannot reinsert the archived message during the page swap, merge, selection, or refresh.
- No second click is required to remove the row, and Node attachment does not make an archived shared message persistent.
- A matching provider row still receives its Node/chat metadata when present, while a permanent participant without source-inbox navigation receives no email-list row and retains Node/chat access through the collaboration Node.
