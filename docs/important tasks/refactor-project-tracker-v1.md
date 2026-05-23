# Refactor Project Tracker V1

## Project Goal

Replace normal write-path full-company `effective_resource_access` rebuilds with scoped, transactional updates.

`effective_resource_access` must remain a derived lookup table. It is not source of truth.

Source truth remains in:

- `company_memberships` for company admin and dev admin access
- `resource_access_grants` for explicit user/group resource grants only
- `company_user_groups` and `company_user_group_members` for group expansion
- `nodes.assignee_user_id` for node assignee access
- `logic_gate_raci_assignments` for Logic Gate RACI access
- `communications_shared_inbox_raci_assignments` for shared inbox user RACI access
- `communications_shared_inbox_raci_group_assignments` for shared inbox group RACI access
- `node_logic_gate_assignments` for nodes visible through a Logic Gate assignment

## Scope

In scope:

- Keep `effective_resource_access` as a positive-access read model.
- Keep full-company rebuild as a repair/admin path.
- Move correctness paths to source-scoped transactional effective-access maintenance.
- Keep changes practical and local to the current repository shape.

Out of scope:

- No broad renames.
- No table rename project.
- No map snapshot work.
- No deletion of `resource_access_grants` until all explicit-grant dependencies are separately migrated and proven.

## Status Values

- `[ ]` Not started
- `[~]` In progress
- `[x]` Done
- `[!]` Blocked

## Codex Instance Plan

This tracker is organized around Codex handoff size, not just architectural phases.

Recommended remaining execution:

1. `Phase 1` stays as its own foundation instance.
2. `Phase 2A` is one implementation instance for direct/core resource sources.
3. `Phase 2B` is one implementation instance for inherited/cross-resource sources.
4. `Phase 3` is one final cleanup instance combining old handler repair removal and derived-grant compatibility cleanup.

Do not hand all source-scoped updates to one Codex instance. The old Phase 2 was intentionally split because it mixed direct grants, admin access, assignee access, RACI, folder inheritance, group hierarchy, and assigned-node visibility.

## Current Problem

Many HTTP write handlers call `refreshEffectiveAccessProjection`, which calls `RebuildEffectiveResourceAccessForCompany`.

That rebuild currently:

- starts a transaction
- deletes every `effective_resource_access` row for the company
- rebuilds from all source tables
- commits the full replacement

This works as a repair path, but it is too broad for normal mutations. It also leaves source truth and effective-access maintenance split between store transactions and handler-level repair calls.

Target behavior:

1. Validate and lock source rows.
2. Mutate source truth.
3. Recompute/delete only affected effective facts in the same transaction.
4. Append domain events in the same transaction when the existing store method does so.
5. Commit.

## Phase 0 - Baseline Audit

- [x] Identify every call site of `refreshEffectiveAccessProjection`.
- [x] Classify every call site.
- [x] Identify source tables represented by the full-company rebuild.
- [x] Identify current derived access writes into `resource_access_grants`.
- [ ] Add a guard test or counting fake proving normal handlers stop calling full rebuild after migration.

### `refreshEffectiveAccessProjection` Call Sites

