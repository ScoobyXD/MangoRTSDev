Last updated: 2026-07-12

# MangoRTS Current Data And Realtime Architecture

Status: current architecture contract. This document supersedes the former broad projection-delta and workspace-fan-out design.

## Sources Of Truth

Authenticated HTTP commands are the only write path for product data. Source tables and projection/read tables are committed before a successful response is returned. The initiating browser uses that committed response, existing local command-result events, and its mounted caches to update immediately.

Canonical HTTP reads remain the recovery and activation path. Projection/read tables, `workspace_read_versions`, conditional ETags, and independently required `domain_events` consumers remain part of the data architecture. Realtime messages are compact wake-ups; they are never the durable source of truth.

## Product Realtime Contract

MangoRTS has exactly three product realtime scope families:

| Scope | Mounted consumer | Message purpose | Canonical recovery |
| --- | --- | --- | --- |
| `notifications:user:{user_id}` | App-lifetime notification coordinator | Notification created, deleted, or cleared | Reload notification summary; reload Updates once only while Updates is open |
| `chat:node:{node_id}` | Open Node chat | Durable Node chat message created or deleted | Reload the Node's canonical durable chat state on open/reconnect when needed |
| `board:{board_id}` | Mounted Logic Gate Kanban board | `kanban.changed` after a committed card/column-visible change | Coalesce one canonical Logic Gate work/board read |

The frontend reuses one physical WebSocket per API/company and multiplexes these logical subscriptions. The backend retains ticket validation, connection registry, per-scope authorization, subscribe/unsubscribe, ping/pong, reconnect, and error handling. Delivery is process-local in the current development configuration; a future broker may implement the same publisher boundary without changing the product scopes.

## Authorization

- A notification subscription must match the authenticated user.
- A Node chat subscription requires the existing effective Node access contract. Chat create/delete HTTP commands retain their own write authorization.
- A board subscription requires effective access to the board's owning Logic Gate.
- HTTP authorization remains authoritative. There is no generic permission-change socket message.

## Immediate And Non-Live Freshness

The user who performs a mutation sees the committed response immediately in concrete mounted surfaces. Cross-user live delivery exists only for the three scopes above.

Company Explorer, Home workspace/GVIC/communications, My Work, maps and graphs, Project Management, Logic Gate Arena titles, generic editor/document state, mail, permissions, and broad Kanban workspace state do not subscribe to backend realtime. They load canonical data on open/navigation/manual refresh, and temporary cross-user staleness until then is accepted.

Document autosave remains durable HTTP behavior. The former whole-document collaboration relay was not safe coediting and has been removed. A future Huddle may introduce an explicit CRDT/OT session, presence, ordering, and persistence design; no current compatibility path is retained for it.

## Notifications

The immediate request-path notification projector creates durable notification rows and then publishes a user-targeted wake-up. One frontend coordinator owns the notification subscription and summary reconciliation. The Updates view registers only while open.

There is no notification domain-event checkpoint, periodic company scan, or replay/catch-up worker. A failed immediate projection is logged; canonical notification rows and reads remain the product source.

## Node Chat

Node chat continues to use its existing durable editor information/projection storage. After persistence, create/delete handlers publish a compact message only to `chat:node:{node_id}`. Project chat is not a retained realtime surface. Chat publication never emits workspace, board, Explorer, graph, GVIC, or document messages.

## Mounted Logic Gate Kanban

Committed Node-card title changes, card add/remove/move/reorder, column changes, and other card-visible mutations publish `kanban.changed` to each affected mounted `board:{board_id}` scope. The initiating user applies the HTTP result locally; another mounted viewer coalesces the hint into one canonical board read. There is no projection sequence, replay log, workspace echo, or permanent browser-replication queue.

## Deleted Architecture

The following are intentionally absent and must not be reintroduced without a new explicit product contract:

- `event_rows`, its producer helpers, event worker, leases, retries, affected scopes, projection sequences, and queue schema;
- generic workspace browser fan-out, effective-user expansion, PostgreSQL workspace notifications/listener, replay, and snapshot-refetch messages;
- Company Explorer, graph, GVIC/My Work, Project Management, communications/mail, permission, generic editor, and document-collaboration scopes;
- notification checkpoint and catch-up/replay machinery;
- frontend global workspace/projection/communications freshness bridges and server-event CustomEvent rebroadcasts.

Future realtime features must define one narrow resource or user scope, explicit subscription authorization, a compact post-commit message, and a canonical HTTP fallback. They must not revive generic workspace replication.