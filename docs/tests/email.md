# Process Story: DEV cutover collapses only safe legacy job metadata

With old API and email writers stopped, the read-only PostgreSQL 17 preflight reports only aggregate duplicate counts: groups, exact redundant rows, inactive-status violations, synthetic cutover completions, conflicting Mango/provider thread identities, and foreign-key references
↓
The preflight says READY only for a coherent legacy schema whose duplicate rows are all completed or failed, agree on every nonempty thread identity, and have no foreign-key dependents; final-schema duplicates and every unsafe state remain STOP
↓
The one human-run transaction locks the three cutover tables and rechecks every shape and data gate before its first write
↓
For each safe legacy identity, one permanent marker wins deterministically: genuine completion before failure before synthetic cutover completion; within that class a row carrying the agreed thread metadata wins, followed by earliest creation time and ascending UUID
↓
The transaction deletes exactly the reported redundant `email_ingestion_jobs` metadata rows, asserts that no duplicate remains, and leaves email threads, messages, attachments, and attachment relationships byte-for-byte unchanged
↓
Only then does the transaction finish the SQS schema conversion and create the exact unique stable-identity index; a final-schema rerun safely preserves the same data and final contract

Last updated: 2026-08-09

# Process Story: New mail crosses SQS once and realtime follows durable truth

A signed Nylas `message.created` webhook resolves the exact permanent personal or shared email connection
↓
Mango creates or finds one permanent connection/provider-message job identity, sends that compact identity to the encrypted FIFO queue, and returns success only after SQS accepts it
↓
One private worker receives one item with a fixed ten-minute visibility window and an eight-minute attempt deadline; it never claims batches, extends visibility, or polls PostgreSQL for work
↓
The worker atomically starts one provider attempt with an exact token, stores provider truth and typed relationships, and refuses a fourth provider-processing start
↓
After the email result commits, Mango must durably insert the required realtime outbox row before deleting the SQS message
↓
Valkey publication remains asynchronous: a Valkey outage does not repeat provider work, because the committed outbox row is recovered by the existing realtime spine
↓
Temporary failure leaves the SQS item undeleted for AWS redelivery; permanent account failure parks only the exact connection; work reaching the DLQ waits for deliberate operator review

Last updated: 2026-08-09

# Process Story: Background archive completion is read, not pushed

An accepted background archive request creates one permanent exact-message marker and sends one compact SQS unit
↓
The worker archives that exact provider message and settles only with its exact attempt token
↓
The archive job and item rows remain the canonical completion or failure record
↓
The browser observes that state through the canonical archive job read; the worker publishes no communications WebSocket completion event

Last updated: 2026-08-09

# Process Story: New mail appears live and picker selections always have a durable identity

A Nylas webhook is accepted only after its compact stable job reaches SQS; the worker later commits provider truth and its narrow mailbox hint to the shared realtime outbox
↓
The exact active My Triage or Shared Triage browser receives that hint, invalidates the exact mailbox cache, and reloads the visible message list and folder counts
↓
The Universal picker searches Mango's stored email first so useful local matches paint immediately, then always reconciles the same mailbox/query with Nylas
↓
Stored and provider results merge by exact mailbox-scoped provider message ID, preserve a known Mango `email_message_id`, and collapse with the same thread helper used by My Triage and Shared Triage
↓
If a chosen provider result has not yet been stored, Mango synchronously ingests that exact authorized message and returns its durable `email_message_id`
↓
The existing typed Node or Project attachment command receives that durable identity; provider failure leaves already-painted stored mail visible and never invents a relationship

Last updated: 2026-08-09

# Process Story: Email chat waits for the first real message before creating records

A user opens one exact personal or shared email thread and highlights text in one exact message
↓
The highlight first offers a chat action; clicking it opens the one thread-level chat rail with the exact quote and offsets
↓
If the owning Node has no linked text box, Mango shows a temporary preview and writes nothing while the user reads, edits, closes, or clears the quote
↓
The first nonempty send atomically creates the Node text box, exact message-to-textbox relationship, and chat, or rolls all three back
↓
Every stored email thread remains owned by at most one Node, the chat belongs to an exact Node text box, and later chat/history reads use the durable records

Last updated: 2026-08-08

# Current Email Business Logic Laws

1. Email exists to make it easy to distribute messages into useful Nodes, discuss those messages in useful Node text boxes, and prepare shared drafts with the people who share that work.
2. Selecting a Node in the email Universal Linker adds the email to that existing Node.
3. Selecting a Logic Gate immediately creates a new email Node in that Logic Gate with priority **Not Assigned**.
4. Selecting a Project requires one Project Logic Gate choice, then creates a new email Node there with priority **Not Assigned**.
5. One stored email thread may belong to only one Node. A second Node relationship for the same stored thread is rejected.
6. Every email chat belongs to one exact Node text box. Mango does not create unlinked email chats.
7. A Node text box may link to one exact email message or one whole email thread. A whole-thread link links every stored message in that thread to the same text box.
8. An email chat may quote highlighted text from an exact linked email message and stores that message ID, quote, and offsets on the text-box chat.
9. Highlighting email text only shows the **Turn highlighted email text into a chat** action. The quote enters the composer and the chat rail opens only after that action is clicked.
10. My Triage and Shared Triage show one chat rail for the whole email thread, with visually separated sections for linked email messages.
11. If the email already has a linked text box, a new chat is appended there. If its Node exists without a linked text box, Mango previews the new text box and creates the text box, exact email link, and chat together only when the first chat is sent. If no Node exists, Mango creates a floating Node, text box, email link, and chat without a Node popup.
12. The email thread header owns the one chat toggle. Individual messages do not show chat buttons or overflow menus.
13. The email chat header shows only the Node icon and Node name.
14. Dragging an exact email message onto a Node text box links that message. Dragging an attached thread links all stored messages in that thread.
15. Shared drafts retain their exact email account and stay available to authorized collaborators through the same email/Node work context.
16. Clearing a highlighted-email quote or closing its unsent chat rail cancels the temporary chat and text box without creating or deleting database rows.

Last updated: 2026-08-08

# Process Story: A selected email can reference, link, float, chat, and stay visible

A user opens a message in My Triage or Shared Triage
↓
The toolbar offers a separate Node-plus floating-Node action and opens the shared universal picker in `##` link mode
↓
With an empty picker search, Backspace changes to `#` reference mode and `#` changes back to link mode; a pointer press outside the popup dismisses it without selection
↓
Reference opens the exact chosen Node, Logic Gate, Project, or email message without changing the email; link uses the existing exact typed email placement commands
↓
An existing Node is reused, while a Logic Gate or Project choice creates a new email Node and completes the established priority and placement rules; floating success shows its green notice left of the button before the Node indicator appears
↓
The one thread-header chat toggle opens and closes the chat column; selecting a conversation never opens it automatically
↓
In the Node, the email column stays fixed below the toolbar while the text-box timeline scrolls, and the email column scrolls its own content

Last updated: 2026-08-07

# Process Story: New Inbox mail is stored and inherits existing Node placement

An email connection becomes eligible for ingestion at its stored `ingestion_started_at` boundary
↓
Signed Nylas `message.created` webhooks normally enqueue the exact provider message into SQS; explicit selected-message imports may enqueue the same stable identity, and rare EventBridge reconciliation repairs a missed webhook
↓
The worker rejects pre-boundary or non-Inbox discovery messages, then reconciles the complete real provider thread available in that mailbox without copying an already-complete Mango message
↓
An unknown thread is stored with no Node relationship; a known thread's newly completed messages receive only the thread's missing Node-wide relationships
↓
My Triage and Shared Triage remain provider-owned lists, while their stored-message placement enrichment shows the Node icon and opens the already-updated Mango thread
↓
Permanent grant/configuration failures park only the exact connection; same-connection reauthorization preserves the activation boundary and checkpoint, and rare bounded reconciliation never recreates an existing stable job identity

Last updated: 2026-08-09

# Process Story: Email collaboration creates a standalone Node

A user starts the first chat on an unassociated personal or shared email
↓
Mango atomically creates or reuses the exact mailbox/thread collaboration Node, attached-email link, chat ownership, participants, creator Edit permission, and creator Responsible RACI
↓
The Node remains authoritative in Node and email relationship storage with no `company_explorer_items` row and no Unfiled/Nodes folder
↓
Later Project or Logic Gate organization uses the existing typed relationship commands, while standalone search returns the accessible Node with an empty location path

Last updated: 2026-08-06

# Process Story: Exact mailbox email stays scoped and visibly stable

Jonat opens My Triage or Shared Triage and selects text in an email. The selection shows a chat action without opening the rail or filling the composer. Clicking that action opens the one thread-level chat rail and places the exact quote in the composer. If the thread has no Node association, the first nonempty comment creates one floating Node with priority **Not Assigned**, no Logic Gate, and one exact linked text box. The thread may not be associated with another Node. The hashtag destination bar shows only `Create floating node (a node without a Logic Gate)` while blank, then searches Nodes, Logic Gates, and Projects as soon as text is entered.

