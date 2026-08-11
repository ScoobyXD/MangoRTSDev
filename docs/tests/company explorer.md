# Process Story: Search narrows once and shares every Explorer branch

A user types a nonblank Company Explorer or Universal Picker query
↓
Mango waits briefly for the active query, cancels the superseded request, and ranks a bounded candidate batch directly from the selected source tables
↓
Only after narrowing does Mango resolve each candidate's Edit permission and separately determine whether its exact Logic Gate, Project, and folder location is fully visible
↓
Company Explorer returns every directly accessible candidate, includes a typed location only when every part is visible, omits the whole restricted location otherwise, and merges common visible path prefixes
↓
The read performs no default-folder repair or company-wide permission scan, while Universal Picker keeps its existing flat result ranking

Last updated: 2026-08-08

# Process Story: Collaboration Nodes receive Responsible RACI without Explorer ownership

A user creates a standalone collaboration Node from a personal or shared email
↓
Mango writes the creator's direct Responsible RACI edge and participant Edit grants in their typed policy tables
↓
The Node remains outside Company Explorer placement storage, and RACI never substitutes for permission

Last updated: 2026-08-06

# Process Story: Nodes stay outside Company Explorer placement storage

A user creates or finds a Node from Editor, email collaboration, chat, Project, or Logic Gate work
↓
The Node remains authoritative in `nodes` and its typed business relationship tables; no `company_explorer_items` Node row or Unfiled/Nodes folder is created
↓
Company Explorer continues to organize only Projects and Logic Gates, while search reads Nodes directly from `nodes`
↓
Search shows a visible Logic Gate placement path first, otherwise a visible Project placement path, otherwise the accessible standalone Node with an empty path
↓
Hidden folder ancestry never leaks, and deleting an Explorer folder never treats a stale historical Node placement as permission to delete the Node

Last updated: 2026-08-06

# Process Story: Explorer hierarchy drives live V2 policy parentage

A user opens Home and selects a Node, Logic Gate, Project, Kanban board, folder, or communications row in Explorer
↓
Explorer resolves the exact accessible row through current folder hierarchy, V2 RACI, and V2 Edit permission, then publishes semantic selection only to directly linked surviving frames
↓
Editor or Kanban consumes the entity context without reading browser geometry or position state
↓
No Map frame, Map selection bridge, coordinate payload, or position-storage dependency exists
↓
Folder ordering, inherited/customized policy, search, Find, rename, deletion, and drag/drop use canonical hierarchy and parent-link sequences
↓
A reload restores supported frames and discards any retired Map frame instead of translating it

Last updated: 2026-08-05

# Explorer Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: backend coverage exists for V2 tree reads, placement/delete behavior, protected default folders, inherited/customized policy, move boundaries, force resets, and a disposable-PostgreSQL candidate-first search with regular-user inherited authorization and exact Explorer paths. `tests/frontend/modules/company-explorer/treePresentation.test.ts` covers merged search paths plus debounce/cancellation source contracts. `tests/frontend/modules/company-explorer/companyExplorerStore.test.ts` covers E55 committed-title publication/registry helpers and Explorer, search, and RACI title reconcilers. Rule ID mapping remains partial.

## Business Logic

