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
- Any branch that adds or changes SQL schema/migrations must include a copy-paste migration run command in the final response. Prefer PowerShell for the local Windows workflow, and include Bash when useful. Assume the developer may already have a backend terminal running from `.\scripts\start_local_cognito_backend.ps1 -AwsProfile mangorts-dev -StopExisting`, so DB credentials may already be present in that terminal environment.
- Full-company convenience reads are compatibility/admin/debug paths only. Product hot paths should use bounded read models.

## Progress Summary

| Theme | Status | Current Read |
| --- | --- | --- |
| 1. Read Plane | Version-row ETags complete / yellow | Inbox read contracts now serve from `work_item_inbox_entries`; Company Explorer, Node Map, and Logic Gate Map have bounded read contracts; hot bounded ETags now use derived workspace read-version rows with domain-event fallback. |
| 2. Event Plane | Partial / yellow | `domain_events`, SSE IDs, replay, and frontend cursors exist. Node graph and migrated work-item assignment mutations now append durable workspace events atomically; frontend gap reconciliation now detects missed numeric workspace sequences and triggers scoped surface refreshes. Remaining mutation families and external fanout are still follow-ups. |
| 3. Work Ownership / Commands | Source migration complete / yellow | Node-to-Logic-Gate assignment source rows now exist, Kanban cards are compatibility/projection rows, inbox reads use projection rows, and email conversion now runs through an explicit atomic backend command; RACI/home/inbox command parity remain follow-ups. |
| 4. Hot Path Discipline | Auth cache complete / yellow | Company Explorer and Logic Gate Arena GET repair side effects are removed; auth now caches derived actor/membership context after per-request token validation; repository context, batch SQL, and metrics remain follow-up branches. |
| 5. Frontend Structure / API Contract | Ready / yellow | Shared `requestJSON` exists, but hot modules duplicate wrappers, broad invalidation is scattered, and large components still own workflow logic. |

## 1. Read Plane

Problem:
The product still depends too much on broad workspace-style reads instead of bounded read models per surface.

Evidence:
- `backend/internal/http/workspace_handlers.go` defaults `/v1/workspace/snapshot` to `scope=company_explorer` and uses cheap event validators before payload assembly.
- `scope=full` still loads nodes, relationships, Logic Gates, explorer folders/items, map positions, and Kanban data in one response.
- `scope=node_map` without `folder_id` still lists all nodes, relationships, positions, folders, and folder items.
- `scope=company_explorer` can list broad folders/items plus node and Logic Gate summaries.
- ACI/R inboxes were browser-derived from loaded nodes and Logic Gates; the first read-contract branch adds authoritative APIs, but the hot path still needs frontend adoption, gap reconciliation, and possibly projection-backed reads.

Target architecture:
- Read APIs are surface-specific and bounded.
- Read models have cheap version rows or equivalent validators.
- Hot reads return `304` before loading or marshaling large payloads.
- UI and headless agents consume the same authoritative read APIs.

First branch:
`reads/inbox-read-model-contract`

Branch progress:
- 2026-05-19: Completed the first inbox read contract slice. Responsible Inbox, ACI Inbox, My Nodes, and My Logic Gates now have backend read contracts backed by current tables. Projection tables are intentionally deferred until the contracts are stable and the frontend/reconciliation paths consume them.
- 2026-05-19: Completed `reads/work-item-inbox-projection`. The four work-item inbox read contracts now serve from rebuildable `work_item_inbox_entries` projection rows derived from node assignment, node assignee/priority, Logic Gate, and RACI sources without changing API response shape.

Scope:
- Define server response contracts for:
  - Responsible Inbox
  - ACI Inbox
  - My Nodes
  - My Logic Gates
- Add read-only endpoints backed by current tables first.
- Do not introduce a large projection system in the first branch unless the endpoint needs it.

Projection follow-up:
`reads/work-item-inbox-projection`

Scope:
- Add one rebuildable read-model/projection table, likely `work_item_inbox_entries`, if join-backed inbox reads are too broad or too slow after frontend adoption.
- Do not add separate `aci_inbox` or `r_inbox` source-of-truth tables.
- Keep source of truth normalized:
  - `node_logic_gate_assignments` owns node-to-Logic-Gate placement/status/issue/position.
  - `nodes` currently owns priority and assignee.
  - `logic_gate_raci_assignments` owns R/A/C/I membership.
