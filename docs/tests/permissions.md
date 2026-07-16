Last updated: 2026-07-15

# Permissions Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Explicit Save visibility is covered by `tests/frontend/modules/editor/emailViewerContract.test.ts`; close-with-save and duplicate-write prevention still require focused interaction coverage.
- Business Logic Covered By Automated Tests: partial backend coverage for default/source-row semantics, group permission pointers, apply-to-descendants behavior, manager-preservation rules, Logic Gate-to-node permission snapshots, folder-to-child permission snapshots, same-parent preservation, cross-parent overwrite behavior, and direct node access denial. Rule ID mapping is partial. Pointer-scaled descendant apply rules are documented as target behavior and are not yet proven by implementation tests.

## Business Logic

P1 - Resource permission checks require company access before resource-level access is evaluated.
P2 - Resource access has exactly two outcomes: edit or no access.
P3 - Blank permission input is invalid and must not create an implicit grant.
P4 - Legacy `view`, `admin`, and `manage` resource permission values are invalid; compatibility aliases must not recreate a third access outcome.
P5 - Default access participates in effective access calculation.
P6 - Resource permissions support user and group source principals.
P7 - A resource can have at most 1000 explicit permission assignments in one update.
P8 - Dev admins and company admins resolve company-managed resource access to edit, not to a separate resource-admin tier.
P9 - GVIC assignments do not grant resource permission access and must not satisfy edit, delete, or mutation authorization checks.
P10 - GVIC assignments must not elevate a user from no access to edit; edit/delete authority comes only from the resource permission policy.
P11 - If a user lacks edit access, read-style access checks hide the resource instead of exposing it.
P12 - Resource mutations require edit access; a no-access actor is denied without any intermediate read-only state.
P13 - Invalid requested access levels return a bad request error.
P14 - Reading entity permission settings requires manager/admin authority and edit access to the entity.
P15 - Updating entity permission settings requires dev admin, company admin, or company manager authority with edit access to the entity.
P16 - Permission setting responses include default access, explicit user/group permission rows, legacy override user IDs, effective access, can-edit-permissions, and can-edit-manager-permissions.
P17 - Visible node, logic gate, project, and Explorer reads are filtered by effective edit access.
P18 - Map positions and relationship rows are filtered by the viewer's access to the related resources.
P19 - Kanban board and card access derives from the access level of the owning logic gate.
P20 - Regular users cannot load or update permission settings even when they have resource edit access; company manager/admin authority is a separate settings-management gate.
P21 - Malformed or unknown resource IDs do not crash visibility checks.
P22 - Permission changes recompute effective access for affected users and resources, including descendants when the change is explicitly applied to descendants.
P23 - Permission changes synchronously update effective access, canonical projection rows, and read versions for affected resources, including descendants changed by an apply-to-descendants command. Clients reconcile from the committed response or a later canonical read; no generic permission or workspace browser event is published.
P24 - Company managers do not bypass resource permissions.
P25 - Company managers can update permission exceptions for company users only; dev admins and company admins can update manager and user exceptions.
P26 - Default access has only two states, edit and no access; `resource_permissions` stores explicit user/group source rows with their own access level.
P27 - When a company manager changes a resource default, manager effective access is preserved while regular company users follow the new default and exceptions.
P28 - Legacy `resource_access_grants` rows are migrated into `resource_permissions` exception rows before the legacy table is dropped.
P29 - Runtime permission reads and writes use `resource_permissions` only; `resource_access_grants` and `entity_access_permissions` are not active permission sources.
P30 - Parent permission policies are templates captured at create time or transfer time; they are not live inherited after the child enters the parent unless an explicit apply-to-descendants command is run.
P31 - Creating a subfolder under a folder copies the direct parent folder's current permission policy to the new subfolder.
P32 - Creating, placing, or moving a project or Logic Gate into a folder copies the direct target parent folder's current permission policy to that project or Logic Gate.
P33 - Creating, assigning, or moving a node into a Logic Gate copies the direct target Logic Gate's current permission policy to that node.
P34 - Editing a child resource's permissions changes only that child; that edited child policy becomes the template for resources created or transferred directly under that child.
P35 - Reordering or re-saving a project, Logic Gate, or node under the same parent preserves that resource's current permissions.
P36 - Detaching a resource from a parent or moving it to a non-template/root location preserves its current permission policy.
P37 - Project permissions do not template Logic Gates or nodes through project relationships; folder templates apply to Explorer placement, and Logic Gate templates apply to node assignment.
P38 - Kanban board/card visibility follows the owning Logic Gate access, but opening a Kanban node detail/editor must perform a fresh node-level access check.
P39 - Permission settings denial copy explains that only managers and admins with resource edit access can manage permissions.
P40 - Group permission rows are pointers to the group or subgroup; adding a user to that group later makes the user's effective permission follow the group row without writing per-user rows.
P41 - Direct user permission rows override group permission rows for that user; group rows override default access, and the nearest matching group row wins before same-depth access-rank tie breaking.
P42 - On company Explorer folders, apply-to-descendants applies the changed permission rule keys to all descendant folders, contained projects, contained Logic Gates, and nodes assigned to those Logic Gates.
P43 - On Logic Gates, apply-to-descendants applies the changed permission rule keys to nodes currently assigned to that Logic Gate.
P44 - Every permissions dialog and embedded permissions view, including Company Explorer folders, nodes, Logic Gates, projects, shared inboxes, and Shared Triage entry points, exposes an explicit `Save` button in a stable action area. Save commits the current default, user/group, and descendant selections without closing. Editable dialogs retain close-with-save for pending changes, but closing after a successful explicit Save must not issue a duplicate write.
P45 - Runtime authorization resolves group permission rows from group source tables and group membership source rows; permission checks must not require a derived group closure/projection table to be populated.
P46 - Editing a parent without apply-to-descendants changes only that parent and the template future direct children will receive; existing descendants keep their current permission policies.
P47 - Permission policy inheritance should be implementable as reusable policy/rule pointers or immutable rule versions, not as duplicated full permission rows per descendant.
P48 - Creating or transferring a resource may copy resolved permission rule pointers from the direct parent, but it must not leave the child live-linked to future parent edits.
P49 - Apply-to-descendants should record changed rule applications for the subtree instead of rewriting a full permission policy for every descendant; the operation must remain feasible for subtrees with hundreds of thousands of descendants.
P50 - Removing a permission rule with apply-to-descendants requires an explicit tombstone/delete application so older child or ancestor rules do not reappear.
P51 - Apply-to-descendants overwrites existing descendant special rules for the same changed rule keys as of that operation; later descendant edits can override again until a newer ancestor apply occurs.
P52 - Conflicting direct bindings and ancestor apply records resolve by a monotonic transaction sequence, not wall-clock time.
P53 - Permission audit/explainability must identify whether a user's rule came from a direct resource binding, create/transfer inheritance, ancestor apply-to-descendants, or group membership, and must not report GVIC assignment as a resource-permission grant.
P54 - Soft delete for nodes and Company Explorer delete targets requires edit access to the deleted resource or container; no access and GVIC assignments never authorize the delete.
P55 - If a user is denied permission-settings visibility, the permissions dialog remains dismissible with the X control and must not attempt to autosave a panel that never loaded editable permission data.
P56 - Logic Gate work reads return the single actor-specific `can_edit` resource flag while preserving default, direct-user, group, ancestor-application, and company-role authorization semantics.
P57 - Logic Gate work authorization is evaluated before conditional ETag handling; losing edit access cannot produce a cached `304` or preserve readable board data.
P58 - Direct Logic Gate permission/default changes, gate policy revisions, inherited Explorer permission applications, Logic Gate Explorer placement changes, and ancestor folder moves/default changes invalidate the affected Logic Gate work version.
P59 - Company role, group membership, and group hierarchy changes that can alter actor permission flags conservatively invalidate all Logic Gate work versions in that company.
P60 - The actor permission fingerprint is part of the ETag, so two users with different effective permissions do not share an actor-unsafe representation validator.
P61 - GVIC Generated/request-owner data may appear in the Logic Gate header, but GVIC assignments do not set `can_edit`.
P62 - Permission mutations still publish no generic permission/workspace event. Instead, before a later Node-chat, mounted-board, or shared-mailbox hint reaches an already-subscribed socket, that narrow publisher resolves the exact current audience and fails closed on lookup errors. A user revoked after subscribing receives no later resource identifiers/hints without needing a reconnect.
P63 - A newly created email-collaboration Node has default access `no_access` and one system-managed direct edit binding for its creator. It never inherits the Unfiled/Nodes folder policy, source shared-inbox policy, Logic Gate policy, project policy, GVIC assignments, or broad company-member edit access.
P64 - A committed direct user mention or resolved user-group mention snapshots each distinct same-company user as a collaboration participant and adds one system-managed direct edit binding for that user in the same durable transaction. These are user bindings, not live group pointers, so later group changes neither grant nor revoke collaboration access.
P65 - Collaboration participant membership and its mandatory Node edit binding are append-only for the collaboration lifetime. The collaboration Node policy is system-managed: generic Node permission mutation cannot add a grant, remove/downgrade/replace a participant binding, or change its default away from `no_access`; only the accepted mention-participant path may add a binding. Deleting the mention message has no permission effect.
P66 - A generic Node permission grant alone does not create email collaboration participation, a triage row, source-mailbox access, or shared-draft access. The existing dev-admin/company-admin bypass remains an administrative access rule but does not silently add the administrator to participant lists, mention notifications, or My Drafts.