E1 - Explorer V2 root and child reads require a company ID.
E2 - Explorer V2 supports the all scope and rejects old Me/Team scope behavior.
E3 - Root reads load the company root containers for the viewer.
E4 - Child reads require a parent ID that is either the company root or a valid Explorer folder resource ID.
E5 - Explorer reads return only resources where the viewer has effective edit access or higher.
E6 - Explorer rows include effective access so the UI can decide available actions.
E7 - Explorer rows include has-children information for folder rows so the UI can lazy-load folder branches.
E8 - Explorer rows sort by position, then creation time, then name, then entity ID.
E9 - The final Company Explorer tree contains folders, subfolders, Logic Gates, and projects. Nodes, including email-collaboration Nodes, are never Company Explorer rows.
E10 - Project rows are standalone leaf rows; project relationships do not render nested Explorer child rows.
E11 - Logic Gate rows are standalone leaf rows; node assignments do not render as nested Explorer child rows.
E12 - Creating an Explorer folder requires company, actor, permission user, parent entity, and nonblank folder name.
E13 - New root Explorer folders own complete customized RACI and permission policies; new subfolders start inherited with no copied policy edges and resolve their current parent live.
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
E26 - Unfiled has exactly two default child folders, in this order: Projects, Logic Gates.
E27 - Bare projects and Logic Gates created outside Company Explorer route to Unfiled/Projects and Unfiled/Logic Gates respectively.
E28 - Every Node creation path, including email collaboration and chat, creates no Company Explorer item and no default Nodes folder. Nodes remain queryable from authoritative Node storage.
E29 - The `company_explorer_items.target_type` constraint allows only `project` and `logic_gate`. The forward cleanup migration deletes only historical Node placement rows and the now-empty deterministic Unfiled/Nodes folders, without deleting Nodes or any business relationship.
E30 - Creating, dragging, batch-placing, deferred-projecting, or communications-converting a Node into Company Explorer is rejected. Historical Node placement rows are neither rendered nor followed by folder deletion; only the cleanup migration removes them.
E31 - Company Explorer search queries matching source rows across the whole company, not only branches that the lazy UI has already opened, and narrows a bounded candidate batch before resolving permissions or location ancestry.
E32 - Company Explorer search still returns node matches from the source of truth rather than from `company_explorer_items`.
E33 - Node search derives location from a visible Logic Gate assignment first, otherwise a visible Project relationship, otherwise an empty path for an accessible standalone Node. A Node with organization links is excluded when every linked organizational path is hidden, so folder ancestry cannot leak.
E34 - Company Explorer search orders result types as Logic Gates, nodes, projects, then folders.
E35 - Company Explorer search results include resource_type, resource_id, display name, match reason, and Explorer location path.
E36 - Search result display merges exact shared location-path prefixes into one nested Explorer branch with normal icons. A resource that is both a match and another match's path parent renders once as the matching resource with the shared descendants beneath it.
E37 - Node search result rows are open-only: they can be opened, but cannot be expanded, renamed, deleted, pinned, dragged, dropped, or used as creation targets.
E38 - The default Unfiled folder and its Projects and Logic Gates child folders cannot be renamed, moved, or deleted. Projects and Logic Gates inside their folders retain normal authorized move/delete actions.
E39 - While the Explorer search box contains text, the left sidebar hides non-Explorer sections and uses the remaining column for Explorer search results; clearing the search restores the normal sidebar. Explorer/Search Explorer remains beneath the shared body-level blocking modal layer and cannot paint or receive interaction above a node/editor popup, dialog, preview, or expanded/fullscreen panel; closing that surface preserves the existing search query.
E40 - Once a resource is visible anywhere in Company Explorer, no project relationship branch may create a second visible instance of that resource.
E41 - Company Explorer has no cross-user realtime subscription. It patches the initiating browser from committed command results and otherwise reloads canonical branches on navigation or explicit refresh.
E43 - Placing or moving a project or Logic Gate into an Explorer folder advances both parent-link sequences. Inherited policy follows the target folder immediately; customized policy remains independent.
E44 - Reordering or re-saving a project or Logic Gate under the same Explorer folder preserves the resource's own permissions.
E45 - Moving a project or Logic Gate to the company root converts an inherited effective policy to a complete customized root policy and preserves an existing customized policy.
E46 - Editing an Explorer folder changes inherited descendants live but does not cross active customized boundaries. Apply to non-customized descendants adds no descendant state; Apply to every descendant records one reset sequence without walking or rewriting descendants.
E47 - Dropping a My Triage or Shared Triage email onto a Company Explorer Logic Gate row uses the communications conversion path to create a Pending direct email-created node/card in that Logic Gate's Kanban/work path, not a Company Explorer placement. The created node/card must not appear as a Company Explorer row and must not be inserted into `company_explorer_items`.
E48 - A successful Company Explorer email-to-Logic-Gate drop updates Home triage state once from the committed conversion result, keeps the source row visible, and patches its Logic Gate icon without a broad conversion/workspace WebSocket event, broad cache invalidation, stale prefetched-page reuse, post-removal fill, message-length prefetch, list blanking, or repeated mail GETs. A later exact-mailbox provider update may independently cause one canonical active-list reconciliation.
E49 - A successful Company Explorer email-to-Logic-Gate drop shows a temporary green success banner over the Company Explorer sidebar section.
E50 - A successful Company Explorer email-to-Logic-Gate, pinned Logic Gate, or non-Explorer eligible node drop sets source emails to unstarred through the source mailbox scope, returns `unstarred_message_ids`, and reconciles Home locally without pulling replacement rows into Inbox, All, Starred, My Triage, or Shared Triage.
E51 - Double-clicking a Company Explorer row label must not enter inline rename mode; renaming folders, projects, and Logic Gates requires an explicit rename action that is already authorized for the target.
E52 - We want multi browser click-drag ability. So I can drag an email from My Triage or Shared Triage and click drag it to another browser window (but the same account) and drop it off on the company explorer logic gate and create a node within that logic gate's kanban board with an email icon (but obviously not create a node on the company explorer)
E53 - Permissions opened from Company Explorer for folders, projects, or Logic Gates use the shared permission view and always expose a visible **Save** action when editable. Node search results remain open-only and do not gain Explorer permission actions.
E54 - An email conversion through Company Explorer sends the exact source mailbox key and persists mailbox provenance in the created node's attached-email projection: personal/My Triage drag and conversion requests carry normalized `account_email`; Shared Triage requests carry `shared_inbox_id` and suppress a personal-account query, while the canonical projection retains both the shared inbox and its company mailbox account email. Later reads, replies, attachments, drafts, and invitation responses use that source scope.
E55 - Every successful Node or Logic Gate rename entry point publishes the concrete committed-title event after commit. Company Explorer patches matching Logic Gate rows, Node search results, and mounted RACI-mode Node/Logic Gate names (including scoped per-user cached rows) immediately alongside the other applicable mounted surfaces; active title drafts/carets are deferred, failed renames publish no event, and another browser still uses canonical reads.
E56 - Re-running default-folder repair is idempotent and creates or repairs only Unfiled, Projects, and Logic Gates. It never recreates Unfiled/Nodes or backfills Nodes.
E57 - A Triage-comment email Node receives its creator/participant Edit grants and creator Responsible RACI directly as an ordinary standalone Node; its privacy never depends on Company Explorer folder placement or visibility.
E58 - Collaboration ownership, chat, participants, drafts, source-thread links, attachments, and Node policies remain in their typed domain tables. Company Explorer has no collaboration Node projection or lifecycle edge.
E59 - Concurrent collaboration retries and future provider messages reuse the same collaboration Node without creating a Company Explorer item or duplicate search result.
E60 - Existing email-to-Logic-Gate conversion still creates Pending work under its established typed assignment path. Starting chat on an unconverted triage email creates a standalone creator-Responsible-RACI Node with no Company Explorer placement and no initial Logic Gate.
E61 - Explorer policy reads explain inherited/customized mode, effective source, active reset, and inactive overwritten customization for folders, projects, and Logic Gates.
E62 - Moving a subtree after an older force reset protects it through the new parent-link sequence; a later reset from its new ancestry may cross that link.
E63 - Deleting an Explorer target removes both V2 settings rows and cascading policy edges; deleting only a placement follows root/detach materialization rules without deleting the target.
E64 - Company Explorer and Editor/Universal Picker entity ranking first read a bounded candidate batch directly from their requested source tables. Permission and location visibility checks run only for that batch, and later ranked batches are checked only when needed to fill the requested authorized result limit. Universal Picker keeps Node, Project, then Logic Gate ranking; Company Explorer keeps Logic Gate, Node, Project, then folder ranking.
E65 - Company Explorer and Universal Picker location visibility use only each narrowed candidate's exact typed organization links and folder ancestors. Company Explorer placement tables provide those paths but store no permission or RACI assignment rows and are not source tables for entity names. A directly accessible candidate remains searchable when its location is restricted.
E66 - A Company Explorer or Universal Picker search GET performs no default-folder creation, repair, transaction, upsert, or version-triggering write. Default-folder setup belongs to explicit initialization and repair paths.
E67 - Within one narrowed permission batch, the actor's nested group ancestry is resolved once and reused across candidate resource, location-resource, and folder checks. Effective permission policy still follows each candidate's canonical immediate-parent chain.
E68 - Company Explorer waits 120 milliseconds before issuing search, aborts the superseded request when the query changes or the search view closes, and never reports an intentional abort as a search failure.
E69 - Direct Edit permission on a matching Project, Logic Gate, Node, or folder is sufficient to return that item. Company Explorer includes its organizational path only when the location resource and every folder ancestor are also accessible; if any part is `no_access`, the entire path is omitted and only the matched item appears at the search root. Universal Picker likewise returns the directly accessible item without exposing organizational ancestry.


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
- A company has Explorer folders, projects, Logic Gates, source-of-truth ordinary Nodes, and an email-collaboration Node.
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
- Every Node remains absent as a tree row, including standalone, project-related, Logic-Gate-assigned, and email-collaboration Nodes.
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
- Subfolders start inherited and live-resolve the parent folder's current policy.
- Folders can be created under the company root or another folder, but not under arbitrary non-folder resources.
- Rename requires edit access.
- Moving resolves the parent and target and changes placement without duplicating the target.
- Placing or moving a project or Logic Gate into a folder advances parent-link sequences; inherited policy follows the new folder and customized policy is preserved.
- Reordering or re-saving a project or Logic Gate under the same folder preserves the resource's own permissions.
- Moving an inherited project or Logic Gate to the company root materializes its effective policy as customized.
- Later folder edits affect inherited descendants live; customized descendants change only after an eligible force overwrite.
- Deleting a placement edge does not delete the target resource.
- Protected/default folders cannot be renamed or deleted.
- Target deletion happens only through the explicit target deletion path.
- `company_explorer_items` accepts only Project and Logic Gate target types.
- Every user, API, deferred projection, and email-collaboration attempt to create a Node placement is rejected; stale historical Node rows are not rendered and cannot cause Node deletion through folder deletion.
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
- The user commits a folder or project mutation, or successfully renames a Node or Logic Gate from each supported Editor, Kanban, Home, or Company Explorer entry point.
- Another browser may change an Explorer resource while this browser remains open.

