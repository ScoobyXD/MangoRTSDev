# Process Story: Email survives a deleted Node or textbox relationship

The V3 cutover finds a legacy email, draft, or attached-email attachment whose old host Node or textbox no longer exists
↓
Mango removes the dead resource relationship and its permission effect, but keeps the normalized thread and messages with their permanent IDs
↓
The draft content remains a mailbox draft when its old relationship is gone, and an attached-email attachment without a surviving relationship points to the exact normalized `email_message`
↓
No migration step creates a fake Node/textbox or silently deletes email content to satisfy a relationship check

Last updated: 2026-08-02

# Process Story: Normalized Email Storage and Resource Relationships

A user imports an email from a personal mailbox or Shared Triage, and Mango stores the mailbox-scoped thread once in `email_threads` and each message once in `email_messages`.
↓
Creating or attaching work adds an `email_relationships` row for a Node, Project, Logic Gate, or one of their textboxes; it does not create a special collaboration, participant, placement, or Node-thread record.
↓
The related resource's normal permissions authorize stored-message, chat, draft, and attachment access. Provider reads still require the exact source mailbox.
↓
Resource-shared replies live in `email_drafts`, comments live in the normal owner-specific chat table, and attachments keep their bytes in the Mango attachment system.
↓
Deleting or revoking ordinary resource access immediately removes related-email access without changing the normalized email copy or inventing a second permission system.

Last updated: 2026-08-02

# Email Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Exact mailbox hardening is covered by `homeMailboxRealtime.test.ts`, `unifiedRichEditorContract.test.ts`, `communications_singleflight_cancellation_test.go`, `realtime_audience_hardening_test.go`, `nylas_webhook_receipts_test.go`, and focused communications/store tests for retry-safe open receipts and exact-account migration ordering.
- Business Logic Covered By Automated Tests: Partial (`tests/frontend/pages/home/homeCommands.test.ts` covers send payload construction, Mango attachment references, and mailbox-scoped signature save ordering; `tests/frontend/pages/home/homeMailboxRealtime.test.ts` covers exact active targets, first/reconnect acceptance, event mapping, coalescing, queued-final work, and navigation cancellation; `tests/frontend/pages/home/homeMailDrafts.test.ts` covers provider/auth error retention versus exact revocation purge, out-of-order loads, local save/delete fencing, multiple personal accounts, and live-draft preparation before attachment upload; `tests/frontend/modules/editor/richTextEditing.test.ts` and `unifiedRichEditorContract.test.ts` cover rich email behavior. Backend communications/realtime/attachment tests cover exact mailbox routing, provider send boundaries, S3 attachment resolution, live email-draft attachment authorization, deleted-draft denial, sent-message survival, and durable inline-byte rejection. Broader mounted compose/signature endpoint coverage remains partial.)
- Outbound attachment tests in `backend/internal/http/communications_handlers_test.go` and `backend/internal/http/nylas_client_test.go` cover early validation, tenant/link authorization, the complete metadata limit preflight, lazy exact-length multipart streaming, inline CID fields, cancellation, provider rejection, and body cleanup.
- Mailbox query-mode tests in `backend/internal/http/communications_handlers_test.go`, `backend/internal/http/nylas_client_test.go`, and `tests/frontend/modules/communications/communicationsApi.test.ts` cover exact Google Primary bucketing, native/structured parameter exclusivity, thread precedence, preview-only response normalization, and Primary cache-overlay exclusions.
- Canonical thread reconciliation, authored-only quote extraction, timeline affordances, and Reply All focus are covered by `tests/frontend/modules/communications/emailThreadMessages.test.ts`, `tests/frontend/modules/communications/emailQuotedContent.test.ts`, `tests/frontend/modules/editor/emailViewerContract.test.ts`, and `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts`; recipient deduplication/mailbox exclusion by `tests/frontend/modules/communications/emailRecipients.test.ts`; explicit reply/forward draft identity by `tests/frontend/pages/home/homeMailDrafts.test.ts`; faithful sanitized forwarding and attachment copying by `tests/frontend/pages/home/emailForwarding.test.ts` and `tests/frontend/pages/home/homeCommands.test.ts`; calendar event-detail/RSVP request construction by `tests/frontend/modules/communications/communicationsApi.test.ts` plus backend calendar/Nylas handler tests; and honest grouped receipt presentation by `tests/frontend/pages/home/emailReadReceipts.test.ts`.

- Automatic signature insertion, rich-body deduplication, signature-only draft detection, mailbox scope keys, and personal/shared signature request scope are covered by `tests/frontend/pages/home/homeCommands.test.ts`, `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts`, and `tests/frontend/modules/communications/communicationsApi.test.ts`.

## Business Logic

### 2026-07-10 Node Attached-Email Retention Contract

- An email attached to a node is node-owned durable context. A text box may display or originate that association, but deleting the text box must not delete the attached-email projection, detach the provider message, or remove the email from the node-level count/list.
- The global node-header email counter/list opens a standalone node-level attached-email organizer modal with its folders/list and selected conversation. It must not depend on a live text box, auto-create a text box, or choose another text box as a replacement display target.
- The standalone global attached-email organizer must remain usable on a node with zero text boxes and by a user who can view but cannot edit the node. Existing per-text-box email panes remain unchanged for surviving boxes.
- File attachments that belong to the retained email continue to follow their provider/Mango ownership and authorization rules. Retaining the attached-email projection must never copy raw provider attachment bytes into the node projection.

Required regression scenario:
- Attach an email from a node text box, delete that box, reopen the node with no live text boxes, and open the email from the node-header counter/list.
- Confirm the count and projection remain, the standalone attached-email organizer renders its list/folders and retained thread, no replacement text box is created, and an edit-authorized user can open it while a no-access user receives no projection.

