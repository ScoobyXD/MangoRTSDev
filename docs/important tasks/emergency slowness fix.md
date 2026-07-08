# Emergency Slowness Fix

Investigation date: 2026-07-08

Environment: dev, us-west-1

Primary sources used:
- ECS service: `mangorts-dev-backend`
- ECS cluster: `mangorts-dev-cluster`
- Backend log group: `/ecs/mangorts-dev/backend`
- RDS instance: `miraerts-northerncalifornia-devcluster-instance-1`
- Read-only AWS role: `MangoRTSDevAgentReadOnly`

All times below are Pacific time unless explicitly marked UTC.

## Plain-English Summary

The main production-like slowness pattern in dev is not memory exhaustion and not a read-cache problem. It looks like the frontend can create bursts of editor/node save work, especially `POST /v1/nodes/:id/projection` and `POST /v1/nodes/:id/information`. Those writes pile up in Postgres, drive RDS ACU/write I/O/commit activity up, and make the backend slow enough that the frontend's 15 second API timeout fires.

The websocket/auth problem is real too, but it appears to be a separate compounding issue. It creates reconnect noise, 401s, and user-visible `websocket_error`, but the worst API timeout evidence points to slow node editor save/projection requests.

## Current Working Diagnosis

1. Editor/node projection saves can run concurrently or too aggressively.
2. Some saves take 35-240 seconds in the backend during spikes.
3. The frontend times out after 15 seconds, so users see `API request timed out` even when the backend later returns `200`.
4. RDS write I/O and ACU spike in the same windows as the slow saves.
5. Websockets reconnect at the same time, adding UI noise and extra backend traffic.

## Evidence: 07:15-07:30 Spike

Window queried: `2026-07-08 07:15-07:30 Pacific`

CloudWatch/ECS:
- ECS CPU reached 100% repeatedly between about `07:20-07:29`.
- ECS memory stayed low, so this was not memory pressure.
- ECS network RX/TX spiked with CPU, consistent with request/realtime/event fanout load.

Backend logs:
- Raw backend log rows: `1,594`
- Parsed access rows: `1,305`
- Top request families:
  - `GET /v1/company-explorer/roots`: `240`
  - `GET /v2/logic-gates/:id/view status=404`: `162`
  - `GET /v1/company-explorer/folders`: `129`
  - `POST /v1/nodes/:id/information status=201`: `81`

Slow request evidence:
- `POST /v1/nodes/:id/information`
  - count: `81`
  - average duration: about `69.9s`
  - max duration: about `241.1s`
- Several individual `POST /v1/nodes/:id/information` requests took between `1m` and `4m`.

RDS metrics in the same period:
- `ACUUtilization`: hit `100%`
- `CPUUtilization`: hit `100%` max in some 1-minute buckets
- `DatabaseConnections`: around `26`
- `WriteIOPS`:
  - `07:20`: about `8,017/sec`
  - `07:21`: about `5,462/sec`
  - `07:23`: about `10,529/sec`
- `ReadIOPS` remained much lower than WriteIOPS.

Interpretation:
- This was a write-heavy/editor-save event.
- `BufferCacheHitRatio` stayed near 100%, so this does not look like "the DB cannot read fast enough."
- The repeated `GET /v2/logic-gates/:id/view 404` burst is suspicious and may be a separate missing/stale entity reload loop.

## Evidence: 08:15-08:30 Auth/Reconnection Storm

Window queried: `2026-07-08 08:15-08:30 Pacific`

Backend logs:
- `GET /v2/logic-gates/:id/work status=401`: `309`
- `POST /v1/realtime/ticket status=401`: `309`
- `GET /v1/realtime/ws status=401`: `133`
- `POST /v1/realtime/ticket status=200`: `202`
- Also saw slow `POST /v1/nodes/:id/information` requests:
  - count: `31`
  - average duration: about `40.9s`
  - max duration: about `95.0s`

