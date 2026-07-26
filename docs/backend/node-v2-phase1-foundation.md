# Node v2 Phase 1 foundation decision record

Last updated: 2026-07-26

Status: implemented as an additive, inactive repository foundation. No live database was written, no editor gate was enabled, and no existing Node reader or writer was redirected.

## Completed milestone

This milestone turns the settled Node v2 ownership rules into:

- a current development-database and migration-ledger reconciliation record;
- an affected-table lifecycle map tied to current readers and writers;
- an exact owner-specific PostgreSQL model in `20260726_node_v2_phase1_foundation.sql` and the canonical schema;
- exact Node workspace, cursor, mutation, transaction, and collaboration contracts;
- a repeatable Yjs/Hocuspocus v4 proof of concept based on measured live text-box sizes; and
- schema contract tests that keep the forward migration and canonical schema identical and inactive.

This is not the complete Phase 1 gate. The live migration ledger still needs human reconciliation, the collaboration service still needs its PostgreSQL persistence/acknowledgement adapter and database compute measurements, and conversion/shadow/rollback tooling is not yet implemented.

## Read-only development evidence

The audit connected directly to the development PostgreSQL endpoint with `psql -w`, `sslmode=require`, and `mangorts_readonly`. Every audit transaction explicitly used `BEGIN TRANSACTION READ ONLY` and ended with `ROLLBACK`.

Verified on 2026-07-26:

- `current_user` was `mangorts_readonly`; `transaction_read_only` was `on`.
- The role is not superuser, cannot create databases or roles, cannot replicate, and cannot bypass row security.
- It has `SELECT` on all 94 application tables and `INSERT`, `UPDATE`, or `DELETE` on zero application tables.
- The repository contains 168 migration files; `schema_migrations` contains 87 rows and has no version unknown to the repository.
- The newest ledger entry is `20260621_z_gvic_matrix_projection_rebuild_relationship_rows.sql`, applied at `2026-06-21 15:46:32.764978+00`.
- 81 repository migrations are absent from the ledger. The gap is not a simple date suffix: several earlier versions are also absent while later versions are recorded.
- Newer physical objects nevertheless exist, including `editor_collaboration_*`, `editor_json_*`, `communications_node_email_threads`, attachment tables, and Node timeline tables.
- The exact prerequisite keys required by the new inactive migration exist physically: `(company_id,node_id)` on Nodes, `(company_id,attachment_id)` on attachments, `(company_id,node_id,email_thread_id)` on Node-email links, and the current email-message keys.

The physical schema therefore cannot safely be treated as “the 87 ledgered migrations.” It appears that canonical schema/bootstrap or other human-managed work created later objects without recording every migration version. The exact historical mechanism is not provable from the ledger alone.

### Migration safety consequence

Do not run the migration runner against development in its current state. It would try to execute 81 apparently missing migrations over a database that already contains many of their objects and data. Before any human applies the Node v2 migration:

1. take and restore-test an approved development backup;
2. diff the complete live catalog against a clean database built from the same commit;
3. classify every absent ledger version as physically equivalent, partially present, or genuinely absent;
4. repair the ledger only through a reviewed human-run reconciliation, never by blindly inserting all filenames;
5. rehearse the remaining migrations and this Node v2 migration on a restored disposable copy; and
6. preserve the reconciliation report with the rollout evidence.

The tracker’s live-ledger reconciliation item remains open until that human-controlled work is done.

### Bounded current text-box size evidence

An aggregate query over active `node_projection_table` rows with `type='Text box'` returned:

| Measure | Bytes |
| --- | ---: |
| Active rows | 910 |
| Soft-deleted rows | 26 |
| Minimum active payload | 36 |
| Median active payload | 205 |
| 95th percentile active payload | 5,716 |
| Largest active payload | 1,870,652 |
| Total active payload | 3,040,636 |

No document body was printed. One row is not valid JSON when cast directly, which is further evidence that conversion must sanitize and report individual legacy inputs instead of assuming one uniform JSON wrapper.

