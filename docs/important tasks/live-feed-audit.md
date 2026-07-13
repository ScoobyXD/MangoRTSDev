# Live Feed And Realtime Fan-Out Audit And One-Shot Removal Charter

Last updated: 2026-07-13

Status: implemented and complete on 2026-07-12. The body below is retained as the pre-implementation audit, deletion rationale, and acceptance history; it no longer describes the current runtime. The current architecture contract is `docs/v4-architecture-doc.md`.

## Implementation Completion Record

The one-shot simplification is implemented on `codex/019f5860-1682-7782-92ae-081660f3b51d-implement-complete0000544`.

Final product realtime scopes:

- `notifications:user:{user_id}` is owned once at app lifetime by `NotificationRealtimeBridge`; first subscription acceptance, reconnect acceptance, and notification hints share one canonical summary coalescer, plus bounded Updates reconciliation only while Updates is open.
- `chat:node:{node_id}` publishes compact durable Node-chat create/delete hints while that Node chat is mounted and performs one coalesced canonical refresh on first acceptance and reconnect. Project chat is non-live.
- `board:{board_id}` publishes compact `kanban.changed` hints for committed card/column-visible changes while that Logic Gate board is mounted; first acceptance, reconnect, and hints coalesce canonical `/work` reloads.

Deleted systems:

- browser workspace/Explorer/graph/GVIC/My Work/Project Management/communications/permission/generic-editor scopes, replay, effective-user expansion, PostgreSQL workspace listener/notifications, broad authorization, and global freshness rebroadcasts;
- transient whole-document collaboration endpoint/client/presence UI and generic editor projection delivery;
- communications/mail WebSocket publication and subscriptions;
- notification checkpoint initialization, company scan, catch-up, and `ReplayDomainEvents` recovery;
- `event_rows`, every producer/type/repository implementation, event worker, lease/retry/affected-scope/sequence machinery, projection delta hubs/clients, and obsolete tests;
- `company_projection_sequences`, dead `domain_events.published_timestamp`/pending index, and notification checkpoint storage.

Retained foundations:

- the shared frontend socket and backend ticket/frame/registry/subscribe/unsubscribe/ping/pong/reconnect/error core;
- immediate notification projection and durable notification rows;
- canonical HTTP mutation/read APIs, projection/read tables, `workspace_read_versions`, workspace-derived processing, and independently required `domain_events` consumers;
- direct process-local publisher boundary for the three explicit scopes.

Repository schema change: `backend/db/migrations/20260712_realtime_simplification.sql` drops `event_rows`, `notification_domain_event_projection_checkpoints`, `company_projection_sequences`, `idx_domain_events_pending`, and `domain_events.published_timestamp`, plus the obsolete projection-sequence trigger function. Canonical `backend/db/schema.sql` no longer creates them. No dev/prod database or cloud resource was mutated by this task.

Verification recorded at completion:

- focused frontend build and full frontend node suite passed;
- focused backend realtime, store, notification, and schema/source-guard tests passed;
- `node scripts/run_all_tests.mjs` passed before worker commit and again through the repository merge helper on local `main`.

Follow-up hardening completed on 2026-07-13:

- every successful Node or Logic Gate rename entry point publishes the concrete same-window committed-title event so mounted Explorer, Kanban, Editor, Node/Logic Gate Maps, Home/My Work, Updates current Node/Logic Gate row, selected-panel, and open-action labels, AppLayout dock/popup/sidebar-pin labels, AppTimeline labels, and Project Management caches converge without a cross-user fan-out plane; Logic Gate titles also update Updates saved Logic Gate grouping headers and sort values, while notification prose remains historical and active title drafts/carets and passive dock/pin metadata are preserved;
- backend WebSocket writes have a bounded deadline, failed connections are removed and closed, and metrics distinguish delivery failures from no-subscriber publishes; and
- ordinary `node_updated` processing skips Kanban projection lookup when there are no relevant local board subscribers.

Follow-up focused automated evidence:

Frontend evidence combines direct behavior tests of `createCoalescedCanonicalRefresh` (one active request, one queued final request, and disposal) and `createCommittedTitleEditBuffer` (same-entity deferral/latest flush, unrelated-entity passthrough, and reset cancellation), shared socket/coordinator/local-event helper tests, the exact-three-subscription-owner inventory, and one AppLayout cache-coordinator installation guard. It is not a mounted React request-cardinality or dirty-`contentEditable`/caret integration suite. Backend evidence exercises the server, authorization, registry, routing, deadline, and lookup-guard paths.

- shared-client first/reconnect/late-handler acceptance behavior plus single-flight/queued-final helpers and a source inventory proving only the notification bridge, mounted Node chat, and mounted Kanban own product subscriptions;
- coordinator-level local notification HTTP delete/clear plus matching socket-echo cardinality, including socket-first response-loss ordering whose canonical source requires a mounted feed reconciliation;
- same-window local-event/edit-buffer/reducer behavior and direct publication-time communications/Kanban/graph cache tests, plus the AppLayout coordinator-installation and Editor blur-suppression wiring guards;
- unauthenticated and token-query handshake rejection, cross-Server signed tickets, per-family authorization denial/not-stored behavior, and normal-close cleanup;
- notification create/delete/clear routing, bounded failed/stalled delivery with a healthy co-subscriber, and distinct failure/no-subscriber metrics; and
- the no-local-board-subscriber Kanban projection lookup guard plus mounted-board correctness.

Same-window title convergence also uses one company/type/resource registry with a monotonic version. The implemented Home, Company Explorer/GVIC/search, Editor entity-detail, NodeWorkspace assigned Logic Gate/options/search, Kanban, Node/Logic Gate Map graph/detail, My Work, and Project Management async title-bearing paths capture the version at request start and overlay only newer commits before storing a response. The app-lifetime committed-title cache reconciliation coordinator synchronously patches or invalidates affected communications, project-relationship, Kanban, My Work matrix, record-store, workspace-snapshot, and graph caches. Request-start version folding and targeted cache generation/invalidation guards prevent pre-commit requests from repopulating older titles. Cache hits and remounts therefore retain the committed label, while a genuine request begun after the commit remains authoritative. Denormalized persisted sidebar-pin responses instead overlay all latest local commits after fetch/create/reorder/rollback so stale pin-row names cannot overwrite the current visible label. This is targeted fencing of the enumerated caches/setters, not a generalized client replication layer or a claim about unrelated async state.

Genuine remaining limitations are deliberate: realtime delivery is process-local while the committed dev and prod Terraform roots both default to two backend tasks and the target groups configure no stickiness. A mutation HTTP request and the recipient's WebSocket may therefore land on different tasks, making cross-user live delivery nondeterministic whenever two tasks run. A broker/stickiness change and backend task-count changes are deferred. `domain_events` retention/archive cleanup is deferred, and the workspace-derived 200-company catch-up limit is unchanged. Exact multi-user document coediting remains a separate future Huddle/CRDT/OT project. No replay, gap, generalized event-history, or notification-recovery plane is added. Non-live cross-user surfaces may remain stale until navigation, open, reload, or explicit refresh.

Original audit branch: codex/live-feed-audit

Original audit worktree: C:\tmp\MangoRTSDev-workers\MangoRTSDev-live-feed-audit

Original audit base: 5747e73f7fbb4c8795870c8be9f014b1ba7ca5fe. The one-shot charter was reconciled against local main through 66fd76c76a17d397326bdafa0aa59f5154957ac0; recheck current main before editing because source lines may move.

## Executive Decision

The simplification is approved. This is no longer a proposal.

The current app treats too many ordinary CRUD changes as cross-user live replication problems. It records and distributes workspace domain events, projection delta event rows, permission events, notification events, communications events, and editor collaboration messages through overlapping paths. The result is a large amount of code, database work, cache invalidation, replay logic, permission fan-out, and failure recovery for behavior that the product does not need on most screens.

The currently approved live experiences reduce to three narrow cross-user backend lanes:

1. User notifications and the Updates feed can share one user-targeted notification lane.
2. Node chat can use one resource-targeted lane while the relevant node is open.
3. A mounted Logic Gate Kanban board can use one board-targeted lane for committed node-card changes.

Immediate consistency for the user who made a change is not a fourth cross-user realtime lane. It should be implemented from the successful HTTP mutation response, optimistic/local state, shared client caches, and a same-browser mutation signal.

Exact document coediting should not be counted as an existing keep-surface. The current code does not provide safe exact coediting. It relays whole documents without OT, CRDT, a shared revision, cursor state, or conflict resolution. The near-term decision is to remove that pseudo-collaboration path and retain durable autosave. A future opt-in feature called a Huddle may deliberately provide shared editing with CRDT/OT, but Huddle is a separate future product project and is not part of this realtime-deletion effort.

### Approved product contract

| Experience | Cross-user live? | Freshness rule |
| --- | --- | --- |
| Notification badges | Yes | User-targeted and app-lifetime |
| Updates feed and its three unread badges | Yes | Consume the same user notification lane; `!` urgent mentions, `@` normal mentions, and regular non-mention updates change immediately; no second socket |
| Node chat while the node/chat is open | Yes | Preserve current node-chat authorization and durable storage behavior; Project chat is excluded |
| Mounted Logic Gate Kanban board | Yes | Board-targeted committed node-card title, add/remove, move/reorder, column, and other explicitly card-visible changes |
| Node or Logic Gate document typing | No | Durable HTTP autosave; reopen/reload for another user; delete current collaboration relay |
| The initiating user's own title/card/tree changes | Immediate locally | Patch from the mutation response; never bounce through the server fan-out |
| Kanban changes made by another user | Yes only on the relevant mounted Logic Gate board | Receive a compact committed board-change hint; first subscription acceptance, reconnect acceptance, and hints share the guarded canonical board loader |
| Company Explorer changes made by another user | No | Reload on navigation/manual refresh if needed; temporary staleness during development is accepted |
| Node/Logic Gate maps and relationships | No | Reload on navigation/manual refresh if needed; no cross-user subscription |
| My Work/GVIC/Project Management | No | Load when opened and patch only concrete same-user command results |
| Mailbox/communications list changes | No | Existing HTTP loads/manual refresh are sufficient; delete live mail delivery |
| Permission revocation | No dedicated live requirement | HTTP authorization remains authoritative; already-rendered data may clear on the next navigation/reload |

### Recorded product decisions from 2026-07-12