- Store already-expanded per-user inbox rows such as company, user, role, Logic Gate, node, Kanban card, column, status, priority, assignee, cached display labels, and update/version metadata.
- Backfill/rebuild from `nodes`, `node_logic_gate_assignments`, compatibility `kanban_cards`/`kanban_columns`, `logic_gates`, and `logic_gate_raci_assignments`.
- Serve the existing inbox read contracts from the projection without changing frontend response shape.
- Add migration, backfill, rollback notes, and tests proving projection-backed reads match join-backed behavior.

Status:
- 2026-05-19: Complete. Added one rebuildable `work_item_inbox_entries` projection table and switched Responsible Inbox, ACI Inbox, My Nodes, and My Logic Gates read paths to projection-backed store queries.

Migration/backfill/rollback notes:
- Migration: `backend/db/migrations/20260519_work_item_inbox_entries.sql` creates `work_item_inbox_entries`, indexes, source-derived rebuild functions, and triggers on `nodes`, `node_logic_gate_assignments`, `logic_gates`, `logic_gate_raci_assignments`, `company_memberships`, `users`, and compatibility `kanban_columns` display metadata.
- Backfill: the migration calls `rebuild_work_item_inbox_entries_for_company(company_id)` for each existing company. Node rows derive status/issue/position from `node_logic_gate_assignments` plus Kanban column display metadata, priority and assignee from `nodes`, and labels from `users` through `company_memberships`. Logic Gate rows derive roles from `logic_gate_raci_assignments` and labels from memberships/users.
- Rebuild helpers: store helpers can rebuild all entries for a company or focused entries for one node or one Logic Gate; the projection remains disposable and source-derived.
- Rollback: a code rollback can return to the prior join-backed reads while leaving the projection table unused. A DB rollback should drop the projection triggers/functions/indexes/table after confirming no rollout still calls the projection-backed read path; no source-of-truth data lives only in `work_item_inbox_entries`.

Company Explorer subtree branch:
`reads/company-explorer-subtree`

Status:
- 2026-05-19: Complete. `scope=company_explorer` now supports a bounded `company_id` + `folder_id` + `folder_kind` read that returns only the requested folder subtree, subtree folder items, and node or Logic Gate summaries placed in that subtree. Folder and folder-item list endpoints also expose subtree reads while preserving direct/broad compatibility paths.

Migration/backfill/rollback notes:
- Migration: none. This branch reuses existing `company_explorer_folders`, `company_explorer_folder_items`, `nodes`, and `logic_gates` rows with recursive subtree reads.
- Backfill: none. Existing folder placement rows are already the source for subtree membership.
- Rollback: code can return `scope=company_explorer` and the folder/folder-item list endpoints to their previous broad summary behavior. No schema or data rollback is required.

Node map window branch:
`reads/node-map-window`

Status:
- 2026-05-19: Complete. Added an explicit `scope=node_map_window` snapshot contract requiring `company_id`, `folder_id`, viewport bounds (`min_x`, `min_y`, `max_x`, `max_y`), and optional `limit`. The read returns only positioned nodes inside the requested folder subtree and viewport, relationships whose endpoints are both visible, matching folder items, subtree folders, and positions. Existing broad `scope=node_map` and `scope=full` compatibility/debug reads remain available.

Migration/backfill/rollback notes:
- Migration: none. This branch reuses existing `nodes`, `node_relationships`, `node_map_positions`, `company_explorer_folders`, `company_explorer_folder_items`, and `domain_events` rows.
- Backfill: none. Nodes without existing `node_map_positions` are intentionally absent from viewport-window reads until a normal map placement write records coordinates.
- Rollback: code can stop using `scope=node_map_window` and the bounded node `GET /v1/map-layout` query parameters and return hot callers to the prior `scope=node_map`/broad map-layout reads. No schema or data rollback is required.

Logic Gate map window branch:
`reads/logic-gate-map-window`