## Existing-table lifecycle map

Classification vocabulary:

- **authoritative**: the current durable business fact;
- **derived**: rebuildable current/read projection;
- **transitional**: exists only for migration or cutover;
- **operational**: delivery, synchronization, upload, or recovery state with explicit expiry required.

| Existing table/family | Current class and lifecycle | Actual reader/writer boundary | Node v2 decision |
| --- | --- | --- | --- |
| `nodes` | Authoritative Node identity; deleted through the existing recycle workflow. | `postgres_nodes.go` and Node/permission/Explorer stores read and mutate it. | Retain. Every new Node-owned row has a composite FK to it and physically cascades only when the Node is actually purged. |
| `node_information` | Mixed append/history storage currently containing text boxes, chats, attached email, and save debris. Retention is indefinite today. | `postgres_nodes.go`, editor saved versions, email/triage/project creation, attachment migration/compaction, recycle logic. | Legacy source only. Never convert the physical table wholesale. Select the deduplicated current/recoverable editor set, migrate other information types separately, and retain until rollback and every non-editor type has a home. |
| `node_projection_table` | Derived current Node projection and current live workspace read model. | Node detail/projection reads; Node/chat/email writers; editor collaboration materialization; view-version and dependency projections. | Remains the live read until a workspace cutover. Active `Text box` rows are the primary conversion inventory; projections remain recoverable and comparable through the rollback window. |
| `node_content_changes` | Current business annotation/change facts with flat offsets. | `postgres_nodes.go` creates/lists them; Node view versions and migration tools read them. | Preserve and migrate proven anchors separately. Do not make them primary timeline rows or editor JSON. Product retention after conversion still needs review. |
| `node_content_change_seen` and `node_projection_seen_snapshots` | Derived per-user seen state and compatibility snapshots. | Node change list/mark-seen paths and view-version queries. | Rebuild/replace only after new comment/change reads are active. Cascade with the underlying change/user; do not copy content into collaboration updates. |
| `editor_collaboration_documents` | Current authoritative legacy collaboration HTML per document. | `postgres_editor_collaboration.go` snapshots, patches, replacements, deletes, and materializes projections; saved versions read it. | Legacy HTML source and rollback source. No new Node v2 writes. Retain unchanged through conversion, shadow reads, cutover, and rollback. |
| `editor_collaboration_operations` | Operational legacy HTML-patch ordering, retry, and dedupe history with no cleanup policy. | Collaboration commit/rebase/recovery paths. | Stop writing only after Node v2 cutover. Retain through retry and rollback, then remove under a later cleanup migration. Do not convert operations into documents. |
| `workspace_editor_formats` | Transitional whole-workspace format gate, currently inactive. | `postgres_editor_json.go` reads it; a DB trigger rejects incompatible writes. No application endpoint mutates it. | Do not enable it for this milestone. A later gate must represent the reviewed owner-specific migration, verified counts, backup, and rollback readiness. |
| `editor_json_documents` | Inactive generic current JSON store. Empty in the audit. | `postgres_editor_json.go` and JSON HTTP handlers behind the inactive gate. | Superseded for Node permanent ownership by `node_textboxes`; retain untouched until the new migration/rollback plan explicitly retires it. |
| `editor_json_operations` and `editor_json_versions` | Inactive full-document operational/version copies. Empty in the audit and unbounded by retention. | Exact-revision JSON commit, delete, and version list paths. | Do not use for ordinary Node v2 typing. Retain untouched while inactive; later cleanup requires proof no workspace used them. |
| `logic_gate_information` / `logic_gate_projection_table` | Current Logic Gate domain information and projection. | Logic Gate editor/collaboration and projection stores. | Retain the domain-specific ownership model. Only actual editor HTML is conversion-eligible; no new generic permanent document owner is introduced here. |
| `project_information` / `project_projection_table` | Current Project domain information and projection. | Project editor, project creation, collaboration, and projection stores. | A later owner-specific `project_textboxes` migration will reuse the shared schema/protocol. Node v2 does not steal Project ownership. |
| `communications_email_threads` | Authoritative provider-independent thread snapshots. | `postgres_email_threads.go` upserts and reads threads and bounded messages. | Retain. Email stays independent HTML/message data. |
| `communications_email_messages` | Authoritative email message metadata and HTML bodies. | `postgres_email_threads.go`; communication/email handlers. | Retain HTML. The foundation adds only a unique thread/message key needed for a composite FK; it never converts email bodies. |
| `communications_node_email_threads` | Current authoritative Node-to-thread membership, with legacy `information_id` and selected-message fields. | Email import/read paths in `postgres_email_threads.go`. | Retain as the Node-level association to avoid a second authority. New optional text-box/message links must reference the same Node/thread key. |
| `communications_email_nodes` and `communications_email_node_attachments` | Older authoritative/compatibility email associations still read by Kanban, Logic Gate work, projections, triage, recycle, and migration tools. | The named store families plus communication conversion code. | Transitional coexistence. Do not drop until every reader is moved and rows are reconciled to durable threads/messages. |
| `attachments` | Authoritative attachment identity and object-storage metadata. | Attachment/upload/email/editor/chat handlers and `postgres_attachments.go`. | Retain. Bytes remain outside documents. Typed Node-text-box links reference `(company_id,attachment_id)` with delete restrict. |
| `resource_attachments` | Current generic active/soft-deleted association model. | `postgres_attachments.go`, upload completion, migration tools. | Migration source/compatibility layer. New Node links carry exact Node/text-box ownership and may retain the source link ID for audit. Ten known orphaned legacy Node links require explicit repair policy. |
| `attachment_variants` | Derived display/thumbnail/email-send objects. | Variant worker and attachment reads. | Retain as rebuildable data. Deleting a link never deletes authoritative bytes or variants implicitly. |
| `attachment_upload_intents` / `attachment_upload_parts` | Operational upload state. Expired rows can currently persist indefinitely. | Direct-upload handlers and `postgres_attachment_uploads.go`. | Retain current upload path; add a later bounded row-deletion job after object cleanup and audit retention are agreed. |
| `node_logic_gate_assignments` | Authoritative current placement, not history. | Assignment, Kanban, GVIC, Explorer, Project, access, and update stores. | Retain. A move transaction updates current placement and appends an immutable `node_movements` row. |
| `node_timeline_events` and `node_timeline_verification_recipients` | Current authoritative transfer/request stamps and recipient completion state. | `postgres_node_timeline.go`, Node timeline HTTP/UI, assignment transaction. | Preserve current behavior. Migrate into separate movement/request/event facts and the three-type index only during a later atomic cutover; do not replace now. |
| `domain_events` | Authoritative domain event/update feed used by projection and notification consumers. Retention purpose is broader than Node timeline. | `postgres_domain_events.go` and producer transactions. | Retain pending a separate event-log decision. Node v2 commands continue the atomic domain-event/outbox rule; typing updates do not become domain events. |
| `realtime_outbox` | Operational committed-event delivery log. Published rows currently have no deletion policy. | `postgres_realtime_outbox.go`, dispatch/consumer, producer transactions. | Retain for business events. Add a later replay-window cleanup. Yjs document updates use the collaboration service, not this general outbox. |

