# Node v2: product requirements, editor architecture, scale, and handoff

Last updated: 2026-07-28

Status: **superseded before rollout on 2026-07-28**. This document is retained only as a historical design record. Do not enable, restore, or deploy the Node v2/Yjs/Hocuspocus path from this document.

Current decision: Node, Project, and Logic Gate editors use the shared revisioned Tiptap JSON save path. Historical additive migrations remain in Git, but the Node v2 frontend, collaboration service, runtime packages, flags, and build/test entry points were removed.

## Why this document exists

Mango is reaching the point where the Node, editor, chat, email, attachment, timeline, realtime, and history systems cannot be designed independently. A Node may remain active for weeks, move between teams and Logic Gates, accumulate dozens of text boxes, thousands of chat messages, hundreds of email messages, many files and images, verification records, permissions, GVIC assignments, and future snapshots.

The user must still be able to open the Node quickly, scroll smoothly, type with immediate feedback, undo correctly, work through a network interruption, and open the same document in several browser tabs without one tab silently replacing another.

The existing editor modernization work contains useful foundations, but some earlier decisions no longer match the clarified product requirements. In particular:

- the existing plan uses complete JSON snapshots with exact-revision conflicts;
- the existing plan explicitly excludes Yjs, CRDTs, Hocuspocus, and automatic concurrent merging;
- a single Tiptap JSON document was arbitrarily limited to two MiB; that editor-specific cap was removed on 2026-07-27 while structural validation and the general API request ceiling remain;
- the current JSON save path stores the complete accepted document in current, operation, and version rows;
- the current browser pending record is keyed only by the document, so same-document tabs share one IndexedDB record without a cross-tab coordinator;
- the current conflict choice is whole-document `keep-local` or `use-canonical`, not merged concurrent editing.

Those choices must be reconsidered before the Tiptap cutover. Do not delete production data, convert live documents, enable the JSON workspace gate, or remove legacy paths solely because this document exists.

## Project tracker

This tracker uses three large phases. The earlier architecture/audit phase and storage/migration-foundation phase are intentionally merged into Phase 1 because the product model is mostly settled and the remaining foundation must be designed against the actual development database.

### Phase 1 - Finalize the architecture, audit dev, and build the foundation

Status: **In progress**

Goal: turn the confirmed product rules and actual dev data into reviewed additive tables, APIs, editor schema, and safe conversion foundations without changing live reads or deleting legacy data.

Completed decisions and discovery:

- [x] One Node owns many text boxes; every text box belongs to exactly one Node and cannot exist independently.
- [x] Comments belong to one text box and are viewed only inside that text box.
- [x] Node file attachments belong through a text box; the Node attachment list aggregates attachments from its text boxes.
- [x] Email may be associated with the Node generally and may additionally be associated with an exact text box or message context.
- [x] The primary Node timeline has exactly three item types: text-box creation, Logic Gate movement, and verification stamp.
- [x] Comments, emails, attachments, autosaves, editor operations, and snapshots are not primary Node timeline items.
- [x] All attachment bytes, including pasted images, remain outside Tiptap JSON; editor content stores permanent references only.
- [x] Tiptap/ProseMirror JSON represents materialized rich-text content; Yjs updates/checkpoints provide concurrent merge state.
- [x] Tiptap's supported HTML-to-JSON utility will perform core conversion; Mango supplies the exact schema, attachment/comment migration, validation, reporting, and rollback wrapper.
- [x] Direct database-enforced read-only access to the actual AWS development PostgreSQL database works as `mangorts_readonly`.
- [x] The actual dev schemas, tables, permissions, Node/editor data, comments, emails, attachments, timeline, and migration state have received an initial read-only audit.

Remaining foundation work:

- [ ] Complete the human-controlled live dev schema and `schema_migrations` reconciliation before applying another migration. The read-only audit proved 168 repository files versus 87 ledger rows while many unledgered objects already exist; blindly running the missing files is unsafe.
- [x] Finish the authoritative/derived/transitional/operational lifecycle map for every affected existing table.
- [x] Finalize DDL-level names, columns, composite foreign keys, deletion behavior, indexes, and retention rules for the inactive Node foundation.
- [x] Finish the Yjs provider decision with PostgreSQL durability/acknowledgement and compute measurements. The repository-owned Hocuspocus v4/Yjs 13.6.8 extension now commits deduplicated updates before a separate state-vector/checksum acknowledgement, restores checkpoint plus tail after restart, quarantines failed document sessions, compacts atomically, and reports bounded disposable-PostgreSQL measurements at the live p50, p95, and maximum text-box sizes.
- [x] Define the Node workspace API, cursor contracts, batch hydration, idempotent mutations, transaction boundaries, collaboration tickets, durable state-vector acknowledgements, and realtime boundaries.
- [x] Implement additive Node-text-box, normalized comment, email-link, attachment-link, movement, verification, three-type timeline, Yjs update/checkpoint, and migration-ledger table foundations behind inactive gates.
- [x] Implement the shared Tiptap schema and Mango migration wrapper around Tiptap's official HTML-to-JSON conversion path.
- [x] Build resumable dry-run/backfill conversion, validation, migration-ledger, shadow-read, readiness, activation, rollback-export, and rollback tooling without cutting over live reads.

2026-07-26 Phase 1 foundation milestone evidence:

- `docs/backend/node-v2-phase1-foundation.md` records the forced-read-only development audit, complete affected-table lifecycle map, exact API/cursor/transaction contracts, Hocuspocus/Yjs measurements, compaction and retention policy, and conversion/rollback rules.
- `backend/db/migrations/20260726_node_v2_phase1_foundation.sql` and the marked block in `backend/db/schema.sql` create only additive inactive storage. They do not backfill, enable a workspace gate, redirect a reader, delete a legacy row, convert email HTML, or impose a document-size constraint.
- `backend/internal/store/node_v2_foundation_schema_test.go` keeps migration and canonical schema definitions identical and rejects destructive/cutover/content-boundary regressions.
- `frontend/scripts/node-v2-yjs-postgres-store.mjs` and `frontend/scripts/node-v2-yjs-postgres-poc.mjs` implement and verify the repository-owned PostgreSQL persistence/acknowledgement path with generated inputs at the live p50, p95, and maximum text-box byte sizes. The proof creates only a disposable local PostgreSQL cluster and does not read or print live document content.
- The shared schema/converter, dry-run/backfill/shadow/readiness tooling, and post-cutover edit-preserving rollback exporter are complete and proven against disposable PostgreSQL. Phase 1 remains open only for the human-controlled live development ledger reconciliation; no live schema was changed.

Phase 1 completion gate: reviewed DDL and APIs exist; representative legacy content converts and validates in dry-run/shadow mode; old HTML remains recoverable; and no unresolved ownership rule or unexplained live-table lifecycle remains.

### Phase 2 - Build the complete Node v2 experience

Status: **Repository acceptance complete behind the inactive Node v2 build/workspace gates; manual user acceptance remains pending.**

Goal: make a large Node work end to end on the new model for a reliable single active editor before collaborative rollout.

- [x] Create, load, edit, save, reload, order, archive, and restore independently owned Node text boxes.
- [x] Render inactive visible text boxes cheaply and activate Tiptap only for the text box being edited.
- [x] Replace whole-DOM serialization and broad Node rerenders with editor transactions and bounded persistence work.
- [x] Implement textbox-only comments, replies, mentions, durable anchors, selected-quote fallback, pagination, and legacy-unanchored presentation.
- [x] Implement textbox-owned files and inline images with a Node-wide aggregate attachment view.
- [x] Implement Node-level email membership plus optional textbox/thread or textbox/message context and a deduplicated Node-wide email view.
- [x] Implement exactly the three primary timeline item types with stable newest-first cursor ordering.
- [x] Implement immediate local typing, undo/redo, save state, IndexedDB recovery, retry, idempotency, and safe refresh/navigation behavior.
- [x] Prove bounded Node loading, timeline pagination, comment pagination, lazy email bodies, attachment previews, and textbox virtualization at target scale.

Phase 2 completion gate: **Satisfied in repository and disposable production-path automation on 2026-07-28.** The user still performs the separate manual browser acceptance before any approved real conversion or cutover.

Evidence: `docs/backend/node-v2-phase2-completion.md` records implementation boundaries, the PostgreSQL-backed real-Mango browser workflow, target-scale scenarios (140 text boxes, 2,000 comments, 200 email threads/400 messages), focused checks, repeated disposable migration application, and the repository gate result. This implementation does not enable a live cutover or resolve the human-controlled development migration-ledger discrepancy.

### 2026-07-27 Phase 3 readiness re-audit

The implementation and disposable PostgreSQL/browser harness are substantial, but the project is **not ready for Phase 3 migration or cutover**:

- The runtime editor appends durable Yjs updates, but no production service calls the trusted checkpoint/materialization store method. The public checkpoint route is intentionally rejected, and the Hocuspocus PostgreSQL store remains a proof-of-concept script rather than a production service. Consequently inactive static rendering, plain-text/search consumers, and any other materialized-document reader can remain stale after ordinary edits.
- The REST update writer checks identity, size, and checksum but does not decode or validate Yjs semantics. The current PostgreSQL test persists arbitrary non-Yjs byte strings, proving that an edit client can durably poison later Yjs replay before a trusted provider is in the path.
- The Node v2 surface implements a bounded email summary/body viewer, but it does not yet preserve the current separate email column, message-to-textbox workflow, or textbox-owned chat behavior documented in `docs/important tasks/email nodes.md`.
- A verification request records text-box IDs, content revisions, and update heads, but it neither captures nor pins the referenced checkpoint/content. The seven-day update and 14-day checkpoint retention windows can therefore make the exact content presented for verification unreconstructable.
- Comment pagination limits root threads only; it loads every comment and mention for each returned thread. One heavily replied-to thread can still produce an unbounded page, and the 2,000-comment fixture does not cover that shape.
- Phase 1 still lacks the human migration-ledger reconciliation, shared HTML-to-Tiptap converter, dry-run conversion/validation, shadow-read, rollback, and post-cutover edit-preserving exporter.
- Node v2 attachment and email typed links intentionally use restrictive ownership constraints. A complete company purge therefore needs an explicitly ordered deletion workflow; generic company deletion is currently blocked after either link type exists.

This audit fixed two local correctness/test defects: every `/v2` route except the availability probe now enforces the workspace activation gate, and previously unreachable PostgreSQL assertions for email pagination and idempotent comment/attachment/email outbox writes now execute. Those fixes improve confidence in the implemented foundation but do not close the materialization, product-parity, migration, or lifecycle gaps above.

It is safe to continue Phase 3 engineering behind inactive workspace gates. It is not safe to activate converted workspaces, migrate development data, or cut over durable reads/writes until the open gates are implemented and exercised end to end.

### 2026-07-28 readiness closure

The re-audit findings above are retained as the historical acceptance record. The repository now closes each material implementation gap:

- The production Hocuspocus service is on the real Node v2 runtime path. It authorizes a short-lived exact document ticket, validates Yjs before commit, acknowledges only committed updates, materializes Tiptap JSON/plain text, compacts checkpoint plus tail atomically, quarantines failed sessions, and restores from PostgreSQL after restart.
- The public REST update endpoint rejects writes. Arbitrary bytes cannot enter the durable Yjs log through an ordinary client.
- The Node surface restores the separate email column, textbox chat, exact message-to-textbox placement, and complete inline-image actions.
- Verification records pin the exact checkpoint, head, revision, and every required tail update through retention.
- Initial comments and mentions are bounded, and a thread with more than one thousand replies is reachable through bounded continuation pages without duplicates.
- Company deletion has one ordered transactional purge function for restrictive comment-attachment, email, and attachment links.
- The owner-specific converter, ledger, shadow comparison, readiness gates, production Project/Logic Gate JSON readers and writers, activation, rollback export, and rollback are implemented. Rollback refuses stale coverage and preserves edits, creates, and deletes made after cutover.
- The real API/Vite/PostgreSQL/object-storage-compatible browser harness proves activation, typing, save, reload, navigation, Strict Mode remount, scroll/caret behavior, comments, email/chat parity, and inline-image selection, preview, alignment, download, and deletion.

All real company gates remain inactive. No development content was converted, no live reader or writer was cut over, and no legacy storage was removed.

### Phase 3 - Collaboration, migration, rollout, and cleanup

Status: **Engineering complete behind inactive gates; manual acceptance and every real conversion/cutover remain pending.**

Goal: add safe multi-tab/multi-user convergence, migrate existing dev workspaces gradually, and retire legacy systems only after the replacement is proven.

- [x] Add production Yjs synchronization, durable updates, checkpoints, exact durability snapshots, compaction, bounded awareness, session isolation, server authorization, commit-only acknowledgement, quarantine, and restart recovery.
- [x] Prove same-browser tabs, isolated clients, offline edits, reconnects, forced failures, concurrent undo, replay, duplicate/lost acknowledgement, compaction races, and service restart without overwrite or loss.
- [x] Load-test measured p50, p95, and 1.87-MiB source documents plus a 520-update stream with browser/network/API/server/database measurements and enforceable update/document/awareness limits.
- [x] Build the owner-specific, resumable dry-run/backfill converter while preserving source HTML and reporting checksums, warnings, comment-anchor handling, attachment references, failures, and retries. This check means tooling only; no development content was converted.
- [x] Build workspace gates, count/readiness validation, old/new checksum comparison, health/metrics logs, latency/failure signals, activation mechanics, current-state rollback export, and immediate atomic rollback. Every real gate remains inactive.
- [ ] Perform the separately approved real conversion and durable read/write cutover only after the user's manual browser acceptance and human migration-ledger reconciliation.
- [ ] Remove legacy readers, writers, tables, limits, and temporary migration infrastructure only through a later reviewed cleanup after the rollback window.

Phase 3 engineering gate: complete in repository and disposable proof. Operational completion remains pending until the user manually accepts the behavior, a human reconciles the development migration ledger, an explicitly approved conversion/cutover succeeds, its rollback window passes, and separate approval exists for cleanup.

## Development database read-only handoff

Development is the only live environment in scope for this project. Do not describe the current setup as a working production environment.

- PostgreSQL `psql` is installed on this Windows account.
- DBeaver has a connection named `MangoRTS READ ONLY` containing the non-secret development host and database metadata.
- `%APPDATA%\postgresql\pgpass.conf` contains the matching `mangorts_readonly` password for command-line use.
- The password file persists across laptop restarts and is read automatically for each exact matching `psql` connection.
- Never print, read back, copy into a prompt, or commit the password file. Check its existence with `Test-Path` or `Get-Item`, never `Get-Content`.
- A fresh Codex task running as the same Windows user needs no new password injection and no AWS SSO login for ordinary database reads. Use `psql -w`, `sslmode=require`, the exact DBeaver host/database values, and `user=mangorts_readonly`.
- Force audit sessions into read-only mode as defense in depth and verify `current_user`, role flags, and effective grants before broader inspection.
- If authentication fails, confirm that the host supplied to `psql` exactly matches the first field in `pgpass.conf` and that the password has not changed. If the connection times out, check the dev endpoint and network/security-group allowlist. Never fall back to a writer, owner, admin, migration, or application credential.

The verified 2026-07-26 audit connected directly from `psql` to the AWS development PostgreSQL endpoint as `mangorts_readonly`; DBeaver was not a proxy or intermediary.

### Verified development-database baseline (2026-07-26)

This evidence came from direct read-only catalog and aggregate queries against the actual AWS development PostgreSQL database, not from repository schema files. Raw textbox, comment, email, and filename content was not printed.

- The application has one non-system schema, `public`, with 94 tables, one view, and four sequences. `mangorts_readonly` has effective `SELECT` on all 94 tables and effective `INSERT`, `UPDATE`, and `DELETE` on zero tables; no application table has row-level security enabled.
- The database contains 811 Nodes, 1,080 `node_information` rows, 1,794 `node_projection_table` rows, 10,891 `node_content_changes` rows, and 17,714 `node_content_change_seen` rows.
- Current projection rows include 936 text boxes (26 deleted), 586 chat/comment records, and 272 attached-email records.
- `node_information` occupies about 3.58 GB, almost entirely PostgreSQL TOAST storage. `node_projection_table` occupies about 212 MB while its active projected `information` values total only about 3.5 MB. Treat this as strong storage/write-amplification and bloat evidence requiring deeper lifecycle analysis, not as proof that active user content itself is 3.58 GB. (DO NOT FOR THE LOVE OF GOD TIPTAP JSON CONVERT THIS TABLE)
- Current comments are JSON `Text block chat` records rather than normalized rows. All 586 have a resolvable block; 568 point to text boxes and 18 point to attached-email blocks. There are 148 replies, including one missing parent, 224 selected quotes, and 231 numeric legacy range pairs.
- Durable email storage currently contains 44 threads and 315 messages. The Node projection still contains 272 attached-email records, while the newer Node-email-thread link table contains 49 links covering 43 threads. Old and new email structures coexist.
- Attachment storage currently contains 796 attachment records, 818 active resource links, 444 variants, and about 424 MB of active file bytes. Ten active Node attachment links point to information records that no longer exist and require migration/repair policy.
- The dedicated timeline contains 24 Logic Gate movements and 12 verification requests, with 33 verification recipients and seven completed recipients.
- `editor_json_documents`, `editor_json_operations`, `editor_json_versions`, and `workspace_editor_formats` exist but are empty. The legacy collaboration tables contain 218 documents and 33,406 operations, including 182 Node documents and 31,255 Node operations.
- The applied migration ledger's most recent recorded application is dated 2026-06-21 even though newer editor/email/timeline objects exist. Reconcile how the dev schema acquired those objects before creating or applying Node v2 migrations.

These counts are a point-in-time baseline and will change as dev is used. Future agents should rerun bounded aggregate checks when implementation begins, but should not dump all user content or repeat broad scans without a specific need.

## Product foundation

Mango is fundamentally built on Logic Gates and Nodes.

- A Logic Gate represents a process, stage, or operating workflow.
- A Node represents a task, work item, case, or thing moving through processes.
- Nodes appear within statuses in a Logic Gate.
- Nodes may move between Logic Gates owned by different teams or people.
- Projects provide another organized workspace and contain multiple text boxes.
- Permissions and GVIC assignments are core business rules, not editor features.

Everything else should attach to those concepts cleanly instead of turning a Node into one giant content blob.

## One editor system, separate domain ownership

Logic Gates, Nodes, and Projects should use the same editor behavior and document schema, but they do not need to store their permanent content in one generic database table.

The desired product shapes are different:

- A Logic Gate normally has one large editor document.
- A Node contains multiple independently created text boxes.
- A Project contains multiple independently created text boxes.

The current direction is therefore:

- use one shared Tiptap/ProseMirror editor implementation;
- use one shared collaboration and persistence protocol;
- retain domain-specific permanent storage and real foreign keys;
- introduce a dedicated Node-text-box table;
- introduce a dedicated Project-text-box table;
- keep the Logic Gate information/projection structure unless detailed design proves a change is necessary;
- avoid a single permanent polymorphic `editor_documents` table merely for code reuse;
- avoid searching rich document source tables directly.

Candidate names such as `node_textboxes` and `project_textboxes` are architectural placeholders until the detailed schema is approved. This document does not approve a migration yet.

## Node product story

A Node is an evolving work record, not a static note.

Over its lifetime, a Node may contain:

- dozens of text boxes;
- thousands of chat messages spread across those text boxes;
- hundreds of emails and email replies;
- inline images and files;
- Logic Gate movement records;
- verification requests and stamps;
- permissions and GVIC assignments;
- future intentional Node snapshots;
- future Logic Gate-side records or snapshots of movement.

The Node ties those records together by identity. It must not physically embed all of them into one JSON object or load all of them into the browser at once.

## Node timeline

Each Node has a user-visible timeline ordered newest first.

The primary timeline has exactly three product item types:

- text box created;
- Node moved from one Logic Gate to another;
- verification stamp.

The movement actor, source and destination Logic Gates, timestamp, verifier, and verification state are fields of those records rather than additional timeline types. Comments, emails, attachments, autosaves, editor operations, and future snapshots are not primary timeline items. A future product decision may add another type explicitly, but implementation must not infer additional timeline types from ordinary timestamps or associations.

Every item type must share one stable ordering. A monotonic per-Node sequence is preferable to ordering solely by timestamp because timestamps can collide or arrive late.

The timeline should contain lightweight entries that reference authoritative business records. It should not duplicate full documents, email bodies, chat histories, or attachment bytes.

Current main already contains dedicated Node timeline and verification work. Read these before redesigning timeline storage:

- `docs/backend/node-timeline-verification.md`
- `backend/internal/store/node_timeline.go`
- `backend/internal/store/postgres_node_timeline.go`
- `backend/internal/http/node_timeline_handlers.go`

Preserve working timeline behavior during any editor or table migration.

## Three different meanings of history

Do not combine these into one retention policy or one table merely because they all involve time.

### 1. Editor collaboration and recovery history

This exists to deliver changes, recover offline work, resolve synchronization gaps, and compact a document. It is operational. Most of it should expire after safe acknowledgement and compaction.

### 2. Node business timeline

This is user-visible business history: a text box was created, a Node moved, or somebody verified work. It is permanent unless the product explicitly permits deletion.

### 3. Intentional snapshots

A future Node snapshot is a deliberate capture of the Node at a moment in time. It is a business record and must be retained according to product policy. It is not the same thing as an automatic editor checkpoint.

Typing a character must not create a permanent business timeline item. Removing an expired collaboration update must never remove a movement or verification record.

## Node text boxes

Each Node text box is an independent editor document and timeline object.

Required properties include:

- a stable text-box ID;
- Node ownership;
- creator and creation timestamp;
- placement on the Node timeline;
- independently loadable and editable content;
- independent collaboration state;
- an associated chat/comment area;
- optional anchored comments referring to selected text;
- attachment relationships;
- optional associations with email threads or individual messages;
- deletion and recovery semantics.

Editing one Node text box must not rewrite every other text box or the entire Node.

Newest text boxes appear at the top of the Node timeline. Oldest text boxes appear at the bottom.

## Project text boxes

Projects also have multiple independent text boxes. They should use the same Tiptap extensions, collaboration behavior, recovery behavior, and attachment rules as Node text boxes while remaining in Project-specific permanent storage.

Project and Node tables should not be combined simply because their editor UI is shared.

## Logic Gate editor

A Logic Gate normally has one large editor instead of multiple text boxes.