Alice opens a three-message conversation through her personal email account. My Triage still reads its list from Nylas, but listing a visible post-activation Inbox row also prioritizes that exact message for durable ingestion. Mango validates the trigger, reconciles the complete real provider thread available to Alice, and stores it under the exact connection-scoped `email_threads` row. If Alice later attaches the thread to a Node, Bob can open the stored email through that Node only when normal Node permissions allow it. A later Inbox reply is appended automatically and receives the same Node-wide placement without re-copying completed siblings. If the relationship is removed later, a preserved chat quote remains, but opening the complete stored email requires another surviving relationship or direct access through Alice's exact personal email account. Alice's reply remains a separate `email_drafts` row tied to Alice's original personal email account. Disconnecting that account keeps the email draft and signature but makes them unsendable until the same account reconnects. Real stored files live in `attachments`, and `attachment_relationships` connects them to the message, email draft, signature, chat, or ordinary resource that actually owns the file.

A shared email account follows the same activation, Inbox, reconciliation, retry, and exact-connection rules. Shared Triage remains a provider-owned list; automatic ingestion creates durable V3 thread/message/file rows, and an existing Node placement controls attached access. Mango never guesses or merges across accounts.

When Alice stars a My Triage row—or a teammate stars a Shared Triage row—the successful exact-mailbox command remains visible across a stale provider refresh. Mango overlays that committed star or unstar only in the matching personal or shared email account until a newer exact-scope settlement arrives. If the visible row was loaded before its source-scope key was attached, the committed response updates that unscoped row; only a row with an explicit different mailbox scope is protected from the update.

The development V3 email copy has now completed. The read-only preflight reported `READY_TO_COPY`, and the complete Step 2 file committed in DBeaver as one plain PostgreSQL transaction. It created 223 threads, 678 messages, 228 email relationships, 49 email drafts, 9 signatures, and 1,134 attachment relationships. The file does not depend on `psql` backslash commands or separately included files.

The 1,134 attachment-relationship count is the historical email-copy checkpoint. The later attachment-wide consolidation and approved cleanup reconciled the current final attachment model to 1,080 relationships; those counts describe different rollout gates.

The copy found 213 old file links whose email draft, email message, or attached-email relationship no longer exists. Mango treated those links as orphan evidence: the email migration did not invent a replacement owner or create a broken `attachment_relationships` row. The later, separately approved attachment cleanup exact-verified and removed those broken legacy links, then deleted only files proven to have no surviving valid owner.

The application cutover is implemented for durable email data: automatically ingested and explicitly imported email threads/messages, relationships, jobs, drafts, signatures, files, chats, realtime events, recycle-bin references, and backup ordering use the final V3 contracts. Ordinary personal and shared mailbox lists remain provider-backed and never manufacture list rows from storage. The ten retired `communications_email_*` source tables are absent from the canonical schema and must not be restored. Node attachment/access always uses the exact `email_relationships.email_message_id`; textbox propagation is intentionally outside this ingestion phase even though a deliberate textbox link may still carry `resource_textbox_id`.

Last updated: 2026-08-06

# Email Tests

Coverage Status:

- Business Logic Covered By Scenarios: The V3 schema, data-copy checkpoint, final-delta rerun, application cutover, deployment, smoke checks, and legacy email-table retirement are complete in development. The scenarios below cover provider-backed mailbox reads without list-time persistence, webhook/SQS automatic ingestion, selected-message imports, internal message IDs, exact account scope, ordinary resource permissions, normalized file ownership, relationship-only deletion, durable draft send recovery, and read-only schema readiness.
- Exact mailbox hardening is covered by `homeMailboxRealtime.test.ts`, `homeUtils.test.ts`, `unifiedRichEditorContract.test.ts`, `communications_singleflight_cancellation_test.go`, `realtime_audience_hardening_test.go`, `nylas_webhook_receipts_test.go`, and focused communications/store tests for retry-safe open receipts and exact-account migration ordering.
- Business Logic Covered By Automated Tests: Partial (`tests/frontend/pages/home/homeCommands.test.ts` covers send payload construction, Mango attachment references, and mailbox-scoped signature save ordering; `tests/frontend/pages/home/homeMailboxRealtime.test.ts` covers exact active targets, first/reconnect acceptance, event mapping, coalescing, queued-final work, and navigation cancellation; `tests/frontend/pages/home/homeMailDrafts.test.ts` covers provider/auth error retention versus exact revocation purge, out-of-order loads, local save/delete fencing, multiple personal accounts, and live-draft preparation before attachment upload; `tests/frontend/modules/editor/richTextEditing.test.ts` and `unifiedRichEditorContract.test.ts` cover rich email behavior. Backend communications/realtime/attachment tests cover exact mailbox routing, provider send boundaries, S3 attachment resolution, live email-draft attachment authorization, deleted-draft denial, sent-message survival, and durable inline-byte rejection. Broader mounted compose/signature endpoint coverage remains partial.)
- Outbound attachment tests in `backend/internal/http/communications_handlers_test.go` and `backend/internal/http/nylas_client_test.go` cover early validation, tenant/link authorization, the complete metadata limit preflight, lazy exact-length multipart streaming, inline CID fields, cancellation, provider rejection, and body cleanup.
- Mailbox query-mode tests in `backend/internal/http/communications_handlers_test.go`, `backend/internal/http/nylas_client_test.go`, and `tests/frontend/modules/communications/communicationsApi.test.ts` cover exact Google Primary bucketing, native/structured parameter exclusivity, thread precedence, preview-only response normalization, Primary cache-overlay exclusions, and exact-scope committed star state across stale personal/shared refreshes.
- The additive V3 email schema and operator SQL safety contract are covered by `backend/internal/store/v3_email_migration_test.go`. The full create/copy script was run twice against a disposable PostgreSQL 18 database, followed by a forced-drift rollback test. Jonat then ran the development preflight and Step 2 successfully: 223 threads, 678 messages, 228 email relationships, 49 email drafts, 9 signatures, 1,134 copied attachment relationships, and 213 proven orphan attachment links intentionally omitted.
- Canonical thread reconciliation, authored-only quote extraction, timeline affordances, and Reply All focus are covered by `tests/frontend/modules/communications/emailThreadMessages.test.ts`, `tests/frontend/modules/communications/emailQuotedContent.test.ts`, `tests/frontend/modules/editor/emailViewerContract.test.ts`, and `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts`; recipient deduplication/mailbox exclusion by `tests/frontend/modules/communications/emailRecipients.test.ts`; explicit reply/forward draft identity by `tests/frontend/pages/home/homeMailDrafts.test.ts`; faithful sanitized forwarding and attachment copying by `tests/frontend/pages/home/emailForwarding.test.ts` and `tests/frontend/pages/home/homeCommands.test.ts`; calendar event-detail/RSVP request construction by `tests/frontend/modules/communications/communicationsApi.test.ts` plus backend calendar/Nylas handler tests; and honest grouped receipt presentation by `tests/frontend/pages/home/emailReadReceipts.test.ts`.

- Automatic signature insertion, rich-body deduplication, signature-only draft detection, mailbox scope keys, and personal/shared signature request scope are covered by `tests/frontend/pages/home/homeCommands.test.ts`, `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts`, and `tests/frontend/modules/communications/communicationsApi.test.ts`.

## Business Logic

### Approved V3 Email Storage And Access Contract

These are the implemented rules for the V3 email cutover. The schema, data copy, backend cutover, and required frontend ID changes are implemented in the repository. If an older `EMAIL` rule below names a legacy table, collaboration participant, `created_from_email`, composite file resource ID, or account-agnostic “mailbox” scope that conflicts with a `V3EMAIL` rule, the `V3EMAIL` rule is authoritative and the older rule is historical only.
#### Implemented application behavior

- My Triage and Shared Triage list/detail reads come from the exact Nylas email account and do not write `email_threads` or `email_messages`. Only an explicit user action that attaches an email to a Node, Project, Logic Gate, or textbox—or creates a resource from that email—stores the selected message and queues deliberate thread/file import into the V3 tables. Provider refresh, webhook, read, update, archive, restore, and delete paths never create durable email rows.
- Direct access requires the exact personal email account or shared email account. Attached access requires one `email_relationships` row for the exact internal `email_message_id` plus ordinary permission to the Node, Project, or Logic Gate. Special collaboration ownership and participant authorization are gone.
- Chat selections and relationship file access use internal `email_message_id` values. Provider message IDs remain provider-operation metadata only. Removing a relationship removes only that relationship and its derived access; stored email, preserved chat quotes, email drafts, signatures, and files remain.
- Email drafts use their stable `draft_id`, keep the exact original email account and safe-send state, and soft-delete instead of disappearing. Relationship deletion sets their relationship reference to null. Disconnected accounts keep drafts and signatures but cannot send or apply them until that exact account reconnects.
- `attachments` stores file facts and `attachment_relationships` stores file ownership. Incoming files target `email_message`, outgoing files target `email_draft`, signature images target `email_signature`, and chat files target `node_chat_message`. Provider JSON never supplies file bytes, storage keys, or authorization, and files never target an email relationship.
- Startup performs a read-only final-schema readiness check. Requests and workers never create, alter, drop, or repair schema.
- Development operators paused every deployed email writer, reran Step 1 and Step 2 for the final delta, confirmed `READY_FOR_BACKEND_CUTOVER_REVIEW`, deployed, and smoke-tested the cutover. Another environment must repeat that exact order. The database snapshot and agreed soak period still precede separately approved old-table retirement.

