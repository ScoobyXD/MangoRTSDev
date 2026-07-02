Last updated: 2026-07-02

# Explorer Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: partial backend coverage for V2 tree reads, placement/delete behavior, protected default folders, and folder permission template snapshots. Rule ID mapping is partial.

## Business Logic

E1 - Explorer V2 root and child reads require a company ID.
E2 - Explorer V2 supports the all scope and rejects old Me/Team scope behavior.
E3 - Root reads load the company root containers for the viewer.
E4 - Child reads require a parent ID that is either the company root or a valid Explorer folder resource ID.
E5 - Explorer reads return only resources where the viewer has effective view access or higher.
E6 - Explorer rows include effective access so the UI can decide available actions.
E7 - Explorer rows include has-children information for folder rows so the UI can lazy-load folder branches.
E8 - Explorer rows sort by position, then creation time, then name, then entity ID.
E9 - The final Company Explorer tree contains folders, subfolders, Logic Gates, and projects only; nodes are not Company Explorer rows.
E10 - Project rows are standalone leaf rows; project relationships do not render nested Explorer child rows.
E11 - Logic Gate rows are standalone leaf rows; node assignments do not render as nested Explorer child rows.
E12 - Creating an Explorer folder requires company, actor, permission user, parent entity, and nonblank folder name.
E13 - New root Explorer folders default to edit access unless a no-access default is explicitly requested; new subfolders copy the parent folder's current permission policy as a snapshot.
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
E26 - Unfiled has exactly two default child folders, in this order: Projects, Logic Gates.
E27 - Bare projects and Logic Gates created outside Company Explorer route to Unfiled/Projects and Unfiled/Logic Gates respectively.
E28 - Bare nodes created outside Company Explorer do not create a Company Explorer item, do not create a Nodes folder, and do not appear in the main Company Explorer tree.
E29 - The `company_explorer_items.target_type` constraint allows only `project` and `logic_gate`; migrations delete existing node item rows and the old default Nodes folder.
E30 - Creating, moving, dragging, batch-placing, or communications-converting a node into Company Explorer is rejected instead of hidden or rerouted.
E31 - Company Explorer search queries the whole company graph, not only branches that the lazy UI has already opened.
E32 - Company Explorer search still returns node matches from the source of truth rather than from `company_explorer_items`.
E33 - Node search results with Logic Gate assignments or project relationships are returned only when at least one of those organizational paths is visible to the viewer; standalone accessible nodes can still appear with no Explorer path.
E34 - Company Explorer search orders result types as Logic Gates, nodes, projects, then folders.
E35 - Company Explorer search results include resource_type, resource_id, display name, match reason, and Explorer location path.
E36 - Search result display renders the Explorer location path as nested Explorer rows with normal icons.
E37 - Node search result rows are open-only: they can be opened, but cannot be expanded, renamed, deleted, pinned, dragged, dropped, or used as creation targets.
E38 - The default Unfiled folder and its Projects and Logic Gates child folders cannot be renamed or deleted, but resources inside those folders can still be moved or deleted through normal resource actions.
E39 - While the Explorer search box contains text, the left sidebar hides non-Explorer sections and uses the remaining column for Explorer search results; clearing the search restores the normal sidebar.
E40 - Once a resource is visible anywhere in Company Explorer, no project relationship branch may create a second visible instance of that resource.
E41 - Company Explorer live refresh ignores node events and node relationship events; folder, project, and Logic Gate Explorer events still refresh affected loaded branches.
E42 - Node-map folder-scoped queries through Company Explorer return no nodes for non-root folders because nodes no longer have Company Explorer folder placement.
E43 - Placing or moving a project or Logic Gate into an Explorer folder copies that folder's current permission policy to the project or Logic Gate.
E44 - Reordering or re-saving a project or Logic Gate under the same Explorer folder preserves the resource's own permissions.
E45 - Moving a project or Logic Gate out of a folder to the company root preserves the resource's own permissions.
E46 - Editing an Explorer folder's permissions after placement does not fan out to existing subfolders, projects, or Logic Gates.
E47 - Dropping a My Triage or Shared Triage email onto a Company Explorer Logic Gate row uses the communications conversion path to create a Pending direct email-created node/card in that Logic Gate.
E48 - A successful Company Explorer email-to-Logic-Gate drop updates Home triage state from the conversion result; Home and the global communications live-freshness bridge must keep the source email row visible, patch the Logic Gate icon state, treat the matching `triage.converted` stream event as a local echo, and must not invalidate communications message page/detail caches, remove the row, reuse stale prefetched pages, trigger post-removal fill or message-length prefetch, blank the list, or issue repeated mail GETs. This Explorer drop path is regression-prone because one broad cache invalidation or row removal can reopen the Home refill loop.
E49 - A successful Company Explorer email-to-Logic-Gate drop shows a temporary green success banner over the Company Explorer sidebar section.
E50 - A successful Company Explorer email-to-Logic-Gate or eligible node drop sets source emails to unstarred through the source mailbox scope, returns `unstarred_message_ids`, and reconciles Home locally without pulling replacement rows into Inbox, All, Starred, My Triage, or Shared Triage.
E51 - Double-clicking a Company Explorer row label must not enter inline rename mode; renaming folders, projects, and Logic Gates requires an explicit rename action that is already authorized for the target.

