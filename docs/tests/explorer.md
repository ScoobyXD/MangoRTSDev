Last updated: 2026-06-24

# Explorer Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: 0% (rule IDs are not mapped to automated tests yet)

## Business Logic

E1 - Explorer V2 root and child reads require a company ID.
E2 - Explorer V2 supports the all scope and rejects old Me/Team scope behavior.
E3 - Root reads load the company root containers for the viewer.
E4 - Child reads require a parent ID that is either the company root or a valid Explorer resource ID.
E5 - Explorer reads return only resources where the viewer has effective view access or higher.
E6 - Explorer rows include effective access so the UI can decide available actions.
E7 - Explorer rows include has-children information so the UI can lazy-load branches.
E8 - Explorer rows sort by position, then creation time, then name, then entity ID.
E9 - The final Explorer tree is a single-placement tree: each folder, project, logic gate, and node resource has at most one visible Explorer row.
E10 - Project rows are standalone leaf rows; project relationships do not render nested Explorer child rows.
E11 - Logic gate children are derived from node assignments.
E12 - Creating an Explorer folder requires company, actor, permission user, parent entity, and nonblank folder name.
E13 - New Explorer folders default to edit access unless a no-access default is explicitly requested.
E14 - Explorer folders can be created only under the company root or another folder.
E15 - Creating a folder under a non-folder resource is rejected.
E16 - Renaming an Explorer folder requires edit access to that folder.
E17 - Moving or placing an Explorer item requires resolving both the parent container and the target entity.
E18 - Moving an Explorer item changes its parent and position without duplicating the target resource.
E19 - Deleting an Explorer edge removes that placement without deleting the underlying target resource.
E20 - Protected or system Explorer folders cannot be renamed or deleted.
E21 - Explorer target deletion removes the underlying target only through the explicit target deletion path, not by deleting a placement edge.
E22 - Explorer placement, update, and removal events publish the affected parent entity ID.
E23 - The frontend refreshes loaded branch identities after Explorer events instead of reloading unrelated branches.
E24 - When refresh context is incomplete, parent entity ID fallback is used to decide which loaded branch should refresh.
E25 - Every company has one default root folder named Unfiled.
E26 - Unfiled has exactly three default child folders, in this order: Projects, Logic Gates, Nodes.
E27 - Bare projects, logic gates, and nodes created outside Company Explorer route to Unfiled/Projects, Unfiled/Logic Gates, and Unfiled/Nodes respectively.
E28 - Resources explicitly created at the Company Explorer root remain at the root and are not routed into Unfiled.
E29 - Company Explorer search queries the whole company graph, not only branches that the lazy UI has already opened.
E30 - Company Explorer search orders result types as logic gates, nodes, projects, then folders.
E31 - Company Explorer search results include resource_type, resource_id, display name, match reason, and Explorer location path.
E32 - Search result display renders the Explorer location path as nested Explorer rows with normal icons, and selecting a resource result opens that resource without switching node results to the map background.
E33 - The default Unfiled folder and its Projects, Logic Gates, and Nodes child folders cannot be renamed or deleted, but resources inside those folders can still be moved or deleted through normal resource actions.
E34 - While the Explorer search box contains text, the left sidebar hides non-Explorer sections and uses the remaining column for Explorer search results; clearing the search restores the normal sidebar.
E35 - Dropping a node into an Explorer folder must create or move a Company Explorer folder placement and must not treat a logic-gate assignment or project relationship edge as an Explorer folder-item edge.
E36 - Once a resource is visible anywhere in Company Explorer, no project relationship branch may create a second visible instance of that resource.
E37 - Company Explorer search returns only resources reachable through visible Explorer paths; a resource inside a hidden Explorer folder must not appear in search even if the underlying resource has direct view access.
E38 - Dropping a node onto a logic gate in Company Explorer assigns or reassigns the node to that logic gate and does not call the logic-gate work state-change endpoint.
E39 - Logic-gate work state-change endpoints are reserved for work-state moves such as My Work or GVIC cell moves where status, column, priority, issue state, or position is intentionally changed.

## Scenarios

### Scenario E-S1: Roots, Children, Sorting, And Visibility

