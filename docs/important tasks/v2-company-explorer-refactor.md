# V2 Company Explorer Refactor

## Purpose

This document tracks the proposed V2 Company Explorer refactor.

The goal is to replace the current folder/item model with a lazy, permission-aware explorer graph built from reusable entities and explicit placements.

Company Explorer should become a durable navigation surface for company work, people, groups, folders, projects, Logic Gates, and nodes. It should not be an active-work inbox and should not own native resource truth.

## Core Decisions

Company Explorer is a place, not just an aggregate query.

The Me, Team, and All tabs resolve different root entities:

```text
Me
  The current user's explorer entity.

Team
  The immediate user group explorer entities that the current user belongs to.
  If the user belongs to multiple immediate groups, show multiple root group rows.

All
  The company root explorer entity, or the top company-level group roots under it.
```

Tabs choose where the tree starts. They should not rebuild a fake tree by aggregating every possible resource.

Company Explorer has no active/history lifecycle. If a folder, project, Logic Gate, node, user, or group appears in Company Explorer, it remains there until a user removes the placement or the native resource is deleted.

My Work owns active-work filtering and aging rules. My Work can hide completed items after the defined history window. Company Explorer should not auto-remove items because they are done.

Search can still search outside the explorer graph. The search bar should first search the current visible/active surface, then fall back into native node, Logic Gate, and project primitives, including historical primitives when needed.

## Current Model Problem

The current Company Explorer model is based on:

```text
company_explorer_folders
company_explorer_folder_items
```

That model is too narrow for the desired behavior:

- folders are treated as the main durable container type
- resources are placed through folder-item rows
- an item can only live in one folder because the item placement key is effectively resource-oriented
- Me, Team, and All behavior has to be layered on through scope metadata and filters
- native relationships such as project relationships, Logic Gate assignments, and group membership are not first-class in the tree model
- the read path and permission path have become hard to reason about

The V2 model should not try to stretch the current tables. Treat this as a new explorer graph model, then migrate or bridge old data intentionally.

## Entity Model

Company Explorer needs a reusable entity row for each thing that can appear in the tree.

Proposed table:

```text
company_explorer_entities
- company_id uuid not null
- entity_id uuid not null
- entity_type text not null
- resource_id uuid null
- name text null
- default_access text null
- created_timestamp timestamptz not null
- updated_timestamp timestamptz not null
```

Allowed `entity_type` values:

```text
company
user_group
user
folder
project
logic_gate
node
```

`company` is useful as the All-tab root.

`user_group` is useful as Team and All hierarchy.

`user` is useful as the Me-tab root and as a child of group entities.

`folder` is native only to Company Explorer.

`project`, `logic_gate`, and `node` are links to native resource tables.

## Resource Identity

For native resources:

```text
entity_type = project     -> resource_id = projects.project_id
entity_type = logic_gate  -> resource_id = logic_gates.logic_gate_id
entity_type = node        -> resource_id = nodes.node_id
entity_type = user        -> resource_id = users.user_id
entity_type = user_group  -> resource_id = company_user_groups.group_id
entity_type = company     -> resource_id = companies.company_id
```

For folders:

```text
entity_type = folder
resource_id = null
entity_id is the folder identity
```

The entity table should have a uniqueness rule for native resources:

```text
unique(company_id, entity_type, resource_id)
where resource_id is not null
```

This ensures a project, user, group, node, or Logic Gate has one stable explorer entity per company.

Folder entities are different. They are native to Explorer, so the folder identity is the entity identity.

## Name Rules

The API should return a unified `name` field for all entity types.

The source of truth differs by type:

```text
folder
  company_explorer_entities.name is the source of truth.

project
  projects.name is the source of truth.

logic_gate
  logic_gates.header is the source of truth.

node
  nodes.title is the source of truth.

user
  users.display_name or users.email is the source of truth.

user_group
  company_user_groups.name is the source of truth.

company
  companies.name is the source of truth.
```

If `company_explorer_entities.name` is stored for native resources, treat it as a cached display name only. Native resource updates must update or override that display value. The Explorer should not become the source of truth for project, Logic Gate, node, user, group, or company names.

## Default Access

`default_access` is useful for folder entities because folders are native to Company Explorer and need permissions.

For native resources, do not duplicate native permission state into Company Explorer.

Recommended rule:

```text
folder entity
  default_access may live on company_explorer_entities.
  folder permissions use the existing resource permission workflow.

project / logic_gate / node
  access is computed from the native resource permission model.

user / user_group / company
  access is computed from membership, role, and visibility rules.
```

If the existing permission system needs a resource type, add or keep a folder-oriented permission target for Company Explorer folders. Do not make every native entity permissioned twice.

## Edge Model

Company Explorer needs explicit placement edges.

Proposed table:

```text
company_explorer_edges
- company_id uuid not null
- edge_id uuid not null
- parent_entity_id uuid not null
- child_entity_id uuid not null
- position integer not null
- created_timestamp timestamptz not null
- updated_timestamp timestamptz not null
```

The edge means:

```text
this child entity appears under this parent entity at this position
```

No `source_type` column is required in the stored edge table.

Reason: stored edges are manual explorer placements. Derived relationships already have native source tables.

Examples of stored/manual edges:

```text
user Jon -> folder "My Deals"
folder "My Deals" -> project CostCo
user_group Shipping -> folder "Shipping Shared"
company root -> user_group Finance
```

Examples of derived relationships that should not be copied into `company_explorer_edges`:

```text
user_group -> user
  source table: company_user_group_members

user_group -> child user_group
  source table: company_user_groups.parent_group_id

project -> logic_gate
project -> node
  source table: project relationships/projection

logic_gate -> node
  source table: node_logic_gate_assignments
```

The lazy children API can return stored and derived children in the same response, but the database should not duplicate native relationships into the stored edge table.

## Root Placement Rules

Root placement is required.

The tab determines the root entity or entities.

Me tab:

```text
resolve current user -> user explorer entity
fetch children of that user entity
```

Team tab:

```text
resolve current user's immediate company_user_groups
resolve each group -> user_group explorer entity
display all immediate group roots
fetch children of each expanded group entity
```

If the current user is directly in two groups, Team shows both group roots.

All tab:

```text
resolve company -> company explorer entity
fetch children of the company entity
```

The company root can contain top-level user groups, company-level folders, projects, Logic Gates, nodes, or users if the product allows them there.

## User And Group Behavior

A user can appear under multiple parent groups because edges and derived membership allow multiple parent paths.

Example:

```text
user_group Shipping
  user Jon

user_group Finance
  user Jon
```

Jon's personal Me content is not duplicated. Both group paths point to the same user entity.

When Jon is expanded from either group, the API fetches children of Jon's user entity:

```text
user Jon
  folder Jon Folder
  project Jon Project
  logic_gate Jon Logic Gate
  node Jon Node
```

Adding a user to a group should update native group membership. Once the membership exists, the Team/All tree can show that user under the group and can expose that user's Me-root children subject to permissions.

Adding a user or user group in Company Explorer should link to existing users/groups. Company Explorer should not create native users or native user groups directly.

## Team Shared Content

The Team tab needs more than user Me-tree visibility.

A team/group root can contain:

```text
derived children
  users in the group
  child user groups

stored children
  shared team folders
  shared team projects
  shared team Logic Gates
  shared team nodes
```

Example:

```text
user_group Shipping
  folder Shipping Accounts
  folder Shipping Launches
  project Shipping Project
  user Jon
  user Sam
  user_group Shipping Ops
```

The stored children represent intentional shared team workspace content.

The derived children represent native company membership.

## Lazy Fetching

Company Explorer should only fetch what the user can physically see.

Initial load:

```text
GET /v2/company-explorer/roots?view=me
GET /v2/company-explorer/roots?view=team
GET /v2/company-explorer/roots?view=all
```

Expand:

```text
GET /v2/company-explorer/entities/{entity_id}/children?view=me
GET /v2/company-explorer/entities/{entity_id}/children?view=team
GET /v2/company-explorer/entities/{entity_id}/children?view=all
```

The response should include only immediate visible children.

Response row shape:

```text
entity_id
entity_type
resource_id
name
parent_entity_id
edge_id nullable
position
has_children
effective_access
native_context
```

`edge_id` is nullable because derived children may not have stored explorer edges.

`native_context` should describe important visual context such as:

```text
project_id
logic_gate_id
user_id
user_group_id
folder_id
```

The frontend should cache loaded parent IDs. If a parent is not loaded, deltas should not trigger eager fetching.

