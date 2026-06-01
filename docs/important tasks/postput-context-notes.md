# POST/PUT Latency Context Notes

## Purpose

This document captures the current understanding of the POST/PUT latency problem after several timing passes. It is intended as handoff context for another Codex instance or engineer.

The user is focused on reducing real backend mutation latency, not merely hiding it with optimistic UI.

## High-Level Problem

Several user actions are taking `1.2s` to `4.7s` server-side:

- Creating a raw node.
- Creating a Logic Gate.
- Creating a node in a Logic Gate Kanban column.
- Creating a node in the RACIO matrix.
- Creating a Logic Gate plus node in an empty matrix cell.
- Moving nodes between Logic Gates.

The user wants the underlying POST/PUT work reduced aggressively. Optimistic UI can help perceived latency later, but it is not considered the main solution.

## Current Root Diagnosis

The system is mixing too many responsibilities into one synchronous request:

1. Source-of-truth writes.
2. Legacy Kanban writes.
3. Explorer/map/folder writes.
4. RACIO projection sync.
5. Projection/entity rereads.
6. Domain event append.
7. Domain event publish.
8. Notification projection.
9. Frontend GET reload storm.
10. Response/visible completion.

The first accounting-grade logs show that the largest immediate measured bottleneck is the domain event publish pipeline, especially `events.publish.listener_work`.

The phrase "event pipeline" currently means:

- Build domain event payloads.
- Append durable domain event rows.
- Assign event sequence/order.
- Publish committed events to workspace subscribers.
- Resolve effective users for workspace events.
- Notify internal listeners.
- Project notifications from domain events.
- Publish notification stream messages.

## Important Clarification: Event Append vs Event Publish

`events.append.*` is durable event writing. This happens around the database write path and should generally remain synchronous enough that the system can recover from committed events.

`events.publish.*` is post-commit fanout/listener work. This currently happens before the HTTP response returns.

The current evidence says `events.publish.*`, not raw client network send, is a major bottleneck.

Example from raw node creation:

```text
events.publish.client_send=0s(25x)
events.publish.listener_work=661.6ms(3x)
events.publish.total=710.8ms
```

This means the server is not spending meaningful time pushing bytes to connected clients. It is spending time in synchronous internal listener work that runs as part of event publish.

## Meaning Of `(2x)`, `(3x)`, `(6x)`

The suffix does not mean the user command ran multiple times.

It means that a timing bucket ran multiple times inside one HTTP request.

Examples:

- `events.insert=78.7ms(3x)` means one request inserted 3 domain events.
- `events.publish.listener_work=1.8704s(6x)` means one request published 6 events, and listener work ran for those event publishes.
- `kanban.card_read=91ms(2x)` means the move command read Kanban cards twice inside one request.

Sometimes repeated work is legitimate because one command touches multiple resources. Sometimes it is waste from legacy compatibility paths.

## Why Raw Node Create Is Almost Good Enough

Raw node create detailed timing:

```text
request.total=1.2032s
source.transaction=298.8ms
events.append.total=193.5ms
events.publish.total=710.8ms
```

If committed event publishing did not block the HTTP response:

```text
1.2032s - 710.8ms = 492.4ms
```

That means raw node creation is already near the `<500ms` target if post-commit event publish is moved out of the request path.

This does not mean "do not publish events." It means the preferred flow should be:

```text
1. Write source-of-truth rows.
2. Append durable event(s).
3. Return HTTP response.
4. Publish/fan out/process listeners asynchronously.
```

## Source-Of-Truth Direction

Authoritative write tables should be:

- `nodes`
- `logic_gates`
- `node_logic_gate_assignments`
- RACI/access tables

Kanban should not remain a second source of truth. It should be a read model/projection derived from authoritative tables.

Minimal proposed Kanban projection shape:

```text
kanban_board_projection
  company_id
  logic_gate_id
  node_id
```

Do not duplicate values that already exist in source tables:

- Status should come from `nodes.status`.
- Priority should come from `nodes.priority` if still needed.
- Assignee/person in charge should come from the authoritative node/assignment source.
- Card position likely belongs in `node_logic_gate_assignments.position`.
- Column identity should be derived from `nodes.status`.

Open design question:

- If column order is global/static, use application/status config.
- If column order is company- or Logic-Gate-specific, use a small config table.
- Do not make `kanban_cards` authoritative again.

## Benchmark Cases

These cases should be treated as the benchmark suite. Any fix should rerun all of them.

