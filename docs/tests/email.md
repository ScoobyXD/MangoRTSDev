Last updated: 2026-07-14

# Email Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Exact mailbox hardening is covered by `homeMailboxRealtime.test.ts`, `unifiedRichEditorContract.test.ts`, `communications_singleflight_cancellation_test.go`, `realtime_audience_hardening_test.go`, `nylas_webhook_receipts_test.go`, and focused communications/store tests for retry-safe open receipts and exact-account migration ordering.
- Business Logic Covered By Automated Tests: Partial (`tests/frontend/pages/home/homeCommands.test.ts` covers send payload construction, Mango attachment references, and mailbox-scoped signature save ordering; `tests/frontend/pages/home/homeMailboxRealtime.test.ts` covers exact active targets, first/reconnect acceptance, event mapping, coalescing, queued-final work, and navigation cancellation; `tests/frontend/pages/home/homeMailDrafts.test.ts` covers provider/auth error retention versus exact revocation purge, out-of-order loads, local save/delete fencing, multiple personal accounts, and live-draft preparation before attachment upload; `tests/frontend/modules/editor/richTextEditing.test.ts` and `unifiedRichEditorContract.test.ts` cover rich email behavior. Backend communications/realtime/attachment tests cover exact mailbox routing, provider send boundaries, S3 attachment resolution, live email-draft attachment authorization, deleted-draft denial, sent-message survival, and durable inline-byte rejection. Broader mounted compose/signature endpoint coverage remains partial.)
- Outbound attachment tests in `backend/internal/http/communications_handlers_test.go` and `backend/internal/http/nylas_client_test.go` cover early validation, tenant/link authorization, the complete metadata limit preflight, lazy exact-length multipart streaming, inline CID fields, cancellation, provider rejection, and body cleanup.
- Mailbox query-mode tests in `backend/internal/http/communications_handlers_test.go`, `backend/internal/http/nylas_client_test.go`, and `tests/frontend/modules/communications/communicationsApi.test.ts` cover exact Google Primary bucketing, native/structured parameter exclusivity, thread precedence, preview-only response normalization, and Primary cache-overlay exclusions.
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