## Children By Entity Type

The lazy children endpoint should merge stored edges and native derived children based on the expanded parent.

Folder parent:

```text
return stored/manual child edges under this folder entity
```

User parent:

```text
return stored/manual child edges under this user entity
```

User group parent:

```text
return stored/manual child edges under this group entity
return native child user groups
return native member users
```

Company parent:

```text
return stored/manual child edges under this company entity
return top-level user groups if product wants All to start there
```

Project parent:

```text
return stored/manual child edges under this project entity if any
return native project child relationships: projects, Logic Gates, nodes
```

Logic Gate parent:

```text
return stored/manual child edges under this Logic Gate entity if any
return native assigned nodes from node_logic_gate_assignments
```

Node parent:

```text
usually return no explorer children
email attachments and node details belong to node-specific workflows
```

## Manual Placement Versus Native Relationship

This is the core rule:

```text
Company Explorer edges store manual placement.
Native relationship tables store real work relationships.
The lazy read path merges both.
```

Do not copy native project relationships, Logic Gate assignments, or user-group memberships into `company_explorer_edges`.

That avoids exploding sync complexity.

If a project relationship changes, update the native project relationship source of truth and emit a delta/invalidation for loaded project parents.

If a Logic Gate assignment changes, update `node_logic_gate_assignments` and emit a delta/invalidation for loaded Logic Gate parents.

If a group membership changes, update `company_user_group_members` and emit a delta/invalidation for loaded group parents.

## Drag And Drop Rules

Dragging inside Company Explorer must decide whether the operation changes only explorer placement or changes native source-of-truth relationships.

Folder/user/group placement:

```text
Move project, Logic Gate, node, or folder under a folder/user/group
  update company_explorer_edges
```

Node to Logic Gate:

```text
update node_logic_gate_assignments
do not store that derived child edge in company_explorer_edges
```

Node or Logic Gate to Project:

```text
update project relationship tables/projections
do not store that derived child edge in company_explorer_edges unless it is also a manual placement
```

Project to folder/user/group:

```text
update company_explorer_edges
native project remains the same project
```

Project from one project parent to another project parent:

```text
update native project relationships if project nesting is a native project relationship
```

The backend should own drag interpretation. The frontend should not guess which source-of-truth tables need updates.

Drag command payload should include:

```text
dragged_entity_id
dragged_entity_type
dragged_resource_id
from_parent_entity_id
to_parent_entity_id
to_position
ancestor_context_before
ancestor_context_after
```

`ancestor_context_*` should include any known surrounding context:

```text
project_id
logic_gate_id
user_id
user_group_id
folder_id
```

This is required for cases like:

```text
drag node from Project A / Logic Gate X to Project B / Logic Gate Y
```

The backend transaction should update all affected native relationships and stored manual placements consistently.

## Email Drag And Drop

Dragging an email from My Triage or Shared Triage into Company Explorer is a command workflow.

Emails are not explorer edges.

Drop email on folder/user/group:

```text
create a node
place the node under the dropped explorer parent if that parent is a manual placement parent
link the email to the node
apply assignment/visibility defaults from the target context
```

Drop email on project:

```text
create a node
relate the node to the project
link the email to the node
```

Drop email on Logic Gate:

```text
create a node
assign the node to the Logic Gate
link the email to the node
```

Drop email on Logic Gate inside a project:

```text
create a node
assign the node to the Logic Gate
relate the node to the project
link the email to the node
```

Drop email on existing node:

```text
link the email to that existing node
do not create a new explorer edge unless a separate placement action is requested
```

The drop target must carry enough context for the backend to apply the correct native relationship changes.

## Create And Add Actions

Right-click actions in Company Explorer should support:

```text
create folder
create project
create Logic Gate
create node
add existing user
add existing user group
```

`create folder`:

```text
create company_explorer_entities row with entity_type=folder
create company_explorer_edges row from selected parent to folder
```

`create project`:

```text
create native project
ensure explorer entity for project
create manual edge under selected parent if selected parent is a manual placement context
apply native project relationships if selected parent is a project context
```

`create Logic Gate`:

```text
create native Logic Gate
ensure explorer entity for Logic Gate
create manual edge or native project relationship based on selected parent context
```

`create node`:

```text
create native node
ensure explorer entity for node
create manual edge, project relationship, and/or Logic Gate assignment based on selected parent context
```