1. A future Huddle is the candidate home for intentional simultaneous document editing. Huddle may use CRDT/OT, explicit session membership, presence, cursor state, and a collaboration-specific persistence model. Do not build it in this cleanup and do not preserve the current whole-document relay for it.
2. Cross-user live delivery is retained only for node chat, the user notification/Updates lane, and the currently mounted Logic Gate Kanban board.
3. The Updates sidebar badges for urgent `!` mentions, normal `@` mentions, and regular non-mention updates must change immediately from the one notification summary source. This restates the stable U69 contract in `docs/tests/updates.md`.
4. Node-card title and placement changes on a Logic Gate Kanban board should be visible to other users who currently have that same board open. This does not justify company-wide workspace fan-out or background subscriptions for every board.
5. The notification domain-event catch-up/checkpoint worker is not a product requirement. Delete checkpoint initialization, the 30-second scan, ReplayDomainEvents notification recovery, repository plumbing used only by that recovery, and their tests in this task. Preserve the existing immediate notification projection and durable notification rows. Missed asynchronous recovery is an accepted single-user development limitation; do not build a replacement recovery system.
6. The initiating user's successful mutation must still update every relevant surface in that app session immediately from the committed response. Other users do not receive generic title/tree/map/Explorer live replication unless the change is part of the retained active Kanban contract.

## One-Shot Execution Mandate

This repository currently has one active user and is in pure development. Optimize for deletion speed, smaller code, and a clear future realtime foundation—not for zero-downtime migration, compatibility periods, feature flags, observation windows, or preserving cross-user freshness on surfaces that are explicitly non-live.

The complete scope in this document must be implemented in one worker task, one coherent final diff, and one completion flow into main. Internal edit order is allowed; separate batches, later cleanup PRs, or stopping after only frontend/backend halves are not. Do not pause to ask whether the approved deletions are safe. Static source proof, compilation, focused behavior tests for the three retained surfaces, the full repository gate, and final diff inspection are sufficient.

Temporary development behavior that is explicitly acceptable:

- another user's Company Explorer, map, My Work, Project Management, mail, or title surface can remain stale until navigation, reload, or explicit refresh;
- a missed immediate notification projection will not be recovered by a later domain-event scan;
- retained realtime may remain process-local in the current single-user development configuration if adding a compact cross-instance broker would materially expand the task;
- permission revocation does not need a generic live fan-out message; HTTP/API authorization remains mandatory;
- do not build a generalized local mutation bus or global focus-refresh framework before deleting broad streams. Patch only concrete same-user regressions exposed by the cleanup.

Required end state:

1. Only one notification scope, one node-chat scope, and one mounted Logic Gate Kanban scope remain as product realtime surfaces.
2. Generic workspace, Company Explorer, graph, GVIC/My Work, Project Management, communications, permission, and document-collaboration live delivery is gone.
3. event_rows and its worker/lease/sequence/retry infrastructure are gone after retained chat and Kanban no longer depend on them.
4. The reusable socket/ticket/registry/subscription core remains small and can accept future explicit scope types.
5. Huddle/CRDT/OT is recorded only as future work; no current collaboration compatibility code survives for it.

## Important Distinction: Events Are Not One Thing

Do not delete every table or function containing the word event.

Mango currently uses event-shaped records for at least four different jobs:

1. Durable domain facts used by notification projection and deferred workspace projection.
2. UI replication deltas used only to push projection changes to browsers.
3. Transient websocket messages used for notifications, communications, and editor collaboration.
4. Read-version changes used to produce ETags and cheap conditional reads.

The cross-user transport can be removed without immediately removing all durable domain events. In particular:

- domain_events currently feeds notification projection and workspace-derived projection catch-up.
- workspace_read_versions is updated from workspace domain events and is useful for cheap activation/focus revalidation.
- notification rows and the existing immediate request-path projector are product behavior; notification checkpoints and catch-up are approved for immediate deletion without a replacement recovery system.
- event_rows is primarily a durable UI-replication queue and is the strongest deletion candidate after retained chat and active-Kanban delivery have replacements.

The desired architecture is not “no events.” It is “no generic app-wide live replication.”

## Current Architecture Map

~~~text
HTTP command
  |
  +-- source tables and projection tables are written
  |
  +-- workspace domain_events may be appended
  |     |
  |     +-- notification projector/catch-up
  |     +-- workspace-derived projector/catch-up
  |     +-- workspace read-version/ETag updates
  |     +-- broad workspace websocket fan-out
  |           |
  |           +-- workspace:user
  |           +-- company_explorer:user
  |           +-- node_graph:user
  |           +-- logic_gate_graph:user
  |
  +-- projection event_rows may be appended
        |
        +-- 500 ms database worker claim
        +-- in-process projection websocket publish
              |
              +-- board
              +-- gvic_matrix
              +-- project_management
              +-- project relationships
              +-- editor node/Logic Gate/project

Separate direct in-process websocket publishes:
  - notifications:user
  - communications:user
  - transient editor collaboration
~~~

The frontend then adds another fan-out layer:

~~~text
one physical websocket per API/company
  |
  +-- many server scopes
  |
  +-- AppLiveFreshnessBridge invalidates global caches
  +-- mounted feature subscribes and invalidates again
  +-- feature-specific projection subscriber may patch and/or refetch
  +-- browser CustomEvent bridges trigger more cache invalidation/refetch
~~~

## Current Backend Lanes

| Lane | Durable source | Delivery | Current purpose | Target |
| --- | --- | --- | --- | --- |
| Workspace domain events | domain_events | In-process registry plus PostgreSQL LISTEN/NOTIFY | Generic entity, graph, Explorer, Kanban, My Work, Updates invalidation | Remove browser delivery; retain only durable consumers that are separately justified |
| Projection deltas | event_rows | A polling worker claims a row and publishes to its own process | Kanban, GVIC, Project Management, relationships, editor projection replication | Replace Kanban and chat with dedicated compact lanes; delete all other projection lanes and the generic queue |
| Notifications | communications_notifications | Direct in-process notifications:user publish plus domain-event catch-up | Badges and Updates freshness | Keep direct durable notification state/live hint; delete generic catch-up/checkpoint recovery and centralize frontend consumption |
| Communications | Provider webhook plus cache state | Direct in-process communications:user publish | Live mailbox/folder/list refresh | Remove from websocket under the stated policy |
| Editor collaboration | Transient HTTP POST | Direct in-process editor scope publish | Whole-document opportunistic relay | Remove; it is not safe coediting |
| Permission changed | event_rows | Event worker revalidates many live scopes | Revoke/refetch broad subscriptions | Delete generic live permission delivery; HTTP authorization remains authoritative |

## Current Frontend Subscription Inventory

The client shares one physical WebSocket for each API base/company, but it registers many logical subscriptions and many handlers.

| Surface/module | Current scope | Current reaction | Classification |
| --- | --- | --- | --- |
| AppLiveFreshnessBridge | workspace:user:{user} | Invalidates workspace, Explorer, graph, Kanban, and communications panel caches | Remove |
| AppLiveFreshnessBridge | notifications:user:{user} | Emits a browser-global notification event | Keep only inside one notification coordinator |
| AppLiveFreshnessBridge | communications:user:{user} | Invalidates mail and folder caches | Remove under current product decision |
| AppLiveFreshnessBridge | connection retain with no scope | Keeps socket open | Remove; retained subscriptions can open it |
| useNotificationSummary | notifications:user:{user} | Refetches summary | Merge into coordinator |
| HomePage | workspace:user:{user} | Patches local workspace collections and triggers My Work, Updates, panel, and GVIC reloads | Remove |
| HomePage | communications:user:{user} | Refetches or patches mail/folder state | Remove |
| HomePage | gvic_matrix:user:{target} | Applies/refetches matrix | Remove |
| UpdatesView | browser EVENT_NOTIFICATIONS_UPDATED | Refetches roots and loaded branches | Keep as a mounted consumer of notification coordinator, then make reconciliation bounded |
| MyWorkView | one gvic_matrix:user scope per target user | Reloads matrix on delta/error/refetch | Remove |
| KanbanContent | board:{board} | Applies projection deltas or refetches | Keep the active-board product behavior, but replace event_rows with direct compact board-changed publication |
| KanbanContent | workspace:user:{user} | Applies board/list/title updates and invalidates caches | Remove duplicate broad lane after the board-specific contract covers card-visible changes |
| CompanyExplorerContent | company_explorer:user:{user} | Applies workspace envelopes and refreshes branches | Remove |
| NodeRelationshipGraph | node_graph:user:{user} | Applies deltas or refreshes graph snapshots | Remove |
| LogicGateRelationshipGraph | logic_gate_graph:user:{user} | Applies deltas or refreshes graph snapshots | Remove |
| LogicGateArenaPage | workspace:user:{user} | Updates a Logic Gate title | Replace with local mutation propagation and activation refresh |
| ProjectManagementContent | company_explorer:user:{user} | Reloads workspace/project list | Remove |
| ProjectManagementContent | project_management:user:{target} | Reloads timeline | Remove |
| EditorContent | editor:node/logic_gate:{id} via workspace wrapper | Receives transient whole-document messages | Remove pseudo-collaboration |
| EditorContent | editor:node/logic_gate:{id} projection subscriber | Applies all editor projection changes, including chat | Replace with chat-specific scope; remove broad document projection replication |

Primary frontend evidence:

- frontend/src/modules/realtime/realtimeWebSocket.ts:9-23, 443-713
- frontend/src/modules/workspace/workspaceRealtime.ts:15-137, 260-388, 407-549
- frontend/src/app/AppLiveFreshnessBridge.tsx:47-128, 181-277
- frontend/src/pages/home/HomePage.tsx:2250-2401, 2402-2547, 4162-4178
- frontend/src/pages/home/MyWorkView.tsx:448-469
- frontend/src/pages/home/UpdatesView.tsx:291-359
- frontend/src/modules/kanban/KanbanContent.tsx:1536-1548, 1619-1806
- frontend/src/modules/company-explorer/CompanyExplorerContent.tsx:1648-1686
- frontend/src/modules/node-map/NodeRelationshipGraph.ts:479-590
- frontend/src/modules/logic-gate-map/LogicGateRelationshipGraph.ts:418-530
- frontend/src/modules/project-management/ProjectManagementContent.tsx:860-869, 956-981
- frontend/src/pages/logic-gate-arena/LogicGateArenaPage.tsx:254-261
- frontend/src/modules/editor/EditorContent.tsx:1958-1996, 2181-2297