## Scenarios

### Scenario P-S1: Permission Levels, Defaults, And Grants

Business logic covered:
- P1
- P2
- P3
- P4
- P5
- P6
- P7
- P8
- P9
- P10
- P24
- P26
- P28
- P29
- P40
- P41
- P45

Given:
- A company has resources with default access, user source rows, group source rows, and separate GVIC assignments.
- A dev admin, company admin, company manager, group member, and direct user grantee access the same resource.
- A user is added to a group after the group has already been assigned a resource permission.

Expected:
- Company access is checked before resource access.
- Every effective resource result is exactly edit or no access.
- Blank, `view`, `admin`, and `manage` inputs are rejected; they do not normalize into another resource permission.
- Default access, direct user rows, and group rows participate in effective permission access.
- GVIC assignments do not participate in effective permission access and cannot grant or elevate edit authorization.
- Dev admins and company admins bypass resource permissions.
- Company managers follow resource permissions.
- `resource_permissions` stores user/group source rows with explicit access levels.
- Group rows are not expanded to per-user rows; later group membership changes affect effective access.
- Group permission authorization resolves from source group/membership tables and remains correct after a schema reset even if derived group projections are empty.
- Direct user rows override group rows for that user.
- Updates with more than 1000 explicit assignments are rejected.

### Scenario P-S2: Denial Behavior And Permission Settings