#### Terms and account scope

V3EMAIL1 - New business and migration prose says **personal email account** or **shared email account**. The word “personal” is not used alone. Literal old code, database, API, UI, and test identifiers may retain words such as `mailbox`, `scope_type`, or `shared_inbox_id` until the cutover removes or renames them.

V3EMAIL2 - Every stored email thread is scoped to exactly one personal email account or shared email account. The row is Mango's copy as seen through that email account; the row does not own the worldwide conversation.

V3EMAIL3 - The same outside conversation viewed through two different email accounts produces two different Mango thread records. Mango never merges cross-account copies by subject, participants, provider ID, RFC Message-ID, body, snippet, or time.

V3EMAIL4 - A personal email account thread keeps its exact user/account identity. A shared email account thread keeps its exact shared-inbox/company-connection identity. Disconnecting the provider grant does not erase that durable origin identity.

#### Threads, messages, and the three-message example

V3EMAIL5 - The four permanent email content tables are `email_threads`, `email_messages`, `email_relationships`, and `email_drafts`. Email drafts are a fourth table because their edit/send lifecycle is different from stored received or sent messages.

V3EMAIL6 - Merely listing or opening a provider conversation stores nothing. After an explicit resource import completes, one conversation with three imported messages produces one `email_threads` row and three `email_messages` rows for that exact email account. Every stored message belongs to exactly one stored thread, including a one-message conversation.

V3EMAIL7 - `email_message_id` is Mango's internal permanent message ID. Provider message and thread IDs remain origin metadata and may not substitute for internal IDs in relationships, chats, permissions, or file ownership.

V3EMAIL8 - Stored messages preserve immutable email HTML, text fallback, subject, snippet, timestamp, sender, To, Cc, Bcc, Reply-To, folders, provider identity, stable order, and download completeness. Empty body or empty Bcc is valid data, not automatic evidence of an incomplete row.

V3EMAIL9 - Existing normalized content is preferred. A retained legacy snapshot with no normalized row may create a partial message using its proven subject, sender, snippet, and date. Missing body fields remain empty and the row remains incomplete rather than inventing content.

#### Email relationships

V3EMAIL10 - `email_relationships` connects one exact internal message to a Node, Project, or Logic Gate, optionally at one textbox. It replaces old collaboration, conversion, placement, and Node-thread association tables.

V3EMAIL11 - In the three-message example, explicitly attaching message 2 to a Node first stores that selected provider message and creates one relationship for message 2. The deliberate download job may then add the remaining current thread messages to the same stored thread; it never duplicates the thread or its messages.

V3EMAIL12 - A whole-resource relationship has a null textbox ID. A textbox relationship contains the exact textbox ID, and the database verifies that the textbox belongs to the selected resource type and resource ID.

V3EMAIL13 - A message may have several relationships only inside the one Node that owns its stored thread, including one whole-Node relationship and textbox-specific relationships in that Node. A second Node for the same stored thread and duplicate company/message/resource/textbox relationships are rejected.

V3EMAIL14 - Preserve the old Attached-email information ID as the new relationship ID where possible so deep links and saved identities remain stable.

V3EMAIL15 - An email relationship contains no `email_id`, `created_from_email`, `attached_by_user_id`, `collaboration_id`, special Node-conversion flag, or separate Node/Project/Logic Gate ID columns. Resource type plus resource ID is the relationship.

V3EMAIL16 - An email-derived Node is an ordinary Node with ordinary permissions plus an email relationship. Creating it is one ordinary Node creation followed by one relationship creation.

V3EMAIL17 - Deleting a relationship removes only that connection and its relationship-derived access. It never deletes the stored thread, message, email draft, signature, or Mango-stored file.

#### Permissions and sharing

V3EMAIL18 - `resource_permissions` continues to grant access to Nodes, Projects, and Logic Gates. Email thread IDs and message IDs are not added as new `resource_permissions` resources or as a new polymorphic ID column.

V3EMAIL19 - Direct stored-email access comes from the exact personal email account or shared email account that the thread belongs to.

V3EMAIL20 - Attached stored-email access comes from an `email_relationships` row plus normal permission to its Node, Project, or Logic Gate.

V3EMAIL21 - A resource-shared email draft receives shared access from its relationship's resource. An ordinary email draft receives access only from its exact original personal email account or shared email account.

V3EMAIL22 - The special `communications_email_collaboration_participants` permission system is removed after every kept participant has equivalent normal resource permission. There is no replacement email participant table.

V3EMAIL23 - Realtime audiences for relationships and resource-shared email drafts are derived from the related resource and normal permissions, never from the retired collaboration participant table.

#### Chats and deletion behavior

V3EMAIL24 - The completed `node_textbox_chats` cutover remains authoritative and is not recopied or changed as part of email data cleanup.

V3EMAIL25 - A chat email selection stores the exact internal `email_message_id`, not a provider ID, provider thread ID, relationship ID, or old Attached-email information ID standing in for the message.

V3EMAIL26 - If a chat preserves a quote from an email and the email relationship is later removed, the chat text and quote remain.

V3EMAIL27 - After that relationship is removed, the user may open the complete email only through another surviving relationship or direct access through the exact personal email account or shared email account.

V3EMAIL28 - If approved migration cleanup removes a selected old source, preserve the chat text/quote and clear or detach only the full-email reference. Never delete the chat for that reason.

V3EMAIL29 - Deleting a Node, Project, Logic Gate, textbox, chat, or email relationship does not delete the normalized thread, message, email draft, signature, or normalized incoming-email file.

#### Email drafts

V3EMAIL30 - Every email draft always belongs to exactly one original personal email account or shared email account.

V3EMAIL31 - An ordinary email draft has a null `email_relationship_id`. A resource-shared email draft has one `email_relationship_id`. There is no `email_draft_relationships` table.

V3EMAIL32 - Many email drafts may point to one relationship, but one email draft may point to at most one relationship.

V3EMAIL33 - Deleting the relationship sets the email draft relationship to null. The email draft remains and falls back to access through its exact original email account.

V3EMAIL34 - Disconnecting a personal email account or shared email account keeps its ordinary and resource-shared email drafts, soft-deleted email drafts, and files. Those drafts are unsendable until the exact same email account reconnects. Mango never switches the email draft to another account.

V3EMAIL35 - Keep active and soft-deleted email drafts during V3. Preserve compose/reply/forward kind, addressing, body, schedule, source and sent-message identity, revision, deletion time, and creator/updater information.

V3EMAIL36 - Keep send claim, lease, revision, grant, and idempotency state. Retried or recovered work must not send an outside email twice.

V3EMAIL37 - Reply and forward email drafts keep enough normalized source-message context to reopen and send safely. A source message used by a kept email draft cannot be discarded by general email cleanup.

V3EMAIL38 - Email draft IDs remain stable text IDs. The V3 copy preserves existing IDs instead of inventing UUID-only replacements.

#### Signatures

V3EMAIL39 - Rename `communications_email_signatures` to `email_signatures` and keep every current signature.

V3EMAIL40 - Each signature belongs directly to exactly one personal email account or shared email account. There is no signature relationship table and there is at most one default signature for each exact email account.

V3EMAIL41 - Disconnecting an email account keeps its signatures, but Mango may not use them for sending until that same account reconnects.

#### Attachments

V3EMAIL42 - `attachments` is the actual Mango file table. `attachment_relationships` is the only ownership table; the retired `resource_attachments` table must not be recreated.

V3EMAIL43 - `attachment_relationships` is the only authority for which Mango record a real stored file belongs to.

V3EMAIL44 - Incoming-email files target `email_message` plus the internal `email_message_id`. Email draft files target `email_draft` plus `draft_id`. Signature images target `email_signature` plus signature ID. Node chat files target `node_chat_message` plus chat ID. Ordinary resource files target their Node, Project, or Logic Gate.

V3EMAIL45 - A file never targets an `email_relationship_id`. Removing a relationship therefore cannot remove or orphan the normalized message's stored file.

V3EMAIL46 - `email_messages.attachment_metadata` may contain provider-only data needed to locate or download a provider part. Provider metadata does not prove Mango stored a file when no `attachments` row and `attachment_relationships` row exist.

V3EMAIL47 - File bytes, object-storage keys, hashes, and file authorization never come from message JSON.

V3EMAIL48 - Legacy structured attachment resource IDs are decoded using the application's exact URL-decoding behavior before mapping. Similar-looking raw strings are not assumed equivalent.