Operationally important details:

- AppLiveFreshnessBridge is mounted at the app-layout level, so its workspace, notification, communications, and connection-retain behavior exists regardless of which feature is visible: frontend/src/app/applayout.tsx:1655 onward.
- Its communications handler can fetch each new message even when the mailbox UI is closed: frontend/src/app/AppLiveFreshnessBridge.tsx:297 onward.
- My Work can create one gvic_matrix subscription per target company user rather than one subscription for the visible actor: frontend/src/pages/home/MyWorkView.tsx:448-469.
- suppressLegacyWorkspaceStream is misleadingly named: it suppresses editor collaboration handling, not the general workspace stream. Do not use that option as a broad-realtime kill switch: frontend/src/modules/workspace/workspaceRealtime.ts.

## Critical Findings

### P0: Most retained-looking live lanes do not work reliably across backend tasks

The realtime registry is process-local. Notification, communications, editor projection, and transient collaboration publishers write only to the registry in the process handling the publish.

Both dev and prod Terraform default to two backend tasks:

- infra/aws-dev/variables.tf:189-192
- infra/aws-prod/variables.tf:177-180

The event_rows worker makes this worse. One task claims each row with FOR UPDATE SKIP LOCKED, marks it processed, and publishes only to that task's in-memory registry:

- backend/internal/store/postgres_event_rows.go:258-291
- backend/internal/http/event_worker.go:43-70, 188-218

If the intended recipient's WebSocket is attached to the other task, the committed delta is lost live. The row is still marked processed.

The same process-local limitation exists for:

- notifications: backend/internal/http/notification_handlers.go:400-512
- communications: backend/internal/http/communications_stream_handlers.go:415-469
- transient document relay: backend/internal/http/editor_collaboration_handlers.go:94-131

The broad workspace lane is the only lane with a PostgreSQL cross-instance wake-up. Ironically, it is the lane the product most wants to remove.

This multi-task flaw is real but does not block the approved single-user deletion. Retain a small publisher boundary so a future broker can replace process-local publication without reviving workspace fan-out.

### P0: The transient document publisher has an authorization hole

WebSocket subscription authorization checks company and effective entity edit access:

- backend/internal/http/realtime_ws.go:334-375

The POST publisher for collaboration validates only shape, entity-kind text, IDs, event type, and payload size:

- backend/internal/http/editor_collaboration_handlers.go:13-87

It does not check that the actor belongs to the supplied company or can access/edit the supplied node or Logic Gate. An authenticated caller who knows IDs can inject transient document updates into sessions belonging to authorized subscribers. The request also accepts caller-provided client ID, display name, revision, and up to 850 KB of HTML.

This is a security/correctness issue independent of the larger architecture decision. Delete the publisher, subscription, route, UI, and tests outright in this task; do not spend time repairing it.

### P0: Current “collaboration” is whole-document last-writer-wins, not exact coediting

The payload is full documentHTML plus a client ID and client timestamp revision:

- frontend/src/modules/editor/editorCollaboration.ts:8-23, 61-88

The client sends after 140 ms, defers a remote replacement until 900 ms of local idle, then replaces innerHTML and resets undo history:

- frontend/src/modules/editor/EditorContent.tsx:924-947, 974-1026

There is:

- no CRDT;
- no operational transform;
- no shared/base revision;
- no server ordering;
- no cursor or selection transport;
- no merge;
- no conflict UI;
- no durable reconciliation contract;
- no real presence heartbeat or leave publication.

Only document_update is actually published. The presence and leave types are defined but have no publisher call.

Node text boxes use separate per-block DOM and serialized whole-block durable saves. The transient document ref meaningfully applies to the non-node document surface, principally Logic Gate editor content, not exact Node text-box coediting.

Recommendation: delete this path and stop describing it as document collaboration. If built later, CRDT/OT belongs inside the separate opt-in Huddle feature, not inside every ordinary editor.

### P1: Filtered user streams use a company-global sequence, so ordinary filtering looks like packet loss

Workspace events use one company-wide domain-event sequence:

- backend/internal/http/realtime_ws.go:768-774

The server sends a user only events for which the user has effective access:

- backend/internal/http/realtime_ws.go:674-741

The frontend cursor assumes every sequence jump is a missing-event gap:

- frontend/src/modules/workspace/workspaceRealtime.ts:407-439

Therefore a user can receive sequence 10 after sequence 5 simply because events 6-9 were for other resources/users, yet the client treats the jump as lost delivery and triggers reconciliation/refetch. This is inherent in combining a filtered stream with a global contiguous cursor.

The same event is sent into four separate per-user scopes with separate client cursors, multiplying false gap and replay behavior.

### P1: Workspace fan-out performs O(users) database notifications that every listener discards

For every workspace event, the local publisher resolves all effective users:

- backend/internal/http/workspace_handlers.go:1058-1086

It then attempts the same event on four scopes for every effective user:

- backend/internal/http/workspace_handlers.go:1094-1141

The PostgreSQL fan-out resolves the effective users again and executes one pg_notify for the company event plus one pg_notify per user:

- backend/internal/store/postgres_workspace_event_fanout.go:22-46

Every server listener explicitly ignores every notification whose user_id is nonblank:

- backend/internal/http/workspace_fanout.go:82-85

Only the one company notification is useful. The per-user PostgreSQL calls are pure waste in current production code.

The origin task therefore performs effective-recipient expansion twice. Each other task that processes the useful company notification re-queries the domain event and expands recipients again. A one-second notification timeout bounds duration but can produce partial cross-instance fan-out under load.

This directly contradicts the historical design statement that no fan-out work should happen when nobody is subscribed:

- docs/important tasks/Old Stuff/syncing-layer-v1.md:64-89

Current code expands recipients before checking local subscribers.

### P1: event_rows makes normal writes depend on a permanent browser-replication queue

At this audit base, source search finds 49 PostgresRepo invocations of appendEventRowsTx: 46 in postgres_*.go files and three in accounts.go. They append projection event rows in the same transaction as source/projection writes. Representative examples:

- backend/internal/store/postgres_nodes.go:1104-1111
- backend/internal/store/postgres_kanban.go:552, 694, 757, 826
- backend/internal/store/postgres_logic_gates.go:232, 273, 761, 790
- backend/internal/store/postgres_projects.go:1043-1095
- backend/internal/store/postgres_project_management.go:447-550
- backend/internal/store/postgres_entity_permissions.go:660-666

Consequences:

1. Failure to create a live-delivery event row can roll back a valid product write.
2. The worker polls the database every 500 ms on every backend task.
3. Rows are created even if no browser is subscribed.
4. Processed rows are never deleted.
5. Payloads contain complete projection deltas. Editor rows can embed full document/chat projection content.
6. The event_rows table and its scope/sequence index grow forever.

Schema evidence:

- backend/db/schema.sql:2220-2263
- backend/internal/store/event_rows.go:115-134, 259-390

There is no production DELETE or retention job for event_rows.

### P1: Projection sequence/gap recovery does not make the process-local queue reliable

Non-editor projection sequences are allocated in the publisher only after the worker sees local subscribers:

- backend/internal/http/projection_deltas.go:226-230, 372-390

If task A claims a delta but the user's socket is on task B, task A may see no local target and allocate no projection sequence. The delta is marked processed. Task B has neither the delta nor a cursor gap proving it missed one.

This defeats the apparent reconnect/gap safety for Kanban, GVIC, Project Management, and Project relationships.

### P1: One mutation can trigger several independent frontend refresh paths

Kanban is the clearest example:

1. board projection.delta applies to local cards or triggers fallback;
2. AppLiveFreshnessBridge receives the workspace event, invalidates the board cache, and dispatches EVENT_KANBAN_BOARD_CONTENTS_UPDATED;
3. Kanban's browser-event listener invalidates again and can refresh;
4. Kanban's own workspace subscriber invalidates or patches again.

Evidence:

- frontend/src/modules/kanban/KanbanContent.tsx:1536-1548, 1619-1806
- frontend/src/app/AppLiveFreshnessBridge.tsx:233-269
- frontend/src/modules/kanban/KanbanBoardContentStore.ts:56-69

Invalidation deletes the single-flight entry. Duplicate signals can therefore make a later path start another GET rather than coalescing with the first.

The same general duplication exists between the global workspace bridge and Home, Company Explorer, graph, and feature-specific subscriptions.

### P1: Notification handling is correctly scoped on the wire but duplicated in the browser

The notification scope is appropriately user-only:

- backend/internal/http/realtime_ws.go:393-397
- backend/internal/http/notification_handlers.go:448-512

However:

- AppLiveFreshnessBridge subscribes and emits EVENT_NOTIFICATIONS_UPDATED.
- useNotificationSummary independently subscribes and directly queues a summary load.
- useNotificationSummary also listens to EVENT_NOTIFICATIONS_UPDATED.

Evidence:

- frontend/src/app/AppLiveFreshnessBridge.tsx:85-112, 174-179
- frontend/src/modules/notifications/useNotificationSummary.ts:79-108, 116-180

One notification commonly causes two sequential summary GETs: the first starts while the second sets reloadQueued.

Updates then ignores the full notification payload and reloads roots plus every loaded root branch:

- frontend/src/pages/home/UpdatesView.tsx:291-359

The keep-lane needs one coordinator, not several subscribers and a global DOM rebroadcast.

### P1: The event tables have no lifecycle

domain_events has a published_timestamp and a pending index:

- backend/db/schema.sql:2184-2218

MarkDomainEventPublished and ListPendingDomainEvents exist, but no production publisher calls MarkDomainEventPublished. The pending index can therefore retain every domain event indefinitely.

event_rows marks rows processed but has no cleanup.

Do not delete domain_events immediately because notification and workspace-derived checkpoints currently depend on it. The migration explicitly removes the notification dependency; retain the table afterward only for workspace-derived, read-version, or approved audit consumers, with an explicit retention/archival design.

### P2: Dead in-process buses remain as production structure

localWorkspaceEventBus has no production subscriber. Only tests subscribe to it:

- backend/internal/http/workspace_handlers.go:914-986
- backend/internal/http/server.go:198-207

projectionDeltaHub likewise has no production subscriber. Production browsers use realtimeRegistry; only tests use projectionHub.subscribe:

- backend/internal/http/projection_deltas.go:22-163

These structures make publishing code harder to understand and preserve tests for a transport that does not exist in production.

