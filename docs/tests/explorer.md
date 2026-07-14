Last updated: 2026-07-13

# Explorer Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: partial backend coverage exists for V2 tree reads, placement/delete behavior, protected default folders, and folder permission template snapshots. `tests/frontend/modules/company-explorer/companyExplorerStore.test.ts` covers E55 committed-title publication/registry helpers and Explorer, search, and GVIC title reconcilers. Rule ID mapping is partial.

## Business Logic

E1 - Explorer V2 root and child reads require a company ID.
E2 - Explorer V2 supports the all scope and rejects old Me/Team scope behavior.
E3 - Root reads load the company root containers for the viewer.
E4 - Child reads require a parent ID that is either the company root or a valid Explorer folder resource ID.
E5 - Explorer reads return only resources where the viewer has effective view access or higher.
E6 - Explorer rows include effective access so the UI can decide available actions.
E7 - Explorer rows include has-children information for folder rows so the UI can lazy-load folder branches.
E8 - Explorer rows sort by position, then creation time, then name, then entity ID.
E9 - The final Company Explorer tree contains folders, subfolders, Logic Gates, and projects, plus the narrow email-collaboration Node exception under protected Unfiled/Nodes. Ordinary standalone, project-related, and Logic-Gate-assigned nodes are not Company Explorer rows.
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
E22 - Explorer placement, update, and removal mutations preserve the affected parent entity ID in independently required durable domain facts and committed responses; they do not publish a Company Explorer or workspace browser event.
E23 - Company Explorer patches concrete mounted state from the initiating command response or the concrete same-window committed-title event; other changes reconcile when the relevant canonical branch is opened or explicitly refreshed.
E24 - Company Explorer does not use event context or parent-entity fallback to drive background branch refreshes. Canonical branch identity and parent data are resolved by the explicit branch read.
E25 - Every company has one default root folder named Unfiled.
E26 - Unfiled has exactly three default child folders, in this order: Projects, Logic Gates, Nodes.
E27 - Bare projects and Logic Gates created outside Company Explorer route to Unfiled/Projects and Unfiled/Logic Gates respectively.
E28 - Ordinary bare nodes created outside Company Explorer do not create a Company Explorer item and do not appear in the main tree. Only a Node created by the lazy email-collaboration path in EMAIL52 receives a Nodes-folder item.
E29 - The `company_explorer_items.target_type` constraint allows `project`, `logic_gate`, and `node`; service/store authorization permits the node type only for the protected email-collaboration placement. Migration recreates the deterministic protected Nodes folder without backfilling ordinary existing nodes or resurrecting legacy arbitrary node placements.
E30 - Creating, dragging, batch-placing, or ordinary communications-converting a node into Company Explorer remains rejected. The sole insertion path is the internal idempotent email-collaboration create transaction, which places its exact new collaboration Node directly under Unfiled/Nodes. A pre-existing ordinary Node placement is not collaboration-managed and retains normal authorized move/reorder/detach cleanup behavior.
E31 - Company Explorer search queries the whole company graph, not only branches that the lazy UI has already opened.
E32 - Company Explorer search still returns node matches from the source of truth rather than from `company_explorer_items`.
E33 - Node search results with Logic Gate assignments or project relationships are returned only when at least one of those organizational paths is visible to the viewer; ordinary standalone accessible nodes can still appear with no Explorer path, while an authorized email-collaboration Node reports Unfiled/Nodes as its one Explorer path.
E34 - Company Explorer search orders result types as Logic Gates, nodes, projects, then folders.
E35 - Company Explorer search results include resource_type, resource_id, display name, match reason, and Explorer location path.
E36 - Search result display renders the Explorer location path as nested Explorer rows with normal icons.
E37 - Node search result rows are open-only: they can be opened, but cannot be expanded, renamed, deleted, pinned, dragged, dropped, or used as creation targets.
E38 - The default Unfiled folder and its Projects, Logic Gates, and Nodes child folders cannot be renamed, moved, or deleted. Projects and Logic Gates inside their folders retain normal authorized move/delete actions; collaboration Node rows under Nodes are open-only and cannot be moved, reordered, detached, or deleted through Explorer placement actions.
E39 - While the Explorer search box contains text, the left sidebar hides non-Explorer sections and uses the remaining column for Explorer search results; clearing the search restores the normal sidebar. Explorer/Search Explorer remains beneath the shared body-level blocking modal layer and cannot paint or receive interaction above a node/editor popup, dialog, preview, or expanded/fullscreen panel; closing that surface preserves the existing search query.
E40 - Once a resource is visible anywhere in Company Explorer, no project relationship branch may create a second visible instance of that resource.
E41 - Company Explorer has no cross-user realtime subscription. It patches the initiating browser from committed command results and otherwise reloads canonical branches on navigation or explicit refresh.
E42 - Node-map folder-scoped queries return no ordinary nodes for non-root Company Explorer folders. A query scoped to the exact protected Unfiled/Nodes folder may return only authorized email-collaboration Nodes placed there; another folder may not surface those Nodes through relationship fallback.
E43 - Placing or moving a project or Logic Gate into an Explorer folder copies that folder's current permission policy to the project or Logic Gate.
E44 - Reordering or re-saving a project or Logic Gate under the same Explorer folder preserves the resource's own permissions.
E45 - Moving a project or Logic Gate out of a folder to the company root preserves the resource's own permissions.
E46 - Editing an Explorer folder's permissions after placement does not fan out to existing subfolders, projects, or Logic Gates.
E47 - Dropping a My Triage or Shared Triage email onto a Company Explorer Logic Gate row uses the communications conversion path to create a Pending direct email-created node/card in that Logic Gate's Kanban/work path, not a Company Explorer placement. The created node/card must not appear as a Company Explorer row and must not be inserted into `company_explorer_items`.
E48 - A successful Company Explorer email-to-Logic-Gate drop updates Home triage state once from the committed conversion result, keeps the source row visible, and patches its Logic Gate icon without communications/workspace WebSocket events, broad cache invalidation, stale prefetched-page reuse, post-removal fill, message-length prefetch, list blanking, or repeated mail GETs.
E49 - A successful Company Explorer email-to-Logic-Gate drop shows a temporary green success banner over the Company Explorer sidebar section.
E50 - A successful Company Explorer email-to-Logic-Gate, pinned Logic Gate, or non-Explorer eligible node drop sets source emails to unstarred through the source mailbox scope, returns `unstarred_message_ids`, and reconciles Home locally without pulling replacement rows into Inbox, All, Starred, My Triage, or Shared Triage.
E51 - Double-clicking a Company Explorer row label must not enter inline rename mode; renaming folders, projects, and Logic Gates requires an explicit rename action that is already authorized for the target.
E52 - We want multi browser click-drag ability. So I can drag an email from My Triage or Shared Triage and click drag it to another browser window (but the same account) and drop it off on the company explorer logic gate and create a node within that logic gate's kanban board with an email icon (but obviously not create a node on the company explorer)
E53 - Permissions opened from Company Explorer for folders, projects, or Logic Gates use the shared permission view and always expose a visible **Save** action when editable. Node search results remain open-only and do not gain Explorer permission actions.
E54 - An email conversion through Company Explorer persists mailbox provenance in the created node's attached-email projection: personal/My Triage conversions retain `account_email`, and Shared Triage conversions retain both `shared_inbox_id` and `account_email`, so later reads, replies, attachments, drafts, and invitation responses use the source mailbox scope.
E55 - Every successful Node or Logic Gate rename entry point publishes the concrete committed-title event after commit. Company Explorer patches matching Logic Gate rows, Node search results, and mounted GVIC-mode Node/Logic Gate names (including scoped per-user cached rows) immediately alongside the other applicable mounted surfaces; active title drafts/carets are deferred, failed renames publish no event, and another browser still uses canonical reads.
E56 - Every company receives one deterministic Nodes folder beneath Unfiled. Re-running default-folder repair is idempotent, preserves the same IDs/order/protection, and must not duplicate the folder or any collaboration Node item.
E57 - Email-collaboration Node placement does not copy the Nodes folder permission policy. The Node keeps the private participant policy in EMAIL54, so folder permissions cannot expose it to nonparticipants or revoke permanent participants.
E58 - A collaboration Node row is a protected projection of collaboration ownership, not a general placement edge. Explorer item create/update/move/delete endpoints reject direct mutation of that row; lifecycle changes must use the collaboration/Node domain action so no orphaned chat, participant, draft, or source-thread record remains. Move/delete protection is determined by an exact same-company `communications_email_collaborations.node_id` row, never by `target_type='node'` alone, so an ordinary legacy Node edge remains movable and detachable.
E59 - One collaboration identity has at most one Nodes-folder item. Concurrent create retries, future provider messages, or reopening from another surface reuse that row, and Company Explorer must not render the same Node under project/Logic Gate relationship branches.
E60 - Existing email-to-Logic-Gate conversion behavior in E47 through E54 is not the collaboration exception: it still creates a Pending Kanban/work Node with no Company Explorer item. Starting chat on an unconverted triage email creates the private Unfiled/Nodes collaboration Node instead and applies no conversion defaults.


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
- A company has Explorer folders, projects, Logic Gates, source-of-truth ordinary nodes, and an email-collaboration Node.
- The viewer has access to some resources but not others.