#### Schema ownership and rollout safety

V3EMAIL49 - API requests, background jobs, and first-use code never create, alter, or drop database schema. Remove `ensureCommunicationsEmailDraftsSchema()` and every request-time DDL path.

V3EMAIL50 - Reviewed operator-controlled SQL is the only V3 schema writer. Backend readiness may run a read-only schema check and fail clearly, but it never repairs schema.

V3EMAIL51 - The normal application database role should not have DDL permission. A separate operator migration role performs reviewed schema changes.

V3EMAIL52 - The email migration is three operator-gated steps: read-only count/preflight; separately operated create/copy/recount/reconcile; then backend cutover only after the data checkpoint passes.

V3EMAIL53 - Step 1 reports exact schema, source counts, unique identities, overlaps, exceptions, foreign-key dependencies, email-account evidence, permissions, email draft/signature/file references, chat selections, and destructive candidates without printing email content or secrets.

V3EMAIL54 - Step 2 uses deterministic batches, stable ordering, checkpoints, exact conflict checks, and one disposition per source row. A rerun accepts an exact prior copy and rejects different data under the same ID.

V3EMAIL55 - A failed batch or count drift rolls back that subphase and leaves preserved legacy sources unchanged. Legacy tables are not dropped during copy or backend cutover.


V3EMAIL56 - In 28 retained Node pairs, the collaboration projection's old `block_id` equals its own Attached-email information ID. That value is an old relationship marker, not a textbox ID. It maps to a whole-Node relationship with a null `resource_textbox_id`.

V3EMAIL57 - Each of those 28 pairs has exactly one collaboration row and one `created_from_email` row for the same personal email account, message, Node, and whole-resource target. Step 2 keeps the collaboration Attached-email information ID as the final relationship ID, maps both source rows to it in the audit ledger, and does not delete either old row.

V3EMAIL58 - The cleaned development source has 256 retained projection rows but 228 final relationship identities after the 28 exact whole-Node pairs are consolidated. Any change to the number or shape of those pairs stops the operator script for review.

V3EMAIL59 - One soft-deleted compose draft has a stale source ID with no matching source snapshot. Keep the draft and its files, but leave `source_email_message_id` null. Never invent a source email for it.

V3EMAIL60 - The additive database step does not switch backend readers or writers. Until backend cutover, the old tables remain authoritative; run the copy again with all email writers paused immediately before cutover to capture the final delta.
V3EMAIL61 - Long copy may run while the old application still writes legacy tables. The simplest final switch pauses all email writers, runs a final delta copy and reconciliation, deploys the new backend, smoke-tests it, and restores writers. Temporary dual-write is required only if the business rejects that maintenance window.

V3EMAIL62 - The approved account-unresolved and Project-duplicate cleanup was completed separately before Step 2. The create/copy script never repeats that cleanup and never deletes stored email or a legacy relationship row.

V3EMAIL63 - Jonat separately approved and completed the development recycle-bin cleanup. Step 1 and Step 2 require the recycle-bin count to remain zero and stop on drift; the V3 copy never clears it itself.

V3EMAIL64 - After cutover, keep old email tables unchanged for an agreed soak/rollback period. Table retirement is a later explicit release.

V3EMAIL65 - The implemented Step 1 preflight remains read-only, and the separately invoked Step 2 SQL creates/copies/reconciles the final data without switching backend code or changing legacy rows.

V3EMAIL66 - The Step 2 operator entry point is one self-contained plain PostgreSQL SQL file. It contains no `psql`-only backslash commands and can be opened and executed as a complete script in DBeaver without manually combining component files.

V3EMAIL67 - A legacy file link whose exact email draft, email message, or attached-email relationship target no longer exists is proven orphan evidence and does not block V3. During the additive email copy, keep the `attachments` file row and legacy link for audit, record `retained_orphan_evidence` in the migration ledger, and omit the invalid final `attachment_relationships` row. A later separately approved attachment cleanup may exact-verify and remove that broken link, then remove the file only if no valid owner survives. Never invent a replacement target. A malformed link or a link with multiple possible live targets still stops the migration.

#### Completed data checkpoint and deployed backend

V3EMAIL68 - The development Step 1 preflight completed with `READY_TO_COPY`. It proved 223 expected final threads, 678 expected final messages, 228 final email relationships, 49 email drafts, 9 signatures, 1,134 valid attachment relationships, 213 zero-target orphan links, and zero attachment links requiring review.

V3EMAIL69 - The development Step 2 transaction completed and reconciled exactly 223 `email_threads`, 678 `email_messages`, 228 `email_relationships`, 49 `email_drafts`, 9 `email_signatures`, and 1,134 `attachment_relationships`.

V3EMAIL70 - The 213 orphan legacy attachment links were intentionally omitted from `attachment_relationships` during email Step 2 and retained as audit evidence at that checkpoint. The later approved attachment Step 1 exact-verified and removed those broken legacy links and finalized zero-owner files through the safe S3-before-Postgres cleanup lifecycle. It did not invent a replacement owner or delete a file with a surviving valid relationship.

V3EMAIL71 - Completing data Step 2 alone did not cut over the application. Development subsequently completed the writer-paused final delta and deployed the backend cutover. V3 tables are now authoritative for durable imported email data, while ordinary mailbox reads stay provider-backed.

V3EMAIL72 - Development paused API email writes, sync/download workers, archive workers, webhook consumers, and every other legacy email writer immediately before deployment. It reran Step 1 and Step 2 for the final delta and deployed only after `READY_FOR_BACKEND_CUTOVER_REVIEW` was confirmed again. Every future environment must repeat this order.

V3EMAIL73 - The implemented backend cutover removes request-time draft DDL and changes every durable imported-email job, relationship, permission, chat-selection, signature, draft, and attachment path to the V3 contracts. Ordinary mailbox list/detail and provider mutation paths remain Nylas-backed and never create V3 thread/message rows. The cutover does not drop or modify the old tables.

V3EMAIL74 - Development backend cutover smoke tests passed. Keep the old email tables unchanged while Jonat takes a database snapshot and the application completes its agreed soak/rollback period. Dropping old tables is a separate later task.

V3EMAIL75 - Personal and shared mailbox lists, message details, provider attachments, refreshes, webhooks, read/star/folder changes, archive/restore, and delete operations use Nylas plus the existing short-lived server cache. None of those paths inserts or updates `email_threads` or `email_messages`; durable storage begins only at an explicit resource import.

### Scenario V3EMAIL-S1: Completed Data Checkpoint And Deployed Cutover

Business logic covered:

- V3EMAIL52 through V3EMAIL55
- V3EMAIL60 through V3EMAIL74

Given:

- The development preflight reported `READY_TO_COPY`.
- Step 2 committed the exact final counts recorded in V3EMAIL69.
- Operators paused legacy backend writers, captured the final delta, and deployed the V3 backend.

Expected:

- The completed copy is preserved as the data checkpoint, and the later deployment is recorded separately as the backend cutover.
- The 213 proven orphan links remain audit evidence and do not create broken final relationships.
- The short writer freeze and exact Step 1/Step 2 final-delta rerun complete before deployment.
- Cutover tests and deployed durable writers use only the V3 tables. Retired email tables are absent from the canonical schema.

### Existing Pre-V3 Rules And Scenarios

The rules below record current and historical product behavior. At V3 cutover, the `V3EMAIL` rules above replace conflicting legacy table, collaboration-participant, attachment-link, relationship-ownership, email-account-scope, and deletion behavior. Non-conflicting UI, provider, rendering, sending, and interaction rules remain required.

#### 2026-07-10 Node Attached-Email Retention Contract

- An email attached to a node is node-owned durable context. A text box may display or originate that association, but deleting the text box must not delete the attached-email projection, detach the provider message, or remove the email from the node-level count/list.
- The global node-header email counter/list opens a standalone node-level attached-email organizer modal with its folders/list and selected conversation. It must not depend on a live text box, auto-create a text box, or choose another text box as a replacement display target.
- The standalone global attached-email organizer must remain usable on a node with zero text boxes and by a user who can view but cannot edit the node. Existing per-text-box email panes remain unchanged for surviving boxes.
- File attachments that belong to the retained email continue to follow their provider/Mango ownership and authorization rules. Retaining the attached-email projection must never copy raw provider attachment bytes into the node projection.

Required regression scenario:
- Attach an email from a node text box, delete that box, reopen the node with no live text boxes, and open the email from the node-header counter/list.
- Confirm the count and projection remain, the standalone attached-email organizer renders its list/folders and retained thread, no replacement text box is created, and an edit-authorized user can open it while a no-access user receives no projection.