### P2: Some event rows can never reach a supported frontend scope

EditorRealtimeScope creates editor:project:{id} event rows:

- backend/internal/store/event_rows.go:374-389

The backend subscription parser/authorization supports only editor:node and editor:logic_gate:

- backend/internal/http/realtime_ws.go:454-471

Project editor event rows can therefore be stored, polled, processed, and published to a scope the server will not let a client subscribe to.

### P2: Some workspace events are explicitly ignored; unknown ones can invalidate the whole app

The frontend explicitly ignores editor_collaboration_event, node_information_created, and logic_gate_information_created for workspace reconciliation:

- frontend/src/modules/workspace/workspaceRealtime.ts:260-270

Yet node information creation still publishes node_information_created after the editor event row is created:

- backend/internal/http/node_handlers.go:655-678

That creates broad access expansion and four-scope delivery for a workspace message whose reconciliation layer intentionally does nothing.

Conversely, unrecognized events fall back to kind workspace:

- frontend/src/modules/workspace/workspaceRealtime.ts:387-395

AppLiveFreshnessBridge treats kind workspace as “invalidate everything”:

- frontend/src/app/AppLiveFreshnessBridge.tsx:258-277

Editor saved-version events and other compatibility events can therefore cause broad cache invalidation despite not changing most visible surfaces.

### P2: Realtime publishing has weak backpressure

Workspace event publication launches fire-and-forget goroutines:

- backend/internal/http/workspace_handlers.go:1018-1047

The registry writes synchronously to every matched net.Conn:

- backend/internal/http/realtime_registry.go:183-197
- backend/internal/http/realtime_ws.go:786-821

There is no per-connection outbound queue, write deadline, or slow-consumer eviction in this path. A slow socket can hold a publisher goroutine. Removing the broad lanes reduces the risk; the retained narrow implementation should still use bounded queues/deadlines.

### P1: Workspace publication is asynchronous, unordered, and lossy

Committed workspace-event batches are handed to fire-and-forget goroutines:

- backend/internal/http/workspace_handlers.go:1018-1047

Independent requests can therefore publish adjacent company sequences out of order. The PostgreSQL wake-up is not transactional with the source write; a post-commit publication failure is logged and discarded. The LISTEN loop reconnects after failure, but PostgreSQL does not replay notifications missed during the disconnect:

- backend/internal/http/workspace_fanout.go:61-79, 108-116

The WebSocket replay endpoint can return at most 100 events before forcing snapshot reconciliation:

- backend/internal/http/realtime_ws.go:24-28, 674-723

This does not make the system durable. It turns a normal write into several best-effort wake-ups followed by potentially broad fallback GETs.

### P1: Several workspace events cannot be mapped to their authorized recipients

Effective-recipient extraction understands a fixed set of scalar payload fields such as logic_gate_id, project_id, board_id, item type/ID, folder ID, and node IDs:

- backend/internal/store/workspace_effective_fanout.go:15-103

Confirmed producers that do not provide usable access targets include:

- node_map_positions_updated and logic_gate_map_positions_updated, whose payloads contain a positions array rather than a scalar resource target: backend/internal/http/map_layout_handlers.go:229, 255;
- company_explorer_item_removed, whose payload contains item_id but not item_type: backend/internal/http/company_explorer_handlers.go:585;
- relationship_deleted, whose payload contains only relationship_id: backend/internal/store/node_graph_workspace_events.go:113-115;
- logic_gate_relationship_deleted, whose payload contains only logic_gate_relationship_id: backend/internal/http/logic_gate_relationship_handlers.go:159.

Deletion events have an additional trap: even when the payload contains the deleted entity ID, recipient access is resolved after the row has been deleted. Ordinary viewers can disappear from the effective-recipient set; company admins are the main exception. See the entity-access SQL in backend/db/schema.sql:2850-2885, 3046-3061.

The generic live architecture is therefore expensive without being complete: it can perform all of the fan-out machinery and still omit the users who needed the invalidation.

### P1: Notification catch-up is expensive recovery machinery the product has decided to delete

Immediate notification projection runs asynchronously after the request and does not advance the durable notification projector checkpoint:

- backend/internal/http/notification_handlers.go:367-398

The 30-second catch-up job later sees those successful events again and depends on notification uniqueness to absorb duplicates. Each backend task runs the job, processes only one batch of at most 100 domain events per company per interval, and does not loop until caught up:

- backend/internal/http/notification_projection.go:10-11, 55-70

It also calls ListCompanies with CompanyListMaxLimit. That constant is 200, and the query returns the first 200 companies alphabetically with no pagination:

- backend/internal/store/repository.go:1830-1840
- backend/internal/store/postgres_auth.go:235-249

Companies after that page receive no notification catch-up from this worker. The workspace-derived projector uses the same first-page pattern:

- backend/internal/http/workspace_derived_projection.go:30-60, 86-103

The decision is not to repair or paginate notification catch-up. Delete it now:

1. Preserve the existing immediate request-path notification projector and durable notification rows.
2. Remove its calls to runNotificationDomainEventCatchupOnce; log best-effort immediate projection failures without recovery.
3. Delete notification projection checkpoints, initialization, the 30-second company scan, ReplayDomainEvents usage for notifications, repository/storage/schema used only by that recovery, and their tests.
4. Keep ordinary canonical summary/feed loads on app mount or opening Updates. Do not create another recovery queue or make direct transactional notification rewrites a prerequisite for this cleanup.

Do not replace this worker with another generic replay queue. Chat and Kanban use their own narrow canonical-state reconciliation contracts, and workspace-derived processing must be judged separately from notifications.

### P2: The domain-event sequence is a company-wide write serialization point

Every workspace domain-event append takes an advisory transaction lock for the company stream and calculates max(sequence) + 1:

- backend/internal/store/postgres_domain_events.go:134-173

That makes unrelated mutations in the same company contend on one event-log sequence even when the UI does not need ordering between them. Direct notification rows, compact chat/Kanban wake-ups, and approved audit facts do not require one broad browser-replication sequence. When the consumers are separated, retain sequencing only where the remaining workspace-derived or audit contract actually requires it.

### P2: Ticket authorization is a connection-time snapshot

The signed realtime ticket embeds an actor/membership snapshot and the WebSocket authorizes scopes against it:

- backend/internal/http/realtime_ticket.go:104-160
- backend/internal/http/realtime_ws.go:334-423

Long-lived connections are not periodically reauthenticated. Signed tickets are also reusable during their 30-second lifetime because validation does not consume them, unlike the in-memory fallback:

- backend/internal/http/realtime_ticket.go:66-94, 124-160

Server-side HTTP authorization remains authoritative. Stronger mid-connection membership/session revocation is future hardening, not a blocker for this single-user cleanup.

### P2: More realtime fields and routes are dead or unreachable

Additional high-confidence cleanup candidates found in the static call graph:

- event_rows.affected_scopes is stored and decoded, but event_worker does not read it: backend/internal/store/event_rows.go:27-58, 306-370; backend/internal/http/event_worker.go:43-70.
- gvic.projection_delta produces gvic:user:{id}, but authorizeRealtimeSubscription has no gvic:user branch: backend/internal/store/event_rows.go:519-568; backend/internal/http/realtime_ws.go:334-423.
- The durable editor_collaboration_event workspace-routing branch has no production domain-event producer. The actual collaboration endpoint publishes transiently: backend/internal/http/workspace_handlers.go:1139-1150; backend/internal/http/editor_collaboration_handlers.go:94-131.
- requestPathProjectionDeltas filters out every currently defined projection event type, so request-path projection publisher calls are behaviorally dead: backend/internal/http/projection_deltas.go:180-192.
- domain_events.published_timestamp, its pending index, ListPendingDomainEvents, and MarkDomainEventPublished have no production publisher/marker caller: backend/db/schema.sql:2185-2218; backend/internal/store/postgres_domain_events.go.

Static call-graph evidence plus compilation and focused tests is sufficient. Delete these unreachable fields/routes/buses in this task; do not preserve them for hypothetical external integrations.

### P2: Go and SQL disagree about read-version handling for internal derived events

The Go classifier returns no read-version keys for workspace-derived projection request events before adding the full workspace snapshot key:

- backend/internal/store/workspace_read_versions.go:194-201

The SQL trigger function unconditionally emits workspace-snapshot:full before its event-specific logic:

- backend/db/schema.sql:2335-2344

This classification drift means tests or memory-mode behavior can disagree with Postgres about which ETags advance. It does not block deleting realtime. Fix parity only if a remaining read-version test or touched canonical HTTP path requires it.

## Detailed Keep-Surface Findings

### 1. Node chat

Chat is a separate product surface from document editing. It uses messages of type Text block chat linked to a text box by block_id:

- frontend/src/modules/editor/editorProjection.ts:9-10, 27-41, 99-146
- docs/tests/editor.md:32, 45, 153-169, 270

The sender gets optimistic local display, then POSTs a durable node information row:

- frontend/src/modules/editor/NodeWorkspaceSurface.tsx:1443-1526

Other open editors currently learn about the committed row through the broad editor:node:{node} projection scope:

- frontend/src/modules/editor/EditorContent.tsx:2181-2218, 2255-2297
- frontend/src/modules/editor/NodeWorkspaceSurface.tsx:907-934

That scope currently requires effective Edit permission on the backend, although EditorContent attempts the subscription after loading the editor without gating it on linkedEntityCanEdit. A view-only user can therefore be rejected, clear editorSnapshotLoadedScope, refetch, become loaded, and attempt the same subscription again:

- backend/internal/http/realtime_ws.go:359-374
- frontend/src/modules/editor/EditorContent.tsx:2255-2297

Preserve the current Node-chat access behavior during cleanup; do not expand the product. Sending/deleting remains HTTP-authorized.

One chat submission currently can produce:

- node information/history data;
- node projection data;
- an editor projection event_row with the message row;
- a node_information_created workspace domain event;
- mention domain events;
- a node-comment notification domain event;
- notification rows and user notification websocket messages.

The sender also pays redundant reconciliation cost. A node text-block save occurs after a 550 ms debounce; its successful mutation invokes onProjectionMutation, which fetches the full editor snapshot (projections, content changes, and sequence). The resulting editor projection delta can then request content changes again:

- frontend/src/modules/editor/editorTypes.ts:23
- frontend/src/modules/editor/NodeWorkspaceSurface.tsx:1059-1115
- frontend/src/modules/editor/EditorContent.tsx:2015-2053, 2181-2218, 2731-2740