The current preference is to keep the Logic Gate information/projection pattern. Any retained projection should become a current materialized Tiptap representation rather than remain the authoritative legacy HTML synchronization system after cutover.

The large single-document nature of Logic Gates requires explicit performance testing. Removing an arbitrary application limit does not grant a browser infinite memory. Large Logic Gate documents may eventually require internal sections, block-level loading, or another form of logical segmentation while preserving a continuous editing experience.

## Editor experience requirements

The editor must support normal professional rich-text behavior:

- immediate character display;
- reliable background saving;
- correct undo and redo;
- bullet and numbered lists;
- indentation;
- headings and text formatting;
- tables;
- links and Mango `#` links;
- copy and paste;
- file attachments;
- inline pasted images;
- mentions;
- comments and highlighted references;
- navigation between linked entities;
- browser refresh recovery;
- network-disconnection recovery;
- safe navigation and unmounting;
- no silent loss of accepted or locally recoverable work.

Typing must update the local editor immediately and must not wait for a network response.

## Expected scale and loading behavior

Design for Nodes that contain weeks or years of activity.

Opening a Node must not eagerly load and mount:

- every Tiptap editor;
- every complete email body;
- every email message in every thread;
- thousands of chat messages;
- every image original;
- the entire business timeline;
- every collaboration subscription.

The preferred read sequence is:

1. Load the Node shell: name, status, access, GVIC summary, counts, and lightweight layout metadata.
2. Load the first cursor-paginated timeline page.
3. Render visible inactive text boxes with a lightweight static renderer.
4. Activate Tiptap and collaboration only for the text box being edited.
5. Load recent chat messages only for visible or opened text boxes.
6. Load email thread summaries only when the email column is open.
7. Load message bodies only after a thread or message is selected.
8. Load display images when visible and originals only on demand.
9. Fetch later timeline/chat/email pages with stable cursors.

The existing Node/Project row virtualization work remains useful and should be preserved.

## Email requirements

Emails are durable independent records, not editor-document content.

- An email thread may be associated with a Node generally.
- A thread may additionally be associated with one or more Node text boxes.
- A specific email message may be associated with a particular text box.
- The Node email column shows all email associated with the Node.
- Users navigate among threads and messages without opening every body at once.
- Mango should retain provider-independent email snapshots so a temporary provider outage does not erase the Node's working record.
- Email HTML remains email HTML; it should not be converted into Tiptap JSON merely because it is displayed beside a text box.
- Email attachment bytes remain in attachment storage and are referenced by IDs.

Current durable email foundations include:

- `communications_email_threads`
- `communications_email_messages`
- `communications_node_email_threads`

Legacy email association tables also exist and must be audited before removal:

- `communications_email_nodes`
- `communications_email_node_attachments`

The final association model may need to support a Node-level link plus optional text-box and specific-message links. Do not assume the current unique constraints support every required association.

## Chats and comments

Each Node text box has its own chat/comment area.

Expected scale includes thousands of messages across a Node, so chat must use dedicated, cursor-paginated storage rather than loading all `Text block chat` JSON payloads through a general Node projection.

The current implementation stores chat payloads in `node_information` and `node_projection_table` using the `Text block chat` information type. Payload fields include the block ID, parent message ID, author, message, mentions, attachments, selected quote, and legacy selection offsets.

A future normalized model will likely require dedicated message and anchor concepts, for example:

- one row per chat message;
- a parent-message reference for threading;
- a text-box reference;
- optional encoded start/end anchor positions;
- selected quote fallback;
- anchor state such as anchored, unanchored, or deleted-range;
- attachment relationships;
- edit/delete audit fields.

Exact table names and whether thread metadata needs a separate table remain open design work.

## Comments and migration of highlighted text

There are two distinct types of highlighting.

### Formatting highlight

User-applied background highlighting is part of the document and can be represented as a Tiptap highlight mark.

### Comment/chat anchor highlight

The comment or chat message is a separate business record. Its selected range is an anchor into the document and must survive edits when possible.

Existing legacy anchors use flat text offsets and selected quotes. ProseMirror positions and legacy HTML offsets are not interchangeable.

Confirmed migration policy:

- keep every existing comment/chat message;
- attempt to translate its legacy range;
- verify that the translated range resolves to the expected quoted text;
- preserve the quoted text;
- if the range cannot be proven, keep the message as unanchored;
- never silently attach a comment to the wrong text;
- do not block the entire migration merely because an old comment must become unanchored, provided the message and quote are preserved and the result is reported;
- new comments must use the new durable anchor mechanism.

If Yjs is selected, Yjs relative positions are a strong candidate for new anchors because they remain attached through concurrent edits and can resolve to null when the referenced content is deleted.

## Attachments and images

Attachment bytes do not belong in Tiptap JSON or PostgreSQL rich-document rows.

Current durable foundations include:

- `attachments` for permanent metadata and object-storage identity;
- `resource_attachments` for associations;
- `attachment_variants` for derived original/display/thumbnail/email-send variants;
- upload intent and upload part tables for temporary upload processing.

Tiptap nodes should store permanent attachment IDs and safe display metadata only. They must not store base64 image bytes, object URLs, presigned URLs, provider credentials, or transient upload state.

Upload processing rows and delivered/expired operational records require explicit deletion policies. Marking a row expired forever is not a complete retention design.

## Permissions and GVIC

Node, Logic Gate, and Project access remains server-authoritative.

- Editor or collaboration connections must be authorized against current Mango permissions.
- A client cannot grant itself access by knowing a document ID.
- Revocation must stop new updates and disconnect or downgrade active collaboration sessions promptly.
- GVIC and verification are business-domain records and timeline events, not fields hidden inside editor JSON.
- Applying permissions/GVIC to descendants remains separate from editor persistence.

## Correct editor technology terminology

Earlier conversation blurred distinct layers. Future work must use these terms precisely.

### Tiptap

Tiptap is the editor framework and application-facing API.

### ProseMirror

Tiptap is built on ProseMirror. ProseMirror provides the structured document model, transactions, steps, positions, selections, formatting behavior, decorations, undo/history primitives, and an optional centralized collaboration module.

ProseMirror is not merely an alternative to Tiptap, and it is not merely bullet-point formatting. Tiptap uses it.

### JSON

Tiptap/ProseMirror JSON is a structured representation suitable for validation, static rendering, export, indexing, backup materialization, and migration.

JSON alone does not solve concurrent editing.

### Yjs

Yjs is an optional CRDT collaboration data model. It can synchronize changes among tabs in one browser, different browsers, different devices, and different users. It is network-agnostic; providers handle cross-tab, IndexedDB, WebSocket, or other transport/persistence behavior.

Yjs is not only a same-computer sharing feature.

Official references:

- https://tiptap.dev/docs/editor/extensions/functionality/collaboration
- https://docs.yjs.dev/
- https://docs.yjs.dev/api/document-updates
- https://docs.yjs.dev/ecosystem/connection-provider/y-websocket
- https://docs.yjs.dev/ecosystem/database-provider/y-indexeddb
- https://docs.yjs.dev/api/relative-positions
- https://prosemirror.net/docs/guide/#collab

## Synchronization choices

Tiptap and ProseMirror remain the editor in every choice. The open question is how document changes synchronize and persist.

### Choice A: complete snapshots with exact revisions

This resembles the current inactive Tiptap foundation.

- Each batch serializes and sends the complete JSON document.
- The backend accepts it only when `base_revision` equals the current revision.
- A stale writer receives a conflict.
- The user chooses between the complete local or complete canonical document.

Advantages:

- conceptually simple;
- strong stale-write rejection;
- easy canonical snapshot reads.

Problems:

- work grows with total document size instead of edit size;
- complete snapshots consume API bandwidth;
- current storage duplicates the document across multiple tables;
- simultaneous edits do not merge;
- `keep-local` can replace remote work after rebasing only the revision number;
- weak same-browser tab coordination;
- poor fit for long offline editing.

This is not sufficient for the clarified multi-tab product requirement.

### Choice B: ProseMirror collaboration steps

ProseMirror can emit small editing steps. A central authority orders accepted steps, broadcasts them, and clients rebase unconfirmed local steps over remote changes.

Advantages:

- small updates;
- no complete-document request per typing batch;
- centralized authoritative ordering;
- uses ProseMirror-native transforms.

Costs:

- requires a correct collaboration authority;
- requires step retention and compaction;
- long offline rebasing and multi-tab recovery require significant custom engineering;
- the server must validate/apply compatible document steps.

### Choice C: Yjs collaboration updates

Tiptap's collaboration extension can bind the ProseMirror document to a Yjs document.

Advantages:

- small binary incremental updates;
- updates are commutative, associative, and idempotent;
- strong offline support with IndexedDB;
- existing cross-tab provider behavior;
- concurrent edits converge instead of triggering whole-document replacement choices;
- relative positions support robust new comment anchors.

Costs:

- introduces a collaboration component and operational model;
- requires update compaction and snapshot policy;
- consumes browser memory for the collaborative document;
- requires careful schema upgrades, auth, presence, undo-origin, and observability design;
- self-hosting Hocuspocus or another provider adds service/runtime complexity;
- the team must decide whether to self-host or use a managed provider.

Current recommendation: treat Yjs as a serious leading candidate and benchmark it against ProseMirror-step collaboration. Yjs is not yet an approved dependency or implemented architecture.

## Current multi-tab behavior and risk

The existing inactive Tiptap sync code has some important protections:

- each backend commit carries a base revision;
- PostgreSQL locks the current document row;
- stale base revisions are rejected;
- stable operation IDs deduplicate lost acknowledgements;
- pending work is stored in IndexedDB;
- exact document realtime events trigger recovery.

It does not provide complete multi-tab collaboration:

- the browser pending record key contains company/resource/document identity but not a tab identity;
- tabs editing the same document can overwrite the same IndexedDB pending record;
- there is no BroadcastChannel or Web Lock coordinating the Tiptap pending queue;
- the client ID is stored in `sessionStorage`; duplicated tabs may begin with copied session state;
- realtime events with the same client ID are ignored as local;
- concurrent full snapshots are not merged;
- conflict resolution is whole-document `keep-local` or `use-canonical`.

Relevant source:

- `frontend/src/modules/editor/tiptap/mangoTiptapSync.ts`
- `frontend/src/modules/editor/tiptap/MangoTiptapEditor.tsx`
- `backend/internal/store/postgres_editor_json.go`

Any new architecture must include real tests with several tabs, several users, network loss, reconnect, refresh, delayed acknowledgements, and edits to the same and different ranges.

## Offline and durability requirements

Required behavior:

1. A transaction appears locally immediately.
2. The local recoverable representation is persisted without waiting for the server.
3. The server acknowledges durable receipt separately from local display.
4. Lost acknowledgements do not duplicate an operation.
5. Reconnect sends or requests only missing work when possible.
6. A refresh restores unacknowledged work.
7. A user is warned if browser recovery storage fails.
8. Navigation cannot falsely claim an unsaved oversized or invalid state was flushed.
9. Two tabs cannot overwrite one shared pending record without coordination.
10. Accepted work cannot silently disappear.

## Undo and redo with collaboration

Undo semantics must be explicitly tested.

Expected behavior is normally origin-aware:

- a user undoes their own recent editing action;
- undo should not unexpectedly remove another user's unrelated remote change;
- remote updates remain visible;
- undo itself becomes a synchronized document update;
- tabs need unique origin identities even when owned by the same user.

