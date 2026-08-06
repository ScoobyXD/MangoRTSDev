# Process Story: Authorization resolves one live V2 permission policy

A user requests a Node, Logic Gate, relationship, Editor document, Explorer row, or Kanban item
↓
Company membership and the resource's inherited or customized V2 policy resolve Edit or No Access
↓
Direct-user, nearest live nested-group, and default rules are evaluated in that order
↓
Reads hide inaccessible data; mutations require Edit; GVIC never grants authority
↓
Moves, resets, group changes, and ETags resolve current state without descendant policy rewrites
↓
Save is explicit; closing a permission dialog always dismisses it and never traps the user behind a failed write

Last updated: 2026-08-05

# Permissions Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Explicit Save visibility is covered by `tests/frontend/modules/editor/emailViewerContract.test.ts`; X/Escape dismissal without save or duplicate retry is covered by `tests/frontend/modules/permissions/entityPermissionsDialogContract.test.ts`.
- Business Logic Covered By Automated Tests: backend, HTTP, frontend contract, disposable PostgreSQL, scale, and regression coverage for V2 defaults, complete policies, inheritance, force resets, moves, detach, live groups, authorization, and ETags. Rule ID mapping remains partial.

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
P16 - Permission responses include stored/effective mode, stored/effective default and user/group rules, source resource, reset/overwrite explanation, effective access, and permission-management capabilities.
P17 - Visible node, logic gate, project, and Explorer reads are filtered by effective edit access.
P18 - Relationship rows are filtered by the viewer's access to the related resources.
P19 - Kanban board and card access derives from the access level of the owning logic gate.
P20 - Regular users cannot load or update permission settings even when they have resource edit access; company manager/admin authority is a separate settings-management gate.
P21 - Malformed or unknown resource IDs do not crash visibility checks.
P22 - Effective access is resolved from canonical settings, rules, live hierarchy, and live nested groups at read time; no derived effective-access table is policy authority.
P23 - Permission writes update one complete policy or one descendant-reset sequence and relevant read versions atomically. They never rewrite every descendant or publish a generic permission/workspace event.
P24 - Company managers do not bypass resource permissions.
P25 - Company managers can update permission exceptions for company users only; dev admins and company admins can update manager and user exceptions.
P26 - Default access has only two states, edit and no access; `resource_permissions` stores explicit user/group source rows with their own access level.
P27 - When a company manager changes a resource default, manager effective access is preserved while regular company users follow the new default and exceptions.
P28 - Step 1 copied reconciled legacy policy into V2 staging. Step 2 uses canonical V2 tables only and retains renamed legacy policy tables only as frozen rollback evidence for Step 3.
P29 - Runtime permission readers and writers use only `resource_permission_settings` and canonical `resource_permissions`; no legacy, fallback, dual-write, request-repair, or derived-authority path is active.
P30 - A non-root resource starts inherited and stores no direct rule rows unless a creation workflow explicitly customizes it. A root is customized with a complete valid policy.
P31 - An inherited resource live-resolves the nearest active customized policy in its immediate parent chain.
P32 - Customizing copies the current effective policy once, applies one complete replacement, and allocates a new customized sequence in the same transaction.
P33 - Returning to inherited deletes direct rule rows and the customized sequence, then immediately exposes the current effective ancestor policy.
P34 - Editing a parent changes only that parent. Existing inherited descendants see it live; customized descendants keep their active complete policies.
P35 - A same-parent reorder leaves the parent-link sequence and current policy unchanged. A real move allocates a new parent-link sequence for permissions and GVIC.
P36 - Moving an inherited resource changes its effective parent immediately; moving a customized resource preserves its policy. Detaching an inherited Node materializes its current effective permission policy as customized.
P37 - Company Explorer folders parent contained folders, projects, and Logic Gates; Logic Gates parent assigned Nodes; Shared Triage folders parent folders and shared inboxes. Project relationships do not create policy parentage.
P38 - Kanban board/card visibility follows the owning Logic Gate access, but opening a Kanban node detail/editor must perform a fresh node-level access check.
P39 - Permission settings denial copy explains that only managers and admins with resource edit access can manage permissions.
P40 - Group permission rows are pointers to the group or subgroup; adding a user to that group later makes the user's effective permission follow the group row without writing per-user rows.
P41 - A direct user rule overrides groups. The nearest matching group wins; at equal depth No Access beats Edit, then stable group identity breaks ties. Default applies only when no direct or group rule matches.
P42 - Apply to inherited descendants saves the selected policy if needed and writes no descendant policy state. Inherited branches already resolve it live, and active customized boundaries remain protected.
P43 - Overwrite all descendants uses one reset sequence that also supersedes older customized descendants. A later descendant customization becomes active again.
P44 - Every permissions dialog and embedded permissions view, including Company Explorer folders, nodes, Logic Gates, projects, shared inboxes, and Shared Triage entry points, exposes an explicit `Save` button in a stable action area. Save commits the current default, user/group, and descendant selections without closing. The X, Escape, and modal-dismiss actions close without saving, remain available after a failed write, and never issue a duplicate write.
P45 - Runtime authorization resolves group permission rows from group source tables and group membership source rows; permission checks must not require a derived group closure/projection table to be populated.
P46 - Ordinary policy writes do not walk descendants. Force-overwrite work stays constant-size as the subtree grows.
P47 - Settings contain inherited/customized mode, customized sequence, parent-link sequence, and descendant-reset sequence; direct rows exist only for a customized complete policy.
P48 - A parent link newer than a reset blocks that older reset from retroactively crossing a moved subtree. A later reset from the new ancestry may cross it.
P49 - Separate monotonic sequence domains are used for GVIC and permissions; wall-clock timestamps never decide policy precedence.
P50 - A reset can make a stored customization inactive without deleting it. Reads explain both the effective source and the overwritten stored source.
P51 - The frontend has distinct Inherited/Customized controls, Apply to inherited descendants, and separately confirmed Overwrite all descendants controls.
P52 - Permission audit/explainability identifies direct/default/group resolution, the effective customized source, eligible reset, parent-link boundary, and overwritten customization; it never reports GVIC as an authorization grant.
P53 - Permission fingerprints include effective source and sequence, eligible reset, parent-link boundary, group-membership version, actor identity, and actor-specific Edit result where exposed.
P54 - Soft delete for nodes and Company Explorer delete targets requires edit access to the deleted resource or container; no access and GVIC assignments never authorize the delete.
P55 - If a user is denied permission-settings visibility, the permissions dialog remains dismissible with the X control and must not attempt to autosave a panel that never loaded editable permission data.
P56 - Logic Gate work reads return the single actor-specific `can_edit` resource flag while preserving default, direct-user, group, ancestor-application, and company-role authorization semantics.
P57 - Logic Gate work authorization is evaluated before conditional ETag handling; losing edit access cannot produce a cached `304` or preserve readable board data.
P58 - Direct or inherited source changes, eligible resets, parent moves, and group-version changes alter the policy fingerprint without descendant version fanout.
P59 - Company role, group membership, and group hierarchy changes that can alter actor permission flags update the shared group-membership version.
P60 - Authorization is evaluated before conditional ETag handling, and the actor-specific permission result is part of the ETag so revoked or differently authorized users cannot share an unsafe validator.
P61 - GVIC Generated/request-owner data may appear in the Logic Gate header, but GVIC assignments do not set `can_edit`.
P62 - Permission mutations still publish no generic permission/workspace event. Instead, before a later Node-chat, mounted-board, or shared-mailbox hint reaches an already-subscribed socket, that narrow publisher resolves the exact current audience and fails closed on lookup errors. A user revoked after subscribing receives no later resource identifiers/hints without needing a reconnect.
P63 - A newly created email Node first resolves and copies the effective policy from its final parent/source, then becomes customized with one system-managed direct Edit binding for its creator and direct Generated GVIC. Generic permission replacement cannot widen or remove collaboration participant grants.
P64 - A committed direct user mention or resolved user-group mention snapshots each distinct same-company user as a collaboration participant and adds one system-managed direct edit binding for that user in the same durable transaction. These are user bindings, not live group pointers, so later group changes neither grant nor revoke collaboration access.
P65 - Collaboration participant membership and its mandatory Node edit binding are append-only for the collaboration lifetime. The collaboration Node policy is system-managed: generic Node permission mutation cannot add a grant, remove/downgrade/replace a participant binding, or change its default away from `no_access`; only the accepted mention-participant path may add a binding. Deleting the mention message has no permission effect.
P66 - A generic Node permission grant alone does not create email collaboration participation, a triage row, source-mailbox access, or shared-draft access. The existing dev-admin/company-admin bypass remains an administrative access rule but does not silently add the administrator to participant lists, mention notifications, or My Drafts.
P67 - Chat mutation authorization is the intersection of normal entity Edit permission and exact stored comment authorship. An administrator, manager, collaborator, or other editor may read and reply according to existing access but may not edit or delete another user's comment. Missing or mismatched stored `author_id` fails closed, and legacy POST upsert paths cannot bypass the author-only PATCH boundary.

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
- Responses include stored/effective mode, stored/effective default and rules, source/reset/overwrite explanation, effective access, and permission-management capabilities.
- Regular-user resource edit access does not allow loading or updating permission settings.
- A non-manager/non-admin opening the permissions tab sees a manager/admin permission message instead of a generic permissions failure.
- Company managers can change company user exceptions but cannot change other manager exceptions.
- When a manager flips the default, manager effective access is preserved and regular company user access follows the new default plus exceptions.

