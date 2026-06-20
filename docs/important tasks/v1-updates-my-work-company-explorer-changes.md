# Important Tasks V1 Minor Changes

## Project Scope

This project stabilizes the first go-live version of Home-adjacent work surfaces without starting the larger local-database/sync-engine migration.

The project has three related surfaces:

- My Work
- Updates
- Company Explorer

Company Explorer is now company-wide only. The previous `Me`, `Team`, and `All` Company Explorer tab model should be removed from the product direction.

## Core Direction

My Work and Updates should use durable backend read models/projections with lazy fetching on top.

Lazy fetching controls how much data the UI loads. It should not replace projection tables, and it should not make one tab the source of truth for another tab.

The durable rule:

```text
Projection/read model = what rows belong in this surface.
Lazy fetch = which page/scope of those rows the frontend asks for right now.
Realtime = which bounded scope is stale or has changed.
```

The `Me`, `Team`, and `All` tabs should be sibling queries over their own backend scopes. `Me` and `Team` should not subscribe to or derive from `All`.

Company Explorer should be a company-wide directory/navigation tree. It should not have `Me`, `Team`, or `All` tabs. It should show a company folder tree, manual references to canonical projects/logic gates/nodes, and real native relationships when a project, logic gate, or node is expanded.

The Company Explorer rule:

```text
Folders and folder placement live in Company Explorer.
Projects, logic gates, nodes, and their real relationships live in their canonical source tables.
The Company Explorer read API merges both when drawing the tree.
```

## Non-Goals

- Do not introduce browser-side local tables yet.
- Do not make Updates a RACIO/GVIC ownership view.
- Do not make My Work and Updates share data semantics.
- Do not make `All` the frontend cache authority for `Me` or `Team`.
- Do not keep Company Explorer `Me` / `Team` / `All` tabs.
- Do not copy every project, logic gate, node, or native relationship into Company Explorer as a second source of truth.
- Do not update My Work or Company Explorer projections directly from the frontend. Drag/drop must call backend semantic commands.

## Phase 1: Stabilize Read Semantics

Goal: make My Work, Updates, and Company Explorer independently correct before tightening realtime behavior.

### My Work

My Work answers:

```text
What active work is relevant to this user, team, or company?
What role/context does the user have?
Which project, logic gate, or node does that work belong to?
```

Tasks:

- [ ] Confirm the backend My Work read path is projection/read-model based, not assembled from frontend tab state.
- [ ] Keep `Me`, `Team`, and `All` as separate backend queries or query scopes.
- [ ] Preserve partial success behavior for multi-user/team loads so one failed user scope does not blank the whole surface.
- [ ] Keep My Work semantics focused on active work and assignment/GVIC context.
- [ ] Reuse grouping/list UI only where useful; do not share Updates data meaning.

Expected API shape:

```text
GET /my-work?scope=me
GET /my-work?scope=team&team_id=...
GET /my-work?scope=all
```

The exact endpoint names can follow the existing backend routes, but the data contract should preserve this separation.

### Updates

Updates answers:

```text
What happened that this user, team, or company should know about?
```

Examples:

- mentions
- comments
- assignment changes
- status changes
- important project/logic-gate/node activity
- permission/access changes when user-visible

Tasks:

- [ ] Treat Updates as a dedicated feed/read model, separate from My Work.
- [ ] Model `Me`, `Team`, and `All` as sibling feed scopes.
- [ ] Lazy fetch newest feed rows first, then older rows by cursor/page.
- [ ] Track read/unread state separately from feed row existence.
- [ ] Allow shared grouping/list UI with My Work only at the component/helper level.

Expected API shape:

```text
GET /updates?scope=me&cursor=...
GET /updates?scope=team&team_id=...&cursor=...
GET /updates?scope=all&cursor=...
```

The backend may continue using the existing notifications surface if it can support this contract cleanly.

### Company Explorer

Company Explorer answers:

```text
What company-wide folders exist?
Which canonical projects, logic gates, and nodes are manually placed in those folders?
What real native children should appear when a project, logic gate, or node is expanded?
```

Company Explorer should be company-wide. There should be no Company Explorer `Me`, `Team`, or `All` scopes.

Required target storage shape:

```text
company_explorer_folders
- company_id
- folder_id
- parent_folder_id nullable
- name
- default_access
- position
- created_by_user_id
- created_timestamp
- updated_timestamp
```

```text
company_explorer_items
- company_id
- item_id
- parent_folder_id nullable
- target_type: project | logic_gate | node
- target_id
- position
- created_by_user_id
- created_timestamp
- updated_timestamp
```

Rules:

- [ ] Folder nesting is one-parent only through `parent_folder_id`.
- [ ] A folder can contain folders and manual references to projects, logic gates, and nodes.
- [ ] `company_explorer_items` stores references only; it does not copy native project, logic gate, or node rows.
- [ ] Enforce one manual Explorer placement per canonical resource in the company tree unless the product explicitly decides to allow shortcuts later.
- [ ] Remove Company Explorer scope columns/behavior from the target model: no `scope_type`, no `scope_id`, no user/team subscriptions.
- [ ] Keep folder permissions as Company Explorer-owned permissions.
- [ ] Keep native resource permissions on native projects, logic gates, and nodes.

Expected read shape:

```text
GET /company-explorer/roots
GET /company-explorer/children?parent_type=folder&parent_id=...
GET /company-explorer/children?parent_type=project&parent_id=...
GET /company-explorer/children?parent_type=logic_gate&parent_id=...
GET /company-explorer/search?q=...
```

The exact endpoint names can follow the existing v1/v2 route style, but the contract should preserve this separation.

Important: this target schema is not optional. Company Explorer is not complete until the old scoped/copy-graph tables are migrated away and removed.

Children rules:

- [ ] Expanding a folder returns child folders and manual item references from Company Explorer tables.
- [ ] Expanding a project returns native project child relationships from project relationship tables/projections.
- [ ] Expanding a logic gate returns native logic-gate node assignments.
- [ ] Expanding a node returns node-native children only if the product has a real node-child relationship; otherwise it opens/selects the node.
- [ ] Search queries canonical visible nodes, logic gates, and projects, not only manually placed Explorer items.
- [ ] Search results should show both native context and any manual Explorer folder location.

## Phase 2: Tighten Mutation-to-Projection Rules

Goal: make semantic writes explicitly update the source tables, read models, and realtime scopes that My Work, Updates, and Company Explorer depend on.

### My Work Mutation Rules

A write should affect My Work when it changes active work visibility or context.

Common triggers:

- work item created, updated, completed, archived, or reopened
- GVIC/RACIO assignment changed
- work item assigned to or removed from a user/team
- node, logic gate, or project context changed in a way that affects displayed My Work rows
- permission changes that add or remove access to visible work

Tasks:

- [ ] Document which semantic commands update My Work projections.
- [ ] Ensure each relevant command records affected scopes, such as user, team, and company.
- [ ] Avoid broad company invalidation when only one user/team scope changed.
- [ ] Add or adjust tests for each major mutation type that should affect My Work.
- [ ] Make My Work drag/drop use the same backend semantic commands as Company Explorer and the primary graph views.
- [ ] Never move a My Work item by editing My Work projection rows directly.
- [ ] Moving a My Work row to a project, logic gate, or node must update canonical source/relationship tables, then let My Work projection rows refresh from those sources.

Preferred realtime shape:

```text
my_work:user:<user_id>
my_work:team:<team_id>
my_work:company:<company_id>
```

### Updates Mutation Rules

A write should affect Updates when it creates user-visible history, attention, or notification value.

Common triggers:

- direct mention
- comment/reply
- assignment change
- status or lifecycle transition
- permission/access event that the user needs to know about
- important project/logic-gate/node activity

Tasks:

- [ ] Define which domain events create Updates feed rows.
- [ ] Define target rows for users, teams, and company-level feed visibility.
- [ ] Avoid making every low-level projection delta into an Updates item.
- [ ] Keep read/unread state per target/user, not on the global feed row itself.
- [ ] Add tests for feed row creation and target selection.

Preferred realtime shape:

```text
updates:user:<user_id>
updates:team:<team_id>
updates:company:<company_id>
```

### Company Explorer Mutation Rules

Company Explorer writes should follow the same command pattern as the current GVIC/logic-gate command style:

```text
handler validates and authorizes
repository command starts transaction
command updates canonical source tables and required hot projections
command appends domain events and event rows
handler publishes committed workspace/projection deltas
frontend patches or refetches bounded loaded parents
```

