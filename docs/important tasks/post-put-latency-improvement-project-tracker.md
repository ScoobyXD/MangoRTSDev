# POST/PUT Latency Improvement Project Tracker

## Goal

Reduce node, Logic Gate, Kanban, and RACIO matrix create/update/move operations from multi-second request paths to sub-500ms backend writes where possible.

This is not primarily an optimistic UI project. The measured backend POST/PUT path is itself too slow.

## Current Diagnosis

The timing logs redirected the project. The largest measured cost is often not RACIO projection or Kanban. It is synchronous domain event publishing.

Measured examples:

- Raw node creation: `domain_event_publish=829.9ms` of `1.722s`.
- Logic Gate creation: `domain_event_publish=744ms-777ms`.
- Create Logic Gate plus node in RACIO matrix: `domain_event_publish=2.046s-2.299s`.
- Move node between Logic Gates: `domain_event_publish=664ms`, plus `notification_projection=335ms`.

Repository transactions are still too heavy, but the event pipeline is the first fire.

## Benchmark Cases

Every phase must rerun these cases and update the table.

| ID | User Operation | Endpoint Pattern | Current Time | Primary Measured Problems | Fix Path |
| --- | --- | --- | ---: | --- | --- |
| B1 | Create raw node in Others section | `POST /v1/workspace/entity-batches` | `1.7221402s` | `domain_event_publish=829.9ms`, `repository_transaction=520ms`, `domain_event_append=260.3ms` | Async publish, reduce event append, slim entity-batch transaction |
| B2 | Create Logic Gate from Others priority/status matrix path | `POST /v1/workspace/entity-batches` | `1.4256028s` | `domain_event_publish=777.1ms`, `repository_transaction=386ms`, `domain_event_append=214.6ms`, `ensureLogicGateKanbanBoardSQL=106.6ms` | Async publish, reduce event append, remove legacy Kanban board ensure from hot path |
| B3 | Create node in empty Others matrix cell, creating Logic Gate plus node | `POST /v2/racio-matrix/nodes` | `4.683535s` | `domain_event_publish=2.2991s`, `repository_transaction=2.1272s`, `notification_projection=210.3ms`, assignment tx `1.3664s` | Async publish/notifications, reduce 6-event write path, delete Kanban assignment/card work, reduce folder/item and projection work |
| B4 | Create Logic Gate in empty R matrix cell | `POST /v1/workspace/entity-batches` | `1.6836499s` | `domain_event_publish=744.4ms`, `repository_transaction=658.4ms`, `domain_event_append=233.5ms`, RACI/projection/folder work | Async publish, reduce event append, slim Logic Gate create transaction |
| B5 | Create node in R matrix, creating Logic Gate plus node | `POST /v2/racio-matrix/nodes` | `4.3368561s` | `domain_event_publish=2.0461s`, `repository_transaction=2.0411s`, `notification_projection=199.2ms`, assignment tx `1.3386s` | Same as B3, plus RACI projection path review |
| B6 | Move node from one Logic Gate to another in matrix | `POST /v2/racio-matrix/nodes/{nodeID}/move` | `2.438184s` | `repository_transaction=1.3842s`, `domain_event_publish=664.2ms`, `notification_projection=334.7ms`, repeated Kanban reads/work, `access_policy_copy=185.3ms`, `email_reference_work=158.2ms(2x)` | Async publish/notifications, delete Kanban card work, review access copy/email reference work, delta projection |
| B7 | Create node in Logic Gate Kanban column | `POST /v2/logic-gates/{id}/nodes` | `3.5826761s` | Needs detailed timing | Rerun with timing, then treat as assignment hot path |
| B8 | Create new node on existing Logic Gate in RACIO matrix | `POST /v1/workspace/entity-batches`, then `POST /v2/logic-gates/{id}/nodes` | `3.2316668s` write time, about `4.066s` logged | Two serial writes plus GET storm | One command endpoint, async publish, assignment transaction cleanup |

Note: one user label said "node creation on the Others priority/status matrix", but the timing trace shows `logic_gate_writes` and `ensureLogicGateKanbanBoardSQL`, so this tracker treats it as Logic Gate creation unless a later trace proves otherwise.

## Source-Of-Truth Direction

Authoritative write model:

- `nodes`
- `logic_gates`
- `node_logic_gate_assignments`
- RACI/access tables

Kanban should be a read model/projection derived from authoritative tables.

Minimal target shape:

```text
kanban_board_projection
  company_id
  logic_gate_id
  node_id
```

