Last updated: 2026-07-14

# Email Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (`tests/frontend/pages/home/homeCommands.test.ts` covers send payload construction, Mango attachment references, and mailbox-scoped signature save ordering; `tests/frontend/pages/home/homeMailboxRealtime.test.ts` covers exact active targets, first/reconnect acceptance, event mapping, coalescing, queued-final work, and navigation cancellation; `tests/frontend/pages/home/homeMailDrafts.test.ts` covers provider/auth error retention versus exact revocation purge, out-of-order loads, local save/delete fencing, multiple personal accounts, and live-draft preparation before attachment upload; `tests/frontend/modules/editor/richTextEditing.test.ts` and `unifiedRichEditorContract.test.ts` cover rich email behavior. Backend communications/realtime/attachment tests cover exact mailbox routing, provider send boundaries, S3 attachment resolution, live email-draft attachment authorization, deleted-draft denial, sent-message survival, and durable inline-byte rejection. Broader mounted compose/signature endpoint coverage remains partial.)
- Exact mailbox hardening is covered by `homeMailboxRealtime.test.ts`, `unifiedRichEditorContract.test.ts`, `communications_singleflight_cancellation_test.go`, `realtime_audience_hardening_test.go`, `nylas_webhook_receipts_test.go`, and focused communications/store tests for retry-safe open receipts and exact-account migration ordering.
- Outbound attachment tests in `backend/internal/http/communications_handlers_test.go` and `backend/internal/http/nylas_client_test.go` cover early validation, tenant/link authorization, the complete metadata limit preflight, lazy exact-length multipart streaming, inline CID fields, cancellation, provider rejection, and body cleanup.
- Thread viewer parity and Reply All focus are covered by `tests/frontend/modules/editor/emailViewerContract.test.ts`; recipient deduplication/mailbox exclusion by `tests/frontend/modules/communications/emailRecipients.test.ts`; semantic reply-draft identity by `tests/frontend/pages/home/homeMailDrafts.test.ts`; and calendar RSVP request construction by `tests/frontend/modules/communications/communicationsApi.test.ts`.

- Automatic signature insertion, rich-body deduplication, signature-only draft detection, mailbox scope keys, and personal/shared signature request scope are covered by `tests/frontend/pages/home/homeCommands.test.ts`, `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts`, and `tests/frontend/modules/communications/communicationsApi.test.ts`.

## Business Logic

### 2026-07-10 Node Attached-Email Retention Contract

- An email attached to a node is node-owned durable context. A text box may display or originate that association, but deleting the text box must not delete the attached-email projection, detach the provider message, or remove the email from the node-level count/list.
- The global node-header email counter/list opens a standalone node-level attached-email organizer modal with its folders/list and selected conversation. It must not depend on a live text box, auto-create a text box, or choose another text box as a replacement display target.
- The standalone global attached-email organizer must remain usable on a node with zero text boxes and by a user who can view but cannot edit the node. Existing per-text-box email panes remain unchanged for surviving boxes.
- File attachments that belong to the retained email continue to follow their provider/Mango ownership and authorization rules. Retaining the attached-email projection must never copy raw provider attachment bytes into the node projection.

Required regression scenario:
- Attach an email from a node text box, delete that box, reopen the node with no live text boxes, and open the email from the node-header counter/list.
- Confirm the count and projection remain, the standalone attached-email organizer renders its list/folders and retained thread, no replacement text box is created, and a view-only user can open it without receiving edit controls.

