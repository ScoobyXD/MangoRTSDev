# Live Feed And Realtime Fan-Out Audit

Last updated: 2026-07-12

Status: static architecture audit complete enough to drive implementation planning. No realtime product code was changed in this branch.

Audit branch: codex/live-feed-audit

Audit worktree: C:\tmp\MangoRTSDev-workers\MangoRTSDev-live-feed-audit

Base commit: 5747e73f7fbb4c8795870c8be9f014b1ba7ca5fe

## Executive Decision

The proposed simplification is directionally correct.

The current app treats too many ordinary CRUD changes as cross-user live replication problems. It records and distributes workspace domain events, projection delta event rows, permission events, notification events, communications events, and editor collaboration messages through overlapping paths. The result is a large amount of code, database work, cache invalidation, replay logic, permission fan-out, and failure recovery for behavior that the product does not need on most screens.

The currently approved live experiences reduce to three narrow cross-user backend lanes:

1. User notifications and the Updates feed can share one user-targeted notification lane.
2. Node chat can use one resource-targeted lane while the relevant node is open.
3. A mounted Logic Gate Kanban board can use one board-targeted lane for committed node-card changes.

Immediate consistency for the user who made a change is not a fourth cross-user realtime lane. It should be implemented from the successful HTTP mutation response, optimistic/local state, shared client caches, and a same-browser mutation signal.

Exact document coediting should not be counted as an existing keep-surface. The current code does not provide safe exact coediting. It relays whole documents without OT, CRDT, a shared revision, cursor state, or conflict resolution. The near-term decision is to remove that pseudo-collaboration path and retain durable autosave. A future opt-in feature called a Huddle may deliberately provide shared editing with CRDT/OT, but Huddle is a separate future product project and is not part of this realtime-deletion effort.

### Proposed product rule

| Experience | Cross-user live? | Freshness rule |
| --- | --- | --- |
| Notification badges | Yes | User-targeted and app-lifetime |
| Updates feed and its three unread badges | Yes | Consume the same user notification lane; `!` urgent mentions, `@` normal mentions, and regular non-mention updates change immediately; no second socket |
| Node chat while the node/chat is open | Yes | Resource-targeted, committed messages only |
| Mounted Logic Gate Kanban board | Yes | Board-targeted committed node-card title, add/remove, move/reorder, column, and other explicitly card-visible changes |
| Node or Logic Gate document typing | No for now | Durable HTTP autosave; reopen/revalidate for another user |
| The initiating user's own title/card/tree changes | Immediate locally | Patch from the mutation response; never bounce through the server fan-out |
| Kanban changes made by another user | Yes only on the relevant mounted Logic Gate board | Apply compact committed board deltas; refetch the canonical board snapshot on open/reconnect/gap |
| Company Explorer changes made by another user | No | Revalidate roots/expanded branches on activation or focus |
| Node/Logic Gate maps and relationships | No | Conditional refresh on activation or focus |
| My Work/GVIC/Project Management | No | Refresh when opened/focused and after the local user's commands |
| Mailbox/communications list changes | No under the stated policy | Refresh while the mailbox is visible, on focus, or on a bounded timer |
| Permission revocation | Product/security decision | Server authorization remains immediate. Optionally send a narrow user control message to clear already-rendered restricted data. |

### Recorded product decisions from 2026-07-12