| ID | Operation | Endpoint Pattern | Current/Prior Time | Notes |
| --- | --- | --- | ---: | --- |
| B1 | Create raw node in Others section | `POST /v1/workspace/entity-batches` | `1.2032s` request total, `1.254669s` HTTP log | Detailed accounting available. |
| B2 | Create Logic Gate from Others priority/status matrix path | `POST /v1/workspace/entity-batches` | `1.4256028s` prior timing | Earlier detailed timing showed publish dominant. |
| B3 | Create node in empty Others matrix cell, creating Logic Gate plus node | `POST /v2/racio-matrix/nodes` | `4.1662s` request total, `4.2156899s` HTTP log | Detailed accounting available. |
| B4 | Create Logic Gate in empty R matrix cell | `POST /v1/workspace/entity-batches` | `1.6836499s` prior timing | Earlier detailed timing showed publish dominant. |
| B5 | Create node in R matrix, creating Logic Gate plus node | `POST /v2/racio-matrix/nodes` | `4.3368561s` prior timing | Similar to B3. |
| B6 | Move node from one Logic Gate to another in matrix | `POST /v2/racio-matrix/nodes/{nodeID}/move` | `2.2478s` request total, `2.3588733s` HTTP log | Detailed accounting available. |
| B7 | Create node in Logic Gate Kanban column | `POST /v2/logic-gates/{id}/nodes` | `3.5826761s` prior timing | Needs latest accounting log. |
| B8 | Create node on existing Logic Gate in RACIO matrix | `POST /v1/workspace/entity-batches`, then `POST /v2/logic-gates/{id}/nodes` | `3.2316668s` write time prior | Two serial writes. Needs latest accounting log. |

## Detailed Logs And Interpretations

### B1: Raw Node Creation

User action:

- Create raw node by itself in Others section.
- Node is not assigned to a Logic Gate.
- User is assigned as person in charge.

Server timing:

```text
request.total=1.2032s
request.accounted_total=1.2032s
request.unaccounted=0s
source.transaction=298.8ms
events.append.total=193.5ms
events.publish.total=710.8ms
```

Source/repo details:

```text
reread.assignment=23.8ms
explorer.folder_setup=90ms(2x)
source.node=22ms
racio_projection.delete_stale=21.8ms
racio_projection.upsert=32.3ms
racio_projection.total=54.1ms
map.position_write=21.5ms
explorer.folder_position_read=23.2ms
explorer.folder_item_write=23.1ms
source.transaction_commit=28.8ms
source.transaction_repo=298.8ms
```

Event details:

```text
events.payload_build=890us(3x)
events.sequence_lock=65.4ms(3x)
events.insert=78.7ms(3x)
events.append.item_total=145ms(3x)
events.append.batch_total=145ms
events.append.transaction=193.5ms
events.append.total=193.5ms
events.publish.serialize=989us(3x)
events.publish.client_send=0s(25x)
events.publish.fanout=48.3ms(3x)
events.publish.listener_work=661.6ms(3x)
events.publish.total=710.8ms
```

Interpretation:

- Raw node create is dominated by event publish.
- Client send is not the bottleneck.
- Listener work is the bottleneck.
- If event publish is moved async, this case is near the `<500ms` target.

Approximate after removing synchronous publish:

```text
1.2032s - 710.8ms = 492.4ms
```

### B3: Create Node In Empty Others Matrix Cell

User action:

- Create node in the RACIO matrix for the Others view in a specific priority/status cell.
- This path creates a Logic Gate plus node/assignment.

Server timing:

```text
request.total=4.1662s
request.accounted_total=4.1662s
request.unaccounted=0s
source.transaction=1.8966s
events.publish.total=2.037s
notifications.total=232ms
```

Source/repo details:

```text
source.logic_gate=497.2ms(2x)
kanban.board_ensure_lock=55.1ms
kanban.board_column_ensure=62.6ms
kanban.board_ensure=117.7ms
explorer.folder_setup=91.6ms(2x)
explorer.folder_position_read=45.1ms(2x)
explorer.folder_item_write=290.3ms
kanban.column_read=50.6ms
racio_projection.delete_stale=46.8ms(2x)
racio_projection.upsert=46.8ms(2x)
racio_projection.total=94.7ms(2x)
source.node=382.4ms(2x)
reread.assignment=45.1ms
source.assignment_position_read=43.9ms
kanban.card_read=44.3ms
source.assignment=1.3159s(2x)
kanban.card_delete=42.7ms
kanban.card_update=46.5ms
kanban.card_insert=48.7ms
kanban.card_trigger_assignment_sync=89.2ms(2x)
kanban.card_work=182.6ms
racio_projection.sync_call=46.6ms
reread.racio_projection=73.5ms(2x)
reread.node=45.6ms
source.command_total=1.2693s
source.transaction_commit=28.3ms
source.transaction_repo=1.8966s
```

Event and notification details:

```text
events.payload_build=0s(6x)
events.sequence_lock=137.4ms(6x)
events.insert=153.1ms(6x)
events.append.item_total=290.5ms(6x)
events.append.batch_total=290.5ms(2x)
events.append.total=290.5ms(2x)
events.publish.serialize=0s(6x)
events.publish.client_send=752us(72x)
events.publish.fanout=165.9ms(6x)
events.publish.listener_work=1.8704s(6x)
events.publish.total=2.037s
notifications.event_mapping=0s(6x)
notifications.recipient_load=133ms
notifications.node_load=98.9ms
notifications.total=232ms
```

Interpretation:

- Event publish is almost half the request.
- Notification projection is also synchronous.
- Even after making publish/notifications async, this path remains around `1.9s`.
- Remaining transaction bloat is mostly combined create gate + node + assignment + legacy Kanban + projection/rereads.

Approximate after removing synchronous publish and notifications:

```text
4.1662s - 2.037s - 232ms = 1.8972s
```

### B6: Move Node From One Logic Gate To Another

User action:

- Move a node from one Logic Gate to another in the matrix.

Server timing:

```text
request.total=2.2478s
request.accounted_total=2.2478s
request.unaccounted=0s
source.transaction=1.3918s
events.publish.total=675.9ms
notifications.total=180.1ms
```

Source/repo details:

```text
reread.assignment=48ms
kanban.card_read=91ms(2x)
kanban.board_read=52.8ms
reread.node=116.6ms(2x)
kanban.column_read=105.5ms(2x)
source.assignment_position_read=45.6ms
source.node=43.6ms
source.assignment=71.5ms
kanban.email_reference_work=147.3ms(2x)
kanban.card_update=51.1ms
kanban.card_work=95.3ms(2x)
kanban.card_trigger_assignment_sync=44.1ms
source.access_policy_copy=198.7ms
racio_projection.delete_stale=50.3ms
racio_projection.upsert=50.7ms
racio_projection.total=101ms
racio_projection.sync_call=101ms
reread.racio_projection=46.6ms
events.append.total=181.5ms
source.transaction_commit=24.7ms
source.command_total=1.3695s
source.transaction_repo=1.3918s
```

Event and notification details:

```text
events.payload_build=0s(3x)
events.sequence_lock=87.1ms(3x)
events.insert=94.3ms(3x)
events.append.item_total=181.5ms(3x)
events.append.batch_total=181.5ms
events.append.total=181.5ms
events.publish.serialize=673us(3x)
events.publish.client_send=656us(18x)
events.publish.fanout=95.2ms(3x)
events.publish.listener_work=579.3ms(3x)
events.publish.total=675.9ms
notifications.event_mapping=0s(3x)
notifications.recipient_load=90.7ms
notifications.node_load=89.4ms
notifications.total=180.1ms
```

Interpretation:

- Publish and notifications together are about `856ms`.
- Removing them from the request path likely brings this from `2.25s` to about `1.39s`.
- Still too slow because transaction itself is heavy.
- Remaining transaction work is dominated by legacy Kanban reads/writes, email reference work, access policy copy, projection sync, event append, and rereads.

Approximate after removing synchronous publish and notifications:

```text
2.2478s - 675.9ms - 180.1ms = 1.3918s
```

## Frontend GET Storm Observations

Many operations are surrounded by GET requests:

- `GET /v1/workspace/snapshot`
- `GET /v1/company-explorer/folders`
- `GET /v1/company-explorer/folder-items`
- `GET /v1/logic-gates`
- `GET /v1/nodes`

These do not explain the multi-second POST/PUT timings, because the POST/PUT server timing is already multi-second. However, they add extra visible churn and server load.

Examples:

- Raw node creation had snapshot/folder/logic-gate GETs before the POST and folder-items/nodes GETs after.
- Matrix create had two workspace snapshot GETs and several explorer/node/logic-gate GETs before the POST.
- Move node had snapshot and other GETs before the POST.

GET storm cleanup is important, but it is not the first root latency fix for the measured POST/PUT durations.

## Current Priority Order

### First Priority: Stop Synchronous Event Publish

Rationale:

- It is the biggest measured removable cost.
- It helps nearly every benchmark case.
- For raw node create, it likely gets the request near `<500ms`.

Target behavior:

```text
source-of-truth transaction
durable event append
return HTTP response
async event publish/listener work
async notification projection
```

Important:

- Do not drop events.
- Do not remove durable append.
- Move fanout/listener/notification work out of the request path.

### Second Priority: Stop Synchronous Notification Projection

Rationale:

- B3: `notifications.total=232ms`
- B6: `notifications.total=180.1ms`
- Previous logs had move notification projection around `334.7ms`

Notification projection can be async if committed domain events are durable and catch-up is reliable.

### Third Priority: Reduce Event Count And Append Cost

Rationale:

- Raw node create emits 3 events.
- Matrix create emits 6 events.
- Move emits 3 events.
- Each event pays sequence lock, insert, append overhead, publish overhead, listener overhead.

Potential direction:

- Use one command-level event per user action where possible.
- Avoid separate legacy derived events like `kanban_card_upserted` once Kanban is projection-only.
- Keep payloads rich enough so read models and clients do not need immediate rereads.

### Fourth Priority: Delete Legacy Kanban Write Model Work

Rationale:

Legacy Kanban work is visible in heavy paths:

- `kanban.board_ensure`
- `kanban.column_read`
- `kanban.card_read`
- `kanban.card_insert`
- `kanban.card_update`
- `kanban.card_delete`
- `kanban.card_trigger_assignment_sync`
- `kanban.email_reference_work`

The desired direction is:

- Update source-of-truth tables.
- Update/read minimal Kanban projection.
- Stop making `kanban_cards` authoritative.
- Delete or bypass `kanban_cards -> node_logic_gate_assignments` trigger for new command paths.

### Fifth Priority: Command Shape And RACIO Delta Writes

Rationale:

Some user actions are still composed from multiple mutations.

Example:

```text
create node
then assign node to Logic Gate
```

This should become one command.

RACIO projection should also move from scoped recompute patterns toward direct insert/update/delete deltas where possible.

## What Not To Do First

Do not start with optimistic UI as the main fix. It hides the problem but does not reduce server POST/PUT time.

