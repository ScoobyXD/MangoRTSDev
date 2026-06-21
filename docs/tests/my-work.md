Last updated: 2026-06-20

# My Work Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: 0% (rule IDs are not mapped to automated tests yet)

## Definitions:
Active Work: Nodes and Projects that are not in "Done" status. 
            if there is a node that is "Done" but inside of a logic gate or a project that is not in "Done" status, then the node is still active because its "parent", the project is still going. Logic gates by themselves do not have these statuses. 

## Business Logic

MW1 - My Work shows active work derived from effective GVIC assignments, not the Updates notification feed.
MW2 - My Work includes the generated, verified, consulted, and informed GVIC roles.
MW3 - The Me scope targets the current user.
MW4 - The Team scope targets users in the selected user group, including descendant group members.
MW5 - The All scope targets all users in the company.
MW6 - Target user IDs are deduped before loading My Work data.
MW7 - Each target user loads independently so one failed target does not blank successful target results.
MW8 - If all target loads fail, My Work shows a full failure state.
MW9 - If some target loads fail, My Work preserves successful results and shows a scoped partial-failure warning.
MW10 - My Work cache keys include company, surface scope, and target user IDs.
MW11 - Realtime My Work subscriptions are scoped per target user and reload only targets affected by the GVIC matrix event.
MW12 - My Work matrix cells group work by GVIC role and priority bucket.
MW13 - Role buckets sort generated, verified, consulted, then informed.
MW14 - Priority buckets sort 1, 2, 3, 4, 5, then no priority.
MW15 - Active project rows are included in My Work, while done, complete, completed, closed, and archived projects are excluded.
MW16 - 
MW17 - Nodes and logic gates nest under their project and logic gate context when that context exists.
MW18 - Logic gates and nodes without project context can appear as root-level work rows.
MW19 - Resources the viewer cannot view are filtered out of My Work.
MW20 - My Work grouping supports account, due date, person, project, status, and team fields.
MW21 - The default My Work grouping is project ascending.
MW22 - Saved grouping settings are scoped by company and current user.
MW23 - Malformed or duplicate saved grouping settings are normalized before use.
MW24 - Opening a My Work row routes to the corresponding project, logic gate, or node surface.
MW25 - Expanding/collapsing grouping rows is separate from opening the work item.
MW26 - Drag/drop or empty-cell creation from My Work carries the selected priority and creator GVIC role into the created work item.
MW27- A person/group can only have one GVIC assignment per node or logic gate.
MW28 - My Work is node-leaf driven only.
MW29 - Projects and logic gates are display containers only.
MW30 - A node leaf determines gvic_assignment and priority
MW31 - If a node is assigned to a logic gate, the node defers to the logic gate’s GVIC assignment.
MW32 - The projection table should store the relationship path needed to render My Work directly.
MW33 - Frontend should not recursively derive this or lazy-fetch branches for My Work.


## Scenarios

### Scenario MW-S1: Scope Loading And Partial Failure

Business logic covered:
- MW1
- MW2
- MW3
- MW4
- MW5
- MW6
- MW7
- MW8
- MW9
- MW10
- MW11

Given:
- A company has users, nested user groups, and active GVIC assignments.
- One target user's My Work request succeeds and another target user's request fails.
- Realtime GVIC matrix events arrive for one target user.

Expected:
- My Work includes generated, verified, consulted, and informed assignments and does not show notification-feed-only Updates.
- Me, Team, and All scopes resolve the correct target users.
- Duplicate target user IDs are loaded once.
- Successful target results remain visible when another target fails.
- A full failure state appears only when every target fails.
- Cache keys separate company, selected scope, and target users.
- Realtime reloads only targets affected by the event.

### Scenario MW-S2: Matrix Tree, Roles, Priority, And Visibility

Business logic covered:
- MW12
- MW13
- MW14
- MW15
- MW16
- MW17
- MW18
- MW19

Given:
- A user has GVIC assignments on projects, logic gates, and nodes.
- Some projects are active and some are closed/archived/done.
- Some assigned resources are not viewable by the current viewer.

Expected:
- Cells are grouped by role and priority.
- Roles sort generated, verified, consulted, informed.
- Priorities sort 1 through 5, then no priority.
- Closed, archived, done, complete, and completed projects are excluded.
- Direct project assignments appear even without child rows.
- Logic gates and nodes nest under project/gate context where available.
- Resources without project context can appear as root rows.
- Hidden resources do not appear.

### Scenario MW-S3: Grouping, Open Behavior, And Creation

Business logic covered:
- MW20
- MW21
- MW22
- MW23
- MW24
- MW25
- MW26

Given:
- A user changes My Work grouping settings.
- Saved local grouping settings include duplicates or malformed fields.
- The user opens work rows and creates work from a priority/role cell.

Expected:
- Supported grouping fields are account, due date, person, project, status, and team.
- The default grouping is project ascending.
- Saved grouping settings are isolated by company and user.
- Malformed or duplicate settings are normalized.
- Opening a row navigates to the correct project, logic gate, or node.
- Expanding a group does not accidentally open the work item.
- Created work receives the selected priority and creator GVIC role.