1. A future Huddle is the candidate home for intentional simultaneous document editing. Huddle may use CRDT/OT, explicit session membership, presence, cursor state, and a collaboration-specific persistence model. Do not build it in this cleanup and do not preserve the current whole-document relay for it.
2. Cross-user live delivery is retained only for node chat, the user notification/Updates lane, and the currently mounted Logic Gate Kanban board.
3. The Updates sidebar badges for urgent `!` mentions, normal `@` mentions, and regular non-mention updates must change immediately from the one notification summary source. This restates docs/tests/updates.md:79 and 366-367.
4. Node-card title and placement changes on a Logic Gate Kanban board should be visible to other users who currently have that same board open. This does not justify company-wide workspace fan-out or background subscriptions for every board.
5. The notification domain-event catch-up/checkpoint worker is not a product requirement. Delete it after notification rows are written directly and reliably by the originating command path. Loading current notification summary/feed state on mount, reconnect, or focus is ordinary canonical-state loading, not a durable event-recovery subsystem.
6. The initiating user's successful mutation must still update every relevant surface in that app session immediately from the committed response. Other users do not receive generic title/tree/map/Explorer live replication unless the change is part of the retained active Kanban contract.

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
- notification rows are product data; notification projector checkpoints and catch-up are implementation machinery approved for deletion after direct notification writes replace them.
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
| Permission changed | event_rows | Event worker revalidates many live scopes | Revoke/refetch broad subscriptions | Narrow to retained chat/Kanban/control scopes or remove with them |

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
| KanbanContent | board:{board} | Applies projection deltas or refetches | Keep the active-board product behavior, but replace this process-local event_rows delivery with a compact reliable board lane |
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

Required consequence: do not claim that notifications/chat are safely retained until they have a compact cross-instance wake-up or broker.

### P0: The transient document publisher has an authorization hole

WebSocket subscription authorization checks company and effective entity edit access:

- backend/internal/http/realtime_ws.go:334-375

The POST publisher for collaboration validates only shape, entity-kind text, IDs, event type, and payload size:

- backend/internal/http/editor_collaboration_handlers.go:13-87

It does not check that the actor belongs to the supplied company or can access/edit the supplied node or Logic Gate. An authenticated caller who knows IDs can inject transient document updates into sessions belonging to authorized subscribers. The request also accepts caller-provided client ID, display name, revision, and up to 850 KB of HTML.

This is a security/correctness issue independent of the larger architecture decision. If implementation starts before the collaboration path is deleted, disable it or add the same company/entity authorization used by subscription.

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

The decision is not to repair or paginate notification catch-up. Replace the reason it exists, then delete it:

1. The originating authenticated command writes every required durable notification row directly and reliably, preferably in the same database transaction as the business fact that requires the notification.
2. After commit, publish one compact best-effort user wake-up so the badge coordinator and an open Updates view can reconcile immediately.
3. On app mount, socket reconnect, browser focus, or opening Updates, load the canonical current summary/feed through the normal HTTP APIs. A missed wake-up may delay the screen until that bounded revalidation, but it must not lose the already-written notification row.
4. Delete notification projection checkpoints, initialization, the 30-second company scan, ReplayDomainEvents usage for notifications, and their tests.

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

Server-side HTTP authorization remains authoritative, but a retained long-lived chat/control lane needs an explicit membership/session revocation strategy.

### P2: More realtime fields and routes are dead or unreachable

Additional high-confidence cleanup candidates found in the static call graph:

- event_rows.affected_scopes is stored and decoded, but event_worker does not read it: backend/internal/store/event_rows.go:27-58, 306-370; backend/internal/http/event_worker.go:43-70.
- gvic.projection_delta produces gvic:user:{id}, but authorizeRealtimeSubscription has no gvic:user branch: backend/internal/store/event_rows.go:519-568; backend/internal/http/realtime_ws.go:334-423.
- The durable editor_collaboration_event workspace-routing branch has no production domain-event producer. The actual collaboration endpoint publishes transiently: backend/internal/http/workspace_handlers.go:1139-1150; backend/internal/http/editor_collaboration_handlers.go:94-131.
- requestPathProjectionDeltas filters out every currently defined projection event type, so request-path projection publisher calls are behaviorally dead: backend/internal/http/projection_deltas.go:180-192.
- domain_events.published_timestamp, its pending index, ListPendingDomainEvents, and MarkDomainEventPublished have no production publisher/marker caller: backend/db/schema.sql:2185-2218; backend/internal/store/postgres_domain_events.go.

Delete these only after focused source/tests prove no external integration depends on them, but they should not survive merely because nearby retained notification code still uses domain_events.

### P2: Go and SQL disagree about read-version handling for internal derived events

The Go classifier returns no read-version keys for workspace-derived projection request events before adding the full workspace snapshot key:

- backend/internal/store/workspace_read_versions.go:194-201

The SQL trigger function unconditionally emits workspace-snapshot:full before its event-specific logic:

- backend/db/schema.sql:2335-2344

