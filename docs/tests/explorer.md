Last updated: 2026-06-23

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
E9 - The final Explorer tree includes folders plus derived project, logic gate, and node children.
E10 - Project children are derived from project relationships.
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
- Project and logic gate/node children are derived from their relationship sources.

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

Given:
- A company has no user-created Explorer folders.
- A project, logic gate, or node is created outside Company Explorer without an explicit folder placement.
- Another resource is created explicitly at the Company Explorer root.

Expected:
- The root contains the default Unfiled folder.
- Unfiled contains Projects, Logic Gates, and Nodes in that order.
- Bare outside-created resources appear in the matching Unfiled child folder.
- Explicit root-created resources stay at the Company Explorer root and do not also appear in Unfiled.

### Scenario E-S5: Whole-Company Search

Business logic covered:
- E29
- E30
- E31
- E32

Given:
- Matching logic gates, nodes, projects, and folders exist across folders and lazy branches that have not necessarily been opened.

Expected:
- Search returns matches from the whole company, not only loaded UI branches.
- Logic gates are listed before nodes, nodes before projects, and projects before folders.
- Each result includes resource_type, resource_id, display name, match reason, and Explorer location path.
- The UI renders the location path as nested Explorer rows and selecting a resource result opens the resource directly without switching node results to the map background.
