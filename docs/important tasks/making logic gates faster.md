# Making Logic Gates Faster

Last updated: 2026-07-11

## Problem

Opening the Logic Gate Arena could do more work than one logical board load requires:

- forced Logic Gate props and live selection could start separate `/work` requests;
- stale requests could finish after the user selected a different Logic Gate;
- cached board contents were not the single cache-first authority;
- ETags searched four `domain_events` shapes instead of reading one indexed version row;
- the cold Postgres path performed separate gate, access, GVIC, card, email-origin, and projection-sequence reads;
- the response repeated the same work through statuses, assignments, nodes, and cards.

The target architecture makes a logical Arena selection one cancelable, single-flight load, makes realtime deltas the normal reconciliation path, and makes the database read and wire contract Kanban-specific.

## Architecture

### One frontend board loader

All Logic Gate Arena loads use the shared board-content store. Forced props and live selection converge on the same guarded loader and cache key. The loader:

1. synchronously renders a complete cached snapshot when one exists;
2. shares an in-flight request for the same company/board;
3. aborts an obsolete request when the selected Logic Gate changes;
4. rejects a late response whose selection generation is no longer current;
5. applies a successful full snapshot once; and
6. reconciles exact card changes and projection sequence through realtime deltas.

Cache invalidation retains the last complete snapshot as stale data. It does not discard an in-flight request and start a duplicate request. A realtime delta updates the rendered state, cached snapshot, and projection sequence together. Sequence gaps, malformed deltas, and permission uncertainty request one targeted revalidation.

### Dedicated work version

`logic_gate_work_versions` has one row per `(company_id, logic_gate_id)`. Its generated `board_id` is `logic-gate:{logic_gate_id}`, with a unique company/board key. The primary key makes ETag lookup a single indexed row read.

The request still performs authorization before honoring `If-None-Match`. The ETag includes the work version, actor identity/permission flags, and a response-contract salt. A permission revocation therefore cannot be hidden by a stale `304`, and a code-only change to synthesized columns or serialization can invalidate old representations without inventing a database board row.

### Cold Postgres read

The cold path is shaped as:

1. one owning-Logic-Gate permission check;
2. one primary-key work-version lookup; and
3. one consolidated work query.

The consolidated query returns the Logic Gate header/resolved default access/request owner, board projection sequence, and minimal card rows. Email origin is calculated in the card read. It does not run a second email query or a per-row lateral lookup for redundant assignment memberships.

`kanban_board_projection.status_rank` stores the canonical sort rank as a generated column. The hot index orders by company, Logic Gate, status rank, manual position, assignment creation time, and assignment ID, so the database does not recompute the status sort for each read.

Canonical ranks are:

| Rank | Canonical lane | Accepted stored aliases |
| ---: | --- | --- |
| 0 | requested | requested, request, requests, r |
| 1 | backlog | backlog, backlogs, b |
| 2 | pending | pending, p, and unknown fallback |
| 3 | in progress | in progress, inprogress, ip |
| 4 | review | review |
| 5 | done | done, d |

## Kanban-Specific Response Contract

`GET /v2/logic-gates/{logic_gate_id}/work?company_id={company_id}` returns only:

```json
{
  "logic_gate": {
    "logic_gate_id": "uuid",
    "header": "Gate title",
    "default_access": "edit",
    "request_owner_user_id": "uuid"
  },
  "permissions": {
    "can_view": true,
    "can_edit": true,
    "can_admin": false
  },
  "board": {},
  "columns": [],
  "cards": [
    {
      "card_id": "uuid",
      "column_id": "pending",
      "node_id": "uuid",
      "node_title": "Card title",
      "requested_by_user_id": "uuid",
      "placed_by_user_id": "uuid",
      "is_issue": false,
      "position": 1000,
      "due_date": "2026-07-11",
      "priority": 3,
      "created_from_email": false,
      "accounts": [],
      "projection_updated_timestamp": "2026-07-11T12:00:00Z",
      "created_timestamp": "2026-07-11T11:00:00Z"
    }
  ],
  "projection_sequence": 42
}
```