Expected:
- The committed response or concrete same-window committed-title event patches matching Explorer Logic Gate rows, Node search results, and materialized/scoped RACI-mode Node and Logic Gate names in the initiating browser.
- Editor, Kanban, Home, Project, dock/pin, and Explorer labels converge from that same event as applicable.
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
- A project, Logic Gate, ordinary Node, or email-collaboration Node is created outside Company Explorer without an explicit folder placement.
- Another project or Logic Gate is created explicitly at the Company Explorer root.

Expected:
- The root contains the default Unfiled folder.
- Unfiled contains Projects and Logic Gates in that order.
- Bare outside-created projects and Logic Gates appear in the matching Unfiled child folder.
- Ordinary outside-created nodes remain queryable source-of-truth nodes but do not appear in Company Explorer.
- The email-collaboration Node remains standalone, keeps its creator/participant rules, and creates no Explorer folder or item.
- Explicit root-created projects and Logic Gates stay at the Company Explorer root and do not also appear in Unfiled.
- Unfiled, Projects, and Logic Gates do not expose rename/move/delete actions and direct mutation attempts are rejected.

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
- E64
- E65
- E66
- E67
- E68

Given:
- Matching Logic Gates, nodes, projects, and folders exist across folders and lazy branches that have not necessarily been opened.
- A matching node is assigned to a visible Logic Gate.
- A matching node is related to a visible project.
- A matching source-of-truth node has no visible Explorer path.
- A matching authorized email-collaboration Node has no Logic Gate or Project relationship.
- Another matching resource exists under an Explorer folder the viewer cannot access.
- A blocking node/editor popup, dialog, preview, or expanded/fullscreen panel opens while Search Explorer has a query.

