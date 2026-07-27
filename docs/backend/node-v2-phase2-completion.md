# Node v2 Phase 2 completion record

Last updated: 2026-07-27

Status: implementation record for the repository work behind `VITE_NODE_V2_PHASE2=true`. A 2026-07-27 Phase 3 readiness re-audit reopened Phase 2 acceptance because production materialization and current email/chat parity are incomplete. No live database was written, no production or development cloud resource was changed, and no legacy data was migrated or deleted.

## Product boundary

Phase 2 provides the complete single-active-editor Node v2 experience. A Node owns independent `node_textboxes`; Projects keep Project-specific storage and Logic Gates keep their information/projection model. Email remains durable provider-independent HTML and is never placed in Tiptap JSON. The primary Node timeline contains only text-box creation, Logic Gate movement, and verification stamps.

The feature flag is intentionally separate from the Phase 3 migration and rollout gate. Enabling it for a workspace that still relies on legacy Node text boxes requires the reviewed conversion, shadow-read, rollback, and migration-ledger work described by Phase 3. Phase 2 does not authorize applying its migration to a live database.

## Implemented experience

- Node text boxes create idempotently, load independently, reorder, archive, restore, edit, checkpoint, and reload without rewriting sibling documents.
- One visible text box owns the active Tiptap/Yjs editor. Inactive visible text boxes use the static Tiptap renderer and offscreen text boxes use `IntersectionObserver` placeholders.
- Tiptap transactions update a `Y.Doc`. Ordinary typing is merged into small Yjs updates after a 180 ms quiet period; full materialized JSON is written only at explicit or bounded checkpoint boundaries.
- Undo and redo use Yjs-aware Tiptap history. Startup clears the initial hydration capture so the first undo affects the user's edit rather than document loading.
- Each user/company/Node/textbox scope has separate `y-indexeddb` document recovery plus an IndexedDB pending-operation queue. The queue stores the exact payload and checksum before the UI reports that offline work is safe. Retry, lost-ack replay, checksum idempotency, polling merge, page-hide keepalive, and navigation flushes prevent silent overwrite.
- Textbox-only comment threads support root comments, replies, user mentions, selected quotes, before/after fallback context, encoded Yjs relative positions, stable cursor pagination, and explicit legacy-unanchored presentation.
- File and inline-image links use exact `(company_id, node_id, textbox_id)` ownership. Inline JSON stores only permanent attachment IDs and presentation fields. The Node attachment panel is a paginated aggregate and image bytes/previews continue through authenticated attachment storage.
- Existing durable Node email membership remains authoritative. Optional text-box/thread and text-box/message links reference that membership. The Node-wide view deduplicates threads, initially returns summaries only, and fetches sanitized message bodies only after selection.
- `node_timeline_items` enforces exactly `textbox_created`, `node_moved`, and `verification_stamp`. Ordering is newest first by timestamp, source sequence, and stable ID. Text-box creation and the existing movement/verification commands write their authoritative fact, timeline item, domain event, and realtime outbox work in one transaction.

## Backend and API boundary

`GET /v1/nodes/:node_id/v2/workspace` returns bounded text boxes, archived summaries, counts, one timeline page, and bounded attachment/email summaries without joining child collections into a multiplied result. Additional route groups provide:

- text-box create, order, archive/restore, sync-update, and checkpoint commands;
- timeline cursor pages;
- textbox comment pages, thread creation, and replies;
- Node-wide attachment pages and exact textbox attachment links;
- Node-wide email pages, lazy message pages, and exact textbox email links.

All routes require an authenticated company member with normal Node view or edit authorization. Composite foreign keys and transaction-scoped ownership checks reject cross-company, cross-Node, and cross-textbox relationships.

## Scale and durability evidence

Focused automated scenarios prove:

- 140 active text boxes with a workspace payload capped at 100 and 25-item stable timeline pages;
- 2,000 comment threads with 30-item cursor pages and independently persisted replies/mentions;
- 200 email threads and 400 durable HTML messages with 30-item aggregate pages, one-message lazy body pages, Node-wide deduplication, and both thread and exact-message textbox context;
- checksum-idempotent retry under a different client operation ID, checkpoint materialization, archive/restore, and exactly the three timeline item types;
- same-browser Yjs convergence, relative-anchor movement, IndexedDB recovery, pending-operation retry, bounded checkpoint rules, and the absence of whole-document `onUpdate` serialization.

The PostgreSQL-backed browser scenario uses the real Mango shell, a disposable local PostgreSQL cluster, and a disposable local S3-compatible test server. It verifies a Node with more than 30 active text boxes opens within the 10-second acceptance ceiling, mounts exactly one active editor, statically renders visible inactive documents, virtualizes offscreen documents, and provides accessible control/editor names. It also performs real typing, undo/redo, save/reload, archive/restore, anchored comment/reply, offline close/reopen recovery, file upload, inline-image insertion/preview, lazy email-body loading, HTML presentation sanitization, and durable textbox email linking.