ECS service events:
- Deployment/task replacement overlapped this period:
  - `08:23:51`: new task `07181da2...` started
  - `08:24:41`: new task `49f7faad...` started
  - `08:25:11`: old task `9da8c2fb...` stopped
  - `08:26:03`: old task `e36ef431...` stopped
  - `08:27:15`: service reached steady state
- During this churn there were four backend log streams, which made the websocket ticket problem more visible.

Interpretation:
- This window strongly matches the websocket/auth/reconnect hypothesis.
- It was probably worsened by deployment/task replacement.
- It is still separate from the slow editor save problem.

## Evidence: 08:40-08:50 Live Incident

User-visible symptoms:
- Red `websocket_error`
- Red `API request timed out`

Window queried: `2026-07-08 08:40-08:50 Pacific`

ECS metrics:
- `08:42`: ECS CPU max `100%`, average about `50%`
- `08:45`: ECS CPU max about `97.8%`
- `08:46`: ECS CPU max `100%`, average about `83.9%`

RDS metrics:
- `ACUUtilization`: hit `100%` from `08:44-08:47`
- `WriteIOPS`:
  - `08:42`: about `1,242/sec`
  - `08:44`: about `391/sec`
  - `08:45`: about `916/sec`
  - `08:46`: about `1,816/sec`
- `DatabaseConnections`: steady around `23`
- RDS CPU average stayed around the low-to-mid 30s, with high max samples.

Exact `08:44-08:47:30` log slice:
- Raw backend log rows: `477`
- `POST /v1/realtime/ticket status=200`: `61`, average `26.4ms`
- `GET /v1/realtime/ws status=401`: `32`
- `GET /v1/realtime/ws status=200`: `31`, average duration about `57.3s`
- `POST /v1/nodes/:id/projection status=200`: `6`
  - average duration: about `50.97s`
  - max duration: about `90.2s`

Most important slow request:
- `POST /v1/nodes/:id/projection status=200`
- Completed at about `08:46:56`
- Duration: `1m30.203s`
- It likely started around `08:45:26`
- The frontend timeout is `15s`, so the browser would show `API request timed out` around `08:45:41`
- The backend still completed later with `200`

Interpretation:
- The `API request timed out` in the screenshot is almost certainly from a node projection save taking longer than the frontend timeout.
- The websocket errors are real, but in this slice they are not the main cause of the API timeout.

## Code Paths Involved

Frontend API timeout:
- `frontend/src/modules/api/requestJSON.ts`
- `DEFAULT_API_TIMEOUT_MS = 15_000`
- Timeout error string: `API request timed out`

Node text-block projection save:
- `frontend/src/modules/editor/NodeWorkspaceSurface.tsx`
- `persistTextBlock` calls `POST /v1/nodes/${nodeID}/projection`

Backend node projection handler:
- `backend/internal/http/node_handlers.go`
- `POST /v1/nodes/:id/projection`
- Calls `s.repo.UpsertNodeProjectionWithActor(...)`
- Then calls:
  - `recordMentionNotifications(...)`
  - `recordNodeChatNotification(...)`

Postgres node projection transaction:
- `backend/internal/store/postgres_editor_save_versions.go`
- `UpsertNodeProjectionWithActor`
- Does:
  - begin transaction
  - check node exists
  - load previous projection
  - upsert `node_projection_table`
  - insert content changes
  - append editor projection event rows
  - commit

Node information append path:
- `frontend/src/modules/editor/NodeWorkspaceSurface.tsx`
- chat/email append paths call `POST /v1/nodes/${nodeID}/information`
- backend handler is in `backend/internal/http/node_handlers.go`
- store path is in `backend/internal/store/postgres_nodes.go`

## Websocket/Auth Findings

The websocket issue appears to have two causes:

1. Realtime tickets are process-local.
   - Backend has two ECS tasks.
   - Ticket can be issued on task A.
   - Websocket upgrade can land on task B.
   - Task B cannot consume task A's in-memory ticket, so websocket gets `401`.

2. Websockets appear to close/reconnect frequently.
   - Many `GET /v1/realtime/ws status=200 duration=~60s` entries were observed.
   - This looks consistent with ALB/default idle timeout behavior and lack of proactive heartbeat.