Company Explorer must be a two-way street with the primitive source tables:

```text
Creating or moving through Company Explorer updates native source/relationship tables.
Changes made from native graph views appear in Company Explorer when relevant parents are loaded.
```

Folder/manual placement commands:

- [ ] Create folder under root or another folder.
- [ ] Rename folder.
- [ ] Move folder under another folder or root.
- [ ] Delete folder with explicit confirmation for descendants.
- [ ] Place existing project, logic gate, or node in a folder.
- [ ] Move an existing manual placement between folders/root.
- [ ] Remove a manual placement without deleting the native resource.

Native create commands from Explorer:

- [ ] Create project under a folder/root: create native project and create Explorer manual placement.
- [ ] Create logic gate under a folder/root: create native logic gate and create Explorer manual placement.
- [ ] Create node under a folder/root: create native node and create Explorer manual placement.
- [ ] Create logic gate under a project: create native logic gate and create project relationship.
- [ ] Create node under a project: create native node and create project relationship.
- [ ] Create node under a logic gate: create native node and create logic-gate assignment.
- [ ] Create node under a logic gate that is being viewed inside a project: create native node, create logic-gate assignment, and create project relationship.

Move commands from Explorer:

- [ ] Move node from one logic gate to another: update native logic-gate assignment in one semantic command.
- [ ] Move node into a project: update native project relationship.
- [ ] Move node into a logic gate inside a project: update native logic-gate assignment and native project relationship together.
- [ ] Move logic gate into a project: update native project relationship.
- [ ] Move project into another project only if project nesting is a real native relationship; otherwise treat it as manual Explorer placement.
- [ ] Moving between folders/root changes Explorer manual placement only.

Delete commands:

- [ ] Removing from Explorer deletes only the manual Explorer placement.
- [ ] Deleting a node/logic gate/project deletes the native resource through its native delete command.
- [ ] Native deletion must clean up Explorer references.
- [ ] Deleting a native relationship removes that native relationship and refreshes the affected loaded Explorer parent.

Email drop commands:

- [ ] Drop email on existing node: link the email to that node; do not create a new node.
- [ ] Drop email on folder/root: create a node from the email and manually place it in that folder/root.
- [ ] Drop email on project: create a node from the email and create native project relationship.
- [ ] Drop email on logic gate: create a node from the email and create native logic-gate assignment.
- [ ] Drop email on logic gate inside a project: create a node, create native logic-gate assignment, and create native project relationship.
- [ ] Email drop must be one backend command, not separate frontend calls that can partially succeed.

Preferred realtime shape:

```text
company_explorer:root:<company_id>
company_explorer:folder:<folder_id>
company_explorer:project:<project_id>
company_explorer:logic_gate:<logic_gate_id>
company_explorer:node:<node_id>
```

Only loaded/visible parents should refetch or patch immediately. Unloaded parents should be marked stale at most.

## Phase 3: Frontend Cache And Live Update Discipline

Goal: make the frontend react predictably without broad refetches, tab-to-tab dependency, or projection-only mutations.

Tasks:

- [ ] Give My Work and Updates separate cache keys by surface, scope, and cursor/page.
- [ ] Do not let `Me` or `Team` reuse `All` as their cache source.
- [ ] On scoped realtime events, invalidate or refetch only the matching visible scope.
- [ ] If the current tab is not visible, mark its scope stale instead of immediately fetching.
- [ ] Use bounded refetches: current page/window first, older pages only when the user navigates there.
- [ ] Keep gap/reconnect behavior simple: if a sequence gap is detected, refetch the affected scope.
- [ ] Remove Company Explorer `Me`, `Team`, and `All` tab cache keys and realtime scopes.
- [ ] Company Explorer should cache loaded parent rows by parent identity: root, folder, project, logic gate, or node.
- [ ] On Company Explorer realtime events, patch/refetch only loaded affected parents.
- [ ] Do not eagerly fetch unopened folders, projects, or logic gates after a realtime event.
- [ ] Drag/drop UI for Company Explorer and My Work should call semantic command endpoints and rely on committed realtime/projection updates for final state.

Cache key examples:

```text
my_work:me:<company_id>
my_work:team:<company_id>:<team_id>
my_work:all:<company_id>

updates:me:<company_id>:<cursor/window>
updates:team:<company_id>:<team_id>:<cursor/window>
updates:all:<company_id>:<cursor/window>

company_explorer:root:<company_id>
company_explorer:folder:<company_id>:<folder_id>
company_explorer:project:<company_id>:<project_id>
company_explorer:logic_gate:<company_id>:<logic_gate_id>
company_explorer:node:<company_id>:<node_id>
```

## Phase 4: Hard Cutover Company Explorer Schema And Commands

Goal: finish the Company Explorer architecture by migrating the database to the final containment/reference model, deleting the old Company Explorer storage model, and routing all Explorer CRUD through semantic backend commands.

This phase is a hard cutoff. Do not keep compatibility tables, old scope behavior, or duplicate Explorer graph tables around as long-term runtime paths.

### Final Table Ownership

Company Explorer owns only folder containment and manual references:

```text
company_explorer_folders
- company_id
- folder_id
- parent_folder_id nullable
- name
- position
- default_access
- created_by_user_id
- created_timestamp
- updated_timestamp
```

```text
company_explorer_items
- company_id
- item_id
- parent_folder_id nullable
- target_type: project | logic_gate | node
- target_id
- position
- created_by_user_id
- created_timestamp
- updated_timestamp
```

Canonical source tables own all real resources and relationships:

```text
projects
logic_gates
nodes
project_relationships / project_relationship_projection
node_logic_gate_assignments
node_relationships
logic_gate_relationships
resource_permissions
```

Company Explorer must not store copies of:

- project rows
- logic gate rows
- node rows
- project-to-resource relationships
- logic-gate-to-node assignments
- node relationships
- logic gate relationships
- Me/Team/All scopes
- user/team subscriptions

### Schema Migration Tasks

- [ ] Create the final `company_explorer_folders` shape with no `folder_kind`, no `system_key`, no `scope_type`, and no `scope_id`.
- [ ] Create `company_explorer_items` for manual folder/root references to canonical projects, logic gates, and nodes.
- [ ] Enforce one parent per folder through `parent_folder_id`.
- [ ] Enforce valid manual targets with `target_type in ('project', 'logic_gate', 'node')`.
- [ ] Enforce target existence by application validation or database constraints where practical.
- [ ] Enforce one manual Explorer placement per canonical target unless the product later explicitly adds shortcut support.
- [ ] Preserve folder permissions as permissions on `company_explorer_folder`.
- [ ] Keep native resource permissions on native projects, logic gates, and nodes.

### Data Migration Tasks

- [ ] Backfill final folders from existing Company Explorer folder/entity rows.
- [ ] Backfill folder nesting into `company_explorer_folders.parent_folder_id`.
- [ ] Backfill manual references into `company_explorer_items` only when the parent is root/folder containment.
- [ ] Do not backfill native project relationships into `company_explorer_items`.
- [ ] Do not backfill native logic-gate node assignments into `company_explorer_items`.
- [ ] Do not migrate Me/Team/All subscriptions. They are deleted with the old product model.
- [ ] Validate no orphan folders remain.
- [ ] Validate every item target points at an existing project, logic gate, or node.
- [ ] Validate row counts before and after migration with explicit migration verification SQL.

### Old Model Removal Tasks

- [ ] Drop `company_explorer_folder_items`.
- [ ] Drop `company_explorer_entities`.
- [ ] Drop `company_explorer_edges`.
- [ ] Drop `company_explorer_subscriptions`.
- [ ] Remove old Company Explorer lazy scope constants and normalization for `me` and `team`.
- [ ] Remove old backend handlers that write folder items, V2 entities, V2 edges, or subscriptions.
- [ ] Remove frontend code that posts to old folder-item, V2 edge, or subscription endpoints.
- [ ] Remove tests that assert old scoped/copy-graph behavior.
- [ ] Add replacement tests for the final containment/reference behavior.

### Final Read Rules

- [ ] Root read returns root folders and root manual item references from Company Explorer tables.
- [ ] Folder children read returns child folders and manual item references from Company Explorer tables.
- [ ] Project children read returns native project relationships from project relationship tables/projections.
- [ ] Logic gate children read returns native node assignments from `node_logic_gate_assignments`.
- [ ] Node expansion reads native node relationships only if the product supports node-native children; otherwise it opens/selects the node.
- [ ] Search reads canonical visible projects, logic gates, and nodes, and may include manual Explorer folder location as context.