## Bug History

BH1 - Reopening a previously opened folder could show the disclosure arrow changing from collapsed to expanded while rendering no child rows. The failure mode was a stale lazy-branch loaded marker surviving after the branch's V2 child rows were no longer materialized. The frontend must treat a loaded marker as insufficient when an expanded `has_children` folder has no visible materialized child rows, and must refetch that branch instead of trusting the stale marker.

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
- A company has Explorer folders, projects, Logic Gates, and source-of-truth nodes.
- The viewer has access to some resources but not others.

Expected:
- Root and child reads require company ID.
- Old Me/Team scopes are rejected.
- Root reads load company root containers.
- Child reads require the company root or a valid folder parent ID.
- Only viewable Explorer resources are returned.
- Rows include effective access and folder has-children state.
- Rows sort by position, creation time, name, and entity ID.
- The final Company Explorer tree shows folders, subfolders, projects, and Logic Gates only.
- Projects render as standalone leaf rows, even when project relationships exist.
- Logic Gates render as standalone leaf rows, even when node assignments exist.

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
- E29
- E30
- E43
- E44
- E45
- E46

Given:
- A user can edit one Explorer folder and only view another.
- A protected default folder exists.
- A target project and a target Logic Gate exist.
- A target node exists in source-of-truth node storage.

Expected:
- Creating a folder requires the required company, actor, permission user, parent, and name fields.
- Root folders default to edit access unless no-access is requested.
- Subfolders copy the parent folder's current permission policy at creation time.
- Folders can be created under the company root or another folder, but not under arbitrary non-folder resources.
- Rename requires edit access.
- Moving resolves the parent and target and changes placement without duplicating the target.
- Placing or moving a project or Logic Gate into a folder copies that folder's current permission policy to the resource.
- Reordering or re-saving a project or Logic Gate under the same folder preserves the resource's own permissions.
- Moving a project or Logic Gate to the company root preserves the resource's own permissions.
- Later folder permission edits do not mutate existing subfolders, projects, or Logic Gates.
- Deleting a placement edge does not delete the target resource.
- Protected/default folders cannot be renamed or deleted.
- Target deletion happens only through the explicit target deletion path.
- `company_explorer_items` accepts only project and Logic Gate target types.
- Any attempt to place a node into Company Explorer is rejected.

### Scenario E-S3: Explorer Refresh Events

Business logic covered:
- E22
- E23
- E24
- E41

Given:
- A user has several Explorer branches loaded.
- A folder, project, or Logic Gate placement, update, or removal event arrives for one parent entity.
- A node update or node relationship event also arrives.

Expected:
- Explorer events include the affected parent entity ID.
- Only loaded branches related to the affected parent refresh.
- Parent entity ID fallback is used when the event does not include richer branch context.
- Node and node relationship events do not cause Company Explorer branch refresh work.

### Scenario E-S4: Default Unfiled Placement

Business logic covered:
- E25
- E26
- E27
- E28
- E38

Given:
- A company has no user-created Explorer folders.
- A project, Logic Gate, or node is created outside Company Explorer without an explicit folder placement.
- Another project or Logic Gate is created explicitly at the Company Explorer root.

