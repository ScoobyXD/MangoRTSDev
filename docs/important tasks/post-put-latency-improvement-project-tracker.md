# POST/PUT Latency Improvement Project Tracker

## Goal

Reduce create, update, and move operations for nodes, Logic Gates, Kanban, and the RACIO matrix from multi-second request paths to sub-500ms backend writes where possible.

This project is not primarily an optimistic UI project. Optimistic UI may still be useful later, but the core goal is to remove unnecessary synchronous backend work, redundant writes, legacy Kanban state, and broad read-model refresh behavior.

## Baseline Logs

These logs are the initial benchmark scenarios. They should be rerun after every phase.

| Scenario | Requests | Write Time | Extra GET Time | Known Logged Total |
| --- | --- | ---: | ---: | ---: |
| Create node in Logic Gate Kanban column | `POST /v2/logic-gates/{id}/nodes` | `3.5826761s` | not shown | `3.5826761s+` |
| Create raw node in Others section | `POST /v1/workspace/entity-batches` | `1.4209458s` | not shown | `1.4209458s+` |
| Create new node on existing Logic Gate in RACIO matrix | `POST /v1/workspace/entity-batches`, then `POST /v2/logic-gates/{id}/nodes` | `1.2825372s + 1.9491296s = 3.2316668s` | about `835ms` summed | about `4.066s` summed |
| Create new Logic Gate on matrix | `POST /v1/workspace/entity-batches` | `1.5507929s` | about `211ms` summed | about `1.762s` summed |
| Create node on empty priority/status cell, creating Logic Gate plus node | `POST /v2/racio-matrix/nodes` | `3.9318806s` | about `671ms` summed | about `4.603s` summed |

## Current Working Theory

The slow paths are likely caused by several synchronous costs stacking together:

- Main database transaction performs too many reads and writes per mutation.
- Legacy Kanban tables behave like a second write model.
- `kanban_cards` can trigger writes back into `node_logic_gate_assignments`.
- RACIO projection sync is scoped, but still recompute-style instead of minimal delta writes.
- Domain event append is chatty and may trigger read-version updates multiple times per user action.
- Notification projection happens before the HTTP response returns.
- Frontend mutation success can trigger redundant panel/snapshot reloads.
- Some user actions are still composed from multiple serial POST/PUT operations.

## Source-Of-Truth Direction

The authoritative write model should be:

- `nodes`
- `logic_gates`
- `node_logic_gate_assignments`
- RACI/access tables

Kanban should become a read model/projection derived from the authoritative tables.

The proposed Kanban projection should stay minimal. It should not duplicate values already owned by source tables.

Initial target shape:

```text
kanban_board_projection
  company_id
  logic_gate_id
  node_id
```

Values that should remain sourced elsewhere:

- Node status: `nodes.status`
- Node priority: `nodes.priority`, if still needed by a view
- Assignee/person in charge: `nodes.assignee_user_id` or equivalent source column
- Card/node position in a Logic Gate: likely `node_logic_gate_assignments.position`
- Column identity: likely derived from `nodes.status`

Open design question:

- If card position is assignment-specific, it belongs in `node_logic_gate_assignments`.
- If column order is global/static, it should live in application/status configuration.
- If column order is company- or Logic-Gate-specific, that needs a small status/column configuration table. It should not make `kanban_cards` authoritative again.
- If `kanban_board_projection` only contains `company_id`, `logic_gate_id`, and `node_id`, confirm whether a physical table is needed or whether an indexed query/materialized projection over `node_logic_gate_assignments` is enough.

## Phase 1: Timing Instrumentation And Benchmarks

Status: Not started.

Goal: Stop guessing. Add internal timing spans to the slow endpoints and rerun the five baseline scenarios.

Tasks:

- [ ] Add per-section timing to `POST /v1/workspace/entity-batches`.
- [ ] Add per-section timing to `POST /v2/logic-gates/{id}/nodes`.
- [ ] Add per-section timing to `PUT /v2/logic-gates/{id}/nodes/{nodeID}/state`.
- [ ] Add per-section timing to `POST /v2/racio-matrix/nodes`.
- [ ] Add per-section timing to `POST /v2/racio-matrix/nodes/{nodeID}/move`.
- [ ] Include timing for auth/access checks.
- [ ] Include timing for main repository transaction.
- [ ] Include timing for Kanban board/column/card work.
- [ ] Include timing for RACIO projection sync and projection rereads.
- [ ] Include timing for domain event append/publish.
- [ ] Include timing for synchronous notification projection.
- [ ] Include timing for response serialization.
- [ ] Add frontend request timing around the same scenarios, including surrounding GET reloads.
- [ ] Rerun and record the five baseline scenarios.

Success criteria:

- Every slow POST/PUT log has a breakdown that explains where the time went.
- The five baseline scenarios are recorded with before/after phase-1 timings.
- We can name the top three measured bottlenecks instead of relying on source-level guesses.

## Phase 2: Delete Synchronous Non-Critical Work

Status: Not started.

Goal: Remove work from the request path that does not need to block mutation success.

Tasks:

- [ ] Move notification projection out of the synchronous HTTP response path.
- [ ] Ensure committed domain events are enough for async notification catch-up.
- [ ] Remove redundant panel/snapshot reloads after writes when local mutation payloads or events can patch state.
- [ ] Keep full panel/snapshot reload only for recovery cases such as missed events, version gaps, or explicit user refresh.
- [ ] Rerun the five baseline scenarios.

Success criteria:

- Mutation responses no longer wait for notification fan-out/projection.
- Successful local mutations do not immediately cause broad GET reload storms.
- POST/PUT duration decreases measurably before any deeper schema changes.

## Phase 3: Kill And Redo Legacy Kanban Board Writes

Status: Not started.

Goal: Make Kanban a projection/read model instead of a second source of truth.

Tasks:

- [ ] Finalize the minimal `kanban_board_projection` shape.
- [ ] Decide where card position and column ordering belong.
- [ ] Introduce `kanban_board_projection` or an equivalent materialized read path.
- [ ] Update Kanban reads to use the projection/read path.
- [ ] Stop writing `kanban_cards` on hot create/move/assign paths.
- [ ] Stop ensuring `kanban_boards` and `kanban_columns` during hot mutations unless still required by a legacy read path.
- [ ] Delete or bypass the `kanban_cards -> node_logic_gate_assignments` trigger for new command paths.
- [ ] Keep a temporary compatibility path only if needed for legacy endpoints.
- [ ] Rerun the five baseline scenarios.

Success criteria:

- Creating or moving a node in Kanban updates source-of-truth tables first.
- Kanban projection is updated from source-of-truth data.
- Hot paths no longer write `kanban_cards` and then trigger assignment writes back from `kanban_cards`.
- Existing Kanban UI behavior remains correct.

## Phase 4: Command Endpoints Match User Actions

Status: Not started.

Goal: Stop composing one user action from multiple serial POST/PUT operations.

Tasks:

- [ ] Collapse "create node then assign to existing Logic Gate" into one command.
- [ ] Add or finalize one command for creating a raw standalone node.
- [ ] Add or finalize one command for creating a standalone Logic Gate.
- [ ] Add or finalize one command for creating a node inside an existing Logic Gate.
- [ ] Add or finalize one command for creating a Logic Gate plus node in a RACIO matrix cell.
- [ ] Add or finalize one command for moving a node within the same Logic Gate.
- [ ] Add or finalize one command for moving a node between Logic Gates.
- [ ] Add or finalize one command for moving node(s) to a new empty RACIO matrix cell.
- [ ] Update frontend flows to call the command matching the user action.
- [ ] Rerun the five baseline scenarios.

Success criteria:

- The RACIO matrix existing-gate create path no longer performs `POST /v1/workspace/entity-batches` followed by `POST /v2/logic-gates/{id}/nodes`.
- Empty-cell create/move flows are one command from the frontend perspective.
- Multi-node or multi-gate actions use batch-capable commands where appropriate.

## Phase 5: Reduce Event Spam And Make RACIO Projection Delta-Based

Status: Not started.

Goal: Reduce derived-write overhead after the source-of-truth mutation is clean.

Tasks:

- [ ] Collapse multiple domain events for one user action into one command-level event where possible.
- [ ] Avoid emitting separate `kanban_card_*` events once Kanban is projection-only.
- [ ] Reduce read-version trigger churn caused by multiple events for one mutation.
- [ ] Convert RACIO node create projection work to direct inserts where possible.
- [ ] Convert RACIO node move projection work to direct updates where possible.
- [ ] Convert RACIO node delete projection work to direct deletes where possible.
- [ ] Keep broader recompute paths only for genuinely broad changes such as RACI/access changes.
- [ ] Avoid projection rereads unless the frontend response actually needs them.
- [ ] Rerun the five baseline scenarios.

Success criteria:

- One user action emits the minimum event payload needed for clients/read models.
- RACIO projection writes are mostly insert/update/delete deltas, not delete/recompute/upsert cycles.
- The five benchmark scenarios approach or beat the sub-500ms backend target where the database is local and uncontended.

## Benchmark Table

Update this table after each phase.

| Scenario | Baseline | After Phase 1 | After Phase 2 | After Phase 3 | After Phase 4 | After Phase 5 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Create node in Logic Gate Kanban column | `3.5826761s` |  |  |  |  |  |
| Create raw node in Others section | `1.4209458s` |  |  |  |  |  |
| Create new node on existing Logic Gate in RACIO matrix | `~4.066s logged, 3.2316668s writes` |  |  |  |  |  |
| Create new Logic Gate on matrix | `~1.762s logged, 1.5507929s write` |  |  |  |  |  |
| Create node on empty priority/status cell | `~4.603s logged, 3.9318806s write` |  |  |  |  |  |

## Notes

- Do not optimize blind. Phase 1 should identify the exact measured bottlenecks.
- Do not parallelize duplicated work. Delete or simplify waste first, then consider parallelism.
- Avoid making projections authoritative. Projections should be disposable and rebuildable.
- Prefer one command per user action over frontend request choreography.
