# Architecture Remediation Tracker

This tracker turns the repeated audit findings into five root problems. The goal is to avoid one branch per symptom and instead move the app through a small number of architecture migrations.

Source architecture:
- `docs/v2-architecture-doc.md`
- `docs/latency-obsession-architecture.md`
- `docs/Sacred Text.txt`

## Operating Rules

- Do not run many agents against the same foundation files at the same time.
- Serialize changes to shared contracts: repository interfaces, migrations, workspace handlers, auth middleware, event publishing, and the shared frontend API client.
- Prefer additive migrations: add the new command/read/event path, switch one surface, then remove the old path after it is no longer hot.
- A branch is done only when it has tests, migration/backfill notes when needed, and a clear rollback story.
- Full-company convenience reads are compatibility/admin/debug paths only. Product hot paths should use bounded read models.

## Progress Summary

| Theme | Status | Current Read |
| --- | --- | --- |
| 1. Read Plane | Partial / yellow | Scoped workspace snapshots and cheap event ETags exist, but several scopes can still be unbounded and the app lacks first-class read models for inboxes and windows. |
| 2. Event Plane | Partial / yellow | `domain_events`, SSE IDs, replay, and frontend cursors exist. Mutation plus event append is still not atomic across the app, and fanout/gap policy is not production-grade. |
| 3. Work Ownership / Commands | Confirmed / red | Current Logic Gate work state is mostly Kanban-card backed, but command ownership is missing and frontend flows still orchestrate multi-step writes. |
| 4. Hot Path Discipline | Ready / red | The first fix is clear: remove GET/runtime-DDL side effects before broader context, auth-cache, batch, and metrics work. |
| 5. Frontend Structure / API Contract | Ready / yellow | Shared `requestJSON` exists, but hot modules duplicate wrappers, broad invalidation is scattered, and large components still own workflow logic. |

## 1. Read Plane

Problem:
The product still depends too much on broad workspace-style reads instead of bounded read models per surface.

Evidence:
- `backend/internal/http/workspace_handlers.go` defaults `/v1/workspace/snapshot` to `scope=company_explorer` and uses cheap event validators before payload assembly.
- `scope=full` still loads nodes, relationships, Logic Gates, explorer folders/items, map positions, and Kanban data in one response.
- `scope=node_map` without `folder_id` still lists all nodes, relationships, positions, folders, and folder items.
- `scope=company_explorer` can list broad folders/items plus node and Logic Gate summaries.
- ACI/R inboxes are still largely browser-derived from loaded nodes and Logic Gates rather than authoritative read APIs.

Target architecture:
- Read APIs are surface-specific and bounded.
- Read models have cheap version rows or equivalent validators.
- Hot reads return `304` before loading or marshaling large payloads.
- UI and headless agents consume the same authoritative read APIs.

First branch:
`reads/inbox-read-model-contract`

Scope:
- Define server response contracts for:
  - Responsible Inbox
  - ACI Inbox
  - My Nodes
  - My Logic Gates
- Add read-only endpoints backed by current tables first.
- Do not introduce a large projection system in the first branch unless the endpoint needs it.

Follow-up branches:
- `reads/company-explorer-subtree`
- `reads/node-map-window`
- `reads/logic-gate-map-window`
- `reads/version-row-etags`

Completion criteria:
- No frontend hot path needs `scope=full`.
- Map and explorer hot surfaces require `folder_id`, window, cursor, query, or equivalent bounded selector.
- ACI/R inboxes are backed by backend read APIs.
- Cheap validators do not require payload assembly.

## 2. Event Plane

Problem:
The durable event foundation exists, but most mutations still write state first and append/publish events afterward.

Evidence:
- `domain_events` exists in schema and migrations.
- Workspace SSE supports `after_sequence`, `Last-Event-ID`, durable catch-up, and SSE `id`.
- Frontend workspace stream stores a sequence cursor and reconnects with it.
- Handlers still commonly mutate via repository methods and then call `publishWorkspaceEvent`.
- `publishWorkspaceEvent` appends a workspace domain event after the mutation and logs failures.
- In-process hub delivery is only an optimization; cross-instance delivery depends on polling catch-up, not an external fanout system.
- Frontend suppresses stale/duplicate event IDs but does not yet detect numeric sequence gaps as a first-class reconciliation signal.

Target architecture:
- Important mutations append durable events in the same transaction as the data write.
- Event append failure fails the command before commit.
- SSE/WebSocket delivery streams from durable events; in-memory delivery is an acceleration path only.
- Clients persist/apply sequence cursors and treat gaps as scoped reconciliation triggers.

First branch:
`events/atomic-workspace-outbox-node-graph`

Scope:
- Convert one vertical slice first: node create/update/delete and node relationship create/delete.
- Add a transactional mutation plus workspace event append path.
- Publish to the hub only after commit.
- Add tests proving committed mutations have events and failed mutations do not.

