# Realtime Changes And Collaborative Editor Architecture Charter

Last updated: 2026-07-16

Status: the post-integration rich-document rendering regression is repaired and verification is complete on the canonical worker branch. The authoritative `node scripts/run_all_tests.mjs` gate passes, including real disposable PostgreSQL and production-path Chrome DOM evidence. Production rollout remains blocked and human-controlled. No live database or cloud resource was changed, and no merge, push, handoff, or pull request occurred.

## Implementation Record

This is the live project-management record. The charter below remains the approved product direction; obsolete RGA/raw-HTML and simulated-browser completion claims are superseded by this record.

### Phase checklist

- [x] Bootstrap the canonical worker branch and reread `AGENTS.md`, this charter, the database access contract, source, schema, migrations, runner, tests, and owner contracts.
- [x] Phase 0: reopen the overstated completion claims and replace contradictory legacy expectations.
- [x] Phase 1: exhaustively audit persisted realtime producers, convert every live mapped split boundary, and prove PostgreSQL transaction atomicity.
- [x] Phase 2: retain the one shared socket, application heartbeat, centralized health state, and mutation gate.
- [x] Phase 3: replace serialized-HTML atoms/homegrown RGA with structured Quill Delta OT; make IndexedDB authoritative and queues tab-isolated; enforce the 2 MiB canonical boundary.
- [x] Phase 4: retain unified Node, Logic Gate, individual text-box, and Project collaboration without restoring whole-document conflict paths.
- [x] Phase 5: make consumer delivery outcomes typed/retryable and replace the simulated harness with production frontend/backend/PostgreSQL/WebSocket/DOM automation.
- [x] Execute both migrations on clean and realistic legacy disposable databases in repository order and prove runner idempotence.
- [x] Run the complete repository gate, inspect final diff/status, and update this record with exact final proof. Commit every intended file locally as the final worker handoff; its SHA belongs in the final report because a commit cannot contain its own identity.

### Deployment-blocker resolutions

1. **Structured collaboration:** `editorStructuredDocument.ts`, `quillDelta.ts`, and `editor_structured_document.go` model documents as structured Quill Delta `ops`. The mature Quill Delta compose/transform rules integrate stale concurrent operations using UTF-16 indexing on both Go and JavaScript. The HTML adapters preserve supported paragraphs, line breaks, Unicode, lists, formatting/highlights, mentions, tables, pasted rich structure, and durable attachment references. Raw HTML prefix/suffix patches, chunk atoms, and the legacy raw-HTML test were deleted.
2. **Producer atomicity:** Logic Gate create/update, email-collaboration creation, and persisted participant mailbox hints moved into repository-owned transactions. The audit removed the remaining live mapped `publishWorkspaceEvent` calls and dead split-producer helpers. Non-realtime domain-history calls remain domain history; external Nylas mailbox cache hints remain non-persisted liveness signals.
3. **Cursor safety:** delivery returns an explicit terminal or retryable outcome. Authorization-store failures retain the cursor at the failed sequence, block later sequence advancement, use 50 ms to 5 s exponential backoff, and emit retry metrics plus bounded logs. No-subscriber and no-current-authorized-recipient outcomes are terminal. Persistent poison events stay visible and head-of-line until recovery rather than silently skipping subscribed browsers.
4. **Durable pending work:** IndexedDB v2 is the only pending-operation authority. Quota, blocked, unavailable, and transaction failures surface explicitly. `window.name` provides a stable refresh-preserving identity per tab without sharing queues across tabs. Records are deleted only after commit acknowledgement or backend deduplication proof.
5. **Document/paste boundary:** the backend materializes the transformed canonical state inside the same transaction and rejects content beyond 2 MiB with stable HTTP 413 code `editor_collaboration_document_too_large`. Client preflight and deterministic canonical rollback keep oversized local DOM from masquerading as saved; navigation is protected while pending work exists. Insert payloads split into ordered bounded operations and durable remaining batches are never truncated.
6. **Production-path evidence:** the deleted localStorage/BroadcastChannel/fake-WebSocket harness is replaced by `editor-collaboration-e2e.html`, the production controller/socket adapter, and `run_realtime_production_path_tests.mjs`. The runner launches two real API processes, Vite, installed Chrome, and a disposable PostgreSQL 18 cluster.
7. **Migrations and permissions:** the unified migration and canonical schema now require model version 2, Quill Delta operations, structured snapshots, and bounded operation JSON. The edit/no-access migration relies on the migration runner's transaction and converts legacy `view`/`admin` resource values to `edit`; no executable collaboration view-only tier exists.
8. **Evidence discipline:** behavior tests replace the obsolete raw-HTML and source-order claims. Source inventory remains supplemental only.
9. **2026-07-16 rich-document envelope regression - repaired and verified:** structured collaboration materializers returned raw HTML even though every existing editor consumer uses the `<!-- mango-editor-html-v1 -->` storage envelope to distinguish trusted rich documents from legacy plain text. The deserializer therefore escaped tags into visible text and attachment images disappeared from the DOM. Backend and frontend materializers now restore the shared envelope without changing structured state or sending attachment bytes. Nested attachment image metadata, alt text, and bounded dimensions survive state/materialization/sanitization. Existing structured snapshots retain their attachment IDs and need no data migration; clients rematerialize them correctly after deployment, while derived projections are rewritten at the next normal materialization boundary. The production matrix also reproduced a causal-gap response on the last of 18 rich-paste batches; recovery now atomically regenerates the still-uncommitted IndexedDB queue from the fresh canonical snapshot to the exact visible target, retains stable operation identity, and performs one bounded retry.

### Persisted realtime producer inventory

| Family | Handler/repository transaction owner | Canonical write plus outbox boundary | Stable identity and exact scope | Runtime proof |
| --- | --- | --- | --- | --- |
| Editor operation, canonical replacement, delete | editor collaboration HTTP handlers; `CommitEditorCollaborationOperation`, replacement helpers, `DeleteEditorCollaborationDocument` | structured state, revision, operation/dedupe row, projection boundary, and editor outbox row commit or roll back together | stable operation ID/event ID/revision; exact `editor:{resource_type}:{resource_id}:{document_id}`; current resource Edit authorization | forced outbox rollback, oversize rollback, retry/dedupe, concurrent transform, gap/delete/restore tests and real browser DOM |
| Notifications | notification services; `CreateNotifications`, `DeleteNotifications`, `DeleteExpiredNotifications` | notification rows and created/deleted/cleared recipient rows share the caller transaction | deterministic notification or sorted-clear ID; exact `notifications:user:{recipient}`; restricted recipient | memory and real PostgreSQL forced-outbox rollback; invalid business input creates no row |
| Node chat, including email-collaboration chat | Node information/projection and atomic email-chat repository methods | information/projection, participant/grant effects where applicable, and chat outbox row share one transaction | deterministic company/node/message identity; exact `chat:node:{node_id}`; current Node Edit authorization | create/delete/conversion rollback and real PostgreSQL failure injection |
| Mounted Logic Gate Kanban | all `*WithWorkspaceEvent` methods plus Node, Logic Gate/GVIC, assignment, project-scoped create, triage conversion/transfer, Explorer delete/restore, recycle-bin, and derived-projection repository transactions | business rows, domain events, and coalesced `kanban.changed` rows share the repository transaction; publication happens only after commit | stable domain-event set; exact `board:{logic-gate-board-id}`; current Logic Gate Edit audience or captured pre-delete restricted audience | Logic Gate create/update, mounted board, multi-event, early-return, and outbox-failure tests in memory and real PostgreSQL |
| Email collaboration creation and persisted mailbox snapshot | ensure/create handler and `EnsureCommunicationsEmailCollaboration`; webhook path and `UpdateCommunicationsEmailCollaborationMessage` | collaboration Node plus workspace event commit together; later canonical message snapshot and each participant personal-mailbox outbox row commit together | stable ID from company/user/account/provider message; exact `mailbox:personal:account:{user}:{account}`; restricted participant | memory and real PostgreSQL rollback plus duplicate stable-ID proof; source participant excluded for personal source |
| External personal/shared mailbox hint | Nylas webhook receiver | Nylas owns the source mutation; Mango invalidates caches and emits a compact liveness hint only. There is no Mango business row to dual-write | exact active personal account or shared inbox; current authorization | existing exact-scope, revocation, dedupe-receipt, and retry tests; no body, attachment bytes, URLs, credentials, or secrets |
| Updates | domain-event appenders/read model | Updates is the durable `domain_events` feed, not an independent WebSocket family. Board-relevant events use the mounted-board transaction above | domain event ID, stream sequence, idempotency key | realtime type/scope inventory proves no Updates socket producer; no fake broad event added |

The repository-wide `publishWorkspaceEvent` audit found no remaining handler call whose event type can map to the Kanban realtime outbox. Direct `publishRealtimeMessage` production calls are limited to external provider/liveness paths; Mango-owned persisted editor, notification, chat, board, and email-collaboration snapshot mutations use the durable outbox. Dispatch wakeups occur after commit and correctness does not depend on the wakeup succeeding.

### PostgreSQL, cursor, and failure evidence

- `TestPostgresRealtimeProducersAreTransactionallyAtomic` forces outbox failures for Logic Gate create/update, mounted board, Node chat, notifications, email-collaboration mailbox snapshots, and structured editor writes. Business state and outbox state roll back together; oversized canonical editor state creates neither operation nor event.
- `TestPostgresRealtimeOutboxRetryAndDuplicateCompletion` proves a committed unpublished row remains claimable, failed publication is retried, attempt count advances, and duplicate publication completion is idempotent.
- The optimized single and batched domain-event paths enqueue mapped board rows before their caller commits; the former source-pattern ordering assertion was removed because the real PostgreSQL test is authoritative.
- Cursor tests prove transient and persistent authorization-store failures do not advance the cursor, later events cannot pass the failed sequence, recovery delivers once, revocation/no-authorized-recipient terminates safely, and exact unrelated scopes receive nothing.
- The clean-database gate exposed and repaired two canonical schema ordering defects (a too-early shared-inbox foreign key and a function body referencing later tables) and a PostgreSQL-invalid NUL advisory-lock key. These are recorded as failed baseline assumptions rather than hidden by static checks.

### Browser/DOM evidence

The real automation uses the production `EditorCollaborationController`, `MangoRealtimeClient`, authenticated HTTP commands, WebSocket tickets, exact subscriptions, the outbox dispatcher/consumer, and two backend instances against PostgreSQL.

