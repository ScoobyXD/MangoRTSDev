# V4 Architecture Doc

Status: current architecture notes for backend writes, permissions, projections, realtime subscriptions, notifications, and frontend reconciliation.

This document is a practical mental model for how MangoRTS moves data from a user action to database state, projection rows, live UI updates, and notifications. It is not a replacement for reading the code before making a risky change, but it should be the first reference when reasoning about snapshots, streams, fanout, permissions, and projection tables.

## One-Sentence Model

MangoRTS uses bounded HTTP reads for current state, transactional dual writes for source-of-truth plus projection rows, durable event rows/domain events for after-commit work, and scoped WebSocket subscriptions to keep already-mounted UI surfaces fresh.

```text
user action
  -> HTTP command
  -> request/auth/entity permission checks
  -> source-of-truth write
  -> projection table write in the same transaction when applicable
  -> domain event and/or event row append
  -> commit
  -> response returns useful updated data to the actor
  -> async workers publish live updates and notifications
  -> frontend applies deltas or bounded refetches
```

Realtime is not the source of truth. It is the delivery and freshness layer after the database commit.

## HTTP Reads and Snapshots

The frontend should load bounded surface snapshots or bounded projection reads, not whole-company state.

Examples:

- Logic Gate Arena loads the selected Logic Gate surface and its Kanban-backed work state.
- Kanban loads one board, usually `logic-gate:{logicGateID}`.
- Home RACIO loads the current user's RACIO projection rows.
- Node editor loads the selected node's editor projection/content snapshot.
- Logic Gate editor loads the selected logic gate's editor projection/content snapshot.
- Company Explorer, Node Map, and Logic Gate Map load their scoped workspace snapshots/graphs.

The read gives the frontend a current state and, for projection-backed surfaces, a sequence/cursor. The frontend then subscribes to the matching WebSocket scope with `after_sequence` where available.

## Snapshot and Cursor Rule

A projection-backed surface should follow this pattern:

```text
1. GET bounded snapshot/projection.
2. Store returned sequence/cursor.
3. Subscribe to matching WebSocket scope with after_sequence.
4. Apply replayed deltas when safe.
5. Refetch only that bounded scope on gap, unknown delta, rejected subscription, permission revocation, or snapshot.refetch.
```

This prevents the race where a mutation commits between the GET and the WebSocket subscription.

```text
GET starts at sequence 10
mutation commits sequence 11
GET returns old sequence 10
subscribe with after_sequence=10
backend either replays 11 or tells frontend to refetch
```

## Source Tables, Projection Tables, and Dual Writes

The source-of-truth tables own durable business state. Projection tables are read-optimized copies used to make hot UI surfaces fast and bounded.

Important projection families:

- `kanban_board_projection`: board/card rows for Kanban and Logic Gate work boards.
- `racio_matrix_projection`: user-shaped RACIO matrix rows.
- editor projection rows: text/information projection for node and logic-gate editors.
- workspace snapshots/read versions: bounded workspace surfaces such as maps and explorer.
- notification rows: durable user-facing notifications.

Dual write means a mutation writes source state and relevant projection rows in the same transaction.

Examples:

- Updating a node title writes `nodes`, then updates any Kanban/RACIO projection rows that display that title.
- Moving a node between Logic Gates writes assignment/source state, then updates Kanban and RACIO projections.
- Changing Logic Gate RACI writes RACI source rows, then updates RACIO projection rows for affected users.
- Editing node or logic-gate text writes editor/source state, then appends editor projection delta event rows.

This is the rule:

```text
if a UI surface needs the value live and bounded, the mutation should update the projection before commit
```

The frontend should not need to reconstruct a major projection from a vague event. It should receive either a projection delta or a signal to refetch a bounded projection.

## Domain Events vs Event Rows

There are two related after-commit concepts. They are not the same thing.

### Domain Events

Domain events represent business changes, such as:

- `node_created`
- `node_updated`
- `logic_gate_updated`
- `logic_gate_raci_updated`
- `work_item.logic_gate_assignment_saved`
- `company_explorer_folder_item_assigned`

Domain events feed broad workspace freshness and notification projection.

They are used for:

- `workspace:user:{userID}` and related workspace-domain streams.
- notification projection and catchup.
- read-version invalidation for bounded workspace snapshots.