EMAIL1 - Mango email drafts are Mango application records, not Nylas provider drafts and not browser-only state. Personal and shared Drafts tabs render exact-scope `communications_email_drafts` rows, with only the fallback behavior allowed by EMAIL2; they never list the Gmail/Nylas Draft mailbox.
EMAIL2 - Browser `localStorage` may be used only as a company/user-keyed fallback mirror for drafts and signatures. Every view filters it to the exact active personal account or shared inbox; after a successful database read, only rows explicitly marked pending sync may migrate, and stale/unmarked local rows cannot resurrect deleted or revoked drafts.
EMAIL3 - Personal draft and signature rows are scoped to the actor's personal `user_email_connections` tuple of `user_id` plus `account_email`.
EMAIL4 - Shared draft and signature rows are scoped to `shared_inbox_id`; `shared_inboxes` remains the Mango permission/resource wrapper and points to `company_email_connections` for provider grant plumbing.
EMAIL5 - A draft or signature row must be either personal or shared, never both and never neither.
EMAIL6 - Ordinary personal draft list/get/create/update/delete and draft-attachment access are owner-only in the exact personal account scope; company manager status does not bypass ownership. Ordinary shared-inbox draft list/get/attachment reads require view access to the exact inbox, while create/update/delete and attachment mutation require edit access. Collaboration shared drafts use the participant/revision exception in EMAIL65 through EMAIL69.
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
EMAIL50 - Google Primary always means `in:inbox -category:social -category:promotions`. User search is grouped and unread-only is folded into that same native expression so advanced `OR` searches cannot widen the mailbox bucket. The backend response boundary plus backend/frontend cache reconciliation apply the same Primary exclusion, so fresh, refreshed, cached, and optimistic star/read paths cannot leak Social or Promotions into Primary. The messages remain eligible for All and, when starred, Starred.
EMAIL51 - Nylas message-list serialization has mutually exclusive query modes. A Gmail-native mailbox request sends only `search_query_native`, `limit`, and optional `page_token`; it omits `select`, `thread_id`, `q`, `in`, `unread`, `starred`, and every other structured filter. A thread-history request uses structured `thread_id` mode without `search_query_native`, while ordinary non-native lists retain the selected-field projection. Native response supersets are normalized back to Mango's preview-only list shape so body/detail hydration, mailbox membership, ordering, pagination, and account/shared-inbox scope do not change.
EMAIL52 - Merely listing, selecting, reading, replying to, highlighting, or abandoning an empty chat composer must not create a Node. Mango lazily and idempotently ensures the email-collaboration record and Node only when the user submits the first nonempty chat/attachment or explicitly creates a shared draft. Before that durable sharing transaction, the backend authorizes the exact source mailbox, fetches the requested message directly from the provider, validates the returned message/thread identity, and persists only the provider-derived snapshot; browser-supplied sender, recipients, subject, body, folders, and metadata are never authoritative. Provider failure or an identity mismatch creates nothing; if ensure commits but the following chat write fails, retry reuses that empty collaboration instead of creating another Node.
EMAIL53 - One collaboration identity represents one provider conversation in one immutable source mailbox scope: company plus personal user/account or shared inbox plus provider `thread_id`, falling back to the exact source `message_id` only when no thread ID exists. Concurrent create requests for that identity converge on the same collaboration and Node instead of producing duplicates, and a later-known thread ID is attached without merging data across mailbox scopes.
EMAIL54 - An email-collaboration Node is standalone and private: it has no Logic Gate/card, project relationship, status, priority, GVIC assignment, account assignment, or inherited work policy. Its default access is `no_access`; the creator and every collaboration participant receive durable direct edit access for collaboration chat, subject to the existing company-admin/dev-admin shell-view bypass contract. Generic Node information, saved-version, Logic Gate/status, project-relationship attach/upsert, GVIC, and account-assignment commands are rejected for this system-managed Node even for a participant or bypass administrator. Project-relationship delete remains allowed so an administrator can remove a legacy or erroneous relationship without weakening the attach guard.
EMAIL55 - Creation writes one canonical `Attached email` projection to the collaboration Node with the collaboration ID, source provider message/thread identity, subject/snapshot, `account_email`, and `shared_inbox_id` when applicable. It stores provider/Mango attachment references rather than raw bytes and preserves the originating mailbox for every later thread, attachment, reply, and send operation. Generic information/projection commands cannot replace, delete, or supplement that canonical block.
EMAIL56 - Email detail and Node detail are two surfaces over the same Node information rows. Both mount the shared `ChatPane`, parse and write the same `Text block chat` payloads, use the same `chat:node:{node_id}` reconciliation scope, and expose the same ordering, reply threading/indentation, collapse, deletion ownership, mention, attachment, link, and composer semantics; neither surface copies or translates chat messages into a second table. The Node attached-email viewer reads the participant-authorized collaboration thread/attachment APIs; direct provider mutation controls are disabled there, while shared-draft creation and sending remain on the Triage surface so they use the immutable source mailbox and revision claim.
EMAIL57 - A chat may be created with no selection or from selected text in any message card in the provider thread. A selection-backed chat stores `selection_source=email`, the exact provider message ID, the trimmed quote, and nonnegative start/end text offsets with `end > start`; opening or activating the chat navigates to that message and highlights the best exact quote/offset match without changing the underlying email body.
EMAIL58 - Chat replies store the existing parent-message ID and render beneath that parent with the shared Node chat indentation. The selection anchor belongs to the root/comment that captured it; replying does not silently retarget the anchor to the currently newest email or another message card.
EMAIL59 - A committed `@` mention of a company user adds that user exactly once as a permanent collaboration participant. A committed user-group mention resolves the group's current same-company user membership and snapshots each distinct resolved user as an individual participant in the same transaction as the chat write; invalid, deleted, or cross-company principals are rejected rather than partially shared.
EMAIL60 - Collaboration participation is append-only for the collaboration lifetime. Later group membership or hierarchy changes neither add nor remove participants, deleting a mention message does not revoke access, and repeatedly mentioning the same user directly or through overlapping groups is idempotent.
EMAIL61 - Every participant may open the complete collaboration thread and its provider-backed file/CID attachments from either the Triage or Node surface even when the participant was not To/Cc/Bcc and has no connection to the source mailbox. The backend authorizes permanent participation first, performs provider reads through the collaboration's immutable authorized source mailbox, revalidates exact message/thread membership before attachment bytes are returned, and never exposes its grant or credentials to participants.
EMAIL62 - Future messages that join the authoritative provider thread become visible to every participant as the same ordinary grouped email conversation. A personal-source collaboration appears in every participant's My Triage. A shared-source collaboration appears in its source Shared Triage for participants who can navigate that mailbox and appears in My Triage as the guaranteed fallback for permanent participants who cannot. Mango shares a permissioned virtual projection of the source thread; it does not send an auto-forward or create duplicate provider messages, and subject similarity never expands the collaboration.
EMAIL63 - A virtual collaboration row is deduplicated against a provider-owned row by immutable source mailbox plus provider thread/message identity. One conversation renders one card even when the participant is also a provider recipient or shared-inbox viewer; loaded messages, unread/starred/attachment state, and the collaboration badge/node identity merge without crossing scopes.
EMAIL64 - A nonparticipant cannot discover/list a collaboration row, perform source-mailbox provider reads, chat, draft, or obtain collaboration attachments by guessing a collaboration, Node, message, or draft ID. Participant authorization is checked before source-mailbox reads and participant operations. The existing company-admin/dev-admin bypass may still open the Node shell under the general resource contract, but it does not create participation, a triage row, source-mailbox access, mention delivery, or My Drafts visibility.
EMAIL65 - `Create Shared Draft` is an explicit action associated with Reply All on an exact source message. It lazily creates/reuses the collaboration, initializes recipients through the normal Reply All deduplication and active-mailbox exclusion rules, and creates at most one active shared draft for that collaboration/source-message pair.
EMAIL66 - A collaboration shared draft is a Mango application record, never a Nylas/Gmail provider Draft. Every permanent participant sees the same active draft in the Drafts/My Drafts view of either My Triage or Shared Triage, with source-mailbox context shown explicitly. Its immutable source identifiers, content, attachments, revision, and any uncertain send claim/idempotency state survive source-mailbox disconnect or deletion so participants can inspect and safely discard it under EMAIL68; source loss never silently converts it to another mailbox. Ordinary private personal and selected-shared-inbox drafts keep their existing scope and source-deletion behavior: removing their personal connection or shared inbox deletes those non-collaboration drafts.
EMAIL67 - Shared-draft reads and writes require current collaboration participation and carry a monotonically increasing revision. Update, send, and discard commands compare the expected revision; a stale command returns a conflict with the canonical current revision and must preserve the caller's unsent local content in the open composer for review/retry instead of overwriting another participant's change. When local and remote mirrors reconcile, the higher shared revision is canonical even if the rejected optimistic local edit has a newer browser timestamp, so stale content cannot hide the current shared version indefinitely.
EMAIL68 - Any permanent participant may edit, send, or discard the shared draft. Send is immediate-only in V1: the shared surface does not expose scheduled send and the browser scheduler never submits a shared draft. The backend atomically claims the exact expected revision, re-fetches the immutable exact source message, validates its provider message/thread identity, recomputes Reply All recipients from provider truth, and assigns one stable provider idempotency key plus its first-claim timestamp and exact source Nylas grant ID to that logical send. A claim is exclusive for five minutes. While `send_state` is `sending`, body/recipient edits and all collaboration-draft attachment upload-finalize, link, unlink, and other mutation paths are frozen; authorized reads remain available, ensuring every recovery attempt has the byte-equivalent body and attachment set. If the handler loses the provider response, receives a response without a message ID, or cannot durably complete after possible provider success, it does not release that uncertain claim; after five minutes, a retry takes a new repository claim token but may replay only the byte-equivalent send with the same provider idempotency key through the exact same grant, then atomically reconcile the sent message plus shared-draft tombstone. Any validation, provider-source read, or attachment-resolution failure before a recovered retry reaches Nylas leaves that recovered claim in `sending` and preserves the original key, grant binding, and first-claim timestamp; only a fresh claim may be released safely on those pre-provider failures. Because Nylas idempotency is grant-scoped, a reconnected/replaced source grant returns `email_draft_send_recovery_source_changed` with canonical inspect-then-discard guidance and performs no provider retry. An explicit non-409 provider `4xx` may release the claim because that request was rejected, and release clears the rejected key, grant binding, and origin timestamp so the corrected attempt uses a fresh key; transport errors, provider `5xx`, and idempotency `409` remain uncertain and recover through the stable key. Automatic replay is allowed only inside Nylas's fixed one-hour idempotency window measured conservatively from the first claim. Immediately before a recovered `SendMessage`, the backend performs a final deadline check and reserves the full configured Nylas outbound-request timeout as a safety margin; entering that margin returns `email_draft_send_recovery_window_expired`, keeps the exact uncertain claim/key/grant/origin, and makes no provider call. Because that check happens after renewing the five-minute claim, its response truthfully sets `can_discard=false`; discard becomes available only when the renewed lease ends. This final check applies only to recovered claims, never to a first attempt. Once that hour expires, the API returns the same canonical draft/revision guidance and must never generate a new key or automatically resend. After the five-minute active lease ends, a participant must inspect the provider thread first and may revision-check/discard the uncertain local draft whether the original source is unchanged, reconnected, or currently unavailable; local discard cannot send or duplicate provider mail. A new shared draft can then be created deliberately only after confirming no reply was sent. Discard removes only the draft for everyone and never deletes the collaboration, Node, chat, or provider thread.
EMAIL69 - Shared-draft attachments and inline images use the existing Mango attachment-reference and send-boundary rules. Durable chat/draft JSON contains no raw file bytes, data URLs, provider credentials, presigned URLs, or object-storage keys, and every participant read/mutation is reauthorized against the collaboration before attachment access.
EMAIL70 - Home subscribes to at most one mail-bearing mailbox: the selected connected personal account in My Triage or exact selected shared inbox. Multiple personal accounts never share a user-wide realtime scope. Shared root/headings/grouping rows/plain folders, Drafts, and non-mail views install no fallback personal scope, and navigation cancels obsolete timers/work and unsubscribes the old mailbox. Replacing shared-inbox metadata or callback objects without changing the exact company/scope does not recreate the subscription or repeat acceptance reconciliation; only an actual target/mailability change does.
EMAIL71 - Mailbox hint invalidation and delayed reconciliation are keyed by exact company, personal account/shared inbox, message, thread, folder/page request, and current mailbox request generation. Bursts coalesce; one signal arriving during an active read may queue one final read; a timer or response owned by mailbox A cannot refresh, invalidate, or overwrite mailbox B. A detail hint also captures the selected message/thread that made it relevant and rechecks that owner before a delayed or queued read, so switching selection cannot wake an unrelated new detail. Acceptance/hint reconciliation performs an authoritative refresh only for the exact affected folder, page, message, or thread key; it bypasses reusable cache entries, joins or queues behind same-key in-flight work rather than overlapping it, and an exact-key invalidation generation prevents a provider read begun before the hint from repopulating stale cache state.
EMAIL72 - Local fallback draft data is purged only for explicit authorization revocation or a definitively deleted/non-mail-bearing scope (`access_denied`, `company_access_denied`, `company_not_found`, `shared_inbox_not_found`, or `shared_inbox_not_mailbox`). Mango session `401`, unclassified `403`, provider reauthorization/disconnection `409`, service `5xx`, and network failure retain unsynchronized drafts in their exact company/user/personal-account/shared-inbox scope.
EMAIL73 - Each remote draft load owns one exact scope generation and local revision. It may replace only that scope and only while still current; an older load cannot overwrite a newer completed load, local save, local delete, remote save completion, another personal account, or another shared inbox. Returned values and the fallback mirror both reflect the current scope state.
EMAIL74 - An `email_draft` attachment can be created, linked, listed, sent, or read only while the exact owning draft still exists and is not deleted. Personal access is exact owner/account; legacy accountless personal IDs are live-draft owner-only read compatibility and never mutation authority; shared access uses the exact live inbox and current permissions. Compose creates the durable draft before attachment upload/link. Deleting a draft makes all draft-only attachment paths unreadable even to manager/admin bypass attempts, while an independently linked `email_message`/sent attachment remains readable through its own live authorization.
EMAIL75 - Every email conversion and local mail mutation retains one exact source mailbox request key. Personal My Triage drag payloads and `POST /v1/communications/triage/convert` carry normalized `account_email`; Shared Triage carries `shared_inbox_id` and suppresses any personal account parameter. Explorer, Kanban, project, and pin handoffs preserve that identity through the committed-result event, so one personal account cannot convert, unstar, archive, update, move, or delete through another account's grant.
EMAIL76 - Email collaboration chat is progressive disclosure in My Triage and Shared Triage. Selecting or opening an email keeps the email detail at its full available width and leaves the chat rail unmounted and closed by default; reading or highlighting text must not open it. Only the explicit, keyboard-operable **Chat** control opens the right-hand rail, exposes its expanded state accessibly, and reserves rail width. Closing the rail or selecting a different exact message, mailbox, or view removes that rail without creating, deleting, or otherwise mutating a collaboration, Node, chat, or shared draft.
EMAIL77 - An open email-collaboration chat header shows the collaboration's current durable participant roster. `collaboration.participants` is the only membership authority and each `user_id` contributes at most once: creator/direct-user rows render accessible person avatars from current same-company display data with a safe identity fallback, while rows whose immutable `added_via_type` is `group` may be represented together by one deduplicated group-provenance avatar/pill per `added_via_id`. A group pill's count comes only from those snapshotted participant rows and its current group record supplies only a display label. Current group membership/hierarchy never recalculates the roster or access, and a renamed, missing, or deleted group label never removes the represented users. Before a collaboration exists, the open header may label only the current actor as the prospective creator without performing a durable write. A committed mention refreshes the canonical collaboration so the newly added durable participants appear in the open email-chat header without relying on mention text or provider recipients. This roster header is an email-surface adapter; EMAIL56 still shares the durable ChatPane data and semantics without requiring an unchanged standalone-Node caller to fetch or display collaboration participants.
EMAIL78 - Collaboration ensure/create and the first chat write have explicit retry-safe failure behavior. A failed ensure transaction leaves no partial Node, attached-email projection, permission, participant, or collaboration; a failed subsequent chat write leaves any already committed empty collaboration reusable under EMAIL52 but removes the failed optimistic chat row. The open composer preserves the user's typed text, selected mention principals, reply target, and email-selection anchor, re-enables submission, and permits a deliberate retry against the same exact source. My Triage and Shared Triage translate `failed_to_create_email_collaboration` and `email_collaboration_storage_not_ready` into concise actionable text; either identifier may support diagnostics but must not be the sole user-facing error, while other provider/authorization failures retain their established error handling.
EMAIL79 - An email viewed inside a Node uses the canonical provider/Mango message-detail attachment metadata from its retained message, thread, and mailbox identity. Only attachments whose normalized Content-ID is actually referenced by the rendered body are omitted from the separate attachment list; a normal file carrying an unreferenced Content-ID remains discoverable with filename, MIME type, size, authenticated download, and safe image preview. Conversion and direct attach persist references and provenance, never a second attachment model or provider bytes.
EMAIL80 - The exact saved personal-account or shared-inbox signature is applied once whenever a user starts New compose, Reply, or Reply All in My Triage, Shared Triage, or an attached-email Node viewer. Send waits for an outstanding exact-scope signature read and applies it to the flushed submitted body before provider submission. Late signature hydration appends to the live draft without replacing user edits; rerender, reply-mode changes, autosave, and draft restoration do not duplicate it. Signature images remain Mango attachment references and the settings editor hydrates their authenticated preview without public storage URLs.
EMAIL81 - Once opening an unread message has queued its exact-scope provider mark-read command, changing mailbox tabs, search, unread-only state, Home view, or active mailbox may detach that command from visible UI state but must not silently cancel the captured provider mutation. The completion may update only its captured company/user/account-or-shared-inbox, list filter, and selection generation. If a terminal user/session transition suppresses the command, its ownership token and optimistic overlay must be released rather than left as false read state.
EMAIL82 - Folder metadata belongs to the exact company plus personal-account/shared-inbox scope, not to message-list presentation filters. Changing Primary/Starred/Sent, search, or unread-only state neither invalidates an in-flight folder response nor requires a replacement folder request. Changing the exact mailbox scope invalidates old folder ownership, and acceptance/webhook refresh still permits one active load plus one queued final load for the destination scope.
EMAIL83 - A canceled caller waiting on a same-key backend folder/page/detail provider read returns promptly without canceling the shared leader needed by other callers. The canceled caller releases its generation admission while the shared leader retains admission until the provider operation finishes, and only the still-current exact generation may populate cache state.
EMAIL84 - The exact-account read-receipt cutover handles legacy personal summaries explicitly. A legacy `receipt_scope_id = user_id` row is merged into `user_id:normalized_account_email` only when that user has exactly one stored personal email connection; existing exact rows retain the strongest status, complete signal history, and timestamp bounds. Zero-account or multi-account legacy rows are deleted as an intentional ambiguous-history reset rather than retained as unreachable shadow data. The repair is a new idempotent forward migration that sorts before the separately committed legacy drop on fresh installs and still runs when that drop is already ledgered.
EMAIL85 - A signed shared-mailbox webhook is acknowledged only after exact cache invalidation and either successful current-audience publication or a legitimate no-subscriber/no-authorized-recipient result. Resource-existence or audience lookup failure is retryable: webhook deduplication is released and the handler returns failure so the provider may redeliver. A retried `message.opened` payload retains its first receipt timestamp, and an identical signal timestamp cannot increment the stored receipt twice. Publication-time authorization is deadline-bound, limited to locally subscribed users, and remains fail-closed.
EMAIL86 - Draft attachment preparation and the subsequent upload/link form one per-draft mutation lease. Empty-draft cleanup may run after concurrent work only when the last lease ends and every mutation in that group failed; one failed inline image must never delete a durable draft another upload/link still uses, and a successful mutation prevents later failure cleanup from deleting its resource.
EMAIL87 - A multi-message email detail exposes a clear conversation-order control with Newest first as the default and Oldest first as the alternate. Ordering is deterministic, changes only presentation order, preserves exact-message actions/body loading and expansion state, and does not alter provider/thread identity or mailbox list ordering.
EMAIL88 - Personal-account and shared-inbox signatures use a practical-height unified editor with explicit Edit and Preview modes. Durable signature-image references survive sanitization and insertion, and the signature editor, preview, and compose body eagerly hydrate those images through the existing authenticated `email_signature`/draft attachment paths without public URLs or raw stored bytes.

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
- Every draft operation and attachment authorization uses one immutable exact scope. Personal owner and shared view/edit distinctions hold; cross-scope known IDs cannot expose content or mutate scope, spoofed shared account data is ignored, and stale browser mirrors cannot reappear as another scope's drafts.
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
- Opening Drafts makes no provider message-list request. Its ordinary private branch shows only the authenticated personal user/account or selected shared inbox according to view/edit permissions; the explicit collaboration branch adds only active drafts for which the current user is a permanent participant and labels the immutable source mailbox.

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
- The first nonempty chat submit converges on one private standalone Node keyed by exact mailbox scope and provider thread/message identity; a later chat-write failure leaves that idempotent collaboration reusable rather than duplicating it on retry.
- A failed ensure leaves no partial durable collaboration artifacts; either failure preserves the typed composer context, removes any failed optimistic row, re-enables retry, and translates `failed_to_create_email_collaboration` or `email_collaboration_storage_not_ready` into actionable text.
- The Node has one source-scoped attached-email projection and no Logic Gate, project, status, priority, GVIC, or other work assignment.
- Email detail and Node detail render the same durable chat IDs through the shared ChatPane and Node chat scope, including identical reply indentation, attachment, mention, link, delete, and refresh behavior.
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
- Group membership changes and a new provider message later joins the same thread.