EMAIL1 - Mango email drafts are Mango application records, not Nylas provider drafts and not browser-only state. Personal and shared Drafts tabs render exact-scope `communications_email_drafts` rows, with only the fallback behavior allowed by EMAIL2; they never list the Gmail/Nylas Draft mailbox.
EMAIL2 - Browser `localStorage` may be used only as a company/user-keyed fallback mirror for drafts and signatures. Every view filters it to the exact active personal account or shared inbox; after a successful database read, only rows explicitly marked pending sync may migrate, and stale/unmarked local rows cannot resurrect deleted or revoked drafts.
EMAIL3 - Personal draft and signature rows are scoped to the actor's personal `user_email_connections` tuple of `user_id` plus `account_email`.
EMAIL4 - Shared draft and signature rows are scoped to `shared_inbox_id`; `shared_inboxes` remains the Mango permission/resource wrapper and points to `company_email_connections` for provider grant plumbing.
EMAIL5 - A draft or signature row must be either personal or shared, never both and never neither.
EMAIL6 - Ordinary personal draft list/get/create/update/delete and draft-attachment access are owner-only in the exact personal account scope; company manager status does not bypass ownership. Ordinary shared-inbox draft list/get/attachment reads require edit access to the exact inbox, while create/update/delete and attachment mutation require edit access. Collaboration shared drafts use the participant/revision exception in EMAIL65 through EMAIL69.
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
EMAIL44 - Signed provider webhooks use two distinct paths. `message.created` creates/finds and enqueues the exact priority-10 ingestion job, then returns without invalidating mailbox caches or publishing a pre-ingestion realtime hint; the worker, not the webhook body, fetches and validates provider truth. After the email transaction and deterministic durable outbox event commit, the worker wakes realtime for only `job.company_id` and the exact personal account or shared inbox. True already-stored `message.updated` (including moves), `message.deleted`, and folder changes still publish compact exact-mailbox hints after exact cache invalidation and webhook deduplication. First and reconnect acceptance each perform one canonical reconciliation, directly identified selected changes may refresh detail, unrelated new mail does not refetch selected detail, and webhook bodies are never durable email truth.
EMAIL45 - Thread reconstruction supports external-initiated, Mango-user-initiated, alternating inbound/outbound replies, and forwards without guessing. Provider thread IDs or exact supported reply metadata may establish membership; subject similarity never does, cross-mailbox IDs cannot merge, duplicates collapse by message ID, and unresolved one-offs remain single conversations.
EMAIL46 - An unread card always has the unread dot, unread text emphasis, and accessible unread state, but it must not receive the retired blue/thick outer card frame. Pointer or keyboard open optimistically clears unread UI and decrements/recomputes the visible count before the scoped provider command completes; success survives selection/realtime refresh, while failure rolls back accurately and surfaces the established error. Pending-read timers, overlays, and responses are keyed by authenticated mailbox plus provider message ID and may mutate only the captured list/filter and selection generation, so identical provider IDs or stale completions cannot cross users, personal accounts, shared inboxes, searches, or selections. Selection uses the separate full-card Mango selection surface and accessible pressed state.
EMAIL47 - Draft scope columns are immutable across upsert conflicts, soft deletion, and known-ID reuse. List/get/delete store predicates include exact scope, shared account email is canonicalized from the inbox, and cross-user/account/inbox IDs cannot be read, taken over, reassigned, updated, or deleted.
EMAIL48 - An email-card thread icon appears on the left only when the sanitized canonical/loaded message count is greater than one; thread-ID presence alone is not proof of a multi-message conversation.
EMAIL49 - Locally persisted sent-reply fallback data is keyed by company, authenticated user, personal account/shared inbox, source message, and thread. When a provider send response omits thread ID, exact reply-target metadata supplies it before the enriched reply is persisted under the thread key; no local reply cache crosses users or mailboxes.
EMAIL50 - Google Primary always means `in:inbox -category:social -category:promotions`. User search is grouped and unread-only is folded into that same native expression so advanced `OR` searches cannot widen the mailbox bucket. The backend response boundary plus backend/frontend cache reconciliation apply the same Primary exclusion, so fresh, refreshed, cached, and optimistic star/read paths cannot leak Social or Promotions into Primary. The messages remain eligible for All and, when starred, Starred.
EMAIL51 - Nylas message-list serialization has mutually exclusive query modes. A Gmail-native mailbox request sends only `search_query_native`, `limit`, and optional `page_token`; it omits `select`, `thread_id`, `q`, `in`, `unread`, `starred`, and every other structured filter. A thread-history request uses structured `thread_id` mode without `search_query_native`, while ordinary non-native lists retain the selected-field projection. Native response supersets are normalized back to Mango's preview-only list shape so body/detail hydration, mailbox membership, ordering, pagination, and account/shared-inbox scope do not change.
EMAIL52 - Merely listing or opening an unassociated email, selecting text, focusing or abandoning an empty composer, or closing the comment rail must not create a Node. Selecting email text shows a chat action and captures the exact message/quote/offset anchor without opening the rail or filling the composer. Clicking the action opens the rail and places the quote in the composer. The first nonempty comment or attachment creates a floating Node with priority **Not Assigned** (`priority = null`) and no Logic Gate; no priority or placement prompt interrupts the comment. The frontend supplies one stable requested Node ID for that creation attempt, and a retry reuses it instead of creating a duplicate. Before creation, the backend authorizes the exact source mailbox, fetches the requested message directly from the provider, validates message/thread identity, and persists only provider-derived truth. Provider failure or identity mismatch creates nothing, and the UI shows no saved comment before backend acknowledgement.
EMAIL53 - One immutable mailbox-scoped provider conversation may be associated with only one Node. That Node may have one whole-Node email relationship and several textbox-specific relationships for the same stored thread. Repeating a create request with the same requested Node ID converges on the existing collaboration; requesting a different Node for that stored thread is rejected.
EMAIL54 - A first-comment email Node starts as a floating Node: private, unfiled, `priority = null`, and unattached to any Logic Gate. The creator receives the direct Responsible RACI role and every accepted mention participant receives durable direct edit access. After creation the Node uses normal work behavior, so a later hashtag destination action may add priority, Logic Gate/Kanban assignment, or a Project relationship. Delete and mutation of its canonical source-email projection remain protected.
EMAIL55 - Creation writes one canonical `Attached email` projection to the email Node with `created_from_email=true`, collaboration ID, source provider message/thread identity, subject/snapshot, `account_email`, and `shared_inbox_id` when applicable. The editable Node JSON stores identifiers and Mango attachment references, while immutable imported HTML/text, envelopes, timestamps, inline images, signatures, and attachment bytes live in the durable email and attachment tables/object storage. Generic commands cannot replace or delete that canonical source projection. Additional email threads may later be attached through the existing Node attachment path and remain separate sources rather than being merged by subject.
EMAIL56 - Email detail and Node detail are two surfaces over the same Node information rows. Both mount the shared `ChatPane`, parse and write the same `Text block chat` payloads under the canonical attached-email information ID, use the same `chat:node:{node_id}` reconciliation scope, and expose the same ordering, replies, deletion ownership, mentions, attachments, links, and composer semantics; neither copies or synchronizes chat into a second history. Accepted mention chips share the textarea's text metrics and inline advance, so the native caret stays after the accepted token in both surfaces and subsequent typing paints at that caret. Every primary-email-origin Node renders Email left, the normal text-box editor middle, and that one Node chat right. Additional text boxes retain their own editor documents and their existing per-text-box chat context when opened; the primary right pane remains the one Triage/email conversation.
EMAIL57 - A chat may be created with no selection or from selected text in any message card in the provider thread. A selection-backed chat stores `selection_source=email`, the exact provider message ID, the trimmed quote, and nonnegative start/end text offsets with `end > start`; opening or activating the chat navigates to that message and highlights the best exact quote/offset match without changing the underlying email body.
EMAIL58 - Chat replies store the existing parent-message ID and render beneath that parent with the shared Node chat indentation. The selection anchor belongs to the root/comment that captured it; replying does not silently retarget the anchor to the currently newest email or another message card.
EMAIL59 - A committed `@` or urgent `!` mention of a company user adds that user exactly once as a permanent Node-chat participant. A committed user-group mention resolves the group current same-company membership and snapshots each distinct resolved user in the same transaction as the chat write; invalid, deleted, or cross-company principals are rejected rather than partially shared. Mention participation never changes provider To/Cc/Bcc, never sends or subscribes the user to provider email delivery, and never makes that user an email participant.
EMAIL60 - Collaboration participation is append-only for the collaboration lifetime. Later group membership or hierarchy changes neither add nor remove participants, deleting a mention message does not revoke access, and repeatedly mentioning the same user directly or through overlapping groups is idempotent.
EMAIL61 - Every authorized Node collaborator may open the downloaded collaboration thread and its Mango-stored file/CID attachments even when that person was not To/Cc/Bcc and has no connection to the source mailbox. The backend authorizes the Node/thread link first and serves only the immutable Mango-stored snapshot and authenticated Mango attachment objects; a collaborator read never calls Nylas and never exposes a grant or credentials.
EMAIL62 - A qualifying post-activation Inbox message extends its exact stored connection/thread automatically. Immutable Nylas IDs decide whether to reuse the message and thread; subject or body resemblance never does. The worker appends only missing/incomplete messages and files, and every newly completed message receives only missing Node-wide relationships already present on that thread. Authorized Node collaborators then see the updated Mango-stored thread without source-mailbox access. Unknown or currently unplaced threads remain stored without any Node relationship.
EMAIL63 - Email-list membership always comes from the active personal or selected shared mailbox's canonical provider response. A matching collaboration may annotate that provider-owned row with collaboration/Node identity by immutable source mailbox plus provider thread/message identity, but a stored collaboration snapshot, Node attachment, or mention never manufactures a My Triage or Shared Triage row.
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
EMAIL76 - My Triage and Shared Triage have one chat toggle in the email thread header. The toggle opens and closes one rail for the whole thread; selecting a conversation never auto-opens it. Individual message cards have no chat button or overflow menu. Selecting text shows a chat action first, and clicking that action opens the rail with the exact quote. The universal destination picker never opens or reserves the chat rail. Closing the rail or changing exact message, mailbox, or view performs no durable mutation.
EMAIL77 - An open email-node chat header shows only the owning Node icon and Node name. It does not show participant avatars, extra labels, or close text. Collaboration participants remain the authorization authority even though the header does not display a participant roster.
EMAIL78 - Floating-Node ensure/create and the first comment write have explicit retry-safe failure behavior. A failed ensure leaves no partial Node, attached-email projection, RACI, permission, participant, or relationship. A failed subsequent comment write leaves any already committed empty association reusable under EMAIL52, but the frontend never inserts a false optimistic saved row before backend acknowledgement. The open composer preserves typed text, selected mentions, reply target, selected Node-chat target, stable requested Node ID, attachments, and exact email-message anchor, re-enables submission, and permits deliberate retry against the same source.
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
EMAIL105A - Background archive creates one durable item marker per exact mailbox message before sending one compact SQS message per item. If a request sends some items and a later send fails, retry reuses and resends every still-pending marker instead of creating a replacement or stranding it without a database poller. The exact permanent email connection remains the FIFO group, PostgreSQL fences each provider attempt with its token, and AWS receive count owns redelivery and DLQ movement. Completion and failure are observed only through canonical archive job reads; archive workers publish no communications WebSocket completion event.
EMAIL106 - A non-primary mailbox tab with a next page but no actual list scroll range automatically appends pages until the list becomes scrollable or the provider reports exhaustion. This prevents condensed All, Starred, Sent, Spam, or Archive results from trapping the user on a short first page; ordinary scroll continues loading near the bottom without replacing the selected detail.
EMAIL107 - While the selected detail owner is already fetching a message/thread, the mounted conversation viewer must not start a competing newest-message body hydration. Same-key caches and in-flight coalescing remain a safety net, but the visible contract is one stable loading transition from row preview to the complete canonical timeline, never a one-message/detail blip followed by repeated thread reconstruction.
EMAIL108 - Personal Email, My Triage, and Shared Triage use the same ordered mailbox actions: Inbox, Starred, Sent, and the All/Spam dropdown form four equal top controls; Compose, My Drafts, and Archive page/next always form three equal lower controls in fixed positions. The lower workflow actions rest on lightly tinted blue-violet, violet-fuchsia, and cyan-teal elevated surfaces. Compose or My Drafts receives its full gradient only when it is the single selected destination; Archive page/next receives stronger teal interaction feedback when available and remains visibly disabled, never removed, on mailbox tabs where that action is inappropriate. The All and Spam menu rows show a clear hover and keyboard-focus highlight across the full row without a dead gap between options.
EMAIL109 - My Triage and Shared Triage use one typed email-to-Node relationship model, and one stored email thread may belong to only one Node. The shared Universal picker is a separate reference/placement control. Its `#` reference mode opens the selected exact Node, Logic Gate, Project, or email message without mutating email. Its `##` link mode sends literal IDs through established commands: existing Node selection uses exact-message import, Logic Gate selection immediately creates an email Node with priority **Not Assigned**, and Project selection requires only its Logic Gate choice. Creation persists the canonical attached email, durable `email_message_id`, exact-message text box, and collision-free `email_accent`; the picker creates no generic edge.
EMAIL110 - The Node email header does not contain a collapse/hide-column arrow; the existing Node-level Email toggle is the sole hide/show control. The header instead offers an accessible Expand email column control. Its 180-millisecond transition gives email all workspace width except a 38-pixel right rail that preserves the text-box circle-and-line timeline, marks the clipped editor/chat region inert, and restores the user's prior normal layout on the second press. In normal mode the email column is sticky below the Node toolbar, so the text-box timeline scrolls independently. Node chat opens beside an editor at a compact 340-pixel default rather than half the available width, while deliberate separator resizing remains persisted.
EMAIL111 - The selected My Triage or Shared Triage toolbar keeps ordinary mail controls in a horizontally scrollable group, the Node-plus button, and the `## Ready!` Universal-picker launcher. The Node-plus button immediately creates a floating Node with priority **Not Assigned**. Link mode submits an existing Node immediately; a Logic Gate result immediately creates a Node there with **Not Assigned**, while a Project result requires only its Logic Gate choice. Reference mode opens a resource without changing the email.
EMAIL111 interaction detail - Logic Gate selection submits immediately with priority **Not Assigned**. Project Logic Gate choices remain individual elevated options, and clicking the choice submits without a native dropdown. Floating creation bypasses the picker. A direct existing-Node import annotates the matching mailbox row and every loaded thread reply immediately after the established import succeeds. In `#` mode, choosing an email reference opens the exact stored personal/shared mailbox scope without creating an email-to-email relationship.
EMAIL112 - My Triage and Shared Triage email-collaboration chats use the same author-only inline comment editor as Node and Project chat. Editing recomputes direct-user and user-group mention IDs from the saved text, atomically preserves the source email/text-box relationship and existing collaboration payload, adds any newly resolved participants through the normal append-only participant path, and reconciles other mounted viewers through the exact Node `chat.message.updated` hint. Failed saves roll back the optimistic row while retaining the draft for retry.