### Event Rows

Event rows are durable live-update rows for projection delta delivery. Current event row types include:

- `kanban.projection_delta`
- `racio.projection_delta`
- `project_management.projection_delta`
- `editor.projection_delta`
- `permission.changed`

Event rows are claimed by the event worker. The worker publishes projection deltas or permission/revalidation messages after commit.

```text
source + projection + event row commit
  -> event worker claims row
  -> event worker publishes projection.delta / permission.revoked / snapshot.refetch
  -> event row marked processed
```

This separation matters. Workspace freshness and notification projection can be driven by domain events. Kanban/RACIO/editor live deltas are driven by projection event rows.

## Request Path vs Live Path

The actor who made a change often receives updated data directly in the HTTP response. That keeps the local UI responsive even before any WebSocket message returns.

Other clients, other tabs, and sometimes other surfaces in the same app are updated through the live path.

```text
request path:
  command response includes updated node/card/projection rows where practical

live path:
  committed events/event rows are published to scopes
  subscribers apply delta or refetch
```

The request path must not be the only correctness path. If a second browser is open, it should be updated through the event row/domain event path.

## Physical WebSockets and Logical Subscriptions

A browser runtime reuses one physical realtime WebSocket connection per `apiBase + companyID`.

That does not mean the company has one shared WebSocket. Each browser tab/app runtime has its own connection. The backend authenticates that connection and checks every subscription request.

One frontend runtime can multiplex many logical subscriptions over the same WebSocket:

```text
one browser runtime
  one physical WebSocket for active company
    logical subscriptions:
      workspace:user:{userID}
      company_explorer:user:{userID}
      node_graph:user:{userID}
      logic_gate_graph:user:{userID}
      board:{boardID}
      racio:user:{userID}
      project_management:user:{userID}
      editor:node:{nodeID}
      editor:logic_gate:{logicGateID}
      notifications:user:{userID}
      communications:user:{userID}
```

When a component subscribes to a scope, the frontend adds a local handler. If this is the first local handler for that scope, the frontend sends a `subscribe` message to the backend. If another component subscribes to the same scope, the frontend should fan out locally rather than opening a duplicate backend subscription.

## Active WebSocket Scopes

### Workspace Freshness

```text
workspace:user:{userID}
```

Broad per-user workspace event stream. Used by AppLiveFreshnessBridge, Home, Kanban fallback freshness, RACIO fallback freshness, and other workspace-aware surfaces.

This stream does not replace projection deltas. It tells the app which caches/projections might now be stale.

### Company Explorer

```text
company_explorer:user:{userID}
```

Scoped workspace-domain updates for explorer tree/folder/item surfaces.

### Node Graph

```text
node_graph:user:{userID}
```

Scoped workspace-domain updates for the node relationship graph.

### Logic Gate Graph

```text
logic_gate_graph:user:{userID}
```

Scoped workspace-domain updates for the logic-gate relationship graph.

### Kanban

```text
board:{boardID}
```

Projection deltas for one board. Logic Gate boards use:

```text
board:logic-gate:{logicGateID}
```

Many users can subscribe to the same board scope if they are viewing the same board.

### RACIO Matrix

```text
racio:user:{userID}
```

RACIO is not subscribed by node ID, logic-gate ID, or board ID. It is subscribed by user ID because the RACIO matrix is a user-shaped projection.

The read endpoint loads rows for one target user and returns the current projection sequence:

```text
GET /v1/work-items/racio-matrix-projection?company_id=...&target_user_id=...
  -> rows for that user
  -> projection = racio_matrix
  -> projection_sequence for projection scope user:{userID}
```

The WebSocket subscription uses:

```text
racio:user:{userID}
```

The projection sequence scope internally uses:

```text
user:{userID}
```

When a source mutation affects RACIO, the backend diffs/writes RACIO projection rows and creates `racio.projection_delta` event rows grouped by affected user. The event row primary realtime scope is `racio:user:{userID}`. The event row sequence scope is `user:{userID}` for the `racio_matrix` projection.

That means:

```text
node title changes
  -> RACIO projection row display_title changes for every affected user
  -> event rows grouped by affected user
  -> user A gets projection.delta on racio:user:A
  -> user B gets projection.delta on racio:user:B only if their projection changed
```