Business logic covered:
- P11
- P12
- P13
- P14
- P15
- P16
- P20
- P25
- P27
- P39
- P54

Given:
- One user has no access to a resource.
- One regular user has edit access to the resource.
- One regular user lacks company manager/admin authority.
- One company manager has edit access to the resource.
- One company manager is also listed on the resource.

Expected:
- The no-access user receives a hidden/not-found style denial for read checks.
- The no-access user is denied every resource mutation; no read-only branch exists.
- The no-access user cannot soft-delete the resource.
- A user with edit access can soft-delete the resource to that user's own Recycle Bin.
- Invalid access level input returns bad request.
- Permission settings can be read only by managers/admins who can edit the resource.
- Permission settings can be updated by managers/admins with edit access to the resource.
- Responses include default access, explicit user/group permission rows, legacy override user IDs, effective access, can-edit-permissions, and can-edit-manager-permissions.
- Regular-user resource edit access does not allow loading or updating permission settings.
- A non-manager/non-admin opening the permissions tab sees a manager/admin permission message instead of a generic permissions failure.
- Company managers can change company user exceptions but cannot change other manager exceptions.
- When a manager flips the default, manager effective access is preserved and regular company user access follows the new default plus exceptions.

### Scenario P-S3: Visibility Filtering And Projection Refresh

Business logic covered:
- P17
- P18
- P19
- P21
- P22
- P23
- P38
- P62

Given:
- A viewer can access some nodes, logic gates, projects, Explorer rows, and Kanban boards, but not others.
- A viewer can access a Logic Gate board while a node card on that board is not directly viewable by that viewer.
- Some stored relationship or notification rows contain malformed resource IDs.
- A permission update changes access for a user or group.
- A permission update is applied to descendants from a parent folder.

Expected:
- Node, logic gate, project, and Explorer reads hide inaccessible resources.
- Map positions and relationship rows hide inaccessible related resources.
- Kanban board/card visibility follows the owning Logic Gate access.
- Opening a node from a Kanban card checks node-level access and shows "You do not have permission to see this." when the node itself is inaccessible.
- Malformed resource IDs are ignored or handled without crashing.
- Effective access is recomputed after permission changes.
- Canonical effective-access rows, affected projections, and read versions are current for the edited resource and descendants changed by an apply-to-descendants command.
- The initiating client patches concrete mounted state from the committed response when applicable; other clients reconcile on a later canonical read, with no generic permission or workspace browser event.
- If a later chat, board, or shared-mailbox event commits, publication rechecks current exact access and excludes the revoked subscriber without broadcasting a broad permission event.

### Scenario P-S4: Parent Template Permission Snapshots And Descendant Apply

Business logic covered:
- P30
- P31
- P32
- P33
- P34
- P35
- P36
- P37
- P42
- P43
- P46
- P47
- P48
- P49
- P50
- P51
- P52
- P53

