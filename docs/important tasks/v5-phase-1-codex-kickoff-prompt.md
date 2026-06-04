# V5 Phase 1 Codex Kickoff Prompt

Use this prompt to start the next implementation pass.

```text
You are working in the MangoRTSDev repo.

Goal:
Implement V5 backend refactor Phase 1 only: Snapshot And WebSocket Contract.

Primary source of truth:
Read `docs/important tasks/v5-backend-refactor.md` first. Treat `docs/v3-architecture-doc.md` only as historical scratch notes.

Important vocabulary:
- Say `WebSocket connection` when referring to the new realtime transport.
- Say `subscription` for the resource scopes active on that WebSocket connection.
- Say `event table`, `event row`, and `event worker` for the future durable event system.
- Do not use `watching` as the implementation term.
- Do not call the event table an outbox table in implementation docs.

Scope for this pass:
Implement Phase 1. Do not implement Phase 2 or Phase 3 yet.

Phase 1 must produce real code, not only documentation.

Recommended first vertical slice:
Move Kanban board projection deltas to the new WebSocket/subscription path.

Keep existing SSE/workspace streams working for all unmigrated surfaces. Do not disable existing live updates unless the exact replacement WebSocket path is implemented and tested.

Before coding:
1. Inspect the current backend realtime/SSE code.
2. Inspect current workspace/projection delta publishing.
3. Inspect current auth and resource permission helpers.
4. Inspect frontend `subscribeWorkspaceStream` usage.
5. Inspect frontend Kanban projection delta handling.
6. Identify the smallest safe Kanban board vertical slice.

Backend deliverables:
1. Add a Go backend WebSocket endpoint.
2. Authenticate the WebSocket handshake with existing Level 1 auth.
3. Resolve user ID and company context for the connection.
4. Define typed WebSocket message envelopes for:
   - ready
   - subscribe
   - unsubscribe
   - subscription.accepted
   - subscription.rejected
   - projection.delta
   - snapshot.refetch
   - ping
   - pong
   - error
5. Add an in-memory subscription registry.
6. Track connection to scopes and scope to connections.
7. Authorize each subscription using existing Level 2 resource permission logic.
8. Remove all subscriptions when a connection closes.
9. Verify or add the scoped Kanban board snapshot endpoint, including the latest projection sequence/cursor in the response.
10. Route Kanban board projection deltas by board scope.
11. Include scope and sequence on delta messages.
12. Send snapshot.refetch for the scoped board if the client cannot be brought current.

Frontend deliverables:
1. Add a WebSocket client for one connection per browser tab/app session/company context.
2. Open the WebSocket after login/company context is available.
3. Add subscribe/unsubscribe helpers.
4. For the Kanban board vertical slice:
   - load current board state with the existing scoped GET snapshot
   - store the latest sequence/cursor from that snapshot
   - subscribe to the board scope over WebSocket
   - apply projection.delta upsert/delete messages to the existing local cache/UI
   - on reconnect, rejected subscription, sequence gap, or snapshot.refetch, reload the scoped board snapshot
5. Keep old SSE behavior for surfaces not migrated in this pass.

Tests required:
1. Backend test: unauthenticated WebSocket handshake is rejected.
2. Backend test: authenticated WebSocket handshake sends ready.
3. Backend test: unauthorized subscription sends subscription.rejected and is not stored.
4. Backend test: authorized subscription sends subscription.accepted and is stored.
5. Backend test: closing a connection removes its subscriptions.
6. Backend test: a board:A delta is sent only to board:A subscribers, not board:B subscribers.
7. Frontend/unit test: WebSocket message parsing handles accepted, rejected, delta, refetch, and error messages.
8. Frontend/unit test: Kanban applies upsert/delete deltas without a full refresh.

Do not do these in Phase 1:
- Do not create the event table yet.
- Do not create the event worker yet.
- Do not move notifications yet.
- Do not replace all projection writes.
- Do not build a distributed realtime gateway.
- Do not subscribe every user to broad company-wide live updates by default.
- Do not add frontend flags that merely suppress existing streams.
- Do not commit local logs, `.err.log` files, AWS credential output, or scratch files.
- Do not mark Phase 1 complete if only docs changed.

Expected final report:
1. List the backend WebSocket endpoint and message types implemented.
2. List the subscription registry files and explain how scopes are authorized.
3. List the Kanban WebSocket vertical slice files.
4. Confirm old SSE remains for unmigrated surfaces.
5. List tests run and exact results.
6. List any remaining Phase 1 gaps honestly.

Completion rule:
If the backend WebSocket endpoint, subscription registry, subscription authorization, frontend WebSocket client, one migrated Kanban live slice, and tests do not all exist, Phase 1 is not complete.
```