| Location | Reason | Classification | Planned replacement |
| --- | --- | --- | --- |
| `backend/internal/http/communications_shared_inbox_handlers.go` | `shared_triage_access_updated` | access-affecting | Recompute explicit shared triage grants for folder descendants inside `SetEntityPermissions`. |
| `backend/internal/http/company_explorer_handlers.go` | `communications_shared_inbox_raci_updated` | access-affecting | Recompute shared inbox RACI facts for the folder and descendants inside `SetCommunicationsSharedInboxRaciAssignments`. |
| `backend/internal/http/entity_permission_handlers.go` | `entity_permissions_updated` | access-affecting | Recompute explicit grant facts for the resource inside `SetEntityPermissions`. |
| `backend/internal/http/kanban_handlers.go` | `legacy_kanban_card_assigned_to_logic_gate_work` | access-affecting | Recompute assigned-node visibility and node assignee facts inside `AssignNodeToLogicGateStatus`. |
| `backend/internal/http/kanban_handlers.go` | `legacy_kanban_card_removed_from_logic_gate_work` | access-affecting | Recompute assigned-node visibility for the removed node/gate inside `RemoveLogicGateNodeAssignment`. |
| `backend/internal/http/kanban_handlers.go` | `legacy_kanban_card_moved_as_logic_gate_work` | not access-affecting | Remove refresh after scoped writers exist. |
| `backend/internal/http/kanban_handlers.go` | `legacy_kanban_card_issue_toggled_as_logic_gate_work` | not access-affecting | Remove refresh after scoped writers exist. |
| `backend/internal/http/logic_gate_handlers.go` | `logic_gate_created` | access-affecting | Project new-resource facts for creator/admin sources inside creation path. |
| `backend/internal/http/logic_gate_handlers.go` | `logic_gate_raci_updated` | access-affecting | Recompute Logic Gate RACI and assigned-node visibility inside `SetLogicGateRaciAssignments`. |
| `backend/internal/http/logic_gate_raci_command_handlers.go` | `logic_gate_raci_command` | access-affecting | Recompute Logic Gate RACI and assigned-node visibility inside RACI add/remove command transaction. |
| `backend/internal/http/logic_gate_work_handlers.go` | `logic_gate_work_node_assigned` | access-affecting | Recompute assigned-node visibility and node assignee facts inside `AssignNodeToLogicGateStatus`. |
| `backend/internal/http/logic_gate_work_handlers.go` | `logic_gate_work_node_moved` | unclear | No-op for status/position. Access-affecting only if `assignee_policy` changes the node assignee. |
| `backend/internal/http/logic_gate_work_handlers.go` | `logic_gate_work_node_issue_toggled` | not access-affecting | Remove refresh after scoped writers exist. |
| `backend/internal/http/logic_gate_work_handlers.go` | `logic_gate_work_node_removed` | access-affecting | Recompute assigned-node visibility for removed node/gate inside `RemoveLogicGateNodeAssignment`. |
| `backend/internal/http/node_handlers.go` | `node_created` | access-affecting | Project node assignee and creator/admin facts inside node creation. |
| `backend/internal/http/node_handlers.go` | `node_assignee_updated` | access-affecting | Recompute node assignee facts inside node update transaction. |
| `backend/internal/http/work_item_handlers.go` | `work_item_logic_gate_assignment_saved` | access-affecting | Recompute assigned-node visibility and node assignee facts inside `AssignNodeToLogicGateStatus`. |
| `backend/internal/http/work_item_handlers.go` | `work_item_logic_gate_assignment_moved` | unclear | No-op for status/position. Access-affecting only if `assignee_policy` changes the node assignee. |
| `backend/internal/http/work_item_handlers.go` | `work_item_logic_gate_assignment_removed` | access-affecting | Recompute assigned-node visibility for removed node/gate inside `RemoveLogicGateNodeAssignment`. |
| `backend/internal/http/work_item_handlers.go` | `work_item_logic_gate_issue_toggled` | not access-affecting | Remove refresh after scoped writers exist. |

## Phase 1 - Effective Access Writer Foundation

- [x] Add a transaction-safe Postgres writer API.
- [x] Add matching memory-repo helpers under the existing repo lock.
- [x] Keep public repository interfaces small; prefer internal helper functions used by source-owning store methods.
- [x] Keep `RebuildEffectiveResourceAccessForCompany` available as repair/admin only.
- [x] Preserve existing effective-access read methods.

Recommended helper shape:

- `replaceEffectiveFactsForSourceTx(ctx, tx, companyID, sourceType, sourceID, facts)`
- `deleteEffectiveFactsForSourceTx(ctx, tx, companyID, sourceType, sourceID)`
- `recomputeEffectiveAccessForResourcesTx(ctx, tx, companyID, resources, sourceFamilies)`
- `recomputeLogicGateAssignedNodeVisibilityTx(ctx, tx, companyID, logicGateIDs, nodeIDs)`