Follow-up branches:
- `events/atomic-kanban-workspace-events`
- `events/frontend-gap-reconciliation`
- `events/external-fanout-adapter`

Completion criteria:
- Workspace event sequence is the canonical cache invalidation source for converted mutations.
- Reconnect replay can recover missed converted mutations.
- No converted handler can commit data while losing its domain event.
- A clear fanout choice exists for multi-instance deployment: Postgres `LISTEN/NOTIFY`, Redis/Valkey, SQS/SNS, EventBridge, or another explicit adapter.

## 3. Work Ownership / Commands

Problem:
Everyday work state has no single owner. Node status, priority, assignee, Logic Gate membership, Kanban placement, RACI, and email conversion are spread across tables, persistence helpers, and frontend workflows.

Evidence:
- Nodes have direct fields such as `status`, `status_color`, `priority`, and `assignee_user_id`.
- Node reads derive `logic_gate_ids` from Kanban/Logic Gate placement.
- Kanban persistence updates node status/color and assigns the first responsible Logic Gate user as side effects.
- Home and Kanban flows still perform multi-step client orchestration.
- Logic Gate RACI and shared inbox RACI use full-replace update patterns.
- Email triage conversion creates nodes, folder items, positions, Kanban cards, email links, projections, deletes triage rows, syncs status, and assigns responsible users in one store-level transaction.

Current truth model:
- Logic Gate work assignment/status is mostly Kanban-card backed today.
- Node status is fallback or derived state for nodes that are not on a Logic Gate board.
- Assignee still lives directly on `nodes.assignee_user_id`, with Kanban placement auto-assigning the first Responsible RACI user.
- This is usable as a migration starting point, but it needs one command owner.

Target architecture:
- A backend command owns "node assigned to Logic Gate/status/priority/person/position."
- The first implementation can use existing Kanban card plus node fields as the persistence model.
- A later design can decide whether to introduce `work_items` or `node_logic_gate_assignments` as the long-term source table.
- Kanban, Home, Inbox, Arena, and agent APIs call the same commands.
- RACI changes are idempotent add/remove commands with version checks, not full replacement.
- Email-to-work is a product command with explicit existing/new Logic Gate modes and provenance.

First branch:
`work-items/assignment-command-existing-model`

Scope:
- Add a backend command/service for assigning a node to a Logic Gate status column.
- The command owns Kanban card upsert/move, derived node status/color, optional priority, and explicit assignee policy.
- Move one frontend flow onto it first, preferably Home drop/status placement.
- Add tests proving status comes from Kanban column or `is_issue`, Logic Gate membership comes from the card, and direct node status is fallback-only.
- Do not add a new source-of-truth table in this branch.

Design branch after the first slice:
`work-items/source-of-truth-design`

Scope:
- Decide whether existing Kanban-card-backed ownership is enough or whether the app needs `work_items` / `node_logic_gate_assignments`.
- Define table shape, backfill plan, compatibility reads, command list, and event taxonomy only if a new table is justified.

Follow-up branches:
- `work-items/raci-add-remove-commands`
- `work-items/home-drop-command`
- `work-items/email-conversion-command`
- `work-items/inbox-command-parity`

Completion criteria:
- One backend command can assign a node to Logic Gate, status, priority, and responsible user atomically.
- UI no longer needs multi-request choreography for normal work placement.
- Kanban status, node status, and inbox status cannot drift for migrated flows.
- RACI updates have idempotent add/remove APIs with concurrency protection.

## 4. Hot Path Discipline

Problem:
The backend still allows production-hostile work on request paths.

Evidence:
- Company Explorer read paths still call runtime schema helpers and default folder seeding.
- Logic Gate Arena GET can create or repair its Kanban board before returning.
- Auth middleware validates token, upserts the user, lists memberships, and infers company scope on many requests.
- Many repository methods use `context.Background()` instead of request context.
- Some batch/write paths loop row-by-row instead of using set-based SQL.
- Observability does not yet prove hot-path latency, DB query time, event lag/drop, or frontend interaction SLOs.

Target architecture:
- GETs do not mutate or repair state.
- DDL lives in migrations, not request handlers.
- Default data is seeded during company creation/onboarding or explicit repair jobs.
- Hot requests carry `context.Context` into DB calls.
- Membership/auth scope is cached or explicitly scoped.
- Batch writes use set-based SQL where it matters.
- Hot endpoints have latency/query/event metrics and CI smoke thresholds.

First branch:
`platform/hot-path-read-discipline`

Scope:
- Remove default-folder seeding and runtime DDL from Company Explorer reads.
- Stop Logic Gate Arena GET from repairing missing boards/columns; move repair to creation or explicit command.
- Add tests that GET paths do not create rows.
- Leave repository-wide context propagation, metrics, auth caching, and batch SQL rewrites to follow-up branches.