This classification drift means tests or memory-mode behavior can disagree with Postgres about which ETags advance. Before relying on conditional refresh as the replacement for realtime, make one implementation the source of truth and add parity tests.

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

The dedicated node-chat contract must decide deliberately whether chat viewing follows View access while sending/deleting remains Edit-gated.

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

1. Keep the existing durable chat write initially.
2. Emit one compact committed chat event containing company_id, node_id, block_id, message_id, and operation.
3. Publish to chat:node:{node_id} only if a local connection is actively subscribed.
4. Cross backend tasks with one compact broker/NOTIFY message; do not expand all users.
5. Authorize subscription with effective view access if view-only users should see chat. Keep send/delete commands edit-gated.
6. Use the durable chat message ID/sequence for reconnect catch-up.
7. Do not emit board, workspace, Explorer, or graph messages for chat.
8. Keep notification creation as a separate user-targeted outcome.

Storage can remain in the current projection tables for the first migration. A dedicated node_chat_messages table is an optional later cleanup, not required to remove fan-out.

Project text-box chat is a separate implementation and is not currently part of the node-chat notification contract. Product must decide whether it is excluded or becomes another explicit resource scope.

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

Current Updates behavior refetches roots and each expanded/loaded root branch for every external notification change. A better retained contract is either:

1. server-shaped incremental notification rows with placement/group paths; or
2. one coalesced Updates snapshot/change endpoint.

Do not add an updates:user WebSocket in addition to notifications:user.

Notification correctness comes from the durable notification rows written by the originating command, not from later rescanning a company-wide domain-event log. The WebSocket is only the immediate UI wake-up. If it is missed, the next bounded canonical summary/feed load repairs display state without a background notification projector.

Relevant business rules:

- docs/tests/updates.md:11-35, 69-81
- docs/tests/updates.md:212-235, 328-367

Rules U23/U24 currently say realtime changes trigger feed refetch. If incremental application replaces refetching, update those rules deliberately while retaining U66 and U71 local Seen behavior.

### 3. Logic Gate Kanban board

This is now an approved retained cross-user live surface, but only while the specific board is mounted.

Required contract:

- one scope per Logic Gate Kanban board, conceptually logic_gate.kanban:{logic_gate_id} or board:{board_id};
- authorize against current effective access to that Logic Gate;
- publish only committed changes that affect the visible board: node-card title, add/remove, move/reorder, column creation/update/delete, and any other field explicitly rendered on a card;
- the initiating user applies the mutation response immediately and deduplicates the server echo;
- other users with that same board open apply a compact canonical delta;
- users without that board open receive nothing;
- every backend task receives one compact cross-instance wake-up and publishes only to matching local subscribers;
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
- optimistic concurrency/version conflict handling should be added before encouraging simultaneous editors.

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

It is not yet complete. Some cross-surface title/list state still depends on a server workspace echo. Before disabling the broad stream, create one explicit local mutation coordinator or shared normalized cache for:

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

Verified rename gaps that make a blind stream shutdown unsafe:

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

## Freshness Replacement Before Streams Are Disabled

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

Required replacement policy:

1. Every non-live surface performs a conditional revalidation when it becomes active.
2. A visible surface revalidates when the browser returns to the foreground after a bounded stale interval.
3. Route/panel activation should revalidate even if a singleton cache is already hydrated.
4. A successful local mutation patches its cache immediately and marks dependent caches stale.
5. Manual refresh remains available.
6. Optional low-frequency polling is mounted-and-visible only; it must not be global.
7. ETag/304 and workspace_read_versions should make these checks cheap.

The backend already has workspace_read_versions and ETag helpers:

- backend/internal/store/workspace_read_versions.go:97-289
- backend/internal/http/etag_helpers.go
- backend/db/schema.sql:2264-2276, 2577-2607

Keep this mechanism until the non-live revalidation strategy is proven. If domain event creation is later reduced, move read-version bumps into the same source/projection transaction rather than silently breaking ETags.

ETag support is not uniformly consumable today. requestJSONWithMeta handles 304, while the general apiFetchJSON path treats non-2xx responses as errors:

- frontend/src/modules/api/requestJSON.ts:61-131
- frontend/src/auth/cognitoAuth.ts:254-268

Backend handlers already emit precomputed or body-hash ETags for several useful reads, including Logic Gate work/consolidated views and Explorer/project reads:

- backend/internal/http/logic_gate_work_handlers.go:47-78
- backend/internal/http/consolidated_view_handlers.go:56-119

The refresh replacement therefore needs a shared conditional-query primitive, not merely more calls to existing API helpers.

## What Can Be Deleted First

These are high-confidence, low-product-impact candidates, subject to focused tests:

1. The transient whole-document collaboration publisher/subscriber and unused presence/leave UI. Future Huddle does not depend on this path.
2. Notification domain-event catch-up, notification projection checkpoint initialization/scanning, and their tests, in the same change that makes the originating commands write required notification rows directly.
3. Per-user PostgreSQL workspace fan-out notifications. Listeners discard them today. Keep the one company wake-up temporarily only while broad workspace delivery still exists.
4. localWorkspaceEventBus, after tests assert durable event creation or WebSocket behavior directly.
5. projectionDeltaHub, after tests use realtimeRegistry or pure delta shaping.
6. Unsupported editor:project event-row creation/delivery, unless a real subscriber is first identified.
7. Workspace browser publication of node_information_created and logic_gate_information_created; the frontend explicitly ignores them. Preserve any separately required durable audit fact.
8. Redundant always-retain connection effect in AppLiveFreshnessBridge.
9. Duplicate notification subscriptions after the notification coordinator owns the one user scope.
10. Old Kanban workspace invalidation and process-local event_rows delivery after the dedicated active-board lane is proven.

Do not start with schema drops. First remove consumers, then producers, then the tables/indexes after observation.

## What Must Wait For A Replacement

1. Do not remove notification WebSocket delivery until compact cross-instance user delivery exists.
2. Do not delete notification catch-up before every required notification is written directly by its originating command; remove both the old dependency and recovery worker together.
3. Do not remove editor projection delivery for node chat until chat:node delivery exists.
4. Do not remove the old Kanban paths until the dedicated active-board lane handles the approved card-visible changes across backend tasks.
5. Do not remove other broad frontend subscriptions until activation/focus revalidation and local mutation propagation are tested.
6. Do not drop domain_events while workspace-derived processing, read versions, or an explicitly approved audit use still needs them. Notification catch-up is no longer a reason to keep them.
7. Do not remove workspace_read_versions until an equivalent ETag version source exists.
8. Do not remove permission-change live handling for retained chat/Kanban/control scopes until those subscriptions can be revoked safely.
9. Do not drop event_rows until node chat and active-board delivery have moved to their narrow replacements.

## Proposed Narrow Realtime Design

One WebSocket per company/user can remain, but its protocol should be small:

| Scope/message | Subscriber | Payload |
| --- | --- | --- |
| user.notifications | Logged-in user, app-lifetime | created/deleted/cleared plus summary revision/counts |
| node.chat:{node_id} | Active node editor/chat viewer | committed message ID, block ID, operation, node chat sequence |
| logic_gate.kanban:{logic_gate_id} | Viewers with that Logic Gate board mounted | compact committed card/column operation and canonical changed record |
| user.control | Optional security/control messages | resource revoked or session invalidated |
| huddle.document:{huddle_id}:{document_id} | Not in this project | Future CRDT/OT operations and presence inside an explicit Huddle only |

Writes remain authenticated HTTP commands. The socket is a server-to-client change signal.

For current two-task ECS deployment, a small cross-instance mechanism is required:

- notification insert/delete/clear can publish one compact company/user/revision wake-up;
- chat commit can publish one compact company/node/message/operation wake-up;
- an approved Kanban mutation can publish one compact company/Logic Gate/board operation wake-up;
- every backend task listens and sends only to its own matching local subscribers;
- no company-wide reverse-access expansion is required because notification recipients are known and chat/board subscribers are already authorized;
- reconnect loads canonical notification summary/feed, chat messages after the durable message cursor, or the current board snapshot. Do not reuse the filtered company-global sequence or notification catch-up worker.