Expected:
- Search returns matches from the whole company, not only loaded UI branches.
- Search returns node matches from source-of-truth node storage, not from Company Explorer item rows.
- Node result paths use a visible Logic Gate assignment first and a visible Project relationship only when no visible Logic Gate path is available.
- A node whose only Logic Gate assignment or project relationship paths are hidden from the viewer is excluded, even when the viewer has direct access to the node.
- Standalone accessible node results can appear with an empty Explorer path.
- An accessible standalone email-collaboration Node reports an empty path.
- Search excludes matches whose Explorer placement or folder ancestry is not visible to the viewer.
- Logic Gates are listed before nodes, nodes before projects, and projects before folders.
- Each result includes resource_type, resource_id, display name, match reason, and Explorer location path.
- The UI renders the location path as nested Explorer rows and selecting a resource result opens that resource directly.
- Results that share folders or a resource parent reuse one rendered branch; repeated full copies of the same path never appear.
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

Expected:
- Project and Logic Gate folder drops write Company Explorer placement edges.
- Logic Gate assignment edges are not reused as Company Explorer placement edges.
- Project relationship edges are not rendered as nested Project child rows or reused as Company Explorer placement edges.
- Dragging or placing nodes through Company Explorer is rejected.
- Nodes continue to be found by search through source-of-truth relationships.

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
- Home applies the committed result once and does not depend on a broad conversion/workspace WebSocket echo; a later exact-mailbox provider update remains independently eligible for canonical reconciliation.
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
- Denied views remain dismissible and do not issue a permission mutation.
- Node search rows remain open-only and do not expose Explorer permission or mutation controls.

### Scenario E-S10: No Node Placement

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
- Default-folder repair runs repeatedly for a company that may still contain historical Unfiled/Nodes rows.
- Two concurrent first-chat/shared-draft requests target the same previously uncollaborated email thread.
- Users create ordinary and collaboration Nodes, attempt to place a Node, or drop an email onto a Logic Gate.

Expected:
- Repair leaves only deterministic Unfiled, Projects, and Logic Gates folders and never creates or backfills a Nodes folder.
- The collaboration create transaction yields one private standalone Node and no Company Explorer item.
- Node visibility follows Node permissions and typed Logic Gate or Project organization, never a folder placement.
- Repeated creates and future thread messages reuse the same Node without creating an item or duplicate search result.
- Every Node placement path remains rejected.
- The forward migration deletes historical Node item rows and now-empty deterministic Nodes folders while preserving the Nodes and all typed relationships.
- Email-to-Logic-Gate drop remains the separate Pending Kanban conversion in E47 through E54 and creates no Explorer Node item.