Nullable/optional card values may be omitted according to normal JSON rules. The client derives repeated company, board, and Logic Gate identifiers from the request and enclosing snapshot when it hydrates generic UI card state.

The permanent response does not include top-level `company_id`, top-level `logic_gate_id`, `statuses`, `assignments`, `nodes`, `cards_limit`, or a full GVIC collection. `request_owner_user_id` is the only GVIC-derived field the board needs.

## Invalidation Matrix

| Response concern | Source mutation | Version action |
| --- | --- | --- |
| Gate header/default | `logic_gates` insert or header/default update | seed or bump that gate |
| Direct gate permission | `resource_permissions`, direct policy revision | bump that gate |
| Inherited Explorer permission/default | Logic Gate placement, ancestor folder move/default change, permission subtree application | bump the placed gate or all descendant gates |
| Actor permission result | company role, group membership, or group hierarchy change | conservatively bump all company gates |
| Request owner/GVIC header data | direct Logic Gate GVIC assignment or policy revision | bump that gate |
| Assignment/status/issue/order/provenance | `node_logic_gate_assignments` | bump old and/or new gate |
| Card projection fields, including account snapshot | `kanban_board_projection` | bump old and/or new gate |
| Node title/due date/priority source change | `nodes` for an assigned node | bump assigned gate; projection write bumps again when visible data changes |
| Direct email-created marker | `communications_email_nodes` | bump old and/or new gate |
| Mounted-board change hint | Direct post-commit `kanban.changed` on `board:{board_id}` | canonical `/work` reload reads the bumped work version; no projection cursor |
| Synthesized board/columns/status constants | application release | change response-contract salt |

Deletes of a Logic Gate cascade its version row. The response becomes not found, so a deleted gate does not retain an orphaned cache-version record.

## Migration And Deployment Boundary

Migration: `backend/db/migrations/20260711_logic_gate_work_fast_path.sql`.

It:

- adds stored `status_rank`;
- replaces the old computed-status hot index;
- creates and seeds `logic_gate_work_versions`;
- creates scoped bump helpers and source-table triggers; and
- is mirrored in `backend/db/schema.sql`.

The migration was prepared and source-verified locally only. It was not applied to a local, dev, or production database, and no live database credentials were used.

Deployment must use the normal human-controlled migration path. Apply the migration before deploying code that selects `status_rank` or `logic_gate_work_versions`. The operator should account for the projection-table column/index build lock and duration, verify the seeded row count against `logic_gates`, then deploy the application and observe `/work` latency, request count, ETag/304 rate, and realtime fallback rate.

## Verification Contract

Focused coverage must prove:

- forced/live loader convergence and same-key single-flight deduplication;
- cancellation for A-to-B and stale-response rejection for A-to-B-to-A;
- cache-first rendering followed by realtime reconciliation;
- no duplicate render/state churn for one logical load;
- exact projection-delta handling, including `created_from_email`;
- one primary-key version lookup instead of four event searches;
- invalidation for every row in the matrix;
- exact authorization, ordering, request-owner, account, assignment, email-origin, and projection-sequence semantics;
- migration/canonical-schema parity and generated status rank; and
- serialization of the minimal response plus explicit absence of redundant collections.

Required verification includes focused Go tests, focused frontend tests, frontend typecheck/build, `git diff --check`, and `node scripts/run_all_tests.mjs` when dependencies permit.

## Structurally Proven Performance Improvements

Without relying on a live database benchmark, the implementation proves these reductions by construction:

- four JSON/domain-event ETag searches become one primary-key lookup;
- repeated forced/live requests become one same-key in-flight request;
- obsolete cross-gate reads are canceled and cannot commit stale state;
- the normal realtime path patches a snapshot instead of reloading the full board;
- the cold work body is produced by one consolidated query after access/version reads;
- the second email-origin query and per-row redundant assignment-membership lookup are removed;
- status ordering uses an indexed stored rank; and
- each card is serialized once instead of repeated through four collections.

Production latency and byte reductions still require post-deployment observation because no live database or production traffic was used during implementation.
