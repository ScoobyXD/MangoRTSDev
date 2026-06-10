# V5 Backend Refactor Project Tracker

## Purpose

This document tracks the V5 backend architecture direction for MangoRTS.

The goal is to make normal reads faster, make live updates scalable, keep POST/PUT latency bounded, and separate live UI updates from notifications.

This refactor should not be treated as a full backend rewrite. The source-of-truth tables, projection tables, and most command write logic can stay. The main change is how reads, realtime delivery, events, subscriptions, permissions, and notifications are organized.

## Vocabulary

Use these words consistently.

```text
Go backend
  The Mango API/application server.

Postgres
  The database.

Snapshot
  A normal GET response that returns current state.

Scoped snapshot
  A GET response for one screen/resource, such as one node, one logic gate, one board, or one RACIO view.

Whole-company snapshot
  A broad GET response for initial app load, hard refresh, or recovery only.

WebSocket connection
  One live bidirectional connection from a browser tab/app session to the Go backend.

Subscription
  A resource scope that a WebSocket connection is actively subscribed to.

Delta
  A live UI update message, usually upsert/delete/patch for projection rows.

Event table
  A durable Postgres table of committed backend events waiting to be processed.

Event row
  One row in the event table. The row is both the durable fact that something happened and the work item for event processing.

Event worker
  Background worker that reads event rows after commit and performs live delivery, notification projection, retries, and cleanup.

Notification
  A short-lived user-facing alert row. Notifications are not source-of-truth and should not live forever.
```

Do not use "outbox" as a separate concept in implementation docs unless explaining the general pattern. For this project, the concrete name is:

```text
event table
event rows
event worker
```

## Current Problems

The current backend already has useful pieces, but they are mixed together:

- POST/PUT paths often do source-of-truth writes and projection writes in the same transaction.
- Kanban and RACIO projection changes are row-level precise, but not column-level precise.
- Some flows read projection rows before and after writes to produce live deltas.
- Live delivery currently has multiple lanes: workspace events, projection deltas, notification projection, derived events, and permission filtering.
- Some live publish work can happen too close to the request path.
- There is risk of broad fanout patterns, such as checking database permissions for each active user on every delta.
- Whole workspace snapshots are too broad for normal navigation and should be recovery/bootstrap tools, not the normal freshness mechanism.
- Notifications behave like a projection, but they need a clear delete/retention policy.

## Core Decisions

### 1. GETs Are Snapshots

Every regular GET should be understood as a snapshot.

Normal navigation should use scoped snapshots:

```text
GET node snapshot
GET logic gate snapshot
GET Kanban board snapshot
GET RACIO snapshot
GET company explorer snapshot
GET notification list
```

Whole-company snapshots should be used only for:

```text
first login / initial app bootstrap
manual refresh
recovery after missed sequence or corrupt local state
debug/admin cases where broad state is explicitly needed
```

Target rule:

```text
GET loads current state.
WebSocket deltas keep that state fresh.
```

### 2. WebSocket Is The Realtime Transport

Move toward one WebSocket connection:

```text
one browser tab
one logged-in Mango user
one company context
```

If the same user opens three browser tabs, that is normally three WebSocket connections.

The WebSocket should carry:

```text
subscription messages from browser to backend
projection deltas from backend to browser
notification messages from backend to browser
permission revoke/refetch messages from backend to browser
heartbeat/ping/pong
```

### 3. Subscriptions Represent Active UI Resources

Subscriptions tell the backend which UI resources a browser tab currently has open.

Example scopes:

```text
company:{company_id}
node:{node_id}
logic_gate:{logic_gate_id}
board:{board_id}
racio:user:{user_id}
notifications:user:{user_id}
company_explorer:{company_id}:{folder_kind}:{folder_id}
```

Subscription does not grant permission.

The backend must authorize a subscription before adding the connection to that scope.

For the current product permission model:

```text
normal user:
  edit access or no access

company_admin:
  edit access to everything in the company

dev_admin:
  edit access to everything
```

If view-only access returns later, the access names in this document must be updated, but the architecture still applies.

### 4. Live UI Updates And Notifications Are Separate Buckets

There are two separate output buckets after a write:

```text
Bucket 1: Live UI updates
  Send deltas to browser tabs actively subscribed to the affected resource scope.

Bucket 2: Notifications
  Create user-facing notification rows for users who should be alerted, even if they are not looking at the UI.
```

Do not mix these concepts.

Live UI deltas answer:

```text
Who currently has this resource open?
```

Notifications answer:

```text
Who should be alerted because this event matters to them?
```

### 5. No Broad Per-Delta Permission Fanout

Do not build the scalable path around this:

```text
for every active user in company:
  check DB permission
  decide whether to send delta
```

Preferred rule:

```text
authorize subscription once
route deltas by resource scope
handle permission changes with explicit revoke/refetch events
```

Normal resource change:

```text
publish to board:X
only WebSocket connections subscribed to board:X receive it
```

Permission change:

```text
find affected active subscriptions
revalidate those subscriptions
send permission.revoked / delete / snapshot.refetch
remove unauthorized subscriptions
```

Permission changes are rarer than normal resource updates, so that is where revalidation belongs.

### 6. Event Rows Are Created In The Original Transaction

Creating an event must not mean another frontend POST request.

Correct flow:

```text
Frontend
  sends one POST/PUT request

Go backend
  begins one DB transaction

Postgres
  writes source-of-truth rows
  writes projection rows
  inserts event row

Go backend
  commits
  returns response
```

The event row is one extra insert inside the same transaction.

Then, after commit:

```text
event worker
  reads event rows
  sends live UI deltas
  creates/deletes notifications
  marks event rows processed
```

The event worker should not create the original event. The event worker consumes the event row that already exists.

### 7. Event Rows Replace Direct Request Fanout

The event table is not extra work on top of all existing live publish work.

The point is to move work out of the POST/PUT request path.

Synchronous request path should do:

```text
Level 1 auth
Level 2 command permission check
source-of-truth write
projection write
event row insert
commit
return response
```

Asynchronous event worker should do:

```text
live WebSocket routing
notification recipient resolution
notification row writes/deletes
permission revoke/refetch messages
retry/replay bookkeeping
processed marker updates
```

Expected result:

```text
GETs:
  faster because they use scoped snapshots/projections

POST/PUTs:
  should stay similar or get faster if fanout/notification work moves async
  can get slower if we only add event rows and keep all old sync work

Live delivery:
  more reliable because committed events can be retried
```

## Target Event Table

The event table should be durable and processable.

Suggested shape:

```text
event_id
company_id
event_type
resource_type
resource_id
primary_scope
affected_scopes
actor_user_id
idempotency_key
sequence_scope
sequence
payload_json
created_timestamp
available_at
processing_started_at
processed_at
attempt_count
last_error
```

Important notes:

- `event_id` uniquely identifies the event row.
- `event_type` describes what happened.
- `affected_scopes` tells live routing what resource scopes may need deltas.
- `payload_json` should be compact. Do not store giant screen snapshots.
- `sequence_scope` and `sequence` should support ordered replay by scope.
- `processed_at` tells the worker whether the event row is done.
- Failed events should be retryable.

Event rows can represent:

```text
projection delta batch committed
node status changed
node assigned
node priority changed
node due date changed
logic gate RACIO assignment changed
permission changed
notification cleanup needed
```

Keep command/business meaning and UI delta payloads separate inside the event row payload where useful.

The frontend should mostly consume deltas and notification messages, not raw backend business events.

## Snapshot And Stream Contract

### Initial App Load

```text
1. User logs in.
2. Frontend opens WebSocket for company context.
3. Frontend GETs initial bootstrap/company snapshot.
4. Frontend sends subscription messages for open/default UI scopes.
```

Initial bootstrap may include broad state if needed.

### Normal Navigation

```text
1. User opens a resource screen.
2. Frontend GETs scoped snapshot for that screen.
3. Frontend subscribes to that resource scope over WebSocket.
4. Backend authorizes subscription.
5. Backend sends future deltas for that resource scope.
6. When user leaves the screen, frontend unsubscribes.
```

### Reconnect Or Gap

If the WebSocket reconnects or the client detects a sequence gap:

```text
1. Frontend resubscribes with last known sequence where possible.
2. Backend replays missed events if available.
3. If replay is not available or gap is too large, backend sends snapshot.refetch.
4. Frontend GETs scoped snapshot, not whole-company snapshot unless recovery requires it.
```

## WebSocket Message Types

Browser to backend:

```text
subscribe
unsubscribe
ping
ack, optional
```

Backend to browser:

```text
ready
subscription.accepted
subscription.rejected
projection.delta
notification.created
notification.deleted
permission.revoked
snapshot.refetch
ping
pong
error
```

Example subscription:

```json
{
  "type": "subscribe",
  "scope": "board:abc",
  "after_sequence": 123
}
```

Example delta:

```json
{
  "type": "projection.delta",
  "scope": "board:abc",
  "sequence": 124,
  "deltas": [
    {
      "operation": "upsert",
      "row_key": { "card_id": "card-1" },
      "row": {}
    }
  ]
}
```

Example permission revoke:

```json
{
  "type": "permission.revoked",
  "scope": "node:node-1",
  "resource_type": "node",
  "resource_id": "node-1"
}
```

## Notification Rules

Notifications are short-lived user-facing projection rows.

Only create notifications for these event types:

```text
node in logic gate changed status
node assigned to user
node priority changed
node due date changed
user assigned to logic gate RACIO
```

Notification flow:

```text
event worker reads event row
worker checks whether event_type is notification-worthy
worker resolves recipient users from assignment/RACIO rules
worker writes notification rows
worker pushes notification.created to connected user notification scopes
```

Notification rows should be deleted when:

```text
user clicks clear
user clicks X/close
user performs an action that should dismiss that notification
retention cleanup expires old rows
```

Notifications should not be kept forever unless a separate audit/history table is explicitly created.

Do not use notifications as permanent history.

## Subscription State

Start simple:

```text
in-memory subscription registry per Go backend instance
```

If/when multiple Go backend instances need shared routing, add a lightweight subscription projection table or external realtime registry.

Possible table:

```text
realtime_subscriptions
  connection_id
  company_id
  user_id
  scope
  created_timestamp
  last_seen_timestamp
  backend_instance_id
```

This table should not be treated as product source-of-truth. It is operational state for routing/revocation.

For very large scale, active connection/subscription state may belong in a realtime gateway layer or Redis/Valkey rather than Postgres.

## Permission Revocation

Permission changes must be first-class events.

When access changes:

```text
write permission/source change
write affected projection changes
write permission changed event row
commit
```

Event worker:

```text
find affected active subscriptions
revalidate only those affected subscriptions
send permission.revoked / delete / snapshot.refetch
remove subscriptions that are no longer authorized
```

This is where permission rechecks belong.

Normal deltas should not repeatedly DB-check every active subscriber.

## Phases

Keep the project in a few large phases.

### Phase 1: Snapshot And WebSocket Contract

Goal: implement the first real WebSocket/subscription contract while keeping most current write internals and keeping existing SSE streams working during migration.

This phase is not complete if it only changes docs, adds frontend flags, or disables existing streams. Phase 1 must include backend WebSocket code, frontend WebSocket usage, subscription authorization, at least one migrated live-update vertical slice, and tests.

Recommended first vertical slice:

```text
Kanban board projection deltas
```

Reason: Kanban already has projection delta logic and scoped board state. Moving this one surface first proves the contract without trying to migrate every live path at once.

Objectives:

Backend:

- Add a WebSocket endpoint in the Go backend.
- Authenticate the WebSocket handshake using the existing Level 1 auth path.
- Resolve the Mango user and company context for the connection.
- Define typed WebSocket message envelopes for:
  - `ready`
  - `subscribe`
  - `unsubscribe`
  - `subscription.accepted`
  - `subscription.rejected`
  - `projection.delta`
  - `snapshot.refetch`
  - `ping`
  - `pong`
  - `error`
- Add an in-memory subscription registry keyed by company and scope.
- Track both directions:
  - connection to subscribed scopes
  - scope to subscribed connections
- Authorize each subscription with existing Level 2 resource permission logic before adding it to the registry.
- Remove all subscriptions for a connection when the WebSocket closes.
- Verify or add the scoped snapshot endpoint for the chosen vertical slice, including the latest projection sequence/cursor in the response.
- Route the chosen vertical slice's deltas only to connections subscribed to the affected scope.
- Include `scope` and `sequence` on live delta messages.
- If a client cannot be brought current by sequence, send `snapshot.refetch` for the scoped resource.

Frontend:

- Add a WebSocket client that opens one connection per browser tab/app session/company context.
- Keep the connection available after login/app bootstrap.
- Add subscribe/unsubscribe calls for the chosen vertical slice.
- For the chosen vertical slice, load the current state with a scoped GET snapshot, then subscribe over WebSocket.
- Store the latest sequence/cursor from the scoped snapshot for reconnect and gap handling.
- Apply `projection.delta` messages to the existing local cache/UI for that slice.
- On reconnect, rejected subscription, sequence gap, or `snapshot.refetch`, reload the scoped snapshot, not a whole-company snapshot unless the backend explicitly requires broad recovery.
- Leave old SSE paths in place for surfaces that have not moved yet.