If Yjs is used, use the collaboration-aware history/UndoManager path instead of enabling an independent ordinary ProseMirror history stack on the same document.

## One-GiB current editor-text limit per owner

The former arbitrary two-MiB Tiptap document cap has been removed. The product rule selected on 2026-07-27 is now one aggregate 1 GiB (1,073,741,824-byte) ceiling for the current editor content belonging to each individual Node, each individual Project, and each individual Logic Gate.

This is specifically a text/editor-document limit. It sums the serialized current Tiptap JSON for all active text boxes or editor documents owned by that one entity. It does **not** count attachment file/object bytes, attachment thumbnails, email bodies, chats stored outside the editor document, immutable editor versions, or Yjs update/checkpoint history. Small permanent attachment-reference nodes inside the Tiptap document remain ordinary JSON and therefore contribute only their tiny metadata size; the actual uploaded file remains separate.

Database triggers enforce the rule on the generic transition table and the permanent Node, Project, and Logic Gate current-document tables. Owner-scoped advisory locks serialize simultaneous writes so two text boxes cannot race past the aggregate limit. Node V2 also checks the materialized document before acknowledging a Yjs update as durable. When the limit is exceeded the user sees: "Mango gives each Node, Project, and Logic Gate a 1 GB editor-text limit. This counts only text and text-box document data. Attachments are separate and do not count toward the 1 GB."

Historical rows do not count because otherwise normal editing would eventually consume the limit without increasing the current visible content. The general HTTP request-body ceiling, per-update Yjs limit, structural validation, browser memory, and PostgreSQL physical limits remain separate technical boundaries.

The desired requirement is:

> Mango imposes no arbitrary product-size ceiling on a document. Persistence and synchronization scale with changes rather than repeated full-document saves, and the product never allows typing that it then silently refuses to preserve.

Physical infrastructure will always have finite memory, request, storage, and execution boundaries. Those must be handled through incremental updates, compaction, streaming, monitoring, progressive loading, and potentially logical sectioning rather than a surprising small content cap.

## Database-read performance: top five priorities

For ordinary scoped reads, the five most important factors are:

1. An index that matches the real `WHERE`, join, and `ORDER BY` pattern.
2. A small bounded result set using cursor pagination.
3. Narrow reads that select only required columns and avoid large bodies until needed.
4. Appropriate physical data organization, including domain-specific tables or partitioning when scale warrants it.
5. Cached or precomputed read projections plus healthy query plans/statistics.

Table size alone does not decide latency. A correctly indexed table with millions of rows can retrieve one Node's newest records quickly. A small table can still be slow if it performs unindexed filtering, expensive sorting, or returns huge payloads.

The reason for separate Node, Project, and Logic Gate permanent tables is primarily cohesive domain ownership, real foreign keys, simpler owner-specific lifecycle, smaller relevant indexes, and isolated workload. It is not because PostgreSQL necessarily scans every resource type in a correctly indexed generic table.

## Search architecture

Normal entity reads and full-text search are different access patterns.

Users generally view or search within a Node, Logic Gate, or Project context. The permanent content should remain domain-specific.

Do not repeatedly search nested Tiptap JSON directly. Maintain a derived search projection containing fields such as:

- company ID;
- source/owner type;
- owner ID;
- text-box/document ID;
- title or label;
- extracted plain text;
- PostgreSQL search vector or external-search document;
- visibility/permission scope;
- updated timestamp.

The search projection is rebuildable and not an authoritative editor store. Start with PostgreSQL full-text search if it meets measured needs; move to an external search service only when justified by actual scale or features.

## API and realtime boundaries

Use REST/HTTP for:

- Node, Project, and Logic Gate shells;
- cursor-paginated timeline pages;
- cursor-paginated chats;
- email thread summaries and message bodies;
- attachment metadata and signed download/upload coordination;
- permissions and GVIC;
- manual snapshots and other business commands;
- initial or materialized document state when required.

Use a document collaboration channel for:

- incremental editor updates;
- synchronization state vectors or missing steps;
- presence/cursors when enabled;
- collaboration-specific acknowledgements and recovery.

Do not send every keystroke through the general business `domain_events` stream or treat each keystroke as a Node timeline event.

Use the general realtime outbox for business-domain changes, not as an indefinite permanent record and not necessarily as the high-frequency document update transport.

## Candidate permanent data boundaries

This is a conceptual target, not an approved exact schema.

### Core business records

- `nodes`
- `logic_gates`
- `projects`
- permissions and GVIC tables
- Node/Logic Gate relationship and placement tables

### Domain-specific editor ownership

- candidate `node_textboxes`
- candidate `project_textboxes`
- retained/adapted Logic Gate information/projection storage

### Chat/comment data

- candidate dedicated text-box chat messages
- candidate dedicated anchor records or Yjs-relative anchor payloads
- compact per-user seen/read state rather than unbounded duplicated content

### Email data

- durable email threads
- durable email messages
- flexible Node-level and optional text-box/message associations

### Attachments

- permanent attachment metadata
- resource associations
- rebuildable display/thumbnail variants

### Business history

- Node timeline ordering/projection
- Logic Gate movement facts
- verification facts
- future intentional Node snapshots

### Derived data

- search projection
- static/renderable document projection
- counts/summaries/read models

### Operational data with explicit expiry

- collaboration updates already included in a compacted checkpoint;
- idempotency keys after their safe retry window;
- delivered realtime outbox rows after a replay window;
- completed, aborted, failed, or expired upload-processing rows;
- automatic recovery checkpoints outside retention policy.

## Concrete Node v2 relational model

The working architecture now has two deliberately separate layers:

1. **Ownership:** the permanent record states which Node and, when applicable, which text box owns it.
2. **Timeline placement:** a small Node timeline row states whether and where that record appears in the mixed chronological feed.

The timeline must never be the only relationship between a record and its Node. If the timeline projection is damaged or rebuilt, the authoritative text box, comment, email link, attachment link, movement, and verification records must still identify their Node directly.

The intended relationship shape is:

```text
Node
|- Node text boxes
|  |- Comment threads
|  |  |- Comments
|  |     |- Optional comment attachments, still owned through the text box
|  |- Text-box file and inline-image attachments
|  |- Optional text-box/email context links
|- Node email-thread links
|  |- Durable email thread
|     |- Durable email messages
|- Node movements
|- Verification requests
|  |- Verification events/stamps
|- Future intentional Node snapshots outside the primary timeline
|- Node timeline items pointing only to text boxes, movements, or verification stamps
```

### Permanent table map

The recommended permanent business tables are:

| Table or table family | Authoritative responsibility |
| --- | --- |
| `nodes` | Node identity and current basic state. |
| candidate `node_textboxes` | One current Tiptap document and collaboration checkpoint per independently editable Node text box. |
| candidate `node_movements` | Immutable Logic Gate/status movement facts. |
| candidate `node_verification_requests` | The request, assigned verifier, requested scope, and content state presented for verification. |
| candidate `node_verification_events` | Requested, approved, rejected, cancelled, or revoked verification actions/stamps. |
| candidate `node_timeline_items` | A small ordered read index pointing to records that appear in the Node feed. |
| candidate `node_textbox_comment_threads` | A conversation attached to a text box or selected range. |
| candidate `node_textbox_comments` | Individual messages and replies within one comment thread. |
| candidate `comment_mentions` | Explicit user/group principals mentioned by a comment. |
| `communications_email_threads` | Durable provider-independent email-thread identity. |
| `communications_email_messages` | Durable individual email messages and bodies. |
| candidate `node_email_threads` | The association between a Node and a durable email thread. |
| candidate `node_textbox_email_links` | Optional association of a Node text box with a thread or exact message already attached to that Node. |
| `attachments` | File identity, immutable object-storage metadata, hash, MIME type, and byte size. |
| candidate `node_textbox_attachment_links` | File or inline-image ownership by one exact Node text box; the Node-wide list is a query across these rows. |
| candidate `comment_attachment_links` | Attachment ownership by an exact comment. |
| `attachment_variants` | Rebuildable thumbnail/display/send variants. |
| candidate collaboration update storage | Small high-frequency editor updates with compaction and expiry. This is operational infrastructure, not a generic permanent content table. |

Exact names remain subject to schema review, but the ownership boundaries are the working decision. Permissions and GVIC remain separate business tables; they do not belong in editor JSON or timeline payloads.

## Node and text-box ownership keys

Every permanent Node-owned record must carry:

```text
company_id
node_id
```

Every permanent text-box-owned record must carry:

```text
company_id
node_id
textbox_id
```

Repeating `node_id` on a nested record is intentional. It makes the normal hot query a narrow tenant- and Node-scoped lookup instead of requiring several joins merely to discover the Node. It also lets permissions, deletion, export, and migration jobs operate on one Node without scanning unrelated owners.

Composite foreign keys must prevent cross-Node associations. For example:

```sql
foreign key (company_id, node_id, textbox_id)
references node_textboxes(company_id, node_id, textbox_id)
```

A comment, attachment, or email link therefore cannot claim a text box belonging to another company or Node. IDs should remain stable across migration; when practical, the legacy text-box `information_id` should become the new `textbox_id` rather than generating an unnecessary replacement identity.

Do not use unvalidated `owner_type` plus `owner_id` strings for these core business relationships. A generic owner pair is acceptable only for isolated operational infrastructure where domain content is not searched and where service-level validation, partitioning, retention, and orphan repair are explicit.

## Concrete Node text-box model

A Node text-box row should contain approximately:

```text
company_id
node_id
textbox_id
document_json
plain_text
document_schema_version
content_revision
created_by_user_id
created_timestamp
updated_by_user_id
updated_timestamp
deleted_timestamp

collaboration_checkpoint
collaboration_state_vector
compacted_through_sequence
materialized_through_sequence
```

The primary key or an equivalent unique key must include `(company_id, node_id, textbox_id)`. The hot list index should begin with `(company_id, node_id)` and support newest-first creation ordering with a stable ID tie-breaker.

`document_json` is the materialized Tiptap/ProseMirror document used for initial display, export, static rendering, and plain-text/search extraction. It must not be reserialized and rewritten for every short typing batch.

If Yjs is selected, small binary Yjs updates are the durable changes between checkpoints. A hot collaboration process may retain an active document in memory; a cold open loads the compacted checkpoint plus the un-compacted update tail. Compaction refreshes the checkpoint, state vector, materialized Tiptap JSON, and extracted plain text outside the critical typing path.

The product content remains in the domain-specific `node_textboxes`, `project_textboxes`, and Logic Gate storage. A shared collaboration-update table is acceptable because it is operational infrastructure rather than a user-facing content/search table. At scale it should be physically partitioned, indexed by document and sequence, and pruned only after a durable checkpoint includes the updates and the recovery window has elapsed. Three owner-specific operational tables remain an alternative if benchmarks or foreign-key requirements justify the duplication.

## Concrete comments and chats model

Node text-box chats and anchored comments should leave the mixed `information_type = 'Text block chat'` projection model.

A thread should own the selected-text relationship:

```text
node_textbox_comment_threads
  company_id
  node_id
  textbox_id
  thread_id
  selected_quote
  anchor_start
  anchor_end
  anchor_format
  anchor_status
  created_by_user_id
  created_timestamp
  resolved_by_user_id
  resolved_timestamp
```

Individual messages should remain small independently paginated rows:

```text
node_textbox_comments
  company_id
  node_id
  textbox_id
  thread_id
  comment_id
  parent_comment_id
  author_user_id
  body_text
  created_timestamp
  edited_timestamp
  deleted_timestamp
```

The thread, not every reply, owns the text anchor. Mentions and attachments should use explicit association rows rather than being discoverable only by parsing comment JSON.

If Yjs is selected, new comment anchors should use encoded Yjs relative positions so insertions and deletions before the selection do not invalidate ordinary integer offsets. Store the selected quote and a small amount of surrounding text as recovery/display context. When a relative position can no longer resolve because the selected content was deleted, the conversation remains available and becomes visibly unanchored instead of being deleted.

Comments are ordered and paginated within their thread. They normally do not each become a full Node timeline item because thousands of chat messages would overwhelm the primary Node feed. The main timeline contains the owning text box; opening its conversation pane loads comments by cursor. A future activity view may index comment events separately without changing their authoritative ownership.

## Concrete email associations

Email threads and messages are durable records independent of Nodes. An email thread may eventually be associated with more than one Node, so `communications_email_threads` itself must not contain one authoritative `node_id`.

Use a Node association such as:

```text
node_email_threads
  company_id
  node_id
  node_email_thread_id
  email_thread_id
  attached_by_user_id
  attached_timestamp
  detached_timestamp
```

Then use an optional text-box association:

```text
node_textbox_email_links
  company_id
  node_id
  textbox_id
  node_email_thread_id
  email_message_id nullable
  linked_by_user_id
  linked_timestamp
```

This supports all required cases without copying email content:

- a thread associated with the Node generally;
- a thread associated with one or more text boxes;
- an exact message associated with a text box;
- a Node-wide email column independent of the lifetime of any originating text box.

The text-box link must reference a Node-email link for the same `(company_id, node_id)`. It must not be possible to link a text box directly to a thread that is not attached to its Node.

The Node-open response loads thread summaries, not every body. Message bodies load in bounded pages or when a thread/message is expanded. Detaching a thread soft-deletes the Node association; it does not delete the durable email thread or provider-independent messages.

## Concrete attachment associations

`attachments` owns file metadata and object-storage identity. All file bytes remain outside PostgreSQL regardless of size or type. This applies to PDFs, spreadsheets, Word files, videos, uploaded images, and images pasted inline into Tiptap.

A typed text-box link may use:

```text
node_textbox_attachment_links
  company_id
  node_id
  textbox_id
  attachment_link_id
  attachment_id
  relationship_kind
  created_by_user_id
  created_timestamp
  deleted_timestamp
```

`textbox_id` is required. A Node file does not have a separate Node-wide owner row: the Node attachment screen aggregates active attachment links belonging to every text box owned by that Node. Composite foreign keys must prove that the text box belongs to the same `(company_id, node_id)`.

`relationship_kind` must use an approved value such as `file_attachment` or `inline_image`. An attachment used by a comment may additionally reference the exact comment, but it still carries and is owned through the same text box. Email-native attachments remain associated with `communications_email_messages`; they become Node text-box attachments only after an explicit user action creates the corresponding text-box link.

An inline Tiptap image stores only its permanent attachment ID and presentation attributes in `document_json`. The typed text-box attachment-link row is the authoritative ownership relationship. Never persist file bytes, Blob URLs, data URLs, object URLs, or presigned URLs in Tiptap JSON.

## Concrete Node timeline model

The Node timeline is the ordered read layer for exactly three business record types: text-box creation, Node movement between Logic Gates, and verification stamp. It contains small pointers and presentation metadata, never copied text-box documents or unrelated content.

A timeline row should contain approximately:

```text
company_id
node_id
timeline_item_id
timeline_sequence
item_type
occurred_at
recorded_at
actor_user_id

textbox_id nullable
movement_id nullable
verification_event_id nullable

summary_json
```

`occurred_at` is when the product event happened. `recorded_at` is when Mango committed it. The distinction supports backfilled movement history and delayed offline actions.

`timeline_sequence` is a stable tie-breaker when timestamps match. It may be a cached database identity/sequence rather than a contended per-Node counter. The normal ordering and keyset cursor are:

```sql
order by occurred_at desc, timeline_sequence desc
```

with a matching index beginning with:

```sql
(company_id, node_id, occurred_at desc, timeline_sequence desc)
```

A database check must allow exactly three `item_type` values and require exactly the corresponding source column:

- `textbox_created` points to `textbox_id`;
- `node_moved` points to `movement_id`;
- `verification_stamp` points to `verification_event_id`.

The verification record may carry pending, approved, rejected, cancelled, or revoked state, but those states do not create unrelated timeline types. Typed nullable source columns and check constraints are preferred over one unvalidated polymorphic source string. Adding any future timeline type requires an explicit product decision and reviewed migration.

`summary_json` is a deliberately small immutable display snapshot, for example the source/destination Logic Gate names recorded by a movement or the verifier name shown on a stamp. It may make the first page render without several joins, but it is not the source of truth and must be rebuildable from authoritative records.

### What appears in the primary timeline

The answer is fixed for Node v2:

- every created text box: yes;
- every Node movement between Logic Gates: yes;
- every verification stamp: yes;
- comments and replies: no;
- email threads and messages: no;
- files and inline images: no;
- autosaves, editor operations, checkpoints, and migrations: no;
- future intentional Node snapshots: no unless a later explicit product decision changes this rule.

Comments remain ordered and paginated inside their owning text box. Emails remain navigable in the Node email view and optional text-box context. Attachments remain navigable in the Node aggregate and owning text box. Their absence from the primary timeline does not weaken their direct ownership or timestamps.

## Movement and verification facts

`node_logic_gate_assignments` represents the Node's current location. It cannot also be the complete movement history. Each move should append an immutable `node_movements` row containing the Node, source and destination Logic Gates/statuses, actor, occurred timestamp, and any historical display-name snapshots required by the audit UI.

A verification stamp must identify a specific content state. It cannot mean "whatever the Node contains when somebody views the stamp later."

A verification request should record:

- requesting user;
- assigned Verified user at request time, even if GVIC changes later;
- request timestamp;
- scope, such as the whole Node or a specific text box;
- the exact Node snapshot or immutable manifest of text-box IDs and content revisions presented for verification;
- current request status.

`node_verification_events` should append the request and each approval, rejection, cancellation, or revocation. The visible stamp is backed by the exact event row, and the timeline points to that event. Later user-name, GVIC, or content changes do not rewrite what was originally requested or approved.

## Atomic association and timeline writes

Each user command must write the authoritative record, its timeline item when applicable, and its realtime/outbox event in one database transaction.

Creating a text box:

1. insert `node_textboxes`;
2. insert its `node_timeline_items` row;
3. insert the business realtime/outbox event;
4. commit all three together.

Moving a Node:

1. update the current `node_logic_gate_assignments` row;
2. insert an immutable `node_movements` row;
3. insert the movement timeline item;
4. insert the business realtime/outbox event;
5. commit together.

Recording a verification stamp:

1. update the request's current status;
2. insert the immutable verification event;
3. insert its timeline item;
4. insert the business realtime/outbox event;
5. commit together.

Attaching an email or file writes the association and its business realtime/outbox event atomically, but it does not create a primary timeline item. A unique idempotency key or source constraint must prevent a retry from creating duplicate associations or duplicate realtime delivery.

This prevents a timeline pointer to an uncommitted record and prevents an authoritative business event from committing without its required feed entry.

## Scalable Node workspace loading

Opening a Node should normally make one workspace HTTP request, but the backend should satisfy it with several small indexed queries instead of one enormous join that multiplies text boxes, comments, messages, and attachments together.

The first response should include:

- Node header and current placement/GVIC summaries;
- the first bounded timeline page;
- text-box documents referenced by the visible timeline page;
- email-thread summaries, counts, and cursors;
- attachment metadata summaries and counts;
- cursors or continuation tokens for every bounded collection.

It should not include:

- thousands of comments;
- every email body;
- attachment bytes;
- all historical timeline pages;
- old collaboration updates already represented by a checkpoint;
- editor documents outside the visible text-box window.

The API should collect the visible typed IDs from the timeline page and hydrate each type in a batch such as `where textbox_id = any($1)`. It must not issue one query per timeline row. Comments load when their conversation opens; email messages load when a thread opens; attachment bytes load through the attachment service only when previewed or downloaded.

This provides one convenient initial API call without creating one giant permanent table or one giant SQL join.

## Legacy HTML to Node v2 Tiptap JSON conversion

Only editor HTML becomes Tiptap/ProseMirror JSON. Comments, chats, email bodies, attachment metadata, movements, GVIC, permissions, and verification records remain typed database rows and associations.

The physical 3.58 GB `node_information` footprint is not the conversion input. The migration must follow the current authoritative projection or pointer, deduplicate by stable document identity, and create one target document for each real retained Node text box, Project text box, or Logic Gate editor. It must not convert superseded whole-document saves, obsolete collaboration operations, duplicate historical payloads, or other write-amplification debris into additional Tiptap documents. The 2026-07-26 audit found only about 3.5 MB of active projected `information` values; that is useful scope evidence, not a promised final converted size. Soft-deleted or otherwise recoverable editor documents require an explicit retention decision before backfill rather than being silently converted or discarded.

The repository currently has JSON storage and validation foundations but no approved complete legacy conversion pipeline. The converter should be a deterministic TypeScript/Node command using the exact same ProseMirror schema as Mango's editor. Tiptap's server-capable HTML utility can generate ProseMirror JSON from HTML when supplied the extension list; do not implement an independent approximate HTML parser in Go.

The conversion-safe extension factory must share node, mark, and attribute definitions with the browser editor while excluding UI-only plugins, DOM menus, uploads, provider connections, and other interactive behavior. Because static conversion does not run ordinary editor transaction hooks, the converter must explicitly add required stable block IDs and other migration-time attributes.

### Implemented one-document dry-run tool (2026-07-27)

The repository now includes `npm run convert:mango-html-to-json -- ...` in `frontend`. It uses Tiptap's official server `generateJSON` function with Mango's current extension factory. It reads one authoritative `editor_collaboration_documents.canonical_html` row inside a read-only transaction, rejects a database role that has insert/update/delete rights on the JSON table, and writes the JSON, validation report, browser preview, and guarded copy/paste SQL to a caller-selected local output directory.

The dry-run handles the legacy mention, checklist, highlight, text-color, and permanent attachment-image forms; adds deterministic block IDs; runs Mango's strict JSON validator; checks normalized visible text and important structure counts; and performs a Tiptap JSON-to-HTML-to-JSON round trip. It maps a chat selection only when its stored quote occurs exactly once in the converted document. Ambiguous or missing quotes stop SQL generation rather than producing a false highlight.

Example (use the designated read-only database credential):

```powershell
cd frontend
npm run convert:mango-html-to-json -- --company-id <company-id> --node-id <node-id> --document-id <textbox-information-id> --host <dev-db-host> --database <dev-db-name> --user <read-only-user> --sslmode require --output-dir C:\tmp\mango-json-trial
```

The generated SQL inserts one shadow row in `editor_json_documents`, verifies the source revision and checksum again, refuses to overwrite an existing JSON row, and does not change `workspace_editor_formats`. Inserting this SQL therefore does **not** make the normal site read that one JSON row. The current format switch is company-wide; visual testing on the normal site requires either a separately approved per-document preview path or a validated full-company conversion and cutover.

