Last updated: 2026-06-20

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
P8 - Company managers and dev admins receive admin-level effective access for company-managed resources.
P9 - GVIC generated and verified roles contribute edit-level access.
P10 - GVIC consulted and informed roles contribute view-level access.
P11 - If a user cannot view a resource, read-style access checks hide the resource instead of exposing it.
P12 - If a user can view a resource but lacks the required edit/admin level, mutation checks return an access denied error.
P13 - Invalid requested access levels return a bad request error.
P14 - Reading entity permission settings requires view access to the entity.
P15 - Updating entity permission settings requires permission-management access for that entity.
P16 - Permission setting responses include default access, explicit grants, override user IDs, effective access, and can-edit-permissions.
P17 - Visible node, logic gate, project, Explorer, and Kanban reads are filtered by effective view access.
P18 - Map positions and relationship rows are filtered by the viewer's access to the related resources.
P19 - Kanban board and card access derives from the access level of the owning logic gate.
P20 - A user with resource admin access can manage that resource's access settings even if they are not a company admin.
P21 - Malformed or unknown resource IDs do not crash visibility checks.
P22 - Permission changes recompute effective access for affected users and resources.
P23 - Permission changes publish or append the refresh data needed for affected projections and clients.

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

Given:
- A company has resources with default access, user grants, group grants, and GVIC assignments.
- A company admin, a group member, and a direct user grantee access the same resource.

Expected:
- Company access is checked before resource access.
- Permission ranking follows no access, view, edit, admin.
- Blank input becomes view and manage becomes admin.
- Default access, direct user grants, group grants, company manager status, and GVIC-derived access all participate in effective access.
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

Given:
- One user cannot view a resource.
- One user can view but not edit the resource.
- One user has resource admin access.

Expected:
- The no-view user receives a hidden/not-found style denial for read checks.
- The view-only user receives access denied for edit/admin mutations.
- Invalid access level input returns bad request.
- Permission settings can be read with view access.
- Permission settings can be updated by a user with permission-management access.
- Responses include default access, explicit grants, override user IDs, effective access, and can-edit-permissions.
- Resource admin access allows managing that resource's permissions without company admin status.

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
