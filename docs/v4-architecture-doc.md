Last updated: 2026-07-13

# MangoRTS Current Data And Realtime Architecture

Status: current architecture contract. This document supersedes the former broad projection-delta and workspace-fan-out design.

## Sources Of Truth

Authenticated HTTP commands are the only write path for product data. Source tables and projection/read tables are committed before a successful response is returned. The initiating browser uses that committed response, existing local command-result events, and its mounted caches to update immediately.

Canonical HTTP reads remain the recovery and activation path. Projection/read tables, `workspace_read_versions`, conditional ETags, and independently required `domain_events` consumers remain part of the data architecture. Realtime messages are compact wake-ups; they are never the durable source of truth.

## Product Realtime Contract

MangoRTS has exactly three product realtime scope families:

| Scope | Mounted consumer | Message purpose | Canonical recovery |
| --- | --- | --- | --- |
| `notifications:user:{user_id}` | App-lifetime `NotificationRealtimeBridge` | Notification created, deleted, or cleared | On first subscription acceptance and every reconnect acceptance, coalesce one canonical notification-summary refresh; queue one Updates feed refresh behind an active load only while Updates is open |
| `chat:node:{node_id}` | Open Node chat | Durable Node chat message created or deleted | On first subscription acceptance and every reconnect acceptance, run a single-flight canonical durable Node-chat refresh with at most one queued final refresh |
| `board:{board_id}` | Mounted Logic Gate Kanban board | `kanban.changed` after a committed card/column-visible change | On first subscription acceptance, reconnect acceptance, or a compact hint, run a single-flight canonical Logic Gate work/board read with at most one queued final refresh |

The frontend reuses one physical WebSocket per API/company and multiplexes these logical subscriptions. The backend retains ticket validation, connection registry, per-scope authorization, subscribe/unsubscribe, ping/pong, reconnect, and error handling. Delivery is process-local. The committed dev and prod Terraform roots each default `backend_desired_count` to 2, and the target groups configure no stickiness; without a broker, a mutation HTTP request and the recipient's WebSocket may land on different tasks, so cross-user live delivery is nondeterministic whenever two tasks run.

The shared client tracks acceptance per live scope. A later mounted handler joining an already accepted scope receives immediate local acceptance so it performs its own load-to-subscribe reconciliation; acceptance is cleared on connection loss, rejection, or removal of the last local handler.

Backend WebSocket writes have a bounded deadline. A failed write closes and removes the dead connection immediately, and operational metrics distinguish delivery failures from publishes with no local subscribers.

## Authorization

- A notification subscription must match the authenticated user.
- A Node chat subscription requires effective Edit access to the Node. Chat create/delete HTTP commands retain their own write authorization.
- A board subscription requires effective access to the board's owning Logic Gate.
- HTTP authorization remains authoritative. There is no generic permission-change socket message.

## Immediate And Non-Live Freshness

The user who performs a mutation sees the committed response immediately in concrete mounted surfaces. After every successful Node or Logic Gate rename entry point, one concrete same-window committed-title event patches concurrently mounted Company Explorer, Kanban, Editor, Node Map, Logic Gate Map, Home/My Work, Updates current Node/Logic Gate row, selected-panel, and open-action labels, AppLayout dock tabs and popup-parent labels, visible Node/Logic Gate sidebar-pin names, AppTimeline current/history labels, and Project Management timeline/workspace/project-detail caches as applicable. Logic Gate titles also update Updates saved Logic Gate grouping headers and sort values, while stored notification title/body prose stays historical. Passive convergence changes labels only: it does not write pin rows, change dock-tab recency, or create a cross-user/cross-tab server plane.

Title convergence updates committed labels without replacing dirty, debounced, or in-flight editor text. An event for an actively edited Editor or map `contentEditable` title is deferred until title editing ends, preserving the live DOM draft and caret. Cross-user live delivery is attempted only for the three scopes above and remains subject to the process-local limitation.