Evidence from earlier logs:
- Ticket issued on one log stream followed by websocket `401` on another stream.
- Reconnect eventually succeeds when ticket and websocket land on the same task.
- ECS desired/running count was `2`.

Impact:
- Creates `websocket_error`.
- Causes repeated `POST /v1/realtime/ticket` and `GET /v1/realtime/ws`.
- Can amplify load and confuse users, but it does not fully explain the slow node projection saves.

## What This Is Probably Not

Not memory exhaustion:
- ECS memory utilization remained low.

Not a read-cache miss problem:
- RDS `BufferCacheHitRatio` stayed near 100%.

Not just "RDS CPU is low so DB is fine":
- ACU and WriteIOPS were high.
- Write/commit/transaction pressure can hurt before average CPU looks terrifying.
- Max CPU samples did hit high values.

Not only websocket auth:
- Websockets explain red `websocket_error`.
- Slow `POST /v1/nodes/:id/projection` explains red `API request timed out`.

## Highest-Priority Fixes

### 1. Stop node editor projection save dogpiling

The immediate emergency fix is in `frontend/src/modules/editor/NodeWorkspaceSurface.tsx`.

Implement one-save-at-a-time latest-content behavior per `nodeID + blockID`:
- user edits update local state immediately
- mark the text block `has changed`
- debounce briefly before attempting a save
- if a save is already in progress for that block, do not start another request
- keep only the newest in-memory block content and mark `save needed after current save`
- when the in-progress save finishes, mark `has not changed` only if the completed save version equals the latest local version
- if newer edits arrived while the save was in progress, send exactly one follow-up save using the newest in-memory content

Use version counters rather than whole-string equality checks for correctness:
- each text block has `localVersion`
- each request captures `sentVersion`
- success only marks `has not changed` when `localVersion === sentVersion`

This avoids repeatedly scanning whole editor contents just to decide whether a save is needed. The full block still has to be converted into the API payload when an actual request is sent.

### 2. Disable automatic saved-version creation

The auto saved-version timer should be off during the emergency slowness fix.

Do not create background auto saved versions for nodes or Logic Gates until the emergency save backpressure work is complete.

Manual saved versions may remain available, but they must flush current projection saves safely.

If auto saved versions are re-enabled later, they must:
- consider only active nodes/Logic Gates
- only save resources whose editor projection has changed
- never scan or save every resource in the system
- never flush every text block with unbounded concurrency

### 3. Make forced projection flushes safe

`flushAllTextBlockProjectionSaves` currently clears timers and runs:

```ts
await Promise.all(entries.map(([blockID, content]) => persistTextBlock(blockID, content)));
```

This is unsafe because it can POST every text block at once, even text blocks that have not changed.

Change it so forced flush:
- saves only blocks marked `has changed` or `save needed after current save`
- waits for in-progress block saves
- then saves the latest content if needed
- does not use unbounded `Promise.all` over every block

### 4. Add phase timing to hot write endpoints

Add structured timing logs to:
- `POST /v1/nodes/:id/projection`
- `POST /v1/nodes/:id/information`
- maybe `GET /v1/nodes/:id/projection`

Suggested phases:
- request decode
- auth/permission check
- transaction begin
- node exists check
- previous projection load
- projection upsert
- content change build
- content change insert
- editor event append
- transaction commit
- mention notification check
- node chat notification check
- realtime/workspace publish

Goal:
- Identify whether remaining latency is DB lock wait, slow upsert, event append, notification checks, or connection pool waiting.

### 5. Treat frontend timeout increase as a band-aid only

Increasing the API timeout from 15s might hide the red error, but it does not fix backend write contention. The real fix is fewer overlapping saves and better backend timing visibility.

### 6. Fix websocket tickets separately

Options:
- make realtime tickets stateless/signed instead of process-local
- store tickets in shared Redis/Postgres with short TTL
- temporarily run one backend task in dev
- enable target stickiness as a mitigation
- add proactive websocket heartbeat below ALB idle timeout

### 7. Add read-only Performance Insights permission