Do not overfit the first helper to one source. The write model needs source cleanup by `(company_id, source_type, source_id)` and resource cleanup by `(company_id, resource_type, resource_id, source_type)`.

## Phase 2A - Core Source-Scoped Transactional Updates

Goal for this Codex instance:

- Finish direct effective-access sources that attach to a specific resource or user/company role.
- Keep changes transactional and source-scoped.
- Remove normal request-path rebuild calls only where this instance has installed scoped writers and regression coverage.
- Leave inherited folder/group work and contextual assigned-node visibility to `Phase 2B`.

### Explicit User/Group Grants

- [ ] Update `SetEntityPermissions` to maintain effective access in the same transaction.
- [ ] For `node` and `logic_gate`, recompute only that resource.
- [ ] For `shared_triage_folder`, keep the existing source truth and compatibility behavior, but defer descendant-tree correctness to `Phase 2B`.
- [ ] Preserve `no_access` handling exactly as the current full rebuild does: it is a legacy grant input and does not write positive effective facts.
- [ ] Preserve direct-user-before-group and nearest-folder precedence.

Strategy:

- Delete effective facts for `direct_user_grant` and `direct_group_grant` on affected resources.
- Re-expand current `resource_access_grants` rows through group descendants.
- Insert positive `view`, `edit`, or `admin` facts.
- If the affected resource is a Logic Gate, record the affected gate IDs for `Phase 2B` assigned-node visibility work; do not broaden this instance into contextual node visibility unless explicitly requested.

### Company Admin And Dev Admin Access

- [ ] Handle company admin membership changes.
- [ ] Handle dev admin membership changes.
- [ ] Handle resource creation so current admin users receive access to the new resource without full rebuild.
- [ ] Handle resource deletion by deleting effective rows for deleted resources.

Strategy:

- For company admin add/remove: recompute `company_admin` source facts for the affected user and company resources.
- For dev admin add/remove: recompute `company_admin` source facts for that user across affected companies. This is broad by nature but still source-scoped.
- On new node, Logic Gate, or shared triage folder creation: insert admin facts for current company admins/dev admins for that new resource.

### Node Assignee Access

- [ ] Update node creation.
- [ ] Update node assignee set/reassign/clear.
- [ ] Update node deletion cleanup.
- [ ] Remove dependency on trigger-backed assignee rows in `resource_access_grants`.

Strategy:

- Delete `node_assignee` effective facts for the node.
- If `nodes.assignee_user_id` is non-null and still a company member, insert `edit` for that node.
- If current behavior requires creator `admin`, preserve it as an explicit creator grant or a distinct source, not as assignee-derived access.

## Phase 2B - Inherited And Cross-Resource Source-Scoped Updates

Goal for this Codex instance:

- Use the scoped writer foundation and Phase 2A direct-resource facts.
- Implement source families whose facts depend on RACI, folder descendants, group descendants, or Logic Gate assignment context.
- Keep status-only moves and issue toggles as access no-ops.
- Remove normal request-path rebuild calls only where this instance has installed scoped writers and regression coverage.

### Logic Gate RACI Access

- [ ] Update `SetLogicGateRaciAssignments`.
- [ ] Update RACI add/remove command methods.
- [ ] Remove dependency on trigger-backed RACI rows in `resource_access_grants`.
- [ ] Recompute assigned-node visibility after RACI changes.

Strategy:

- Delete `logic_gate_raci` facts for the gate.
- Insert `edit` facts for current user RACI assignments.
- Recompute `logic_gate_assignment_visibility` for nodes assigned to that gate because those facts depend on effective Logic Gate visibility.

### Shared Inbox RACI Access

