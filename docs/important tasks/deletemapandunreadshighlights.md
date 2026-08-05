# Delete Maps and Node Unread Change Highlights

Status: Planned. Step 1 inventory is next.

## Goal

Completely remove the Node Map and Logic Gate Map product features and their dedicated storage. Also completely remove Node authored-change highlighting and unread-change tracking. Keep Nodes, Logic Gates, their non-map relationships, and manual editor save history.

This is a removal project. Do not add compatibility readers, fallbacks, dual writes, replacement map storage, or a long-lived transition layer.

## Final Decisions

The following product features must be removed completely:

- The entire Node Map user interface and all ways to open or navigate to it.
- The entire Logic Gate Map user interface and all ways to open or navigate to it.
- Map position loading, saving, caching, realtime updates, batch commands, and workspace payload fields.
- Node authored-change highlighting, including addition/deletion highlights and author labels.
- Node unread-change counts, controls, seen baselines, and mark-seen behavior.

The following database tables are approved retirement targets:

- `node_map_positions`
- `logic_gate_map_positions`
- `node_content_changes`
- `node_content_change_seen`
- `node_textbox_seen_snapshots`

The following functionality and storage must remain:

- Nodes and the Node editor.
- Logic Gates and the Logic Gate editor.
- `node_relationships`, including non-map relationship behavior.
- `logic_gate_relationships`, including non-map relationship behavior.
- Manual Node saved versions, history listing, restore, saving-user identity, and `node_textboxes_history`.
- Manual Logic Gate saved versions, history listing, restore, saving-user identity, and `logic_gate_textboxes_history`.
- Normal current textbox editing, revisions, collaboration, attachments, email relationships, chats where supported, deletion, recycle, and restore behavior that is unrelated to the removed features.

Relationship tables and relationship meaning must not be deleted merely because maps currently display them. The inventory must distinguish map-only presentation code from surviving relationship behavior.

## Step 1: Complete Read-Only Inventory

Status: Not started.

Scour the entire current repository before making implementation changes. Produce one exact inventory covering every production and non-production dependency on the removal scope, including:

- Frontend map modules, shared map entry points, routes, menus, frame types, lazy loaders, deep links, Explorer integration, selection coordination, keyboard commands, caches, browser persistence, and tests.
- Backend HTTP routes, handlers, domain types, repository interfaces, PostgreSQL queries, batch creation, derived projections, workspace snapshots, caching/ETags, realtime events, version scopes, authorization, deletion, recycle, restore, backup, and seed paths.
- Every table, column, index, constraint, trigger, function, event name, view, schema contract, canonical-schema statement, forward migration, operator script, and historical migration reference.
- Every caller and response field involving `node_map_positions`, `logic_gate_map_positions`, `/v1/map-layout`, `node_map_positions_updated`, or `logic_gate_map_positions_updated`.
- Every caller and response field involving `node_content_changes`, `node_content_change_seen`, `node_textbox_seen_snapshots`, authored Node changes, unseen Node changes, highlighting, baselines, or mark-seen commands.
- Every test document, backend document, frontend document, test, fixture, helper, and script that describes or enforces the removed behavior.
- Any apparently shared code whose deletion could accidentally damage Nodes, Logic Gates, their editors, manual history, relationships, permissions, attachments, email ownership, recycle/restore, or realtime collaboration.

The Step 1 report must classify each discovered item as:

1. Delete because it exists only for the removed features.
2. Rewire because a surviving feature currently passes through map or unread-change code.
3. Keep because it has a non-map, non-unread purpose.
4. Historical record only; retain unchanged because shipped migrations must not be rewritten.

Step 1 is read-only. It must not change project files, the database, cloud resources, or application behavior.

## Step 2: Delete Features and Rewire Surviving Code

Status: Blocked on Step 1.

Using the approved inventory:

- Delete the Node Map and Logic Gate Map frontend features rather than hiding them.
- Remove their routes, launch points, frame contracts, map-specific selection behavior, frontend persistence, and API calls.
- Remove the map layout HTTP API, backend map repositories, map payload fields, map realtime events, and map-only creation/persistence paths.
- Rewire surviving Node, Logic Gate, relationship, editor, Explorer, deletion, recycle, restore, and batch behavior so none depends on map code or map position rows.
- Remove Node authored-change capture, unread-change reads, seen-baseline writes, mark-seen endpoints, frontend highlights, author labels, badges, and controls.
- Rewire normal Node textbox reads and writes so they remain independent of the three unread/highlight tables.
- Preserve `node_relationships` and `logic_gate_relationships` and every confirmed non-map use.
- Preserve manual Node and Logic Gate save-history creation, listing, saved-by identity, and restore behavior.
- Remove the five retirement-target tables from `backend/db/schema.sql` so fresh databases never create them.
- Add the correct forward migration and separately gated operator retirement SQL for existing deployments. Do not rewrite historical migrations that have already shipped.
- Update affected documentation and place the required Process Story and business rules at the top of every changed `docs/tests` file.

Production code must have zero readers, writers, fallbacks, or runtime schema checks for the five retirement-target tables before Step 3 can begin.

Agents must not apply SQL to a live database.

## Step 3: Verify, Then Retire the Five Tables

Status: Blocked on Step 2.

Before table retirement:

1. Run focused tests for every rewired surviving feature.
2. Run the complete repository verification command.
3. Prove production code has no remaining references that read or write the five target tables.
4. Review the complete diff and exclude unrelated changes.
5. Deploy the matching application version with map and unread-change writers removed.
6. Smoke-test Nodes, Logic Gates, editors, relationships, manual Save, History, Restore, permissions, attachments, email ownership, deletion, recycle, restore, and realtime collaboration.
7. Confirm no old application instance or background worker can write the target tables.
8. Take and confirm the required database snapshot.

Only after all verification passes may a human operator run the retirement script to drop exactly:

- `node_map_positions`
- `logic_gate_map_positions`
- `node_content_changes`
- `node_content_change_seen`
- `node_textbox_seen_snapshots`

The operator script must be plain DBeaver-compatible PostgreSQL SQL, support PostgreSQL 17.x, report the server version, stop outside PostgreSQL 17.x, use exact unordered column-name sets and exact counts for schema checks, refuse drift or surviving dependencies, use no `CASCADE`, require explicit approvals, and be transactionally safe.

After retirement, repeat the critical smoke tests and confirm the five tables are absent while both manual history tables and their user attribution remain intact.

## Completion Definition

This project is complete only when:

- No user can open or invoke a Node Map or Logic Gate Map.
- No production frontend or backend code contains map functionality or reads/writes map positions.
- No Node editor displays or tracks authored-change highlights or unread changes.
- No production code reads or writes the three Node unread/highlight tables.
- The five retirement-target tables are absent from the live schema after the approved human-run operation.
- `node_relationships` and `logic_gate_relationships` still work for every retained non-map behavior.
- Manual Node and Logic Gate Save, History, saving-user display, and Restore still work from `node_textboxes_history` and `logic_gate_textboxes_history`.
- Fresh databases do not recreate any retired map or unread/highlight table.