Status:
- 2026-05-19: Complete. Added an explicit `scope=logic_gate_map_window` snapshot contract requiring `company_id`, `folder_id`, viewport bounds (`min_x`, `min_y`, `max_x`, `max_y`), and optional `limit`. The read returns only Logic Gates with existing map positions inside the requested folder subtree and viewport, relationships whose endpoints are both visible, matching folder items, subtree folders, and positions. Existing broad `scope=logic_gate_map`, `scope=full`, and unwindowed Logic Gate map-layout reads remain available for compatibility/debug use.

Migration/backfill/rollback notes:
- Migration: none. This branch reuses existing `logic_gates`, `logic_gate_relationships`, `logic_gate_map_positions`, `company_explorer_folders`, `company_explorer_folder_items`, and `domain_events` rows.
- Backfill: none. Logic Gates without existing `logic_gate_map_positions` are intentionally absent from viewport-window reads until a normal map placement write records coordinates.
- Rollback: code can stop using `scope=logic_gate_map_window` and the bounded Logic Gate `GET /v1/map-layout` query parameters and return hot callers to the prior `scope=logic_gate_map`/broad map-layout reads. No schema or data rollback is required.

Version-row ETags branch:
`reads/version-row-etags`

Status:
- 2026-05-19: Complete. Added derived `workspace_read_versions` rows keyed by company, read scope, and optional resource key so hot workspace snapshot, map-layout, list, and board-scoped reads can validate ETags with a single read-version lookup. Missing rows fall back to the prior `domain_events` sequence-filter validators, and GET paths do not create or repair version rows.

Migration/backfill/rollback notes:
- Migration: `backend/db/migrations/20260519_workspace_read_versions.sql` creates `workspace_read_versions`, static read-version key helpers, a domain-event-to-read-key mapping function, and an `after insert` trigger on `domain_events`.
- Backfill: the migration inserts zero-version static rows for existing companies, then backfills each scope/resource to the max matching workspace domain-event sequence. Board-scoped rows are created only for board IDs present in matching domain-event payloads, preserving existing scoped ETag semantics.
- Rollback: code can fall back to the previous domain-event scan validators when rows are missing. A DB rollback should drop `trg_update_workspace_read_versions`, `trg_update_workspace_read_versions()`, `workspace_read_version_keys_for_domain_event()`, `workspace_static_read_version_keys()`, the read-version index, and `workspace_read_versions` after all deployed code no longer relies on the table.

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

Branch progress:
- 2026-05-19: Completed `events/atomic-work-item-assignment-events`. Migrated node-to-Logic-Gate assignment save/move/remove/issue commands now append semantic `work_item.*` workspace events and compatibility Kanban/node events in the same store transaction as the assignment source mutation, and HTTP handlers publish those committed events to the in-process hub only after commit.
- 2026-05-19: Completed `events/frontend-gap-reconciliation`. Workspace stream clients now store ready/replay baselines, suppress stale or duplicate numeric workspace events, emit typed sequence-gap reconciliation metadata, and route gap recovery to scoped Kanban, node graph, Logic Gate graph, Company Explorer, and Home panel refresh paths.

Migration/backfill/rollback notes:
- Migration: none. This branch uses the existing `domain_events` outbox and existing `node_logic_gate_assignments` source table.
- Backfill: none. Historical assignment events are not synthesized; current state remains rebuildable from `node_logic_gate_assignments`, nodes, RACI, and compatibility Kanban rows.
- Rollback: code can return handlers to the previous post-mutation `publishWorkspaceEvent` path while leaving already-appended `work_item.*` events in `domain_events`. No source-of-truth data is stored only in these events; replay consumers should tolerate the extra event types during rollback.
- Frontend gap reconciliation migration/backfill: none. This branch only changes frontend stream cursor handling, cache invalidation, and scoped snapshot/read refresh behavior.
- Frontend gap reconciliation rollback: revert the `workspaceStream.ts` gap signal and subscriber `onGap` handlers. Durable `domain_events` sequences, SSE replay, and existing in-order event handling remain compatible; rollback only returns clients to ignoring numeric sequence gaps until a normal refresh or reconnect catches up.