Expected:
- The root contains the default Unfiled folder.
- Unfiled contains Projects and Logic Gates in that order.
- Bare outside-created projects and Logic Gates appear in the matching Unfiled child folder.
- Bare outside-created nodes remain queryable source-of-truth nodes but do not appear in Company Explorer.
- Explicit root-created projects and Logic Gates stay at the Company Explorer root and do not also appear in Unfiled.
- Unfiled, Projects, and Logic Gates do not expose rename/delete actions and direct delete/rename attempts are rejected.

### Scenario E-S5: Whole-Company Search

Business logic covered:
- E31
- E32
- E33
- E34
- E35
- E36
- E37
- E39

Given:
- Matching Logic Gates, nodes, projects, and folders exist across folders and lazy branches that have not necessarily been opened.
- A matching node is assigned to a visible Logic Gate.
- A matching node is related to a visible project.
- A matching source-of-truth node has no visible Explorer path.
- Another matching resource exists under an Explorer folder the viewer cannot access.

Expected:
- Search returns matches from the whole company, not only loaded UI branches.
- Search returns node matches from source-of-truth node storage, not from Company Explorer item rows.
- Node result paths use visible Logic Gate assignment and project relationship context when available.
- A node whose only Logic Gate assignment or project relationship paths are hidden from the viewer is excluded, even when the viewer has direct access to the node.
- Standalone accessible node results can appear with an empty Explorer path.
- Search excludes matches whose Explorer placement or folder ancestry is not visible to the viewer.
- Logic Gates are listed before nodes, nodes before projects, and projects before folders.
- Each result includes resource_type, resource_id, display name, match reason, and Explorer location path.
- The UI renders the location path as nested Explorer rows and selecting a resource result opens that resource directly.
- Node result rows are open-only and do not expose Explorer mutation affordances.

### Scenario E-S6: Folder Drops And Source-Truth Relationships

Business logic covered:
- E10
- E11
- E17
- E18
- E29
- E30
- E40
- E42

Given:
- A node can appear under a Logic Gate through a source-of-truth Logic Gate assignment.
- A Logic Gate or node can also be related to a project through a source-of-truth project relationship.
- A user drags a project or Logic Gate into a normal Company Explorer folder.
- A user attempts to drag a node into a normal Company Explorer folder or onto a Logic Gate row.

Expected:
- Project and Logic Gate folder drops write Company Explorer placement edges.
- Logic Gate assignment edges are not reused as Company Explorer placement edges.
- Project relationship edges are not rendered as nested Project child rows or reused as Company Explorer placement edges.
- Dragging or placing nodes through Company Explorer is rejected.
- Nodes continue to be found by search through source-of-truth relationships.
- Folder-scoped node-map queries do not return nodes for non-root Company Explorer folders.

### Scenario E-S7: Email Drop Onto Explorer Logic Gate

Business logic covered:
- E47
- E48
- E49
- E50

Given:
- A user has a My Triage or mailbox-capable Shared Triage email selected.
- The user drags that email onto a Company Explorer Logic Gate row and chooses a priority.
- The active Home triage list is visible and has a cached message page/detail entry for that email.

Expected:
- The conversion request preserves the source mailbox scope, including `shared_inbox_id` for Shared Triage.
- The backend creates a Pending direct email-created node/card in the target Logic Gate.
- The backend sets the source email to unstarred through the personal or shared mailbox grant that supplied the drag payload and returns successfully updated IDs in `unstarred_message_ids`.
- The Home triage list keeps the converted row in local state and local message caches, and patches its Logic Gate icon state from the conversion result without clearing all communications message caches.
- The Home listener and app-level communications live-freshness bridge suppress the matching local `triage.converted` echo by message ID and `shared_inbox_id`.
- The local conversion and unstar path does not trigger immediate `/v1/communications/messages` list/detail refetches, stale prefetched-page top-up, post-removal fill, message-length prefetch, replacement Starred rows, or repeated workspace-panel reloads.
- The sidebar shows a short green success banner over the Company Explorer section and clears it automatically.

### Scenario E-S8: Explicit Rename Activation

Business logic covered:
- E51

Given:
- A user can see Company Explorer folders, projects, Logic Gates, and node search results.
- Some visible resources may be editable by that user.

Expected:
- Double-clicking a Company Explorer row label selects or opens the row according to normal navigation behavior.
- Double-clicking a Company Explorer row label does not replace the label with an inline text editor.
- The text caret does not appear inside the row title as a result of double-clicking.
- Renaming remains available only through the explicit rename command for resources that support rename and pass access checks.