Chat submission similarly performs optimistic append, POST, then full snapshot refresh: frontend/src/modules/editor/NodeWorkspaceSurface.tsx:1443-1526. The retained chat path should reconcile the returned message directly and reserve snapshot fetches for error/gap recovery.

Recommended replacement:

1. Keep the existing durable chat storage as the final canonical storage for this cleanup; do not introduce a chat table migration.
2. Emit one compact committed chat event containing company_id, node_id, block_id, message_id, and operation.
3. Publish to chat:node:{node_id} only if a local connection is actively subscribed.
4. Publish through the retained process-local registry/publisher boundary; a cross-instance broker is future scaling.
5. Authorize subscription with effective view access if view-only users should see chat. Keep send/delete commands edit-gated.
6. Reload canonical durable chat state on reconnect/open if needed; do not build a generic replay system.
7. Do not emit board, workspace, Explorer, or graph messages for chat.
8. Keep notification creation as a separate user-targeted outcome.

Storage remains in the current projection tables for this cleanup. There is no chat-table follow-up in this task.

Project text-box chat is excluded from retained realtime.

Do not confuse node text-block chat with Node Map inline comments. Node Map comments are browser-local localStorage data with no backend API or realtime path:

- frontend/src/modules/node-map/NodeMapContent.tsx:71-109, 238 onward
- frontend/src/modules/node-map/nodeInlineComments.ts:35 onward

### 2. Notification badges and Updates

These are two UI consumers of one backend fact, not two independent realtime architectures.

Recommended replacement:

- one app-lifetime notification coordinator owns notifications:user:{user_id};
- the three sidebar badges consume its one summary: urgent `!` mention count, normal `@` mention count, and regular non-mention unread count;
- Updates registers with it only while Updates is mounted/active;
- notification created/deleted/cleared messages update or invalidate that coordinator once and immediately change all affected badges;
- reconnect performs one canonical summary load and one feed load only if Updates is open; this is not domain-event catch-up or replay;
- no workspace:user event is needed for Updates;
- local Seen keeps its current optimistic no-reload path.

Current Updates behavior refetches roots and each expanded/loaded root branch for every external notification change. Keep the simpler contract: one coalesced canonical Updates refresh while Updates is open. Do not design an incremental Updates protocol in this cleanup.

Do not add an updates:user WebSocket in addition to notifications:user.

Notification correctness comes from durable notification rows created by the retained immediate projector, not from later rescanning a company-wide domain-event log. The WebSocket is only the immediate UI wake-up. Canonical summary/feed loads remain available without a background notification projector.

Relevant business rules:

- docs/tests/updates.md:11-35, 69-81
- docs/tests/updates.md:212-235, 328-367

Rules U23/U24 currently say realtime changes trigger feed refetch. If incremental application replaces refetching, update those rules deliberately while retaining U66 and U71 local Seen behavior.

### 3. Logic Gate Kanban board

This is now an approved retained cross-user live surface, but only while the specific board is mounted.

Required contract:

- one existing board:{board_id} scope per mounted Logic Gate Kanban board;
- authorize against current effective access to that Logic Gate;
- publish only committed changes that affect the visible board: node-card title, add/remove, move/reorder, column creation/update/delete, and any other field explicitly rendered on a card;
- the initiating user applies the mutation response immediately and deduplicates the server echo;
- other users with that same board open apply a compact canonical delta;
- users without that board open receive nothing;
- the retained process-local publisher sends only to matching local subscribers; a future broker can add cross-instance routing behind the same scope contract;
- board open/reconnect/gap performs one canonical board snapshot request; do not build a permanent generic event replay log;
- no workspace:user, Company Explorer, graph, GVIC, Project Management, or mail invalidation is emitted merely because the board changed.

The current board projection path is not safe to keep unchanged. event_rows can be claimed by a backend task with no matching local socket, and the existing workspace/AppLiveFreshnessBridge paths duplicate or defeat incremental application. Preserve the product behavior while replacing the transport.

Minimum live board cases:

1. A node is renamed and every viewer of each relevant mounted Logic Gate board sees the card title change.
2. A node card is added, removed, moved between columns, or reordered and viewers of that mounted board see the committed placement.
3. A column is created, renamed, reordered, or deleted and viewers see the committed board structure.
4. A card-visible status, priority, due date, issue flag, or similar field is included only if the board actually renders it and the payload remains compact.

### 4. Document coediting and future Huddle

Recommended near-term state:

- durable HTTP autosave remains;
- no cross-user per-keystroke/whole-document relay;
- another user's committed changes appear on reopen, activation, focus revalidation, or manual refresh;
- optimistic concurrency/version conflict handling belongs to future Huddle/document work and is not part of this cleanup.

If exact coediting is later required, define Huddle as a separate opt-in collaboration project with:

- block-scoped document identity;
- CRDT or OT operations;
- a server/broker ordering model;
- presence heartbeat and explicit leave/expiry;
- cursor/selection awareness;
- permission changes and revocation;
- reconnect and offline reconciliation;
- durable snapshot/operation compaction;
- conflict and save-failure UI;
- multi-backend integration tests.

Huddle should have an explicit session/room boundary and active participants rather than silently turning every editor into a collaboration session. CRDT/OT operations belong inside that Huddle boundary. Do not reuse the current full-document transient relay as its foundation, and do not delay deletion of that relay merely because Huddle may exist later.

## Same-User Immediate Consistency

The initiating user should see a successful change everywhere relevant in their current app session without waiting for server fan-out.

Required client rule:

~~~text
HTTP mutation succeeds
  -> normalize the committed response
  -> patch/invalidate the canonical client cache
  -> notify mounted local surfaces in the same browser
  -> render immediately
~~~

This is already partially present:

- Editor title updates use the committed node/Logic Gate response and patch graph record stores: frontend/src/modules/editor/EditorContent.tsx:1330-1358.
- Company Explorer rename patches its own store and graph cache from the committed response: frontend/src/modules/company-explorer/CompanyExplorerContent.tsx:2876-2920.
- My Work applies returned projection rows to local matrix state/cache: frontend/src/pages/home/MyWorkView.tsx:471-484.
- Kanban API commands invalidate/patch local Kanban and workspace caches: frontend/src/modules/kanban/kanbanApi.ts.

Some cross-surface title/list state still depends on a server workspace echo. Delete the broad stream anyway and patch only concrete same-user regressions encountered in focused tests for:

- node create/update/delete;
- Logic Gate create/update/delete;
- project create/update/delete;
- board/list metadata;
- Kanban cards/columns;
- Explorer placement/folders;
- relationships/map positions;
- assignments/GVIC;
- permissions;
- local mail actions.

Do not create a generalized local mutation coordinator as a prerequisite. Existing committed-response patches and local command-result events are the preferred minimal fix.

Verified rename gaps that the one-shot implementation should patch directly if their focused tests regress:

- A Logic Gate rename in Company Explorer updates that reducer and the Logic Gate graph, but the mounted Kanban title currently depends on the broad workspace echo: frontend/src/modules/company-explorer/CompanyExplorerContent.tsx:2876-2920; frontend/src/modules/kanban/KanbanContent.tsx:1691 onward.
- An editor node rename updates the node graph, which can reach Kanban card titles, but Company Explorer's workspace reducer has no node_updated case and relies on branch refresh/server echo: frontend/src/modules/editor/EditorContent.tsx:1330-1358; frontend/src/modules/company-explorer/companyExplorerStore.ts:310 onward.
- Rename handling is otherwise fragmented across frontend/src/modules/logic-gate-map/LogicGateMapContent.tsx:889-908, frontend/src/modules/node-map/NodeMapContent.tsx:944-963, frontend/src/modules/kanban/KanbanContent.tsx:2124-2160, and frontend/src/pages/home/HomePage.tsx:3979-3991, 4590-4613. Each path updates a subset of the same logical entity.
- LogicGateArenaPage already receives an explicit same-user title callback through app layout and does not need its workspace title subscription once the local entity plane is complete: frontend/src/pages/logic-gate-arena/LogicGateArenaPage.tsx:178 onward; frontend/src/app/applayout.tsx:1338 onward.

A practical transitional payload is one post-success local workspace mutation envelope using the existing WorkspaceReconciliationScope vocabulary, but emitted from the mutation response rather than from WebSocket input: frontend/src/modules/workspace/workspaceRealtime.ts:4-46, 260-309. Long term, a normalized entity/query cache is clearer than a global event vocabulary.

Same-browser window CustomEvents are acceptable as a transition, but each event should represent a local committed mutation, not a rebroadcast of a server event. Multiple browser tabs can revalidate on focus; use BroadcastChannel only if instant same-user cross-tab behavior becomes a requirement.

Do not delete all browser event buses with server realtime. Classify them by origin:

- mangorts:kanban-boards-updated is local command/result propagation and can remain during migration: frontend/src/modules/kanban/KanbanContent.tsx:1388 onward; frontend/src/pages/home/homeCommands.ts:198 onward.
- mangorts:kanban-board-contents-updated is mixed. Remove AppLiveFreshnessBridge as a producer, but retain or replace the local command-result path: frontend/src/app/AppLiveFreshnessBridge.tsx:266 onward; frontend/src/pages/home/homeCommands.ts:203 onward.
- mangorts:notifications-updated can remain temporarily behind one notification coordinator, then be replaced with direct store subscription: frontend/src/modules/notifications/notificationsApi.ts:327 onward.
- mangorts:communications-shared-inboxes-updated and mangorts:home-triage-conversion-applied are local API-result coordination, not reasons to keep cross-user workspace delivery: frontend/src/modules/communications/communicationsApi.ts:2171 onward; frontend/src/pages/home/HomePage.tsx:2141 onward.
- saved-view, account, selection, frame-link, map-focus, sidebar, dock, and fullscreen events are same-browser UI coordination. selectionCoordinator explicitly does not touch the backend: frontend/src/modules/selectionCoordinator.ts:97-132.

## Non-Live Freshness After Deletion

Several caches can remain stale indefinitely today because they assume realtime will invalidate them.

Examples:

- NodeRecordStore and LogicGateRecordStore return cached views without TTL: frontend/src/modules/node-map/NodeRecordStore.ts:30-106; frontend/src/modules/logic-gate-map/LogicGateRecordStore.ts:27-107.
- Node and Logic Gate graph subscriptions refresh on mount only when not already hydrated: frontend/src/modules/node-map/NodeRelationshipGraph.ts:576-590; frontend/src/modules/logic-gate-map/LogicGateRelationshipGraph.ts:516-530.
- The remount loaders also skip fetches for hydrated graph stores: frontend/src/modules/node-map/useNodeMapGraphLoader.ts:64-72; frontend/src/modules/logic-gate-map/LogicGateMapContent.tsx:325-374.
- Kanban board contents has no TTL: frontend/src/modules/kanban/KanbanBoardContentStore.ts:44-98.
- Kanban list and arena cache TTLs are two and five minutes respectively: frontend/src/modules/kanban/kanbanApi.ts:17-20, 472 onward.
- Company Explorer loaded branches are marked stale/refreshed by realtime; collapse and re-expand alone does not guarantee a fresh branch: frontend/src/modules/company-explorer/CompanyExplorerContent.tsx:1416-1467, 1530-1594, 1660-1686.
- Workspace snapshots already support ETag/If-None-Match: frontend/src/modules/workspace/workspaceSnapshotCache.ts:136-174.
- There is no general visibilitychange, pageshow, or window-focus freshness hook under frontend/src at this audit base.

These cache facts do not block deletion. This is a single-user development app, and temporary cross-user staleness is accepted. Apply the following only where it is simple or where focused tests expose an unacceptable same-user regression:

1. Preserve or add the obvious local committed-response patch for the initiating user's active surfaces.
2. Let non-live surfaces load canonical state when opened or navigated to; add a small surface-local activation/focus refresh only when existing cache behavior would otherwise make normal development unusable.
3. Manual reload/refresh is an acceptable development fallback.
4. Do not build a generalized mutation coordinator, global visibility framework, hidden polling, or a replacement invalidation bus before deleting broad realtime.
5. If a conditional request is already used, preserve correct ETag/304 behavior.

The backend already has workspace_read_versions and ETag helpers:

- backend/internal/store/workspace_read_versions.go:97-289
- backend/internal/http/etag_helpers.go
- backend/db/schema.sql:2264-2276, 2577-2607

Keep read versions because they serve canonical HTTP freshness independently of browser realtime. They are not a prerequisite project. If deletion makes a remaining classifier fail, fix that concrete path in the same task.

ETag support is not uniformly consumable today. requestJSONWithMeta handles 304, while the general apiFetchJSON path treats non-2xx responses as errors:

- frontend/src/modules/api/requestJSON.ts:61-131
- frontend/src/auth/cognitoAuth.ts:254-268

Backend handlers already emit precomputed or body-hash ETags for several useful reads, including Logic Gate work/consolidated views and Explorer/project reads:

- backend/internal/http/logic_gate_work_handlers.go:47-78
- backend/internal/http/consolidated_view_handlers.go:56-119

Do not create a new shared conditional-query architecture solely to finish this cleanup. Reuse requestJSONWithMeta where convenient and fix only concrete 304 regressions in touched surfaces.

## Delete In This One-Shot Task

Everything in this manifest is approved for deletion now. Internal dependency order is allowed, but there are no separate releases, compatibility periods, kill switches, observation windows, or later cleanup batches.

### Frontend deletion manifest

- In frontend/src/app/AppLiveFreshnessBridge.tsx, delete the communications subscription, ensureMangoRealtimeConnection retain effect, workspace subscription, broad reconciliation/invalidation logic, and server-workspace CustomEvent rebroadcasts. Retain only one notification ownership path or replace the component with an equivalently small notification coordinator.
- Delete HomePage communications, workspace, and GVIC matrix realtime effects at the current subscribeCommunicationsStream, subscribeWorkspaceRealtime, and GVICMatrixRealtimeScope call sites.
- Delete the MyWorkView GVIC matrix subscriptions.
- Delete CompanyExplorerContent's company_explorer:user subscription.
- Delete NodeRelationshipGraph's node_graph:user subscription and LogicGateRelationshipGraph's logic_gate_graph:user subscription.
- Delete ProjectManagementContent's Company Explorer and project_management subscriptions.
- Delete LogicGateArenaPage's workspace title subscription.
- Delete communications/mail realtime delivery and frontend/src/modules/communications/communicationsStream.ts when no callers remain.
- Delete KanbanContent's broad workspace:user subscription and the AppLiveFreshnessBridge/global CustomEvent invalidation path. Retain only the explicit mounted-board behavior, rewired away from event_rows in this same task.
- Delete frontend editor whole-document collaboration publication/subscription, collaborator presence UI that depends on it, and frontend/src/modules/editor/editorCollaboration.ts.
- Split Node chat from generic editor projection delivery, then delete the generic editor projection subscription and document-update handling.
- Delete the duplicate notifications:user subscription from useNotificationSummary. Exactly one app-lifetime notification owner remains; summary and an open Updates view consume it.
- Delete frontend/src/modules/workspace/workspaceRealtime.ts after its broad consumers are gone, plus obsolete workspace/projection/communications protocol types in realtimeWebSocket.ts.
- Preserve browser CustomEvents only when they originate from a successful local command and coordinate same-browser state. Delete events whose only purpose was to re-fan-out a server workspace message.

### Backend deletion manifest

- Delete backend/internal/http/workspace_fanout.go, backend/internal/store/workspace_event_fanout.go, backend/internal/store/postgres_workspace_event_fanout.go, backend/internal/store/workspace_effective_fanout.go, and their tests when no non-browser durable consumer uses them.
- Remove browser publication, user expansion, four-scope routing, replay, and snapshot-refetch behavior from backend/internal/http/workspace_handlers.go while preserving independently required domain-event append, immediate notification projection, workspace-derived processing, and read-version behavior.
- Delete workspace:user, company_explorer:user, node_graph:user, and logic_gate_graph:user scope parsing/authorization and company-global workspace replay/gap logic from realtime_ws.go.
- Delete communications:user publication/subscription protocol and backend communications WebSocket publication while preserving webhook processing and canonical mail APIs.
- Delete POST /v1/editor/collaboration/events, editor_collaboration_handlers.go, its route wiring/tests, and the durable editor_collaboration_event compatibility branch. Do not repair its authorization hole.
- Delete generic permission.changed live delivery and broad permission revalidation. HTTP/API authorization remains authoritative.
- Delete localWorkspaceEventBus, projectionDeltaHub, affected_scopes behavior, unreachable gvic:user production, unsupported editor:project production, and dead requestPathProjectionDeltas publication.
- Delete notification checkpoint initialization, runNotificationDomainEventCatchup, runNotificationDomainEventCatchupOnce, the 30-second company scan, notification ReplayDomainEvents recovery, startup wiring, repository/schema pieces used only by that recovery, and their tests. Preserve the existing immediate projector and durable notification rows; no replacement recovery system is required.
- Remove per-user and company-wide PostgreSQL workspace pg_notify fan-out. Retained scopes publish directly through the small retained publisher boundary.

### Projection queue and schema deletion manifest

Remove every event_rows type: kanban.projection_delta, gvic_matrix.projection_delta, project_management.projection_delta, project_relationship.projection_delta, editor.projection_delta, gvic.projection_delta, and permission.changed.

- Rewire mounted-board change hints and Node chat to direct compact post-commit registry publication first inside this same task.
- Delete all production appendEventRowsTx/appendEventRowsLocked calls and ProjectionDeltaEventInputs queue creation.
- Delete event_worker polling/claim/lease/retry code, event-row repository interfaces and Postgres/memory implementations, legacy projection message shaping, queue-specific sequences, and obsolete tests.
- Add the repository migration/schema update that drops event_rows and its indexes after code no longer references them.
- Drop company_projection_sequences only if the final retained direct scopes and canonical GETs no longer use it.
- Drop notification projection checkpoint schema only if no remaining non-notification consumer shares it.
- Do not apply remote/dev/prod database changes from an agent session. Repository migration/schema code is part of this task; execution follows docs/security/database-agent-access-contract.md.

## Retained By The End Of This Task

1. One shared frontend WebSocket client per API/company and the backend ticket, connection, subscribe/unsubscribe, registry, scope-authorization, ping/pong, reconnect, and error-handling core.
2. Exactly one app-lifetime notifications:user:{user_id} product scope.
3. Exactly one chat:node:{node_id} scope, active only while that Node/chat is mounted. Keep current durable chat storage; do not introduce a new chat table in this cleanup.
4. Exactly one mounted-board scope. Reuse board:{board_id} unless a rename is mechanically useful; its product semantics are the active Logic Gate Kanban board only.
5. A small direct publisher boundary for compact committed events. Process-local publication is acceptable for the current single-user development environment. A future broker may replace the publisher internals without changing product scopes.
6. Canonical HTTP mutation/read APIs, durable notification rows, canonical chat storage, Kanban projection/read tables, domain_events consumers independently required for workspace-derived/read-version/audit behavior, and workspace_read_versions.
7. Future Huddle/CRDT/OT only as documentation. No current collaboration code is retained for it.

## Final Minimal Realtime Design

One WebSocket per company/user can remain, but its protocol should be small:

| Scope/message | Subscriber | Payload |
| --- | --- | --- |
| notifications:user:{user_id} | Logged-in user, app-lifetime | existing created/deleted/cleared notification hints; one coalesced summary refresh and one Updates refresh only while open |
| chat:node:{node_id} | Active Node/chat viewer | compact committed message or deletion data; canonical chat reload on reconnect if needed |
| board:{board_id} | Viewers with that Logic Gate board mounted | compact board-changed hint derived directly from committed mutation results; coalesced canonical board refresh is acceptable |
| huddle.document:{huddle_id}:{document_id} | Not in this project | Future CRDT/OT operations and presence inside an explicit Huddle only |

Writes remain authenticated HTTP commands. The socket is a server-to-client change signal.

The retained publisher should expose an explicit scope plus compact message. For this single-user development cleanup, in-process registry delivery is sufficient and does not block completion:

- notifications publish only to their known user scope;
- Node chat publishes only to the active Node scope after persistence;
- Kanban mutations derive affected board IDs from committed mutation/projection results and publish only to those board scopes;
- no company-wide recipient expansion, domain-event replay, event_rows queue, global workspace cursor, or large document payload is allowed;
- reconnect/open loads canonical notification, chat, or board state;
- a future cross-instance broker can implement the same publisher contract later. If PostgreSQL LISTEN/NOTIFY can be added very simply in this one-shot, it may be used, but it is not a completion prerequisite.