## New permanent and operational boundaries

The exact DDL is the source of truth. Its key boundaries are:

- `node_textboxes`: one owner-specific materialized Tiptap document per Node text box; no document-size check and no ordinary-character full-document rewrite.
- `node_textbox_yjs_updates`: idempotent binary update tail, ordered by a global identity sequence and deduplicated by document epoch plus SHA-256.
- `node_textbox_yjs_checkpoints`: binary Yjs recovery checkpoints plus the matching materialized JSON/plain text; automatic checkpoints are operational and expiring.
- normalized thread/message/mention tables: one exact text-box owner, a durable Yjs-relative anchor when proven, and an unanchored state when not proven.
- typed attachment links: every Node file/inline image belongs through one text box; comment attachments reference an already-owned text-box link.
- optional text-box email links: always reference an existing Node/thread association and, when present, an exact message from that same thread.
- immutable `node_movements`, verification requests/recipients/events, and a small `node_timeline_items` read index with exactly three item types.
- `editor_migration_runs` and `editor_document_migrations`: transitional backup evidence, source/target checksums, validation results, warnings, and rollback/export status.

Foreign keys intentionally use repeated `(company_id,node_id,textbox_id)` ownership keys. Historical movement/verifier IDs are snapshots rather than cascading user/Logic Gate FKs, so audit copy survives rename or removal. Attachment and email content is never cascaded from a text-box link.

