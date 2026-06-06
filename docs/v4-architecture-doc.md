# V4 Architecture Doc

Status: current architecture notes for realtime, snapshots, projections, and scoped subscriptions.

This document records the working mental model for MangoRTS realtime architecture as of V4. It should be kept practical: describe how the app actually behaves, what guarantees the backend/frontend are expected to preserve, and which words mean specific things.

## Core Model

MangoRTS uses normal HTTP reads for current state and WebSocket subscriptions for changes after that state.

```text
GET snapshot = current known state for a bounded surface

WebSocket subscribe = tell this frontend about changes after that snapshot

event table / event rows = durable committed change records

event worker = turns committed event rows into scoped realtime messages

realtime hub = sends each scoped message to connected clients subscribed to that scope

frontend subscriber = applies a delta or refetches the affected snapshot/projection
```

The frontend should not routinely load whole-company state on hot paths. It should load bounded snapshots or projection reads for the surface being shown, then subscribe to the smallest realtime scope that can keep that surface fresh.

## Physical Connections vs Logical Subscriptions

A browser runtime reuses one physical realtime WebSocket connection per `apiBase + companyID`.

That does not mean a company has one shared WebSocket across all users. Each browser tab/app runtime has its own connection. The backend authenticates that connection, knows the active company, and checks every subscription request.

The single browser WebSocket carries many logical subscriptions:

```text
one frontend runtime
  one physical WebSocket for active company
    many logical subscriptions:
      workspace:user:{userID}
      board:{boardID}
      racio:user:{userID}
      editor:node:{nodeID}
      editor:logic_gate:{logicGateID}
      notifications:user:{userID}
      communications:user:{userID}
```

When the first frontend consumer subscribes to a scope, the browser sends a `subscribe` message to the backend. If another local component subscribes to the same scope, the frontend should not create another backend subscription. It should attach another local handler to the same local subscription.

## Active WebSocket Scopes

### Kanban

Scope:

```text
board:{boardID}
```

Used for Kanban projection deltas for a board. Logic Gate boards use `boardID = logic-gate:{logicGateID}`.

Typical consumers:

- Kanban board view
- Logic Gate Arena Kanban surface

Typical messages:

- `projection.delta`
- `snapshot.refetch`
- `permission.revoked`

### RACIO Matrix

Scope:

```text
racio:user:{userID}
```

Used for RACIO matrix projection deltas for one user. This scope is user-specific because RACIO visibility and rows are user-shaped.

Typical consumers:

- Home R/A/C/I/O matrix views

Typical messages:

- `projection.delta`
- `snapshot.refetch`
- `permission.revoked`

### Editor

Scopes:

```text
editor:node:{nodeID}
editor:logic_gate:{logicGateID}
```

Used for editor projection deltas and editor collaboration events.

Typical consumers:

- Node editor
- Logic Gate editor

Typical messages:

- `projection.delta`
- editor collaboration workspace event payloads
- `snapshot.refetch`
- `permission.revoked`

### Workspace Freshness

Scope:

```text
workspace:user:{userID}
```

Used as the broad user-visible workspace event stream. This is not a replacement for bounded projections. It is the shared freshness/reconciliation layer that tells the frontend which local caches or projections might be stale.

Typical consumers:

- App live freshness bridge
- Home workspace panel
- Kanban fallback freshness
- RACIO matrix fallback freshness
- Editor collaboration in selected contexts

Typical event types include:

- `node_created`
- `node_updated`
- `node_deleted`
- `logic_gate_created`
- `logic_gate_updated`
- `logic_gate_deleted`
- `logic_gate_raci_updated`
- `work_item.logic_gate_assignment_saved`
- `work_item.logic_gate_assignment_moved`
- `work_item.logic_gate_assignment_removed`
- company explorer folder/item changes

### Company Explorer

Scope:

```text
company_explorer:user:{userID}
```

Used for Company Explorer tree, folder, and folder-item freshness.

### Node Graph

Scope:

```text
node_graph:user:{userID}
```

Used for node relationship graph freshness.

### Logic Gate Graph

Scope:

```text
logic_gate_graph:user:{userID}
```

Used for Logic Gate relationship graph freshness.

### Notifications

Scope:

```text
notifications:user:{userID}
```

Used for notification create/delete events and notification summary refresh.

### Communications

Scope:

```text
communications:user:{userID}
```

Used for email, shared triage, folder, and message events.

## Snapshot and Cursor Rule

A scoped snapshot or projection read should return its current sequence/cursor when that surface is backed by ordered realtime deltas.

The frontend should:

1. Load the bounded snapshot/projection.
2. Store the returned sequence/cursor.
3. Subscribe to the matching WebSocket scope with `after_sequence`.
4. Apply replayed deltas when possible.
5. Refetch the bounded scope when it receives `snapshot.refetch`, detects a sequence gap, sees an unknown delta shape, or loses permission.