The matrix does not need a separate subscription for every visible node. The user's RACIO projection is already the bounded user-specific surface.

### Project Management Timeline

```text
project_management:user:{userID}
```

Project management is a user-shaped timeline projection. The source table is `project_management_timeline_items`; the hot read table is `project_management_timeline_projection`. The projection duplicates node/logic-gate title, status, assignee, date, and timeline bar fields so the week view can read without rebuilding rows from multiple joins.

The read endpoint loads rows for one target user and returns the current projection sequence:

```text
GET /v1/project-management/timeline?company_id=...&target_user_id=...
  -> rows for that user
  -> projection = project_management_timeline
  -> projection_sequence for projection scope user:{userID}
```

The WebSocket subscription uses:

```text
project_management:user:{userID}
```

The projection sequence scope internally uses:

```text
user:{userID}
```

Timeline item creates, resizes, moves, and deletes mutate `project_management_timeline_items`, sync `project_management_timeline_projection`, then append `project_management.projection_delta` rows in the same transaction. Node or logic-gate source changes that affect projected fields resync the project management projection and append project-management deltas alongside other affected projection deltas.

### Editor

```text
editor:node:{nodeID}
editor:logic_gate:{logicGateID}
```

Used for editor projection deltas and editor collaboration/presence events.

### Notifications

```text
notifications:user:{userID}
```

Used for notification created/deleted messages and notification summary refresh.

### Communications

```text
communications:user:{userID}
```

Used for email, shared triage, folder, and message events.

## Frontend Local Fanout

The low-level realtime client owns the physical WebSocket and keeps local subscriptions by scope:

```text
subscriptions = {
  "workspace:user:123": Set([handlerA, handlerB]),
  "board:logic-gate:abc": Set([handlerC]),
  "racio:user:123": Set([handlerD])
}
```

When a backend message arrives, the client looks up the scope and calls every local handler registered for that scope.

Workspace subscriptions have extra cursor and gap logic. That cursor must be owned by the shared local stream, not by each React component independently.

Correct behavior:

```text
event 51 arrives for workspace:user:123
  shared workspace stream parses event once
  shared workspace stream derives reconciliation scopes once
  shared workspace stream advances cursor once
  shared workspace stream fans event/context to every local subscriber
```

Incorrect behavior:

```text
event 51 arrives for workspace:user:123
  subscriber A handles event and advances cursor to 51
  subscriber B sees cursor already at 51
  subscriber B drops the same event as stale
```

That incorrect behavior makes live updates appear random because one local consumer can starve another local consumer on the same workspace scope.

## Backend Fanout

The backend does not create one operating-system process per scope. It tracks connections and subscriptions in hub/registry structures.

The useful mental model is:

```text
scope -> set of connection IDs
connection -> set of scopes
```

At publish time:

```text
message has scope board:logic-gate:abc
  -> backend looks up connections subscribed to that exact scope
  -> backend sends payload only to those connections
```

If 20 users view the same board, one publish to `board:logic-gate:abc` fans out to those 20 connections. If 100 users view their own RACIO matrix, the backend typically has 100 different `racio:user:{userID}` scopes, and each user receives only their own user-shaped projection deltas.

The backend stress is connection count, subscription entry count, hot-scope message rate, payload size, cleanup correctness, worker lag, and replay/refetch pressure. The existence of many specific scopes is expected and is better than one broad company-wide firehose.

## Reconciliation Scopes

Workspace events are broad domain events. The frontend derives reconciliation scopes so it refreshes only affected surfaces.

Examples:

```text
node_updated with node.logic_gate_ids = [gate-1]
  affects:
    node_graph
    company_explorer item=node
    kanban_board boardID=logic-gate:gate-1
    racio_matrix

work_item.logic_gate_assignment_saved
  affects:
    work_item_assignment
    kanban_board
    racio_matrix
    node_graph

logic_gate_raci_updated
  affects:
    logic_gate_graph
    company_explorer item=logic_gate
    kanban_board boardID=logic-gate:{logicGateID}
    kanban_board_list
    racio_matrix
```

This is intentionally not a title-specific workaround. The general rule is:

```text
if a domain event changes an entity, derive every projection surface that can show that entity
```

## Permission Model

There are multiple permission gates. Do not collapse them into one check.

### Level 1: Request and Subscription Permission

This is the entry gate.

For HTTP reads/writes:

- The user must be authenticated.
- The user must have a role in the company.
- Request handlers call helpers such as `requireEntityView`, `requireEntityEdit`, `requireEntityAdmin`, or `requireKanbanLogicGateEffectiveAccess`.
- Admin/company-manager paths can bypass some entity-level checks where intended.
- Non-admin users are checked through effective access.

For WebSocket subscriptions:

- The connection is authenticated by the realtime ticket/session.
- The user must have access to the company.
- The requested scope must be supported.
- User scopes must match the actor user ID unless the actor can manage the company.
- Board scopes require effective edit access to the backing Logic Gate.
- Editor scopes require effective edit access to the node or Logic Gate.

Examples:

```text
subscribe board:logic-gate:G
  -> resolve G from board ID
  -> require effective edit access to Logic Gate G

subscribe editor:node:N
  -> require effective edit access to node N

subscribe racio:user:U
  -> U must be the actor user ID unless company manager/admin

subscribe workspace:user:U
  -> U must be the actor user ID unless company manager/admin
```

### Level 2: Projection Shaping and Revalidation

Subscribe-time access is necessary but not sufficient. The publish path still shapes or filters deltas before sending them.

Examples:

- RACIO deltas are grouped by user and sent only to `racio:user:{userID}`.
- Kanban deltas are filtered per target user; if the user lost access to the node or backing Logic Gate, the backend can send a delete-shaped delta instead of the full row.
- Permission changes trigger revalidation of live subscriptions.
- If access changed while a user was connected, the backend can send `permission.revoked` or `snapshot.refetch`.
- Notification recipients are computed from effective access and role-specific recipient logic, not from a raw event broadcast.

The safe model is:

```text
Level 1: may this request/subscription exist?
Level 2: is this particular row/message still visible to this recipient right now?
```

## Projection Delta Publish Path

Projection deltas are delivered by event rows and the event worker.

```text
mutation transaction
  -> source write
  -> projection write
  -> append event rows:
       kanban.projection_delta
       racio.projection_delta
       editor.projection_delta
       permission.changed
  -> commit

worker
  -> ClaimAvailableEventRows
  -> process event row
  -> publish projection.delta / permission.revoked / snapshot.refetch
  -> MarkEventRowProcessed
```

Kanban/RACIO request-path projection publishing intentionally does not bypass the durable event-row path. For these projections, request-path publishing filters them out, and the event worker is responsible for publishing durable live deltas.

The publish path allocates projection sequences per projection scope:

```text
kanban_board + board:{boardID}
racio_matrix + user:{userID}
editor + editor:{resource}
```

The frontend applies deltas only if the sequence is contiguous. On a gap or invalid envelope, it refetches the bounded projection.

## Workspace Event Publish Path

Domain events are broader than projection deltas. They tell the workspace which entities changed and allow surfaces to invalidate/refetch targeted caches.

The workspace stream flow is:

```text
mutation commits domain event
  -> workspace fanout resolves effective recipients/scopes
  -> backend publishes workspace.event to workspace/user or graph/explorer scopes
  -> frontend derives reconciliation scopes
  -> affected surfaces invalidate caches or bounded-refetch
```

Workspace events are useful for:

- keeping Company Explorer fresh
- refreshing Node Graph and Logic Gate Graph
- invalidating Home workspace panel caches
- triggering Kanban/RACIO fallback reconciliation
- notifying surfaces that a broader source entity changed

Workspace events are not a replacement for row-level projection deltas where a projection delta exists.

## Notification Projection vs Live UI Updates

Notifications are separate from live projection updates.

Live UI updates answer:

```text
what visible UI state changed for a currently mounted surface?
```

Notifications answer:

```text
which user should receive a durable notification item about a business event?
```

Notification flow:

```text
domain events commit
  -> notification projection service maps events to notification candidates
  -> effective access and role logic decide recipients
  -> notification rows are created
  -> notification.created is published to notifications:user:{recipientUserID}
```

There is also a notification domain-event catchup loop. If async projection fails or the server misses an immediate projection, catchup replays domain events by company and creates missing notifications.