- Two authorized users connected to different backend instances converge visible `contenteditable` DOM without refresh or polling.
- Concurrent inserts at positions 100 and 200 in a 5,000-character document produce exactly 5,002 visible characters with each insert once. A concurrent acknowledgement carries the other collaborator's operation for pending-batch OT rebase.
- Bold versus italic and heading versus strong converge with unchanged visible text and valid structured DOM. Rich heading, highlight, list, table, mention, and durable attachment markup survive; payloads contain no base64 or signed credentials.
- Acknowledgement-before-broadcast, broadcast-before-acknowledgement, duplicate delivery, a dropped revision followed by gap recovery, and lost acknowledgement after commit all converge exactly once. Refresh retains the tab identity, retries the stable operation ID, accepts backend dedupe proof, and clears pending work.
- A rich paste of 28,000 repeated segments commits in ordered bounded batches and matches exact DOM text. Explicit socket reconnect/full-snapshot recovery preserves it. Terminating and relaunching one API process on the same port restores affected tabs to healthy exact subscriptions and canonical state; a later edit entering through the other API converges across the restarted instance.
- Two pages in one browser context prove independent tab identities; the same user in a second browser context also converges. Shared local consumers send one subscribe, no unsubscribe on the first unmount, and one unsubscribe on the last.
- Node document, second Node/text box, Logic Gate, Project, and unrelated-company documents remain isolated. Permission revocation stops later delivery and rejects reload recovery.
- The 2026-07-16 regression test feeds the observed `<br><span style="font-size: 14px...">` shape plus a durable attachment through structured state, the collaboration materializer, the production rich-document deserializer, and JSDOM. It asserts that markup is not visible as text and that the actual image frame retains its attachment ID, source, alt text, width, and height.

### Migration and human rollout record

The disposable gate applies `backend/db/schema.sql`, then runs `20260715_unified_realtime_collaboration.sql` followed by `20260715_zz_edit_or_no_access.sql` through the real migration runner. A second runner invocation reports no pending migrations. A realistic legacy fixture proves legacy `view`/`admin` values become `edit`, rank functions expose only `no_access=0` and `edit=1`, the obsolete single-text-box Logic Gate index is removed, and the multi-text-box index/constraints exist.

Human-controlled rollout sequence:

1. Back up and rehearse on a staging copy; audit that neither migration has already been partially applied.
2. Stop or drain old writers, because raw model-version-1 collaboration rows/clients are not compatible with the model-version-2 constraints.
3. Run the repository migration runner so the unified migration executes before edit/no-access.
4. Deploy all matching backend instances, then the matching frontend, and require pre-cutover tabs to reload.
5. Monitor migration status, outbox claim/retry/lag, consumer authorization retries, collaboration gaps, 413 rates, and IndexedDB recovery without logging document bodies or secrets.
6. Rollback requires restoring the pre-migration database backup and the prior coordinated app version; there is intentionally no unsafe automatic down-conversion from structured v2 operations to raw atoms.

No agent applied a migration to a live or production database.

### Current verification record

- 2026-07-16 focused repair evidence: `npm run test:node-relationships`, `npm run build`, and `go test ./internal/store ./internal/http` passed. `node scripts/run_realtime_production_path_tests.mjs` passed on a fresh PostgreSQL 18 cluster with two API instances, Vite, WebSockets, and Chrome DOM assertions. `node scripts/run_all_tests.mjs` then passed with exit code 0.
- Failed approach recorded: the first two production-path reruns reproduced `collaboration_snapshot_required` on the final large-paste batch. Updating only the pending base revision still failed because the queued delta shape was stale relative to the canonical snapshot. Atomically regenerating the uncommitted queue from canonical state to the exact visible target preserved all 28,000 segments and passed the real browser matrix.
- `go test ./internal/store ./internal/http` - passed after the producer and auth-boundary changes.
- `node scripts/run_realtime_production_path_tests.mjs` - passed on a fresh disposable PostgreSQL 18 cluster, including clean/legacy migrations, real PostgreSQL atomicity/retry, two backend instances, Vite, Chrome, and actual DOM assertions.
- `node scripts/run_all_tests.mjs` - passed with exit code 0 after final owner-contract reconciliation. It ran frontend unit/contract suites, the production build, all Go packages, clean and legacy disposable migration paths, real PostgreSQL transaction/retry tests, two API instances, Vite, and real Chrome DOM automation.

### Baseline source inventory

- Shared frontend transport: `frontend/src/modules/realtime/realtimeWebSocket.ts`. It already refcounts exact scopes locally and owns ticket acquisition/reconnect, but it currently has no application-visible confirmed heartbeat or editor event family.
- Backend transport/registry/publication: `backend/internal/http/realtime_ticket.go`, `realtime_ws.go`, `realtime_registry.go`, and `realtime_publish.go`. The registry is exact by company/scope/connection, but current publication is process-local and synchronous socket writes can still let one stalled connection delay fan-out in this checkout.
- Baseline retained producers before the unified-spine implementation: notification handlers, Node chat projection create/delete, mounted Kanban domain-event hints, and exact mailbox stream/webhook hints called the local publisher directly after their feature mutation. The Phase 1 ledger below records the post-merge transaction classification and requires a fresh exhaustive audit.
- Existing durable event foundation: `domain_events`, `postgres_domain_events.go`, and memory equivalents already provide transaction-local domain-event append and per-stream ordering, but they do not provide claim/retry/publication state or per-instance consumption. They remain business-domain history rather than being overloaded as the realtime outbox.
- Legacy editor root path: `EditorContent.tsx` plus `useEditorDocumentPersistence.ts`, `editorDocumentSaveQueue.ts`, `editorProjectionSync.ts`, and `EditorSyncBlockingModal.tsx` retain full bodies, require expected revisions, restore `draft_restored`, and expose end-user version-choice/retry UI.
- Legacy per-text-box paths: `NodeWorkspaceSurface.tsx`, `NodeWorkspaceSurfaceParts.tsx`, `nodeTextBlockProjectionSaves.ts`, and `ProjectSummaryContent.tsx` serialize a full text-box payload through per-block save controllers. Node/Logic Gate HTTP handlers and `postgres_editor_projection_revisions.go` implement one-winner whole-document revision conflicts; Project projection persistence has no equivalent collaboration revision.
- Shared rich editor mutation source: `useEditorDocumentSurfaceHandlers.ts` commits every supported text/format/list/table/image DOM mutation through one `scheduleDocumentSave(serializedHTML)` callback. This is the atomic integration point for generating structured collaboration operations without rewriting every formatting command.
- Rich-text storage boundary: root editor projections can contain raw sanitized rich HTML; Node/Project text-box projections wrap the independently editable `document` in `<!-- mango-node-text-block-v1 -->` JSON beside title and durable attachment references. Collaboration owns only the `document` body; title, attachments, relationships, and other metadata remain command-specific.
- App-shell placement: `AuthGate.tsx` renders `AccountBar`; its Recycle Bin button is the requested trash icon. The connection indicator will be inserted immediately before it. `AppModalPortal.tsx` is the shared portal boundary, but the health blocker needs an explicitly higher global layer than Kanban's `99999` feature overlay.
- Required owner-contract reconciliation: `docs/v4-architecture-doc.md`, `docs/tests/REST API & WebSocket.md`, `editor.md`, `nodes.md`, `logic-gates.md`, `projects.md`, `key-views.md`, `attachments.md`, `attachment-streaming.md`, and the addendum in `live-feed-audit.md`.

### Resolved implementation decisions

1. **Shared backplane: PostgreSQL durable outbox plus published-event log, with in-memory deterministic adapter.** The API already requires PostgreSQL and `database/sql`/pgx. A dedicated realtime outbox will use a global sequence, bounded claims with expiring leases, retry metadata, stable event IDs, and published timestamps. Every backend instance independently consumes published rows after its own cursor and applies only its local exact registry. This provides cross-instance delivery without sticky sessions or a new production service; polling is backed by immediate local wakeups and a short bounded interval. Domain events are not repurposed because they lack delivery state and contain broader business payloads.
2. **Collaboration engine: structured Quill Delta operational transform.** Browser and backend use the mature `quill-delta` and `go-quilljs-delta` compose/transform algorithms over retains, inserts, deletes, and attributes. Stale-base operations transform across committed intervening operations and acknowledgements return those concurrent operations so the origin rebases pending work. HTML is only a sanitized editor projection, never the collaboration merge unit. Attachment validation rejects bytes, data URLs, presigned credentials, and secrets before commit.
3. **Micro-batch defaults: 160 ms; 24 KiB text-insert target; 2 MiB canonical structured-document boundary.** Local DOM rendering is immediate. Large inserts split into ordered durable Quill Delta operations, every request stays beneath the backend 64 KiB guard, and retries/reconnect preserve the exact remaining order without truncation.
4. **Snapshot/compaction: bounded replay after an exact snapshot.** A document begins with an imported/full revision-zero CRDT snapshot. The server compacts after 128 committed operations since the physical snapshot or 512 KiB of accumulated delta JSON, whichever occurs first. Snapshot reads reconstruct at most 127 normal operations (or the smaller byte threshold), report the exact head revision/ETag, and never require a browser to replay history. User-visible saved versions remain separate.
5. **Pending operations: IndexedDB is authoritative, scoped by user/company/document/per-tab-client/operation.** Storage/quota failures surface and block unsafe transmission; there is no `localStorage` pending fallback. The per-tab client identity survives refresh through `window.name` without collapsing independent tabs. Recovery retries the same stable operation ID and removes a record only after commit acknowledgement or backend deduplication proof.
6. **Heartbeat/retry defaults:** application challenge/response travels on the existing socket immediately after connect and every 25 seconds alongside protocol Ping/Pong. A 35-second confirmation grace enters orange; one failed/overdue short recovery enters blinking red while background exponential reconnect continues; eight failed attempts or 60 seconds without confirmed recovery enters solid red. Socket open alone remains syncing until exact subscriptions, mounted-document recovery, pending acknowledgements, and a server-confirmed heartbeat complete.
7. **No presence/cursors in the first release.** Correct content convergence, selection preservation while applying remote content, saved-state proof, and recovery ship first; collaborator presence is not required by the charter.

### Implemented source inventory

- The migration and canonical schema add the realtime outbox plus collaboration documents, operations, physical snapshots, leases, retry state, and indexes. No live database was changed.
- Store and HTTP collaboration paths implement structured Quill Delta OT, stable operation idempotency, ordered revisions, bounded snapshots/ETags, compaction, deletion, exact authorization, saved-version materialization, and an editor-state/outbox transaction.
- The shared realtime spine implements durable claim/lease/retry/publication, per-instance published-sequence consumption, local wakeups, cross-instance delivery, application heartbeat, bounded socket queues, and one final exact local-registry boundary.
- Frontend collaboration implements structured deltas, 160 ms micro-batching, durable pending operations, duplicate/gap recovery, exact refcounted scopes, health/mutation gating, and atomic Node/Logic Gate/Project/text-box cutover without the obsolete whole-document conflict system.

### Deleted legacy system