A representative development textbox dry run passed with 3,359 normalized visible characters, 15 bullet lists, 36 list items, one mention, one permanent attachment image, 12 linked chat/comment records, and six uniquely mapped selection highlights. This proves the one-document converter path, not the full backfill, migration ledger, all-document validation, or company cutover.

### Completed one-textbox browser experiment (2026-07-27)

This section records the exact local experiment and its result so another agent can reproduce it without reconstructing context from chat history. It was a deliberately incomplete one-document cutover for visual testing, not an approved company migration.

The test identity is:

- company: `11111111-1111-1111-1111-111111111111`;
- Node: `019f055e-c842-799b-83c9-f6adcd2375cb`;
- text box/document: `e0cf4c32-5ec2-4729-8308-8056ae4d0a9d`;
- recognizable content: the `07/20/26` HR huddle text box shown in the screenshots below;
- authoritative conversion source: `editor_collaboration_documents.canonical_html`, source revision `681`, MD5 `43f563b922ec62dd18b518f519662c58`;
- shadow target: one `editor_json_documents` row at revision `0`, with six `kind: "chat"` entries in `canonical_annotations`.

The user applied `20260718_tiptap_json_foundation.sql` and `20260719_zz_tiptap_annotation_positions.sql` to the local test database. At the time of this experiment, the user reported that the separate `20260726_node_v2_phase1_foundation.sql` and `20260727_node_v2_phase2_product.sql` migrations had not been applied. Those Node v2 migrations are not required merely to exercise the existing HTML-versus-JSON editor format gate.

The exact SQL artifacts used for this experiment are preserved with the screenshots:

- [`trial-insert-editor-json-document.sql`](assets/node-v2-tiptap-json-trial-2026-07-27/trial-insert-editor-json-document.sql) is the converter-generated, source-revision/checksum-guarded insert. It inserts the JSON document and six canonical annotation positions without changing the source HTML or the format gate.
- [`trial-cutover-to-json.sql`](assets/node-v2-tiptap-json-trial-2026-07-27/trial-cutover-to-json.sql) is the local-only company gate switch that the user ran after the insert. It refuses to run unless the exact test JSON row is present and is the only live JSON row for the company. It then records `expected_document_count = converted_document_count = 1`, marks the local experiment `ready`, and sets `editor_format = 'tiptap_json'`.
- [`trial-rollback-to-html.sql`](assets/node-v2-tiptap-json-trial-2026-07-27/trial-rollback-to-html.sql) restores `legacy_html` while deliberately retaining the shadow JSON row for comparison.

The cutover script intentionally makes the entire test company read JSON even though only one document was converted. Consequently, every other Node, Logic Gate, and Project editor in that company can appear empty, and database triggers reject legacy HTML writes while the gate is `tiptap_json`. This is acceptable only for the isolated local visual experiment. The count values in this trial are not evidence that every real company document was discovered or converted.

#### Before: legacy HTML on the development site

![Legacy HTML test text box, top](assets/node-v2-tiptap-json-trial-2026-07-27/before-html-top.png)

![Legacy HTML test text box, bottom](assets/node-v2-tiptap-json-trial-2026-07-27/before-html-bottom.png)

The legacy view shows nested solid and hollow bullets, indentation, paragraph spacing, the permanent inline image, bold text, a mention, the right-side chat, and yellow text ranges associated with six root chat selections.

#### After: converted JSON on the local site before frontend corrections

![Converted Tiptap JSON test text box, top before frontend corrections](assets/node-v2-tiptap-json-trial-2026-07-27/after-json-top.png)

![Converted Tiptap JSON test text box, bottom before frontend corrections](assets/node-v2-tiptap-json-trial-2026-07-27/after-json-bottom.png)

The first browser comparison established:

- all 3,359 normalized visible characters remained present;
- bold text, the mention, the permanent image, and the right-side chat remained visible;
- the JSON still contains the same 15 nested `bulletList` nodes and 36 `listItem` nodes, but the local browser displayed them as flat lines with no bullets or indentation;
- the six yellow comment-selection highlights were not visible, even though the converter stored their mapped ProseMirror ranges in `canonical_annotations`;
- this is presentation and annotation-integration failure, not evidence that Tiptap discarded the list tree or that the converter lost the text.

The confirmed frontend causes are outside the Tiptap HTML parser:

1. `MangoTiptapStaticRenderer` emits ordinary `ul`, `ol`, and `li` elements, while Mango's global reset removes all margins and padding. The JSON editor has no shared scoped list/paragraph CSS to replace the browser defaults for either the sleeping static renderer or the active `.ProseMirror` editor.
2. The converter stored annotations as `kind: "chat"`, and the shared renderer emits `mango-tiptap-annotation--chat`. There is no shared style for that class. The only related rule is scoped to `.node-v2-prosemirror .mango-tiptap-annotation--comment`, which has both the wrong scope for the current editor surface and the wrong annotation kind.

The immediate continuation on the same worker branch is to add shared, editor-scoped list/paragraph styling for static and active Tiptap rendering, add visible styles for `chat` and `change` annotations, and add focused regression coverage proving that a converted nested list and canonical chat range render with the expected structure/classes. The existing JSON row should not be reconverted merely to correct these display bugs.

Frontend correction status (2026-07-27): the shared presentation rules now live in `frontend/src/modules/editor/tiptap/mangoTiptap.css` and apply to both the sleeping static JSON renderer and the active ProseMirror editor. They restored the nested list tree and made the six canonical `chat` annotation ranges visible. The user then visually confirmed that all text, nested bullets, the permanent image, the right-side chat, and the yellow selections were present in the local JSON view.

![Converted JSON after the first list/highlight correction, top](assets/node-v2-tiptap-json-trial-2026-07-27/after-json-lists-highlights-top.png)

![Converted JSON after the first list/highlight correction, bottom](assets/node-v2-tiptap-json-trial-2026-07-27/after-json-lists-highlights-bottom.png)

The remaining comparison was presentation parity rather than lost rich text. A live computed-style comparison found the same Inter font family and normal weight in both versions, but the legacy editor used 14px text, a 20.3px computed line height, and 12px top/13px side padding, while the JSON editor inherited 16px text, used a 24.8px line height, and had no content padding. The JSON chat highlight was also darker amber with an inset gold line instead of the legacy bright-yellow gradient. The legacy reference is preserved below.

![Legacy HTML typography and highlight reference](assets/node-v2-tiptap-json-trial-2026-07-27/legacy-html-typography-reference.png)

The second frontend parity correction sets JSON editors to a 14px default font, an exact 20px line height, and 12px top/13px side padding; restores the bright legacy yellow chat/comment gradient; and uses the legacy four-level unordered-list marker sequence: solid circle, hollow circle, solid square, hollow square. Tests cover both sleeping and active editor selectors and four nested list levels.

The first trial row had already stored `07/20/26` and bold `HR / EA, Sammie Lee` in one paragraph because the legacy source represented their separation as visible root-level newline text. The existing row now gets a narrowly guarded display compatibility break, so it does not need a database rewrite. Future conversions replace visible root text newlines with real Tiptap `hardBreak` nodes before calling Tiptap's official `generateJSON`, with focused converter coverage.

The final browser comparison passed the intended visual trial. The user confirmed that the converted text box retained its complete visible text, bold text, nested list indentation and marker progression, permanent inline image, mention, right-side chat, and six bright-yellow comment selections. The corrected JSON view also matches the requested 14px font size, 20px line height, and legacy content padding. The paragraph separation between `07/20/26` and `HR / EA, Sammie Lee` is restored. These presentation corrections did not require rewriting the converted database row.

This success proves that one representative Node text box can be read from authoritative `editor_collaboration_documents.canonical_html`, converted with Tiptap's official HTML-to-JSON function, inserted additively, and displayed with its important rich-text structure intact. It does **not** prove complete Node/Project/Logic Gate discovery, batch conversion, production collaboration durability, all-document validation, workspace cutover, post-cutover rollback, or legacy cleanup. The experiment also exposed separate activation, save, scroll, caret-surface, and inline-image interaction problems. Corrections exist for several of those paths, but the next worker must exercise the real browser/API/database path again and close Phase 2 acceptance instead of treating this visual conversion as proof that editing is complete.

### This is where we are at now - Node textbox conversion plan (2026-07-27 20:38 PDT)

A fresh database-enforced read-only query confirmed the immediate conversion scope. `node_projection_table` contains exactly 937 distinct current rows with `type = 'Text box'`: 912 active rows and 25 deleted rows across 662 Nodes. Of those rows, 923 use the `<!-- mango-node-text-block-v1 -->` JSON metadata envelope and 14 store the legacy editor body directly. The converter must parse the envelope and pass only its `document` string to Tiptap; treating the complete projection payload as HTML is incorrect because it would convert the title/metadata wrapper as visible content. The extracted document bodies contain 559 nonempty Mango HTML documents and 378 empty bodies, total 2,836,472 bytes, with a largest body of 1,870,534 bytes. No source row currently has a matching `node_textboxes` target. The table also contains 583 active legacy `Text block chat` rows. These counts are the agreed current development-database baseline and will naturally change if the development company is edited before conversion.

The next real-data operation is deliberately narrower than the complete migration originally described above:

1. Convert the 937 Node `Text box` projection bodies from HTML to Mango Tiptap JSON. Do not convert Projects, Logic Gates, chats, email bodies, or other projection types in this operation.
2. Use the existing projection `information_id` as the stable textbox/document ID. The 912 active rows remain active; the 25 deleted rows are preserved as deleted/archived targets rather than becoming visible active textboxes.
3. Leave every source `node_projection_table` row untouched. The legacy HTML therefore remains available as the original source and rollback reference.
4. Produce the JSON once and store the same validated document in the transitional `editor_json_documents` path used by the successful one-textbox browser trial and in the final `node_textboxes` path with its initial Yjs migration checkpoint and `node_textbox_attachment_links` rows for every referenced inline image. This lets the current Node surface display the converted body while preparing the permanent Node v2 document.
5. Leave the Node v2 `editor_rollout_gates` owner gate inactive. The current Node shell and its legacy projection-table chat reader must remain in use while chat migration is deferred.
6. Leave the 583 active `Text block chat` projection rows in place for the later chat migration. The existing right-side chat remains available through the current shell. Ordinary rich-text marks and HTML highlights convert with the textbox body; chat-specific selected-text anchors, chat normalization, and exact jump-to-selection behavior are later work.

At this timestamp the development `workspace_editor_formats` row is already `tiptap_json`/`ready` with the original one-document trial counts (`1/1`), while `editor_rollout_gates` has no rows. The textbox content backfill deliberately does not mutate either gate: the existing workspace gate continues routing the current shell to `editor_json_documents`, and the Node v2 owner gate remains inactive. Replacing the temporary `1/1` metadata is a separate reviewed gate-reconciliation operation rather than part of the per-textbox content transactions.

The old Mango-specific 2 MiB Tiptap JSON document restriction has been removed because the real largest source is already approximately 1.87 MiB and JSON conversion can expand it. It is replaced by the aggregate one-GiB current editor-text limit per Node, Project, or Logic Gate described above. Attachments are separate and excluded. Structural validation and the platform request-body ceiling remain separate boundaries.

### How the 937 Node textboxes will actually be converted (2026-07-27 21:16 PDT)