### Final Write Rules

Folder/manual placement commands:

- [ ] Create, rename, move, and delete folders through `company_explorer_folders`.
- [ ] Place existing project, logic gate, or node into root/folder through `company_explorer_items`.
- [ ] Move a manual item between root/folders by updating `company_explorer_items`.
- [ ] Remove a manual item from Explorer without deleting the native resource.

Native semantic commands from Explorer:

- [ ] Create project under root/folder: create native project and optional Explorer manual item.
- [ ] Create logic gate under root/folder: create native logic gate and optional Explorer manual item.
- [ ] Create node under root/folder: create native node and optional Explorer manual item.
- [ ] Create or move logic gate under project: update native project relationship.
- [ ] Create or move node under project: update native project relationship.
- [ ] Create or move node under logic gate: update native logic-gate assignment.
- [ ] Create or move node under logic gate inside project: update native logic-gate assignment and native project relationship in one backend command.
- [ ] Delete native project, logic gate, or node only through native delete commands; cleanup Explorer references as part of that command.

Email drop commands:

- [ ] Drop email on existing node: attach/link email to that node.
- [ ] Drop email on folder/root: create native node and create Explorer manual item.
- [ ] Drop email on project: create native node and native project relationship.
- [ ] Drop email on logic gate: create native node and native logic-gate assignment.
- [ ] Drop email on logic gate inside project: create native node, native logic-gate assignment, and native project relationship in one backend command.
- [ ] Include enough target context in the frontend drop payload to distinguish a standalone logic gate from a logic gate being viewed inside a project.
- [ ] Email drop must be one transaction-backed backend command, not a sequence of frontend writes.

### Live Refresh Rules

- [ ] Every Company Explorer command emits affected scopes for the exact parents/resources touched.
- [ ] Use `company_explorer:root:<company_id>` for root containment changes.
- [ ] Use `company_explorer:folder:<folder_id>` for folder containment/manual item changes.
- [ ] Use `company_explorer:project:<project_id>` when native project children changed.
- [ ] Use `company_explorer:logic_gate:<logic_gate_id>` when native logic-gate children changed.
- [ ] Use `company_explorer:node:<node_id>` when native node context changed.
- [ ] Frontend refreshes only loaded affected parents.
- [ ] Unloaded folders/projects/logic gates/nodes are marked stale at most; they are fetched when opened.
- [ ] Sequence gap recovery refetches only the affected loaded parent scopes when possible.

## Acceptance Criteria

- [ ] My Work `Me`, `Team`, and `All` can each load independently.
- [ ] Updates `Me`, `Team`, and `All` can each load independently.
- [ ] A failure in one user/team scope does not blank the entire My Work surface.
- [ ] Updates feed rows are not treated as My Work rows.
- [ ] My Work rows are not treated as Updates feed rows.
- [ ] Live changes invalidate or refetch only bounded affected scopes.
- [ ] Existing shared UI helpers remain presentation helpers only.
- [ ] Company Explorer is company-wide only; no `Me`, `Team`, or `All` tabs remain.
- [ ] Company Explorer folders nest correctly with one parent per folder.
- [ ] Company Explorer manual placements reference canonical resources without copying them.
- [ ] Company Explorer reads show both manual folder organization and real native project/logic-gate relationships.
- [ ] Dragging an email onto a node, logic gate, project, folder, or logic gate inside project performs the correct semantic command.
- [ ] Creating nodes, logic gates, and projects from Company Explorer creates real native resources.
- [ ] Moving nodes/logic gates/projects from Company Explorer updates real native relationship tables where applicable.
- [ ] My Work drag/drop uses the same semantic commands and does not mutate projection rows directly.
- [ ] Final Company Explorer schema has no runtime dependency on old scoped/copy-graph tables.
- [ ] Old Company Explorer folder-item, entity, edge, and subscription tables are dropped after verified migration.
- [ ] Company Explorer stores only folders and manual references; native relationships remain in native tables.
- [ ] Company Explorer realtime refreshes only loaded affected parent scopes.