EMAIL1 - Mango email drafts are Mango application records, not Nylas provider drafts and not browser-only state.
EMAIL2 - Browser `localStorage` may be used only as a company/user-keyed fallback mirror for drafts and signatures. Every view filters it to the exact active personal account or shared inbox; after a successful database read, only rows explicitly marked pending sync may migrate, and stale/unmarked local rows cannot resurrect deleted or revoked drafts.
EMAIL3 - Personal draft and signature rows are scoped to the actor's personal `user_email_connections` tuple of `user_id` plus `account_email`.
EMAIL4 - Shared draft and signature rows are scoped to `shared_inbox_id`; `shared_inboxes` remains the Mango permission/resource wrapper and points to `company_email_connections` for provider grant plumbing.
EMAIL5 - A draft or signature row must be either personal or shared, never both and never neither.
EMAIL6 - Personal draft list/get/create/update/delete and draft-attachment access are owner-only in the exact personal account scope; company manager status does not bypass ownership. Shared draft list/get/attachment reads require view access to the exact inbox, while create/update/delete and attachment mutation require edit access.
EMAIL7 - Draft IDs remain client-stable text IDs so reply/forward resume behavior and existing `email_draft` attachment resource IDs do not break; new personal reply/forward IDs include the connected personal mailbox scope to avoid cross-account collisions.
EMAIL8 - Reply drafts are unique per company, mailbox scope, and source message ID; reopening Reply resumes the existing draft and preserves the original message context.
EMAIL9 - Forward drafts are unique per company, mailbox scope, and source message ID; reopening Forward resumes the existing draft.
EMAIL10 - Draft rows store addressing text, subject, sanitized editor body content, source message metadata, schedule timestamp, scope, creator/updater, and timestamps; attachments stay in `resource_attachments`.
EMAIL11 - Email signatures store sanitized editor body content and default metadata; signature attachments use `email_signature` resource attachments when images/logos are supported.
EMAIL12 - Normal file attachments for drafts use `email_draft` resource attachments and are sent by resolving Mango attachment IDs to S3 bytes at send time.
EMAIL13 - Durable email draft/signature/send payloads must not store raw base64 attachment content or data URLs. Draft and signature API writes must reject embedded inline file bytes before any durable write.
EMAIL14 - Sending a Mango-authored email must serialize the editor body into professional HTML that preserves line breaks, blank lines, spacing, bullets, numbered lists, tables, links, indentation, font size, bold, underline, italic, text highlight color, and supported left/center/right alignment. Font-family selection is intentionally ignored until multiple font families exist; this does not disable font-size formatting.
EMAIL15 - Legacy plain text drafts/signatures must still send safely as escaped/linkified HTML.
EMAIL16 - Scheduled sends are saved as durable drafts with a due timestamp, but V1 scheduled execution remains browser-driven while the app is open.
EMAIL17 - Successful sends delete the corresponding durable draft only after the provider send succeeds.
EMAIL18 - Nylas is the mailbox read/send provider boundary; Mango owns draft/signature persistence and attachment references.
EMAIL19 - SES remains for auth/invitation/system email and must not be confused with user mailbox draft/send behavior.
EMAIL20 - Provider reauthorization problems must be recoverable mailbox errors, not Mango logout/session failures.
EMAIL21 - A thread action targets the exact message card on which Reply, Reply All, or Forward was chosen; its provider message ID, recipients, original context, and stable draft identity must not be substituted with the latest thread message.
EMAIL22 - Conversation details are newest first with a deterministic message-ID tie-breaker. Authoritative provider thread `message_ids` define membership; any sent/received member absent from the bounded preview page is fetched by exact ID. New inbound or locally sent messages appear expanded at the top and collapse previously expanded cards while preserving the single grouped mailbox row.
EMAIL23 - A thread detail pane owns the only vertical scrollbar. A selected single-message reader uses all remaining detail-pane height as its flexible minimum, so a short body never leaves a shallow fixed-height reader box; every expanded message document grows to its complete rendered content, including content sized from the document root, without clipping or exposing a per-message body scrollbar. Collapsed cards remain header summaries until expanded.
EMAIL24 - Reply body editors have a nontrivial minimum/default height, support vertical resizing, and automatically persist a clamped per-user mailbox-scope height preference.
EMAIL25 - Selecting a mailbox row while compose/reply is open quietly saves eligible draft content, exits compose, and shows the selected message on the first click without reloading the list.
EMAIL26 - Shared font-size minus/value/plus, Bold, Underline, Italic, Highlight/**No highlight**, left/center/right alignment, and table controls preserve the editor range when toolbar focus changes. Font size and highlight apply to a selected range or pending collapsed-caret typing style; **No highlight** removes selected highlighting or clears the pending style; inline controls toggle both on and off; and serialized outbound HTML preserves supported formats. Hover/focus/active styling applies only to the individual control. Enter commits the numeric font-size value once; Escape cancels the draft value without a later blur commit.
EMAIL27 - Durable pasted-image bodies store Mango attachment references. At the backend send boundary, authorized references are deduplicated, resolved from S3, converted to inline attachments with unique alphanumeric content IDs, and rewritten to matching `cid:` image sources; normal files remain non-inline and broken/unauthorized inline references reject the send.

EMAIL28 - The default signature for the exact active personal mailbox or Shared Triage inbox is automatically inserted exactly once into every newly created compose, reply, and reply-all body. If database hydration completes after the editor opens, Mango backfills only that still-open new draft, preserves text already typed, never rewrites a reopened saved draft, and never duplicates a signature already present in rich or legacy body content.
EMAIL29 - When remote hydration returns multiple reply drafts for the same company, user, mailbox scope, and source message, Mango keeps the newest semantic draft and deletes the superseded remote draft rows. A stale duplicate must not reappear after the surviving draft is sent, deleted, or reopened.
EMAIL30 - Personal, shared, node-attached, and project-attached thread viewers expose the same expand-all, To/Cc/Bcc, Reply/Reply All, authenticated attachment, inline-image download/fullscreen, and original-message context behavior while preserving the originating mailbox scope.
EMAIL31 - Vertical reply resizing ends on pointer-up even outside the handle, pointer-cancel, lost pointer capture, or window blur. Pointer movement after any of those events must not continue changing editor height.
EMAIL32 - Calendar-invitation metadata (`text/calendar` or `.ics`) may identify a candidate invitation in the viewer, but the backend always derives `METHOD`, `VEVENT`, and UID from authenticated raw MIME. RSVP controls prevent duplicate submission while pending and display a saved/selected response only after provider success; malformed invitations, missing/ambiguous events, expired grants, and provider failures leave no false selected state and surface a recoverable error.
EMAIL33 - Reopening a saved Reply All draft restores its saved To, Cc, and Bcc fields while still applying the active-mailbox exclusion and case-insensitive recipient deduplication rules.
EMAIL34 - My Triage compose/reply, Shared Triage compose/reply, attached-email reply, and personal/shared signature editing must use the same `EditorDocumentSurface`, shared behavior/formatting controller, and complete `EditorTabBar` formatting inventory as the other unified editor surfaces. The signature editor must be a unified rich editor rather than a native textarea.
EMAIL35 - Save Draft, Send, and Save Signature must synchronously flush the mounted rich editor and persist or submit the exact sanitized HTML returned by that flush, including the user's final uncommitted DOM edit; cached React state must not substitute an older body.
EMAIL36 - Signature persistence is scoped to the exact personal account or shared inbox. An in-flight remote load must not overwrite a newer local edit, an existing remote row remains authoritative even when its body is empty, and save success is shown only after the remote write succeeds. A failed save retains the exact mailbox-scoped pending body, retries it before accepting older remote state, serializes retries/backfills with newer saves, and clears pending state only after that same body succeeds.
EMAIL37 - Selecting a mailbox row makes that message detail the foreground provider read. First body paint must not wait behind unread-state mutation, next-page prefetch, historical thread hydration, collapsed-card attachment reads, or background archive work.
EMAIL38 - Selecting a row from a different thread replaces prior conversation state immediately. Requests started for the old selection may finish, but must not repopulate the new detail pane or continue nonessential attachment hydration.
EMAIL39 - The selected message body hydrates first. Historical thread rows load preview metadata in bounded pages and fetch full bodies or attachment content only when the user expands that card; Expand all is an explicit request to hydrate every card.
EMAIL40 - Received body text and HTML render before inline CID downloads finish. Each CID source resolves independently, a slow or failed image never hides readable body content, and collapsed cards issue no attachment-content reads.
EMAIL41 - Normal detail reads use mailbox-scoped frontend/backend caches and same-key in-flight coalescing without `refresh=true`. Raw MIME is not part of an ordinary body-only detail critical path; calendar RSVP and concrete unresolved inline-content recovery remain authenticated raw-MIME uses.
EMAIL42 - Missing recipients and empty subject/body without a valid attachment reference are rejected before attachment authorization, repository expansion, S3, or Nylas send work. Attachment-only email remains valid. Every referenced Mango attachment then completes tenant-scoped original metadata and active-link authorization preflight; nonnegative sizes are summed without overflow and an aggregate above exactly 24,000,000 bytes is rejected before any object opens.
EMAIL43 - Provider-ready outbound attachments are metadata plus exact size and a lazy opener, separate from inbound `NylasAttachment.Content`. Once the Nylas gate admits the send, S3 bytes stream exactly once into a deterministic-Content-Length multipart request with preserved order, filenames, content types, CID/inline semantics, and exact bytes. Length mismatch, short/long/error readers, cancellation, and provider failure close every opened body; no outbound base64 round trip or complete multipart buffer is allowed.
EMAIL44 - Signed provider message/folder webhooks publish compact exact-mailbox hints after exact server-cache invalidation and webhook deduplication. Personal hints target `mailbox:personal:account:{user_id}:{normalized_account_email}`; shared hints target `mailbox:shared:{shared_inbox_id}` after current-audience filtering. First acceptance and reconnect acceptance each perform one coalesced canonical folder/list reconciliation, closing the initial-list-to-subscribe race. `message.created`, `message.updated` (including moves), and `message.deleted` reconcile the active list/folders; folder changes reconcile folder metadata; and directly identified selected message/thread changes reconcile detail. Unrelated new mail does not refetch selected detail; off-view mailboxes issue no provider GET; payloads never insert rows or carry bodies; and no polling loop is added.
EMAIL45 - Thread reconstruction supports external-initiated, Mango-user-initiated, alternating inbound/outbound replies, and forwards without guessing. Provider thread IDs or exact supported reply metadata may establish membership; subject similarity never does, cross-mailbox IDs cannot merge, duplicates collapse by message ID, and unresolved one-offs remain single conversations.
EMAIL46 - An unread card always has the unread dot and thicker frame. Pointer or keyboard open optimistically clears unread UI and decrements/recomputes the visible count before the scoped provider command completes; success survives selection/realtime refresh, while failure rolls back accurately and surfaces the established error. Pending-read timers, overlays, and responses are keyed by authenticated mailbox plus provider message ID and may mutate only the captured list/filter and selection generation, so identical provider IDs or stale completions cannot cross users, personal accounts, shared inboxes, searches, or selections. Selection uses the separate full-card Mango selection surface and accessible pressed state.
EMAIL47 - Draft scope columns are immutable across upsert conflicts, soft deletion, and known-ID reuse. List/get/delete store predicates include exact scope, shared account email is canonicalized from the inbox, and cross-user/account/inbox IDs cannot be read, taken over, reassigned, updated, or deleted.
EMAIL48 - An email-card thread icon appears on the left only when the sanitized canonical/loaded message count is greater than one; thread-ID presence alone is not proof of a multi-message conversation.
EMAIL49 - Locally persisted sent-reply fallback data is keyed by company, authenticated user, personal account/shared inbox, source message, and thread. When a provider send response omits thread ID, exact reply-target metadata supplies it before the enriched reply is persisted under the thread key; no local reply cache crosses users or mailboxes.
EMAIL52 - Home subscribes to at most one mail-bearing mailbox: the selected connected personal account in My Triage or exact selected shared inbox. Multiple personal accounts never share a user-wide realtime scope. Shared root/headings/grouping rows/plain folders, Drafts, and non-mail views install no fallback personal scope, and navigation cancels obsolete timers/work and unsubscribes the old mailbox. Replacing shared-inbox metadata or callback objects without changing the exact company/scope does not recreate the subscription or repeat acceptance reconciliation; only an actual target/mailability change does.
EMAIL53 - Mailbox hint invalidation and delayed reconciliation are keyed by exact company, personal account/shared inbox, message, thread, folder/page request, and current mailbox request generation. Bursts coalesce; one signal arriving during an active read may queue one final read; a timer or response owned by mailbox A cannot refresh, invalidate, or overwrite mailbox B. A detail hint also captures the selected message/thread that made it relevant and rechecks that owner before a delayed or queued read, so switching selection cannot wake an unrelated new detail. Acceptance/hint reconciliation performs an authoritative refresh only for the exact affected folder, page, message, or thread key; it bypasses reusable cache entries, joins or queues behind same-key in-flight work rather than overlapping it, and an exact-key invalidation generation prevents a provider read begun before the hint from repopulating stale cache state.
EMAIL54 - Local fallback draft data is purged only for explicit authorization revocation or a definitively deleted/non-mail-bearing scope (`access_denied`, `company_access_denied`, `company_not_found`, `shared_inbox_not_found`, or `shared_inbox_not_mailbox`). Mango session `401`, unclassified `403`, provider reauthorization/disconnection `409`, service `5xx`, and network failure retain unsynchronized drafts in their exact company/user/personal-account/shared-inbox scope.
EMAIL55 - Each remote draft load owns one exact scope generation and local revision. It may replace only that scope and only while still current; an older load cannot overwrite a newer completed load, local save, local delete, remote save completion, another personal account, or another shared inbox. Returned values and the fallback mirror both reflect the current scope state.
EMAIL56 - An `email_draft` attachment can be created, linked, listed, sent, or read only while the exact owning draft still exists and is not deleted. Personal access is exact owner/account; legacy accountless personal IDs are live-draft owner-only read compatibility and never mutation authority; shared access uses the exact live inbox and current permissions. Compose creates the durable draft before attachment upload/link. Deleting a draft makes all draft-only attachment paths unreadable even to manager/admin bypass attempts, while an independently linked `email_message`/sent attachment remains readable through its own live authorization.
EMAIL57 - Every email conversion and local mail mutation retains one exact source mailbox request key. Personal My Triage drag payloads and `POST /v1/communications/triage/convert` carry normalized `account_email`; Shared Triage carries `shared_inbox_id` and suppresses any personal account parameter. Explorer, Kanban, project, and pin handoffs preserve that identity through the committed-result event, so one personal account cannot convert, unstar, archive, update, move, or delete through another account's grant.
EMAIL58 - Once opening an unread message has queued its exact-scope provider mark-read command, changing mailbox tabs, search, unread-only state, Home view, or active mailbox may detach that command from visible UI state but must not silently cancel the captured provider mutation. The completion may update only its captured company/user/account-or-shared-inbox, list filter, and selection generation. If a terminal user/session transition suppresses the command, its ownership token and optimistic overlay must be released rather than left as false read state.
EMAIL59 - Folder metadata belongs to the exact company plus personal-account/shared-inbox scope, not to message-list presentation filters. Changing Primary/Starred/Sent, search, or unread-only state neither invalidates an in-flight folder response nor requires a replacement folder request. Changing the exact mailbox scope invalidates old folder ownership, and acceptance/webhook refresh still permits one active load plus one queued final load for the destination scope.
EMAIL60 - A canceled caller waiting on a same-key backend folder/page/detail provider read returns promptly without canceling the shared leader needed by other callers. The canceled caller releases its generation admission while the shared leader retains admission until the provider operation finishes, and only the still-current exact generation may populate cache state.
EMAIL61 - The exact-account read-receipt cutover handles legacy personal summaries explicitly. A legacy `receipt_scope_id = user_id` row is merged into `user_id:normalized_account_email` only when that user has exactly one stored personal email connection; existing exact rows retain the strongest status, complete signal history, and timestamp bounds. Zero-account or multi-account legacy rows are deleted as an intentional ambiguous-history reset rather than retained as unreachable shadow data. The repair is a new idempotent forward migration that sorts before the separately committed legacy drop on fresh installs and still runs when that drop is already ledgered.
EMAIL62 - A signed shared-mailbox webhook is acknowledged only after exact cache invalidation and either successful current-audience publication or a legitimate no-subscriber/no-authorized-recipient result. Resource-existence or audience lookup failure is retryable: webhook deduplication is released and the handler returns failure so the provider may redeliver. A retried `message.opened` payload retains its first receipt timestamp, and an identical signal timestamp cannot increment the stored receipt twice. Publication-time authorization is deadline-bound, limited to locally subscribed users, and remains fail-closed.
EMAIL63 - Draft attachment preparation and the subsequent upload/link form one per-draft mutation lease. Empty-draft cleanup may run after concurrent work only when the last lease ends and every mutation in that group failed; one failed inline image must never delete a durable draft another upload/link still uses, and a successful mutation prevents later failure cleanup from deleting its resource.

## Scenarios

### Scenario EMAIL-S1: Personal Draft Durability

Business logic covered:
- EMAIL1
- EMAIL2
- EMAIL3
- EMAIL5
- EMAIL6
- EMAIL7
- EMAIL10
- EMAIL25
- EMAIL35

Given:
- A signed-in user opens My Triage compose or reply with a connected personal mailbox.
- The user enters recipients, subject, body, or attachments and saves/closes the compose window.

Expected:
- Mango writes or updates a `communications_email_drafts` row scoped to the user's personal email connection.
- The browser may keep a local mirror, but reload uses the database row when available.
- Reopening Drafts shows the same draft on another browser session after backend sync.
- A different non-manager user cannot see or edit the personal draft.
- Clicking an email in the left list while compose is open quietly saves eligible draft content, closes compose, and renders the clicked email immediately.
- Saving or sending flushes the mounted editor first and persists or submits the exact returned sanitized HTML.

### Scenario EMAIL-S2: Shared Draft Durability

Business logic covered:
- EMAIL1
- EMAIL4
- EMAIL5
- EMAIL6
- EMAIL10
- EMAIL12
- EMAIL35

Given:
- A user with edit access composes from a Shared Triage inbox with an assigned shared mailbox.

Expected:
- Mango saves the draft against `shared_inbox_id`.
- Users with Shared Triage view access can see the draft; users with edit access can mutate it.
- Attachments link to the draft through `resource_attachments` and remain permission-gated by the shared inbox.
- Saving or sending flushes the mounted editor first and persists or submits the exact returned sanitized HTML.

### Scenario EMAIL-S3: Reply And Forward Resume

Business logic covered:
- EMAIL7
- EMAIL8
- EMAIL9
- EMAIL17
- EMAIL21
- EMAIL29

Given:
- A user replies to or forwards a provider message, closes compose, and later clicks Reply or Forward on the same source message in the same mailbox scope.

Expected:
- Mango resumes the existing stable draft ID instead of creating a duplicate.
- Reply context is restored so the original message being answered is visible.
- Choosing the action on an older thread card uses that exact message ID and context rather than the newest card.
- If legacy or remote state contains duplicate semantic reply drafts, Mango retains the newest draft, removes the superseded remote rows, and does not expose an older draft after the current one is sent or deleted.
- After a successful send, Mango deletes the saved draft.

### Scenario EMAIL-S4: Signature Persistence

Business logic covered:
- EMAIL2
- EMAIL3
- EMAIL4
- EMAIL5
- EMAIL6
- EMAIL11
- EMAIL13
- EMAIL28
- EMAIL34
- EMAIL35
- EMAIL36

Given:
- A user saves an email signature for their personal mailbox or for a shared inbox they can edit.
- The user may format the signature or save while signature hydration, a legacy backfill, or a prior failed save is still resolving.

Expected:
- Mango saves the signature in `communications_email_signatures` for exactly one scope.
- Loading compose uses the database signature when available and localStorage only as fallback/migration.
- New compose, reply, and reply-all editors receive the exact mailbox-scoped default signature automatically, including a safe one-time backfill when remote loading finishes after the editor opens.
- Reopened saved drafts are left unchanged, and automatic or manual insertion cannot add a duplicate signature.
- The signature is edited through the shared unified rich editor and shared font-size, Bold, Underline, Italic, Highlight/**No highlight**, alignment, table, and outline controls, not a native textarea.
- Save Signature flushes the editor and writes exactly that returned HTML for the active personal-account or shared-inbox scope.
- A stale load cannot overwrite a newer local edit; an empty remote row is authoritative; failed saves remain mailbox-scoped pending sync and cannot overtake newer saves.
- The durable signature endpoint rejects embedded inline file bytes before persistence.
- Future logo/image attachments for signatures use `email_signature` resource attachments.

### Scenario EMAIL-S5: Professional Email Rendering

Business logic covered:
- EMAIL14
- EMAIL15
- EMAIL26
- EMAIL34
- EMAIL35

Given:
- A draft or signature body contains rich editor content with paragraphs, blank lines, indentation, bullets, numbered lists, links, and highlighted text.

Expected:
- Sending uses the shared email HTML serializer, not raw draft text.
- The resulting HTML preserves spacing, line breaks, list/table structure, links, indentation, selected font sizes, bold, underline, italic, sanitized text highlight colors, and supported text alignment.
- Toolbar controls retain the selected range even if a picker receives focus; Bold/Underline/Italic toggle off as well as on, and font/highlight choices become pending typing styles at a collapsed caret.
- Font-family choice is not part of this contract until Mango supports more than one font family.

### Scenario EMAIL-S6: Attachments And Provider Boundary

Business logic covered:
- EMAIL12
- EMAIL13
- EMAIL18
- EMAIL19
- EMAIL20
- EMAIL27
- EMAIL42
- EMAIL43

Given:
- A draft has normal file attachments or pasted inline screenshots and is sent through personal or shared mailbox scope.

Expected:
- The browser stores attachment IDs/references, not file bytes, in durable draft/send state.
- Draft and signature durable-write endpoints reject embedded data URLs or raw inline file bytes before storage.
- The backend reads S3 bytes from Mango attachments only at provider send time.
- Each pasted screenshot is sent once as an authorized inline/CID attachment, the outbound HTML references the matching `cid:`, and the local send response contains provider-ready HTML plus metadata rather than raw bytes.
- Missing or unauthorized pasted-image references reject the send instead of delivering a broken placeholder.
- Nylas handles user mailbox send/read operations; SES remains only for Mango system email.
- Provider reauth errors surface as mailbox repair states while the Mango session remains valid.
- Recipient/content validation and the complete 24,000,000-byte metadata/authorization preflight finish before the first S3 read or provider call; zero-byte and exact-boundary attachment sets remain valid.
- A late oversized item, negative/overflowing metadata, or unauthorized reference causes zero S3 object opens for the complete set.
- Accepted objects open lazily after the provider gate, validate returned Content-Length, stream exactly the declared bytes into known-length multipart framing, and close on every exit path.
- The local sent response stays metadata-only, while inbound MIME and calendar attachment recovery continue to use provider content unchanged.

### Scenario EMAIL-S7: Thread Ordering, Collapse, And One Scroll Surface

Business logic covered:
- EMAIL21
- EMAIL22
- EMAIL23
- EMAIL24
- EMAIL31

Given:
- A hydrated email thread contains several messages and the user sends or receives another message.

Expected:
- Cards render newest first, with the newest message expanded and older messages collapsed to headers.
- The new message appears at the top immediately and becomes the sole automatically expanded card.
- Users can expand older cards and see their complete bodies without an internal message scrollbar; the thread pane remains the only vertical scroll surface.
- A short selected message fills the remaining right-hand detail area, while a long HTML message expands to its complete document height and remains fully reachable through that one detail-pane scrollbar.
- A resized reply body restores its saved mailbox-scope height and cannot be squeezed below the minimum.
- Pointer-up inside or outside the resize handle, pointer-cancel, lost capture, and window blur all end resizing; later pointer movement does not change the height.

### Scenario EMAIL-S8: Expand-All, Recipient Metadata, And Image Inspection

Business logic covered:
- EMAIL21
- EMAIL23
- EMAIL30
- EMAIL33

Given:
- A personal, shared, node-attached, or project-attached thread includes several messages, Cc/Bcc metadata, provider attachments, and inline CID screenshots.

Expected:
- `Expand all threads` expands every message/thread group without changing message order.
- To, Cc, and provider-supplied Bcc recipients remain visible for each message.
- Reply all includes every visible reply-to/from, To, and Cc address exactly once and excludes the active mailbox where its identity is known.
- Reopening a saved Reply All draft restores its To/Cc/Bcc addressing without reintroducing the active mailbox or duplicate recipients.
- Selecting an inline screenshot exposes a download action; double-click opens the original image in a full-screen overlay.
- Image and file attachments remain downloadable through authenticated provider/Mango attachment reads.

### Scenario EMAIL-S9: Calendar Invitation RSVP

Business logic covered:
- EMAIL18
- EMAIL20
- EMAIL30
- EMAIL32

Given:
- A connected Google or Microsoft mailbox receives one valid `METHOD:REQUEST` iCalendar message containing exactly one `VEVENT` and UID.

Expected:
- The expanded message displays Accept, Tentative, and Decline.
- Provider attachment metadata may mark the message as a candidate invitation, but Mango resolves `METHOD`, `VEVENT`, and UID from authenticated raw MIME rather than client-supplied provider identifiers.
- Mango finds exactly one non-cancelled provider event and sends `yes`, `maybe`, or `no` through Nylas.
- Missing, cancelled, malformed, unmatched, or ambiguous invitations fail visibly without sending an RSVP.
- Shared Triage RSVP requires edit access to the shared inbox.
- Response controls are disabled while the request is pending, and a selected/saved state appears only after provider success.
- Insufficient calendar scope, expired/revoked grants, and provider failures surface a recoverable reconnect/provider error, leave the user signed in to Mango, and never report or display a saved response.

### Scenario EMAIL-S10: Foreground Detail And Lazy Thread Hydration

Business logic covered:
- EMAIL37
- EMAIL38
- EMAIL39
- EMAIL40
- EMAIL41

Given:
- A personal or shared mailbox page is prefetching, the selected row is unread, and its thread contains several older messages with inline images.

Expected:
- The selected detail request starts before delayed mark-read and speculative prefetch work.
- The selected body becomes readable without waiting for raw MIME, historical message details, or CID downloads.
- Thread preview metadata is bounded, collapsed messages fetch no body or attachment bytes, and expanding one older card hydrates only that card.
- Rapidly selecting another thread removes the prior cards immediately and stale completions do not reinsert them.

### Scenario EMAIL-S11: Live Conversation, Read State, Thread Indicator, And Draft IDOR

Business logic covered:
- EMAIL2
- EMAIL3
- EMAIL4
- EMAIL5
- EMAIL6
- EMAIL21
- EMAIL22
- EMAIL44
- EMAIL45
- EMAIL46
- EMAIL47
- EMAIL48
- EMAIL49
- EMAIL52
- EMAIL53

Given:
- An external sender sends the first message, the Mango user replies, and the external sender replies again after the initial HTTP list but before first subscription acceptance, while the personal or exact shared inbox is open, or while another view is active.
- The bounded preview page omits the Mango sent reply, or the initial send response omits thread ID while its exact reply target has one.
- Another user/account/shared inbox knows a durable draft ID and attempts list, get, update, delete, or attachment access.
- A hint burst overlaps one active refresh, the user navigates between personal accounts/shared inboxes before a delayed timer fires, and an unrelated new message arrives while another detail is selected.

Expected:
- A signed, deduplicated exact-mailbox hint is authorized for only the selected connected personal account or exact shared inbox. First acceptance discovers mail committed after the initial list, reconnect acceptance performs one recovery, and the matching active list/folders refresh canonically without polling.
- Bursts use one active refresh plus at most one queued final refresh. Navigating cancels/discards the old request key; personal Account A, personal Account B, and Shared Inbox A never invalidate or issue provider GETs for one another.
- Shared root/headings/grouping/plain-folder and other off-view states retain no fallback mailbox subscription and perform no hint-triggered GET.
- `message.created`, `message.updated` (including moves), `message.deleted`, and folder changes reconcile only relevant canonical state; directly named selected message/thread changes refresh detail, while an unrelated new message does not.
- Conversation detail contains all provider-listed sent and received members, including the intervening Mango reply, without duplicate IDs, subject-based merging, cross-scope history, or loss of valid one-offs/forwards.
- The unread dot/frame and visible count clear immediately on pointer/Enter/Space open and stay cleared after success; a failed provider write rolls back and reports the error. The selected full-card surface remains distinct.
- The row shows a thread icon only for the proven multi-message conversation.
- Every draft operation and attachment authorization uses one immutable exact scope. Personal owner and shared view/edit distinctions hold; cross-scope known IDs cannot expose content or mutate scope, spoofed shared account data is ignored, and stale browser mirrors cannot reappear as another scope's drafts.

### Scenario EMAIL-S13: Draft Recovery And Scope-Safe Concurrency

Business logic covered:
- EMAIL2
- EMAIL3
- EMAIL4
- EMAIL47
- EMAIL54
- EMAIL55

Given:
- An exact-scope draft list fails with Mango `401`, an unclassified `403`, provider reauthorization/disconnection `409`, `5xx`, or a network error.
- Separate requests prove explicit access revocation, company deletion, shared-inbox deletion, or a shared row that is no longer mail-bearing.
- Two account/inbox loads complete out of order while a same-scope local save or delete occurs.

Expected:
- Recoverable auth/provider/service/network failures retain every unsynchronized draft in the exact affected scope and do not leak it into another scope.
- Only explicit revocation or definitive scope deletion purges that one scope; unrelated personal accounts and shared inboxes remain intact.
- A stale load returns the current exact-scope value and cannot overwrite a newer load, save, delete, or different account/inbox in browser storage.

### Scenario EMAIL-S14: Live Draft Attachment Authorization

Business logic covered:
- EMAIL6
- EMAIL12
- EMAIL17
- EMAIL56

Given:
- A user starts an otherwise empty personal or shared compose and selects an attachment.
- The draft is later deleted; the attachment may also have an independent sent-message link.
- A wrong user/account, revoked shared viewer, company manager, or company administrator attempts draft-scoped access.

Expected:
- Mango creates the exact durable draft before uploading or linking the attachment, and concurrent preparation creates that row once.
- Active personal draft access requires the exact owner/account; active shared access requires the exact inbox and current permission; legacy accountless personal IDs are read-only compatibility for a still-live owner draft.
- Once the draft is deleted, list/content/send/mutation through its draft link returns not found for every actor, including administrative bypass attempts.
- A legitimate independently linked sent-message attachment remains readable under its own authorization after draft deletion.

### Scenario EMAIL-S15: Exact Mailbox Ownership, Retry, And Concurrent Mutation Settlement

Business logic covered:
- EMAIL58
- EMAIL59
- EMAIL60
- EMAIL61
- EMAIL62
- EMAIL63

Given:
- Provider mark-read is queued for an unread message, then the user changes tab/search/unread state, leaves Home, or selects another exact mailbox before the delay expires.
- A folder request and realtime folder reconciliation overlap a list-filter change; a separate run changes the exact account/shared inbox.
- Two callers join one slow same-generation provider folder/page/detail request and one joined caller is canceled.
- Legacy personal receipt summaries contain one singleton-account user, one multi-account user, one user with no connection, and an already-populated exact target row.
- A signed shared-mailbox webhook encounters no local subscribers, no authorized local subscriber, and then a transient audience repository failure.
- Two attachment mutations share one newly prepared empty draft; one fails while the other remains active, with both all-failed and one-success orderings.

Expected:
- Ordinary navigation never silently drops captured provider mark-read intent. Its stale completion cannot overwrite the destination UI, and terminal suppression releases both mutation ownership and optimistic overlay.
- Filter changes accept exact-scope folder work without duplication while rejecting old list/detail work; an exact scope change rejects the old folder result and loads the destination.
- The canceled joined caller returns promptly, the one provider leader continues for remaining callers, and only a current generation may populate cache.
- Singleton history merges into the normalized exact account with strongest status and complete timestamp/signal bounds. Ambiguous or orphan broad rows are deleted, and rerunning the migration is safe.
- Legitimate zero-recipient publication is acknowledged. Audience timeout/error releases webhook deduplication and returns failure so the same delivery can retry without double-counting an already-stored `message.opened` signal.
- Empty-draft cleanup runs once only after the last all-failed lease. Any successful upload/link prevents a sibling failure from deleting that durable draft.
