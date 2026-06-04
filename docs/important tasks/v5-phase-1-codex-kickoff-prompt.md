# V5 Phase 1 Codex Kickoff Prompt

```text
You are working in the MangoRTSDev repo.

Goal:
Implement V5 backend refactor Phase 1 only: Snapshot And WebSocket Contract.

First, read:
docs/important tasks/v5-backend-refactor.md

Treat docs/v3-architecture-doc.md only as historical scratch notes.

Implement real code. Do not only update docs.

Phase 1 must include:
1. Go backend WebSocket endpoint.
2. Existing Level 1 auth on the WebSocket handshake.
3. User/company context resolved for the connection.
4. Typed WebSocket messages:
   ready, subscribe, unsubscribe, subscription.accepted,
   subscription.rejected, projection.delta, snapshot.refetch,
   ping, pong, error.
5. In-memory subscription registry.
6. Subscription authorization using existing Level 2 resource permission logic.
7. Connection cleanup when WebSocket closes.
8. One migrated live-update vertical slice.

Use Kanban board projection deltas as the first vertical slice.

For Kanban:
- Keep existing scoped board GET snapshot.
- Ensure the snapshot includes latest projection sequence/cursor.
- Subscribe to board scope over WebSocket.
- Route board deltas only to connections subscribed to that board.
- Include scope and sequence on deltas.
- Apply upsert/delete deltas in the frontend without full refresh.
- On reconnect/gap/refetch, reload the scoped board snapshot.

Do not:
- Create the event table yet.
- Create the event worker yet.
- Move notifications yet.
- Replace all projection writes.
- Disable existing SSE/workspace streams for unmigrated surfaces.
- Add frontend flags that merely suppress current streams.
- Commit logs, .err.log files, AWS credential output, or scratch files.
- Claim Phase 1 is complete if only docs changed.

Required tests:
- unauthenticated WebSocket rejected
- authenticated WebSocket sends ready
- unauthorized subscription rejected and not stored
- authorized subscription accepted and stored
- connection close removes subscriptions
- board:A delta only goes to board:A subscribers
- frontend parses accepted/rejected/delta/refetch/error
- frontend applies Kanban upsert/delete delta without full refresh

Final report must list:
- backend WebSocket endpoint
- subscription registry files
- authorization path
- Kanban WebSocket slice files
- proof old SSE remains for unmigrated surfaces
- exact tests run and results
- any remaining Phase 1 gaps
```