Scope:
- Convert one vertical slice first: node create/update/delete and node relationship create/delete.
- Add a transactional mutation plus workspace event append path.
- Publish to the hub only after commit.
- Add tests proving committed mutations have events and failed mutations do not.

Follow-up branches:
- `events/atomic-kanban-workspace-events`
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
- Node reads derive `logic_gate_ids` from `node_logic_gate_assignments` rather than directly from Kanban cards.
- Work-item assignment commands update `node_logic_gate_assignments` first, then sync Kanban compatibility cards and derived node status/color; first responsible Logic Gate user assignment still writes to `nodes.assignee_user_id`.
- Home and Kanban flows still perform multi-step client orchestration.
- Logic Gate RACI and shared inbox RACI use full-replace update patterns.
- Email triage conversion creates nodes, folder items, positions, Kanban cards, email links, projections, deletes triage rows, syncs status, and assigns responsible users in one store-level transaction.

Current truth model:
- Logic Gate work assignment/status/issue/position now lives in `node_logic_gate_assignments`; Logic Gate `kanban_cards` remain compatibility/projection rows for existing board UI.
- Node status is fallback or derived state for nodes that are not on a Logic Gate board.
- Assignee still lives directly on `nodes.assignee_user_id`, with Kanban placement auto-assigning the first Responsible RACI user.
- This is usable as a migration starting point, but it needs one command owner.

Target architecture:
- A backend command owns "node assigned to Logic Gate/status/priority/person/position."
- The first implementation used existing Kanban card plus node fields as the persistence model.
- Kanban-backed assignment was a migration bridge, not the preferred final model.
- `node_logic_gate_assignments` is now the durable node-to-Logic-Gate relationship table; it was pulled forward before inbox projection so future read models have the right source.
- Kanban cards are now a projection/compatibility surface for board layout instead of the durable node-to-Logic-Gate link.
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

Decision document:
- `docs/important tasks/work-items-source-of-truth-design.md` recommends staying Kanban-card-backed for now and finishing command parity before adding any new work-item source table. This is a near-term sequencing decision, not a permanent endorsement of Kanban as the only node-to-Logic-Gate source.

Follow-up branches:
- `work-items/assignment-command-parity-existing-model`
- `work-items/raci-add-remove-commands`
- `work-items/home-drop-command`
- `work-items/email-conversion-command`
- `work-items/inbox-command-parity`

Source migration branch:
`work-items/node-logic-gate-assignment-source`

Status:
- 2026-05-19: Complete. Added `node_logic_gate_assignments` as the durable node-to-Logic-Gate assignment source, with Logic Gate Kanban cards kept as compatibility/projection rows for the current board UI.

Scope completed:
- Added an additive migration and canonical schema update for `node_logic_gate_assignments`.
- Backfilled from existing Logic Gate `kanban_cards` where `logic_gate_id is not null`, preserving one active assignment per node.
- Made work-item assign/move/remove/issue commands write assignment rows first and sync Kanban compatibility cards.
- Made node reads derive `logic_gate_ids` and assignment-derived status from `node_logic_gate_assignments`.
- Added app-level raw Kanban sync/guards and a database trigger so legacy Logic Gate card writes cannot silently drift from assignment truth.
- Kept `logic_gate_raci_assignments` as RACI truth and did not add role columns directly to `logic_gates`.

Migration/backfill/rollback notes:
- Migration: `backend/db/migrations/20260519_node_logic_gate_assignments.sql` creates the source table, indexes, backfills from current Logic Gate cards, and installs `trg_sync_node_logic_gate_assignment_from_kanban_card` for raw/legacy compatibility writes.
- Backfill picks the latest Logic Gate card per `(company_id, node_id)` using `updated_timestamp`, `created_timestamp`, then `card_id`, matching the existing one-active-card behavior.
- Rollback: Kanban compatibility cards are preserved. A code rollback can return to Kanban-backed reads. A DB rollback should drop the trigger/function and table only after confirming no new assignment-only data needs to be preserved.

Email conversion command branch:
`work-items/email-conversion-command`

Status:
- 2026-05-19: Complete. Email triage conversion now has an explicit backend command contract for company/user scope, selected messages, existing or new Logic Gate targets, assignment status/column, email provenance, and committed workspace events.

