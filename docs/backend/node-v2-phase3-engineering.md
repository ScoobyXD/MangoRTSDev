# Node v2 Phase 3 engineering and rollout runbook

Last updated: 2026-07-28

Status: repository engineering complete behind inactive gates. Manual user acceptance, development migration-ledger reconciliation, real conversion, real cutover, and legacy cleanup are intentionally pending.

## Executive result

Node v2 now has a production collaboration authority, exact durable acknowledgement, materialization, recovery, compaction, bounded awareness, observability, owner-specific conversion/cutover storage, resumable migration tooling, shadow/readiness checks, and a rollback exporter that preserves changes made after cutover. The production browser/API/PostgreSQL path and disposable load workflow exercise these systems without enabling a real company.

This work did not write to a live database, apply a migration to development, convert development content, activate a real company, redirect live reads or writes, or delete legacy storage.

## Completion matrix

| Scope | Repository state | Operational state |
| --- | --- | --- |
| Phase 2 materialization and safe Yjs writes | Complete and exercised | Manual browser acceptance pending |
| Email column, textbox chat, message-to-textbox parity | Complete and exercised | Manual browser acceptance pending |
| Verification retention pins | Complete and exercised | No live retention job enabled by this work |
| Bounded reply-heavy comment pagination | Complete and exercised with 1,002 comments in one thread | No live gate enabled |
| Ordered company purge | Complete and exercised transactionally | Human deletion workflows must call it before company deletion |
| Production Yjs collaboration service | Complete and exercised with isolated clients/restarts | Deployment and capacity approval pending |
| Shared exact schema and official conversion path | Complete for Node, Project, and Logic Gate | No real content converted |
| Resumable conversion/shadow/readiness tooling | Complete and exercised on fixtures | Human ledger reconciliation and approved backup/restore rehearsal pending |
| Owner-specific Project/Logic Gate cutover reads and writes | Complete and exercised | All real owner gates inactive |
| Workspace activation and atomic rollback | Complete and exercised on disposable PostgreSQL | Requires separate explicit approval |
| Post-cutover edit/create/delete export | Complete and exercised, including stale-export refusal | No real rollback/export run occurred |
| Legacy deletion/cleanup | Readiness plan only | Intentionally deferred until after cutover and rollback window |

## Runtime authority

The browser obtains a two-minute HMAC ticket from the Go API for one exact user, company, Node, and textbox. The Hocuspocus service rechecks company/workspace and document authorization on connection and update. It rejects inactive gates, expired or mismatched tickets, oversized awareness, oversized updates, and updates that Yjs cannot decode.

An update is acknowledged only after the PostgreSQL transaction commits. The acknowledgement contains the durable sequence, checksum, state vector, and exact Yjs snapshot. Exact snapshot equality matters because a state vector alone cannot prove delete sets. A failed write emits no durability acknowledgement, quarantines that in-memory document, and closes its sessions so reconnect loads only durable checkpoint-plus-tail state.

The service materializes the shared Tiptap document and plain text after ordinary edits, compacts atomically, and restores after restart. The browser keeps y-indexeddb recovery plus one explicit pending-server-durability update. It does not display Offline as recoverable until that record is durable locally, and it does not clear the record until PostgreSQL proves the exact snapshot.

Default enforceable limits are:

- 8 MiB per Yjs update;
- 100 awareness clients and 16 KiB encoded awareness state per document;
- 12 collaboration database connections and a 15-second statement timeout;
- materialization scheduling after 1.5 seconds, with compaction at 512 tail updates or 512 KiB;
- one aggregate 1 GiB ceiling on the current editor JSON owned by each Node, Project, or Logic Gate; attachment object bytes, immutable versions, and Yjs update/checkpoint history are separate and excluded; and
- seven-day covered-update and 14-day superseded-checkpoint retention, except exact verification pins.

`GET /healthz` reports service/database readiness. `GET /metrics` reports active/accepted/rejected connections, durable update count/bytes, duplicate updates, acknowledgement transaction time, awareness rejections, persistence failures, and compaction failures. Initial deployment gates should stop activation on any persistence/compaction failure, repeated authorization anomalies, missing materialization, or sustained acknowledgement latency above the reviewed environment budget. Start with a 250 ms p95 warning threshold and revise it only from measured deployment data.

## Owner-specific storage and conversion

The converter reads only current/recoverable `editor_collaboration_documents` for Node, Project, and Logic Gate. It never scans or converts the bloated historical `node_information` event pile.

All owners use the same Mango Tiptap schema and official Tiptap HTML-to-JSON/Yjs bridge. Permanent current documents remain domain owned:

- Node: `node_textboxes` plus `node_textbox_yjs_updates` and `node_textbox_yjs_checkpoints`;
- Project: `project_editor_documents`, its operations, and its versions; and
- Logic Gate: `logic_gate_editor_documents`, its operations, and its versions.

After an exact Project or Logic Gate owner gate becomes active, the existing JSON HTTP contract routes reads, commits, deduplication, revision history, deletes, annotations, and plain-text materialization to those owner tables. It does not create a current row in the generic `editor_json_documents` table. Before activation, the legacy/generic path remains unchanged.

The converter records a deterministic identity from company, owner, document, source revision, and source SHA-256. A resumed run must match its company, owner selection, compatible mode, batch size, backup reference, and expected count. Source or target identity conflicts fail closed. Each item retains the authoritative source HTML snapshot, source/target hashes, warnings, comment-anchor report, attachment-reference report, retry count, and failure report.

## Migration commands

All examples run from `frontend`. `MANGORTS_MIGRATION_DATABASE_URL` must point to the exact reviewed database. Inventory and dry-run begin a read-only transaction. Every mutating mode requires `--allow-write` and an exact company-specific confirmation. Backfill, shadow, activation, export, and rollback also require a reviewed backup reference.

```powershell
# Read-only inventory
npm run migrate:mango-editors -- --mode inventory --company <company-uuid> --owner all --run-id <run-uuid>

# Read-only conversion and report; no target or ledger writes
npm run migrate:mango-editors -- --mode dry-run --company <company-uuid> --owner all --run-id <run-uuid> --batch-size 100

# Human-approved resumable target/ledger writes
npm run migrate:mango-editors -- --mode backfill --company <company-uuid> --owner all --run-id <run-uuid> --batch-size 100 --allow-write --backup-reference <restore-tested-backup> --confirm "BACKFILL <company-uuid>"

# Persist exact old/new comparisons
npm run migrate:mango-editors -- --mode shadow --company <company-uuid> --owner all --run-id <same-run-uuid> --allow-write --backup-reference <restore-tested-backup> --confirm "SHADOW <company-uuid>"

# Write ready/shadow owner gates from expected/converted/failed/comparison counts
npm run migrate:mango-editors -- --mode readiness --company <company-uuid> --owner all --run-id <same-run-uuid> --allow-write --confirm "VALIDATE <company-uuid>"
```

Do not run the following activation/export/rollback commands merely because they exist. They are separate operations requiring the user's explicit approval:

```powershell
npm run migrate:mango-editors -- --mode activate --company <company-uuid> --owner all --run-id <same-run-uuid> --allow-write --backup-reference <restore-tested-backup> --confirm "ACTIVATE <company-uuid>"
npm run migrate:mango-editors -- --mode rollback-export --company <company-uuid> --owner all --run-id <new-export-run-uuid> --allow-write --backup-reference <restore-tested-backup> --confirm "EXPORT <company-uuid>"
npm run migrate:mango-editors -- --mode rollback --company <company-uuid> --owner all --run-id <same-export-run-uuid> --allow-write --backup-reference <restore-tested-backup> --confirm "ROLLBACK <company-uuid>"
```

Activation requires all three owner gates ready with exact expected/converted counts, zero failures, zero shadow mismatches, and validation timestamps. Rollback first requires a current export covering every exact revision and Node update sequence. It atomically changes the workspace to legacy, restores/creates the latest legacy HTML rows, preserves delete state, and marks the owner gates rolled back. A stale export is rejected.

## Development migration-ledger reconciliation

The known development database has physical objects newer than its recorded migration ledger. No agent should guess which missing versions were applied or insert ledger rows based only on filenames.

The migration runner now has a read-only audit mode. It skips the advisory migration lock, starts a repeatable-read read-only transaction, verifies that PostgreSQL reports the transaction read-only, and reads only identity, table count, migration filenames, and ledger versions. With the existing exact read-only password-file entry, no password needs to be retrieved or placed in an environment variable.

From `backend`:

```powershell
$env:DB_HOST = '<exact-development-host>'
$env:DB_PORT = '5432'
$env:DB_USER = 'mangorts_readonly'
$env:DB_NAME = '<exact-development-database>'
$env:DB_SSLMODE = 'require'
go run ./cmd/miraeopus-migrate -mode audit -migrations db/migrations
```

Required human procedure:

1. Take a reviewed backup and prove a restore into a disposable database.
2. Run audit mode against development with the database-enforced read-only identity. Save only filenames/counts; do not expose credentials or application content.
3. Create a clean database from this exact commit and compare catalogs for every missing migration: tables, columns, constraints, indexes, functions, triggers, and required data transformations.
4. Classify each missing version as physically equivalent, partially present, or absent. Never infer equivalence from a later table's existence alone.
5. Prepare reviewed reconciliation SQL that inserts ledger rows only for versions proven physically and semantically equivalent. Keep partial/absent versions out of the ledger.
6. Apply the reconciliation and remaining migrations first to the disposable restored copy. Run the full repository and conversion dry-run gates there.
7. A human with the separately managed migration credential may then execute the reviewed development operation. Agents must not retrieve that credential or perform the live write.
8. Rerun audit mode and retain the before/after report and backup reference.