Business logic covered:
- E1
- E2
- E3
- E4
- E5
- E6
- E7
- E8
- E9
- E10
- E11

Given:
- A company has Explorer folders, projects, logic gates, and nodes.
- The viewer has access to some resources but not others.

Expected:
- Root and child reads require company ID.
- Old Me/Team scopes are rejected.
- Root reads load company root containers.
- Child reads require the company root or a valid resource parent ID.
- Only viewable resources are returned.
- Rows include effective access and has-children.
- Rows sort by position, creation time, name, and entity ID.
- The final Explorer tree shows one visible placement for each folder, project, logic gate, and node resource.
- Projects render as standalone leaf rows, even when project relationships exist.
- Logic gate children are derived from node assignments.

### Scenario E-S2: Folder And Placement Mutations

Business logic covered:
- E12
- E13
- E14
- E15
- E16
- E17
- E18
- E19
- E20
- E21

Given:
- A user can edit one Explorer folder and only view another.
- A protected system folder exists.
- A target node exists in one parent and is moved to another parent.

Expected:
- Creating a folder requires the required company, actor, permission user, parent, and name fields.
- New folders default to edit access unless no-access is requested.
- Folders can be created under the company root or another folder, but not under arbitrary non-folder resources.
- Rename requires edit access.
- Moving resolves the parent and target and changes placement without duplicating the target.
- Deleting a placement edge does not delete the target resource.
- Protected/system folders cannot be renamed or deleted.
- Target deletion happens only through the explicit target deletion path.

### Scenario E-S3: Explorer Refresh Events

Business logic covered:
- E22
- E23
- E24

Given:
- A user has several Explorer branches loaded.
- A folder placement, update, or removal event arrives for one parent entity.

Expected:
- Events include the affected parent entity ID.
- Only loaded branches related to the affected parent refresh.
- Parent entity ID fallback is used when the event does not include richer branch context.
### Scenario E-S4: Default Unfiled Placement

Business logic covered:
- E25
- E26
- E27
- E28
- E33

Given:
- A company has no user-created Explorer folders.
- A project, logic gate, or node is created outside Company Explorer without an explicit folder placement.
- Another resource is created explicitly at the Company Explorer root.

Expected:
- The root contains the default Unfiled folder.
- Unfiled contains Projects, Logic Gates, and Nodes in that order.
- Bare outside-created resources appear in the matching Unfiled child folder.
- Explicit root-created resources stay at the Company Explorer root and do not also appear in Unfiled.
- Unfiled, Projects, Logic Gates, and Nodes do not expose rename/delete actions and direct delete/rename attempts are rejected.

### Scenario E-S5: Whole-Company Search

Business logic covered:
- E29
- E30
- E31
- E32
- E34
- E37

Given:
- Matching logic gates, nodes, projects, and folders exist across folders and lazy branches that have not necessarily been opened.
- Another matching resource exists under an Explorer folder the viewer cannot access.

Expected:
- Search returns matches from the whole company, not only loaded UI branches.
- Search excludes matches whose Explorer placement or folder ancestry is not visible to the viewer.
- Logic gates are listed before nodes, nodes before projects, and projects before folders.
- Each result includes resource_type, resource_id, display name, match reason, and Explorer location path.
- The UI renders the location path as nested Explorer rows and selecting a resource result opens the resource directly without switching node results to the map background.
### Scenario E-S6: Folder Drops Preserve Edge Semantics

Business logic covered:
- E17
- E18
- E35
- E36
- E38
- E39

Given:
- A node can appear under a logic gate through a logic-gate assignment edge.
- A logic gate or node can also be related to a project through a project relationship edge.
- A user drags that node into a normal Company Explorer folder.
- A user drags a normal Explorer folder-placement node onto a logic gate row.

Expected:
- The folder drop writes a Company Explorer folder placement for the node.
- The logic-gate assignment edge is not reused as a Company Explorer placement edge.
- The project relationship edge is not rendered as a nested Project child or reused as a Company Explorer placement edge.
- The drop does not fail with access_denied because of an edge-type mismatch.
- The logic-gate drop writes a logic-gate assignment or reassignment without requiring work-state fields.
- My Work or GVIC cell moves remain the place where logic-gate work state changes are sent.