PostgreSQL LISTEN/NOTIFY can be an interim broker for compact IDs/wake-ups. It should not carry full documents or large rows. A dedicated broker is preferable if exact collaboration or much higher message volume is later required.

## Phased Deletion Plan

### Phase 0: Lock the product contract and baseline

- Approve the target matrix in this document.
- Decide node chat view-vs-edit subscription access.
- Decide whether Project chat is excluded.
- Decide whether immediate permission-revocation clearing is a narrow exception.
- Record Huddle/CRDT/OT as a separate future project; current pseudo-collaboration is approved for deletion.
- Lock the minimum active-board payload: node title, card add/remove/move/reorder, columns, and explicitly card-visible fields only.
- Capture current event table size/rate and live subscription counts.
- Add a temporary server kill switch for broad workspace/projection publishing if one does not already exist.

No schema change in this phase.

### Phase 1: Make non-live surfaces safely refreshable

- Add activation/focus conditional revalidation.
- Make already-hydrated graph and record-store caches revalidate.
- Make Kanban contents revalidate on activation.
- Complete local committed-response propagation for titles, cards, Explorer, graphs, Home, and arena targets.
- Add tests proving another user's change appears after activation/focus, not necessarily instantly.

Keep existing streams during this phase as a compatibility net.

### Phase 2: Build the three retained lanes

- Central notification coordinator.
- Direct reliable notification-row creation in the originating commands.
- Delete notification catch-up/checkpoint scanning and add compact cross-instance notification wake-up plus bounded canonical summary/feed loading.
- Dedicated committed node chat scope.
- Cross-instance chat wake-up and resource sequence.
- Dedicated active Logic Gate Kanban scope with compact committed card/column deltas and canonical snapshot fallback.
- Cross-instance Kanban wake-up without company-wide recipient expansion.
- Narrow permission revocation for active chat and Kanban subscriptions.
- Two-backend integration tests.

### Phase 3: Disable broad frontend consumers

Remove workspace/board/GVIC/Project Management/graph/Explorer subscriptions surface by surface. Suggested order after local mutation propagation and focus/open revalidation are green:

- disable the unsafe transient collaboration subscription and publisher;
- graph stream bootstraps;
- Company Explorer workspace effect;
- Logic Gate Arena title workspace effect;
- My Work and Project Management subscriptions;
- Home workspace and GVIC matrix effects;
- Kanban workspace effect and old process-local board projection subscription, replacing them with the dedicated active-board lane rather than removing live Kanban;
- communications subscriptions under the stated non-live-mail decision;
- editor projection subscription after chat is split;
- AppLiveFreshnessBridge workspace, communications, and connection-retain effects last, once no remaining cache relies on its global invalidations.

Do not delete AppLiveFreshnessBridge first. It currently masks the indefinite-cache and partial local-reconciliation defects listed above.

Use metrics to prove only notifications, active node chat, and currently mounted Logic Gate Kanban subscriptions remain.

### Phase 4: Stop producing UI-replication events

- Stop appending GVIC, Project Management, Project relationship, generic editor, and old Kanban event_rows.
- Do not retain the generic event_rows queue for chat or Kanban; publish compact post-commit wake-ups and reconcile from their canonical rows/snapshots.
- Stop publishing routine workspace events to browsers.
- Separate “append durable domain fact” from “publish to workspace realtime.”
- Remove request paths that create duplicate workspace and projection signals for the same command.

This is the phase that removes database work from ordinary mutations.

### Phase 5: Delete broad backend transport

Candidate deletions or major reductions:

- backend/internal/http/workspace_fanout.go
- backend/internal/store/workspace_event_fanout.go
- backend/internal/store/postgres_workspace_event_fanout.go
- backend/internal/store/workspace_effective_fanout.go
- workspace realtime publication and replay portions of backend/internal/http/workspace_handlers.go
- workspace/company_explorer/node_graph/logic_gate_graph scope parsing in backend/internal/http/realtime_ws.go
- projection publishing and legacy projectionDeltaHub portions of backend/internal/http/projection_deltas.go
- non-retained cases and permission revalidation in backend/internal/http/event_worker.go
- frontend/src/modules/workspace/workspaceRealtime.ts
- most workspace/projection/communications message types in frontend/src/modules/realtime/realtimeWebSocket.ts
- frontend/src/modules/communications/communicationsStream.ts
- transient frontend/backend editor collaboration modules

