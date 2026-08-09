# Process Story: A saved editor change reaches the other open browsers through Valkey

A person types in a Node, Project, or Logic Gate editor
↓
The editor batches the typing for about half a second, then sends one normal save to Mango
↓
PostgreSQL saves the full editor document and a small realtime notice in the same transaction
↓
Mango returns Saved as soon as PostgreSQL commits; it does not wait for Valkey
↓
The background realtime publisher sends only the small notice through the private Valkey channel
↓
Every API task receives the notice and forwards it only to allowed people currently watching that exact editor
↓
Those browsers reload the canonical document from Mango, while a browser with unsaved local work keeps its local work protected

Last updated: 2026-08-09

## The simple route

`Editor → Mango API → PostgreSQL → Valkey → subscribed API tasks → matching browsers`

PostgreSQL stores the truth. Valkey only announces that committed truth changed.

## Business logic rules

1. Mango does not send every keystroke over WebSocket or Valkey. The editor normally batches changes for about half a second; continuous Tiptap typing is still forced into a save batch after 10 seconds.
2. The complete editor document is stored only in PostgreSQL. Valkey receives a small notice containing safe identifiers, scope, event type, and revision information.
3. The document change and its `realtime_outbox` notice commit together. Mango must never announce an editor change that PostgreSQL did not save.
4. The HTTP save returns after the PostgreSQL commit. A slow or unavailable Valkey cache must not make the user's save slow or fail.
5. A successful commit wakes the background publisher immediately. There is no 75-millisecond database polling loop.
6. Every API task subscribes to the same private Valkey channel. This is how a browser connected through API task A receives a change saved through API task B.
7. Before sending a notice to a local WebSocket, each API task checks the exact company, resource, scope, and current allowed audience.
8. A receiving browser fetches the canonical document over HTTP. Valkey is not document storage and does not carry the full editor document.
9. Duplicate or out-of-order notices are deduplicated and ordered before local delivery.
10. If Valkey disconnects or an event gap is detected, Mango performs a small indexed recovery from `realtime_outbox` with bounded retries.
11. Each API task performs one bounded `realtime_outbox` safety pass every 10 minutes. This is recovery insurance, not the removed 75-millisecond polling path.
12. Before a task has certified its recovery position, realtime ticket and WebSocket admission return `503 realtime_not_ready`. Normal durable HTTP saves remain available.
13. Deployed DEV requires the private external Valkey configuration. A process-local backplane exists only for local development and tests; it is not a deployed multi-task fallback.
14. Valkey uses TLS, IAM access, a channel-specific permission, private networking, and no general database-key commands.

## Failure behavior

- A PostgreSQL save failure means no realtime notice exists and the save fails normally.
- A Valkey publish failure does not undo or delay a committed save.
- Publish, reconnect, and recovery retries use increasing delays capped at 30 seconds, so an outage cannot create a tight retry loop.
- A rare 10-minute safety pass can recover a missed wake or broker notice.
- Another browser always reloads PostgreSQL truth; it never treats a Valkey notice as the document itself.

## Final code path

There is one obvious route for committed realtime work:

`product transaction inserts one outbox row → handler calls the common wake → lifecycle publisher sends a compact Valkey hint → each API task's spine performs the only local WebSocket delivery`

- Editor transactions use the same canonical transaction insert helper as every other product transaction; the older editor-specific SQL helper is removed.
- The old publication adapter chain and its obsolete delivered-count result are removed. Tests enqueue real durable outbox rows instead of keeping production wrappers for test convenience.
- Node-chat and Kanban mutation sites call the common post-commit wake directly. Required pre-delete audience data remains in the transaction's exact outbox row.
- `startRealtimeSpine` never invents a process-local backplane. Simple local construction and tests pass `LocalBackplane` explicitly; deployed DEV still fails closed when external Valkey is required.
- PostgreSQL keeps the full outbox event. Valkey carries only the compact committed-event hint, and the task-local spine remains the sole WebSocket delivery boundary.

## Required regression checks

- Four idle API tasks do not repeatedly query `realtime_outbox`.
- One committed editor save produces one exact-scope notice across API tasks.
- No uncommitted editor save is announced.
- A Valkey outage does not delay the HTTP save response.
- Reconnect and sequence-gap recovery deliver committed notices without duplicates.
- An unauthorized browser never receives the notice.
- A browser with unsaved local work does not have that work overwritten.
- The old 75-millisecond poller and its configuration do not exist.
- Realtime outbox insertion and post-commit waking have one canonical helper path rather than duplicate wrappers.