- `EditorSyncBlockingModal.tsx`, `editorProjectionSync.ts`, `editorDocumentSaveQueue.ts`, and their obsolete conflict/checkpoint tests are deleted.
- Migrated projection write endpoints fail closed rather than providing a whole-document fallback. Metadata writes cannot carry the document body.
- Cutover removes but never hydrates `mango-editor-projection-draft-v2` and `mango-editor-projection-tab-v1`; pending work uses stable structured operations instead.
- Owner contracts and the current architecture document now describe the unified model; the preserved live-feed audit is explicitly historical.

### Problems, failed approaches, and resolutions

- **Publication authorization race:** delivery now takes the exact-scope publication lock and re-resolves only current candidate users immediately before the local registry boundary.
- **Saved-version stale projection:** save-version creation materializes the collaboration head first; restore commits a canonical structured replacement and publishes only `editor.snapshot.required`, never a full body.
- **Replacement versus pending operations:** replacement advances the canonical structured snapshot and revision. A client based before replacement performs canonical recovery and reconciles its still-durable operation; obsolete serialized-markup anchors are never retained.
- **Recovery races (resolved):** snapshot/deletion events arriving mid-recovery request another pass, buffered events are ordered above the accepted revision, and revision never rolls backward. Acknowledgements include any intervening collaborator operations so pending local batches rebase before later broadcasts can be suppressed; stable operation IDs are retried only until commit/deduplication proof.
- **Browser render loop:** the initial browser smoke found a React maximum-update-depth loop from an unstable collaboration result object. Persistence now depends on the hook's stable callbacks; a clean browser reload showed no recurrence.
- **Windows sandbox:** Vite/esbuild child-process startup failed with `spawn EPERM` inside the restricted launcher. Focused and full commands were rerun outside that restriction; the failure occurred before project code executed.
- **Git-case gate:** the first full gate correctly rejected the referenced migration while it was untracked. Staging the migration made the source-audit path provable; the complete rerun passed.

### Verification evidence

- `go test ./internal/store -count=1` — passed.
- `go test ./internal/http -count=1` — passed.
- `go test ./... -count=1` — passed before the final gate.
- `npm.cmd run test:node-relationships` — passed.
- `npm.cmd run build -- --emptyOutDir=false` — passed after recovery hardening and again after the browser-loop fix.
- In-app Chromium smoke against the actual Vite-loaded component proved: Connected green with heartbeat pulse and no modal; Reconnecting orange with no modal; Attempting blinking red with one accessible global `aria-modal` at `z-index: 2147483000`; Disconnected solid red with the global modal and Refresh browser button. The Mango shell rendered after the callback fix without the prior maximum-update-depth error.
- `node scripts/run_all_tests.mjs` — final exit code 0 on 2026-07-15: frontend feature/DOM suites passed, production build passed (`265 modules transformed`), all backend Go packages including source audit passed, infrastructure attachment contracts passed, and the runner printed `All test suites passed.`
- **Post-merge evidence correction:** the passing gate proves the covered source, unit, DOM, build, backend, and infrastructure contracts. It did not exercise acknowledgement-versus-broadcast ordering through the visible editor, browser recovery after commit with a lost acknowledgement, realistically large multi-operation paste, or the full simultaneous multi-browser matrix. The green gate must not be cited as proof that those behaviors already work.

### Database migration and human rollout

1. A human must review and run `backend/db/migrations/20260715_unified_realtime_collaboration.sql` through the normal environment migration workflow before deploying code that uses the realtime/collaboration tables.
2. Then run `backend/db/migrations/20260715_zz_edit_or_no_access.sql`. It maps stored `view`/`admin` values to `edit`, narrows permission and subtree constraints to `edit`/`no_access`, updates the rank helper, and drops the unused `mangorts_user_can_view_entity` compatibility function.
3. Deploy all backend instances with both schemas available; monitor outbox pending depth/age, claim/publish failures, consume lag, exact delivery failures, heartbeat failures, and editor commit/snapshot metrics.
4. Deploy the frontend only with the matching backend protocol and binary permission contract. Browser cleanup is automatic; there is no dual-read or dual-write window.
5. No agent applied a migration or accessed or changed production infrastructure or a live database.

### 2026-07-15 post-merge critique and final owner direction

- The initial implementation was merged into local `main` at merge commit `9e1481ea82973f5a365c67e5a663448ef622c7e6` after `node scripts/run_all_tests.mjs` passed. A subsequent source-level review found the correctness and coverage problems below; the passing gate does not override them.
- **Final permission invariant:** Mango has exactly two resource-access outcomes: `edit` or `no access`. There is no view-only access level. User, manager, and admin are roles, not a third resource permission. The Node and Logic Gate permission controls intentionally expose only edit versus no access, and the same invariant applies throughout Mango.
- Any executable branch, schema/default, API contract, test, owner document, or user-facing copy that creates, accepts, returns, depends on, or describes a view-only resource permission contradicts the owner-approved product model and must be deleted or replaced. Editor snapshot, subscription, publication, and mutation admission require edit access; no read-only collaboration mode is to be invented.
- **Immediate release-blocking priority 1:** guarantee that every accepted remote change reaches the visible editor regardless of whether an HTTP acknowledgement or realtime broadcast arrives first. Server state, internal collaboration state, revision state, and rendered DOM must converge together.
- **Immediate release-blocking priority 2:** make commit-before-lost-acknowledgement recovery end-to-end idempotent. After a full snapshot, the client must identify pending stable operation IDs already committed, avoid duplicate local application, obtain commit/deduplication proof, clear only proven work, and recover automatically without duplicating content or remaining stuck.
- **Immediate release-blocking priority 3:** support realistically large rich-text copy/paste through safe ordered operations without exposing the 64 KiB per-request boundary, silently truncating content, losing formatting/Unicode/list/table/attachment-reference order, or falling back to whole-document saves.
- **Immediate release-blocking priority 4:** add automated real-browser coverage for visible multi-user and multi-tab convergence, acknowledgement/broadcast reordering, commit with lost acknowledgement, reconnect plus pending reconciliation, large multi-batch paste, exact document isolation, rich text, and authorized inline attachment references.
- **Accepted limitation for now:** do not expand the immediate pass into a cursor, selection, IME, or undo-system redesign. Remote DOM replacement risks in those areas are known and may be revisited separately.
- **Phase 1 decision reversal - resolved:** the earlier deferral was revoked. The exhaustive ledger above now proves every applicable persisted product mutation and durable outbox row commit in one database transaction.
- **Owner-accepted retention deferral:** do not currently prioritize time/size retention or deletion for published realtime outbox rows and collaboration-operation history. Physical snapshot compaction bounds reconstruction but does not by itself bound stored history; this remains recorded operational debt.
- Fixes must preserve the complete deletion of the old full-document checkpoint/conflict system. Recovery remains automatic through operations, stable IDs, snapshots, acknowledgements, and reconciliation; no end-user merge screen or legacy fallback may return.

### 2026-07-15 Phase 1 decision reversal and atomic transaction standard

"One commit" in this Phase 1 decision means one atomic database transaction, not one Git commit.

The required transaction sequence for every persisted application mutation that produces a realtime event is:

1. Save the canonical product change.
2. Insert the corresponding durable realtime-outbox event.
3. Commit the single transaction.

The only acceptable outcomes are that both writes commit or neither write commits. A product change without its required outbox event and an outbox event without its product change are both forbidden. The backend reports success only after the joint transaction commits.

This protects more than a narrow process-crash window. Restarts, deployments, request cancellation, database errors, outbox validation or serialization failures, exceptions, early returns, and temporary infrastructure failures must not split the mutation from its durable publication obligation.

The requirement applies to persisted business mutations. Heartbeat, liveness, subscription-control, and other connection-control frames do not create fake database writes or outbox rows. Actual WebSocket publication must happen after commit through the existing dispatcher and shared backplane; no socket or broker I/O may hold the database transaction open.

#### Phase 1 producer inventory ledger

| Producer family | Initial post-merge classification to reverify | Required final boundary |
| --- | --- | --- |
| Editor collaboration mutations | Canonical operation, document revision, and outbox event were implemented in one repository transaction. | Preserve and prove the joint transaction, stable event ID, exact editor scope, rollback, retry, and deduplication behavior. |
| Notifications and Updates | Shared durable outbox delivery exists, but prior review found the feature mutation and enqueue helper separately committed. | One repository-owned canonical mutation plus outbox transaction. |
| Node chat create/delete | Shared durable outbox delivery exists, but prior review found save/delete and enqueue separately committed. | One repository-owned canonical mutation plus outbox transaction. |
| Mounted Kanban changes | Shared durable outbox delivery exists, but prior review found board-visible mutation and enqueue separately committed. | One repository-owned canonical mutation plus outbox transaction. |
| Active mailbox and email-related durable changes or hints | Shared exact mailbox delivery exists, but prior review found persisted mutation and enqueue separately committed where Mango owns both. | One repository-owned canonical mutation plus outbox transaction for every persisted Mango-owned event producer. |
| Any other persisted realtime producer | Not yet exhaustively classified. The known list is a minimum, not the audit boundary. | Inventory every producer; eliminate separate commits and direct-broadcast bypasses. |

The completed producer inventory at the top of this record supersedes these initial classifications with exact source owners, final boundaries, identities/scopes, bypass findings, retry behavior, and focused evidence.

Phase 1 is complete only when:

- every applicable persisted realtime producer has been inventoried;
- every canonical mutation and outbox insertion share one database transaction;
- no applicable producer retains a save-first/enqueue-afterward sequence;
- no applicable producer bypasses the shared spine;
- tests prove outbox failure rolls back the mutation, mutation failure writes no event, post-commit failure retains a dispatchable event, and duplicate retry/delivery is safe; and
- this ledger contains evidence for every producer classification.

This decision reverses only the earlier Phase 1 deferral. Cursor/selection/IME/undo redesign and historical realtime-table retention remain owner-accepted deferrals.

### Acceptance-gap resolution

1. **Visible acknowledgement/broadcast convergence — resolved:** acknowledgement snapshots render accepted remote state and both delivery orders converge exactly once in visible browser DOM.
2. **Commit-before-lost-acknowledgement recovery — resolved:** snapshot reconciliation retains the stable operation ID for backend deduplication proof and clears durable IndexedDB work only after that proof.
3. **Realistically large paste — resolved:** ordered sub-24 KiB text-insert operations support the 2 MiB product boundary beneath the 64 KiB request guard without truncation or whole-document fan-out.
4. **Complete rich-editor browser matrix — resolved:** the browser record above covers multi-user/tab ordering, duplicates, lost ack, reconnect/gap, large rich paste, isolation, refcounting, revocation, and exact visible DOM.
5. **Edit-or-no-access cleanup — resolved:** executable code, schema/defaults, APIs, tests, dialogs, and active owner contracts now expose only edit or no access.
6. **Persisted realtime-producer transaction boundaries — resolved:** the exhaustive Phase 1 ledger covers every protocol family and the optimized PostgreSQL batch path is guarded.
7. **Historical-row retention — owner-deferred:** published outbox rows and collaboration operations still have no time/size cleanup policy. Snapshot compaction bounds reconstruction, not database growth.

