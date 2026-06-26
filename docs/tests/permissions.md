Last updated: 2026-06-26

# Permissions Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: 0% (rule IDs are not mapped to automated tests yet)

## Business Logic

P1 - Resource permission checks require company access before resource-level access is evaluated.
P2 - Permission levels rank no access, view, edit, then admin.
P3 - Blank permission input normalizes to view.
P4 - The manage permission alias normalizes to admin.
P5 - Default access participates in effective access calculation.
P6 - Resource access grants support user and group principals.
P7 - A resource can have at most 1000 explicit permission assignments in one update.
P8 - Dev admins and company admins receive admin-level effective access for company-managed resources.
P9 - GVIC generated and verified roles contribute edit-level access.
P10 - GVIC consulted and informed roles contribute view-level access.
P11 - If a user cannot view a resource, read-style access checks hide the resource instead of exposing it.
P12 - If a user can view a resource but lacks the required edit/admin level, mutation checks return an access denied error.
P13 - Invalid requested access levels return a bad request error.
P14 - Reading entity permission settings requires manager/admin authority and view access to the entity.
P15 - Updating entity permission settings requires dev admin, company admin, or company manager authority with edit access to the entity.
P16 - Permission setting responses include default access, explicit grants, override user IDs, effective access, can-edit-permissions, and can-edit-manager-permissions.
P17 - Visible node, logic gate, project, Explorer, and Kanban reads are filtered by effective view access.
P18 - Map positions and relationship rows are filtered by the viewer's access to the related resources.
P19 - Kanban board and card access derives from the access level of the owning logic gate.
P20 - Regular users cannot load or update permission settings, even when they have resource edit/admin access.
P21 - Malformed or unknown resource IDs do not crash visibility checks.
P22 - Permission changes recompute effective access for affected users and resources.
P23 - Permission changes publish or append the refresh data needed for affected projections and clients.
P24 - Company managers do not bypass resource permissions.
P25 - Company managers can update permission exceptions for company users only; dev admins and company admins can update manager and user exceptions.
P26 - Default access has only two states, edit and no access; `resource_permissions` stores only exception rows to that default.
P27 - When a company manager changes a resource default, manager effective access is preserved while regular company users follow the new default and exceptions.
P28 - Legacy `resource_access_grants` rows are migrated into `resource_permissions` exception rows before the legacy table is dropped.
P29 - Runtime permission reads and writes use `resource_permissions` only; `resource_access_grants` and `entity_access_permissions` are not active permission sources.

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

Given:
- A company has resources with default access, user grants, group grants, and GVIC assignments.
- A dev admin, company admin, company manager, group member, and direct user grantee access the same resource.

Expected:
- Company access is checked before resource access.
- Permission ranking follows no access, view, edit, admin.
- Blank input becomes view and manage becomes admin.
- Default access, direct user grants, group grants, and GVIC-derived access all participate in effective access.
- Dev admins and company admins bypass resource permissions.
- Company managers follow resource permissions.
- `resource_permissions` stores only exception rows to the resource default.
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

Given:
- One user cannot view a resource.
- One user can view but not edit the resource.
- One regular user has resource admin access.
- One company manager has edit access to the resource.
- One company manager is also listed on the resource.

Expected:
- The no-view user receives a hidden/not-found style denial for read checks.
- The view-only user receives access denied for edit/admin mutations.
- Invalid access level input returns bad request.
- Permission settings can be read only by managers/admins who can view the resource.
- Permission settings can be updated by managers/admins with edit access to the resource.
- Responses include default access, explicit grants, override user IDs, effective access, can-edit-permissions, and can-edit-manager-permissions.
- Regular resource admin access does not allow loading or updating permission settings.
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

Given:
- A viewer can access some nodes, logic gates, projects, Explorer rows, and Kanban boards, but not others.
- Some stored relationship or notification rows contain malformed resource IDs.
- A permission update changes access for a user or group.

Expected:
- Node, logic gate, project, Explorer, and Kanban reads hide inaccessible resources.
- Map positions and relationship rows hide inaccessible related resources.
- Kanban access follows the owning logic gate access.
- Malformed resource IDs are ignored or handled without crashing.
- Effective access is recomputed after permission changes.
- Affected projections and clients receive refresh data.