Expected:
- Root and child reads require company ID.
- Old Me/Team scopes are rejected.
- Root reads load company root containers.
- Child reads require the company root or a valid folder parent ID.
- Only viewable Explorer resources are returned.
- Rows include effective access and folder has-children state.
- Rows sort by position, creation time, name, and entity ID.
- The final Company Explorer tree shows folders, subfolders, projects, and Logic Gates, plus only authorized email-collaboration Node rows beneath Unfiled/Nodes.
- Ordinary standalone, project-related, and Logic-Gate-assigned nodes remain absent as tree rows.
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
- `company_explorer_items` accepts project, Logic Gate, and Node target types, but service/store commands authorize Node only for internal email-collaboration creation under protected Unfiled/Nodes.
- Any user/API attempt to create a Node placement through ordinary Company Explorer commands is rejected. Existing ordinary Node edges retain authorized move/reorder/detach behavior; only collaboration-backed Node edges reject those mutations.
- Communications/email conversion targeting a Company Explorer folder is rejected and must not create a node, folder item, Explorer V2 row, or `company_explorer_items` row.

### Scenario E-S3: Explorer Local Reconciliation And Canonical Branch Reads

Business logic covered:
- E22
- E23
- E24
- E41
- E55

Given:
- A user has several Explorer branches loaded.
- The user commits a folder or project mutation, or successfully renames a Node or Logic Gate from each supported Editor, Kanban, map, Home/My Work, or Company Explorer entry point.
- Another browser may change an Explorer resource while this browser remains open.