EMAIL113 - Automatic discovery starts from a provider message ID and permanent `email_connection_id`; it does not require a Mango thread/message/Node ID to exist first. A signed webhook creates or finds the permanent stable job identity before sending a compact job to SQS, and returns success only after SQS accepts that request. Explicit selected-message imports may enqueue the same identity. A rare bounded reconciliation message repairs missed webhook delivery; provider-backed list reads do not create background work.
EMAIL114 - Provider identity is always mailbox-scoped. The primary message key is company plus immutable personal-user/account or shared-inbox scope plus Nylas message ID. The primary thread key is the same mailbox scope plus Nylas thread ID, falling back to the selected Nylas message ID only when Nylas supplies no thread ID. An RFC `Message-ID` header may be retained as secondary evidence but is not the primary key. Subject, participants, dates, snippets, bodies, and visual similarity never identify or merge messages or threads.
EMAIL115 - Before storing work, ingestion checks the exact connection-scoped Nylas message ID. If a complete message already exists, Mango reuses it and performs no storage copy. If the message exists but its body or attachments are incomplete, Mango resumes only missing work. Webhook, reconciliation, reconnect, duplicate SQS delivery, and explicit-import producers converge through one permanent unique job per company/connection/provider-message. No producer recreates that identity after accepted, processing, completed, parked, or exhausted status.
EMAIL116 - If the eligible trigger is new, the worker checks its exact connection-scoped Nylas thread ID. With no stored thread, Mango creates one thread with no Node relationship and reconciles the complete real provider thread available in that mailbox, including real older messages. With an existing thread, Mango appends only missing/incomplete messages and files, preserving every stable stored ID. Quoted history inside one provider message never becomes fabricated messages. A thread that predates activation is allowed only because a qualifying post-activation Inbox trigger identified it.
EMAIL117 - AWS SQS alone owns email delivery, fixed visibility, redelivery, receive count, and DLQ movement. The encrypted FIFO work queue uses exact permanent `email_connection_id` groups, ten-minute visibility, 20-second long polling, and `maxReceiveCount=3`; one worker attempt has an eight-minute deadline. PostgreSQL keeps a permanent idempotency marker, not a delivery lease: it increments only provider-processing starts, fences settlement with the exact attempt token, and atomically refuses attempt 4. Mango has no claim/reclaim scan, availability timer, visibility heartbeat, custom retry scheduler, or automatic DLQ replay.
EMAIL118 - Message persistence includes HTML body (and provider text when available), subject, snippet, timestamp, From, To, Cc, Bcc, Reply-To, provider message/thread IDs, folders needed for faithful display, and deterministic chronological order. HTML stays immutable email HTML rather than being translated into editable Node JSON. Rendering sanitizes it and blocks active/unsafe content. Empty Bcc or body is a valid stored value and must not be mistaken for an incomplete download.
EMAIL119 - Every ordinary attachment, inline CID image, and signature asset referenced by the imported message is copied into Mango-owned private object storage and linked through Mango attachment metadata to every authorized Node that displays the thread. Retry uses stable identity so the same provider attachment is stored once. A Node collaborator downloads through Mango authorization and never through the source user's Nylas grant. Failure of one attachment leaves the readable message and completed siblings available while the job remains retryable/partially failed.
EMAIL120 - Stored messages are ordered by provider timestamp ascending with immutable Nylas message ID as the deterministic tie-breaker; UI reversal is presentation-only. `history_complete=true` means the provider thread was completely downloaded as observed by that reconciliation job, not that the external thread can never receive another message. A later automatic or explicit reconciliation may append a newer, older, or same-timestamp real message and recomputes order without changing stable Mango message IDs.
EMAIL121 - Every connection stores a permanent Mango ID, `ingestion_started_at`, and `last_successful_scan_at`. EventBridge sends one `reconciliation-control` FIFO message about every ten minutes. One control delivery reads one bounded connection page; each exact-connection delivery reads one bounded provider page after an overlap-protected checkpoint and never launches a historical whole-mailbox import. A continuation is accepted by SQS before the current delivery is deleted, and the checkpoint advances only after the final provider page is durably represented. Reconciliation never creates a replacement for an existing stable identity. Its durable creation-origin identity permits only the same control delivery to retry an ambiguous or failed child send; a later scheduled control identity never resends an accepted marker left by prior or DLQed work, and processing, terminal, and parked work remains untouched.