This prevents the classic race:

```text
GET snapshot starts at time A
change commits at time B
GET snapshot returns state from A
WebSocket subscribes at time C
change from B is missed
```

The `after_sequence` cursor tells the backend what the frontend has already seen.

## Source, Projection, Event Rows

Mutations write source-of-truth tables first, then update projection tables in the same transaction when applicable.

Examples:

- Node title updates write `nodes`, then update Kanban/RACIO projections for affected rows.
- Work item assignment moves update assignment/source state, then update Kanban/RACIO projections.
- Editor text updates write editor/source state, then write editor projection rows.

After commit, durable event rows are processed and published to websocket scopes.

This is the intended architecture:

```text
source write + projection write + event row write in one transaction
  commit
    event worker publishes scoped realtime message
      frontend applies delta or refetches bounded scope
```

Realtime should not be the source of truth. It is the delivery mechanism that keeps already-loaded UI surfaces fresh.

## Reconciliation Scopes

Workspace events are broad domain events. The frontend derives reconciliation scopes from them so it can refresh only affected surfaces.

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

This is intentionally not title-specific, Kanban-specific, or RACIO-specific workaround logic. The general rule is:

```text
if a domain event changes an entity, derive every projection surface that can show that entity
```

## Frontend Local Fanout

The low-level realtime client owns the physical WebSocket and keeps local subscriptions by scope:

```text
subscriptions = {
  "workspace:user:123": Set([handlerA, handlerB]),
  "board:logic-gate:abc": Set([handlerC]),
  "racio:user:123": Set([handlerD])
}
```

When a backend message arrives, the realtime client looks up the message scope and calls every local handler for that scope.

Workspace subscriptions have extra cursor/gap logic. That logic must be owned by the shared local stream, not by each React component independently.

Correct behavior:

```text
event 51 arrives for workspace:user:123
  shared workspace stream parses event once
  shared workspace stream derives scopes once
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

The incorrect pattern makes live updates appear random because one local consumer can accidentally starve another local consumer on the same scope.

## Backend Fanout Model

The backend does not create one operating-system process per scope. It has realtime server/hub structures that track connected clients and their subscribed scopes.

At publish time, the backend routes a scoped message to connections subscribed to that exact scope.

For example:

```text
20 users view the same board
  20 browser connections subscribe to board:logic-gate:abc
  one Kanban projection event publishes to board:logic-gate:abc
  realtime hub sends that message to those 20 connections
```

For RACIO:

```text
100 users view their own R matrix
  100 browser connections subscribe to 100 user-specific scopes:
    racio:user:u1
    racio:user:u2
    ...
  event rows are generated only for users whose RACIO projections changed
  realtime hub sends each message to the matching user scope
```

## Permission Model

Realtime has multiple permission boundaries:

1. Connection authentication: the websocket ticket/session proves the user.
2. Company authorization: the user must be allowed into the active company.
3. Scope authorization: the requested subscription scope must be allowed for that user.
4. Projection shaping: user-specific projections and fanout recipient logic should ensure messages only contain data visible to that user.
5. Permission changes: if access changes while connected, the backend/frontend must revoke, delete, or refetch affected data.

Subscription permission is necessary, but it is not the only data-protection layer. The safer model is:

```text
subscribe-time access check + permission-shaped messages + revoke/refetch on access changes
```

## Scaling Notes

Scoped subscriptions do create backend bookkeeping. That is expected.

The important property is that subscriptions are bounded and exact:

- A user viewing one board subscribes to that one board, not every board in the company.
- A user viewing one node editor subscribes to that one node, not every node.
- RACIO is per user, not global.
- Workspace freshness is per user and scoped by effective visibility.

The backend must be designed around efficient maps from scope to connections:

```text
scope -> set of connection IDs
connection -> set of scopes
```

This supports:

- O(1)-ish add/remove for subscribe/unsubscribe.
- Efficient publish to only interested connections.
- Cleanup when a websocket disconnects.
- Metrics by scope type.

The risk to avoid is not "many scopes exist." The risk is unbounded broad subscriptions such as:

```text
company:{companyID}:all_changes
```

That would force every active client to receive too much traffic. V4 should prefer specific scopes and bounded refetches.

## Operational Expectations

Realtime should expose metrics for:

- active websocket connections
- active subscriptions by scope type
- messages published by scope type
- publish skipped because no subscribers
- subscription rejected by scope type/reason
- replay/refetch counts
- event worker lag
- projection sequence gaps

The architecture can handle many subscriptions if cleanup, exact routing, and metrics stay healthy. It becomes risky if subscriptions leak after UI unmount, if broad scopes replace bounded scopes, or if event workers fall behind.

