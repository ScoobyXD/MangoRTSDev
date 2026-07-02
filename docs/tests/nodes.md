Last updated: 2026-07-02

# Nodes Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Node soft-delete edit gating and recycle-bin owner stamping have backend coverage; GVIC picker rule IDs are not mapped to automated tests yet.

## Business Logic

N1 - Nodes support generated, verified, consulted, and informed GVIC assignments.
N2 - Node generated and verified GVIC assignments are single-user slots.
N3 - Node generated and verified GVIC assignments must use a user principal, not a group principal.
N4 - Replacing the generated or verified user on a node removes the previous user for that role.
N5 - Node consulted and informed GVIC assignments may include users and user groups.
N6 - Node GVIC assignment pickers should display the company user-group tree as a collapsed hierarchy.
N7 - Node GVIC picker subgroups and users should be visually indented according to their hierarchy depth.
N8 - A generated or verified node assignment chip should show the assigned user's name and provide a direct remove action.
N9 - DELETE `/v1/nodes/{node_id}` is a soft delete that moves the node and related placements/projections to the deleting actor's Recycle Bin.
N10 - Node soft delete requires edit access to the node; resource admin access is not required, and view-only access is not enough.
N11 - Successful node soft delete stamps `deleted_by_user_id` with the deleting actor.

## Scenarios

### Scenario N-S1: Generated And Verified Single User Slots

Business logic covered:
- N1
- N2
- N3
- N4
- N8

Given:
- A node has editable GVIC fields.
- A company user is assigned to the node's generated or verified field.
- A second user is later selected for the same generated or verified field.

Expected:
- The generated or verified field accepts exactly one user.
- Group principals are not selectable or accepted for generated or verified.
- Selecting the second user replaces the first user for that role.
- The assigned chip displays the user's name.
- The assigned chip exposes a direct remove action instead of an assignment-list dropdown.

### Scenario N-S2: Consulted And Informed Users And Teams

Business logic covered:
- N1
- N5

Given:
- A node has consulted and informed GVIC fields.
- A company has users, user groups, and nested user groups.

Expected:
- Consulted and informed can include individual users.
- Consulted and informed can include user groups.
- Consulted and informed can hold multiple assignments.

### Scenario N-S3: Node GVIC Organization Tree Picker

Business logic covered:
- N6
- N7

Given:
- A company has top-level user groups, subgroups, and users inside those groups.
- A user opens a node GVIC assignment picker.

Expected:
- The picker opens with groups collapsed by default.
- Expanding a group reveals its subgroups and users.
- Top-level groups, subgroups, and users are indented by hierarchy depth so the organization structure is visible.
- Searching may reveal matching branches, but the row indentation still reflects the underlying hierarchy.

### Scenario N-S4: Node Soft Delete Permissions

Business logic covered:
- N9
- N10
- N11

Given:
- One user has view access to a node.
- Another user has edit access to the same node.

Expected:
- The view-only user's DELETE request is rejected.
- The edit user's DELETE request succeeds.
- The deleted node appears in the edit user's Recycle Bin with `deleted_by_user_id` set to that user.