The read-only agent role could not call `pi:GetResourceMetrics`.

Useful permission to add to the dev read-only role:
- `pi:GetResourceMetrics`
- optionally `pi:DescribeDimensionKeys`

This would allow direct top-SQL evidence during the next spike.

## Useful CloudWatch Logs Queries

Route summary:

```sql
fields @timestamp, @logStream, @message
| parse @message /(?<method>GET|POST|PUT|DELETE|PATCH|OPTIONS) (?<path>\S+) status=(?<status>\d+) bytes=(?<bytes>\d+) duration=(?<duration>\S+)/
| filter ispresent(method)
| stats count(*) as requests by bin(1m), method, path, status
| sort requests desc
| limit 100
```

Raw slow/error/realtime slice:

```sql
fields @timestamp, @logStream, @message
| filter @message like /timeout|timed out|deadline|context canceled|context deadline|error|failed|401|403|502|503|504|realtime|websocket|ticket/
| sort @timestamp asc
| limit 500
```

Node save focus:

```sql
fields @timestamp, @logStream, @message
| filter @message like /\/v1\/nodes\// and (@message like /\/projection/ or @message like /\/information/)
| sort @timestamp asc
| limit 500
```

Websocket ticket focus:

```sql
fields @timestamp, @logStream, @message
| filter @message like /realtime_ticket_issued/ or @message like /POST \/v1\/realtime\/ticket/ or @message like /GET \/v1\/realtime\/ws/
| sort @timestamp asc
| limit 500
```

## Decision

The emergency fix should start with editor save backpressure and timing instrumentation, not RDS scaling. Scaling RDS may buy room, but the evidence points to inefficient/concurrent write behavior that can grow until it hurts any small dev database.

Recommended order:

1. Disable automatic saved-version creation for nodes and Logic Gates.
2. Add one-save-at-a-time latest-content behavior for node text-block projection saves.
3. Make node text-block forced flush save only changed blocks without unbounded `Promise.all`.
4. Add backend phase timing for node projection and node information writes.
5. Fix websocket ticket/heartbeat issue.
6. Use Performance Insights/top SQL during the next spike once read-only permission allows it.

## Final Agreed Save Flow

Use this vocabulary in user-facing comments/docs and implementation notes:
- `has changed`
- `has not changed`
- `save in progress`
- `save needed after current save`

Use only this vocabulary for the save state in new code comments and docs.

Flow for node text-block editor:

1. User types a paragraph.
2. The editor updates on screen immediately.
3. The affected text block is marked `has changed`.
4. The text block's `localVersion` increments.
5. The newest content is stored in memory for that block.
6. A short debounce timer waits for the user to pause.
7. When the timer fires, if no save is in progress for that block, start one `POST /v1/nodes/:id/projection` request using the latest in-memory content.
8. The request captures the current version as `sentVersion`.
9. While the save is in progress, further typing updates the screen immediately, stores the newest content, increments `localVersion`, and marks `save needed after current save`.
10. No overlapping save request starts for that same node text block.
11. When the request succeeds, compare `sentVersion` to the current `localVersion`.
12. If they match, mark the block `has not changed`.
13. If they do not match, send exactly one follow-up save with the latest in-memory content.
14. Repeat until the latest local version has been saved.

This preserves all user characters because the browser state is the source for the next request, not the intermediate request list.

Flow for Logic Gate editor:

The Logic Gate editor should follow the same one-save-at-a-time latest-content behavior for its projection save. It already has more save queue structure than node text blocks, but the expected contract is now documented in `docs/tests/logic-gates.md`.

## Clarifications From Investigation

### What "serialize" Means Here

In this codebase discussion, "serialize" means converting editor memory into the exact string/body sent to the API.

Example editor memory:

```ts
{
  title: "Notes",
  document: "<p>Hello</p>",
  attachments: []
}
```

Example API payload text:

```json
{"title":"Notes","document":"<p>Hello</p>","attachments":[]}
```

All digital data is ultimately bits, but this conversion still costs CPU. The emergency queue should not repeatedly convert or compare whole editor content just to decide whether a save is needed. Use version counters and changed-state flags instead.