Values that should remain sourced elsewhere:

- Node status: `nodes.status`
- Node priority, if a view still needs it: `nodes.priority`
- Assignee/person in charge: source column on `nodes` or the current authoritative owner
- Card/node position in a Logic Gate: likely `node_logic_gate_assignments.position`
- Column identity: derived from `nodes.status`

Open design decisions:

- If card position is assignment-specific, keep it in `node_logic_gate_assignments`.
- If column order is global/static, keep it in application/status configuration.
- If column order is company- or Logic-Gate-specific, add a small status/column config table. Do not make `kanban_cards` authoritative again.
- If `kanban_board_projection` only contains `company_id`, `logic_gate_id`, and `node_id`, confirm whether a physical table is needed or whether an indexed query/materialized view over `node_logic_gate_assignments` is enough.

## Phase 1: Benchmark Coverage And Event Publish Root Cause

Status: Started.

Goal: Make the benchmark suite complete and explain exactly why `domain_event_publish` is slow.

Tasks:

- [x] Add first-pass per-section timing to key POST/PUT endpoints.
- [x] Capture detailed timing for B1 through B6.
- [ ] Capture detailed timing for B7, create node in Logic Gate Kanban column.
- [ ] Capture detailed timing for B8, create node on existing Logic Gate in RACIO matrix.
- [ ] Break down `domain_event_publish` internals.
- [ ] Identify whether `domain_event_publish` is slow because of SSE/websocket fan-out, synchronous listener work, client backpressure, serialization, read-version work, locking, or another cause.
- [ ] Break down domain event append by event type and count.
- [ ] Count database statements per benchmark case.
- [ ] Record whether GET storms are triggered before or after each mutation.

Success criteria:

- Every benchmark case has detailed timing.
- The team can explain the `domain_event_publish=664ms-2.299s` delays.
- We know the exact event list emitted by each benchmark case.

## Phase 2: Remove Event Publishing And Notifications From The HTTP Critical Path

Status: Not started.

Goal: Return HTTP responses after the authoritative transaction and durable event append, without waiting for fan-out or notification projection.

Tasks:

- [ ] Convert domain event publishing after commit into async outbox/background dispatch.
- [ ] Ensure HTTP responses do not wait for `domain_event_publish`.
- [ ] Keep committed domain events durable before response.
- [ ] Confirm clients can recover from delayed/missed publish through version/snapshot/catch-up behavior.
- [ ] Move notification projection out of the synchronous HTTP response path.
- [ ] Confirm notification catch-up works from committed domain events.
- [ ] Rerun B1 through B8.

Expected impact from current logs:

- B1 raw node create: save about `830ms`.
- B2/B4 Logic Gate creates: save about `744ms-777ms`.
- B3/B5 RACIO create Logic Gate plus node: save about `2.0s-2.3s`, plus about `200ms` from async notification projection.
- B6 move between Logic Gates: save about `664ms`, plus about `335ms` from async notification projection.

Success criteria:

- `domain_event_publish` no longer contributes to request duration.
- `notification_projection` no longer contributes to request duration.
- B3/B5 fall from about `4.3s-4.7s` toward about `2.0s-2.2s` before deeper transaction cleanup.

## Phase 3: Reduce Event Append Cost And Event Spam

Status: Not started.

Goal: Reduce event writes, advisory locks, read-version trigger work, and repeated payload work.

Tasks:

- [ ] List exact events emitted by B1 through B8.
- [ ] Collapse multiple events for one user action into one command-level event where possible.
- [ ] Avoid legacy `kanban_card_*` events once Kanban is projection-only or when a command event can carry the needed payload.
- [ ] Reduce read-version trigger churn caused by multiple events for one mutation.
- [ ] Batch sequence allocation/advisory locking per command if possible.
- [ ] Keep event payloads rich enough that clients/read models do not need immediate follow-up reads.
- [ ] Rerun B1 through B8.

Expected impact from current logs:

- B1/B2/B4 simple creates may save about `200ms-260ms`.
- B3/B5 RACIO create paths may save several hundred milliseconds because they append up to 6 events.
- B6 move may save about `190ms`.

Success criteria:

- One user action emits the minimum event payload needed.
- `domain_event_append` is no longer a top-three cost for simple creates.

## Phase 4: Slim Repository Transactions And Delete Legacy Kanban Writes

Status: Not started.

Goal: Cut the remaining transaction time by deleting redundant writes and old Kanban write-model behavior.