Notification deletion is also live:

```text
notification marked deleted/read/deleted as appropriate
  -> notification.deleted published to notifications:user:{recipientUserID}
```

The important split:

- Projection event rows keep mounted views fresh.
- Workspace domain events keep snapshots/caches fresh.
- Notification projection creates durable notification records and publishes notification-specific realtime messages.

## Permission Changes

Permission changes are not just normal data edits. They can affect what a connected client is allowed to see.

The `permission.changed` event row path revalidates active subscriptions and projection visibility.

For nodes and logic gates, permission changes can cause:

- editor subscriptions to be revoked or refetched
- Kanban board subscriptions to be revalidated
- workspace subscriptions to receive `snapshot.refetch` or `permission.revoked`
- RACIO/Kanban projection permission deltas to be published

A frontend must treat `permission.revoked` as authoritative and clear/refetch the affected bounded surface.

## Frontend Responsibilities

A frontend surface should:

- load the smallest bounded snapshot/projection it needs
- remember the sequence/cursor from that read
- subscribe only to the scopes needed by the mounted surface
- unsubscribe on unmount or context change
- apply deltas only when they match company, scope, projection, and sequence rules
- refetch the bounded surface on gaps, invalid deltas, rejected subscriptions, refetch requests, and permission revocation
- avoid broad company-wide refreshes when a scoped refresh is enough

Examples:

```text
open Logic Gate Arena G
  -> load Logic Gate/Kanban snapshot for G
  -> subscribe board:logic-gate:G
  -> subscribe workspace:user:me for broader freshness if needed

open node editor N
  -> load editor snapshot for N
  -> subscribe editor:node:N

open RACIO R matrix
  -> load racio_matrix_projection rows for me
  -> subscribe racio:user:me
  -> use workspace:user:me as fallback reconciliation for node/logic-gate/assignment events
```

## Backend Responsibilities

The backend should:

- keep mutations transactional for source state, projection rows, and durable event rows/domain events
- keep projection sequence scopes stable and monotonic
- authorize every request and subscription
- shape projection deltas per recipient before publishing
- revalidate subscriptions on permission changes
- publish scoped messages only to matching subscribed connections
- maintain cleanup for disconnected sockets and unsubscribed scopes
- expose metrics for active connections, active subscriptions, published messages, rejected subscriptions, skipped publishes, event worker lag, and refetch/replay counts

## Scaling Notes

Scoped subscriptions create backend bookkeeping. That is expected.

Good:

```text
user opens one board -> subscribe to one board scope
user opens one editor -> subscribe to one editor scope
user opens RACIO -> subscribe to one user RACIO scope
```

Bad:

```text
user opens app -> subscribe to company:{companyID}:all_changes
frontend receives every change and filters locally
```

Specific scopes reduce unnecessary fanout. A hot board with 50 viewers sends board messages to those 50 viewers. A node editor with 2 viewers sends editor messages to those 2 viewers. RACIO sends user-shaped deltas to only the users whose projections changed.

The architecture scales if:

- scopes are exact and bounded
- disconnected connections are cleaned up
- frontend unmounts unsubscribe correctly
- event workers keep up
- horizontal backend instances can route publishes to the instances that own subscribed sockets
- metrics make hot scopes and worker lag visible

The architecture becomes risky if:

- subscriptions leak
- broad company-wide streams replace bounded scopes
- projection rows stop being updated transactionally
- publish paths skip recipient shaping
- frontend treats realtime as source of truth instead of using refetch on uncertainty

## Glossary

- Source of truth: normalized durable business tables such as nodes, logic gates, assignments, permissions, and editor content.
- Projection table: read-optimized table used by a bounded UI surface.
- Dual write: one transaction updates source of truth and relevant projection rows.
- Domain event: durable business event used for workspace freshness and notification projection.
- Event row: durable live-update row consumed by the event worker for projection deltas and permission changes.
- Scope: string identifying a realtime subscription target.
- Projection sequence: monotonic cursor for a projection scope.
- Reconciliation scope: frontend-derived affected surface such as `kanban_board` or `racio_matrix` from a workspace event.
- Fanout: sending one scoped message to every connection or local handler subscribed to that exact scope.