EMAIL1 - Mango email drafts are Mango application records in `email_drafts`, not Nylas provider drafts and not browser-only state. Personal, shared-inbox, and resource-related Drafts views render only rows authorized for the exact mailbox or related resource; they never list the Gmail/Nylas Draft mailbox.
EMAIL2 - Browser `localStorage` may be used only as a company/user-keyed fallback mirror for drafts and signatures. Every view filters it to the exact active personal account or shared inbox; after a successful database read, only rows explicitly marked pending sync may migrate, and stale/unmarked local rows cannot resurrect deleted or revoked drafts.
EMAIL3 - Personal draft and signature rows are scoped to the actor's personal `user_email_connections` tuple of `user_id` plus `account_email`.
EMAIL4 - Shared draft and signature rows are scoped to `shared_inbox_id`; `shared_inboxes` remains the Mango permission/resource wrapper and points to `company_email_connections` for provider grant plumbing.
EMAIL5 - A draft or signature row must be either personal or shared, never both and never neither.
EMAIL6 - Ordinary personal draft list/get/create/update/delete and draft-attachment access are owner-only in the exact personal account scope; company manager status does not bypass ownership. Shared-inbox drafts require edit access to the exact inbox. A draft related through `email_relationship_id` uses the related Node, Project, or Logic Gate normal permission policy plus the revision rules in EMAIL65 through EMAIL69; there is no participant exception.
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
EMAIL22 - A conversation first normalizes provider, collaboration, and local/provisional representations within the exact mailbox scope. The same scoped message ID merges to its richest record. A local/provisional record may reconcile into exactly one provider/collaboration message only when thread, normalized subject, authored body, sender, recipients, non-inline attachment identity, and a narrow send-time window agree. Distinct provider IDs never collapse merely because their visible content is identical. Authoritative provider thread `message_ids` define membership; any member absent from the bounded preview page is fetched by exact ID. The resulting canonical messages render oldest to newest with a deterministic message-ID tie-breaker, the newest message expanded and brought into view, and one visible timeline item and attachment group per canonical message.
EMAIL23 - A thread detail pane owns the only vertical scrollbar and its overall header shows only the conversation subject. Messages form one ordered timeline of clearly bounded Mango neumorphic surfaces; every item retains sender, time, direction, useful metadata, attachments, and exact-message actions. Per-message Reply, Reply all, Create shared draft, and Forward remain available in a compact contextual menu, while the newest expanded message exposes the primary reply actions directly. A selected single-message reader uses all remaining detail-pane height as its flexible minimum, so a short body never leaves a shallow fixed-height reader box; every expanded message document grows to its complete rendered content, including content sized from the document root, without clipping or exposing a per-message body scrollbar. A collapsed message is a keyboard-operable sender/date/snippet summary with no From/To/Cc/Bcc dump; expanding that exact message reveals its labeled From, To, Cc, and Bcc metadata and only that message's newly authored body by default. Common HTML quote containers, cited reply blockquotes, Outlook-style reply headers, original-message separators, and conservative plain-text quote runs collapse only in the display projection; signatures and ordinary authored quotations remain. The unchanged provider body remains the reply/forward source and is available per message through an accessible Show quoted history control.
EMAIL24 - Reply body editors have a nontrivial minimum/default height, support vertical resizing, and automatically persist a clamped per-user mailbox-scope height preference.
EMAIL25 - Selecting a mailbox row while compose/reply is open quietly saves eligible draft content, exits compose, and shows the selected message on the first click without reloading the list.
EMAIL26 - Shared font-size minus/value/plus, Bold, Underline, Italic, Highlight/**No highlight**, left/center/right alignment, and table controls preserve the editor range when toolbar focus changes. Font size and highlight apply to a selected range or pending collapsed-caret typing style; **No highlight** removes selected highlighting or clears the pending style; inline controls toggle both on and off; and serialized outbound HTML preserves supported formats. Hover/focus/active styling applies only to the individual control. Enter commits the numeric font-size value once; Escape cancels the draft value without a later blur commit.
EMAIL27 - Durable pasted-image bodies store Mango attachment references. At the backend send boundary, authorized references are deduplicated, resolved from S3, converted to inline attachments with unique alphanumeric content IDs, and rewritten to matching `cid:` image sources; normal files remain non-inline and broken/unauthorized inline references reject the send.

EMAIL28 - The default signature for the exact active personal mailbox or Shared Triage inbox is automatically inserted exactly once into every newly created compose, reply, and reply-all body. If database hydration completes after the editor opens, Mango backfills only that still-open new draft, preserves text already typed, never rewrites a reopened saved draft, and never duplicates a signature already present in rich or legacy body content.
EMAIL29 - When remote hydration returns multiple reply drafts for the same company, user, mailbox scope, and source message, Mango keeps the newest semantic draft and deletes the superseded remote draft rows. A stale duplicate must not reappear after the surviving draft is sent, deleted, or reopened.
EMAIL30 - Personal, shared, node-attached, and project-attached thread viewers expose the same subject-only conversation header, accessible per-message collapse/expand disclosure, expanded-only From/To/Cc/Bcc metadata, expand-all, Reply/Reply All, authenticated attachment, inline-image download/fullscreen, and original-message context behavior while preserving the originating mailbox scope.
EMAIL31 - Vertical reply resizing ends on pointer-up even outside the handle, pointer-cancel, lost pointer capture, or window blur. Pointer movement after any of those events must not continue changing editor height.
EMAIL32 - Calendar-invitation metadata (`text/calendar` or `.ics`) may identify a candidate invitation in the viewer, but the backend always derives `METHOD`, `VEVENT`, and UID from authenticated raw MIME. RSVP controls prevent duplicate submission while pending and display a saved/selected response only after provider success; malformed invitations, missing/ambiguous events, expired grants, and provider failures leave no false selected state and surface a recoverable error.
EMAIL33 - Reopening a saved Reply All draft restores its saved To, Cc, and Bcc fields while still applying the active-mailbox exclusion and case-insensitive recipient deduplication rules.
EMAIL34 - My Triage compose/reply, Shared Triage compose/reply, attached-email reply, and personal/shared signature editing must use the same `EditorDocumentSurface`, shared behavior/formatting controller, and complete `EditorTabBar` formatting inventory as the other unified editor surfaces. The signature editor must be a unified rich editor rather than a native textarea.
EMAIL35 - Save Draft, Send, and Save Signature must synchronously flush the mounted rich editor and persist or submit the exact sanitized HTML returned by that flush, including the user's final uncommitted DOM edit; cached React state must not substitute an older body.
EMAIL36 - Signature persistence is scoped to the exact personal account or shared inbox. An in-flight remote load must not overwrite a newer local edit, an existing remote row remains authoritative even when its body is empty, and save success is shown only after the remote write succeeds. A failed save retains the exact mailbox-scoped pending body, retries it before accepting older remote state, serializes retries/backfills with newer saves, and clears pending state only after that same body succeeds.
EMAIL37 - Selecting a mailbox row makes that message detail the foreground provider read. A known multi-message row shows a stable Loading conversation shell until its canonical timeline is ready instead of first painting one message and then replacing it with a thread. A single-message body must not wait behind unread-state mutation, next-page prefetch, collapsed-card attachment reads, or background archive work.
EMAIL38 - Selecting a row from a different thread replaces prior conversation state immediately. Requests started for the old selection may finish, but must not repopulate the new detail pane or continue nonessential attachment hydration.
EMAIL39 - The selected message body hydrates first. Historical thread rows load preview metadata in bounded pages and fetch full bodies or attachment content only when the user expands that card; Expand all is an explicit request to hydrate every card.
EMAIL40 - Received body text and HTML render before inline CID downloads finish. Each CID source resolves independently, a slow or failed image never hides readable body content, and collapsed cards issue no attachment-content reads.
EMAIL41 - Normal detail reads use mailbox-scoped frontend/backend caches and same-key in-flight coalescing without `refresh=true`. Raw MIME is not part of an ordinary body-only detail critical path; calendar RSVP and concrete unresolved inline-content recovery remain authenticated raw-MIME uses.
EMAIL42 - Missing recipients and empty subject/body without a valid attachment reference are rejected before attachment authorization, repository expansion, S3, or Nylas send work. Attachment-only email remains valid. Every referenced Mango attachment then completes tenant-scoped original metadata and active-link authorization preflight; nonnegative sizes are summed without overflow and an aggregate above exactly 24,000,000 bytes is rejected before any object opens.
EMAIL43 - Provider-ready outbound attachments are metadata plus exact size and a lazy opener, separate from inbound `NylasAttachment.Content`. Once the Nylas gate admits the send, S3 bytes stream exactly once into a deterministic-Content-Length multipart request with preserved order, filenames, content types, CID/inline semantics, and exact bytes. Length mismatch, short/long/error readers, cancellation, and provider failure close every opened body; no outbound base64 round trip or complete multipart buffer is allowed.
EMAIL44 - Signed provider message/folder webhooks publish compact exact-mailbox hints after exact server-cache invalidation and webhook deduplication. Personal hints target `mailbox:personal:account:{user_id}:{normalized_account_email}`; shared hints target `mailbox:shared:{shared_inbox_id}` after current-audience filtering. First acceptance and reconnect acceptance each perform one coalesced canonical folder/list reconciliation, closing the initial-list-to-subscribe race. `message.created`, `message.updated` (including moves), and `message.deleted` reconcile the active list/folders; folder changes reconcile folder metadata; and directly identified selected message/thread changes reconcile detail. Unrelated new mail does not refetch selected detail; off-view mailboxes issue no provider GET; payloads never insert rows or carry bodies; and no polling loop is added.
EMAIL45 - Thread reconstruction supports external-initiated, Mango-user-initiated, alternating inbound/outbound replies, and forwards without guessing. Provider thread IDs or exact supported reply metadata may establish membership; subject similarity never does, cross-mailbox IDs cannot merge, duplicates collapse by message ID, and unresolved one-offs remain single conversations.
EMAIL46 - An unread card always has the unread dot, unread text emphasis, and accessible unread state, but it must not receive the retired blue/thick outer card frame. Pointer or keyboard open optimistically clears unread UI and decrements/recomputes the visible count before the scoped provider command completes; success survives selection/realtime refresh, while failure rolls back accurately and surfaces the established error. Pending-read timers, overlays, and responses are keyed by authenticated mailbox plus provider message ID and may mutate only the captured list/filter and selection generation, so identical provider IDs or stale completions cannot cross users, personal accounts, shared inboxes, searches, or selections. Selection uses the separate full-card Mango selection surface and accessible pressed state.
EMAIL47 - Draft scope columns are immutable across upsert conflicts, soft deletion, and known-ID reuse. List/get/delete store predicates include exact scope, shared account email is canonicalized from the inbox, and cross-user/account/inbox IDs cannot be read, taken over, reassigned, updated, or deleted.
EMAIL48 - An email-card thread icon appears on the left only when the sanitized canonical/loaded message count is greater than one; thread-ID presence alone is not proof of a multi-message conversation.
EMAIL49 - Locally persisted sent-reply fallback data is keyed by company, authenticated user, personal account/shared inbox, source message, and thread. When a provider send response omits thread ID, exact reply-target metadata supplies it before the enriched reply is persisted under the thread key; no local reply cache crosses users or mailboxes.
EMAIL50 - Google Primary always means `in:inbox -category:social -category:promotions`. User search is grouped and unread-only is folded into that same native expression so advanced `OR` searches cannot widen the mailbox bucket. The backend response boundary plus backend/frontend cache reconciliation apply the same Primary exclusion, so fresh, refreshed, cached, and optimistic star/read paths cannot leak Social or Promotions into Primary. The messages remain eligible for All and, when starred, Starred.
EMAIL51 - Nylas message-list serialization has mutually exclusive query modes. A Gmail-native mailbox request sends only `search_query_native`, `limit`, and optional `page_token`; it omits `select`, `thread_id`, `q`, `in`, `unread`, `starred`, and every other structured filter. A thread-history request uses structured `thread_id` mode without `search_query_native`, while ordinary non-native lists retain the selected-field projection. Native response supersets are normalized back to Mango's preview-only list shape so body/detail hydration, mailbox membership, ordering, pagination, and account/shared-inbox scope do not change.
EMAIL52 - Merely listing, selecting, reading, replying to, highlighting, or abandoning an empty chat composer creates no Node or relationship. The first accepted destination/chat command authorizes the exact mailbox, validates provider identity, stores normalized thread/message rows, creates an ordinary Node when requested, creates one `email_relationships` row, and writes the chat only after required priority and resource authorization succeed. A failed transaction leaves no partial work; a retry reuses stable normalized IDs and uniqueness rules.
EMAIL53 - One normalized email identity is mailbox-scoped: company plus personal user/account or shared inbox plus provider thread/message identity. Concurrent imports converge on `email_threads` and `email_messages`; subject, body, participants, and visual similarity never merge mail.
EMAIL54 - An email-created Node is an ordinary Node. Its default, direct/group permissions, GVIC, Project relationships, and Logic Gate assignment follow the same creation and later-edit rules as any other Node. There is no system-managed collaboration policy or append-only participant grant.
EMAIL55 - Email placement is stored only in `email_relationships`, which identifies the selected internal message, related resource, and optional resource textbox. Imported HTML/text/envelopes remain in `email_messages`; attachments remain in Mango attachment storage. No `Attached email` Node projection, Node-thread link, creation flag, or protected source projection is written.
EMAIL56 - Email detail and Node detail read the same normalized message plus relationship. Node comments are `node_textbox_chats` rows keyed to a real Node textbox; neither surface writes `node_information`, `node_projection_table`, or a second collaboration-chat history.
EMAIL57 - A chat may be created with no selection, selected textbox text, or an email selection. Email selections resolve the exact provider message to one internal `email_message_id`; the stored quote and offsets remain immutable navigation evidence and cannot retarget to a newer message.
EMAIL58 - Chat replies preserve `parent_chat_id` within the same Node and textbox. A reply cannot cross textboxes or silently inherit a different email/text selection.
EMAIL59 - Committed direct-user and group mentions store mention IDs/entity links and drive ordinary notifications. Mentions do not grant resource permission, create participant rows, alter provider recipients, or subscribe anyone to mailbox delivery.
EMAIL60 - There is no email-collaboration participant roster. Access changes only through the normal Node, Project, Logic Gate, or mailbox permission APIs, and revocation takes effect on the next authorization check.
EMAIL61 - A user with normal access to the related resource may open the Mango-stored thread and its Mango-stored files without source-mailbox access. The backend authorizes the relationship resource first and never exposes provider grants or credentials.
EMAIL62 - A future provider message is absent from the stored thread until an authorized user explicitly imports it. Webhooks, polling, ordinary mailbox reads, subject similarity, and body similarity do not extend a resource relationship.
EMAIL63 - Mailbox-list membership always comes from the active personal or selected shared mailbox provider response. A matching `email_relationships` row may annotate a provider-owned row with resource identity, but stored snapshots, attachments, chats, and mentions never manufacture a mailbox row.
EMAIL64 - Related-email discovery, stored-message reads, chats, drafts, and attachments require normal access to the exact related resource. Source-provider reads additionally require the exact mailbox. Company-role handling follows the normal resource policy and never creates a separate participant identity.
EMAIL65 - `Create Shared Draft` on an exact source message creates or reuses one `email_drafts` row for the exact `email_relationship_id` and `source_email_message_id`. Recipient initialization still uses Reply All deduplication and active-mailbox exclusion.
EMAIL66 - A resource-related draft is a Mango record, never a provider Draft. Its relationship, source message, content, attachments, revision, and uncertain send-claim state are durable. Users see it only while normal access to the related resource remains; ordinary private mailbox drafts retain their exact source-deletion behavior.
EMAIL67 - Resource-related draft reads and writes require current Edit access to the related resource and carry a monotonically increasing revision. Update, send, and discard compare the expected revision; stale commands return the canonical revision and preserve unsent local content for review/retry.
EMAIL68 - Any user with current Edit access to the related resource may edit, send, or discard its shared draft. Send is immediate-only and atomically claims the exact revision for five minutes, freezes body/recipient/attachment mutation, and uses one stable grant-scoped provider idempotency key. Uncertain provider outcomes retain the claim and byte-equivalent draft; safe retry uses the same key/grant inside the one-hour provider window, while a changed grant or expired window performs no automatic resend. After the active lease, an authorized user may inspect provider truth and revision-check/discard locally. Discard removes only the draft and never deletes the relationship, resource, chat, or provider thread.
EMAIL69 - Shared-draft attachments and inline images use `resource_attachments` with `resource_type='email_draft'`. Durable chat/draft content contains no raw file bytes, data URLs, provider credentials, presigned URLs, or object-storage keys, and every read or mutation reauthorizes the related resource.
EMAIL70 - Home subscribes to at most one mail-bearing mailbox: the selected connected personal account in My Triage or exact selected shared inbox. Multiple personal accounts never share a user-wide realtime scope. Shared root/headings/grouping rows/plain folders, Drafts, and non-mail views install no fallback personal scope, and navigation cancels obsolete timers/work and unsubscribes the old mailbox. Replacing shared-inbox metadata or callback objects without changing the exact company/scope does not recreate the subscription or repeat acceptance reconciliation; only an actual target/mailability change does.
EMAIL71 - Mailbox hint invalidation and delayed reconciliation are keyed by exact company, personal account/shared inbox, message, thread, folder/page request, and current mailbox request generation. Bursts coalesce; one signal arriving during an active read may queue one final read; a timer or response owned by mailbox A cannot refresh, invalidate, or overwrite mailbox B. A detail hint also captures the selected message/thread that made it relevant and rechecks that owner before a delayed or queued read, so switching selection cannot wake an unrelated new detail. Acceptance/hint reconciliation performs an authoritative refresh only for the exact affected folder, page, message, or thread key; it bypasses reusable cache entries, joins or queues behind same-key in-flight work rather than overlapping it, and an exact-key invalidation generation prevents a provider read begun before the hint from repopulating stale cache state.
EMAIL72 - Local fallback draft data is purged only for explicit authorization revocation or a definitively deleted/non-mail-bearing scope (`access_denied`, `company_access_denied`, `company_not_found`, `shared_inbox_not_found`, or `shared_inbox_not_mailbox`). Mango session `401`, unclassified `403`, provider reauthorization/disconnection `409`, service `5xx`, and network failure retain unsynchronized drafts in their exact company/user/personal-account/shared-inbox scope.
EMAIL73 - Each remote draft load owns one exact scope generation and local revision. It may replace only that scope and only while still current; an older load cannot overwrite a newer completed load, local save, local delete, remote save completion, another personal account, or another shared inbox. Returned values and the fallback mirror both reflect the current scope state.
EMAIL74 - An `email_draft` attachment can be created, linked, listed, sent, or read only while the exact owning draft still exists and is not deleted. Personal access is exact owner/account; legacy accountless personal IDs are live-draft owner-only read compatibility and never mutation authority; shared access uses the exact live inbox and current permissions. Compose creates the durable draft before attachment upload/link. Deleting a draft makes all draft-only attachment paths unreadable even to manager/admin bypass attempts, while an independently linked `email_message`/sent attachment remains readable through its own live authorization.
EMAIL75 - Every email conversion and local mail mutation retains one exact source mailbox request key. Personal My Triage drag payloads and `POST /v1/communications/triage/convert` carry normalized `account_email`; Shared Triage carries `shared_inbox_id` and suppresses any personal account parameter. Explorer, Kanban, project, and pin handoffs preserve that identity through the committed-result event, so one personal account cannot convert, unstar, archive, update, move, or delete through another account's grant.
EMAIL76 - Related-email chat is progressive disclosure in My Triage and Shared Triage. Selecting an email leaves chat closed; the global Chat control or an exact-message chat icon opens the right rail only after an ordinary destination relationship and real textbox exist. Closing or switching views does not create, delete, or mutate a relationship, resource, chat, or draft.
EMAIL77 - An open related-email chat header derives visible people history from durable chat authors and mention IDs. Authorization comes only from normal resource permissions; provider recipients, live group membership, and display history do not grant access.
EMAIL78 - Normalized email storage, ordinary Node/relationship creation, and the first chat write have explicit retry-safe failure behavior. A failed transaction leaves no partial Node, relationship, priority, Logic Gate assignment, GVIC, permission, or chat. A later chat failure leaves committed ordinary resources reusable and the frontend retains the draft for retry.
EMAIL79 - An email viewed inside a Node uses the canonical provider/Mango message-detail attachment metadata from its retained message, thread, and mailbox identity. Only attachments whose normalized Content-ID is actually referenced by the rendered body are omitted from the separate attachment list; a normal file carrying an unreferenced Content-ID remains discoverable with filename, MIME type, size, authenticated download, and safe image preview. Conversion and direct attach persist references and provenance, never a second attachment model or provider bytes.
EMAIL80 - The exact saved personal-account or shared-inbox signature is applied once whenever a user starts New compose, Reply, or Reply All in My Triage, Shared Triage, or an attached-email Node viewer. Send waits for an outstanding exact-scope signature read and applies it to the flushed submitted body before provider submission. Late signature hydration appends to the live draft without replacing user edits; rerender, reply-mode changes, autosave, and draft restoration do not duplicate it. Signature images remain Mango attachment references and the settings editor hydrates their authenticated preview without public storage URLs.
EMAIL81 - Once opening an unread message has queued its exact-scope provider mark-read command, changing mailbox tabs, search, unread-only state, Home view, or active mailbox may detach that command from visible UI state but must not silently cancel the captured provider mutation. The completion may update only its captured company/user/account-or-shared-inbox, list filter, and selection generation. If a terminal user/session transition suppresses the command, its ownership token and optimistic overlay must be released rather than left as false read state.
EMAIL82 - Folder metadata belongs to the exact company plus personal-account/shared-inbox scope, not to message-list presentation filters. Changing Primary/Starred/Sent, search, or unread-only state neither invalidates an in-flight folder response nor requires a replacement folder request. Changing the exact mailbox scope invalidates old folder ownership, and acceptance/webhook refresh still permits one active load plus one queued final load for the destination scope.
EMAIL83 - A canceled caller waiting on a same-key backend folder/page/detail provider read returns promptly without canceling the shared leader needed by other callers. The canceled caller releases its generation admission while the shared leader retains admission until the provider operation finishes, and only the still-current exact generation may populate cache state.
EMAIL84 - The exact-account read-receipt cutover handles legacy personal summaries explicitly. A legacy `receipt_scope_id = user_id` row is merged into `user_id:normalized_account_email` only when that user has exactly one stored personal email connection; existing exact rows retain the strongest status, complete signal history, and timestamp bounds. Zero-account or multi-account legacy rows are deleted as an intentional ambiguous-history reset rather than retained as unreachable shadow data. The repair is a new idempotent forward migration that sorts before the separately committed legacy drop on fresh installs and still runs when that drop is already ledgered.
EMAIL85 - A signed shared-mailbox webhook is acknowledged only after exact cache invalidation and either successful current-audience publication or a legitimate no-subscriber/no-authorized-recipient result. Resource-existence or audience lookup failure is retryable: webhook deduplication is released and the handler returns failure so the provider may redeliver. A retried `message.opened` payload retains its first receipt timestamp, and an identical signal timestamp cannot increment the stored receipt twice. Publication-time authorization is deadline-bound, limited to locally subscribed users, and remains fail-closed.
EMAIL86 - Draft attachment preparation and the subsequent upload/link form one per-draft mutation lease. Empty-draft cleanup may run after concurrent work only when the last lease ends and every mutation in that group failed; one failed inline image must never delete a durable draft another upload/link still uses, and a successful mutation prevents later failure cleanup from deleting its resource.
EMAIL87 - A multi-message email detail exposes a clear conversation-order control with Oldest first as the default and Newest first as the alternate. Opening a conversation automatically brings the newest expanded message into view without reversing the canonical timeline. Ordering is deterministic, changes only presentation order, preserves exact-message actions/body loading and expansion state, and does not alter provider/thread identity or mailbox list ordering.
EMAIL88 - Personal-account and shared-inbox signatures use a practical-height unified editor with explicit Edit and Preview modes. Durable signature-image references survive sanitization and insertion, and the signature editor, preview, and compose body eagerly hydrate those images through the existing authenticated `email_signature`/draft attachment paths without public URLs or raw stored bytes.
EMAIL89 - A message is shown as Likely opened only from a persisted, exact-mailbox Nylas `message.opened` signal; merely listing, previewing, selecting, or displaying a Mango inbox/thread never creates a receipt. Each distinct provider-reported open timestamp is persisted and returned by the read-status API. The compact chip groups repeated signals, lists every available occurrence in the viewer's local date/time on hover or keyboard focus, uses provider-reported identity only when available, infers a named recipient only when exactly one recipient exists, and otherwise keeps identity unavailable. Nylas open tracking is a tracking-pixel load rather than proof of a deliberate human read; proxy/privacy behavior may create or suppress signals.
EMAIL90 - Every outbound user-email entry point, including personal/shared compose, Reply, Reply All, node-attached reply, scheduled-draft execution, and collaboration-draft send, must enter one centralized ten-second dispatch gate before any provider-send HTTP request begins unless the user explicitly chooses Send now. Undo removes only that pending attempt, rejects its waiting caller with the typed undo result, and guarantees that dispatch cannot start; Send now or timer expiry atomically removes the pending item once and executes the same existing authoritative backend send path once. Repeated or racing actions are harmless, simultaneous attempts remain independent, in-app navigation and component unmount do not bypass or prematurely cancel the module-owned timer, and post-dispatch provider errors retain normal error/draft behavior. Undoing an automatically due scheduled draft also clears and persists its send time so the scheduler cannot requeue it. Full document termination cannot dispatch a queued attempt because no HTTP request has started; surfaces with durable drafts retain them, while other surfaces follow their existing draft-persistence contract.
EMAIL91 - While an outbound attempt is pending, Mango renders a neutral elevated action surface in the established top-of-triage notice area and in the node-attached reply dock when that is the active sender. Each pending attempt has its own accessible Send now and Undo actions, live seconds label, and rectangular progress fill anchored left so its right edge visibly depletes toward the left across the ten-second window; Send now dispatches only that exact attempt immediately, while Undo and the surface are not success-green.
EMAIL92 - My Triage and Shared Triage share one responsive mailbox-list control row. Search remains a submitted exact-mailbox filter in a compact left group; unread count, Unread only, and an icon-plus-label ordering button form the right group. The ordering button visibly and accessibly reports Newest first or Oldest first and defaults to Newest first. Newest uses the provider's reverse-chronological first page; Oldest requests the complete exact-mailbox filtered tab through bounded 200-message provider pages, deduplicates by provider message ID, and then chooses the oldest conversations for the fixed visible page. Ordering therefore changes page membership across Inbox, Starred, My Drafts, All, Spam, and Sent while preserving exact mailbox scope, search/unread filters, thread identity, and the 12-conversation primary archive-page limit.
EMAIL93 - A durable signature image begins in an explicit loading-preview state, obtains its display source only through the authenticated exact-mailbox attachment loader, uses contain sizing, and becomes visible only after the browser decodes that source. The hydration owner must restart after any setup/cleanup lifecycle replay, including React development replay, and revoke every superseded object URL. Final fetch/decode failure shows a non-broken Preview unavailable state while preserving the durable Mango reference and the independent authenticated original-image lightbox path.
EMAIL94 - Folder metadata is complete before the Inbox counter is derived: the backend follows every Nylas folder pagination cursor until exhaustion, preserves provider `total_count`/`unread_count`, and fails a repeated cursor instead of silently returning a partial list. Personal Email/My Triage and Shared Triage show an Inbox counter but no Starred counter. An exact provider Inbox total wins; when that total is unavailable, an active unfiltered Inbox shows its loaded message count with a `+` while more pages remain and retains that truthful fallback for the same mailbox across tab changes instead of fabricating an exact total or hiding the counter.
EMAIL95 - After a provider accepts an ordinary personal/shared mailbox send, every Mango-owned attachment in that send is independently linked to the exact personal/shared `email_message` resource using the returned provider message ID before the response is exposed. Inline/CID relationship kind and missing filename/type/size metadata are retained, and Sent-body hydration accepts `attachment_id`-only metadata, so deleting the source draft cannot remove authorized image rendering.
EMAIL96 - Controlled rich-editor value updates caused by typing do not dispose and recreate an unchanged attachment hydration owner. Object URLs, decoded image nodes, loading state, selection, and double-click behavior remain stable across ordinary keystrokes; cleanup still aborts pending work and revokes URLs on actual value/context replacement, lifecycle replay, or unmount.
EMAIL97 - New-message compose stretches its body editor through the remaining detail-panel height with a practical minimum and internal scrolling. In My Triage and Shared Triage, entering Sent preserves the normal three-action header geometry; Compose and Sent retain their positions while Archive page/go-next remains present but disabled and non-actionable.
EMAIL98 - Outbound attachment streaming distinguishes validated content failures from cleanup cancellation. Open, read, short-body, and long-body failures before provider acceptance still return `attachment_storage_failed`; once the exact declared bytes have been read, source close is best-effort, and a successful provider response cannot be replaced by a cleanup-induced cancellation. A browser-canceled provider attachment preview also ends silently when its request context is canceled, without logging or writing a misleading Nylas proxy error.
EMAIL99 - Sending a saved personal/shared signature resolves the authorized original attachment, rewrites every deduplicated Mango image reference to one alphanumeric CID, and streams the original bytes with declared-length and stored-SHA validation. Display is preview-only and cannot mask an unhealthy original. Provider success returns CID HTML plus durable attachment metadata and promotes the attachment to the exact sent email_message link before Sent rendering.
EMAIL100 - Outbound attachment diagnostics classify object-not-found, storage unavailable/timeout, content-length mismatch, short stream, long stream, read failure, checksum mismatch, invalid stream, and opaque open failure. The server logs only request correlation and safe scope/attachment identifiers plus class/public code; no provider/storage error text, secrets, URLs, filenames, bodies, or bytes. Browser/request cancellation remains silent and is distinguishable from the messages/send POST.
EMAIL101 - Timer expiry and Send now atomically invoke the same captured backend send closure once and propagate the identical backend success or failure. A failed dispatch never reports sent, never deletes the durable draft, and leaves the still-current compose/reply content recoverably open; only a resolved successful send may close the matching compose and retire its draft.
EMAIL102 - Forward is an explicit compose kind, separate from Reply. It retains the exact source message and source ID for draft identity but never sends `reply_to_message_id`; its outbound body combines authored editor content with one locked sanitized forwarded block produced by the same renderer as the compose preview. Visible HTML and safe styling survive, while scripts, forms, event handlers, unsafe URLs, and obvious tracking pixels do not. Ordinary source attachments and referenced inline assets are copied into the exact Mango draft scope, inline CIDs are rewritten to copied durable attachment IDs, partial copy failure is visible and recoverable, and provider attachment limits are enforced before copying.
EMAIL103 - Home and node-attached email use one calendar-invitation card backed by an authenticated raw-MIME UID lookup and the authoritative Nylas event. When supplied, the card shows title, time and timezone, organizer, guests, location, current RSVP state, Join meeting, Copy link, and Open calendar. Accept, Tentative, and Decline show saved state only after provider success; permission/provider failures never invent event or RSVP state.
EMAIL104 - Manual Split conversation and Merge conversations controls are intentionally outside the current email-thread scope. Canonical provider/header identity, exact mailbox scoping, oldest-to-newest presentation, and one visible item per canonical message remain the thread contract; subject/body resemblance alone never groups or separates messages.
EMAIL105 - The normal Archive action in an open My Triage or Shared Triage email archives that exact selected provider message, removes its visible row, selects the row immediately below it, and opens that next detail automatically. If the archived row was last, Mango selects the nearest previous row; if no row remains, the detail clears. The separate Archive page and go next action retains its fixed-page behavior.
EMAIL106 - A non-primary mailbox tab with a next page but no actual list scroll range automatically appends pages until the list becomes scrollable or the provider reports exhaustion. This prevents condensed All, Starred, Sent, Spam, or Archive results from trapping the user on a short first page; ordinary scroll continues loading near the bottom without replacing the selected detail.
EMAIL107 - While the selected detail owner is already fetching a message/thread, the mounted conversation viewer must not start a competing newest-message body hydration. Same-key caches and in-flight coalescing remain a safety net, but the visible contract is one stable loading transition from row preview to the complete canonical timeline, never a one-message/detail blip followed by repeated thread reconstruction.
EMAIL108 - Personal Email, My Triage, and Shared Triage use the same ordered mailbox actions: Inbox, Starred, Sent, and the All/Spam dropdown form four equal top controls; Compose, My Drafts, and Archive page/next always form three equal lower controls in fixed positions. The lower workflow actions rest on lightly tinted blue-violet, violet-fuchsia, and cyan-teal elevated surfaces. Compose or My Drafts receives its full gradient only when it is the single selected destination; Archive page/next receives stronger teal interaction feedback when available and remains visibly disabled, never removed, on mailbox tabs where that action is inappropriate. The All and Spam menu rows show a clear hover and keyboard-focus highlight across the full row without a dead gap between options.
EMAIL109 - My Triage and Shared Triage use one email-to-resource model. A normalized message/thread is connected to a Node, Project, Logic Gate, or supported textbox only through `email_relationships`. Imported email never becomes editable Node text. A successful destination command creates or reuses the ordinary resource and relationship, uses a real textbox for any chat, preserves two-way navigation, and renders the stored chronological thread without a provider read. No `created_from_email`, special source projection, or collaboration identity is persisted.
EMAIL110 - The Node email header does not contain a collapse/hide-column arrow; the existing Node-level Email toggle is the sole hide/show control. The header instead offers an accessible Expand email column control. Its 180-millisecond transition gives email all workspace width except a 38-pixel right rail that preserves the text-box circle-and-line timeline, marks the clipped editor/chat region inert, and restores the user's prior normal layout on the second press. Node chat opens beside an editor at a compact 340-pixel default rather than half the available width, while deliberate separator resizing remains persisted.
EMAIL111 - The selected My Triage or Shared Triage toolbar keeps ordinary mail controls plus one hashtag destination search and Chat. Existing destinations act immediately; new Node/Logic Gate/Project destinations collect the existing priority and Logic Gate requirements. Success reconciles the returned ordinary resource plus `email_relationships` identity so matching mailbox rows and replies can open the exact related message. Chat never creates a second collaboration identity.
EMAIL111 interaction detail - Priority choices and Project Logic Gate choices are pre-open as individual elevated neomorphic options; clicking the final required option submits without opening a native dropdown. A direct existing-Node import annotates the matching mailbox row and every loaded thread reply immediately after the established import succeeds, even when no email-collaboration record exists.
EMAIL112 - My Triage and Shared Triage related-email chats use the same author-only Node textbox comment editor. Editing recomputes mention IDs/entity links, preserves the exact textbox and optional email selection, and reconciles mounted viewers through the Node chat hint. Mentions do not create permissions or participants; failed saves restore the local draft for retry.

EMAIL113 - Import is user-initiated and has two stages. The request authorizes the exact personal/shared mailbox and destination resource, validates the returned provider message identity, stores the complete normalized thread/message snapshot, and creates or reuses one `email_relationships` row atomically. Only after commit does a durable retryable job download missing thread messages and attachments.
EMAIL114 - Provider identity is always mailbox-scoped. The primary message key is company plus immutable personal-user/account or shared-inbox scope plus Nylas message ID. The primary thread key is the same mailbox scope plus Nylas thread ID, falling back to the selected Nylas message ID only when Nylas supplies no thread ID. An RFC `Message-ID` header may be retained as secondary evidence but is not the primary key. Subject, participants, dates, snippets, bodies, and visual similarity never identify or merge messages or threads.
EMAIL115 - Before downloading anything, import checks the exact mailbox-scoped provider message identity. Complete normalized messages are reused; incomplete rows resume only missing work. Concurrent/retried requests converge through thread, message, relationship, attachment, and active-job uniqueness and never create duplicate Node placement tables.
EMAIL116 - A new selected message creates or reuses one normalized thread, inserts only missing messages, and queues the smallest required durable job. Importing another message into the same or another authorized resource creates only the needed `email_relationships` rows and optional real-textbox association; it does not create a Node-wide source row.
EMAIL117 - The thread download job is database-backed, leased, and retryable across request completion or server restart. At most one active full-thread job exists per durable thread and at most one active selected-message job exists per durable thread/message. A worker claims pending/retry work, records attempts, uses bounded exponential retry for transient provider/storage errors, resumes missing messages/files, marks permanent or exhausted failures visibly, and never treats a process-local goroutine as the durable authority.
EMAIL118 - Message persistence includes HTML body (and provider text when available), subject, snippet, timestamp, From, To, Cc, Bcc, Reply-To, provider message/thread IDs, folders needed for faithful display, and deterministic chronological order. HTML stays immutable email HTML rather than being translated into editable Node JSON. Rendering sanitizes it and blocks active/unsafe content. Empty Bcc or body is a valid stored value and must not be mistaken for an incomplete download.
EMAIL119 - Incoming files and inline CID images are copied into Mango-owned private object storage and linked to normalized email messages; relationship-specific links use `resource_type='email_relationship'` and the relationship UUID. Retry uses stable identity. A user reads through normal relationship-resource authorization, never through the source user's provider grant.
EMAIL120 - Stored messages are ordered by provider timestamp ascending with immutable Nylas message ID as the deterministic tie-breaker; UI reversal is presentation-only. `history_complete=true` means the provider thread was completely downloaded as observed by that specific user-initiated import job, not that the external thread can never receive another message. A later explicit import may append a newer, older, or same-timestamp message and recomputes order without changing stable Mango message IDs.
EMAIL121 - Provider webhooks remain mailbox-list invalidation hints only. They may refresh the authorized mailbox view, but never create or update normalized resource relationships, enqueue a resource thread job, or reveal later mail through a Node/Project/Logic Gate. Adding later mail requires an authorized explicit import.

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
- Mango writes or updates an `email_drafts` row scoped to the user's personal email connection.
- The browser may keep a local mirror, but reload uses the database row when available.
- Reopening Drafts shows the same draft on another browser session after backend sync.
- A different non-manager user cannot see or edit the personal draft.
- Clicking an email in the left list while compose is open quietly saves eligible draft content, closes compose, and renders the clicked email immediately.
- Saving or sending flushes the mounted editor first and persists or submits the exact returned sanitized HTML.

### Scenario EMAIL-S2: Shared-Inbox Draft Durability

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
- Users with Shared Triage edit access can see the draft; users with edit access can mutate it.
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
- Canonical messages render oldest to newest as one connected timeline of clearly separated raised Mango surfaces, with the newest message expanded and older messages collapsed to sender/time/snippet headers.
- A new message appears once at the bottom immediately, becomes the sole automatically expanded card, and is brought into view; sent and received direction remains visually distinguishable.
- Each expanded card shows only that message's newly authored body by default, retaining its signature, one owned attachment group, metadata, and exact-message Reply, Reply all, Create shared draft, and Forward actions through the contextual control hierarchy.
- Gmail/client quote containers, cited blockquotes, Outlook From/Sent/To/Subject history, original-message separators, and conservative trailing plain-text quote runs collapse without removing ordinary authored blockquotes or quote-only messages.
- Show quoted history reveals the unchanged full provider body for that exact message, and hiding it restores the authored-only view; reply and forward actions continue using the unchanged provider message.
- Users can expand older cards without an internal message scrollbar; the thread pane remains the only vertical scroll surface.
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
- EMAIL70
- EMAIL71
- EMAIL75

Given:
- An external sender sends the first message, the Mango user replies, and the external sender replies again after the initial HTTP list but before first subscription acceptance, while the personal or exact shared inbox is open, or while another view is active.
- The bounded preview page omits the Mango sent reply, or the initial send response omits thread ID while its exact reply target has one.
- Another user/account/shared inbox knows a durable draft ID and attempts list, get, update, delete, or attachment access.
- A hint burst overlaps one active refresh, the user navigates between personal accounts/shared inboxes before a delayed timer fires, and an unrelated new message arrives while another detail is selected.
- A personal or shared message is converted from one exact source mailbox while another personal account or shared inbox is also connected.

Expected:
- A signed, deduplicated exact-mailbox hint is authorized for only the selected connected personal account or exact shared inbox. First acceptance discovers mail committed after the initial list, reconnect acceptance performs one recovery, and the matching active list/folders refresh canonically without polling.
- Bursts use one active refresh plus at most one queued final refresh. Navigating cancels/discards the old request key; personal Account A, personal Account B, and Shared Inbox A never invalidate or issue provider GETs for one another.
- Shared root/headings/grouping/plain-folder and other off-view states retain no fallback mailbox subscription and perform no hint-triggered GET.
- `message.created`, `message.updated` (including moves), `message.deleted`, and folder changes reconcile only relevant canonical state; directly named selected message/thread changes refresh detail, while an unrelated new message does not.
- Conversation detail contains all provider-listed sent and received members, including the intervening Mango reply, without duplicate IDs, subject-based merging, cross-scope history, or loss of valid one-offs/forwards.
- The unread dot/frame and visible count clear immediately on pointer/Enter/Space open and stay cleared after success; a failed provider write rolls back and reports the error. The selected full-card surface remains distinct.
- The row shows a thread icon only for the proven multi-message conversation.
- Every draft operation and attachment authorization uses one immutable exact scope. Personal-owner and shared edit/no-access distinctions hold; cross-scope known IDs cannot expose content or mutate scope, spoofed shared account data is ignored, and stale browser mirrors cannot reappear as another scope's drafts.
- Conversion and its follow-up unstar/archive/move commands preserve the exact source `account_email` or `shared_inbox_id` through committed-result handoffs; another connected mailbox grant is never substituted.

### Scenario EMAIL-S12: Mailbox Buckets, Thread Query Mode, And Database Drafts

Business logic covered:
- EMAIL1
- EMAIL3
- EMAIL4
- EMAIL18
- EMAIL22
- EMAIL50
- EMAIL51

Given:
- A Google personal or shared mailbox contains Primary, Social, Promotions, starred, sent, archived, and spam messages.
- The user loads Primary, All, Starred, Archive, Spam, a multi-message thread, and the exact personal/shared Drafts tab.

Expected:
- Primary uses `in:inbox -category:social -category:promotions` on fresh ordinary loads, `refresh=true`, cached responses, and after local reconciliation; Social and Promotions never appear there.
- All remains `in:anywhere`, Starred remains `is:starred`, and Archive/Spam retain their existing Gmail-native expressions. Search text is grouped and unread-only is folded into the one native expression, so user operators cannot widen the selected bucket.
- Every native provider request contains only `search_query_native`, `limit`, and optional `page_token`; the returned Mango list remains preview-only even if the provider returns extra body/content fields.
- Thread previews use `thread_id`, `select`, `limit`, and optional `page_token` without native mailbox search. Authoritative thread `message_ids` remain the source of truth: members absent from bounded previews are recovered immediately by exact ID, while preview-resolved older bodies hydrate through per-card detail reads on expand or Expand all.
- Opening Drafts makes no provider message-list request. Its ordinary private branch shows only the authenticated personal user/account or selected shared inbox according to edit/no-access permissions; the explicit collaboration branch adds only active drafts for which the current user is a permanent participant and labels the immutable source mailbox.

### Scenario EMAIL-S13: Lazy Email Collaboration And One Shared Chat

Business logic covered:
- EMAIL52
- EMAIL53
- EMAIL54
- EMAIL55
- EMAIL56
- EMAIL57
- EMAIL58
- EMAIL64
- EMAIL76
- EMAIL78

Given:
- A user opens and highlights text in a personal or shared email that has no collaboration.
- The user may leave the rail closed, explicitly open and close it, abandon the composer, submit a root chat, reply to a chat, or race another create request for the same source conversation.
- The provider, source-authorization, collaboration-store, or following chat write may fail before the first chat is durably visible.
- The same collaboration is later opened from its standalone Node.

Expected:
- Listing, opening, selecting, and an abandoned empty chat composer create no collaboration or Node.
- Selecting, reading, or highlighting the email leaves the chat rail closed and preserves the email's full detail width; only the explicit accessible Chat control mounts the rail, and closing or changing scope performs no durable mutation.
- The first nonempty chat submit opens mandatory priority selection followed by the adjacent Logic Gate search, then converges on one private email Node keyed by exact mailbox scope and provider thread/message identity; a chosen gate receives the Node in `requested`, the explicit no-gate choice leaves it unassigned, and a later chat-write failure reuses the Node rather than duplicating it.
- A failed ensure leaves no partial durable collaboration artifacts; either failure preserves the typed composer context, never shows a saved row before acknowledgement, re-enables retry, and translates `failed_to_create_email_collaboration` or `email_collaboration_storage_not_ready` into actionable text.
- The Node starts with one source-scoped attached-email projection, the selected mandatory priority, creator Generated GVIC, private participant access, and Unfiled/Nodes placement. Its Logic Gate assignment is exactly the user's second-step choice: selected gate in `requested`, or no assignment after **Create without a Logic Gate**.
- Email detail and Node detail render the same durable chat IDs through the shared ChatPane and Node chat scope, including identical reply indentation, attachment, mention, link, delete, and refresh behavior. Posted chat images therefore expose the same right-side original download and shared fullscreen double-click preview in both mounts.
- A selection-backed root chat stores and later navigates to the exact message, quote, and offsets; an unanchored root chat is valid, and replies retain the root's anchor instead of following the newest message.
- A guessed collaboration or Node ID is denied before provider content is read.

### Scenario EMAIL-S14: Permanent Mention Participants And Future Thread Mail

Business logic covered:
- EMAIL59
- EMAIL60
- EMAIL61
- EMAIL62
- EMAIL63
- EMAIL64
- EMAIL77

Given:
- A chat mentions one user directly and a group whose resolved membership overlaps that user.
- A mentioned user is not a provider recipient and cannot navigate the source shared mailbox.
- Group membership changes and a new provider message later joins the same Nylas thread; no user has imported that later message yet.

Expected:
- The accepted chat write snapshots each distinct current same-company user once and grants permanent collaboration participation/edit access.
- Later group changes, mention deletion, and duplicate mentions neither revoke nor duplicate participants.
- Before creation the open email-chat header shows only the current actor as prospective creator without writing anything. After creation, Triage renders canonical participant provenance and the Node header renders compact durable author/mention history over the same chat. Neither roster turns anyone into a provider recipient.
- Every participant can read the Mango-stored thread snapshot and Mango-stored attachments without receiving provider credentials, an auto-forwarded provider copy, or access to the source mailbox.
- The source email appears only in a participant's active My Triage or Shared Triage when that exact provider mailbox response returns it. Mentioned nonrecipients retain stored-thread and Node/chat access but receive no email-list row.
- A participant who is also a provider recipient sees the one provider-owned row annotated with collaboration identity by exact source scope plus provider thread/message identity.
- The later provider message does not appear from a webhook, mailbox refresh, Node open, or background schedule. After an authorized user explicitly imports that exact Nylas message, it is appended once for all Node collaborators.
- Similar subject text, participants, or body content in another thread or mailbox never joins the collaboration.

### Scenario EMAIL-S15: Shared Reply-All Draft Concurrency, Send, And Discard

Business logic covered:
- EMAIL65
- EMAIL66
- EMAIL67
- EMAIL68
- EMAIL69

Given:
- A permanent participant chooses Create Shared Draft from Reply All on an exact message.
- Two participants open the resulting draft, one saves a newer revision, and the other attempts a stale update, send, or discard.
- The source connection/shared inbox is deleted while a collaboration draft (possibly an uncertain send claim) and an ordinary private draft exist in that source.
- A current participant later sends successfully or confirms discard.

Expected:
- Creation reuses the collaboration, applies normal Reply All recipient rules, and yields one active collaboration/source-message draft.
- The same Mango draft appears in My Drafts/Drafts for every participant on either triage surface with its real source mailbox identified; it never appears through a provider Drafts request.
- The stale command conflicts, returns the canonical revision, preserves unsent local content, and cannot overwrite, send, or discard the newer revision.
- The shared-draft surface offers immediate send only, and the ordinary browser scheduler excludes shared drafts.
- An authorized current-revision send claims that revision, revalidates the immutable exact source message/thread, recomputes Reply All from provider truth, and uses one stable idempotency key. A concurrent retry during the five-minute lease is rejected without another provider call. A stale retry inside one hour gets a new claim token, replays the same key, and completes the same logical send after a missing provider message ID or transient durable-completion failure.
- A fresh claim releases its key after a pre-provider source/validation/attachment failure, while the same failure on a recovered uncertain claim preserves `sending` plus its exact key, grant binding, and first-claim timestamp without another provider call.
- A retry at or beyond the one-hour provider-idempotency boundary returns the canonical `email_draft_send_recovery_window_expired` conflict without another provider send. The final check runs after all preflight work and reserves the full outbound Nylas timeout before the boundary; entering that safety margin preserves the uncertain identity, blocks dispatch, and reports `can_discard=false` until its newly renewed five-minute lease ends. After inspecting the provider thread, a participant can revision-check and discard the expired inactive claim; no automatic new-key resend is permitted.
- Replacing/reconnecting the source mailbox grant before stale recovery returns canonical `email_draft_send_recovery_source_changed` guidance without a provider call, because the original key is not valid duplicate protection in another grant scope. Once the five-minute lease is inactive, revision-checked local discard remains available even if the source connection is unavailable.
- Source deletion preserves the collaboration draft's immutable scope, content, revision, attachments, and exact recovery identity without rebinding it; the same deletion still removes ordinary non-collaboration drafts from that source.
- Confirmed current-revision discard removes only the shared draft for all participants and leaves the collaboration, Node, chat, provider thread, and ordinary private drafts intact.
- Attachments remain authorized Mango references and no durable payload contains file bytes, provider credentials, presigned URLs, or storage keys.

### Scenario EMAIL-S16: Draft Recovery And Scope-Safe Concurrency

Business logic covered:
- EMAIL2
- EMAIL3
- EMAIL4
- EMAIL47
- EMAIL72
- EMAIL73

Given:
- An exact-scope draft list fails with Mango `401`, an unclassified `403`, provider reauthorization/disconnection `409`, `5xx`, or a network error.
- Separate requests prove explicit access revocation, company deletion, shared-inbox deletion, or a shared row that is no longer mail-bearing.
- Two account/inbox loads complete out of order while a same-scope local save or delete occurs.

Expected:
- Recoverable auth/provider/service/network failures retain every unsynchronized draft in the exact affected scope and do not leak it into another scope.
- Only explicit revocation or definitive scope deletion purges that one scope; unrelated personal accounts and shared inboxes remain intact.
- A stale load returns the current exact-scope value and cannot overwrite a newer load, save, delete, or different account/inbox in browser storage.

### Scenario EMAIL-S17: Live Draft Attachment Authorization

Business logic covered:
- EMAIL6
- EMAIL12
- EMAIL17
- EMAIL74

Given:
- A user starts an otherwise empty personal or shared compose and selects an attachment.
- The draft is later deleted; the attachment may also have an independent sent-message link.
- A wrong user/account, revoked shared editor, company manager, or company administrator attempts draft-scoped access.

Expected:
- Mango creates the exact durable draft before uploading or linking the attachment, and concurrent preparation creates that row once.
- Active personal draft access requires the exact owner/account; active shared access requires the exact inbox and current permission; legacy accountless personal IDs are read-only compatibility for a still-live owner draft.
- Once the draft is deleted, list/content/send/mutation through its draft link returns not found for every actor, including administrative bypass attempts.
- A legitimate independently linked sent-message attachment remains readable under its own authorization after draft deletion.

### Scenario EMAIL-S18: Attached-Email Files And Mailbox Signature Parity

Business logic covered:
- EMAIL28
- EMAIL30
- EMAIL79
- EMAIL80

Given:
- A personal or shared message has an ordinary PDF with a provider Content-ID, a body-referenced CID image, and exact message/thread/mailbox provenance.
- The user converts that message into a new Node or attaches it to an existing Node, then starts Reply or Reply All from the Node.
- The saved exact-mailbox signature contains an authenticated Mango image and may finish loading after the user begins typing.

Expected:
- Both Node entry paths display the immediately stored selected-message snapshot, then download remaining current thread messages in a durable retryable job. The PDF, CID image, and signature assets are copied into Mango-owned private attachment storage once.
- No provider bytes or duplicate attachment metadata are stored in the editable Node projection; authorized Node collaborators read the immutable email rows and Mango attachment objects without Nylas access.
- New compose and Reply/Reply All across My Triage, Shared Triage, and the Node viewer receive the exact mailbox signature once.
- A late signature load preserves typed text, draft restore and mode switches do not duplicate the signature, and the settings image preview uses the authenticated Mango attachment path.

### Scenario EMAIL-S19: Exact Mailbox Ownership, Retry, And Concurrent Mutation Settlement

Business logic covered:
- EMAIL81
- EMAIL82
- EMAIL83
- EMAIL84
- EMAIL85
- EMAIL86

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

### Scenario EMAIL-S20: Mailbox And Conversation Order With Durable Signature Preview

Business logic covered:
- EMAIL80
- EMAIL87
- EMAIL88
- EMAIL92
- EMAIL93

Given:
- A My Triage or Shared Triage page and one selected conversation contain messages with deterministic timestamps.
- Search and Unread only produce a filtered mailbox tab whose oldest messages are not present in the provider's first reverse-chronological page.
- The exact mailbox signature includes a durable Mango attachment image, and editor hydration is cleaned up and replayed once.

Expected:
- Mailbox controls default to Newest and expose the current/alternate state visibly and accessibly. Choosing Oldest loads the complete exact-scope filtered tab in bounded provider pages, deduplicates provider IDs, and makes the oldest conversations the visible page membership; choosing Newest returns to the true newest conversations. Search, unread, and mailbox scope remain authoritative.
- Conversation detail independently defaults to Oldest-to-newest, brings the newest expanded message into view, and may switch to Newest first while exact-message actions/loading remain attached to the same canonical messages.
- Opening signature settings provides a practical editor plus explicit sanitized Preview, and switching modes does not change mailbox scope or saved content.
- After lifecycle replay the signature image restarts authenticated eager hydration in settings and compose, displays with contain sizing only after decode, and keeps double-click original viewing.
- Loading and terminal failure show explicit private states instead of a native broken thumbnail; failure preserves the durable Mango reference.
- No signature path stores public object URLs, data URLs, provider secrets, or attachment bytes in the rich body, and cleanup revokes every display URL.

### Scenario EMAIL-S21: Open Receipts, Thread Disclosure, Unread Styling, And Universal Undo Send

Business logic covered:
- EMAIL23
- EMAIL30
- EMAIL46
- EMAIL89
- EMAIL90
- EMAIL91

Given:
- My Triage and Shared Triage contain unread single- and multi-message conversations, a sent message receives multiple `message.opened` signals, and Nylas supplies no recipient identity.
- A user sends from personal/shared compose, a triage reply, a collaboration shared draft, and a node-attached reply, including two pending attempts at once.

Expected:
- Unread rows retain their dot/emphasis and open/rollback semantics without any blue or thick unread card frame.
- The conversation header contains only the subject. Collapsed rows show sender/date/snippet without participant dumps; expanding one row reveals only that message's labeled participants, body, attachments, and actions with accessible disclosure state.
- The Seen chip appears only from persisted provider open signals, lists distinct local occurrence times, and explicitly reports recipient identity unavailable plus the tracking-pixel limitation; list visibility never produces Seen.
- No provider-send request begins during the ten-second window unless the user activates that attempt's accessible Send now action. Each neutral elevated countdown independently depletes right-to-left; Undo prevents that attempt, while Send now or expiry dispatches exactly once through the existing mailbox-scoped backend path.
- Navigation or sender-component unmount does not bypass the gate, provider failure after expiry remains a real send error, and terminating the document before expiry sends nothing; Undo also clears an automatically due draft's persisted send time, while other durable-draft recovery follows the originating surface's existing persistence contract.

### Scenario EMAIL-S22: Reliable Inbox Counter, Durable Sent Images, Stable Typing, And Compose Geometry

Business logic covered:
- EMAIL94
- EMAIL95
- EMAIL96
- EMAIL97

Given:
- Inbox metadata lands on a later provider folder page or omits its exact total.
- A signature or pasted image is sent from a durable draft, then that draft is retired and the local Sent result is opened.
- The user types repeatedly beside an already hydrated inline image and opens New Message in a tall detail pane before switching to Sent.

Expected:
- All folder pages are loaded before the Inbox counter is derived. An exact provider total is shown when available; otherwise the active unfiltered Inbox shows its loaded count, suffixed with `+` while more pages remain. Starred has no counter.
- The send response keeps provider-ready CID HTML plus Mango metadata, the attachment gains an independent exact sent-message link, and Sent renders it after draft deletion without public URLs or stale temporary sources.
- Each keystroke retains the same hydrated image node/source and performs no new attachment fetch, decode, blanking, or object-URL revocation.
- New Message gives the body the remaining usable height, and Sent keeps the three-button header with Archive page/go-next visibly disabled.

### Scenario EMAIL-S23: Immediate Dispatch And Attachment Cancellation Boundaries

Business logic covered:
- EMAIL90
- EMAIL91
- EMAIL98

Given:
- Two outbound attempts are waiting in the ten-second undo window, and the user activates Send now on only one attempt.
- A signature image supplies its exact declared bytes but source cleanup reports cancellation after the provider has accepted the message.
- An authenticated provider attachment preview is canceled because the browser no longer needs it.

Expected:
- Only the selected attempt leaves the pending list and enters the existing backend send path immediately; its timer cannot dispatch it again, the other attempt remains undoable, and repeated Send now or Undo actions are harmless no-ops.
- Provider acceptance remains authoritative after exact-byte validation, so cleanup cancellation does not surface as `attachment_storage_failed`; genuine open/read/short/long failures before acceptance still do.
- The canceled preview request writes no proxy error response and produces no misleading Nylas proxy-error log.

### Scenario EMAIL-S24: Saved Signature Original, Sent Rendering, And Diagnosable Failure

Business logic covered:
- EMAIL90
- EMAIL95
- EMAIL99
- EMAIL100
- EMAIL101

Given:
- Personal and shared saved signatures contain Mango images with distinct original/display objects and are submitted once by timer expiry and once with Send now.
- The original stream succeeds, then exercises known open/length/read/checksum failures and request cancellation.

Expected:
- Both dispatch choices use one identical send path and send the checksum-validated original as a CID attachment; recipient/Sent rendering uses CID metadata plus the promoted durable link, never a compose object URL.
- Each non-canceled failure returns the classified public boundary, safely correlates the messages/send POST and attachment index, retains the draft/compose, and leaks no raw error/body/secret data; cancellation is silent.

### Scenario EMAIL-S25: Archive Advance, Short All List, And Stable Thread Opening

Business logic covered:
- EMAIL37
- EMAIL105
- EMAIL106
- EMAIL107

Given:
- A user opens a known multi-message conversation in My Triage or Shared Triage and its canonical thread metadata is still loading.
- All condenses its first provider page into too few visible rows to create a scrollbar even though a next page exists.
- The user presses the normal Archive button while a row exists directly below the selected row.

Expected:
- The detail pane shows Loading conversation and then one complete timeline; it never paints a standalone selected body first, and the child viewer does not race the parent with another body hydration.
- All appends pages until there is a usable scroll range or no next page, then ordinary near-bottom scrolling continues pagination without a list/detail blink.
- Archive removes the selected row and opens the row immediately below. The final row falls back to the previous row, while an empty result clears detail; Archive page/go-next remains separate.

### Scenario EMAIL-S26: Ordered And Symmetric Mail Actions

Business logic covered:
- EMAIL108

Given:
- A connected personal Email, My Triage, or Shared Triage mailbox shows its list controls, and the user opens the All dropdown and moves the pointer or keyboard focus between All and Spam.

Expected:
- The four equal top controls read Inbox, Starred, Sent, and All/Spam; the three equal lower controls always read Compose, My Drafts, and Archive/next without moving or collapsing when the mailbox changes.
- Inactive lower actions use light modern tints. Only the selected Compose or My Drafts destination receives its full gradient; Archive/next stays in its third slot and is disabled outside Inbox. The menu option under pointer or focus receives an immediate full-row highlight.

### Scenario EMAIL-S27: Unified Email-to-Node Placement

Business logic covered:
- EMAIL109 through EMAIL111

Given:
- A user opens either My Triage or Shared Triage on a message that may be a standalone email, a reply in a larger thread, or a thread already attached to a Node.
- The user presses # and searches for an existing Node, Logic Gate, Project, or a new standalone Node, or writes a chat and presses Enter.

Expected:
- The compact hashtag search opens no rail. It searches Nodes, Logic Gates, and Projects on one neutral raised neomorphic surface. Clicking an existing Node submits immediately. New standalone and Logic Gate destinations submit when priority is chosen; a Project submits when both priority and Logic Gate are chosen. Enter and the right-arrow remain available, the successful collaboration immediately annotates the mailbox row and reply header with the Node indicator, and a temporary green success notice overlays the detail without changing its grid rows.
- The separate Node-wide email column shows the selected message immediately from Mango storage and fills in the rest of the current thread as the durable job completes. A linked text box may show only its exact associated message inside its left content column; it never duplicates the complete thread and never intrudes into or shortens the right chat column.
- Choosing an existing Node creates or reuses the exact-message text box with persisted `email_message_id` and deterministic `email_accent`, queues the same durable thread import, never opens chat, and shows **Email was added to node.** on success.
- Every message card has its own Chat icon before the three-dot menu. If its exact mailbox/thread already belongs to a Node, Enter writes directly to that message-linked text-box chat. Otherwise Enter preserves the draft, runs the same priority then Logic Gate sequence, attaches the complete thread, creates the exact-message text box, and commits the draft to that text box's chat.
- Each text-box row contains a left content column and an independently sized right chat column. Show email places the exact linked-message preview above the editor within the left column; when the editor is closed, that preview owns the left column. The chat always retains the row's full body height.
- The Node-wide email column and chat pane use the full available vertical space. The Node-level Email toggle retains a stable three-track shell and animates width plus opacity/transform for open and close; the closed email pane is inert and pointer-disabled. Email, Editor, Chat, and linked-email visibility changes honor reduced-motion settings; the email-focus button retains its separate responsibility.
- With one surface visible it fills its available area; with multiple surfaces visible, Node-wide email, text-box content, and text-box chat remain distinct columns.
- Legacy Attached-email-keyed chats may still render beside a linked text box, but no new chat or attachment is written to the Attached-email ID.
- My Triage and Shared Triage use the same controls and persistence path. Their top toolbar keeps mail actions on the left and the compact hashtag destination search plus Chat together on the right.
- Every linked row and reply card uses the canonical cyan-to-blue Explorer Node icon; no purple email-shaped or locally drawn Node indicator remains.

### Scenario EMAIL-S28: Edit An Email-Collaboration Comment

Business logic covered:
- EMAIL112

Given:
- A personal or shared email conversation has a collaboration chat with comments, mentions, attachments, and a message-linked text box.

When:
- The author edits one sent comment, changes its mention text, and saves while another participant has the chat mounted.

Expected:
- Only the author can edit or delete the comment.
- The atomic save preserves email/thread/text-box linkage, attachments, reply/source metadata, author, and original creation time.
- Newly resolved mention participants are appended through the existing collaboration transaction.
- The other mounted participant receives a compact exact-Node update hint and canonically refreshes the chat.
- Failed persistence restores the prior row and retains the draft for retry.

Automated coverage:
- `backend/internal/http/chat_comment_edit_test.go`
- `backend/internal/http/realtime_websocket_test.go`
- `tests/frontend/modules/realtime/realtimeWebSocket.test.ts`

### Scenario EMAIL-S29: Immediate Message And Durable Rest-Of-Thread Download

Business logic covered:
- EMAIL113 through EMAIL120

Given:
- An authorized user imports one selected Nylas message whose thread has several older replies, HTML, full envelope metadata, inline CID images, a signature image, and ordinary files.
- No mailbox-scoped durable thread exists yet.

When:
- The user submits an existing Node, Logic Gate, Project, or standalone Node through the hashtag destination search.

Expected:
- The request fetches and validates the exact selected Nylas message, stores it and its Node links atomically, and returns it immediately; the UI does not wait for the remaining thread.
- The selected card displays from Mango storage with body, timestamp, From/To/Cc/Bcc/Reply-To, and available files.
- Exactly one durable full-thread job is committed and may continue after the request ends or the server restarts.
- The worker stores only missing messages/files, orders messages by timestamp then Nylas message ID, and marks completion as complete for this user-initiated download.

### Scenario EMAIL-S30: Duplicate Import And A Later Manually Imported Reply

Business logic covered:
- EMAIL114 through EMAIL117
- EMAIL120
- EMAIL121

Given:
- A mailbox-scoped Nylas thread and all messages observed yesterday are completely stored and attached to a Node.
- Today Nylas has one new reply with a new Nylas message ID and the same mailbox-scoped Nylas thread ID.

When:
- The user first re-imports an already stored old message, then explicitly imports today's new reply.

Expected:
- Re-importing the old message reuses its stored message, thread, Node source, text-box link, files, and any active job; it performs no duplicate provider download.
- Importing the new message recognizes the existing thread, appends only the new selected message, and downloads only that message's missing files.
- Old Mango message IDs and stored bytes do not change; the deterministic order is recomputed and the exact-message linked text box is created/reused once.
- Before the explicit second import, webhooks, mailbox refresh, Node open, collaborator reads, and time passing do not add today's reply.

### Scenario EMAIL-S31: Partial Failure And Collaborator Without Nylas

Business logic covered:
- EMAIL117 through EMAIL121
- EMAIL61

Given:
- The selected message is stored, but downloading one historical attachment receives a transient provider or object-storage failure.
- Bob imported the email and Joe has Node access but no access to Bob's Nylas mailbox.

Expected:
- Bob and Joe can immediately read every completed Mango-stored message and file; the one failure does not blank or roll back the import.
- The durable job records safe retry state and resumes only missing work after backoff or restart without duplicating stored data.