Do not generate and paste 937 independent SQL statements. Use one reviewed, resumable migration program. The existing `frontend/scripts/mango-editor-migration.ts` already supplies most of the required machinery: official Tiptap conversion, batches, one transaction per item, source/target checksums, a conversion ledger, retry counts, warning/failure reports, shadow comparison, and resume by stable run ID.

The repository program now implements the 937-row Node path. For `--owner node` it reads every authoritative `node_projection_table` row whose type is `Text box`, including deleted rows; strictly extracts the `document` body from the current Node metadata envelope while supporting the 14 direct legacy bodies; uses `information_id` as both document and textbox identity; reports active/deleted and per-Node totals; and writes the same validated document to `editor_json_documents`, `node_textboxes`, and the initial Yjs migration checkpoint. It also seeds one permanent `node_textbox_attachment_links` row per distinct inline image attachment. Existing inline/file resource links are reused; if an embedded legacy image can only be resolved through an existing chat attachment object, a new `migrated_inline_image` resource link is added without changing the chat link. The active/deleted state is preserved in both document tables. The projection payload is locked only long enough to reject concurrent source drift and is never updated.

The disposable PostgreSQL proof covers one active enveloped projection row and one deleted enveloped projection row. It verifies strict body extraction, read-only inventory/dry-run behavior, exact dual targets, permanent attachment-link seeding, Yjs seed checkpoints, repeatable same-run backfill, shadow equivalence across all three JSON copies plus attachment identities, and byte-for-byte unchanged projection payload/deletion state. Its image begins with a chat attachment relationship; the proof confirms that backfill leaves that chat link untouched while adding the required inline migration/resource and permanent textbox links in the same transaction. It also begins with a mismatched revision-zero transitional trial row and proves that the current deterministic JSON replaces that unedited trial snapshot without deleting its existing annotation array. A transitional row with revision greater than zero remains conflict-protected. This is repository verification only; no development backfill has been executed.

The corrected database-enforced read-only dry run completed all 937 authoritative rows with zero failures under run ID `6d8dcc24-343b-4355-9f1f-16901d6875b6`. An earlier 53-failure report was not a valid body-conversion result: it exposed that the first Node query was passing the complete projection envelope to the HTML converter. That reader was corrected before any backfill. The zero-failure rerun converts only the extracted document bodies and covers empty documents, malformed legacy list/image nesting, empty formatting wrappers, entity-link server round trips, image metadata recovery, and an image-only hyperlink preserved on the attachment node.

The operational sequence is:

1. Use the reviewed migration program with `--owner node`; its source query reads only `Text box` projections, so every `Text block chat` row remains untouched.
2. Run `inventory` and `dry-run` with the database-enforced read-only credential. The report must show the expected 937 rows, every source checksum, converted JSON checksum, text/structure comparisons, warnings, and the per-Node aggregate byte total. No database rows are written in these modes.
3. Review the report and take/verify the required development backup. Keep the source projection HTML unchanged as the immediate rollback source.
4. Jonat starts a local terminal, places the development writer connection string only in the process environment as `MANGORTS_MIGRATION_DATABASE_URL`, and runs the reviewed `backfill` command with `--allow-write`, the exact company confirmation, backup reference, batch size, and stable run ID. The credential is never put in the repository, pasted into Codex, printed in logs, or granted permanently to an agent.
5. The program commits one textbox at a time, records success/failure in the ledger, and can be rerun with the same run ID. A failure does not require starting over and does not partially write that textbox.
6. Run shadow validation and verify 937 expected/converted rows, 912 active plus 25 deleted targets, 937 matching transitional rows and seed checkpoints, exact permanent inline-image attachment IDs/source links, zero failures, and zero unexplained text/structure mismatches. Keep the Node v2 owner gate inactive and do not activate, reconcile workspace-gate metadata, or clean up legacy data as part of this backfill.

This is the appropriate form of one-time database write access: the human-controlled migration process receives the writer connection only for that command. Codex prepares and verifies the program but does not receive the password or execute the live write. A giant generated SQL file remains possible, but it is the worse option because it is harder to resume, report, verify, and safely rerun.

Agreed continuation after this experiment:

1. Finish every reopened Phase 2 acceptance item and implement all Phase 3 code, services, migration tooling, automated verification, observability, and safe rollout controls behind inactive gates.
2. Do not perform a mass live HTML-to-JSON conversion or live workspace cutover in that implementation worker. After its automated verification passes, the user will manually test the completed behavior.
3. Run the real mass conversion as a separate, explicitly reviewed operation after manual approval, preserving the source HTML, migration ledger, checksums, warning report, and immediate rollback path.

No database or schema change is part of either frontend correction.

### Conversion sequence

For each current Node `Text box` projection:

1. Read the authoritative current legacy HTML and stable `information_id`.
2. Calculate and record a source checksum before transformation.
3. Sanitize the HTML using the approved legacy-input rules.
4. Discover legacy inline images and resolve/import them into permanent `attachments` before creating JSON.
5. Replace each image with a permanent Mango attachment reference; never carry temporary URLs into JSON.
6. Run the Tiptap HTML-to-JSON conversion with Mango's exact conversion-safe extension list.
7. Add deterministic stable block IDs so the same source and converter version produce the same identities on every rerun.
8. Wrap the ProseMirror document in the Mango format/schema envelope.
9. Validate the complete JSON contract, supported nodes/marks/attributes, safe links, mentions, tables, and attachment references.
10. Extract normalized plain text and compare it with normalized source text.
11. Compare important structural counts such as lists, tables, links, mentions, and images.
12. Insert or upsert the domain-specific `node_textboxes` target with an idempotent source mapping.
13. If Yjs is selected, seed the initial collaboration checkpoint from the validated ProseMirror document once; do not turn the migration into a series of synthetic keystroke updates.
14. Record the conversion result, target checksum, validation evidence, and any warning in the migration ledger.

The same converter core should support Project text boxes and Logic Gate documents through owner-specific readers/writers. It should never put all converted content into one generic permanent editor table merely for migration convenience.

### Logic Gate and Project conversion checkpoint (2026-07-28)

A database-enforced read-only inventory confirmed that the permanent targets already exist and are empty: `logic_gate_editor_documents` and `project_editor_documents` both contain zero rows before backfill.

- Logic Gate source: 68 active `Text box` rows across 65 Logic Gates in `logic_gate_projection_table`; zero deleted rows; 104,652 extracted HTML bytes; largest document 25,300 bytes.
- Project source: 23 active `Text box` rows across 13 Projects in `project_projection_table`; zero deleted rows; 19,215 extracted document-body bytes; largest document 5,934 bytes. All 23 Project rows use the `mango-node-text-block-v1` metadata envelope, so conversion extracts its `document` field rather than converting the envelope itself.

The migration CLI now reads these projection tables directly, uses `information_id` as the stable document ID, and targets `logic_gate_editor_documents` or `project_editor_documents`. It preserves the source HTML in the projection table and also records the source snapshot and checksums in the target. Project and Logic Gate conversion does not use the transitional `editor_json_documents` table or the Node Yjs checkpoint tables.

Read-only dry runs passed without warnings or failures: Logic Gate run `3f0dbdb2-74bf-4f95-9b94-419572dcf1ba` converted 68 of 68; Project run `a8c11d7d-faf7-44f0-b1c6-940e90bf297f` converted 23 of 23. Both target tables remained empty afterward. No backfill or activation was performed by the agent.

### Comment-anchor conversion

Legacy comment/chat payloads currently use a text-box/block ID, selected quote, and integer selection offsets. They must be migrated independently from editor content.

For each thread:

1. preserve the original conversation, author IDs, timestamps, reply relationships, mentions, and attachment references;
2. map the legacy owning `block_id` to the stable new `textbox_id`;
3. locate the selected quote in the normalized converted document using the old offsets plus before/after context;
4. classify the result as exact, uniquely recovered, ambiguous, or unanchored;
5. if Yjs is selected, convert a successful position into encoded relative start/end positions against the seeded document;
6. preserve ambiguous or unanchored conversations and show their quote/context without a false highlight.

Migration must never silently attach a comment to the wrong repeated phrase merely to achieve a 100-percent anchored count.

### Migration control and rollback

Conversion must be additive: it writes new owner-specific JSON/collaboration storage without overwriting or deleting the source HTML. Before the first real backfill or workspace cutover, take a verified restorable development-database snapshot or approved logical backup and record source checksums in the migration ledger. Keep the original HTML tables and readers intact throughout shadow comparison and the rollback window.

A cutover rollback must also preserve edits made after cutover. Before switching a workspace back to the legacy reader, either those edits must already have been safely mirrored through a controlled compatibility path or the current Tiptap document must be exported back to validated legacy HTML. Merely pointing users at a stale pre-cutover HTML copy is not an acceptable rollback.

Use an idempotent migration ledger with records such as:

```text
migration_run_id
company_id
source_owner_type
source_owner_id
source_document_id
source_checksum
target_document_id
converter_version
status
warning_or_error
target_checksum
converted_timestamp
validated_timestamp
```

The ledger is transitional data retained through conversion, validation, cutover, and the rollback window. It is not a permanent editor-history product.

Recommended rollout:

1. create the new owner-specific tables without changing live reads;
2. run the converter in dry-run mode against representative fixtures and production-shaped read-only samples;
3. take and verify a restorable backup before changing live dev data;
4. backfill only the deduplicated current/recoverable editor-document set in small resumable batches;
5. shadow-read and compare legacy and converted documents;
6. validate every expected document and association for one workspace;
7. cut over that workspace atomically;
8. retain legacy HTML and a tested immediate rollback path that preserves post-cutover edits;
9. observe real editing, multi-tab sync, comments, emails, and attachments;
10. retire legacy readers/writers only after the rollback period and explicit approval;
11. delete legacy and migration tables only through a later separately reviewed cleanup.

Do not combine table creation, bulk conversion, live cutover, and legacy deletion into one migration or deployment.

## Current table audit concerns

Before designing migrations, classify every existing table as authoritative, derived/rebuildable, transitional, or operational/expiring.

High-priority concerns already identified:

- `editor_json_documents` represents a useful current-document concept but is a generic polymorphic store that conflicts with the current preference for domain-specific permanent tables.
- `editor_json_operations` currently stores a complete document and annotations for idempotency.
- `editor_json_versions` currently stores another complete document and annotations for every accepted revision.
- `workspace_editor_formats` is an atomic migration gate and should not be mistaken for permanent product data.
- `node_content_changes` and `node_content_change_seen` are legacy/change-visibility structures that must be reconciled with the future document and annotation model.
- `editor_collaboration_documents` and `editor_collaboration_operations` are legacy HTML collaboration structures intended for removal after a successful cutover and rollback period.
- `node_information` and `node_projection_table` currently mix several information types. They cannot be deleted wholesale until each retained type has a permanent home.
- old and new email association structures coexist.
- published realtime outbox records need an explicit retention/deletion policy.
- editor JSON operations and versions currently have no identified pruning policy.
- upload cleanup removes abandoned storage objects but marks database intents expired instead of ultimately deleting every old processing row.

Never drop a table based only on its name. First prove every reader, writer, foreign key, background worker, recovery path, migration path, and production row has been replaced or intentionally retained.

## Why a large number of tables is not itself the problem

The problem is not table count. The problem is unclear authority and duplicated state.

A healthy architecture may legitimately have separate tables for Nodes, text boxes, chats, email messages, attachments, movements, and verifications because those records have different ownership, retention, indexing, and permissions.