Expected:
- The committed response or concrete same-window committed-title event patches matching Explorer Logic Gate rows, Node search results, and materialized/scoped GVIC-mode Node and Logic Gate names in the initiating browser.
- Editor, Kanban, Node Map, and Logic Gate Map labels converge from that same event as applicable.
- Failed renames publish no title event; no generalized server fan-out or full reload is required.
- Durable domain facts may retain the affected parent entity ID for independently required consumers, but no Company Explorer or workspace browser event is published.
- Another browser's changes can remain stale until navigation, branch reopen, or explicit refresh performs the canonical branch read.
- Node, relationship, and Explorer domain events do not cause background Company Explorer branch refresh work.

### Scenario E-S4: Default Unfiled Placement

Business logic covered:
- E25
- E26
- E27
- E28
- E38

Given:
- A company has no user-created Explorer folders.
- A project, Logic Gate, ordinary node, or email-collaboration Node is created outside Company Explorer without an explicit folder placement.
- Another project or Logic Gate is created explicitly at the Company Explorer root.

Expected:
- The root contains the default Unfiled folder.
- Unfiled contains Projects, Logic Gates, and Nodes in that order.
- Bare outside-created projects and Logic Gates appear in the matching Unfiled child folder.
- Ordinary outside-created nodes remain queryable source-of-truth nodes but do not appear in Company Explorer.
- The email-collaboration Node appears exactly once beneath Unfiled/Nodes and keeps its private participant permissions rather than copying folder permissions.
- Explicit root-created projects and Logic Gates stay at the Company Explorer root and do not also appear in Unfiled.
- Unfiled, Projects, Logic Gates, and Nodes do not expose rename/move/delete actions and direct mutation attempts are rejected.

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
- A matching authorized email-collaboration Node is placed under Unfiled/Nodes.
- Another matching resource exists under an Explorer folder the viewer cannot access.
- A blocking node/editor popup, dialog, preview, or expanded/fullscreen panel opens while Search Explorer has a query.