## Node workspace HTTP contract

The APIs below are an exact reviewed contract for the next implementation milestone. They are not routed by this schema-only milestone.

### Initial workspace

`GET /v1/nodes/{node_id}/workspace-v2?company_id={company_id}&timeline_limit={1..100}&timeline_cursor={cursor}`

Default timeline limit is 30. The response contains:

```json
{
  "node": {},
  "placement": {},
  "gvic_summary": {},
  "counts": {
    "textboxes": 0,
    "comments": 0,
    "email_threads": 0,
    "attachments": 0
  },
  "timeline": {
    "items": [],
    "next_cursor": null
  },
  "textboxes": [],
  "email_thread_summaries": [],
  "email_next_cursor": null,
  "attachment_summaries": [],
  "attachment_next_cursor": null
}
```

The store executes separate bounded indexed queries in one repeatable-read transaction: Node shell/access, first timeline page, one batch hydration per timeline type using `WHERE id = ANY($1)`, email summaries, and attachment summaries. It must not perform a multiplicative join or one query per timeline item. Text-box JSON is returned only for text boxes referenced by the visible timeline page. Comments, email bodies, attachment bytes, old Yjs updates already covered by a checkpoint, and later timeline pages are excluded.

### Stable cursors

Timeline order is `occurred_at DESC, timeline_sequence DESC`. The opaque base64url cursor decodes to:

```json
{"v":1,"occurred_at":"2026-07-26T12:34:56.123456Z","timeline_sequence":12345}
```

The next-page predicate is:

```sql
occurred_at < $cursor_timestamp
or (occurred_at = $cursor_timestamp and timeline_sequence < $cursor_sequence)
```

Comment order is `created_timestamp DESC, comment_id DESC`; email messages use `(message_order,provider_message_id)`; email/attachment aggregate pages use their timestamp plus stable ID. Every cursor has a version, rejects unknown fields/invalid timestamps/nonpositive limits, and is applied only after the company, Node, and resource in the route have been authorized. A cursor is never used as authority.

### Text-box and bounded child resources

- `POST /v1/nodes/{node_id}/textboxes` creates a server-seeded empty Tiptap/Yjs document. It requires Node edit access and `Idempotency-Key`.
- `GET /v1/nodes/{node_id}/textboxes/{textbox_id}` returns the materialized JSON/plain-text revision, collaboration epoch, latest durable state vector, and attachment/comment counts after exact composite ownership validation.
- `GET /v1/nodes/{node_id}/textboxes/{textbox_id}/comments?limit=&cursor=` loads one bounded comment page. Replies remain in the same exact thread and use a stable cursor.
- `POST /v1/nodes/{node_id}/textboxes/{textbox_id}/comment-threads` creates a thread plus first comment atomically and idempotently. An unprovable anchor is stored as unanchored; the request is never attached to a different repeated quote.
- `POST /v1/nodes/{node_id}/textboxes/{textbox_id}/comment-threads/{thread_id}/comments` appends one reply atomically and idempotently.
- `POST`/`DELETE /v1/nodes/{node_id}/textboxes/{textbox_id}/attachments/{attachment_id}` changes only the typed link. Node-wide attachment reads aggregate active links across text boxes.
- `POST`/`DELETE /v1/nodes/{node_id}/textboxes/{textbox_id}/email-links/{email_thread_id}` optionally accepts `email_message_id`. The thread must already belong to the Node and the message must belong to that thread.
- `GET /v1/nodes/{node_id}/timeline-v2?limit=&cursor=` returns only `textbox_created`, `node_moved`, and `verification_stamp` items.