### Events vs Notifications

Projection saves are expected to append editor projection event rows. Those event rows are for realtime/editor projection deltas so other subscribed clients can see the latest editor projection.

These event rows are not the same thing as user notification events.

Notification hooks are called after projection saves, but normal text box saves should mostly no-op unless mention-worthy content exists:
- `recordMentionNotifications` checks text boxes and chat messages for regular/urgent mentions.
- `recordNodeChatNotification` only continues for `Text block chat`.

The emergency problem is not mainly that normal typing creates notifications. The emergency problem is overlapping projection save requests and forced flushes that can save too many text blocks at once.

### Why ECS And RDS Both Matter

ECS CPU is the visible app fire alarm.

RDS write pressure is a major fuel source:
- projection upserts
- content-change inserts
- editor projection event rows
- commits
- realtime/event fanout follow-up work

The fix should reduce request count and concurrent write pressure before scaling RDS.

## Next Codex Handoff

Do not start by changing backend write semantics or building partial text patches.

Start with the emergency frontend behavior:

1. In `frontend/src/modules/editor/EditorContent.tsx`, disable automatic saved-version creation for nodes and Logic Gates. Manual Save should remain.
2. In `frontend/src/modules/editor/NodeWorkspaceSurface.tsx`, replace per-block fire-and-forget `persistTextBlock` calls with a per-block save controller using:
   - `localVersion`
   - `sentVersion`
   - `save in progress`
   - `save needed after current save`
   - `has changed`
   - `has not changed`
3. Update `scheduleTextBlockSave`, `flushTextBlockSave`, `flushAllTextBlockProjectionSaves`, and `createTextBlock` to use the controller.
4. Ensure `flushAllTextBlockProjectionSaves` does not send every text block with `Promise.all`.
5. Add focused tests if practical. The minimum test target is that rapid changes while a save promise is pending produce at most one active request and one follow-up request with the latest content.
6. Run frontend tests/typecheck appropriate to the repo.

Important safety rule:

Never mark a text block `has not changed` merely because a request returned. Mark it `has not changed` only when the returned request's `sentVersion` equals the current `localVersion`.

## Prompt For Next Codex Instance

```text
We are in C:\Users\Jonat\MangoRTSDev. Read AGENTS.md and follow the AWS/DB safety rules. Do not do AWS or DB work for this task unless I explicitly ask.

Task: implement the emergency editor slowness fix described in docs/important tasks/emergency slowness fix.md.

Context:
- Dev slowness was traced to node editor projection save dogpiling.
- The hot request is POST /v1/nodes/:id/projection from frontend/src/modules/editor/NodeWorkspaceSurface.tsx.
- The current node text-block autosave path debounces for 550ms but can still start overlapping saves for the same block.
- flushAllTextBlockProjectionSaves currently can Promise.all every text block, including unchanged blocks, which caused bursts of concurrent projection saves.
- Auto saved-version creation should be disabled for now. Manual Save can remain.
- Use the vocabulary has changed, has not changed, save in progress, save needed after current save. Do not introduce alternate save-state wording.

Implement:
1. Disable automatic saved-version creation in EditorContent.tsx for nodes and Logic Gates during the emergency fix. Keep manual saved versions.
2. Add a per node text-block one-save-at-a-time latest-content queue/controller in NodeWorkspaceSurface.tsx.
3. Use version counters: localVersion increments on user changes; each request captures sentVersion; only mark has not changed if sentVersion equals current localVersion.
4. While a save is in progress, later edits must update latest in-memory content and mark save needed after current save, but must not start another overlapping POST for the same block.
5. When the in-progress save finishes, send exactly one follow-up save if newer edits arrived.
6. Make flushAllTextBlockProjectionSaves save only blocks that have changed or need a follow-up save; do not Promise.all every block.
7. Preserve all characters typed while saves are in progress.
8. Add or update focused tests where practical, then run the relevant frontend validation.

Do not implement partial text patching yet. Do not change backend DB semantics unless needed for compile/tests.
```