Keep the minimal WebSocket registry/ticket path only if it remains the chosen notification/chat/active-Kanban transport.

### Phase 6: Database lifecycle and schema cleanup

After code no longer writes/reads them:

- archive or delete processed event_rows under a human-approved migration;
- drop event_rows and its indexes if the retained lanes use a different outbox;
- remove obsolete company_projection_sequences rows/table if no GET or retained stream uses them;
- remove unused domain_events published_timestamp and pending index if no external outbox publisher exists;
- delete notification projection checkpoints with the catch-up worker, then define domain_events retention around only remaining workspace-derived, read-version, and approved audit requirements;
- retain workspace_read_versions or replace it with transactionally updated read versions.

Database changes must follow the repository database-agent access contract and be executed through the authorized human/migration path.

### Phase 7: Documentation and test cleanup

Update:

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

- notification create/delete/clear reaches a socket on either backend task;
- one notification causes one summary reconciliation;
- urgent `!`, normal `@`, and regular non-mention unread badges all change immediately from the one notification summary;
- Updates closed causes no feed request;
- Updates open causes one bounded reconciliation;
- every update-producing command writes its required durable notification rows directly without waiting for a catch-up scan;
- no notification projection checkpoint initialization, 30-second company scan, or ReplayDomainEvents notification path remains;
- a deliberately missed notification wake-up is repaired by the next canonical summary/feed load, without replaying domain events;
- local Seen remains no-reload and selects the next visible row;
- node chat create/delete reaches another viewer on either backend task;
- chat echo is deduplicated for the sender;
- chat reconnect catches up from durable sequence;
- chat does not publish to workspace, board, Explorer, graph, GVIC, or document scopes;
- chat subscription and send authorization cover view/edit/no-access policy;
- a view-only editor does not enter a reject/refetch/resubscribe loop;
- permission revocation removes an active chat subscription;
- node title changes reach another user only when that user has a relevant Logic Gate Kanban board mounted; they do not generically update that user's Explorer, maps, or unrelated surfaces;
- card add/remove/move/reorder and column changes reach viewers of the same mounted board on either backend task;
- users without that board mounted receive no board event;
- the initiating Kanban user applies the committed response once and deduplicates any server echo;
- board reconnect/gap performs one canonical snapshot load rather than domain-event replay;
- a slow WebSocket client cannot block another client or an event worker;
- a retained compact PostgreSQL wake-up survives reconnect by reconciling from canonical notification, chat, or board state.

### Non-live surfaces

- local node/Logic Gate rename updates every mounted same-session surface from the response;
- no server workspace echo is needed for the initiating user;
- a Logic Gate rename does not fan out to every other user's Explorer/map/title surface;
- a second user sees non-Kanban changes after activating/focusing the relevant surface;
- cached Node/Logic Gate views revalidate on activation;
- hydrated graph caches revalidate conditionally;
- Kanban content revalidates on activation;
- 304 responses are accepted by the shared conditional-query client instead of treated as API errors;
- Go and SQL read-version classifiers return the same keys for every known workspace event;
- My Work, Project Management, and Company Explorer do not make background websocket-driven requests;
- hidden/unmounted surfaces do not poll.

### Deletion guards

- ordinary node, Logic Gate, project, assignment, and Kanban mutations commit without generic event_rows;
- no production call expands effective users for workspace browser fan-out;
- no client subscribes to workspace:user, company_explorer:user, node_graph:user, logic_gate_graph:user, gvic_matrix, project_management, or the old process-local projection board scope; only the explicit notification, active node-chat, and active Logic Gate Kanban scopes remain;
- notification catch-up/checkpoint code has no production caller and is removed from server startup;
- no processed event_rows accumulate after migration;
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

After migration, the protocol should contain only the retained user-notification, node-chat, optional user-control, lifecycle, and error messages. A source test should fail if a new broad scope or message is added without an explicit product classification.

## Runtime Measurements Still Needed