Do not start with broad parallelism. The system is doing redundant and derived work. Parallelizing before deleting may increase lock contention and make behavior harder to reason about.

Do not make Kanban projection authoritative. Projections should be disposable and rebuildable.

Do not remove durable event append before designing recovery/catch-up. The problem is publish/listener/notification work blocking the response, not necessarily event durability.

## Concrete Expected Impact Of First Action

If synchronous event publish and notification projection are moved off the HTTP critical path:

| Case | Current | Expected After Async Publish/Notifications |
| --- | ---: | ---: |
| B1 raw node create | `1.2032s` | about `492ms` |
| B3 matrix create Logic Gate plus node | `4.1662s` | about `1.897s` |
| B6 move node between Logic Gates | `2.2478s` | about `1.392s` |

This will not solve every case. It is the first high-leverage fix.

After that:

- B1 may already be near target.
- B3/B5 still need transaction cleanup.
- B6 still needs transaction cleanup.
- B7/B8 need detailed latest accounting logs and likely share the same assignment/kanban/event issues.

## First Async Pipeline Pass Implemented

The first pass now keeps source-of-truth writes and durable domain event append synchronous, but moves committed workspace fanout and notification projection out of the blocking request path.

Changed code:

- `publishCommittedWorkspaceEventsWithTiming` now records only `events.publish.enqueue`, copies the event slice, and launches async publish work.
- `publishCommittedWorkspaceEvent` now uses the same async committed-event path.
- Async workspace publishing logs `async_workspace_events_publish ... events.publish.total=... event_types=...`.
- `projectCommittedNotificationEventsWithTiming` now records only `notifications.enqueue`, copies the event slice, and launches async notification projection/publish.
- Async notification projection logs `async_notification_projection ... notifications.total=... event_types=...`.
- Notification projection still triggers `runNotificationDomainEventCatchupOnce` on processing errors, and the existing periodic catch-up remains in place.
- Request timing recorders are not passed into the async goroutines.
- The measured handlers no longer wrap post-commit side effects in accounted `events.publish.total` / `notifications.total` request spans.

Validation:

- `go test ./...` passed from `backend/`.
- Frontend was not touched, so no frontend build/test was run.

Request timing after this change should show small enqueue spans instead of blocking publish/projection spans:

```text
events.publish.enqueue=...
notifications.enqueue=...
```

The async side-effect work should appear separately:

```text
async_workspace_events_publish ... events.publish.total=...
async_notification_projection ... notifications.total=...
```

## Event Type Inventory

Exact event types for the benchmarked paths, based on the current emission code:

| Case | Event count | Event types |
| --- | ---: | --- |
| Raw node create via `POST /v1/workspace/entity-batches` | 3 | `company_explorer_folder_item_assigned`, `node_created`, `node_map_positions_updated` |
| Create node in empty matrix cell, creating Logic Gate plus node | 6 | `company_explorer_folder_item_assigned`, `logic_gate_created`, `node_created`, `work_item.logic_gate_assignment_saved`, `kanban_card_upserted`, `node_updated` |
| Move node between Logic Gates | 3 | `work_item.logic_gate_assignment_moved`, `kanban_card_moved`, `node_updated` |
| Create node in Logic Gate Kanban column | likely 4 when creating a new node | `node_created`, `work_item.logic_gate_assignment_saved`, `kanban_card_upserted`, `node_updated` |

No event count reduction was made in this pass. The apparent duplicates are not obviously safe to collapse yet:

- `work_item.logic_gate_assignment_*` feeds notification projection and work-item semantics.
- `kanban_card_*` still drives legacy Kanban read versions and snapshot invalidation.
- `node_updated` still drives node list/snapshot invalidation and may be consumed directly by clients.
- Raw node create events separately invalidate explorer folder items, node lists/map snapshots, and map layout.

Reducing these should wait until downstream consumers are audited or the legacy Kanban/read-model update path is replaced.

## Before/After Timing

The app benchmark actions were not rerun in this pass. Expected after values are calculated from the prior measured request totals by removing the now-async request-path publish/projection spans.

| Case | Before | Expected request-path after this pass | Removed from blocking request |
| --- | ---: | ---: | ---: |
| Raw node create | `1.2032s` | about `492.4ms` | `events.publish.total=710.8ms` |
| Matrix create Logic Gate plus node | `4.1662s` | about `1.8972s` | `events.publish.total=2.037s`, `notifications.total=232ms` |
| Move node between Logic Gates | `2.2478s` | about `1.3918s` | `events.publish.total=675.9ms`, `notifications.total=180.1ms` |

For the measured request timing logs, `events.publish.total` and `notifications.total` should no longer be blocking accounted request spans. The remaining visible request costs are now mostly:

- `source.transaction`
- durable `events.append.total`
- legacy Kanban board/card reads and writes
- RACIO projection sync/rereads
- explorer folder item writes/position reads
- assignment/access policy copy work

## Next Bottlenecks

After this pass, the main remaining backend work is transaction cleanup:

- B3/B5 matrix create still pay combined Logic Gate creation, node creation, assignment writes, legacy Kanban work, RACIO projection, rereads, and durable append.
- B6 move still pays Kanban reads/writes, email reference work, access policy copy, RACIO projection sync, rereads, and durable append.
- B7/B8 still need fresh accounting logs, but likely share the same assignment/Kanban/event issues.