`add user`:

```text
select existing user
ensure explorer entity for user
create manual edge if adding to a manual explorer location
or update native group membership if adding to a group as membership
```

`add user group`:

```text
select existing user group
ensure explorer entity for user group
create manual edge if adding to a manual explorer location
or update native group parent relationship if changing group hierarchy
```

Company Explorer should not directly create native users or native user groups.

## Entity Upsert Rules

Explorer entities should be cheap to ensure.

When a native project, Logic Gate, node, user, user group, or company needs to appear in Company Explorer:

```text
upsert company_explorer_entities(company_id, entity_type, resource_id)
```

This can happen when:

- a native resource is created
- a native resource is manually added to Explorer
- a lazy derived relationship returns a resource that has no explorer entity yet
- a migration backfills existing native resources

Stable entity IDs are important so the frontend can cache expanded rows and handle realtime deltas.

## Permissions

Permissions must remain a first-class concern.

Folder entities:

```text
permission target is the folder entity
default_access can live on the folder entity
exception grants use existing resource permissions workflow
```

Native resources:

```text
node/project/Logic Gate access comes from native resource permissions
```

Users and groups:

```text
visibility comes from membership, role, and product policy
```

Expanding a user in Team or All should expose that user's Me-root children only if the current viewer is allowed to see those children.

If the product rule is that teammates can see all teammate Me content, that needs to be implemented as an explicit permission policy, not as an accidental side effect of tree expansion.

Visible child reads must check both:

```text
the parent/path is visible
the child entity or native resource is visible
```

This prevents hidden folders or private resources from leaking through Team or All.

## My Work Versus Company Explorer

My Work:

```text
active work surface
auto-filters active items
can age completed items out after the product-defined history window
owns the completed-for-7-days rule
```

Company Explorer:

```text
durable navigation graph
does not auto-remove completed or historical resources
shows whatever has been explicitly placed or derived from native relationships
```

Rule:

```text
Do not store active/history state on company_explorer_entities or company_explorer_edges.
```

The completed-node history rule belongs outside Company Explorer.

Search:

```text
first search active/current visible explorer context
if no useful result, search native node/Logic Gate/project primitives
historical primitives can be found through search
```

## Realtime And Delta Handling

Company Explorer must stay live without fetching the whole database.

New explorer events:

```text
company_explorer_entity_upserted
company_explorer_entity_deleted
company_explorer_edge_upserted
company_explorer_edge_deleted
company_explorer_parent_children_changed
```

Native events that affect visible explorer rows:

```text
node_created
node_updated
node_deleted
logic_gate_created
logic_gate_updated
logic_gate_deleted
project_created
project_updated
project_deleted
project_relationship_upserted
project_relationship_deleted
work_item.logic_gate_assignment_saved
work_item.logic_gate_assignment_moved
work_item.logic_gate_assignment_removed
company_user_group_created
company_user_group_updated
company_user_group_deleted
company_user_group_member_added
company_user_group_member_removed
resource_permissions_updated
```

Realtime handling rule:

```text
If the affected parent is loaded, patch or refetch that parent's immediate children.
If the affected parent is not loaded, do not fetch it yet.
If a visible row's native name/status changes, patch the visible row.
If permissions change, remove rows that are no longer visible and allow visible parents to refresh.
```

This preserves lazy loading.

## API Shape

Roots:

```text
GET /v2/company-explorer/roots?company_id=:company_id&view=me
GET /v2/company-explorer/roots?company_id=:company_id&view=team
GET /v2/company-explorer/roots?company_id=:company_id&view=all
```

Children:

```text
GET /v2/company-explorer/entities/:entity_id/children?company_id=:company_id&view=:view
```

Create folder:

```text
POST /v2/company-explorer/folders
```

Add existing entity:

```text
POST /v2/company-explorer/edges
```

Move/reorder:

```text
POST /v2/company-explorer/drag
```

Remove placement:

```text
DELETE /v2/company-explorer/edges/:edge_id
```

Delete folder:

```text
DELETE /v2/company-explorer/entities/:entity_id
```

Email drop:

```text
POST /v2/company-explorer/email-drop
```

## Delete Versus Remove

The UI needs clear destructive semantics.

Remove from Company Explorer:

```text
delete company_explorer_edges row only
native resource remains
```