This audit is source-based. It did not query dev/prod databases or production metrics.

Run the database queries only from a physically read-only agent/human session after the required access-boundary verification.

Suggested read-only measurements:

~~~sql
select event_type,
       count(*) as rows,
       pg_size_pretty(sum(pg_column_size(payload))::bigint) as payload_bytes,
       min(created_timestamp) as oldest,
       max(created_timestamp) as newest
from event_rows
group by event_type
order by rows desc;

select processed_at is null as pending,
       count(*) as rows
from event_rows
group by processed_at is null;

select stream_type,
       event_type,
       count(*) as rows,
       pg_size_pretty(sum(pg_column_size(payload))::bigint) as payload_bytes
from domain_events
group by stream_type, event_type
order by rows desc;

select pg_size_pretty(pg_total_relation_size('event_rows')) as event_rows_total,
       pg_size_pretty(pg_total_relation_size('domain_events')) as domain_events_total;
~~~

Browser/runtime measurements:

- scopes registered on a normal Home session;
- WebSocket frames and GETs caused by one node rename;
- frames and GETs caused by one Kanban move;
- frames, event rows, domain events, and GETs caused by one chat message;
- notification summary and Updates requests caused by one notification;
- behavior when mutation HTTP and recipient WebSocket land on different backend tasks;
- reconnect behavior after more than 100 company workspace events;
- event_worker lag and retry count;
- realtime active subscriptions by scope type;
- workspace fan-out recipient expansion duration.

## Open Product Decisions

1. Is node chat visible live to viewers or editors only?
2. Is Project text-box chat part of the retained chat promise?
3. Which card-visible fields beyond node title and placement belong in the active Logic Gate Kanban delta contract?
4. Must permission revocation remove already-rendered data immediately, or is next focus/navigation sufficient while all server writes/reads remain authorized?
5. Is live inbound mailbox refresh an intentional fourth exception, or should mail use visible-only polling/focus refresh?
6. Is instant same-user behavior required across multiple browser tabs, or only within one app window?
7. What maximum non-live freshness interval is acceptable while a surface remains continuously visible?
8. Should Updates apply server-shaped incremental rows or perform one coalesced feed fetch?

Exact document coediting is no longer an open decision for this cleanup: remove the current relay. Future Huddle/CRDT/OT is recorded but out of scope.

## Recommended First Implementation Slice

The safest first PR should not try to remove the entire system.

Recommended scope:

1. Delete the transient collaboration publisher/subscriber; record Huddle as future work rather than preserving this implementation.
2. Make notification-producing commands write their durable notification rows directly, then delete the notification catch-up/checkpoint worker and tests.
3. Add one notification coordinator and prove one notification produces one summary/feed transition and updates all three sidebar badges.
4. Remove the discarded per-user PostgreSQL workspace notifications.
5. Add activation/focus revalidation primitives and focused tests for one representative non-live surface.
6. Specify and feature-flag the dedicated active Logic Gate Kanban lane before removing the old board/workspace paths.

The next retained-lane PRs can introduce chat:node and active Logic Gate Kanban delivery across two backend tasks. Broad consumer removal should start only after notification, chat, Kanban, and non-live revalidation prerequisites are green.

## Continuation Handoff

A future Codex instance should:

1. Read this file first.
2. Confirm the product decisions above with Jonat or use an explicitly scoped phase request.
3. Recheck current main because this audit is tied to base commit 5747e73f.
4. Keep the first implementation phase narrow; do not combine frontend consumer removal, backend producer removal, and schema deletion in one change.
5. Run focused tests after each lane, then node scripts/run_all_tests.mjs before merge.
6. Inspect the final diff for unrelated changes.
7. Preserve workspace-derived, approved audit, and read-version behavior unless the phase explicitly replaces them. Do not preserve notification catch-up merely because it consumes domain_events today.

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

Durable notification rows and ETag pieces should be disentangled from generic domain-event recovery rather than deleted by name. Once direct notification writes, active chat, active Kanban, and non-live revalidation exist, the notification catch-up worker plus most WebSocket scopes, permission fan-out, event-row production, replay/gap code, frontend freshness bridge, and cache-invalidation cascade can be retired.