This repository work provides the audit and procedure; it does not claim the human reconciliation happened.

## Disposable verification and measurements

The Phase 3 proof uses PostgreSQL 18 with `synchronous_commit=on`, generated/fixture content at the previously measured live p50 (205 bytes), p95 (5,716 bytes), and maximum (1,870,652 bytes), and no live content output.

The latest successful proof measured:

| Scenario | Result |
| --- | --- |
| Six-client concurrent durable convergence | 15.526 ms |
| Offline reconnect durable convergence | 11.746 ms |
| Provider restart restore | 15.369 ms |
| Production service restart restore | 9.276 ms |
| p50 append transaction p50 / p95 | 2.591 / 4.106 ms |
| p95 520-update append p50 / p95 | 2.163 / 3.498 ms |
| p95 520-update compaction | 20.614 ms |
| 1.87-MiB append p50 / p95 | 9.828 / 12.271 ms |
| 1.87-MiB compaction | 141.531 ms |

The same proof covers invalid update rejection, failed-write acknowledgement suppression, lost-ack deduplication, failed-compaction atomic rollback/recovery, exact delete-set snapshot proof, three-owner conversion, resumable retry, three shadow matches, inactive-gate rejection, activation, stale rollback-export rejection, and restoration of post-cutover edits, creates, and deletes.

The production-path harness provisions disposable PostgreSQL, the real Go API, the production collaboration service, Vite/React in Strict Mode, Chromium, and an S3-compatible fixture. It exercises real typing/save/reload, navigation, offline close/reopen recovery, comments, email/chat, archive/restore, attachments, and inline-image actions. `node scripts/run_all_tests.mjs` remains the final repository gate.

## Manual browser acceptance before any real conversion

The user should perform this checklist against a disposable or explicitly approved non-live fixture with the workspace gate isolated to that fixture:

1. Open a large Node and confirm the editor, textbox-chat, and email columns are distinct and scroll independently as intended.
2. Activate a textbox, type in the middle and at both ends, use Enter/lists/formatting, undo/redo, and confirm the caret never jumps.
3. Navigate to another textbox/Node and back, refresh, and close/reopen the tab immediately after an edit. Confirm the latest text returns and Saved appears only after server durability.
4. Open two same-browser tabs and two isolated browser profiles/users. Make concurrent edits and undo in each. Confirm convergence without one editor replacing another.
5. Go offline, edit, close/reopen while offline if practical, reconnect, and confirm the exact recovered edit converges.
6. Add a comment on selected text, add more than one reply page, use mentions, edit around the anchor, and confirm focus/fallback behavior.
7. Upload a file and paste an image. Select it, preview it, change alignment, download it, use every visible image action, reload, and confirm the permanent attachment remains.
8. Page email summaries and message bodies, select an exact message, place it into the active textbox context, and confirm the linked accent without altering the HTML email body.
9. Send textbox chat, verify message-to-textbox behavior, archive/restore a textbox, reorder textboxes, and confirm scroll position is preserved.
10. Trigger verification, then confirm the recorded checkpoint/head/revision can be reconstructed after running retention cleanup on a disposable copy.
11. Restart the API and collaboration service between edits and verify reload/convergence.
12. Confirm legacy mode still opens normally when the exact workspace gate is inactive or rolled back.

## Remaining risks and later cleanup

- Physical multi-device networks, deployment topology, connection counts, TLS/proxy behavior, and production capacity still require environment-specific validation.
- The development migration ledger remains unreconciled and blocks live migration application.
- The former per-document two-MiB rule is gone. Current editor JSON is capped at an aggregate 1 GiB per Node, Project, or Logic Gate, excluding attachment object bytes and history. Deployment monitoring must still account for the platform request ceiling and available browser, API, and database resources.
- Conversion warnings, attachment identity gaps, and comment-anchor ambiguity require item-level human review before readiness.
- Alert routing and service deployment are not configured by repository code alone.
- Legacy HTML, collaboration tables, generic JSON tables, Node projection paths, conversion evidence, rollback exports, and Yjs history must remain through the reviewed rollback window.

Cleanup is a later project. Its readiness gate must prove every company is stably active, no rollback is pending, current rollback exports/backups satisfy retention policy, no legacy reader/writer receives traffic, conversion/shadow failures are zero or explicitly resolved, and separate approval exists for each table/path removal. This phase deliberately deletes none of them.