All create/link commands use an idempotency key limited to 160 UTF-8 bytes. A retry returns the originally committed resource and never creates a duplicate timeline item or realtime event.

## Transaction boundaries

Creating a text box commits in one PostgreSQL transaction:

1. insert `node_textboxes` with one migration/creation seed checkpoint;
2. insert `node_textbox_yjs_checkpoints` at sequence zero;
3. insert the `textbox_created` timeline item;
4. append the existing domain event and business realtime-outbox event; and
5. commit before returning success.

Moving a Node commits the current assignment update, immutable movement, `node_moved` timeline item, domain event, and outbox event together. Verification creation/decision commits the request/event/current status, exact manifest/recipient snapshot, `verification_stamp` item, notifications/domain event, and outbox event together. Email and attachment links commit their authoritative association and outbox event together but create no primary timeline item.

Yjs updates use a separate high-frequency transaction owned by the collaboration service: authorize the exact document, insert the deduplicated update, advance only the small text-box sequence metadata, and commit before a durable state-vector acknowledgement is emitted. They do not append `domain_events`, `realtime_outbox`, saved versions, or timeline items.

## Collaboration provider decision and proof

Selected direction for the next implementation milestone: self-hosted Hocuspocus v4 with Yjs 13.6.8, using Tiptap's collaboration extension in the browser and a repository-owned PostgreSQL persistence/acknowledgement extension. The provider is an independently deployed collaboration channel; Mango's Go API remains authoritative for tickets, permissions, Node business commands, attachments, and materialized workspace reads.

Hocuspocus was selected over a custom Yjs wire protocol because its official v4 server/provider already supplies the Yjs sync protocol, reconnect behavior, authentication hook, load/store hooks, multi-client fan-out, and a documented PostgreSQL-compatible binary persistence boundary. The built-in generic `Database` extension is suitable for the restart proof but is not the final write path: storing the full Yjs state on every debounce would restore write amplification and does not by itself prove Mango's `Saved` acknowledgement.

The final service must therefore add a custom persistence extension:

- exact document names are `node-textbox:{company_id}:{node_id}:{textbox_id}`;
- a short-lived ticket is issued by the Go API only after current Node edit authorization;
- Hocuspocus authenticates the ticket and rechecks revocation/expiry before accepting later writes;
- each raw Yjs update is SHA-256 deduplicated and appended before the server emits a durable acknowledgement;
- the acknowledgement contains the collaboration epoch, durable update sequence, and durable Yjs state vector;
- the browser clears only pending updates fully covered by that state vector;
- reconnect loads the latest valid checkpoint plus the un-compacted tail; and
- authorization revocation closes or downgrades active connections promptly.

### Measured proof

`npm run test:node-v2-yjs-poc` is repeatable and fails on a convergence, offline, or restart error. Its 2026-07-26 run used generated text at the live median, 95th percentile, and maximum byte sizes; no live document body was read.

| Scenario | Result |
| --- | ---: |
| Six-client initial p95 sync | 52.440 ms |
| Two-client concurrent convergence across all six clients | 15.732 ms |
| Offline edit plus online edit, reconnect, and convergence | 17.843 ms |
| Fresh server restore from persisted binary state | 18.216 ms |
| Client messages / bytes across the provider scenario | 44 / 5,142 |
| Final p95 persisted checkpoint | 5,928 bytes |

Direct Yjs codec evidence:

| Generated source | Initial checkpoint | 600 single-character updates | Merged update tail | Compacted checkpoint | Checkpoint encode |
| --- | ---: | ---: | ---: | ---: | ---: |
| 205 bytes (live p50) | 226 B | 12,000 B | 6,011 B | 826 B | 1.825 ms initial / 0.154 ms compacted |
| 5,716 bytes (live p95) | 5,737 B | 12,000 B | 6,011 B | 6,337 B | 0.219 ms / 0.105 ms |
| 1,870,652 bytes (live max) | 1,870,674 B | 13,200 B | 6,612 B | 1,871,274 B | 5.034 ms / 5.272 ms |

The test also applies the 600 updates in reverse order and twice; every case converges exactly. These are local Windows/Node measurements of Yjs text and Hocuspocus transport, not a claim about full structured Tiptap browser memory or PostgreSQL CPU.

### Compaction and retention contract

The initial policy for implementation is exact and intentionally conservative:

- compact after 512 durable updates, 512 KiB of un-compacted update bytes, or 15 minutes idle, whichever comes first;
- perform compaction outside the character-input acknowledgement path;
- write checkpoint, materialized JSON/plain text, text-box materialization sequence, and update `checkpointed_timestamp` values atomically;
- retain covered update rows for seven days after the covering checkpoint;
- retain automatic checkpoints for 14 days and never delete the newest two valid checkpoints for a document/epoch;
- retain an uncheckpointed update indefinitely until it is safely covered or explicitly quarantined;
- never remove a checkpoint/update belonging to the current collaboration epoch during cleanup; and
- start a new epoch only through an explicit schema migration or recovered-document reset with audit evidence.

The 512-update threshold keeps the measured raw tail around 11 KiB for ordinary single-character edits, while the byte threshold catches large pastes. These values must be load-tested with the real Tiptap schema and PostgreSQL adapter before the provider checklist is marked complete. There is no database document-size constraint. Operational WebSocket/frame, memory, and timeout protection must be based on the structured-document/browser/load evidence gathered next, with chunking rather than silent refusal for large edits.

## Conversion, shadow read, and rollback contract

The schema is additive and empty. The later converter must:

1. select only the current/recoverable authoritative editor-document set from Node, Project, and Logic Gate projections/canonical HTML;
2. record SHA-256 and source byte count before transformation;
3. sanitize legacy editor HTML and resolve inline images to permanent attachment IDs;
4. use Tiptap's server-capable HTML-to-JSON utility with the exact shared Mango schema;
5. add deterministic stable block IDs;
6. validate JSON, safe links, mentions, tables, and attachment references;
7. compare normalized visible text and structural counts;
8. seed one Yjs checkpoint, not synthetic keystroke history;
9. store validation/warning evidence in `editor_document_migrations`; and
10. leave legacy HTML untouched.

A real `backfill` run cannot enter `running` or a terminal state unless `editor_migration_runs` records a nonblank backup reference and verified timestamp. This database check supplements, but does not replace, a human restore test.

Rollback after cutover must export the latest materialized Yjs/Tiptap state back to validated legacy HTML or use a proven compatibility mirror before switching readers. Pointing the user to pre-cutover stale HTML is forbidden. Collaboration updates/checkpoints, conversion ledger rows, source HTML, and backup evidence remain through the rollback window.

## Verification expectations

The focused checks for this milestone are:

- Go schema-contract tests compare the marked migration block byte-for-byte with the canonical schema after transaction wrappers are removed.
- The contract rejects destructive SQL, workspace-gate activation, a JSON document-size constraint, email HTML storage, or legacy canonical HTML inside the Node v2 block.
- The Yjs/Hocuspocus proof runs twice and asserts six-client sync, concurrent convergence, offline replay, idempotent/reordered updates, and persisted restart restore.
- The full repository gate must apply clean schema and forward migrations to disposable PostgreSQL and pass all backend/frontend tests before commit.

No migration in this milestone may be applied to development until the migration-ledger blocker above is reconciled by a human.