Delete folder:

```text
delete folder entity
delete its manual descendant edges/folders based on product confirmation rules
```

Delete project / Logic Gate / node:

```text
delete native resource only through explicit destructive action
cascade or clean up explorer entity/edges after native delete
```

Remove derived child:

```text
remove native relationship
example: remove node from Logic Gate -> delete/update node_logic_gate_assignment
example: remove node from Project -> delete project relationship
```

## Cycle And Duplication Guards

Stored manual edges need cycle protection.

Prevent:

```text
entity A -> entity B
entity B -> entity A
```

Prevent duplicate placement under the same parent:

```text
unique(company_id, parent_entity_id, child_entity_id)
```

Allow the same child under different parents:

```text
user Jon under group Shipping
user Jon under group Finance
project CostCo under user Jon
project CostCo under group Shipping
```

Derived relationship reads should also guard against recursive cycles in native project/group relationships.

Use path guards in recursive SQL where needed.

## Migration Strategy

Do not mutate the old Company Explorer model in place, and do not drop old tables before the data has been migrated.

This is a data-preserving migration.

The old tables can be removed only after V2 tables exist, old rows are backfilled into V2 entities/edges/permissions, backend reads and writes are switched to V2, and verification proves the migrated tree is correct.

Preferred migration path:

### Phase 1: Create V2 Tables And Migrate Safely

This phase is non-destructive. The old tables remain in place.

1. Add V2 tables beside existing tables.
2. Add V2 store/repository helpers needed for migration and verification.
3. Backfill existing Company Explorer data into V2:
   - existing folders -> folder entities
   - existing folder nesting -> manual edges
   - existing folder items -> manual edges from folder entity to resource entity
   - existing folder permissions -> folder entity permissions
   - existing folder shares -> either folder permission grants or an explicit replacement share workflow
   - existing default folder seeds -> no direct replacement unless V2 still needs seed tracking
4. Run side-by-side verification comparing old visible folder/item data to migrated V2 visible entity/edge data.
5. Add tests and verification queries proving the migration preserves existing folders, placements, resource links, permissions, and root placement.

Phase 1 is complete only when V2 tables can be rebuilt from current old-table data without losing existing Company Explorer folders, Logic Gates, nodes, projects, or permissions.

### Phase 2: Refactor Backend And Delete Old Tables

This phase switches the app to V2 and removes the old tables only after the backend path is verified.

1. Add or switch backend lazy roots/children API to V2.
2. Switch backend writes to V2 create/move/remove commands.
3. Refactor the necessary backend store and HTTP code away from old folder/item tables.
4. Refactor the existing frontend Company Explorer UI to consume V2 rows while preserving the current tree shell, context menu, drag/drop interactions, realtime subscription behavior, and creation workflows.
5. Verify Me/Team/All roots.
6. Verify drag/drop commands.
7. Verify email drop commands.
8. Verify realtime delta behavior.
9. Disable old Company Explorer writes.
10. Drop old Company Explorer tables only after V2 is complete and verified.

Old tables likely replaced:

```text
company_explorer_folders
company_explorer_folder_items
company_explorer_default_folder_seeds
company_explorer_folder_shares, if sharing moves to the normal permission model
```

Old code likely refactored or heavily rewritten:

```text
backend/internal/http/company_explorer_handlers.go
backend/internal/store/postgres_company_explorer.go
backend/internal/store/postgres_company_explorer_lazy.go
frontend/src/modules/company-explorer/CompanyExplorerContent.tsx
frontend/src/modules/company-explorer/companyExplorerTreeRows.ts
frontend/src/modules/company-explorer/companyExplorerStore.ts
frontend/src/modules/company-explorer/companyExplorerLazyApi.ts
```

The backend logic and UI behavior do not need to be deleted wholesale. The storage model, SQL, and API row shape need to change. The existing product workflows should be preserved where they still match V2:

```text
lazy roots/children
expand/collapse
folder permissions
context menu actions
drag/drop
create folder/project/Logic Gate/node
add existing user/user group
email drop into Explorer
realtime workspace updates
```

## Backfill Mapping

Backfill must preserve existing user data before the old tables are dropped.

Existing folders:

```text
company_explorer_folders.folder_id
  -> company_explorer_entities.entity_id
  -> entity_type = folder
  -> name = company_explorer_folders.name
  -> default_access = company_explorer_folders.default_access
```