Tasks:

- [ ] For B1, slim entity-batch raw node creation: review folder setup, map position writes, folder item writes, RACIO projection sync, and event creation.
- [ ] For B2/B4, slim Logic Gate creation: review board ensure, RACI assignment writes, RACIO projection sync, map/folder writes.
- [ ] For B3/B5, slim RACIO create Logic Gate plus node: review folder item writes, duplicate node writes, assignment transaction, projection syncs, projection rereads.
- [ ] For B6, slim move between gates: review repeated Kanban reads, `email_reference_work`, `access_policy_copy`, projection rereads, and node rereads.
- [ ] Finalize whether Kanban projection is a physical table, materialized view, or indexed read query.
- [ ] Introduce the minimal Kanban projection/read path.
- [ ] Update Kanban reads to use the projection/read path.
- [ ] Stop writing `kanban_cards` on hot create/move/assign paths.
- [ ] Stop ensuring `kanban_boards` and `kanban_columns` during hot mutations unless still required by a temporary legacy read path.
- [ ] Delete or bypass the `kanban_cards -> node_logic_gate_assignments` trigger for new command paths.
- [ ] Rerun B1 through B8.

Success criteria:

- Hot Kanban operations update source-of-truth tables first.
- Kanban projection is updated from source-of-truth data.
- Hot paths no longer write `kanban_cards` and then trigger assignment writes back from `kanban_cards`.
- Repository transaction time is no longer above `500ms` for simple B1/B2/B4 creates.

## Phase 5: Command Endpoints, RACIO Deltas, And GET Storm Cleanup

Status: Not started.

Goal: Stop composing one user action from multiple serial requests and reduce derived read-model work.

Tasks:

- [ ] Collapse B8 "create node then assign to existing Logic Gate" into one backend command.
- [ ] Add/finalize one command for raw standalone node creation.
- [ ] Add/finalize one command for standalone Logic Gate creation.
- [ ] Add/finalize one command for node creation inside an existing Logic Gate.
- [ ] Add/finalize one command for Logic Gate plus node creation in a RACIO matrix cell.
- [ ] Add/finalize one command for moving a node within the same Logic Gate.
- [ ] Add/finalize one command for moving a node between Logic Gates.
- [ ] Add/finalize one command for moving node(s) to a new empty RACIO matrix cell.
- [ ] Convert RACIO node create projection work to direct inserts where possible.
- [ ] Convert RACIO node move projection work to direct updates where possible.
- [ ] Convert RACIO node delete projection work to direct deletes where possible.
- [ ] Keep broader recompute paths only for genuinely broad changes such as RACI/access changes.
- [ ] Avoid projection rereads unless the frontend response actually needs them.
- [ ] Remove redundant workspace snapshot/folder/node/logic-gate GET storms after successful mutations.
- [ ] Rerun B1 through B8.

Success criteria:

- B8 no longer performs `POST /v1/workspace/entity-batches` followed by `POST /v2/logic-gates/{id}/nodes`.
- Empty-cell create/move flows are one command from the frontend perspective.
- RACIO projection writes are mostly insert/update/delete deltas.
- GET storms are reserved for recovery, version gaps, or explicit refresh.

## Benchmark Table

Update this table after each phase.

| Case | Baseline | After Phase 2 | After Phase 3 | After Phase 4 | After Phase 5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| B1 Raw node in Others | `1.7221402s` |  |  |  |  |
| B2 Logic Gate from Others priority/status matrix path | `1.4256028s` |  |  |  |  |
| B3 Node in empty Others matrix cell | `4.683535s` |  |  |  |  |
| B4 Logic Gate in empty R matrix cell | `1.6836499s` |  |  |  |  |
| B5 Node in R matrix | `4.3368561s` |  |  |  |  |
| B6 Move node between Logic Gates | `2.438184s` |  |  |  |  |
| B7 Node in Logic Gate Kanban column | `3.5826761s`, needs detailed timing |  |  |  |  |
| B8 Node on existing Logic Gate in RACIO matrix | `3.2316668s writes`, needs detailed timing |  |  |  |  |

## Guardrails

- Do not optimize blind. Use timing logs to choose deletion targets.
- Do not parallelize duplicated work. Delete or simplify waste first.
- Do not make projections authoritative. Projections must be disposable and rebuildable.
- Prefer one command per user action over frontend request choreography.
- Prioritize removing synchronous event fan-out before deep Kanban surgery, because current logs show event publish is often the largest measured cost.