EMAIL121A - Provider 401/403 and exact 404 `grant.not_found` park only that permanent connection as `reauth_required`; the known Google/Gmail 400 precondition failure parks it as `configuration_required`. The exact job and connection status update must succeed before SQS acknowledgement. Reauthorizing the same mailbox updates the same permanent connection without changing `ingestion_started_at` or `last_successful_scan_at`; a bounded reconciliation control message may resume from the checkpoint. Another valid connection is never changed.

EMAIL121B - This phase propagates only Node-wide email relationships. When a message becomes complete, the message upsert and insertion of its missing relationships to every current Node-wide destination of that thread commit atomically. It does not copy the whole thread, create a relationship for an unknown/unplaced thread, grant access, choose a Node, or propagate textbox-specific placement. Chats, shared drafts, picker redesign, and automatic textbox association remain outside this phase.

EMAIL121C - The DEV cutover preflight refuses to proceed while any legacy database-delivered ingestion or archive item is pending, processing, or retrying. It reports aggregate stable-identity duplicate groups, exact redundant rows, inactive-status violations, synthetic cutover completions, conflicting non-null Mango thread IDs, conflicting nonblank provider thread IDs, and foreign-key references without exposing mailbox/provider identifiers. A coherent legacy duplicate group may collapse only when every row is completed or failed, every populated thread identity agrees, and no foreign key references ingestion jobs. The locked transaction rechecks those gates, retains genuine completion before failure before `superseded_by_email_ingestion_cutover` synthetic completion, then within that class prefers agreed thread metadata, earliest `created_timestamp`, and ascending `ingestion_job_id`. It deletes only redundant `email_ingestion_jobs` metadata, asserts the exact count and zero remaining duplicates, preserves all email/thread/attachment data byte-for-byte, then creates the unique stable identity index. Final-schema duplicates remain STOP; an already-final unique state reruns safely without changing its data or final contract.

EMAIL121D - My Triage and Shared Triage keep the provider-thread indicator when a collapsed card represents multiple real messages. Their Node indicator is enriched only from an accessible Node-wide relationship matching the exact company, permanent email connection, and provider message ID. A placement in another mailbox with the same provider message ID never supplies the icon. After the email transaction commits, the worker durably inserts one narrow outbox event whose deterministic identity derives from the stable ingestion job plus the exact company/audience scope. Personal delivery uses only `job.company_id`, exact user, and exact account; it never fans out across the user's other company memberships. Outbox-insert failure leaves the SQS item undeleted. Once that row exists, duplicate completion is an outbox no-op except an optional post-commit Valkey wake, and Valkey failure is recovered asynchronously without repeating provider work.

EMAIL121E - A completed ingestion job is final for that exact company, email connection, and provider message identity. A duplicate webhook request still independently waits for SQS acceptance so another request's send failure cannot be hidden. If SQS deletion fails after successful email and outbox commits, redelivery performs no second provider operation and creates no second outbox event; it may only reuse the deterministic event identity and wake the existing realtime recovery path.
EMAIL122 - After a successful mailbox-scoped star or unstar command, that committed value overlays stale provider list responses in the exact personal email account or shared email account across Primary, Starred, All, and other visible mailbox pages. A stale refresh cannot reverse the visible result; Starred membership follows the overlaid value. The overlay is removed only by an exact-scope settlement hint or its bounded expiry, and it never crosses another personal account or shared inbox even when provider message IDs collide.
EMAIL123 - Triage star reconciliation treats an unscoped visible row with the same provider message ID as the current exact mailbox scope when the committed command response supplies that scope. The committed response updates that row, while preserving only same-ID rows that explicitly identify a different personal or shared mailbox scope.
EMAIL124 - The Node-wide email column is bounded to the available Node workspace height, is sticky below the Node toolbar, and scrolls long email content inside its own pane. Scrolling the outer text-box timeline leaves the email column in view. Opening a long email never increases the outer virtualized timeline height, hides unrelated text boxes below it, or creates a blank right side; the outer Node scroll remains driven by text-box rows.
EMAIL125 - Selecting a My Triage or Shared Triage row never opens the chat column automatically. The one thread-header chat toggle and highlighted-text chat action are the only controls that open it. Opening or closing the column creates no text box, collaboration, Node, chat, message, participant, permission, RACI assignment, or relationship.

EMAIL126 - Every universal picker host renders an explicit transparent outside-click dismiss layer behind the elevated popup; a pointer press on that layer closes the picker without selecting or mutating. In My Triage and Shared Triage, the compact elevated green placement notice is anchored nine pixels left of the floating-Node control. A successful standalone creation paints that notice before publishing the mailbox/reply Node indicator; the indicator follows after 450 milliseconds while the notice remains visible for its normal brief lifetime. A failed creation paints neither success nor a false indicator. Mail Node-indicator activation opens the Node without transient information focus, so the yellow target flash remains exclusive to Updates-row navigation.

EMAIL127 - The worker's deterministic post-ingestion mailbox hint and exact active-mailbox `message.updated`/`message.deleted` hints invalidate the exact message-page cache and coalesce one authoritative visible-list reload plus folder reload. A raw `message.created` webhook produces no hint before ingestion. First subscription acceptance performs the same canonical reconciliation to close the initial-load race. Folder-only hints reload folders only, selected-detail hints remain selection-owned, local command echoes perform no duplicate provider read, and navigation or disposal cancels obsolete mailbox work.

EMAIL128 - Universal-picker email search is database-first but never treats a nonempty local result as complete provider coverage. Mango paints authorized stored matches immediately, then always queries the same exact personal account, mailbox, and search text at Nylas. Provider success becomes the ordering/metadata authority while preserving known durable Mango IDs; provider failure leaves stored results usable with a visible sync warning. Exact provider message ID within the mailbox scope is the merge identity.

EMAIL129 - The Universal picker, My Triage, and Shared Triage call the same thread-condensation helper. The first/newest ordered message represents the thread; unread, starred, loaded-message count, authoritative provider thread count, and mailbox scope follow the shared rules. Pagination merges raw exact messages before condensation so replies split across pages cannot create duplicate picker rows.

EMAIL130 - Choosing a provider email with no `email_message_id` calls the authenticated exact-mailbox ingestion command before any Node or Project attachment. The backend fetches provider truth, idempotently upserts the mailbox-scoped durable thread/message, returns the real Mango `email_message_id`, and keeps full-thread ingestion prioritized. The later relationship command remains the established typed Node or Project command; no provider ID is substituted for a Mango UUID and no generic relationship or surrogate identity is created.

## Scenarios

### Scenario EMAIL-S0: Live arrival, resilient search, and safe picker attachment

Business logic covered:
- EMAIL127 through EMAIL130

Given:
- The browser has a healthy exact mailbox realtime subscription.
- A new provider message arrives, or a user searches and chooses an email in the Universal picker.

Expected:
- The visible triage list reloads after the narrow message hint without a browser refresh.
- Picker-local results appear before provider reconciliation and remain visible if provider reconciliation fails.
- Picker rows collapse with the same thread rules as triage.
- A provider-only selection receives a durable Mango message ID before the typed Node/Project attachment command runs.

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
- `message.created` only enqueues durable ingestion and publishes nothing before provider truth is stored. The worker's one deterministic post-commit hint, plus true already-stored `message.updated` (including moves), `message.deleted`, and folder changes, reconcile only relevant canonical state; directly named selected changes refresh detail, while unrelated new mail does not.
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