Every permanent fact should have one authoritative home. Other copies must be explicitly one of:

- a rebuildable projection;
- an expiring delivery/recovery record;
- an intentional immutable business snapshot.

If two permanent tables both claim to be the current editable document, the architecture is wrong.

## Compute, latency, and API criteria

These are the main decision criteria requested by product.

### Compute

Prefer designs that:

- process the changed portion rather than the complete document;
- avoid parsing email HTML on unrelated editor keystrokes;
- do not mount inactive editors;
- compact updates off the critical typing path;
- do not duplicate complete snapshots on every accepted batch;
- avoid recomputing an entire Node timeline or search document during every read.

### Latency

Prefer designs that:

- render typing entirely locally;
- send small incremental updates;
- synchronize same-browser tabs immediately;
- load only visible or requested data;
- use stable cursor pagination;
- use static previews for inactive content;
- keep email, chat, attachment, and editor fetches independent.

### API usage

Prefer designs that:

- avoid full-document REST saves for ordinary typing;
- avoid one massive Node endpoint;
- batch only where batching reduces requests without increasing payload waste;
- use realtime collaboration for editor deltas;
- use HTTP for business resources and paginated reads;
- do not refetch complete email threads or complete Node projections after an unrelated character edit.

## Performance and durability acceptance scenarios

The future design should be proven against at least these cases:

### Large Node

- dozens of text boxes;
- thousands of chats across multiple text boxes;
- hundreds of email messages across multiple threads;
- many attachment references and inline images;
- long timeline with movements and verifications;
- bounded initial requests and mounted components;
- stable scrolling from newest to oldest.

### Large document

- plain and heavily formatted content at several realistic sizes;
- tables, lists, mentions, links, and attachment image nodes;
- immediate typing latency;
- incremental network bytes proportional to the edit;
- bounded compaction behavior;
- correct static preview and search extraction.

### Same-browser tabs

- six tabs open;
- two or more viewing the same document;
- two tabs editing different ranges;
- two tabs editing the same range;
- duplicated tab identity;
- one tab offline and reconnecting;
- one tab refreshing during unacknowledged work;
- no shared recovery record overwrite;
- deterministic convergence.

### Different users/devices

- simultaneous editing;
- permission differences;
- permission revocation while connected;
- presence and cursor behavior if enabled;
- local undo that does not remove unrelated remote work;
- anchor survival through concurrent insert/delete operations.

### Failure handling

- server unavailable;
- WebSocket reconnect;
- lost acknowledgement;
- duplicated update;
- out-of-order update;
- IndexedDB unavailable or quota failure;
- collaboration worker restart;
- partial compaction failure;
- schema/version mismatch;
- browser close immediately after typing.

Measure at minimum:

- local typing latency;
- React commit time;
- browser CPU and memory;
- bytes sent per edit/minute;
- server CPU;
- database bytes per editing minute;
- initial Node API bytes and request count;
- cross-tab and cross-device propagation latency;
- reconnect/convergence time;
- data retained after each failure.

## Immediate Phase 1 execution order

A fresh Codex task should read this document completely and continue the Phase 1 checklist rather than inventing another architecture or phase plan.

1. Read `docs/important tasks/!!!FIXEDITORSLOWNESS.md`, `docs/important tasks/realtimechanges.md`, the current Node timeline documentation, and the actual current readers/writers.
2. Reconfirm read-only dev access as `mangorts_readonly`; compare the live schema and migration ledger with current repository migrations without changing the database.
3. Complete the table-lifecycle map, including every current reader, writer, foreign key, projection, recovery path, retention rule, and proposed replacement.
4. Turn the confirmed ownership rules into one reviewed architecture decision record with exact DDL, indexes, deletion behavior, API contracts, cursor shapes, and transaction boundaries.
5. Run a bounded Yjs/provider proof of concept using representative Node text boxes and record update size, checkpoint cost, reconnect behavior, and server/database compute.
6. Implement and test additive repository migrations and inactive backend foundations; do not apply migrations to the live dev database from an agent session.
7. Implement the shared Tiptap schema and conversion wrapper, then run dry-run conversion against fixtures and carefully selected read-only dev samples.
8. Add shadow-read comparison, migration-ledger, rollback, scale, and failure tests required by the Phase 1 completion gate.

Do not begin Phase 2 UI cutover until the Phase 1 gate is reviewed. Do not combine table creation, bulk conversion, live cutover, and legacy deletion into one deployment.

## Decisions currently considered confirmed

- Mango's core product model is Logic Gates and Nodes, with Projects also using the shared editor behavior.
- Node and Project use multiple independently editable text boxes.
- Logic Gates normally use one large editor.
- Node text boxes, Project text boxes, and Logic Gate content should not be forced into one permanent generic table merely to share editor code.
- A dedicated Node text-box table is desired.
- A dedicated Project text-box table is desired.
- The current Logic Gate information/projection structure is preferred pending detailed review.
- Editor behavior and collaboration protocol should still be shared.
- A Node ties together timeline, text boxes, chats, email associations, attachments, permissions, GVIC, movements, verification, and future snapshots.
- Every permanent Node-owned record identifies its company and Node directly; text-box-owned records also identify the owning text box and use composite foreign keys that prevent cross-Node links.
- The Node timeline is a small ordered read index with typed pointers to authoritative records, not the sole ownership relationship and not a container for copied documents or bodies.
- The primary timeline contains exactly text-box creation, Logic Gate movement, and verification stamps; comments, emails, attachments, editor operations, and snapshots do not appear there.
- Current Node placement and immutable movement history are separate facts.
- A verification stamp records the exact content snapshot or revision manifest that was presented, along with the assigned verifier and immutable action history.
- Email association has two levels: durable thread-to-Node ownership plus optional text-box/thread or text-box/message links.
- Every Node file or inline image is owned through an exact text box; the Node-wide attachment view is an aggregate across its text boxes, while bytes remain in object storage.
- Comments belong to and are viewed within one exact text box; legacy comments attached to email blocks require explicit migration handling rather than becoming a supported new ownership type.
- Commands that create an authoritative record, a timeline item, and a realtime event commit those changes atomically and idempotently.
- Node open uses one convenient workspace API backed by several bounded indexed queries and batch hydration rather than one enormous join.
- Only legacy editor HTML converts to Tiptap JSON; comments, email, attachments, movements, GVIC, permissions, and verification remain typed rows.
- Heavy records remain separate and independently loadable.
- Emails remain durable independent HTML/message records.
- Attachments remain external bytes with permanent IDs and relationships.
- Chats must be paginated and should move away from a general mixed Node projection at the required scale.
- Existing comments must be preserved even if some legacy anchors become unanchored.
- New anchors must survive edits reliably.
- The arbitrary two-MiB Tiptap application limit is not an acceptable final product rule.
- Full-document serialization and full-snapshot persistence on every ordinary save do not meet the target scale.
- Multiple tabs and users must not silently overwrite each other.
- Yjs with self-hosted Hocuspocus is the selected collaboration direction for Node v2. The PostgreSQL update/checkpoint layout, commit-only acknowledgement, 512-update/512-KiB compaction triggers, and initial retention are now measured Phase 1 decisions; production sizing, observability, authorization integration, and rollout remain later implementation gates.
- Database and API decisions should prioritize lower compute, lower latency, and efficient API usage.
- Search should use a derived search projection rather than dictate one generic authoritative content table.

## Open decisions

- Production collaboration-service topology, capacity, observability thresholds, and staged rollout gates.
- The exact shared Tiptap extension/attribute list and converter-version policy, including deterministic block IDs.
- Whether users receive editor version history beyond intentional Node snapshots.
- Final conversion behavior for legacy unanchored comments and exact Yjs relative-position encoding in the shared Tiptap schema.
- How large Logic Gate documents are internally segmented if benchmarks require it.
- Whether `domain_events` becomes the deliberate permanent lightweight event log or is reduced/replaced; the Node timeline itself remains a typed read index over authoritative facts.
- Search technology and indexing cadence.
- Migration handling for legacy HTML documents that expand significantly during conversion.

## Important warning to future agents

Do not mistake the existence of a table, migration, or passing foundation test for product approval of the current architecture.

Do not:

- enable the Tiptap workspace gate;
- convert live data;
- delete old tables;
- remove or weaken the one-GiB per-owner text limit, attachment separation, or structural limits without an explicit product change;
- route product traffic through Yjs/Hocuspocus before production ticket authorization, observability, capacity, and rollout gates are reviewed;
- replace Node timeline behavior;
- merge comment records into editor JSON;
- convert email HTML to Tiptap;
- create permanent full snapshots for every typing batch;
- build a new generic editor table before resolving the domain-specific storage decision.

First establish the architecture, ownership, lifecycle, migration, rollback, and measurable acceptance criteria.

## Related documents

- `docs/important tasks/!!!FIXEDITORSLOWNESS.md`
- `docs/important tasks/realtimechanges.md`
- `docs/important tasks/speedupnodes.md`
- `docs/important tasks/email nodes.md`
- `docs/important tasks/makeemailsgood.md`
- `docs/backend/mangorts-database.md`
- `docs/backend/node-timeline-verification.md`
- `docs/frontend/src/modules/editor.md`
- `docs/tests/editor.md`
- `docs/tests/nodes.md`
- `docs/tests/attachments.md`

This file is the primary handoff for continuing the Node v2/editor architecture discussion. Where older planning documents conflict with the confirmed decisions listed here, future work must identify the conflict explicitly and obtain product approval rather than silently following the older plan.

## 2026-07-27 Node V2 Phase 1/2 quality-audit remediation

Status: **implemented and verified in the repository; live rollout remains blocked**.

The audit findings are closed in code and executable tests:

- ordinary input writes small Yjs deltas; browser blur/short-idle full checkpoints were removed;
- initial and archived workspace results are metadata-only with visible/explicit document hydration;
- stable cursor pages and a single-item move command make 145+ text boxes reachable without full-list reorder conflicts;
- PostgreSQL timeline and email pagination include stable unique tie-breakers;
- Yjs-relative comments render as durable decorations and support focus/navigation and detached/legacy fallbacks;
- pre-v2 schema bridges are capability-gated, while post-v2 business writes remain atomic;
- the full test gate retains frontend unit/contract tests, the production build, backend Go tests, and infrastructure contracts; the dedicated production-path realtime runner and API/Vite/Chromium/S3 browser harness were removed from CI on 2026-07-28;
- business mutations write idempotent domain events and realtime outbox rows in the same transaction, while high-frequency Yjs updates do not;
- checkpoint coverage is server-owned and public checkpoint claims are rejected;
- the workspace contract includes placement/GVIC summaries; and
- the build flag no longer globally replaces legacy Node workspaces without a ready server-side workspace gate.

Real PostgreSQL tests cover more than 140 text boxes, a 1-MiB document with measured delta/checkpoint/materialization writes, tied timeline timestamps, tied email orders, outbox rollback/retry, and pre-v2/post-v2 deployment states.

Phase truth is unchanged: Phase 1 is **still in progress** until a human reconciles the live schema/migration ledger and completes the shared TipTap converter plus dry-run, shadow, and rollback tooling. Do not convert the historical 3.58-GB editor-event pile. Convert only the current/recoverable deduplicated documents, retain legacy HTML throughout rollback, and require verified backup/restore boundaries. No live database was written by this work.