All release-blocking acceptance gaps, Phase 5, and the implementation Definition of Done are closed by the focused evidence and the passing complete repository gate. The local commit identity is recorded in the final worker report.



This document is the durable implementation charter for Mango realtime delivery, collaborative Node/Logic Gate/Project editors, connection health, reconnect recovery, and browser-side protection of unacknowledged work. It records the decisions made before implementation so future Codex agents do not create competing livestream systems or fall back to whole-document last-write-wins behavior.

## Authority And Supersession

This charter supersedes only the following earlier decisions:

- the statement in `docs/important tasks/live-feed-audit.md` that exact document coediting remains a future Huddle-only project;
- the acceptance of process-local-only delivery for the retained realtime surfaces;
- the current Node and Logic Gate end-user workflow in which a stale whole-document save is rejected and an office worker is asked to choose between a server version and a local version; and
- the current contract that editor document content never travels through an approved realtime scope.

The earlier live-feed simplification remains authoritative in every other respect. Do not restore broad workspace, Company Explorer, graph, GVIC/My Work, Project Management, permission, generic projection, or company-wide content streams. This charter adds exact collaborative-editor scopes and a shared cross-instance delivery backbone; it does not reopen generalized browser replication.

The implementation reconciled this charter with the current source-of-truth owner documents, including:

- `docs/v4-architecture-doc.md`;
- `docs/tests/REST API & WebSocket.md`;
- `docs/tests/editor.md`;
- `docs/tests/nodes.md`;
- `docs/tests/logic-gates.md`;
- `docs/tests/projects.md`;
- `docs/tests/key-views.md`;
- `docs/tests/attachments.md` and `docs/tests/attachment-streaming.md` where inline images cross the attachment boundary; and
- `docs/important tasks/live-feed-audit.md`, with a short current addendum that points here instead of rewriting its preserved historical audit.

Pre-cutover rules such as RW10, ED44, N107-N111, LG46-LG49, and the navigation/reopen-only coverage note described the obsolete system; the owner documents now replace or narrow them with the collaboration behavior recorded above.

### Mandatory deletion of the legacy editor save/sync patch

The unified realtime collaboration model is a complete replacement for Mango's current full-document draft/checkpoint and end-user conflict workflow. It must not be layered on top of that workflow, preserve it as a fallback, or leave it available on migrated editor surfaces.

Implementation must explicitly find and delete all of the following legacy behavior:

- full-document browser checkpoints and retained full-body draft records;
- the `draft_restored` blocking state and every rule that treats checkpoint existence by itself as proof of unsaved work;
- per-tab full-body draft isolation, including the current `mango-editor-projection-draft-v2` local-storage records and `mango-editor-projection-tab-v1` session identity used only by that system;
- the current whole-document optimistic-revision conflict path presented to end users;
- `EditorSyncBlockingModal` and equivalent whole-document conflict or restored-draft blocking UI;
- the `Use server version`, `Use server deletion`, `Keep local draft and recheck`, `Retry save`, and `Retry after signing in` workflows when they operate on the old full-body draft model;
- full-body retain/read/list/clear helpers and save-queue integration that exist only to support the legacy checkpoint workflow;
- frontend and backend compatibility branches that allow a migrated editor to fall back to the old whole-document save/conflict behavior;
- automated tests whose expected result is the legacy checkpoint, `draft_restored`, per-tab full-body isolation, or end-user version-choice workflow; and
- source-of-truth rules, historical requirements presented as current behavior, and user-facing copy that instruct users or agents to preserve those legacy mechanics.

The current implementation areas that must be audited during removal include `frontend/src/modules/editor/editorProjectionSync.ts`, `useEditorDocumentPersistence.ts`, `EditorSyncBlockingModal.tsx`, `EditorContent.tsx`, `NodeWorkspaceSurface.tsx`, the existing editor projection save controllers, the current whole-document revision-conflict HTTP/storage path, and their tests and owner documents. This is an inventory to delete or replace, not an instruction to retain their architecture.

Legacy browser-storage records must receive an explicit one-time cleanup at cutover. The new editor must never hydrate them, turn them into a warning, or interpret their existence as pending work. The legacy keys and their tab-session key must be removed so an old checkpoint cannot resurrect the obsolete modal after deployment.

Any valid product responsibility formerly attempted by this patch must be reimplemented solely through the new model:

- unacknowledged work is represented by durable structured pending operations with stable operation IDs, not retained full-document bodies;
- concurrent work is integrated by the collaboration engine and committed in server order, not rejected into a user-facing whole-document choice;
- reconnect recovery loads a canonical full snapshot and automatically reapplies pending operations;
- saved state comes only from backend commit acknowledgement; and
- application-wide mutation blocking comes only from the central connection-health state machine and global modal layer.

Cutover must be atomic per editor surface. A migrated Node, Logic Gate, Project, or text-box editor has exactly one mutation, acknowledgement, realtime delivery, pending-work, snapshot recovery, and connection-gating path: the new unified model. Do not dual-write, dual-read, shadow-save, retain a hidden compatibility fallback, or keep the legacy modal "just in case." The migration is incomplete while any migrated editor can execute the old behavior.

## Executive Decision

Mango will have one cohesive realtime architecture spine:

```text
committed mutation
  -> transactional outbox
  -> shared realtime backplane
  -> every backend instance
  -> existing local subscription registry
  -> exact authorized browser connections
```

Chat, mounted Kanban boards, Updates/notifications, the actively viewed mailbox, collaborative editor deltas, and application-visible connection health must use the same WebSocket connection, central subscription model, scope vocabulary, authorization boundary, delivery metrics, and client connection-state manager.

They may have different payloads and recovery behavior. That does not make them separate livestream systems.

Normal collaborative editor traffic will consist of small structured deltas. Full editor bodies are canonical snapshot and recovery payloads, not the normal per-keystroke write or fan-out payload.

The product promise is:

> Mango never silently replaces confirmed newer work with an older browser's whole document, never claims an edit is saved before backend acknowledgement, and never asks an ordinary office worker to solve a developer-style merge conflict during normal use.

## Non-Negotiable Product Outcomes

1. The same shared editor document opened in multiple browsers or by multiple authorized users behaves as one live document.
2. A committed edit is broadcast to every exact subscribed browser connection, including multiple tabs or browsers belonging to the same user.
3. Unrelated connections and unrelated editor documents receive nothing.
4. Normal editor writes and broadcasts carry structured deltas rather than the entire serialized body.
5. Rapid typing is micro-batched into short ordered operations instead of creating one database transaction per keystroke.
6. The collaboration model covers Mango rich-text behavior, including paragraphs, lists, formatting, mentions, tables where supported, and attachment-backed inline pasted images.
7. The backend saves a committed operation once. Browsers receiving that operation apply it locally and never echo it back as another save.
8. `Saved` means the backend durably committed and acknowledged the operation. Local rendering alone never means saved.
9. Reopening, explicit refresh, reconnect, or detected revision gaps use a canonical full snapshot rather than asking the browser to replay a long historical delta range.
10. A slow, sleeping, disconnected, or corrupted browser connection cannot block delivery to healthy subscribers.
11. All realtime product events work across multiple backend instances. Process-local-only delivery is not an acceptable completed state.
12. A visible global connection indicator and mutation gate protect the user when Mango cannot prove that its live connection is healthy.
13. Unacknowledged local editor work survives reconnect and manual browser refresh.
14. No attachment file bytes, base64 bodies, presigned URLs, provider credentials, or secrets travel through realtime events.
15. Every healthy browser currently viewing the same exact editor document sees other users' committed edits appear live without refreshing, reopening, or navigating away and back.
16. Editor realtime fan-out is bounded by exact active document subscriptions, not by total company membership, total registered users, or the total number of companies in Mango.

### Explicit live visibility and bounded fan-out invariant

An editor subscription is a persistent live subscription for as long as that exact editor document is mounted and authorized. When any collaborator commits a micro-batched operation, every healthy browser connection subscribed to that exact editor document applies the committed change promptly as a remote transaction. This includes different users and multiple browsers or tabs belonging to the same user. Remote collaboration must feel live; refresh, reopen, navigation, polling, or manual reconciliation is not part of the normal viewing experience.

The editor scope must include the company boundary and one exact collaborative document identity. Opening one Logic Gate body, Node body, Project text box, or individual Node text box subscribes only to that document. Viewing another resource, another text box in the same Node, another editor in the same company, or any resource in another company does not subscribe that browser to this document's changes.

This is the required scale boundary. Mango may eventually serve tens of thousands of companies with hundreds or more employees each, but those stored companies and users are not automatically realtime recipients. For an editor event, browser delivery cardinality is proportional to the healthy active browser connections currently subscribed to that exact document. A document with nine active viewer connections has nine browser delivery targets; thousands or millions of unrelated users add zero browser deliveries. No company-wide editor stream, wildcard editor subscription, user-directory broadcast, or fan-out to inactive employees is permitted.

The frontend shares one network subscription when multiple mounted local consumers need the same exact scope and fans out locally to those consumers. It subscribes when the exact editor becomes active, retains the subscription while required, and unsubscribes when the last local consumer unmounts, access is revoked, or the document becomes terminal. The backend registry and publication boundary deliver only to matching authorized connections. Shared-backplane transport across backend instances must not widen the browser audience.

## Current Foundation And Current Gap

Mango already has the right reusable local transport shape:

- one frontend socket manager in `frontend/src/modules/realtime/realtimeWebSocket.ts`;
- one backend ticket/WebSocket/frame/subscribe/unsubscribe/heartbeat path in `backend/internal/http/realtime_ticket.go` and `backend/internal/http/realtime_ws.go`;
- one process-local subscription registry in `backend/internal/http/realtime_registry.go`;
- one authorization-aware publication boundary in `backend/internal/http/realtime_publish.go`;
- exact connection identities, so multiple browsers for the same user remain separate delivery targets;
- exact scopes for notifications, mailboxes, Node chat, and mounted Kanban boards;
- per-scope publication ordering, bounded concurrent fan-out, write deadlines, failed-connection removal, and delivery/no-subscriber metrics; and
- one frontend `subscribeRealtimeScope(...)` entry point used by the retained live surfaces.

The four originally identified retained product lanes are listed below; they are a delivery-scope baseline, not the exhaustive Phase 1 persisted-producer inventory:

- `notifications:user:{user_id}` for notifications and the Updates experience;
- `chat:node:{node_id}` for mounted durable Node chat;
- `board:{board_id}` for a mounted Logic Gate Kanban board; and
- one exact active mailbox scope: personal account or shared inbox.

The critical current gap is cross-instance delivery. Each backend `Server` owns an in-memory registry and the publisher writes only to that local registry. A mutation HTTP request can land on backend instance A while an intended recipient's WebSocket is connected to backend instance B. The completed architecture must route the committed event through a shared backplane so every instance can deliver it to its own local exact subscribers.

Editor collaboration must extend this foundation. Do not create an editor-only WebSocket endpoint, an editor-only reconnect loop, a second browser connection manager, or a second unrelated broker contract.

## One Realtime Spine

### 1. Mutation and canonical commit

The originating command authenticates the actor, verifies company and resource access, validates the operation, and applies it to canonical state.

For editor collaboration, the command carries a structured editor operation or micro-batch, not the complete HTML document.

### 2. Transactional outbox

Every persisted product mutation that requires a realtime event must commit the canonical application change and its durable realtime-outbox record atomically in the same database transaction. They may remain separate SQL statements, but they have one database commit: both succeed or neither succeeds. The backend must not report the mutation as committed until that transaction commits.

An outbox insertion, validation, or serialization failure rolls back the canonical mutation. A canonical mutation failure writes no outbox event. Request cancellation, exceptions, early returns, connection errors, restarts, and deployments must not split these outcomes.

The transaction contains database work only: canonical mutation, durable outbox insert, and commit. Actual WebSocket or broker publication happens asynchronously after commit through the dispatcher and shared backplane and must never hold the transaction open.

Heartbeat, liveness, subscription-control, and other non-persisted connection signals use the shared transport where appropriate but do not create fake outbox rows.

The outbox record must contain enough information to publish the committed event without reconstructing untrusted client input after commit. At minimum it needs:

- a globally unique event ID;
- company ID;
- exact scope;
- event type;
- resource/editor document identity;
- committed resource revision or sequence where applicable;
- committed timestamp;
- sanitized bounded payload or a durable reference to the payload; and
- any bounded authorization/audience context required by the publisher contract.

If the transaction rolls back, no success event exists. If the transaction commits and the request process crashes before publication, another dispatcher must eventually publish the existing outbox row.

The outbox is durable recovery for publication. It is not a second canonical copy of the editor document and must not contain attachment bytes.

### 3. Outbox dispatcher

One or more workers safely claim pending outbox rows, publish them to the selected shared backplane, and mark them delivered only after the backplane accepts them.

Required behavior:

- bounded leases/claims so crashed workers do not strand rows;
- retries with backoff;
- idempotent republishing by event ID;
- per-scope ordering, especially for editor document revisions;
- no requirement for global ordering across unrelated scopes; and
- observable lag, retries, and terminal failures.

### 4. Shared realtime backplane

The backplane distributes each committed realtime event to every running backend instance that may own browser connections.

The concrete technology is deliberately not selected in this document. PostgreSQL-assisted delivery, Redis/Valkey, SNS/SQS, EventBridge, or another adapter may be evaluated, but the completed result must satisfy the same publisher contract.

Required properties:

- cross-instance delivery;
- at-least-once semantics;
- bounded low latency;
- per-scope ordering or enough sequence metadata for deterministic receiver ordering;
- event IDs for deduplication;
- safe reconnect/restart behavior;
- a local/test adapter for deterministic automated tests; and
- no reliance on load-balancer stickiness for correctness.

The transactional outbox remains the durable safety boundary even if the selected backplane itself has replay or durability features.

### 5. Every backend instance

Every backend instance consumes the shared event and hands it to the same existing publication/authorization boundary.

Each instance considers only its locally connected subscribers for the exact company and scope. It must not scan all company users.

Where current permission is required, publication reauthorizes only the distinct locally subscribed user IDs and fails closed. Revoked or no-longer-authorized connections receive no content event.

### 6. Existing local subscription registry

The local registry remains responsible for:

- connection identity;
- scope membership;
- subscription limits;
- exact local fan-out;
- per-scope ordering;
- bounded concurrent socket writes;
- socket write deadlines;
- removing failed connections; and
- distinguishing no-subscriber delivery from failed delivery.

Do not deduplicate delivery by user ID. If one user has three browsers subscribed to the same editor, all three connections need the event.

### 7. Exact browser connections

The shared frontend realtime client dispatches the event to every mounted local consumer for the scope.

One browser connection may have multiple React consumers for the same scope. The client should subscribe over the network once per exact scope and fan out locally to its mounted handlers.

Incoming committed editor operations must be tagged as remote/committed transactions so applying them to the editor cannot trigger the local autosave path or create an echo loop.

## Shared Event Envelope

All product event families should share a small common envelope even though their payloads differ.

Conceptually:

```json
{
  "event_id": "globally-unique-id",
  "type": "editor.delta.committed",
  "company_id": "company-id",
  "scope": "editor:node:node-id:text-box-id",
  "resource_revision": 106,
  "committed_at": "2026-07-15T00:00:00Z",
  "payload": {}
}
```

Envelope requirements:

- event IDs are stable across retries;
- scope is exact and validated;
- event type is explicit and versionable;
- payload size is bounded;
- revision is present for ordered stateful resources such as editor documents;
- clients ignore duplicate event IDs/revisions safely; and
- sensitive body content appears only where the exact authorized feature requires it.

Chat, Kanban, Updates/notifications, and mailbox hints may continue to use compact feature-specific payloads. Editor collaboration is the approved case where the exact authorized stream carries the structured document delta itself.

Connection health control messages use the same WebSocket and central client state manager, but they are not durable product mutations and must not create database outbox rows.

## Approved Realtime Families

| Family | Scope | Normal payload | Recovery |
| --- | --- | --- | --- |
| Updates/notifications | `notifications:user:{user_id}` | User-targeted committed notification event/hint | Canonical summary and mounted Updates reconciliation |
| Node chat | `chat:node:{node_id}` | Compact durable chat create/delete event | Canonical mounted chat refresh |
| Logic Gate Kanban | `board:{board_id}` | Compact committed board-change hint | Canonical conditional board/work refresh |
| Active mailbox | Exact personal-account or shared-inbox scope | Compact provider/mailbox change hint | Canonical exact-mailbox refresh |
| Collaborative editor | Exact editor-document scope | Committed structured rich-text delta plus revision | Full canonical editor snapshot |
| Connection health | Connection control plane | Heartbeat/connection status | Reconnect, resubscribe, snapshot reconciliation |

This table is the allowed product realtime inventory after this charter. Any proposed new family must join the same spine and document why it needs cross-user live behavior.

## Collaborative Editor Scope And Persistence Boundaries

The collaboration identity is the smallest independently editable durable shared document, not the entire Node, Logic Gate, or Project.

### Node

- Each Node `Text box` projection is its own collaborative editor document.
- A Node with five text boxes has five independent editor documents, revisions, streams, and snapshot identities.
- Editing one text box must not contend with or rewrite the other four.
- Node titles, assignments, relationships, permissions, attachments, and other metadata remain field/command-specific mutations outside the editor delta body.

### Logic Gate

- The Logic Gate root/editor document is its own collaborative editor document.
- Any additional independently editable Logic Gate text box receives its own document identity.
- Kanban cards/columns and Logic Gate editor text share the same realtime backbone but retain separate scopes, payloads, revisions, and recovery reads.

### Project

- Each Project text box is its own collaborative editor document.
- Project metadata, relationships, and child collections are not serialized into the editor body.
- Embedded Node editors retain the Node text-box identity rather than becoming copies owned by the Project surface.

### Chat

- Chat is a separate append-oriented durable message model.
- A sent chat message is not part of an editor document snapshot.
- Chat composer text remains local/private until the user sends it unless a separate shared-draft product rule is explicitly approved.
- Node chat may continue to use `chat:node:{node_id}` on the same spine.

### Mail editors and other private editors

This charter automatically covers durable shared Node, Logic Gate, and Project editor documents. It does not make a user's personal email signature, private email compose body, or other personal draft visible to collaborators.

If a genuinely shared email draft or another shared editor is later approved for live coediting, it must adopt the same editor-document protocol and realtime spine rather than inventing another system.

## Editor Document Model

Whole serialized HTML is not a safe collaboration primitive. Concurrent rich-text changes need a mature structured collaboration model with stable document positions/identities and deterministic convergence.

Implementation must select and integrate an established OT/CRDT-style engine or equivalent mature collaboration model. Do not home-grow naive character-offset patches against browser-normalized `innerHTML`.

The collaboration model must preserve every supported Mango rich-text behavior, including:

- Unicode letters, numbers, punctuation, and ordinary typing;
- paragraphs, line breaks, and whitespace semantics;
- ordered lists, unordered lists, Mango bullets, and checklists;
- list nesting, indentation, and outdent behavior;
- bold, italic, underline, strikethrough, highlight, font sizing, links, and other supported marks;
- mentions and supported embedded references;
- tables and table-cell editing where the host supports tables;
- attachment-backed inline images;
- image sizing/alignment metadata that is part of the durable document;
- undo/redo behavior that distinguishes local and remote operations; and
- sanitized canonical serialization for existing non-collaboration consumers.

The structured collaboration document becomes the editing primitive. Sanitized HTML may remain an import/export, email-rendering, saved-version, or materialized-read format, but it must not be the unit overwritten for every small edit.

## Inline Pasted Images

Inline image collaboration crosses two different persistence boundaries:

1. The browser inserts a local placeholder in the editor.
2. The image file uploads through the existing attachment upload system.
3. Mango durably commits the attachment and its authorization/resource relationship.
4. The editor submits a structured delta that inserts an image node referencing the durable attachment ID and presentation metadata.
5. The committed image-node delta travels through the exact editor scope.
6. Other browsers render the image by using the authorized attachment-content path and normal attachment caching.

Never put raw image bytes, data URLs, base64 bodies, presigned URLs, or S3 credentials in the editor delta, transactional outbox, shared backplane, or WebSocket message.

If upload fails, the placeholder remains a clearly failed local item or is removed according to the existing editor attachment contract. It must not be broadcast as a successfully durable image.

## Micro-Batching

Rapid typing is micro-batched.

Requirements:

- local typing renders immediately;
- a short bounded window coalesces compatible consecutive local operations;
- one accepted micro-batch receives one server revision;
- formatting and structural changes retain their correct order relative to text inserts/deletes;
- pending work flushes before target switch, close/unmount, manual saved-version creation, or another operation that requires a fully committed editor state;
- the precise batching interval is configurable/testable and remains an implementation decision; and
- batching must not delay visible remote collaboration enough to feel non-live.

Typing `hello` quickly may become one insert operation. It must not create five full-document rewrites, and it must not cause every other browser to perform five full snapshot GETs.