Do not proceed into a major Kanban rewrite, command endpoint rewrite, or RACIO projection delta rewrite without a separate pass.

## Update: Async Event Pipeline Pass Completed

This section supersedes the earlier recommendation to move committed workspace event publish and notification projection off the HTTP request path. That change has now been implemented by another Codex instance.

Reported code changes:

- `workspace_handlers.go`: committed workspace publish now copies events, records `events.publish.enqueue`, and runs fanout/listener work asynchronously with separate `async_workspace_events_publish` logs.
- `notification_handlers.go`: notification projection now copies events, records `notifications.enqueue`, runs asynchronously, logs failures, and still triggers catch-up on errors.
- Blocking `events.publish.total` / `notifications.total` wrappers were removed from the measured POST/PUT handlers.
- Async-sensitive tests were updated to wait for notification projection.
- `go test ./...` from `backend/` passed.
- Frontend was not touched.

Event inventory from that pass:

- Raw node create: `company_explorer_folder_item_assigned`, `node_created`, `node_map_positions_updated`
- Empty matrix cell create: `company_explorer_folder_item_assigned`, `logic_gate_created`, `node_created`, `work_item.logic_gate_assignment_saved`, `kanban_card_upserted`, `node_updated`
- Move between gates: `work_item.logic_gate_assignment_moved`, `kanban_card_moved`, `node_updated`

No event-count collapse was made in that pass. The derived events still have active downstream consumers.

### After Async Publish: Raw Node Create

User action: create raw node in Others view.

```text
request.total=846.1ms
request.accounted_total=846.1ms
request.unaccounted=0s
source.transaction=585ms
events.append.total=260.6ms
events.publish.enqueue=0s
```

Important details:

```text
reread.assignment=46.9ms
explorer.folder_setup=201.8ms(2x)
source.node=60.6ms
racio_projection.delete_stale=88.6ms
racio_projection.upsert=56.6ms
racio_projection.total=145.2ms
map.position_write=45ms
explorer.folder_position_read=47.4ms
explorer.folder_item_write=45.7ms
source.transaction_commit=26.2ms
source.transaction_repo=585ms
events.sequence_lock=91.9ms(3x)
events.insert=114ms(3x)
events.append.item_total=206.8ms(3x)
events.append.transaction=260.6ms
```

Async publish still ran, but no longer blocked the response:

```text
async_workspace_events_publish count=3 duration=823.1ms events.publish.total=823.1ms event_types=company_explorer_folder_item_assigned,node_created,node_map_positions_updated
```

Interpretation:

- Async publish worked.
- Raw node create dropped from about `1.2032s` request timing to `846.1ms`.
- Remaining blockers are synchronous transaction work and durable event append.
- To get under `500ms`, likely targets are `events.append.total=260.6ms`, `explorer.folder_setup=201.8ms(2x)`, and `racio_projection.total=145.2ms`.

### After Async Publish: Matrix Create Logic Gate Plus Node

User action: create a new node in an R view matrix cell, which also creates a new Logic Gate.

```text
request.total=2.0932s
request.accounted_total=2.0932s
request.unaccounted=0s
source.transaction_repo=2.0932s
events.publish.enqueue=0s
notifications.enqueue=0s
```

Important details:

```text
source.logic_gate=728.4ms(2x)
kanban.board_ensure=99.1ms
source.raci_assignment=57.3ms
racio_projection.delete_stale=98.7ms(3x)
racio_projection.upsert=105.9ms(3x)
racio_projection.total=206.3ms(3x)
racio_projection.sync_call=144ms(2x)
explorer.folder_setup=109.8ms(2x)
explorer.folder_position_read=46.3ms(2x)
explorer.folder_item_write=322.6ms
events.sequence_lock=139.8ms(6x)
events.insert=177ms(6x)
events.append.item_total=317.8ms(6x)
events.append.batch_total=317.8ms(2x)
events.append.total=317.8ms(2x)
kanban.column_read=50.2ms
source.node=409.2ms(2x)
source.assignment=1.2833s(2x)
kanban.card_trigger_assignment_sync=75.2ms(2x)
kanban.card_work=181.3ms
reread.racio_projection=45.7ms(2x)
reread.node=46.3ms
source.command_total=1.2453s
source.transaction_commit=35.5ms
```

Async side effects:

```text
async_notification_projection count=6 notifications=0 duration=230.5ms notifications.total=230.5ms event_types=company_explorer_folder_item_assigned,logic_gate_created,node_created,work_item.logic_gate_assignment_saved,kanban_card_upserted,node_updated
async_workspace_events_publish count=6 duration=2.2461s events.publish.total=2.2461s event_types=company_explorer_folder_item_assigned,logic_gate_created,node_created,work_item.logic_gate_assignment_saved,kanban_card_upserted,node_updated
```

Interpretation:

- Async publish/notification worked and cut this path roughly in half.
- The remaining problem is now transaction bloat.
- Biggest remaining targets are `source.assignment`, `source.logic_gate`, `source.node`, event append, folder item writes, RACIO projection, and legacy Kanban writes.

### After Async Publish: Move Node Between Logic Gates

User action: move a node from one Logic Gate to another.

