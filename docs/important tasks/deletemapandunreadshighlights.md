# Delete Node Map and Logic Gate Map

Status: Steps 1-3 are complete for the development environment. Jonat reported the separately approved human retirement operation completed on 2026-08-05.

## Goal

Completely remove the Node Map and Logic Gate Map product features and their dedicated position storage. Keep Nodes, Logic Gates, their non-map relationships, manual editor save history, and all Node authored-change highlighting and unread-change tracking.

This is a removal project. Do not add compatibility readers, fallbacks, dual writes, replacement map storage, or a long-lived transition layer.

## Executive Scope Decision

The earlier plan to remove Node authored-change highlighting and unread-change tracking is canceled. Those features will be handled, if ever, by a separate future project.

The following functionality and storage must remain unchanged in this project:

- Node authored-change highlighting, including addition/deletion highlights and author labels.
- Node unread-change counts, controls, seen baselines, and mark-seen behavior.
- `node_content_changes`.
- `node_content_change_seen`.
- `node_textbox_seen_snapshots`.
- `node_view_user_versions` and its unread/seen version behavior.
- The Node change endpoints under `/v1/nodes/{node}/changes`.
- Node view response fields and ETags used by unread/seen behavior.
- Durable Tiptap `change` annotations and their frontend/backend validation.
- Tests and documentation for authored changes, unread changes, seen baselines, and highlighting.

Step 2 must not refactor, clean up, rename, migrate, or otherwise change those paths merely because the original project included them.

## Final Map-Removal Decisions

The following product features must be removed completely:

- The entire Node Map user interface and all ways to open or navigate to it.
- The entire Logic Gate Map user interface and all ways to open or navigate to it.
- Map position loading, saving, caching, realtime updates, batch commands, and workspace payload fields.
The only database tables approved for retirement are:

- `node_map_positions`
- `logic_gate_map_positions`

No other table is approved for retirement by this project.

The following functionality and storage must remain:

- Nodes and the Node editor.
- Logic Gates and the Logic Gate editor.
- `node_relationships`, including non-map relationship behavior.
- `logic_gate_relationships`, including non-map relationship behavior.
- Manual Node saved versions, history listing, restore, saving-user identity, and `node_textboxes_history`.
- Manual Logic Gate saved versions, history listing, restore, saving-user identity, and `logic_gate_textboxes_history`.
- Normal current textbox editing, revisions, collaboration, attachments, email relationships, chats where supported, deletion, recycle, and restore behavior that is unrelated to the removed features.
- All authored-change and unread/seen functionality listed in the executive scope decision.

Relationship tables and relationship meaning must not be deleted merely because maps currently display them. The inventory must distinguish map-only presentation code from surviving relationship behavior.

## Step 1: Complete Read-Only Inventory

Status: Complete.

The repository-wide inventory found 37 production modules directly inside the three map folders, 14 dedicated map test files, and map dependencies spread through shared frame, selection, workspace, cache, backend, schema, recycle, and documentation paths. The highest-risk work is moving protected types and caches out of map-owned folders, removing coordinates from the shared entity-batch API, and draining map-only derived-projection tasks before deleting their handlers.

Scour the entire current repository before making implementation changes. Produce one exact inventory covering every production and non-production dependency on the removal scope, including:

- Frontend map modules, shared map entry points, routes, menus, frame types, lazy loaders, deep links, Explorer integration, selection coordination, keyboard commands, caches, browser persistence, and tests.
- Backend HTTP routes, handlers, domain types, repository interfaces, PostgreSQL queries, batch creation, derived projections, workspace snapshots, caching/ETags, realtime events, version scopes, authorization, deletion, recycle, restore, backup, and seed paths.
- Every table, column, index, constraint, trigger, function, event name, view, schema contract, canonical-schema statement, forward migration, operator script, and historical migration reference.
- Every caller and response field involving `node_map_positions`, `logic_gate_map_positions`, `/v1/map-layout`, `node_map_positions_updated`, or `logic_gate_map_positions_updated`.
- Verify that map rewiring leaves `node_content_changes`, `node_content_change_seen`, `node_textbox_seen_snapshots`, authored Node changes, unseen Node changes, highlighting, baselines, and mark-seen commands unchanged.
- Every test document, backend document, frontend document, test, fixture, helper, and script that describes or enforces the removed behavior.
- Any apparently shared code whose deletion could accidentally damage Nodes, Logic Gates, their editors, manual history, relationships, permissions, attachments, email ownership, recycle/restore, or realtime collaboration.

The Step 1 report must classify each discovered item as:

1. Delete because it exists only for the removed features.
2. Rewire because a surviving feature currently passes through map code.
3. Keep because it has a non-map purpose.
4. Historical record only; retain unchanged because shipped migrations must not be rewritten.

Step 1 is read-only. It must not change project files, the database, cloud resources, or application behavior.

### Approved Map-Only Inventory

Delete the map shell and map-only UI:

- `frontend/src/modules/map/MapContent.tsx` and `mapMode.ts`.
- Node Map canvas, context menus, controls, cards, hit lines, routing, commands, persistence, viewport, inline comments, legend, delete summary, and graph-loader modules under `frontend/src/modules/node-map`.
- Logic Gate Map canvas, context menus, cards, hit lines, routing, visual projection, persistence, and viewport modules under `frontend/src/modules/logic-gate-map`.
- Map browser/session keys, map clipboard and inline-comment storage, map selection/focus events, and map-only Explorer event wiring.

Move protected shared code out of map folders before deleting those folders:

- Node and Logic Gate records, details, access helpers, title helpers, GVIC presentation, entity caches, relationship caches, hierarchy builders, relationship write rules, selected-text Node creation, and generic event helpers.
- Preserve every unread/change field and behavior in `NodeRecordStore.ts`.

Rewire shared frontend paths:

- Remove map lazy loaders, module-library entries, aliases, default views, primary-page types, tabs, headers, menus, frame kinds, preload rules, linking inference, selection sources, Explorer map bridges, map snapshot scopes, position payloads, and `/v1/map-layout` invalidation.
- Make Home the default active primary tab after Map is removed, and discard persisted map frames instead of translating them.
- Keep generic saved-view/link registries, Editor/Explorer/Kanban links, resource deep links, non-map selection, and workspace caching.
- Old browser map entries may become unreachable. Do not add compatibility readers or browser-data migrations.

Delete or rewire backend map paths:

- Delete `/v1/map-layout`, legacy `/v1/map-entity-batches`, `backend/internal/http/map_layout_handlers.go`, legacy route flags, and legacy map query controls.
- Remove `node_map`, `node_map_window`, `logic_gate_map`, and `logic_gate_map_window` workspace scopes and their handlers.
- Remove `node_map_positions` and `logic_gate_map_positions` from workspace and entity-batch payloads.
- Remove entity-batch `x`/`y` inputs, deferred map writes, and `node_map`/`logic_gate_map` mutation origins while preserving Node, Logic Gate, relationship, folder-item, GVIC, and entity-mapping creation.
- Delete map repository interfaces, PostgreSQL queries, memory state, rollback state, deletion cleanup, recycle capture/restore, and readiness requirements.
- Delete `node_map_positions_updated`, `logic_gate_map_positions_updated`, map-position projection task kinds, and their deprecated request names.
- Remove all map ETag and workspace read-version scopes while preserving every non-map scope.
- Prove the derived-projection checkpoint is past every pending map-position task before deleting its handlers.

Database inventory:

- `node_map_positions` has columns `company_id`, `node_id`, `x`, `y`, and `updated_timestamp`; primary key `(company_id,node_id)`; a cascading Node foreign key; and index `idx_node_map_positions_company_updated`.
- `logic_gate_map_positions` has columns `company_id`, `logic_gate_id`, `x`, `y`, and `updated_timestamp`; primary key `(company_id,logic_gate_id)`; a cascading Logic Gate foreign key; and index `idx_logic_gate_map_positions_company_updated`.
- No database view directly depends on either table.
- Shipped map migrations remain historical and unchanged. Add a new forward migration plus a separately gated PostgreSQL 17 DBeaver operator script.
- Existing recycle JSON may retain historical position keys; new code may ignore them without adding compatibility restoration.

Tests and documentation:

- Delete canvas/map-only frontend and backend tests.
- Move or rewire tests for protected record stores, relationship structures, relationship write rules, workspace batches, Explorer, recycle, and derived projection.
- Update current map documentation and required `docs/tests` Process Stories.
- Keep historical migrations, dated schema audits, and `docs/important tasks/Old Stuff/**`.
- Unread/highlight tests and documentation are not part of this work and must remain.

## Step 2: Delete Maps and Rewire Surviving Code

Status: Complete in the dedicated worker branch. No live SQL was applied.

Using the approved inventory:

- Delete the Node Map and Logic Gate Map frontend features rather than hiding them.
- Remove their routes, launch points, frame contracts, map-specific selection behavior, frontend persistence, and API calls.
- Remove the map layout HTTP API, backend map repositories, map payload fields, map realtime events, and map-only creation/persistence paths.
- Rewire surviving Node, Logic Gate, relationship, editor, Explorer, deletion, recycle, restore, and batch behavior so none depends on map code or map position rows.
- Preserve Node authored-change capture, unread-change reads, seen-baseline writes, mark-seen endpoints, frontend highlights, author labels, badges, controls, and all three unread/highlight tables.
- Preserve `node_relationships` and `logic_gate_relationships` and every confirmed non-map use.
- Preserve manual Node and Logic Gate save-history creation, listing, saved-by identity, and restore behavior.
- Remove the two map-position tables from `backend/db/schema.sql` so fresh databases never create them.
- Add the correct forward migration and separately gated operator retirement SQL for existing deployments. Do not rewrite historical migrations that have already shipped.
- Update affected documentation and place the required Process Story and business rules at the top of every changed `docs/tests` file.