The shared committed-title registry retains the latest normalized Node or Logic Gate title per company/type/resource together with a monotonic version. Wired async title-bearing reads capture that version before awaiting and fold only newer local commits into the response before storing it. At publication time, the app-lifetime committed-title cache reconciliation coordinator also synchronously patches or invalidates the affected communications workspace slice, project-relationship cache, Kanban board/content cache, My Work matrix cache, entity record store, workspace snapshot, and Node or Logic Gate graph cache. Request-start version folding and targeted cache generation/invalidation guards prevent a request begun before the commit from repopulating an older title. This covers cache hits and remounts while preserving the rule that a genuine request begun after the commit remains authoritative canonical truth rather than being permanently masked. Request-start overlays remain wired across Home, Company Explorer/GVIC/search, Editor entity details, NodeWorkspace assigned Logic Gate/options/search, Kanban, maps, My Work, and Project Management. Persisted sidebar-pin names are the deliberate denormalized exception and fold all latest same-window commits after fetch/create/reorder/rollback so stale stored pin names cannot restore an old visible label. These mechanisms complement, rather than replace, the active Editor/map title buffers above.

Company Explorer, Home workspace/GVIC/communications, My Work, maps and graphs, Project Management, Logic Gate Arena titles, generic editor/document state, mail, permissions, and broad Kanban workspace state do not subscribe to backend realtime. They load canonical data on open/navigation/manual refresh, and temporary cross-user staleness until then is accepted.

Document autosave remains durable HTTP behavior. The former whole-document collaboration relay was not safe coediting and has been removed. A future Huddle may introduce an explicit CRDT/OT session, presence, ordering, and persistence design; no current compatibility path is retained for it.

## Notifications

The immediate request-path notification projector creates durable notification rows and then publishes a user-targeted wake-up. `NotificationRealtimeBridge` owns the notification subscription and summary reconciliation. First subscription acceptance, reconnect acceptance, and notification hints share one coalescer. A pending local delete/clear marker records HTTP and socket observation separately. The first successful observer emits the one canonical update and the matching second observer emits nothing; after both observers claim, the marker is removed so a distinct later clear is not suppressed. A socket-first commit uses the canonical non-local source, so a lost/rejected HTTP response still reconciles mounted Updates while duplicate socket frames remain suppressed until the pending marker expires. An HTTP failure with no socket observation emits no update and releases its marker. The Updates view registers only while open, queues one final refresh behind an active load, and performs no feed request while closed.

There is no notification domain-event checkpoint, periodic company scan, or replay/catch-up worker. A failed immediate projection is logged; canonical notification rows and reads remain the product source.

## Node Chat

Node chat continues to use its existing durable editor information/projection storage. After persistence, create/delete handlers publish a compact message only to `chat:node:{node_id}`. The mounted chat uses one active refresh plus one queued-final bit for first subscription acceptance, reconnect acceptance, and hints, closing the load-to-subscribe race without overlapping or invalidating an in-flight canonical read. Project chat is not a retained realtime surface. Chat publication never emits workspace, board, Explorer, graph, GVIC, or document messages.

## Mounted Logic Gate Kanban

Committed Node-card title changes, card add/remove/move/reorder, column changes, and other card-visible mutations publish `kanban.changed` to each affected mounted `board:{board_id}` scope. The initiating user applies the HTTP result locally; another mounted viewer routes first subscription acceptance, reconnect acceptance, and compact hints through one active refresh plus one queued-final bit, so an in-flight board read is neither overlapped nor aborted/restarted. Ordinary `node_updated` publication does not query Kanban projection rows when there are no relevant local board subscribers. There is no projection sequence, replay log, workspace echo, or permanent browser-replication queue.

## Deleted Architecture

The following are intentionally absent and must not be reintroduced without a new explicit product contract:

- `event_rows`, its producer helpers, event worker, leases, retries, affected scopes, projection sequences, and queue schema;
- generic workspace browser fan-out, effective-user expansion, PostgreSQL workspace notifications/listener, replay, and snapshot-refetch messages;
- Company Explorer, graph, GVIC/My Work, Project Management, communications/mail, permission, generic editor, and document-collaboration scopes;
- notification checkpoint and catch-up/replay machinery;
- frontend global workspace/projection/communications freshness bridges and server-event CustomEvent rebroadcasts.

Future realtime features must define one narrow resource or user scope, explicit subscription authorization, a compact post-commit message, and a canonical HTTP fallback. They must not revive generic workspace replication.

## Deliberate Deferrals

The following are explicitly outside the current realtime implementation:

- process-local delivery with committed dev/prod task-count defaults of 2 leaves cross-task live delivery nondeterministic; adding a cross-instance broker or stickiness and changing backend task counts are deliberately deferred;
- no `domain_events` retention or archive cleanup is included;
- the workspace-derived 200-company catch-up limit is unchanged;
- no replay log, gap protocol, recovery worker, generalized event history, or notification recovery plane is added; and
- exact multi-user document coediting remains a future Huddle/CRDT/OT project.