```text
request.total=774.8ms
request.accounted_total=774.8ms
request.unaccounted=0s
source.transaction_repo=774.4ms
events.publish.enqueue=0s
notifications.enqueue=0s
```

Important details:

```text
reread.assignment=22.6ms
kanban.card_read=47.3ms(2x)
kanban.board_read=22.5ms
reread.node=49.2ms(2x)
kanban.column_read=45.4ms(2x)
source.assignment_position_read=22.1ms
source.node=24.3ms
source.assignment=23.5ms
kanban.email_reference_work=85.3ms(2x)
kanban.card_update=25.6ms
kanban.card_work=50.5ms(2x)
kanban.card_trigger_assignment_sync=24.9ms
source.access_policy_copy=96.8ms
racio_projection.delete_stale=24.1ms
racio_projection.upsert=25.8ms
racio_projection.total=50ms
racio_projection.sync_call=50ms
reread.racio_projection=26.1ms
events.sequence_lock=71.9ms(3x)
events.insert=87ms(3x)
events.append.item_total=158.9ms(3x)
events.append.total=158.9ms
source.transaction_commit=25.4ms
source.command_total=749.7ms
```

Async side effects:

```text
async_notification_projection count=3 notifications=0 duration=111.4ms notifications.total=111.4ms event_types=work_item.logic_gate_assignment_moved,kanban_card_moved,node_updated
async_workspace_events_publish count=3 duration=634.7ms events.publish.total=634.7ms event_types=work_item.logic_gate_assignment_moved,kanban_card_moved,node_updated
```

Interpretation:

- Async publish/notification worked.
- Move dropped from about `2.2478s` request timing to `774.8ms`.
- This path is now close to target.
- Remaining targets are event append, access policy copy, Kanban email reference work, Kanban card work, and RACIO projection sync.

### Before / After Summary

| Case | Before Async Publish | After Async Publish | Improvement |
| --- | ---: | ---: | ---: |
| Raw node create | `1.2032s` | `846.1ms` | about `30%` faster |
| Matrix create Logic Gate plus node | `4.1662s` | `2.0932s` | about `50%` faster |
| Move node between Logic Gates | `2.2478s` | `774.8ms` | about `66%` faster |

## Current Priority After Async Publish

The first major problem, synchronous post-commit publish/notification work, is now improved.

The next problem is synchronous transaction work and durable event append.

### Priority 1: Reduce Durable Event Append Cost

Current examples:

- Raw node create: `events.append.total=260.6ms`
- Matrix create: `events.append.total=317.8ms(2x)`
- Move between gates: `events.append.total=158.9ms`

Potential approaches:

- Batch domain event sequence allocation/locking/inserts per command.
- Reduce repeated per-event advisory lock or sequence work.
- Keep durable append synchronous for now.
- Do not drop events blindly.

### Priority 2: Reduce Event Count Where Safe

Current event counts:

- Raw node create: 3 events
- Matrix create: 6 events
- Move between gates: 3 events

Potential approaches:

- Replace multiple derived events with one richer command-level event where consumers can support it.
- Avoid `kanban_card_*` events once Kanban becomes projection-only.
- Keep payloads rich enough to avoid immediate follow-up rereads.

### Priority 3: Slim Repository Transactions

Raw node create targets:

- `explorer.folder_setup=201.8ms(2x)`
- `racio_projection.total=145.2ms`
- `events.append.total=260.6ms`

Move targets:

- `events.append.total=158.9ms`
- `source.access_policy_copy=96.8ms`
- `kanban.email_reference_work=85.3ms(2x)`
- `kanban.card_work=50.5ms(2x)`
- `racio_projection.total=50ms`

Matrix create targets:

- `source.assignment=1.2833s(2x)`
- `source.logic_gate=728.4ms(2x)`
- `source.node=409.2ms(2x)`
- `explorer.folder_item_write=322.6ms`
- `events.append.total=317.8ms(2x)`
- `racio_projection.total=206.3ms(3x)`
- `kanban.card_work=181.3ms`
- `kanban.card_trigger_assignment_sync=75.2ms(2x)`

## Recommended Next Change

Focus the next pass on event append/event count and the easiest transaction deletions.

Suggested scope:

1. Inspect domain event append implementation.
2. Reduce repeated sequence lock/insert overhead for 3-event and 6-event commands.
3. Collapse event count only where downstream consumers can safely handle a richer command-level event.
4. Improve raw node create first, targeting `<500ms`.
5. Improve move node second, targeting `<500ms`.
6. Improve matrix create third, targeting a measurable drop from `2.0932s` toward `1.3s` or better.

Do not start the full Kanban rewrite in the next pass unless event append batching/count reduction is insufficient or directly blocked by Kanban event consumers.

## Update: Durable Append Batching And New-Node Projection Slimming

This pass focused on durable append cost first, then made two low-risk transaction reductions for raw/new-node creation.

Code changes:

- `postgres_domain_events.go`: `AppendDomainEvents` now batches normal non-idempotent event groups by stream. A command batch now takes one stream advisory lock, one `max(sequence)` lookup, and one multi-row `insert ... select` per contiguous stream group instead of looping through one lock and one insert per event.
- Single-event appends and any batch with explicit `DomainEventInput.IdempotencyKey` still use the old per-event append path to preserve idempotency semantics.
- Batch append keeps durable append synchronous and returns events in sequence/input order.
- `postgres_racio_projection.go`: added a new-node projection path that upserts projection rows without first deleting stale rows. Newly inserted nodes cannot have stale projection rows.
- `postgres_workspace_entity_batch.go` and `postgres_nodes.go`: raw/new node creation now uses the new-node projection path.
- `postgres_kanban.go`: create-then-assign no longer projects the node once as standalone and then again after assignment; it skips the standalone projection and relies on the existing post-assignment projection.
- `postgres_company_explorer.go`: system folder ensure now folds the insert-or-existing select into one CTE-backed query instead of an insert attempt plus a separate select.

Event append behavior:

- Raw node create should still emit 3 events, but append should show roughly one `events.sequence_lock` and one `events.insert` span for the batch instead of 3 each.
- Move between Logic Gates should still emit 3 events, with one lock/insert batch for the moved/card/node events.
- Matrix create still emits the same 6 events. Because the Logic Gate creation append and assignment append are still separate call sites, it should now pay one lock/insert for the first 2 events and one lock/insert for the later assignment batch, not one lock/insert per event.
- `events.append.item_total` is not emitted on the new batch path; `events.append.batch_total`, `events.sequence_lock`, `events.insert`, and handler-level `events.append.total` remain.

Event count changes:

- No event types were removed in this pass.
- The audited consumers still make collapse unsafe without a broader compatibility change:
  - `workspace_read_versions.go` maps these event types to different list, map, explorer, Kanban, and snapshot scopes.
  - `workspace_effective_fanout.go` derives visibility targets from event payloads such as `logic_gate_id`, `board_id`, `item_type`, and `node_id`.
  - `notifications/service.go` consumes `work_item.logic_gate_assignment_*` for notification projection, and conditionally consumes `node_updated` when notification metadata is present.
  - Existing tests assert durable event order and types for assignment, Kanban, inbox, and workspace flows.

Expected timing impact:

The app benchmark actions were not rerun in this pass. Expected values below are estimates from the prior timing buckets.

| Case | Before this pass | Expected request-path after this pass | Expected savings |
| --- | ---: | ---: | ---: |
| Raw node create | `846.1ms` | roughly `550-650ms` | batched append, no stale projection delete for new node, one fewer system-folder query |
| Move between Logic Gates | `774.8ms` | roughly `650-725ms` | batched append only |
| Matrix create Logic Gate plus node | `2.0932s` | roughly `1.75-1.9s` | batched append, one fewer standalone node projection, one fewer system-folder query |

The raw path may still miss the `<500ms` target until the remaining folder item write, projection upsert, event trigger/read-version work, or response/reread costs are reduced.

Validation:

- `go test ./internal/store` passed.
- `go test ./internal/http` passed.
- `go test ./...` from `backend/` passed.

Remaining bottlenecks:

- Raw node create likely still spends meaningful time in durable append triggers/read-version updates, `racio_projection.upsert`, folder item write/position read, and creator/effective-access reads.
- Move still has `source.access_policy_copy`, `kanban.email_reference_work`, Kanban card work, RACIO sync/reread, and the now-batched durable append.
- Matrix create remains dominated by assignment/Logic Gate/node transaction work, explorer folder item write, RACIO projection/rereads, Kanban compatibility writes, and two separate append call sites.

Recommended next pass:

1. Rerun the three app benchmark actions and capture fresh `request_timing` plus async logs.
2. If raw is still above target, inspect the post-batch `events.append.total` breakdown and the `domain_events` read-version trigger cost.
3. Consider folding matrix create durable events into one append call only if the assignment helper can be refactored without changing event order or removing events.
4. For move, audit whether `copyPostgresLogicGateAccessPolicyToNodeTx` can be skipped when the target Logic Gate policy is unchanged or already equivalent on the node.
5. For move, audit communications email reference updates for no-op guards before broad Kanban rewrites.

## Update: Mutation-Origin Derived-Write Deferral

This pass focused on deleting non-immediate derived writes from the POST/PUT transaction path without changing the source-of-truth contract.

New request context:

- `POST /v1/workspace/entity-batches` now accepts `mutation_origin`.
- `POST /v2/racio-matrix/nodes`, `POST /v2/racio-matrix/nodes/{nodeID}/move`, `POST /v2/logic-gates/{id}/nodes`, and `POST /v2/logic-gates/{id}/nodes/{nodeID}/move` now carry a normalized mutation origin internally.
- Frontend callers now mark the surface that actually needs immediate derived state:
  - Company Explorer sends `company_explorer`.
  - Node Map sends `node_map`.
  - Logic Gate Map sends `logic_gate_map`.
  - Home/RACIO matrix paths send `matrix`.
  - Kanban paths send `kanban`.
  - Editor/sidebar text-selection creates send `editor`.

Deferred writes:

- Home/matrix/editor/kanban workspace entity creates no longer synchronously write Company Explorer folder items just to keep the Explorer projection current.
- Non-map workspace entity creates no longer synchronously write default node/Logic-Gate map positions.
- Matrix and Kanban-created nodes, plus matrix-created Logic Gates, now skip immediate Company Explorer folder item assignment.
- Deferred work is represented by internal durable domain events:
  - `company_explorer_folder_item_assign_requested`
  - `node_map_position_upsert_requested`
  - `logic_gate_map_position_upsert_requested`