- [ ] Update `SetCommunicationsSharedInboxRaciAssignments`.
- [ ] Handle user assignments.
- [ ] Handle group assignments.
- [ ] Handle descendant communication folders.

Strategy:

- Delete `shared_triage_raci` facts for the folder subtree affected by the RACI source folder.
- Insert `edit` facts for user RACI assignments across the folder and descendants.
- Expand group RACI assignments through group descendants and group members.
- Keep role metadata in RACI tables. Do not use `resource_access_grants` as RACI source truth.

### Logic Gate Assigned-Node Visibility

- [ ] Update `AssignNodeToLogicGateStatus`.
- [ ] Update `RemoveLogicGateNodeAssignment`.
- [ ] Treat status-only moves as no-op for access.
- [ ] Treat issue toggles as no-op for access.
- [ ] Treat move operations with `assignee_policy` as access-affecting only because they can change `nodes.assignee_user_id`.

Strategy:

- For an assigned node, delete `logic_gate_assignment_visibility` facts for that node and gate.
- Reinsert `view` facts for users with effective `view` or stronger on the assigned Logic Gate.
- On removal, remove facts for that node/gate pair.

### Group Membership And Group Hierarchy

- [ ] Update `SetCompanyUserGroupMembers`.
- [ ] Update group parent changes.
- [ ] Update group deletion.

Strategy:

- For membership changes, recompute group-derived explicit grants and shared inbox group RACI facts for affected group roots and descendants.
- For group parent changes, use a conservative source-scoped recompute of group-derived facts for the company if precise ancestry diffing is too risky.
- Do not full rebuild all source families.

### Shared Triage Folder Hierarchy

- [ ] Update communication folder move.
- [ ] Update communication folder creation.
- [ ] Update communication folder deletion cleanup.

Strategy:

- Folder move changes inherited explicit grant and shared RACI effective facts for the moved subtree.
- Recompute `direct_user_grant`, `direct_group_grant`, and `shared_triage_raci` for the moved subtree.
- Folder creation needs inherited facts from ancestors.
- Folder deletion can delete effective rows for deleted resources before deleting source rows.

## Phase 3 - Handler Repair Removal And Derived Grant Compatibility Cleanup

This is the final cleanup Codex instance. It should run after `Phase 2A` and `Phase 2B` have scoped transactional writers and focused regression coverage.

### Remove Handler Repair Calls

- [ ] Remove handler-level calls to `refreshEffectiveAccessProjection`.
- [ ] Keep event publishing and notification projection behavior unchanged.
- [ ] Ensure committed notification fanout sees current effective access.
- [ ] Add regression coverage that normal write handlers no longer call full-company rebuild.

After this phase, `refreshEffectiveAccessProjection` should not be part of correctness paths. It may remain as an admin/repair utility.

### Derived Grant Compatibility Cleanup

`resource_access_grants` should represent explicit user/group grants only.

Current derived usage to remove or migrate:

- [ ] DB triggers/backfills that grant node assignee access into `resource_access_grants`.
- [ ] DB triggers/backfills that grant Logic Gate RACI access into `resource_access_grants`.
- [ ] Store writes that grant assignee access into `resource_access_grants`.
- [ ] Store writes that grant Logic Gate RACI access into `resource_access_grants`.
- [ ] Shared inbox route compatibility that converts RACI-looking assignments into access grants.

Recommendation:

- Stop creating new derived `resource_access_grants` rows after scoped effective writers exist.
- Preserve existing ambiguous rows temporarily because current rows have no provenance.
- Do not bulk-delete old rows until a migration can distinguish explicit grants from compatibility rows or the team accepts a cleanup/backfill plan.
- Keep direct grants in `resource_access_grants` until a separate explicit-grant source migration exists.

## Transaction Boundary Rule

Every access-affecting store method should follow this order:

1. Begin transaction.
2. Validate source entity and lock rows that define the mutation.
3. Validate users/groups are company-scoped.
4. Mutate source truth.
5. Maintain affected `effective_resource_access` facts.
6. Append domain event if this method emits one.
7. Commit.