Tests:

- Backend test: unauthenticated WebSocket handshake is rejected.
- Backend test: authorized WebSocket handshake sends `ready`.
- Backend test: unauthorized subscription sends `subscription.rejected` and is not stored.
- Backend test: authorized subscription sends `subscription.accepted` and is stored.
- Backend test: closing a connection removes its subscriptions.
- Backend test: a delta for `board:A` is sent only to connections subscribed to `board:A`, not `board:B`.
- Frontend/unit test: WebSocket message parsing handles accepted, rejected, delta, refetch, and error messages.
- Frontend/unit test: the chosen vertical slice applies an upsert/delete delta without a full refresh.

Do not:

- Replace all projection writes yet.
- Build a large distributed realtime gateway yet.
- Add broad company-wide live streams for every user by default.
- Add the event table yet. That is Phase 2.
- Move notifications yet. That is Phase 2 or Phase 3.
- Disable existing SSE/workspace streams before the replacement WebSocket path for that exact surface is implemented and tested.
- Add flags whose main effect is suppressing current live updates without providing the new WebSocket subscription path.
- Mark Phase 1 complete because the architecture document changed.

Acceptance gate:

```text
Phase 1 is done only when:
  backend WebSocket endpoint exists
  backend subscription registry exists
  backend subscription authorization exists
  frontend opens one WebSocket per tab/session/company
  one live surface uses WebSocket subscriptions end to end
  old SSE still works for unmigrated surfaces
  tests cover the subscription lifecycle and routed delta delivery
  no local logs, credential errors, or scratch files are committed
```

### Phase 2: Event Table And Async Event Worker

Goal: move live delivery and notification work out of POST/PUT request paths.

Objectives:

- Add the event table.
- Insert event rows in the same DB transaction as source/projection writes.
- Treat event rows as the durable work item for live delivery and notifications.
- Add an event worker.
- Worker reads unprocessed event rows.
- Worker publishes projection deltas to WebSocket resource scopes.
- Worker creates/deletes notifications for notification-worthy events.
- Worker marks events processed and retries failures.
- Move current direct request-time live publish logic behind event rows.
- Keep source-of-truth and projection writes in the request transaction for now.
- Keep before/after projection diffing only where needed, but stop doing live fanout during the request.
- Add permission-change event processing for subscription revocation/refetch.

Do not:

- Create a separate event table and outbox table.
- Make the frontend send a second POST to create events.
- Make POST/PUT wait for WebSocket publish or notification processing.

### Phase 3: Notification And Subscription Scale Hardening

Goal: make notification lifecycle and resource-scope fanout scale cleanly.

Objectives:

- Finalize notification-worthy event rules.
- Delete notifications when users clear/close them.
- Add retention cleanup for old notifications.
- Ensure notification reads query only recipient user rows.
- Add `notification.deleted` live messages if needed.
- Add active subscription revocation for permission loss.
- Decide whether subscription state remains in memory, moves to a `realtime_subscriptions` projection table, or moves to Redis/Valkey/realtime gateway.
- Stop per-delta per-user permission fanout.
- Route normal live UI deltas by resource scope.
- Route notification messages by user notification scope.
- Add metrics:
  - active WebSocket connections
  - active subscriptions by scope type
  - event table lag
  - event worker retry count
  - delta publish latency
  - notification creation latency
  - scoped snapshot latency
  - sequence gap/refetch rate

Do not:

- Keep notifications forever.
- Use notifications as audit history.
- Broadcast raw projection rows broadly and rely on client filtering.

## Target End State

```text
Frontend
  GET scoped snapshot
  open one WebSocket per tab/session/company
  subscribe to active UI resource scopes
  apply projection deltas
  show notifications
  refetch scoped snapshot on gaps/revokes

Go backend request path
  validate Level 1 auth
  check Level 2 command permission
  write source-of-truth rows
  write projection rows
  insert event row
  commit
  return response

Event worker
  read committed event rows
  route live UI deltas by resource scope
  create/delete notification rows
  send notification messages by user scope
  revalidate affected subscriptions on permission changes
  mark events processed

Postgres
  source-of-truth tables
  projection tables
  event table
  short-lived notifications table
```

The intended performance result:

```text
GETs:
  faster because they are scoped and projection-backed

POST/PUTs:
  similar or faster because live fanout and notification work move async
  only one small event row insert is added to the synchronous path

Live updates:
  more reliable and scalable through event worker plus WebSocket resource scopes

Notifications:
  explicit, short-lived, user-targeted projection rows
```