## Normal Editor Mutation Flow

Use this exact scenario as a primary acceptance case:

- one user has five browsers open;
- three of those browsers are on the same editor document;
- the other two are viewing unrelated resources;
- seven other users are active;
- six of those users are viewing that same editor document; and
- the seventh user is viewing something unrelated.

There are nine exact editor subscribers and three unrelated connections.

When the originating user edits:

1. The originating editor renders the local change immediately.
2. Before the operation can be lost, the browser records the unacknowledged operation in its durable local pending queue.
3. The browser creates or extends a micro-batch with a unique operation ID, editor document ID, client/tab ID, collaboration state, and structured delta.
4. The browser sends the micro-batch to the authenticated backend command endpoint/protocol.
5. The backend verifies access and integrates the operation with the current collaboration document.
6. The backend assigns the next committed editor revision.
7. One transaction durably records the accepted operation/canonical state change and the realtime outbox event.
8. After commit, the origin receives backend acknowledgement. Only now may the operation be marked saved and removed from the local pending queue.
9. The outbox dispatcher publishes the committed delta to the shared backplane.
10. Every backend instance receives the event and invokes the existing exact-scope publication boundary for its local subscribers.
11. All nine subscribed connections are delivery targets. The three unrelated connections receive nothing.
12. The originating connection recognizes its own operation/event ID, confirms it, and does not apply it twice.
13. The other eight subscribed editors apply the committed operation as a remote transaction without triggering local autosave.

The originating HTTP/WebSocket acknowledgement does not wait for all nine browser deliveries. Database commit defines saved. Failed recipients recover independently.

## Revisions

Each collaborative editor document has its own monotonically increasing server revision or equivalent server-ordered commit sequence.

The revision is used for:

- identifying the canonical head;
- ordering committed events;
- duplicate suppression;
- detecting gaps;
- binding ETags and full snapshots to an exact state;
- proving when a browser has caught up; and
- observability/debugging without logging document content.

The revision is not used to force ordinary simultaneous collaborators into a one-winner/one-conflict whole-document workflow.

If two users submit operations derived from the same earlier state, the collaboration engine integrates them and the server assigns a deterministic committed order. A client that began from an older collaboration state is not automatically rejected merely because another valid delta committed first.

Client rules:

- next expected revision: apply the delta;
- duplicate event ID or already-applied revision: ignore safely;
- revision gap: pause that editor's authoritative synchronization and request a full canonical snapshot;
- reconnect: request a full canonical snapshot rather than a long client-side delta replay; and
- full snapshot accepted at revision `R`: ignore buffered committed events at or below `R`, then apply any buffered events above `R` in order.

## ETags, Cache, And Full Snapshots

### ETag meaning

An editor ETag represents the current canonical full editor state at a specific head revision. It must not represent only a physically materialized snapshot row if newer durable deltas exist.

The full-snapshot API must return a state that includes every committed operation through the reported revision, even if the server internally reconstructs it from an older compacted snapshot plus later operations.

### When browsers request a full snapshot

Browsers request or conditionally validate a full editor snapshot when:

- the Node, Logic Gate, or Project editor document is first opened;
- a Node/Logic Gate/Project popup is opened or reopened;
- the user presses the product refresh button;
- the browser reconnects after a transport failure;
- the browser/tab wakes or resumes in a state that requires reconnect recovery;
- a supposedly healthy stream exposes a revision gap;
- local state verification detects divergence; or
- the server instructs the client that its prior state can no longer be incrementally accepted.

### Normal open and manual refresh

For normal open/reopen and explicit refresh:

- the browser may render a cached confirmed server snapshot immediately for fast display;
- cached data remains distinguishable from locally pending operations;
- the browser establishes/retains the exact editor subscription and closes the load-to-subscribe race;
- it sends a conditional full-snapshot GET using the confirmed server ETag;
- `304` keeps the confirmed cached snapshot;
- `200` replaces it with the complete canonical state and revision; and
- editing becomes authoritative only after the snapshot and subscription boundary are accepted.

### Reconnect

Reconnect uses a complete current snapshot instead of asking the browser to retrieve every missed delta after its old revision.

The reconnect flow is:

1. Re-establish the shared WebSocket connection.
2. Reauthenticate and restore exact subscriptions.
3. Buffer any newly arriving committed editor events for mounted documents.
4. Fetch the complete current server snapshot for each mounted collaborative editor.
5. Apply the snapshot and its revision.
6. Discard buffered events at or below that revision and apply newer buffered events in order.
7. Reapply and submit any durable locally pending operations.
8. Wait for acknowledgement of pending operations.
9. Mark the document caught up.
10. Return the global connection state to green only after all required mounted-document recovery completes.

An unconditional full body on reconnect is acceptable and is the approved simple recovery behavior. Conditional requests remain useful for ordinary open/reopen and manual refresh.

### Full-snapshot creation/compaction policy remains open

This charter does not choose when the backend physically materializes or compacts a full editor snapshot.

Possible triggers to evaluate later include:

- elapsed time;
- operation count;
- accumulated delta bytes;
- document complexity;
- editor/session closure;
- manual saved-version creation; and
- background compaction thresholds.

Whatever policy is selected must guarantee:

- every full snapshot records the exact revision it represents;
- canonical current state can always be reconstructed;
- delta history is not removed until a replacement snapshot safely covers it;
- server-side reconstruction remains bounded enough for open/reconnect latency; and
- internal compaction snapshots remain distinct from user-visible saved versions.

Agents must not invent an arbitrary snapshot cadence while implementing unrelated layers of this charter.

## Unacknowledged Local Work

Unacknowledged local work is unavoidable even on a healthy connection because time exists between local input, micro-batch creation, network delivery, database commit, and acknowledgement. Orange reconnecting mode deliberately permits more editor typing, so durable local pending operations are mandatory.

This does not mean an end-user merge screen is required.

### Local pending queue requirements

- Store pending operations before they can be lost to component unmount, tab refresh, or process crash.
- Scope them by authenticated user, company, editor document, browser/client identity, and operation ID.
- Keep queues for separate tabs independent; acknowledging one tab's operation must not clear another tab's pending work.
- Never expose one user's pending content to another authenticated user on the same browser profile.
- Preserve operation ordering.
- Retry with the same operation ID.
- Clear an operation only after the backend acknowledges that exact operation as committed.
- Survive manual refresh when the app asks a disconnected user to refresh.
- Use a durable, quota-aware browser store appropriate for structured operations; component memory alone is insufficient.

### Reconnect with pending work

When reconnecting:

1. Keep the pending local operations untouched.
2. Fetch and accept the complete current server snapshot.
3. Apply/rebase the pending local operations against that fresh collaboration document through the collaboration engine.
4. Submit them with their original stable operation IDs.
5. Let the backend deduplicate operations that may have committed before the acknowledgement was lost.
6. Wait for acknowledgement and current-head convergence.
7. Clear only acknowledged local records.

The user does not choose between `server` and `local`. The system converges automatically.

Exotic terminal cases such as deleted resources, revoked access, corrupt local storage, or a collaboration-engine invariant failure still require loss-proof recovery handling, but that UI can be designed separately. Even then, Mango must preserve recoverable user content rather than silently discard it.

## Connection Heartbeat And Global Status

### Existing transport heartbeat

Mango currently sends an RFC 6455 protocol-level Ping every 25 seconds. The browser networking stack answers Pong below JavaScript. This is a real backend-to-browser-to-backend transport round trip and should remain the low-level keepalive below the load balancer's idle timeout.

The current React application cannot directly observe the browser's automatic Pong. The new design must expose confirmed connection health through the same centralized realtime client without creating per-surface heartbeat loops or periodic canonical API reads.

A valid implementation may have the backend track confirmed Pong activity and emit a lightweight application-visible connection-health control message. The exact control-frame/message design is an implementation choice, but the visible status must represent actual server-connected health rather than a decorative frontend timer.

Heartbeat health uses the existing shared WebSocket/control plane. It does not use the transactional outbox because heartbeat status is not a durable product mutation.

### Indicator placement and accessibility

Place the global connection indicator at the very top of the Key Views column, immediately to the left of the trash icon.

It must include both color and text:

- `Connected`;
- `Reconnecting`;
- `Syncing changes`;
- `Attempting to reconnect`; or
- `Disconnected — refresh your browser`.

Color alone is not sufficient. Provide an accessible label/tooltip and a non-color state distinction such as pulse, blink, or icon treatment.

Every confirmed healthy heartbeat should produce a clear green pulse. The server cadence remains 25 seconds, with a small grace interval before the client declares the heartbeat late. The exact grace duration remains to be tuned; an exactly 25.000-second timeout would create false orange transitions from ordinary jitter.

### Central state machine

The connection state belongs to the shared realtime client/app shell. Chat, Kanban, Updates, mailbox, and editor components consume it; they do not implement separate socket-health states.

#### Green: Connected

- Confirmed connection health is within the allowed window.
- Required subscriptions are accepted.
- Mounted collaborative editors have completed any required recovery.
- All normal app mutations are permitted.
- Local editor changes still remain `Saving` until individually acknowledged.

Green connection health and per-editor saved status are separate facts.

#### Orange: Reconnecting

- The socket closed/errored or confirmed health exceeded the interval plus grace.
- Background reconnect begins immediately and remains bounded/calm.
- Editor and composer typing may continue locally.
- New editor operations are durably queued and visibly unconfirmed.
- Do not claim these changes are saved.
- Side-effecting commands such as delete, Kanban movement, email send, assignment changes, or other ordinary mutations are blocked unless that feature has its own explicitly approved durable pending-command contract.
- Status text says `Reconnecting — edits stored locally` or equivalent.

#### Orange: Syncing changes

- A socket has reopened, but the app is not green yet.
- Exact subscriptions are restored.
- Mounted collaborative editors retrieve complete current snapshots.
- Pending local deltas are reapplied/submitted.
- The app remains in recovery until required acknowledgements and current-head convergence complete.

#### Blinking red: Attempting to reconnect

- The initial bounded orange reconnect attempt failed or exceeded its short recovery window.
- A blocking modal prevents all app mutations and interaction that could create new durable changes.
- The app continues background reconnect attempts.
- The indicator and modal clearly blink/show red and say `Attempting to reconnect`.
- The modal explains that Mango paused changes to protect the user's work and reports pending local work without exposing content.
- Do not log the user out merely because realtime is disconnected.

#### Solid red: Disconnected

- The automatic retry budget is exhausted or recovery cannot safely complete.
- The modal remains blocking.
- Text says `Disconnected — refresh your browser`.
- A manual browser refresh action is offered.
- Any pending local editor operations survive that refresh.

The exact orange duration, red retry budget, and backoff schedule remain implementation parameters that need focused tests and production-safe defaults.