## Verification completed

- `go test ./internal/store ./internal/http`
- `npm run test:node-v2-phase2`
- `npx tsc -b`
- `npm run build`
- `node frontend/scripts/node-v2-phase2-browser.test.mjs` against disposable PostgreSQL/API/Vite/S3 services
- Phase 2 forward migration applied twice to disposable PostgreSQL to prove idempotency
- `node scripts/run_all_tests.mjs`

The complete repository gate passed on 2026-07-27. Existing React test warnings about legacy surfaces remain warnings and did not fail the gate.

## Migration and rollout

`backend/db/migrations/20260727_node_v2_phase2_product.sql` is additive. It adds text-box display order and create-idempotency metadata plus comment thread/comment idempotency metadata and supporting indexes. The same definitions are present in `backend/db/schema.sql`.

No agent should apply this migration to development while the human-controlled development `schema_migrations` discrepancy documented in the Phase 1 record remains unresolved. A human rollout must first reconcile that ledger, rehearse on a disposable restored copy, apply both Phase 1 and Phase 2 additive migrations in reviewed order, then perform the separate Phase 3 conversion/cutover process. No document-size constraint or old two-MiB limit is introduced.

## 2026-07-27 quality-audit closure

The Phase 2 repository implementation now also includes:

- metadata-only initial workspaces, independently hydrated documents, stable active/archive cursors, incremental loading, and sparse single-item moves;
- versioned timeline, comment, attachment, email-thread, and email-message cursors with unique tie-breakers;
- rendered Yjs-relative comment decorations, click-to-focus navigation, moving-anchor behavior, and explicit unanchored/deleted/legacy fallbacks using the database's `none`, `legacy_offsets_v1`, `yjs_relative_v1` and anchor-status vocabulary;
- atomic, idempotent domain-event plus realtime-outbox writes for create, move, archive/restore, comments/replies, attachment associations, and email associations; Yjs typing remains outside the business outbox;
- trusted checkpoint authority: clients can append updates and read recovery state but cannot claim checkpoint coverage; and
- placement/GVIC data in the workspace header plus server/workspace-scoped activation so a global build flag cannot hide an unconverted legacy workspace.

`scripts/run_all_tests.mjs` now runs the executable Phase 2 durability suite and the production-path harness. That harness provisions disposable PostgreSQL, two API instances, Vite, Chromium, and an S3-compatible local fixture, then proves legacy-before-activation and V2-after-activation behavior in one command. Its V2 browser path covers bounded hydration, continuation, edit/reload/offline recovery, comments, archive/restore, attachment upload/inline image, and 35-message email continuation.

The Phase 2 implementation is present in the repository. Phase 1 migration/rollout is still in progress for the human ledger reconciliation, shared converter, and dry-run/shadow/rollback work listed in the foundation record. This change did not migrate a live database or authorize rollout.

## 2026-07-27 Phase 3 readiness correction

The later readiness audit found that the completion claim was broader than the exercised behavior:

- The browser sync controller persists Yjs updates, while inactive readers render `node_textboxes.document_json`. No production runtime invokes the trusted `CheckpointNodeV2TextBox` materializer that advances that JSON/plain-text state; the public checkpoint route rejects clients, and the Hocuspocus materializer exists only in the Phase 1 proof-of-concept script. The browser test proves that a static component mounts, but not that its content advances after an ordinary edit.
- The REST update endpoint accepts checksum-matching bytes without validating that they are a decodable Yjs update. The PostgreSQL integration fixture itself writes arbitrary byte strings, so a bad edit client can durably break replay before a trusted provider validates updates.
- The Node v2 email panel proves paginated summaries, lazy bodies, sanitization, and durable context links, but does not implement the current separate email-column interaction, message-to-textbox action/accent, or textbox-owned chat contract.
- Verification manifests record revisions and update heads without retaining the referenced content or checkpoint beyond normal recovery retention, so they do not yet guarantee that the content presented for verification remains reconstructable.
- Comment pages bound root threads but fetch all child comments and mentions for those roots. A single large reply thread remains unbounded and is not represented by the target-scale fixture.
- The PostgreSQL integration test accidentally nested email pagination and comment/attachment/email event assertions inside the timeline-count failure branch. The readiness audit moved those assertions onto the successful path; they now pass in the disposable production-path harness.
- Only the workspace reader previously enforced activation in the store. The readiness audit made the HTTP boundary reject all other Node v2 reads and writes until the workspace is active, while retaining an ungated availability probe.
- Typed attachment and email links block generic company deletion through restrictive foreign keys. The test harness now cleans them in dependency order, but the production company-deletion lifecycle still needs an explicit product-owned workflow before rollout.

Therefore the Phase 2 acceptance gate is reopened. The foundation is suitable for continued gated Phase 3 engineering, but not for workspace activation, migration, or read/write cutover.