Expected:
- The accepted chat write snapshots each distinct current same-company user once and grants permanent collaboration participation/edit access.
- Later group changes, mention deletion, and duplicate mentions neither revoke nor duplicate participants.
- Before creation the open email-chat header shows only the current actor as prospective creator without writing anything. After creation it represents every canonical participant `user_id` once through a creator/direct-user avatar or a group-provenance cohort; group counts come from participant rows rather than current membership, and a missing group label does not drop represented users. The unchanged Node caller still shares the underlying durable ChatPane data under EMAIL56 without being required to render this email-specific roster adapter.
- Every participant can read the complete canonical source thread without receiving provider credentials or an auto-forwarded provider copy.
- Personal-source collaboration appears in each participant's My Triage. Shared-source collaboration appears in its Shared Triage where navigable and in My Triage for a participant who cannot navigate that shared mailbox.
- A participant who is also a provider recipient sees one row, because the virtual and provider-owned representations dedupe by exact source scope plus provider thread/message identity.
- The later authoritative thread member appears for all participants; similar subject text in another thread or mailbox does not join the collaboration.

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
- A wrong user/account, revoked shared viewer, company manager, or company administrator attempts draft-scoped access.

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
- Both Node entry paths reopen canonical message detail under the originating mailbox grant; the PDF appears with name, type, size, preview when safe, and authenticated download, while the body-referenced CID image is not duplicated in the separate list.
- No provider bytes or duplicate attachment metadata are stored in the Node projection.
- New compose and Reply/Reply All across My Triage, Shared Triage, and the Node viewer receive the exact mailbox signature once.
- Late hydration preserves typed text, draft restore and mode switches do not duplicate the signature, and the settings image preview uses the authenticated Mango attachment path.

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

### Scenario EMAIL-S20: Conversation Order And Signature Image Preview

Business logic covered:
- EMAIL80
- EMAIL87
- EMAIL88

Given:
- A conversation has several sent and received messages with deterministic timestamps.
- The exact mailbox signature includes a durable Mango attachment image.

Expected:
- The detail opens Newest first, the user can select Oldest first, and exact-message actions/loading remain attached to the same messages.
- Opening signature settings provides a practical editor plus explicit sanitized Preview, and switching modes does not change mailbox scope or saved content.
- The signature image appears in settings preview and after insertion into compose through authenticated eager hydration.
- No signature path stores public object URLs, data URLs, provider secrets, or attachment bytes in the rich body.