Scope completed:
- Preserved the existing `/v1/communications/triage/convert` response compatibility while adding target, Logic Gate, assignment, email placement, and email provenance fields.
- Kept `node_logic_gate_assignments` as assignment truth and writes Kanban cards as compatibility rows.
- Conversion writes nodes, Active Nodes folder placement, node map positions, assignment source rows, Kanban compatibility cards, email links/projections, triage deletion, and durable workspace events in one store transaction.
- HTTP now publishes committed workspace events returned from the command instead of appending workspace events after the mutation.
- Added support for an explicit new Logic Gate target mode without requiring frontend multi-request choreography.

Migration/backfill/rollback notes:
- Migration: none. This branch reuses `communications_triage_items`, `communications_email_nodes`, `nodes`, `node_information`, `node_projection_table`, `node_logic_gate_assignments`, Logic Gate Kanban tables, Company Explorer folder items, and `domain_events`.
- Backfill: none. Existing converted email provenance remains in `communications_email_nodes` and attached-email node projections; new conversions add durable workspace events going forward only.
- Rollback: code can return the HTTP handler to the previous post-mutation `publishWorkspaceEvent` path and ignore the additive response fields. No source-of-truth data lives only in the new event payloads; already appended `work_item.email_converted` events should be tolerated by replay consumers.

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
- Auth middleware previously validated token, upserted the user, listed memberships, and inferred company scope on many requests; this branch now caches the derived actor/membership context after validation.
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

Branch progress:
- 2026-05-19: Removed Company Explorer read-time default seeding/runtime DDL and Logic Gate Arena GET board/column repair. Default folders now belong to company provisioning plus the migration backfill; missing Arena board/columns now return explicit errors instead of being repaired by GET.
- 2026-05-19: Completed `platform/auth-membership-cache`. Auth middleware still validates JWTs on every request, then reuses a bounded short-TTL in-process actor/membership context keyed by subject, email, and display name claims. Successful company creation clears the cache; invitation acceptance and company user deletion invalidate affected subject/user/company entries.

Scope:
- Remove default-folder seeding and runtime DDL from Company Explorer reads.
- Stop Logic Gate Arena GET from repairing missing boards/columns; move repair to creation or explicit command.
- Add tests that GET paths do not create rows.
- Leave repository-wide context propagation, metrics, and batch SQL rewrites to follow-up branches.

Migration/backfill/rollback notes:
- Auth membership cache migration: none. This branch is code-only and uses the existing `users` and `company_memberships` tables.
- Backfill: none. Cache entries are populated lazily after successful token validation and expire quickly.
- Rollback: code can return middleware to direct `UpsertAuthUser` plus `ListUserMemberships` on every authenticated request. No data lives only in the cache, and no database rollback is required.

Follow-up branches:
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

Use this as the default sequencing unless a production incident changes priorities. The first three are foundation branches and should remain mostly serial because they touch shared contracts. Work-items and read-model branches can run in parallel only when their write sets do not overlap.

### Completed Or In Flight

1. `platform/hot-path-read-discipline`
2. `events/atomic-workspace-outbox-node-graph`
3. `frontend/api-client-contract`
4. `work-items/assignment-command-existing-model`
5. `work-items/source-of-truth-design`
6. `work-items/assignment-command-parity-existing-model`
7. `reads/inbox-read-model-contract`
8. `work-items/node-logic-gate-assignment-source`
9. `reads/work-item-inbox-projection`
10. `events/atomic-work-item-assignment-events`
11. `events/frontend-gap-reconciliation`
12. `platform/auth-membership-cache`
13. `reads/company-explorer-subtree`
14. `work-items/email-conversion-command`
15. `reads/node-map-window`
16. `reads/logic-gate-map-window`
17. `reads/version-row-etags`

### Next Roadmap

1. `work-items/raci-add-remove-commands`

### Work-Items Follow-Ups

These remain valid, but they should not displace the next read-plane branch unless they are blocking a user or agent workflow.

1. `work-items/raci-add-remove-commands`
2. `work-items/home-drop-command`
3. `work-items/inbox-command-parity`

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