No handler should repair effective access after a source mutation has already committed.

## Test Plan

### Parity Tests

- [ ] For each source family, compare scoped update output to `RebuildEffectiveResourceAccessForCompany`.
- [ ] Include multi-source overlap where the same user/resource has explicit grant, RACI, admin, and assignment visibility.
- [ ] Include downgrade/removal cases to prove stale facts are removed.

### Explicit Grants

- [ ] Direct user grant projects positive effective access.
- [ ] Group grant projects through child groups.
- [ ] Direct user grant wins over group grant when precedence requires it.
- [ ] Nearest shared triage folder grant wins over ancestor grant.
- [ ] `no_access` prevents positive effective facts according to current precedence behavior.
- [ ] Revoking grants removes effective facts.

### Admin Access

- [ ] Company admin receives access to existing resources after role add.
- [ ] Company admin loses source facts after role removal.
- [ ] Dev admin access works across companies according to current semantics.
- [ ] New resources get admin facts without full rebuild.

### Node Assignee

- [ ] Node create with assignee writes scoped effective access.
- [ ] Assignee reassign removes old assignee facts and writes new assignee facts.
- [ ] Assignee clear removes assignee facts.
- [ ] Node delete cleans effective rows.

### Logic Gate RACI

- [ ] RACI set writes Logic Gate `edit` facts.
- [ ] RACI add command writes only affected facts.
- [ ] RACI remove command removes stale facts.
- [ ] RACI changes update contextual node visibility for assigned nodes.

### Shared Inbox RACI

- [ ] User RACI writes shared triage folder `edit` facts.
- [ ] Group RACI expands through group members.
- [ ] RACI inheritance applies to descendant communication folders.
- [ ] Removing user/group RACI removes stale descendant facts.

### Logic Gate Work Assignments

- [ ] Assigning a node to a Logic Gate writes contextual node `view` facts.
- [ ] Removing assignment removes contextual node facts.
- [ ] Moving status/position does not rewrite access.
- [ ] Issue toggle does not rewrite access.
- [ ] Move with `assignee_policy` updates node assignee facts if it changes assignee.

### Group Changes

- [ ] Group membership add/remove updates group-derived explicit grants.
- [ ] Group membership add/remove updates shared inbox group RACI facts.
- [ ] Group parent move updates inherited group-derived facts.
- [ ] Group delete removes group-derived facts.

### Shared Triage Folder Tree

- [ ] Folder creation inherits ancestor explicit grant facts.
- [ ] Folder move recomputes moved subtree facts.
- [ ] Folder delete cleans effective rows for deleted folders.

### Transaction And Failure Tests

- [ ] If effective-access write fails, source mutation rolls back.
- [ ] If domain event append fails, source mutation and effective-access writes roll back.
- [ ] Notification fanout after commit sees updated reverse effective access.
- [ ] Normal handler tests fail if `RebuildEffectiveResourceAccessForCompany` is called.

## Open Decisions

- [ ] Decide whether creator admin access on new nodes and Logic Gates remains an explicit grant or gets a distinct effective-access source.
- [ ] Decide how conservative group-parent recompute should be in the first implementation slice.
- [ ] Decide when to remove DB triggers that write derived assignee/RACI rows into `resource_access_grants`.
- [ ] Decide whether shared inbox `assignments` fallback-to-permissions compatibility should be removed or retained behind a temporary compatibility path.

## Progress Log

- 2026-05-23: Created V1 tracker from read-only implementation plan. No source changes made.
- 2026-05-23: Split old Phase 2 into `Phase 2A` and `Phase 2B` for Codex handoff size, and combined old Phase 3 and Phase 4 into one final cleanup phase.
- 2026-05-23: Completed Phase 1 writer foundation with source-scoped and resource/source-family effective-access helpers for Postgres and memory repos, plus focused helper tests.