### Scenario P-S3: Visibility Filtering And Live V2 Resolution

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
- Relationship rows hide inaccessible related resources.
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
- A new non-root subfolder, project, Logic Gate, or assigned Node starts inherited and stores no copied permission rows.
- Inherited resources resolve the nearest active customized policy in their current parent chain.
- Editing the parent changes inherited branches live and stops at active customized boundaries.
- Customizing a child copies its current effective policy once and then applies one complete replacement.
- Reordering under the same parent leaves its parent-link sequence and policy unchanged.
- Moving to a different folder or Logic Gate advances the parent-link sequence; inherited policy follows the new parent and customized policy is preserved.
- Detaching an inherited Node materializes its current effective policy as customized in the same transaction.
- Project permission changes do not cascade into related Logic Gates or nodes.
- Inherited-only Apply adds no descendant state because inherited branches already resolve live.
- Overwrite-all changes one reset sequence and can make eligible older customized policies inactive without deleting their dormant rows.
- A later descendant customization becomes active again; an ordinary later parent save cannot cross it.
- A subtree moved after a reset is protected by its newer parent-link sequence until a later reset from its new ancestry.
- Point authorization reads only the canonical settings/rules, hierarchy, and current nested groups.
- Write count is constant with descendant count, including an intentionally empty customized rule set.
- Permission explanations identify source, direct/default/group result, reset, parent-link boundary, and inactive stored customization.
- Group permission rules remain group pointers and are not expanded into one source row per user.
- GVIC assignments never satisfy permission authorization.

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

### Scenario P-S9: Comment Authorship Is A Mutation Boundary

Business logic covered:
- P67

Given:
- An author, a different entity editor, and an administrator can read the same chat comment.

When:
- Each actor attempts to edit or delete that exact comment.

Expected:
- Only the stored author may mutate it, and the author must still have normal entity Edit access.
- A missing or mismatched `author_id` fails closed.
- Legacy create/upsert routes cannot replace an existing chat projection.
- These checks do not alter read, reply, mention-participant, or administrator visibility rules.

Focused backend coverage lives in `backend/internal/http/chat_comment_edit_test.go`.