Existing folder parent relationships:

```text
company_explorer_folders.parent_folder_id
  -> company_explorer_edges(parent_entity_id, child_entity_id)
```

Existing root folders:

```text
parent_folder_id is null
  -> attach under the closest matching V2 root entity based on old scope_type/scope_id
```

Old scope mapping:

```text
scope_type = user
  -> parent root is that user entity

scope_type = team
  -> parent root is that user_group entity

scope_type = company
  -> parent root is company entity
```

Existing folder items:

```text
company_explorer_folder_items.folder_id
  -> parent_entity_id

company_explorer_folder_items.item_type + item_id
  -> ensure resource-backed company_explorer_entities row
  -> child_entity_id
  -> company_explorer_edges row
```

Existing folder shares:

```text
company_explorer_folder_shares
  -> migrate to folder entity permission grants if possible
  -> keep separate replacement only if invitation/share semantics are still required
```

Existing default folder seeds:

```text
company_explorer_default_folder_seeds
  -> likely obsolete after V2 root placement
  -> only migrate if V2 still needs idempotent seed tracking
```

Old table drop order must account for foreign keys. Drop dependent tables before parent tables:

```text
company_explorer_folder_shares
company_explorer_folder_items
company_explorer_default_folder_seeds
company_explorer_folders
```

Do not run the drop migration until V2 reads and writes are live and the backfill has been validated.

## Testing Requirements

Schema tests:

- entities table exists with valid entity types
- native resource uniqueness exists
- folders can have null resource_id
- edges allow multiple parents for same child
- edges reject duplicate same-parent placement
- edge cycle prevention exists

Root tests:

- Me resolves current user entity
- Team resolves all immediate group entities for current user
- Team supports multiple root groups
- All resolves company root or top-level company roots

Lazy loading tests:

- roots fetch only roots
- expanding a folder fetches immediate children only
- expanding a project fetches immediate project children only
- expanding a Logic Gate fetches immediate assigned nodes only
- expanding a group fetches immediate users, child groups, and manual group content only

Permission tests:

- private folder does not leak through All
- private user Me content does not leak through Team
- resource-level access still gates node/project/Logic Gate rows
- folder default access and explicit grants work

Drag/drop tests:

- moving between folders updates explorer edge only
- moving node to Logic Gate updates native assignment
- moving node to Project updates native project relationship
- moving node to Logic Gate inside Project applies both contexts when required
- moving project between user/group/folder roots updates explorer placement

Email drop tests:

- drop email on folder creates node and manual placement
- drop email on project creates node and project relationship
- drop email on Logic Gate creates node and Logic Gate assignment
- drop email on Logic Gate inside Project creates node, Logic Gate assignment, and project relationship
- drop email on existing node links email only

Realtime tests:

- native name changes update visible rows
- manual edge changes update loaded parents
- project relationship changes refresh loaded project parent only
- Logic Gate assignment changes refresh loaded Logic Gate parent only
- group membership changes refresh loaded group parent only
- unloaded parents do not trigger eager fetches

Migration tests:

- existing folders become folder entities
- existing folder nesting becomes edges
- existing folder items become edges
- permissions survive migration
- old hidden/private folder behavior remains protected

## Open Decisions

Decide whether `company` should be a required explorer entity type or whether All roots can be represented by parentless edges. The current preference is a company entity root because it keeps roots primitive-based and avoids a separate spaces table.

Decide whether folder sharing remains a separate share workflow or becomes normal folder permissions only.

Decide whether Team membership implies visibility into all teammate Me content, or whether Team only shows the viewer-visible slice of each user tree. The safer default is viewer-visible only.

Decide whether dragging a resource from one user root to another means move, copy/link, or permission/ownership change. The backend command needs explicit semantics before implementation.

Decide how much native resource display data to cache on `company_explorer_entities`. The API should always return unified names, but native tables should remain source of truth.

## Non-Goals

Do not make Company Explorer own project, Logic Gate, node, user, or user group truth.

Do not copy native relationship rows into Company Explorer edges.

Do not make Company Explorer responsible for My Work active/history rules.

Do not fetch the full explorer graph on tab open.

Do not create native users or native user groups from Company Explorer.

Do not remove the existing permission guarantees during migration.