Follow-up branches:
- `platform/auth-membership-cache`
- `platform/repository-context-slice`
- `platform/bulk-map-layout-upserts`
- `platform/hot-path-metrics`

Completion criteria:
- No hot GET endpoint writes rows as a side effect.
- DDL helpers are migration/cold-start only.
- At least the hottest repository calls accept request context.
- Auth DB work is not repeated blindly on every API call.
- Metrics exist for endpoint latency, query latency, workspace event lag, and stream catch-up.

## 5. Frontend Structure / API Contract

Problem:
React modules still own too much application logic, API behavior, cache invalidation, and workflow orchestration.

Evidence:
- Large hot files include `HomeParts.tsx`, `HomePage.tsx`, `CompanyExplorerContent.tsx`, `EditorContent.tsx`, and `KanbanContent.tsx`.
- A shared `requestJSON` helper exists, but major components still define local request wrappers.
- Auth is still broadly hidden behind a global `fetch` patch.
- App-level live freshness marks workspace, communications, node graph, and Logic Gate graph caches stale for broad workspace events.
- Some lazy-loading wins are undercut by static imports and eager preloads.

Target architecture:
- One explicit API client contract handles auth, timeout, JSON, error shape, conditional GET, idempotency headers, and test/headless injection.
- UI surfaces use backend command/read APIs instead of reimplementing product workflows locally.
- Large modules shrink through controller hooks, model/store files, command APIs, and presentational views.
- Cache invalidation is scoped to event type and resource.

First branch:
`frontend/api-client-contract`

Scope:
- Migrate local `requestJSON` wrappers in Kanban, Editor, Node Map, Logic Gate Map, and Company Explorer to the shared helper.
- Add explicit auth integration to the helper while keeping the global fetch patch temporarily for compatibility.
- Add focused tests for JSON body handling, timeout, error parsing, `204`, auth header behavior, and future `304` handling.
- Do not split giant components in this branch.

Follow-up branches:
- `frontend/scoped-invalidation-policy`
- `frontend/mapcontent-lazy-split`
- `frontend/company-explorer-controller-store`
- `frontend/home-workflow-command-migration`

Completion criteria:
- New frontend API calls use one helper/client by default.
- Component-local request wrappers are exceptions with written justification.
- Cache invalidation can target a scope/resource instead of whole-company freshness.
- Large components lose workflow code as backend commands/read models land.

## Recommended Branch Order

Use this as the default sequencing unless a production incident changes priorities.

1. `platform/hot-path-read-discipline`
2. `events/atomic-workspace-outbox-node-graph`
3. `frontend/api-client-contract`
4. `work-items/assignment-command-existing-model`
5. `work-items/source-of-truth-design`
6. `reads/inbox-read-model-contract`
7. `events/frontend-gap-reconciliation`
8. `platform/auth-membership-cache`
9. `reads/company-explorer-subtree`
10. `work-items/email-conversion-command`

The first three are foundation branches. Run them mostly serially because they touch shared contracts. After that, work-items and read-model branches can run in parallel when their write sets do not overlap.

## Agent Work Plan

Use agents for bounded investigation and implementation slices, not broad "fix architecture" prompts.

Good agent tasks:
- "Convert node create/update/delete to transactional event append. Own files X/Y/Z."
- "Migrate Kanban local request wrapper to shared API helper. Own frontend/src/modules/kanban only."
- "Add read-only Responsible Inbox endpoint contract and tests. Do not touch HomePage."
- "Find all GET handlers that write rows and return a list with line refs."

Bad agent tasks:
- "Fix scalability."
- "Refactor Home."
- "Make events reliable everywhere."
- "Clean up backend architecture."

Maximum useful parallelism:
- One agent on Event Plane.
- One agent on Frontend API Client.
- One agent on Hot Path read-mutation removal.
- One agent on Work Items design only.
- One agent on Read Model endpoint design only.

Do not let multiple agents edit `repository.go`, migrations, `workspace_handlers.go`, or `HomePage.tsx` at the same time.

## Validation Checklist

Every implementation branch should answer these before merge:

- What user or agent flow changed?
- Is the read/write path bounded by company plus a narrower scope?
- Does the mutation append durable events atomically if it affects hot workspace state?
- Does the frontend recover from missed/stale events with scoped reconciliation?
- Does the branch add or update tests around the new contract?
- Does any GET endpoint write state?
- Does the change increase or reduce broad cache invalidation?
- Are there migration, backfill, and rollback notes?

## Notes

- `domain_events` and workspace replay are already partially implemented. Do not describe the current system as purely in-memory SSE anymore.
- `scope=full` can remain temporarily as compatibility/debug/export, but it should not be a hot frontend path.
- The central product decision is the work-item source of truth. Until that is settled, Kanban, Home, ACI/R Inbox, and email conversion will keep pulling on the same backend files.