- A new async workspace-derived projector consumes those internal events, writes the derived rows, appends the normal public projection events, and publishes those projected events.
- A new `workspace_derived_domain_event_projection_checkpoints` table tracks catch-up progress. Initial checkpoint setup starts at the latest existing event per company, matching the notification projector pattern, so deployment does not backfill historical events.
- Map-position projection uses `on conflict do nothing`, so delayed default placement does not overwrite a user-created map position.
- Frontend workspace stream/Home panel invalidation ignores the internal request events and waits for the public projected events.

What intentionally stayed synchronous:

- Source-of-truth rows stayed synchronous: `nodes`, `logic_gates`, `node_logic_gate_assignments`, RACI/access rows, and durable command events.
- Durable append of the internal deferred request events stayed synchronous. This preserves recovery/catch-up if the process exits before async projection finishes.
- The active surface still gets immediate writes. Company Explorer creates still write Explorer folder items; Node Map creates still write node map positions; Logic Gate Map creates still write Logic Gate map positions.
- Map creates with an explicit folder ID still synchronously write the Explorer folder item to preserve scoped map visibility for the current view.
- RACIO projection sync and rereads stayed synchronous because matrix/Home responses return projection rows and the frontend still applies those rows immediately.
- Legacy Kanban board/card writes stayed synchronous because active Kanban readers, read-version invalidation, and `kanban_card_*` events still depend on that compatibility model.
- Access policy copy stayed synchronous because it affects authorization correctness for the moved/assigned node. This pass only added an equivalence guard so already-matching policies skip the copy.

Other transaction slimming in this pass:

- `copyPostgresLogicGateAccessPolicyToNodeTx` now checks whether the target Logic Gate policy already matches the node policy before deleting/reinserting node permissions.
- Assignment paths can create a node without the standalone Explorer folder item write when the current mutation origin will defer that projection.

Expected timing impact:

The app benchmark actions were not rerun in this pass. Expected values are estimates from the latest measured buckets after async publish and durable append batching.

| Case | Before this pass / latest estimate | Expected request-path after this pass | Expected savings |
| --- | ---: | ---: | ---: |
| Raw node create | roughly `550-650ms` after append batching estimate | roughly `400-525ms` | removes sync Explorer folder setup/item writes and default map-position write from non-map Home creates |
| Matrix create Logic Gate plus node | roughly `1.75-1.9s` after append batching estimate | roughly `1.35-1.65s` | defers matrix-created Explorer folder items for the new Logic Gate/node |
| Move node between Logic Gates | roughly `650-725ms` after append batching estimate | roughly `550-725ms` | only improves when access policies are already equivalent and the new no-op guard skips copy |
| Create node in Logic Gate Kanban column | no fresh post-append benchmark | should drop by the skipped Explorer folder item write for newly created nodes | still pays legacy Kanban compatibility work |

Request timing after this pass should show smaller or absent spans for the non-owning surface writes:

```text
repo.CreateWorkspaceEntityBatch.folder_setup
repo.CreateWorkspaceEntityBatch.map_position_writes
repo.CreateWorkspaceEntityBatch.folder_item_writes
repo.createRacioMatrixLogicGateTx.folder_item_writes
repo.assignNodeToLogicGateStatusTx.node_writes
```

New async work should appear separately:

```text
derived_projection.enqueue=...
async_workspace_derived_projection count=... derived_projection.total=... event_types=...
```

Remaining bottlenecks:

- Durable event append is still synchronous and still emits multiple events per command.
- RACIO projection sync/rereads still sit in the request path for matrix/Home correctness.
- Legacy Kanban board/card writes and email reference work still sit in assignment/move transactions.
- Matrix create still performs combined Logic Gate creation, node creation, assignment, RACI/access setup, projection rereads, Kanban compatibility writes, and multiple append call sites.
- Async derived projection now adds eventual consistency for non-owning surfaces; clients should consume the later public projected events, not the internal request events.

Validation:

- `go test ./...` from `backend/` passed.
- `npm.cmd run build` from `frontend/` passed after installing frontend dependencies.
- `node scripts\run_all_tests.mjs` passed all frontend feature tests, production build, and backend Go tests.

Recommended next pass:

1. Rerun B1, B3/B5, B6, B7, and B8 in the app and capture fresh `request_timing`, `async_workspace_events_publish`, `async_notification_projection`, and `async_workspace_derived_projection` logs.
2. If raw node create is still above `<500ms`, inspect post-pass `events.append.total`, RACIO projection upsert, creator/effective-access rereads, and any remaining folder/map spans.
3. For moves, measure how often the access-policy no-op guard skips work. If the remaining cost is Kanban/email-reference dominated, add no-op guards there before attempting the full Kanban rewrite.
4. For matrix create, target RACIO delta writes/reread reduction and then consider folding the separate Logic Gate/create-assignment append call sites while preserving event order.
5. Keep the full Kanban projection rewrite as a separate larger pass unless the fresh timings prove it is the dominant remaining blocker.