Future realtime surfaces must add an explicit narrow scope, subscription authorization, compact committed event, and canonical HTTP fallback. They must not revive generic workspace replication.

## One-Shot Internal Execution Order

These are edit-order steps inside one uninterrupted implementation task, not batches, phases, releases, or follow-up work. Continue through every step, focused verification, full verification, commit, and merge to main before declaring completion.

### Internal step 1: Recheck source and lock the final manifest

- Recheck current main and every subscribe/publish/event_rows call because the original line references can drift.
- Use the approved defaults: preserve current Node-chat access semantics without expanding the product; Project chat excluded; no dedicated live permission revocation; mail non-live; same-window local consistency only; no global polling.
- Use notifications:user:{user_id}, chat:node:{node_id}, and existing board:{board_id} as the three scope families unless a mechanical naming adjustment is clearly smaller.
- Preserve current unified editor/persistence abstractions added after the original audit; remove only their old collaboration and broad editor-projection realtime dependencies.
- Do not add feature flags, compatibility nets, shadow publication, runtime measurement prerequisites, or new product decisions.

### Internal step 2: Delete broad frontend consumers

- Remove the workspace, Company Explorer, graph, GVIC/My Work, Project Management, communications, Logic Gate Arena, broad Kanban workspace, collaboration, generic editor projection, and always-retain effects in the frontend deletion manifest.
- Reduce AppLiveFreshnessBridge to the one notification owner and remove the duplicate socket subscription from useNotificationSummary.
- Keep local command-result CustomEvents; remove server-workspace rebroadcast events.
- Patch only concrete same-user regressions revealed by focused tests. Do not stop to build a generalized freshness layer.

### Internal step 3: Rewire the three retained lanes directly

- Keep current notification created/deleted/cleared request-path publication and durable rows. One frontend owner drives summary plus an open Updates view.
- Add chat:node:{node_id} direct post-commit publication from Node chat create/delete handlers. Publish committed row or deletion ID only; do not stream editor documents.
- Replace board projection deltas with a compact kanban.changed event on existing board:{board_id}. Debounce/coalesce one canonical board reload in the mounted Kanban. Derive affected boards from committed mutation/projection results; a Node title may signal each affected board.
- Keep scope authorization explicit: notifications must match actor, board requires effective Logic Gate access, chat requires effective Node access. HTTP commands remain authoritative for edit/delete permission.
- Use the current in-process registry. A broker is future scaling, not a completion gate.

### Internal step 4: Delete notification recovery and broad backend fan-out

- Delete notification_projection.go, checkpoint initialization/scanning, fallback catch-up calls, notification ReplayDomainEvents service methods, checkpoint repository/storage/schema, startup wiring, and tests. Keep the immediate request-path projector; log a best-effort failure without recovery.
- Delete workspace fan-out/listener/effective-user code, localWorkspaceEventBus, browser publication/replay, four broad scope branches, semantic affected-scope shaping, and redundant PostgreSQL notify paths.
- Delete communications WebSocket publication and collaboration endpoint/publication.
- Preserve durable domain-event append only where notification immediate projection, workspace-derived projection, read versions, or approved audit behavior still uses it.

### Internal step 5: Delete event_rows and projection replication completely

- Remove all seven queue types and every Postgres/memory appendEventRows call from the producer files listed in the deletion manifest.
- Delete event_worker, event_rows store/repository implementations, projectionDeltaHub and old projection publisher, queue-specific claim/lease/retry/sequence/message plumbing, tests, and server wiring.
- Preserve canonical projection table maintenance and mutation result data that non-realtime reads/local command responses still use; delete live-only ProjectionDeltas plumbing when it becomes unreferenced.
- Add the forward migration that drops event_rows and its indexes, and remove the table from canonical schema. Preserve historical create migrations.
- Re-audit company_projection_sequences after deletion; keep it if current canonical reads still use it.

### Internal step 6: Prune the reusable transport core

Delete or reduce:

- backend/internal/http/workspace_fanout.go
- backend/internal/store/workspace_event_fanout.go
- backend/internal/store/postgres_workspace_event_fanout.go
- backend/internal/store/workspace_effective_fanout.go
- workspace realtime publication and replay portions of backend/internal/http/workspace_handlers.go
- workspace/company_explorer/node_graph/logic_gate_graph scope parsing in backend/internal/http/realtime_ws.go
- projection publishing and legacy projectionDeltaHub portions of backend/internal/http/projection_deltas.go
- all event_worker code rather than retaining non-live cases
- frontend/src/modules/workspace/workspaceRealtime.ts
- most workspace/projection/communications message types in frontend/src/modules/realtime/realtimeWebSocket.ts
- frontend/src/modules/communications/communicationsStream.ts
- transient frontend/backend editor collaboration modules

Keep realtimeWebSocket.ts generic connection/subscription machinery and backend ticket/frame/registry/subscribe/unsubscribe/ping/pong/error code. Prune message types, scope authorization, metrics, and helpers until only notifications, chat, and board product scopes remain. Add a source guard that rejects the removed broad scope families.

### Internal step 7: Finish schema, tests, and docs in the same task

After code no longer writes/reads them in this same diff:

- drop event_rows and its indexes with a forward repository migration;
- remove obsolete company_projection_sequences rows/table if no GET or retained stream uses them;
- remove unused domain_events published_timestamp and pending index if no external outbox publisher exists;
- drop notification projection checkpoints if no other consumer shares them; define domain_events retention around only remaining workspace-derived, read-version, and approved audit requirements;
- retain workspace_read_versions or replace it with transactionally updated read versions.

Database changes must follow the repository database-agent access contract. Create and test repository migration/schema code, but do not run it against dev/prod from an agent session.

Update or delete tests and contracts in this same task:

- docs/tests/REST API & WebSocket.md
- docs/tests/updates.md
- docs/tests/editor.md
- docs/tests/my-work.md, especially the broad live refresh rules at lines 19, 33, 54-57, and 78-95
- docs/tests/kanbanboard.md, especially the projection/live convergence rules at lines 102-109
- docs/important tasks/Old Stuff/syncing-layer-v1.md, clearly marking its broad live-replication direction superseded
- any V4/V6 tracker language that mandates projection deltas for every surface

RW15 should change from “committed response or logic_gate_updated workspace event” to:

- committed response/local cache for the initiating user's active surfaces;
- activation/focus revalidation for another user.

RW19-RW23 should be narrowed to notification/chat/active-Kanban connections rather than generic app subscriptions.

U23/U24 should describe the one notification coordinator and bounded Updates reconciliation.

## Test Plan

### Retained realtime

- notification create/delete/clear reaches the one retained user subscription in the supported development configuration;
- one notification causes one summary reconciliation;
- urgent `!`, normal `@`, and regular non-mention unread badges all change immediately from the one notification summary;
- Updates closed causes no feed request;
- Updates open causes one bounded reconciliation;
- the existing immediate notification projector continues to create the expected durable notification rows without a catch-up scan;
- no notification projection checkpoint initialization, 30-second company scan, or ReplayDomainEvents notification path remains;
- canonical summary/feed loading still works without replaying domain events;
- local Seen remains no-reload and selects the next visible row;
- Node chat create/delete publishes only to chat:node:{node_id} after persistence;
- chat echo is deduplicated for the sender;
- chat reconnect/open reloads canonical durable chat state when needed;
- chat does not publish to workspace, board, Explorer, graph, GVIC, or document scopes;
- chat subscription preserves current Node access behavior and send/delete remain HTTP-authorized;
- a view-only editor does not enter a reject/refetch/resubscribe loop;
- HTTP permission checks remain authoritative without a generic permission-change stream;
- node title changes reach another user only when that user has a relevant Logic Gate Kanban board mounted; they do not generically update that user's Explorer, maps, or unrelated surfaces;
- card add/remove/move/reorder and column changes emit kanban.changed only to the same mounted board scope;
- users without that board mounted receive no board event;
- the initiating Kanban user applies the committed response once and deduplicates any server echo;
- board reconnect/open performs one canonical snapshot load rather than domain-event replay;
- no event worker remains;
- cross-instance broker behavior is not a completion gate for this single-user development cleanup.

### Non-live surfaces

- local node/Logic Gate rename updates every mounted same-session surface from the response;
- no server workspace echo is needed for the initiating user;
- a Logic Gate rename does not fan out to every other user's Explorer/map/title surface;
- non-live surfaces load canonical state through their normal open/navigation/manual-refresh paths;
- concrete same-user rename/card regressions exposed by the deletion are patched from committed responses or existing local events;
- existing conditional reads continue to accept 304 where they are already used;
- My Work, Project Management, and Company Explorer do not make background websocket-driven requests;
- hidden/unmounted surfaces do not poll.

### Deletion guards

- ordinary node, Logic Gate, project, assignment, and Kanban mutations commit without generic event_rows;
- no production call expands effective users for workspace browser fan-out;
- no client subscribes to workspace:user, company_explorer:user, node_graph:user, logic_gate_graph:user, gvic_matrix, project_management, project relationship, communications, editor collaboration, or generic editor projection scopes; only notifications:user, chat:node, and board scopes remain;
- notification catch-up/checkpoint code has no production caller and is removed from server startup;
- event_rows, its worker, repository API, producers, table, and indexes are absent;
- no full document HTML is published through the generic socket;
- source/projection writes and ETag read versions remain correct;
- a source inventory test rejects unclassified new event types/scopes.

## Static Event And Protocol Inventory

There is no single event catalog in the repository. Names are distributed across Go constants, handler string literals, read-version lists, notification mappings, tests, and duplicated PL/pgSQL arrays. The following is the best-effort complete inventory at the audit base; rerun source search before implementation because new events can otherwise bypass the deletion classification.

### event_rows types

Defined in backend/internal/store/event_rows.go:14-21:

- kanban.projection_delta
- gvic_matrix.projection_delta
- project_management.projection_delta
- project_relationship.projection_delta
- editor.projection_delta
- gvic.projection_delta
- permission.changed

### Workspace domain-event types

Nodes and node relationships:

- node_created
- node_updated
- node_deleted
- node_permissions_updated
- node_information_created
- node_projection_deleted
- node_editor_save_version_created
- node_editor_save_version_restored
- relationship_created
- relationship_deleted

Logic Gates and Logic Gate relationships:

- logic_gate_created
- logic_gate_updated
- logic_gate_deleted
- logic_gate_permissions_updated
- logic_gate_gvic_updated
- logic_gate_information_created
- logic_gate_projection_deleted
- logic_gate_editor_save_version_created
- logic_gate_editor_save_version_restored
- logic_gate_relationship_created
- logic_gate_relationship_deleted

Projects:

- project_created
- project_updated
- project_deleted
- project_permissions_updated
- project_information_created
- project_information_deleted
- project_relationship_upserted
- project_relationship_deleted

Kanban and work actions:

- kanban_board_saved
- kanban_board_updated
- kanban_board_deleted
- kanban_column_created
- kanban_column_updated
- kanban_column_deleted
- kanban_card_upserted
- kanban_card_moved
- kanban_card_deleted
- work_item.logic_gate_assignment_saved
- work_item.logic_gate_assignment_moved
- work_item.logic_gate_assignment_removed
- work_item.logic_gate_issue_toggled
- work_item.email_converted

Company Explorer and communications-access events:

- company_explorer_folder_created
- company_explorer_folder_updated
- company_explorer_folder_deleted
- company_explorer_folder_permissions_updated
- company_explorer_folder_item_assigned
- company_explorer_item_placed
- company_explorer_item_removed
- company_explorer_folder_share_upserted
- company_explorer_folder_share_deleted
- communications_shared_inbox_gvic_updated
- shared_triage_access_updated

Map and internal/deferred events:

- node_map_positions_updated
- logic_gate_map_positions_updated
- workspace_derived_projection_requested
- company_explorer_folder_item_assign_requested
- node_map_position_upsert_requested
- logic_gate_map_position_upsert_requested

Primary producer/classification references:

- backend/internal/store/node_graph_workspace_events.go:8-115
- backend/internal/store/kanban_workspace_events.go:5-47
- backend/internal/store/work_item_assignment_workspace_events.go:8-143
- backend/internal/store/communications_email_conversion.go:8, 163-274
- backend/internal/store/mutation_context.go:8-24
- direct publishWorkspaceEvent calls under backend/internal/http

### Notification-projector source event types

The directly named mention/comment domain facts include:

- node.mention_created
- logic_gate.mention_created
- node.comment_created

The notification projector also maps selected workspace events, including Logic Gate work actions, Logic Gate GVIC changes, selected node_updated subtypes, shared inbox GVIC changes, and shared-triage access changes:

- backend/internal/notifications/service.go:564-663
- backend/internal/store/node_graph_workspace_events.go:8-12
- backend/internal/domain/types.go:1052-1061

These notification-producing facts are a reason to disentangle domain_events from browser workspace replication, not a reason to retain the broad stream.

### WebSocket protocol message types

Defined in backend/internal/http/realtime_ws.go:34-50:

- ready
- subscribe
- unsubscribe
- subscription.accepted
- subscription.rejected
- projection.delta
- workspace.event
- notification.created
- notification.deleted
- notifications.cleared
- communications.event
- snapshot.refetch
- permission.revoked
- ping
- pong
- error

After migration, the protocol should contain only retained notification, Node-chat, mounted-board, lifecycle, and error messages. A source test should fail if a new broad scope or message is added without an explicit product classification.

## No Pre-Implementation Runtime Measurement Required

Do not query dev/prod databases, production metrics, AWS, or browser traffic before starting deletion. The source audit, compiler, focused tests, and full repository gate are sufficient authorization and proof for this single-user development cleanup.

Optional proof after implementation:

- source search shows only notifications:user, chat:node, and board product scopes;
- source search finds no workspace/Explorer/graph/GVIC/Project Management/communications/collaboration subscriptions or publishers;
- source search finds no event_rows, appendEventRows, event worker, notification catch-up, or checkpoint startup code outside historical migrations;
- one notification changes summary/badges once and refreshes Updates only while open;
- one Node chat create/delete reaches only its Node chat scope;
- one Kanban change signals only the affected mounted board and causes one coalesced canonical refresh;
- ordinary Node/Logic Gate/Project/My Work/Explorer/map/mail actions emit no generic realtime message.

## Approved Implementation Defaults

These are resolved. Do not ask the user again during the one-shot task:

1. Preserve current Node-chat access behavior; do not expand chat product semantics.
2. Project chat is excluded from retained realtime.
3. Kanban live behavior covers Node title, card add/remove, placement/move/reorder, columns, and other fields already visibly rendered on a card. A compact board-changed invalidation plus one debounced canonical board load is preferred over a new delta protocol.
4. Live permission revocation is not required; HTTP authorization remains mandatory and rendered data may clear on navigation/reload.
5. Mail/communications is non-live.
6. Same-user immediacy is required within the current app window, not across multiple browser tabs.
7. No global polling or maximum cross-user freshness interval is required for non-live surfaces.
8. Updates uses one notification coordinator and one coalesced canonical feed refresh while Updates is open.
9. Exact document coediting is removed. Future Huddle/CRDT/OT is out of scope.
10. Cross-instance realtime broker work is not a completion gate in the current single-user environment. Preserve a small publisher boundary so it can be added later.

## One-Shot Implementation And Completion Mandate

- Work in one isolated worker/worktree and own the complete change through its merge into main.
- Do not stop after frontend deletion, backend deletion, retained-lane rewiring, schema cleanup, tests, or documentation individually. All are part of one task.
- Do not leave commented code, disabled compatibility code, unused flags, dead types, or promised follow-up cleanup.
- Preserve unrelated user changes and the newer unified editor/persistence work on current main.
- Run focused frontend/backend tests while editing, then node scripts/run_all_tests.mjs.
- Review the entire diff, commit all intended worker changes, and run scripts/merge_worker_branch.ps1 from C:\Users\Jonat\MangoRTSDev with -CommitWorkerChanges and -Verification Full.
- Resolve integration failures and rerun the complete gate after merge-time fixes.
- Finish with clean local main. Remote origin push is separate unless the implementation request explicitly says origin/remote push.
- Update this document's status and handoff at the end to state the actual deleted systems, exact retained scopes, migration files, verification evidence, and any genuine remaining limitation. Do not leave this charter describing work that is already complete.

## Copy-Paste Prompt For The New Codex Instance

~~~text
Implement the complete MangoRTS realtime simplification in one coherent task and own it through the merge into main.

First read AGENTS.md and docs/important tasks/live-feed-audit.md completely. The live-feed document is the authoritative product contract, source audit, deletion manifest, retained-foundation design, execution order, and acceptance plan. Recheck current main for moved symbols, but do not reopen or reconfirm the approved product decisions.

This is an aggressive single-user development cleanup. Do not split it into batches, phases, later PRs, feature flags, observation periods, or recommended next steps. Continue until the entire final state in the document exists, obsolete code/schema/tests are deleted, focused tests and node scripts/run_all_tests.mjs pass, the worker is committed, and the repository merge helper has merged it into clean local main.

Non-negotiable final state:
- exactly three product realtime scope families remain: notifications:user:{user_id}, chat:node:{node_id}, and board:{board_id};
- Company Explorer, Home workspace/GVIC/communications, My Work, maps/graphs, Project Management, Logic Gate Arena title, generic permission, broad Kanban workspace, generic editor/document, and mail live subscriptions/publication are deleted;
- the pseudo-collaboration endpoint/client/UI is deleted; Huddle/CRDT/OT remains future documentation only;
- notification catch-up/checkpoint/replay is deleted while the current immediate projector and durable notification rows remain;
- Node chat and mounted-board change hints publish directly through the retained registry/publisher after persistence and no longer use generic editor/Kanban projection event rows;
- all event_rows producers, types, repository implementations, event worker/lease/retry/sequence machinery, schema/table/indexes, and obsolete tests are deleted through a forward repository migration;
- generic workspace browser fan-out, replay, effective-user expansion, PostgreSQL workspace notifications/listener, broad scope authorization, communications publication, permission-change delivery, localWorkspaceEventBus, projectionDeltaHub, unreachable GVIC/project-editor paths, and dead request-path publication are deleted;
- the shared frontend socket client and backend ticket/frame/registry/subscribe/unsubscribe/ping/reconnect core remain reusable for future explicit scopes;
- process-local delivery is acceptable for this task; do not let a new broker or generalized freshness framework block deletion;
- same-user committed responses/local events still update concrete mounted surfaces, and non-live cross-user staleness until navigation/reload is accepted;
- canonical HTTP APIs, projection/read tables, workspace_read_versions, and independently required domain_events consumers remain intact.

Use subagents for parallel source tracing, producer removal, frontend consumer removal, and test/doc updates where useful, but you own integration. Follow docs/security/database-agent-access-contract.md: create repository migration/schema changes, never mutate dev/prod databases or retrieve secrets from the agent session.

Update all affected docs/tests contracts so they describe the final architecture rather than deleted streams. Delete stale tests instead of restoring compatibility code merely to satisfy them. Add source guards and focused tests for the exact three retained surfaces and absence of forbidden scopes/event_rows.

Do not finish with a plan. Finish with the implementation merged into local main, full verification passing, final git status, worker/merge SHAs, deleted-system summary, retained-scope summary, schema migration summary, and only genuine limitations such as future Huddle or future cross-instance broker scaling.
~~~

## Audit Limitations

- Static code and committed docs were inspected.
- No production/dev database was queried.
- No AWS resources or live backend tasks were changed.
- No browser multi-user session or load test was run.
- Exact current table volumes, event rates, and deployed Terraform overrides remain unverified.
- The 49 appendEventRowsTx invocations are a static source count, not a measured production event rate; one command can also produce zero, one, or several event rows.

## Bottom Line

The broad fan-out can and should be removed.

The highest-value simplification is:

~~~text
one user notification lane
+ one active node chat lane
+ one active Logic Gate Kanban lane
+ local committed-response propagation
+ cheap activation/focus revalidation
- generic workspace replication
- generic projection replication and event_rows queue
- notification domain-event catch-up/checkpoints
- live mail refresh
- pseudo document collaboration
+ future Huddle/CRDT/OT as a separate project, not cleanup scope
~~~

Deletion is authorized now. The one-shot task performs the minimum internal rewiring needed for direct Node-chat and mounted-board publication, preserves the existing immediate notification projector plus durable rows, and removes notification catch-up, broad WebSocket scopes, permission fan-out, event_rows, replay/gap code, the broad frontend freshness bridge, and the cache-invalidation cascade in the same completed change.