Given:
- A folder has a default access value and user/group permission source rows.
- A Logic Gate has a default access value and user/group permission source rows.
- Existing child folders, projects, Logic Gates, and nodes have their own permission policies.

Expected:
- A new subfolder, project, or Logic Gate created or moved into the folder receives a snapshot of the folder's current policy.
- A node created, assigned, or moved into the Logic Gate receives a snapshot of the Logic Gate's current policy.
- Editing the parent after the copy does not mutate existing children unless apply-to-descendants is set.
- Editing the child after the copy affects only that child.
- Reordering or saving an item under the same parent does not re-copy the parent template.
- Moving to a different folder or Logic Gate replaces the child policy with the new parent's current template.
- Detaching from a parent or moving to a root/non-template location preserves the child's current policy.
- Project permission changes do not cascade into related Logic Gates or nodes.
- Applying a folder permission change to descendants updates descendant folders, contained projects, contained Logic Gates, and assigned nodes for that specific setting.
- Applying a Logic Gate permission change to descendants updates nodes currently assigned to that Logic Gate for that specific setting.
- A normal parent edit changes the parent and future direct children only; existing descendants are unchanged.
- A copied child policy may be represented by policy/rule pointers or immutable rule versions instead of duplicated permission rows.
- Apply-to-descendants records changed rule applications or tombstones for the subtree instead of materializing a full policy on every descendant.
- The apply operation overwrites descendant rules for the same changed keys, while unrelated child-specific rules remain unless the saved change removes or replaces them.
- Later descendant edits win over earlier ancestor applies until a newer ancestor apply is recorded.
- Group permission rules remain group pointers and are not expanded into one source row per user.
- Permission explanations identify whether access came from a direct rule, create/transfer inheritance, descendant apply, or group membership, and do not treat GVIC assignment as resource-permission access.

### Scenario P-S5: Explicit Permission Save And Close Autosave

Business logic covered:
- P44

Given:
- A manager/admin opens a dialog or embedded permission view from Company Explorer, a folder, node, Logic Gate, project, shared inbox, Shared Triage, or another entity entry point.
- The manager/admin changes a user or group permission.

Expected:
- An explicit Save button is always visible in both dialog and embedded variants and persists the current selection without closing the view.
- Save is disabled while the permission surface is loading, saving, or denied.
- Closing with X persists the pending permission change.
- A successful explicit save leaves the view open and displays saved state.
- Closing after a successful explicit Save does not issue the same permission write again.

### Scenario P-S6: Denied Permission Dialog Can Close

Business logic covered:
- P39
- P55

Given:
- A regular user opens a node, Logic Gate, or Explorer resource where the user cannot edit permission settings.
- The permissions dialog or tab displays the manager/admin permission message.

Expected:
- The X control closes the permissions dialog.
- Closing does not issue a permission save request.
- The user can return to the underlying resource or previous UI state.

### Scenario P-S7: Logic Gate Work Permission-Safe ETag

Business logic covered:
- P56
- P57
- P58
- P59
- P60
- P61

Given:
- Two users hold edit access to the same Logic Gate through different permission sources, and one later loses edit access.
- A direct rule, an inherited Explorer rule, and group membership are changed while one user holds an older work ETag.

Expected:
- Each response reports only `can_edit` for its authenticated actor.
- Access is recalculated before `If-None-Match` can return `304`.
- Direct and inherited policy changes bump the affected gate, while actor membership/hierarchy changes conservatively bump company gate versions.
- Actor permission identity/flags prevent cross-user validator reuse.
- Removing edit access returns denial and does not expose cached card data.
- GVIC assignment alone does not set `can_edit`.

### Scenario P-S8: Email Collaboration Participant Policy

Business logic covered:
- P4
- P26
- P40
- P63
- P64
- P65
- P66

Given:
- An email collaboration is created by one user and a chat mentions one user plus an overlapping user group.
- Group membership later changes, a mention message is deleted, and a manager attempts generic Node permission changes.

Expected:
- The collaboration Node starts at no access with one system-managed direct creator edit binding.
- Each distinct resolved mentioned user receives one system-managed direct edit binding and participant row in the chat transaction.
- The mention group is snapshotted to users rather than retained as a dynamic group permission pointer.
- Group changes and mention deletion do not change existing participants.
- Generic permission mutation cannot remove/downgrade participant bindings, change the default, or add a nonparticipant to email/thread/draft visibility.
- Existing company-admin/dev-admin bypass remains intact but does not itself create a participant, triage card, notification, or shared draft listing.