## Mutation Policy By Connection State

| State | Editor/composer typing | Ordinary business mutations | Reads/navigation | Background recovery |
| --- | --- | --- | --- | --- |
| Green | Allowed and sent normally | Allowed | Allowed | Normal monitoring |
| Orange: Reconnecting | Allowed locally; durably queued | Blocked unless explicitly durable/offline-capable | Allowed | Reconnect |
| Orange: Syncing | Existing queued work reconciles; new typing may remain locally queued | Blocked | Allowed | Snapshot/subscription/pending-op recovery |
| Blinking red | Blocked | Blocked | Modal-dominated/read-only at most | Continues automatically |
| Solid red | Blocked | Blocked | Modal-dominated | Manual refresh requested |

This deliberately avoids claiming that every Mango mutation is offline-capable. The approved orange exception is primarily for writing text down safely.

## Open/Subscribe Race

The full snapshot and live subscription must form one coherent acceptance boundary so a commit occurring between load and subscription cannot be missed.

One valid approach is:

1. Establish/retain the exact editor subscription.
2. Buffer committed editor events temporarily.
3. Perform the conditional or full canonical snapshot read.
4. Accept snapshot revision `R`.
5. Discard buffered events at or below `R`.
6. Apply buffered events above `R` in order.
7. Enable authoritative editing.

An equivalent server-coordinated handshake is acceptable, but a naked `GET` followed later by `subscribe` is not.

## Failure And Recovery Matrix

| Failure | Required behavior |
| --- | --- |
| Client operation never reaches backend | Keep local pending operation and retry with the same operation ID. |
| Backend commits but response/ACK is lost | Retry same operation ID; backend returns/detects the original committed result without applying twice. |
| Backend commits and request process crashes before publish | Transactional outbox remains pending; another dispatcher publishes it. |
| Backplane publishes duplicate event | Backend/client deduplicates by event ID and document revision. |
| Backplane is temporarily unavailable | Outbox retries; canonical commit remains saved; clients recover through full snapshots if necessary. |
| Mutation and recipient WebSocket are on different backend instances | Shared backplane delivers to every instance; the recipient's local registry fans out. |
| One browser socket stalls | Deadline expires, only that connection is removed, healthy subscribers continue. |
| Browser sleeps or disconnects | Enter orange, retain local pending edits, reconnect, retrieve full snapshots, resubmit, then return green. |
| Browser receives an unexpected revision gap | Pause that editor's authoritative stream and retrieve a full current snapshot. |
| Browser receives duplicate delta | Ignore it without echoing or resaving. |
| Browser refreshes while orange/red | Pending local operations survive and resume after full-snapshot recovery. |
| Permission is revoked after subscription | Publication reauthorizes/fails closed; connection receives no later protected content. |
| Resource is deleted while mounted | Use an authorized exact tombstone/terminal handling contract; stop editing/subscription and preserve any recoverable local pending work. |
| Inline image upload fails | Never broadcast a durable image node; preserve/remove failed placeholder according to the attachment contract. |
| Heartbeat is late but socket recovers | Orange reconnect/sync flow runs; do not return green on socket-open alone. |
| Automatic reconnect fails | Blinking red blocking modal, then solid red/manual refresh after retry budget. |

## Saved Status And User Messaging

Per-editor state should be understandable without exposing engineering terminology:

- `Saving…` — local operation exists but is not yet acknowledged;
- `Saved` — every operation through the shown local state is backend-acknowledged;
- `Reconnecting — changes stored locally` — connection is orange and edits are pending locally;
- `Syncing changes…` — full snapshot and pending operations are reconciling;
- `Editing paused — attempting to reconnect` — blinking red mutation block; and
- `Disconnected — refresh your browser` — solid red.

Do not show `merge conflict`, `expected revision`, `409`, `CRDT`, `OT`, `outbox`, or other engineering language to ordinary users.

The product may show collaborator presence/cursors later or as part of the selected collaboration engine, but presence is not a substitute for correctness and is not required to define saved state.

## Security And Authorization

- Subscription admission validates authenticated user, company, exact resource existence, and required access.
- Editor scopes must be unguessable only in the normal identifier sense; authorization, not secrecy of IDs, protects content.
- Publication reauthorizes current exact local candidates where the resource contract requires it.
- An administrator override does not bypass resource existence or wrong-company boundaries.
- Revoked subscribers receive no later protected delta.
- Outbox/backplane payloads are bounded and sanitized.
- Do not log editor text, raw deltas containing user content, email bodies, attachment bytes, presigned URLs, provider secrets, access tokens, or database credentials.
- Metrics/logs may include event ID, company ID, scope type, resource ID where permitted, revision, payload byte count, delivery count, latency, and fixed error category.
- Inline images remain private attachment resources and follow existing access checks.
- All database migrations and production rollout actions remain subject to `AGENTS.md` and `docs/security/database-agent-access-contract.md`; agents do not apply production schema changes.

## Existing Surface Migration

The shared backplane is not editor-only infrastructure. Existing retained realtime producers must be routed through the same committed-publication adapter.

### Updates/notifications

- Preserve the one user notification scope.
- Do not create a second Updates socket or feed-specific backplane.
- Existing canonical summary/feed reconciliation remains feature-owned.

### Node chat

- Preserve exact mounted Node chat authorization.
- Route committed create/delete events through the transactional outbox/backplane.
- Chat remains append/delete message behavior, not editor-document delta behavior.

### Kanban

- Preserve exact mounted board scopes and compact canonical-refresh hints.
- Route committed board-visible changes through the outbox/backplane.
- Do not replace the board's canonical work read with editor-style document operations.

### Active mailbox

- Preserve exact personal-account/shared-inbox ownership and compact hints.
- Route accepted durable/retry-safe mailbox events through the shared backplane.
- Provider message bodies and attachment bytes remain canonical provider/HTTP data, not realtime payloads.

### Collaborative editor

- Add exact editor-document scope authorization to the existing subscription inventory.
- Carry structured committed deltas because this feature needs actual live document operations.
- Use full canonical snapshots for open/refresh/reconnect/gap recovery.

Feature-specific producers and recovery coordinators are allowed. Separate sockets, registries, brokers, heartbeat managers, or connection-state stores are not.

## Observability

Required backend metrics:

- pending outbox depth and oldest-row age;
- outbox claim, publish, retry, and terminal-failure counts;
- backplane publish/consume latency and duplicate counts;
- events received per backend instance;
- exact-scope local delivery attempts, successes, failures, and no-subscriber no-ops;
- WebSocket active connections/subscriptions by allowed scope type;
- write deadline failures and connection removals;
- editor operation commit latency and micro-batch size/byte count;
- editor revision-gap/full-snapshot recovery counts;
- full-snapshot reconstruction latency and operation replay count on the server;
- reconnect/orange/blinking-red/solid-red transition counts; and
- pending-local-operation recovery success/failure counts reported without content.

Required structured logs should use fixed stages/categories and request/event/connection IDs. Never log raw editor content or secrets.

Operational dashboards/alerts should make these conditions visible:

- outbox lag growing;
- one backend instance not consuming the backplane;
- delivery failure rate increasing;
- reconnect storms;
- repeated revision-gap recovery;
- full-snapshot reconstruction becoming slow; and
- durable local pending operations repeatedly failing to acknowledge.

## Rollout Sequence

This is one architecture program that may be implemented in ordered phases. Phases may not introduce permanent parallel spines.

### Phase 0: Contract reconciliation

- Update the relevant `docs/tests/*.md` rules and scenarios alongside the first implementation work.
- Explicitly replace the old no-coediting and user-merge-conflict expectations.
- Inventory every legacy checkpoint, `draft_restored`, per-tab full-body draft, conflict-modal, compatibility, test, and documentation path listed in the mandatory-deletion section; assign each one to deletion during the owning surface's cutover.
- Preserve the narrow retained-scope philosophy.

### Phase 1: Shared committed-event backbone

- Define the common publisher/backplane interface and event envelope.
- Add transactional outbox persistence/claim/retry behavior.
- Add a deterministic local/test backplane adapter.
- Add the selected cross-instance production backplane adapter.
- Inventory every persisted realtime-event producer, including but not limited to notifications/Updates, Node chat, Kanban, mailbox/email changes or hints, and editor collaboration; route each through repository-owned mutation-plus-outbox transactions and the shared spine.
- Prove outbox insertion failure rolls back the canonical mutation and canonical mutation failure leaves no event.
- Prove a committed row survives failure before broadcast, dispatch retries safely, and stable event IDs/revisions suppress duplicate effects.
- Record exact prior/final transaction ownership, scopes, retry behavior, bypass audit, and test evidence for every producer in the Phase 1 inventory ledger.
- Prove a mutation handled by backend A reaches a WebSocket connected to backend B.

### Phase 2: Central connection health and mutation gate

- Keep the protocol Ping/Pong.
- Expose application-visible confirmed health through the central client.
- Add the Key Views indicator and text states.
- Add green/orange/blinking-red/solid-red transitions.
- Add the global mutation gate and background reconnect behavior.
- Add durable browser storage for unacknowledged editor operations before orange editing ships.

### Phase 3: Collaboration engine and storage protocol

- Select the mature structured collaboration model/library.
- Define editor document identities and scope authorization.
- Define operation IDs, revisions, event payloads, micro-batching, persistence, ETags, and full-snapshot reads.
- Prove deterministic convergence, duplicate safety, and no echo saves in isolated tests.

### Phase 4: Node, Logic Gate, and Project integration

- Migrate Node text boxes.
- Migrate the Logic Gate root/editor document and any independent text boxes.
- Migrate Project text boxes and embedded Node identity behavior.
- Preserve full shared rich-text behavior and attachment-backed images.
- For each migrated surface, delete the entire legacy full-document checkpoint, per-tab draft, `draft_restored`, revision-conflict modal/action, compatibility, test, and documentation path in the same cutover. Do not leave the old system dormant beside the new one.
- Add and execute the one-time legacy browser-storage cleanup so old checkpoint keys cannot reactivate obsolete behavior after deployment.

### Phase 5: Recovery, compaction, and hardening

- Implement full-snapshot open/refresh/reconnect/gap behavior.
- Implement pending-local-operation reapplication after reconnect.
- Select and validate physical snapshot/compaction thresholds from measurements.
- Exercise sleep/wake, long-idle, multi-tab, multi-user, cross-worker, and browser-refresh recovery.
- Finish observability and operational runbooks.

Every phase must leave one coherent direction. Do not add compatibility code that restores revisionless whole-document last-write-wins writes.

## Required Automated Evidence

### Backend