### Scenario EMAIL-S13: Lazy Email Comments And Multiple Node Chats

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
- A user opens a personal or shared email thread that may have zero or one accessible Node association, then highlights text in one message.
- The user may close the rail, abandon the composer, submit a root comment, reply, or retry the same creation request against the thread's one Node.
- The provider, source-authorization, collaboration-store, or following chat write may fail before the first chat is durably visible.
- The same collaboration is later opened from its standalone Node.

Expected:
- Listing or opening an unassociated email, closing the rail, and abandoning an empty composer create no relationship or Node; selection alone also creates nothing durable.
- Selecting text shows a chat action without opening the rail. Clicking the action opens the one thread-level rail and places the exact quote in the composer.
- With no association, the first nonempty comment creates one private floating Node with priority **Not Assigned** and no Logic Gate. A stable requested Node ID makes retry idempotent. With one association, the comment uses that Node. A second Node association for the thread is rejected.
- A failed ensure leaves no partial durable collaboration artifacts; either failure preserves the typed composer context, never shows a saved row before acknowledgement, re-enables retry, and translates `failed_to_create_email_collaboration` or `email_collaboration_storage_not_ready` into actionable text.
- A floating Node starts with one source-scoped attached-email projection, `priority = null`, creator Responsible RACI, private participant access, no Company Explorer placement, and no Logic Gate. Later hashtag organization may assign priority and a Logic Gate or Project through their typed relationship commands.
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
- Group membership changes and a qualifying post-activation Inbox message later joins the same Nylas thread.

Expected:
- The accepted chat write snapshots each distinct current same-company user once and grants permanent collaboration participation/edit access.
- Later group changes, mention deletion, and duplicate mentions neither revoke nor duplicate participants.
- Before creation the open email-chat header shows only the current actor as prospective creator without writing anything. After creation, Triage renders canonical participant provenance and the Node header renders compact durable author/mention history over the same chat. Neither roster turns anyone into a provider recipient.
- Every participant can read the Mango-stored thread snapshot and Mango-stored attachments without receiving provider credentials, an auto-forwarded provider copy, or access to the source mailbox.
- The source email appears only in a participant's active My Triage or Shared Triage when that exact provider mailbox response returns it. Mentioned nonrecipients retain stored-thread and Node/chat access but receive no email-list row.
- A participant who is also a provider recipient sees the one provider-owned row annotated with collaboration identity by exact source scope plus provider thread/message identity.
- A verified webhook or checkpoint scan enqueues the later provider message without waiting for a user session. Background ingestion appends each missing real message once and gives it the thread's existing Node-wide destination for all authorized Node collaborators.
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
- EMAIL124 and EMAIL125

Given:
- A user opens either My Triage or Shared Triage on a message that may be a standalone email, a reply in a larger thread, or a thread already attached to a Node.
- The user focuses the hashtag bar while blank or types a destination query, or selects email text and writes a comment. The email thread may already be associated with its one Node.

Expected:
- The Node-plus button creates a floating Node immediately and opens no rail. The Universal picker opens in `##` link mode and uses shared pinned/workspace search. Empty-query Backspace switches to `#` reference and `#` switches back to link. Reference opens an exact Node, Logic Gate, Project, or email without mutation. Link selection reuses an existing Node or creates a new email Node in the chosen Logic Gate/Project after the existing priority and placement steps. Enter/Tab and arrow-key navigation remain available, the successful relationship annotates the mailbox row and reply header with the Node indicator, and a temporary green notice overlays the detail without changing its grid rows.
- The separate Node-wide email column shows the selected message immediately from Mango storage and fills in the rest of the current thread as the durable job completes. A linked text box may show only its exact associated message inside its left content column; it never duplicates the complete thread and never intrudes into or shortens the right chat column.
- Choosing an existing Node creates or reuses the exact-message text box with persisted `email_message_id` and deterministic `email_accent`, queues the same durable thread import, never opens chat, and shows **Email was added to node.** on success.
- The email thread header has one chat toggle; individual message cards have no chat button or three-dot menu. Selecting text shows an anchored chat action first. If the thread has its one Node association, Enter writes to that exact-message text-box chat. With no association, Enter creates a floating Node with priority **Not Assigned** and no Logic Gate, attaches the selected message, creates the exact-message text box, and commits the comment there.
- Each text-box row contains a left content column and an independently sized right chat column. Show email places the exact linked-message preview above the editor within the left column; when the editor is closed, that preview owns the left column. The chat always retains the row's full body height.
- The Node-wide email column and chat pane use the full available vertical space. The email column is sticky below the Node toolbar while the text-box timeline scrolls and retains its own vertical scroller. The Node-level Email toggle retains a stable three-track shell and animates width plus opacity/transform for open and close; the closed email pane is inert and pointer-disabled. Email, Editor, Chat, and linked-email visibility changes honor reduced-motion settings; the email-focus button retains its separate responsibility.
- A long Node-wide email scrolls inside the bounded email pane. It does not stretch the outer virtualized timeline or prevent lower text boxes from appearing as the Node timeline scrolls.
- With one surface visible it fills its available area; with multiple surfaces visible, Node-wide email, text-box content, and text-box chat remain distinct columns.
- Legacy Attached-email-keyed chats may still render beside a linked text box, but no new chat or attachment is written to the Attached-email ID.
- My Triage and Shared Triage use the same controls and persistence path. Their top toolbar keeps mail actions on the left and the floating-Node plus button, `## Ready!` universal picker, and one thread chat toggle on the right. Selecting a row never opens chat automatically. Comment entry starts when the user clicks the highlighted-text chat action or opens the unanchored rail with the thread toggle.
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

### Scenario EMAIL-S30: Duplicate Import And A Later Automatically Ingested Reply

Business logic covered:
- EMAIL114 through EMAIL117
- EMAIL120
- EMAIL121

Given:
- A mailbox-scoped Nylas thread and all messages observed yesterday are completely stored and attached to a Node.
- Today Nylas has one new reply with a new Nylas message ID and the same mailbox-scoped Nylas thread ID.

When:
- The user first re-imports an already stored old message, then a webhook or rare reconciliation delivery sends today's new reply through the exact connection FIFO group.

Expected:
- Re-importing the old message reuses its stored message, thread, Node source, text-box link, files, and any active job; it performs no duplicate provider download.
- Automatic reconciliation recognizes the existing thread, appends only missing real provider messages, and downloads only their missing files.
- Old Mango message IDs and stored bytes do not change; the deterministic order is recomputed and the exact-message linked text box is created/reused once.
- Node open and collaborator reads remain provider-read-free. Durable webhook/reconciliation ingestion adds today's reply even when every user is logged out.

### Scenario EMAIL-S31: Partial Failure And Collaborator Without Nylas

Business logic covered:
- EMAIL117 through EMAIL121
- EMAIL61

Given:
- The selected message is stored, but downloading one historical attachment receives a transient provider or object-storage failure.
- Bob imported the email and Joe has Node access but no access to Bob's Nylas mailbox.

Expected:
- Bob and Joe can immediately read every completed Mango-stored message and file; the one failure does not blank or roll back the import.
- The exact attempt token prevents stale settlement, the SQS message remains undeleted, and AWS controls redelivery and DLQ movement without a database availability timer or custom backoff scheduler.

### Scenario EMAIL-S31A: Durable Hint Boundary Does Not Repeat Provider Work

Business logic covered:
- EMAIL117
- EMAIL121D
- EMAIL121E

Given:
- One SQS ingestion delivery has successfully stored provider truth and completed its exact attempt.

When:
- The required realtime outbox insert first fails, then a later redelivery inserts it successfully.
- In a separate run, the outbox insert succeeds while Valkey publication is unavailable.
- In a third run, the email result and deterministic outbox event commit, but SQS deletion fails and AWS redelivers the same completed job.

Expected:
- Outbox-insert failure leaves the SQS message undeleted, but redelivery sees the completed stable job and performs no second provider operation.
- Once the durable outbox row exists, the SQS message is acknowledged even during the Valkey outage.
- The existing realtime spine later publishes that committed row after Valkey recovery; provider work remains exactly once.
- Delete-failure redelivery reuses the same exact event ID, leaves one durable outbox event, and performs no provider call.

### Scenario EMAIL-S32: Star State Survives Stale Personal And Shared Triage Refreshes

Business logic covered:
- EMAIL75
- EMAIL122
- EMAIL123

Given:
- The same provider message ID may appear under separate personal and shared mailbox scopes.
- A provider list refresh can briefly return the pre-mutation star value after a successful update.
- A visible list row may not yet carry its source-scope key even though the committed command response does.

When:
- A user stars or unstars a row in My Triage or Shared Triage.

Expected:
- The successful command response fixes the requested star value for that exact mailbox scope.
- Primary and other visible mailbox rows retain that value across a stale refresh instead of flashing back.
- An unscoped visible copy of the exact message is replaced by the scoped committed response.
- Starred includes a committed star and excludes a committed unstar while the provider catches up.
- Colliding message IDs with an explicit different personal-account or shared-inbox scope remain unchanged.
- An exact-scope newer settlement or bounded expiry allows the later canonical provider value to win.