Expected:
- Search returns matches from the whole company, not only loaded UI branches.
- Search returns node matches from source-of-truth node storage, not from Company Explorer item rows.
- Node result paths use visible Logic Gate assignment and project relationship context when available.
- A node whose only Logic Gate assignment or project relationship paths are hidden from the viewer is excluded, even when the viewer has direct access to the node.
- Standalone accessible node results can appear with an empty Explorer path.
- An authorized email-collaboration Node reports its one Unfiled/Nodes path and is not duplicated under a relationship path.
- Search excludes matches whose Explorer placement or folder ancestry is not visible to the viewer.
- Logic Gates are listed before nodes, nodes before projects, and projects before folders.
- Each result includes resource_type, resource_id, display name, match reason, and Explorer location path.
- The UI renders the location path as nested Explorer rows and selecting a resource result opens that resource directly.
- Node result rows are open-only and do not expose Explorer mutation affordances.
- The blocking surface paints and receives interaction above Search Explorer regardless of feature-local stacking contexts; after it closes, the previous search query and results remain.

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
- The protected Nodes folder contains an authorized email-collaboration Node.

Expected:
- Project and Logic Gate folder drops write Company Explorer placement edges.
- Logic Gate assignment edges are not reused as Company Explorer placement edges.
- Project relationship edges are not rendered as nested Project child rows or reused as Company Explorer placement edges.
- Dragging or placing nodes through Company Explorer is rejected.
- Nodes continue to be found by search through source-of-truth relationships.
- Folder-scoped node-map queries return no ordinary nodes for non-root Company Explorer folders; the exact protected Nodes scope may return only its authorized collaboration Nodes.

### Scenario E-S7: Email Drop Onto Explorer Logic Gate

Business logic covered:
- E47
- E48
- E49
- E50
- E54

Given:
- A user has a My Triage or mailbox-capable Shared Triage email selected.
- The user drags that email, possibly from another Chrome window or tab, onto a Company Explorer Logic Gate row and chooses a priority.
- The active Home triage list is visible and has a cached message page/detail entry for that email.

Expected:
- The conversion request and created attached-email projection preserve the source mailbox scope: personal conversions retain `account_email`, while Shared Triage conversions retain both `shared_inbox_id` and `account_email`.
- The backend creates a Pending direct email-created node/card in the target Logic Gate.
- Company Explorer folder rows are not email conversion targets; project-surface email drops use project relationship conversion instead of Company Explorer placement.
- The created email node/card is owned by the Logic Gate/Kanban work path and does not create a Company Explorer folder item, Explorer V2 row, or `company_explorer_items` row.
- The backend sets the source email to unstarred through the personal or shared mailbox grant that supplied the drag payload and returns successfully updated IDs in `unstarred_message_ids`.
- The Home triage list keeps the converted row in local state and local message caches, and patches its Logic Gate icon state from the conversion result without clearing all communications message caches.
- Home applies the committed result once; no communications/workspace WebSocket echo exists.
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

### Scenario E-S9: Explorer Permission Save

Business logic covered:
- E53

Given:
- A user opens permissions for an Explorer folder, project, or Logic Gate from Company Explorer.

Expected:
- Every editable permission view visibly exposes **Save** and follows `docs/tests/permissions.md`.
- Saving persists the current selection without closing the view and reports loading or failure state.
- Read-only and denied views remain dismissible and do not issue a permission mutation.
- Node search rows remain open-only and do not expose Explorer permission or mutation controls.

### Scenario E-S10: Protected Unfiled Nodes Collaboration Placement

Business logic covered:
- E26
- E28
- E29
- E30
- E38
- E42
- E56
- E57
- E58
- E59
- E60

Given:
- Default-folder repair runs repeatedly for a company.
- Two concurrent first-chat/shared-draft requests target the same previously uncollaborated email thread.
- Users attempt to place an ordinary Node, move the collaboration Node, or drop the email onto a Logic Gate.

Expected:
- Repair leaves one deterministic Unfiled/Nodes folder after Projects and Logic Gates and never backfills arbitrary existing Nodes.
- The collaboration create transaction yields one private standalone Node and one protected item directly beneath Nodes.
- The row is visible only to authorized Node viewers, remains open-only, and cannot be moved, reordered, detached, or deleted through Explorer placement APIs.
- Folder permissions neither expose the Node to nonparticipants nor replace its permanent participant grants.
- Repeated creates and future thread messages reuse the same Node/item, and relationship branches do not duplicate it.
- Ordinary Node placement remains rejected.
- A pre-existing ordinary Node edge remains movable and detachable because it has no collaboration ownership row.
- Email-to-Logic-Gate drop remains the separate Pending Kanban conversion in E47 through E54 and creates no Explorer Node item.