### Step 2 Implementation Record — 2026-08-05

- Deleted both map frontends, all launch points, routes, frames, browser persistence, map-specific caches/events, and map-only tests.
- Moved retained Node, Logic Gate, relationship, GVIC, selected-text creation, title-reconciliation, and generic event behavior into non-map modules.
- Removed backend map routes, handlers, repositories, position storage, workspace scopes, ETags, realtime event names, mutation origins, derived handlers, recycle behavior, batch coordinates/results, and readiness checks.
- Kept Company Explorer derived projection and every protected authored-change, unread/seen, relationship, editor, manual history, permission, attachment, email, deletion, recycle, restore, and non-map realtime contract.
- Removed both position tables and their indexes from the canonical schema. Added `backend/db/migrations/20260805_zz_remove_map_runtime_contracts.sql` for map-free read-version functions/rows without dropping existing tables.
- Added `scripts/map_position_storage_retirement_preflight.sql` and `scripts/retire_map_position_storage.sql`. The read-only preflight detects unprocessed historical map projection work. The retirement script is PostgreSQL 17 DBeaver-compatible, approval-gated, drift/dependency checked, transactional, and drops only the two approved tables without `CASCADE`.
- Preserved all shipped historical migrations, dated audits, and `docs/important tasks/Old Stuff/**` unchanged.
- Production frontend/backend/canonical-schema search has no map runtime reference. Remaining names are confined to shipped historical records, this tracker, the new forward migration, the preflight/operator scripts, and tests that enforce removal.
- Verification passed: `node tests/frontend/scripts/run-node-relationship-tests.mjs`, `go test ./...`, and `node scripts/run_all_tests.mjs` (frontend tests, production build, backend tests, and infrastructure contract tests).
- Follow-up audit restored the retained `project_information_created` and `project_information_deleted` read-version mappings in both the forward migration and canonical schema, with a regression contract against the latest shipped function.
Production code must have zero readers, writers, fallbacks, runtime schema checks, response fields, cache scopes, or realtime events for the two map-position tables before Step 3 can begin. Production code must continue using the three unread/highlight tables.

Agents must not apply SQL to a live database.

## Step 3: Verify, Then Retire the Two Position Tables

Status: Complete for the development environment based on Jonat's 2026-08-05 operator report. The agent did not apply SQL to a live database.

### Step 3 Operator Completion Record — 2026-08-05

- Jonat manually ran the corrected PostgreSQL 17 read-only preflight and reported its READY result.
- Jonat then ran the separately approval-gated retirement transaction and reported successful completion.
- The operation dropped only `node_map_positions` and `logic_gate_map_positions`, without `CASCADE`, and recorded the operator migration.
- The canonical schema already omits both tables, and current application runtime code has no reader, writer, payload, route, event, cache, or fallback for them.
- The following sequence remains the required runbook for any other environment.

Before table retirement:

1. Run focused tests for every rewired surviving feature.
2. Run the complete repository verification command.
3. Prove production code has no remaining map functionality or references that read or write the two position tables.
4. Prove authored-change highlighting and unread/seen behavior remain unchanged.
5. Review the complete diff and exclude unrelated changes.
6. Run a read-only PostgreSQL 17 preflight and prove the derived-projection checkpoint is past every map task.
7. Deploy the matching application version with map writers removed.
8. Smoke-test Nodes, Logic Gates, editors, relationships, manual Save, History, Restore, authored-change highlights, unread/seen behavior, permissions, attachments, email ownership, deletion, recycle, restore, and realtime collaboration.
9. Confirm no old application instance or background worker can write map positions.
10. Take and confirm the required database snapshot.

Only after all verification passes may a human operator run the retirement script to drop exactly:

- `node_map_positions`
- `logic_gate_map_positions`

The operator script must be plain DBeaver-compatible PostgreSQL SQL, support PostgreSQL 17.x, report the server version, stop outside PostgreSQL 17.x, use exact unordered column-name sets and exact counts for schema checks, refuse drift or surviving dependencies, use no `CASCADE`, require explicit approvals, and be transactionally safe.

After retirement, repeat the critical smoke tests and confirm the two position tables are absent while relationships, manual history, and all unread/seen tables remain intact.

## Completion Definition

This project is complete only when:

- No user can open or invoke a Node Map or Logic Gate Map.
- No production frontend or backend code contains map functionality or reads/writes map positions.
- Node authored-change highlighting and unread/seen behavior remain unchanged.
- Production code continues using the three Node unread/highlight tables.
- The two map-position tables are absent from the live schema after the approved human-run operation.
- `node_relationships` and `logic_gate_relationships` still work for every retained non-map behavior.
- Manual Node and Logic Gate Save, History, saving-user display, and Restore still work from `node_textboxes_history` and `logic_gate_textboxes_history`.
- Fresh databases do not recreate either retired map-position table and continue creating the unread/highlight tables.