- Canonical mutation and outbox insert commit or roll back together.
- A crash after commit and before publish is recovered by another dispatcher.
- Duplicate backplane events are harmless.
- Same-scope events preserve revision order.
- Different scopes do not unnecessarily block one another.
- Backend A mutation reaches subscribers connected to backend B.
- Exact-scope authorization and publication-time revocation fail closed.
- One stalled socket does not block healthy same-scope or unrelated-scope subscribers.
- Multiple connections for one user all receive the exact event.
- Unrelated connections receive nothing.
- Operation IDs are idempotent when acknowledgement is lost.
- Full snapshots represent every committed operation through their reported revision/ETag.
- Outbox/backplane payloads reject attachment bytes and oversized content.

### Frontend transport and connection state

- One shared WebSocket exists per company/client boundary as intended.
- Multiple local consumers share one network scope subscription.
- Heartbeat health drives one central green/orange/red state.
- Green pulses only from confirmed server-connected health.
- Orange permits local editor typing and durably queues operations.
- Disallowed side-effecting mutations are gated while orange.
- Blinking red blocks mutations while background retry continues.
- Solid red asks for refresh and pending work survives it.
- Socket-open alone does not turn green before snapshot/subscription recovery.

### Editor protocol

- Origin applies its own acknowledged event once, not twice.
- Remote operations do not trigger autosave/echo writes.
- Concurrent operations converge without whole-document replacement.
- Revision duplicates are ignored.
- Revision gaps cause a full-snapshot recovery.
- Initial open and subscription cannot miss a between-load-and-subscribe commit.
- Reconnect obtains a full snapshot and reapplies pending local operations.
- A lost acknowledgement followed by retry does not duplicate content.
- Micro-batching preserves typing/format ordering and flush boundaries.
- Separate text boxes in one Node/Project do not contend.
- Same text box opened through different surfaces uses one editor document identity.
- Every healthy exact subscriber renders another user's committed operation live without refresh, reopen, navigation, or polling.
- Large numbers of unrelated companies, employees, connections, and editor scopes do not increase the browser delivery count for one exact-document event.

### Rich editor browser-level behavior

Use real browser/DOM integration coverage, not only source-pattern tests, for:

- simultaneous ordinary typing;
- simultaneous edits in different paragraphs and the same paragraph;
- ordered/unordered/checklist changes;
- indentation and nested lists;
- inline formatting and links;
- paste of rich text;
- inline pasted image upload/placeholder/commit/broadcast;
- image sizing/alignment collaboration;
- undo/redo around remote operations;
- selection/caret preservation when remote operations apply;
- Node, Logic Gate, and Project host parity; and
- reconnect with locally pending rich-text operations.

## Primary End-To-End Acceptance Scenarios

### Scenario 1: Five browsers plus seven other users

Given the exact nine-subscriber/three-unrelated scenario in this document, one micro-batched editor change commits once, reaches all nine exact connections across backend instances, applies once per editor, and reaches none of the three unrelated connections.

### Scenario 2: Concurrent collaborators

Two users edit the same document at nearly the same time. Both operations commit, receive ordered revisions, converge automatically in every subscriber, and neither entire body overwrites the other.

### Scenario 3: Multiple text boxes

Two users edit different text boxes inside one Node or Project. Each document advances independently and neither operation rewrites or blocks the other text box.

### Scenario 4: Stalled browser

One subscribed browser stops reading. Its deadline expires and its connection is removed. Healthy subscribers still receive ordered events without waiting for the stalled browser.

### Scenario 5: Cross-instance delivery

The mutation is handled by backend A while some subscribers are connected to A and others to backend B. All exact subscribers receive the event through the outbox/backplane/local-registry spine.

### Scenario 6: Crash after commit

The canonical editor operation and outbox event commit, then the request process exits before publication. Another dispatcher publishes the event; retrying the client operation remains idempotent.

### Scenario 7: Initial cached open

The browser renders a cached confirmed snapshot, establishes the exact subscription boundary, and conditionally validates the ETag. `304` retains the cache; `200` replaces it. A commit between subscription and GET is buffered/applied without loss.

### Scenario 8: Reconnect with no local work

The browser turns orange, reconnects, retrieves the complete current snapshot, restores subscriptions, catches up, and returns green without retrieving a long client delta history.

### Scenario 9: Reconnect with local work

The browser turns orange while typing remains allowed. Pending operations survive locally. On reconnect Mango retrieves the complete current snapshot, reapplies/submits pending operations, receives acknowledgement, and only then returns green.

### Scenario 10: Blinking and solid red

Initial reconnect fails. The app shows a blinking-red blocking modal while background retries continue. When the retry budget is exhausted, the state becomes solid red and requests manual refresh. Pending editor operations survive the refresh.

### Scenario 11: Inline pasted image

An image paste uploads through the attachment system, then commits an image-reference editor delta. Other browsers see the authorized image. No file bytes/base64/presigned URL enters the outbox, backplane, or WebSocket.

### Scenario 12: Existing live families stay on one spine

Notifications/Updates, Node chat, mounted Kanban, exact active mailbox, and editor collaboration all use the shared backplane and local registry. Source inventory tests reject any feature-owned second socket/backplane/heartbeat manager.

### Scenario 13: Large platform, bounded exact-document fan-out

Given a platform with tens of thousands of companies and large employee directories, only a small number of healthy browser connections are actively viewing one exact editor document. A committed operation is delivered live to every one of those exact subscribers and to no other connection. Adding unrelated companies, employees, open connections, or subscriptions does not increase that event's browser recipients. Closing the last local view removes the exact network subscription, and permission revocation stops later delivery.

## Resolved Implementation Choices

- PostgreSQL `realtime_outbox` is the durable shared backplane log; every instance claims/publishes and consumes published sequence rows.
- `editor_collaboration_documents`, `editor_collaboration_operations`, and `editor_collaboration_snapshots` are the physical collaboration tables.
- The collaboration engine is structured Quill Delta operational transform using mature browser and Go transform/compose implementations.
- Client micro-batching defaults to 160 ms, splits large text inserts below 24 KiB, and enforces a 64 KiB encoded-operation ceiling.
- Physical compaction occurs after 128 operations or 512 KiB of delta JSON, bounding reconstruction to at most 127 normal operations.
- Heartbeats run roughly every 25 seconds; confirmation grace is 35 seconds, attempting is entered after the short recovery threshold, and disconnected is entered after eight failures or 60 seconds.
- Presence/cursors do not ship in this release.
- Rare terminal local recovery remains protected by durable pending operations, a solid-red manual-refresh instruction, and automatic reapplication after refresh; the product does not expose a merge screen.

## Non-Goals

- Do not restore generic workspace/project/graph/Explorer browser replication.
- Do not send whole editor bodies on every keystroke or every live fan-out.
- Do not make every Mango business mutation offline-capable merely because editor typing is locally queueable while orange.
- Do not make WebSocket delivery the durable source of truth; database commit remains authoritative.
- Do not make clients replay an unbounded historical delta log after reconnect.
- Do not send attachment bytes through the realtime spine.
- Do not rely on sticky sessions for cross-instance correctness.
- Do not ask users to resolve developer-style merge conflicts during normal collaboration.
- Do not treat saved-version history as a substitute for preventing data loss.
- Do not create a fifth or sixth connection manager, publisher, broker, or heartbeat path for the editor.
- Do not preserve the legacy full-document checkpoint, per-tab draft, `draft_restored`, or end-user conflict system as a fallback beneath the unified editor model.

## Definition Of Done

This charter is implemented only when all of the following are true:

1. Every persisted realtime-event producer is inventoried; its canonical mutation and durable outbox insertion share one atomic database transaction; no save-first/enqueue-afterward or direct-broadcast bypass remains; and the shared cross-instance realtime backplane is production-capable.
2. Existing frontend/backend realtime paths converge on the shared interfaces without parallel delivery systems.
3. Node, Logic Gate, and Project shared editor documents use structured micro-batched delta collaboration.
4. Full snapshot/ETag open, refresh, reconnect, and revision-gap recovery are implemented.
5. Durable pending local operations survive disconnect and manual refresh and are automatically reconciled.
6. The green/orange/blinking-red/solid-red connection indicator and mutation gate work from actual server-connected health.
7. Rich text, lists, formatting, mentions, tables where supported, and inline attachment-backed images retain behavior under collaboration.
8. Multi-browser, multi-user, cross-instance, crash, duplicate, gap, and stalled-client scenarios pass automated tests.
9. Every legacy full-document checkpoint, per-tab full-body draft, `draft_restored` block, end-user whole-document conflict modal/action, and compatibility path is deleted from migrated editor surfaces rather than retained as a fallback.
10. The legacy browser-storage and tab-session keys are removed at cutover and cannot resurrect an obsolete warning or modal.
11. Legacy tests and source-of-truth rules are deleted or replaced with unified-model expectations, with no contradictory old behavior remaining.
12. Focused verification and `node scripts/run_all_tests.mjs` pass.
13. Any database migration and rollout requirements are reported explicitly, and production changes remain human-controlled under the repository security contract.
14. Mango exposes only `edit` or `no access`; no executable view-only permission branch, schema/default, API contract, test, owner document, or user-facing copy remains.

### Completion audit

- Complete with passing behavior evidence: all items 1-14. The exhaustive producer table proves atomic outbox boundaries and exact scopes; forced PostgreSQL failures prove rollback behavior; stable operation and event identities prove retry/deduplication; production direct-broadcast bypasses are removed; and the real browser proves visible convergence.
- Bounded rich paste is browser-proven with 28,000 repeated rich segments committed through ordered Quill Delta batches; exact visible DOM text and structured markup remain intact through gap recovery and explicit reconnect. Backend PostgreSQL tests separately enforce the full 2 MiB canonical boundary and concurrent overflow rollback.
- Acknowledgement/broadcast reordering and commit-before-lost-acknowledgement recovery are proven against actual visible editor DOM state, including duplicate delivery and stable-operation deduplication.
- The real-browser matrix proves multi-user, multi-tab, exact document/company isolation, refcounted subscribe/unsubscribe, revocation, rich text, and durable inline attachment references.
- The repository-wide permission cleanup and migration enforce only `edit` or `no_access`; user, manager, and administrator roles do not create a view-only resource outcome.
- The 2026-07-16 post-integration repair proves literal rich markup is no longer rendered as text, durable attachment frames retain ID/source/alt/dimensions, and causal-gap recovery preserves the exact visible target through an atomic IndexedDB queue regeneration.
- The final `node scripts/run_all_tests.mjs` gate passed with exit code 0 after owner-contract reconciliation. The implementation Definition of Done is complete; database migration, deployment, monitoring, and rollback control remain human-owned production rollout actions.

## Final Invariant

Every approved live change must follow one coherent rule:

> Commit canonical state once, record publication durably in the same transaction, distribute through one shared cross-instance realtime spine, deliver only to exact authorized connections, recover through canonical reads, and never sacrifice a user's unacknowledged work.
