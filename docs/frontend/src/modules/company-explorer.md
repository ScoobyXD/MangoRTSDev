# Company Explorer Module — Product & Interaction Specification

Status: Draft v1 (2026-04-21); final tree contract updated 2026-07-06

---

## 1) Purpose

`Company Explorer` is a standalone frontend module that provides a file-explorer-style navigation surface for company knowledge.

It is intended to be the master browsing experience for:

- folders,
- logic gates,
- projects,
- and open-only search access to nodes through their source-of-truth relationships.

The UI intent is explicitly "tree explorer first" (similar mental model to DBeaver/IDE explorers), with hierarchical affordances and connector guide-lines for nested rows.

---

## 2) Core module behavior

### 2.1 Independence requirement

`Company Explorer` must function on its own, independent of Node Map and Node Doc.

In standalone mode:

- Left: tree navigation remains stable.
- Middle: item detail surface (or focused inspector).
- Right: contextual panel for history, metrics/KPIs, and related artifacts.

### 2.2 Entity model for "files"

Each final Explorer tree row represents one company "file" entity with a normalized type:

- `folder`
- `logic_gate`
- `project`

Node resources are not normal Company Explorer tree rows. They remain source-of-truth workspace resources and may appear in Company Explorer search results as open-only rows when they are reachable through visible Logic Gate assignment or project relationship context.

Golden rule:

- Company Explorer shows folders, projects, and Logic Gates as final tree rows.
- `company_explorer_items` owns placement for canonical project and logic-gate resources only. Its `target_type` constraint is `project` or `logic_gate`; `node` is not allowed.
- Nodes are not placed in Company Explorer folders, are not written to `company_explorer_items`, and are ignored by final Explorer tree reads/live refresh.
- Project relationships and Logic Gate node assignments belong to their source-of-truth surfaces and read models; they do not create nested Project or Logic Gate child rows in Company Explorer.

### 2.3 Tree UX rules

- Expand/collapse per row with caret semantics.
- Hierarchy is shown through indentation, faint vertical guide lines, and fixed entity icons.
- Multi-select behavior mirrors existing platform expectations (`Shift`/`Ctrl`).
- Context menu available per item and per empty area.
- Folder, project, and Logic Gate permission actions use the shared permissions dialog. Every editable permissions view opened from Company Explorer displays an explicit `Save` button that commits the current selection; denied or read-only views remain dismissible without writing. Node search results remain open-only and do not gain Explorer permission actions.
- Keyboard navigation (up/down/left/right/enter) should be supported.

---

## 3) Pane responsibilities in standalone Explorer view

### 3.1 Left pane: Tree

Responsibilities:

- browse hierarchy,
- adjust scope,
- define current active context for sibling panes.

Interaction expectation:

- selecting deeper folders narrows focus,
- selecting higher-level folders broadens the context.

### 3.2 Middle pane: Details

Responsibilities:

- primary selected-item detail view,
- editable metadata and structured fields,
- relationship summary.

### 3.3 Right pane: Context

Responsibilities:

- history timeline,
- metrics/KPI visualization,
- related artifacts.

Recommended tab set:

1. Overview
2. History
3. Metrics / KPI
4. Relationships
5. Artifacts

---

## 4) Default views (tab-level actions)

Tab right-click menu should include:

- Rename View
- Delete View
- Map
- Default Company Explorer View
- Save Current as Template

Notes:

- `Map` and `Default Company Explorer View` are hardcoded baseline view entries.
- Both defaults remain user-editable after opening.
- `Save Current as Template` persists the current arrangement as reusable user-defined layout.

---

## 5) Linked behavior in Map

In the default Node-oriented workspace (Explorer + Canvas + Doc):

- Explorer selection drives scope for Node Map.
- Selecting deeper tree levels narrows visible/queried graph scope.
- Selecting higher levels broadens visible/queried graph scope.
- Node Doc follows active selection context.

This linking is conceptualized as context sync, not as a new data model.

Implementation update (2026-04-26):
- Frame-level linking now supports direct Explorer <-> Editor context links (not only Explorer <-> Node Map).
- Current runtime resolves Node Map and Logic Gate Map graph context providers through the same frame-link graph, so Explorer can drive either node selection or logic-gate selection without a new link storage model.
- Explorer selection context is now broadcast to all directly linked frame targets (including Editor) through explorer-context localStorage/event keys so linked editors can follow selected node or logic-gate content without requiring an explicit map link.
- Explorer loads Logic Gate Map graph data from the shared workspace snapshot/cache and shows real logic gates under the Logic Gates tree.
- Selecting a logic gate broadcasts a logic-gate explorer context key (`logic-gate-map-explorer-context-v1`) so linked Logic Gate Map and Editor frames can follow it.

Latency hardening update (2026-04-26):
- Explorer target resolution now reads direct neighbors from `frame-module-links-v1` only (legacy explorer->map bridge key no longer required in runtime writes).
- Explorer re-evaluates link targets on dedicated graph-change signals (`EVENT_FRAME_LINK_GRAPH_UPDATED`) and frame-link storage updates.
- Explorer now also listens to semantic Node Map selection events and linked map-state updates, so selecting a node in Node Map updates Explorer row selection (`node-<id>`) and keeps linked Editor context in sync bidirectionally.
- Explorer suppresses immediate re-broadcast when applying map-originated selection updates to prevent context echo loops that can cause alternating node selection churn and repeated details GETs.

Selection sync hardening update (2026-04-29):
- Explorer->linked-target context broadcast is now semantic-change scoped (publish only when selected node/tree actually changes).
- Map-originated selection echoes are treated as no-op when Explorer already holds the same selected node/tree, which prevents "every other click" suppression churn.
- This keeps anti-loop behavior while protecting hot-path click reliability for linked Explorer<->Node Map flows.

Selection sync hardening update (2026-05-03):
- Live selection now flows through `selectionCoordinator.ts` for Explorer, Node Map, Logic Gate Map, Editor, and Kanban. The coordinator event carries the selected entity kind/id directly, so linked modules do not infer live clicks from localStorage snapshots.
- Explorer still writes scoped context keys for startup/remount restore, but same-tab consumers should treat those keys as fallback only.
- When a linked map selection event already includes the selected node or logic-gate ID, Explorer applies that event payload directly and does not read debounced map-state storage for sequence-gap recovery.
- Map-state storage remains a fallback only for gap events that do not carry a selected entity ID. This prevents stale localStorage from jumping the Explorer highlight back to an older row after Explorer drives the map.
- Explorer rows keep file-explorer drag/drop behavior, but hover uses the normal cursor instead of a grab cursor so the tree does not look like it is always in a drag state.
- Linked maps now tag selection events that were caused by Explorer context with `sourceExplorerID`. Company Explorer ignores events from its own frame ID, so child-to-parent folder changes and node-tree/logic-gate-tree switches cannot be overwritten by delayed self-echoes.
- Root/empty Explorer context is a real broadening command. Node Map and Logic Gate Map clear active folder scope and selection when they receive Explorer context with no selected entity or folder, instead of keeping the previous child selection alive.
- Node Map and Logic Gate Map suppress cached selection events while a newer Explorer context is pending in storage. This blocks stale cached map selections during unified Map remounts/mode switches.
- Node Map and Logic Gate Map treat Explorer-selected node/gate IDs as authoritative while a folder scope change is being applied. If the new selected ID is temporarily missing from the currently rendered folder projection, the map keeps that selected ID instead of falling back to the first visible item and broadcasting a false map click back to Explorer.
- Startup graph loads also preserve the latest live Explorer-selected ID and folder scope. This prevents the first Explorer click after opening `http://localhost:5173/` from being overwritten by an older cached map selection or by the first row in a stale graph-load closure.
- Same-millisecond live selections from different modules are resolved by arrival order, not by comparing source-local sequence numbers. This prevents a logic-gate map echo with a high local sequence from rejecting the Explorer node click that switches the unified Map back to node mode.
- Explorer derives outbound live/context payloads from the active tree row first, then normalizes opposite-domain IDs to empty strings. A node click cannot carry a stale logic-gate ID into Map or Editor context during node/logic-gate switches.
- Graph cache reducers preserve map-layout positions when applying node/gate/relationship deltas, so Explorer-driven creates/deletes and SSE updates cannot accidentally drop layout state and force the map to regenerate positions.
- Explorer publishes a `selectionIntent` with live selections. Pointer selection uses `activate`, so linked Editor frames can focus the document for immediate typing; keyboard tree navigation uses `navigate`, so Up/Down/Left/Right can be repeated without the Editor stealing focus.

Folder runtime update (2026-05-02):
- Explorer folders are now durable backend rows, not local-only UI state.
- The final Company Explorer tree stores nested folders and project/Logic Gate placements. Nodes are deliberately excluded from Explorer placement storage.
- Map folder-scope traversal must not treat Company Explorer folders as node-placement containers; non-root folder-scoped node-map queries return no nodes from Explorer placement.
- Legacy `company_explorer_folder_items` node rows, if present in old data, are ignored by the final tree. Current placement storage for the final tree is `company_explorer_items` with `target_type in ('project', 'logic_gate')`.
- Folder and folder-item rows carry sparse integer `position` values. New API-created rows append after both folder and item siblings in the same parent, so the backend preserves the mixed order users see instead of maintaining separate folder/item queues. Reorder writes usually update one row; compaction is limited to the visible sibling set only when adjacent positions no longer have numeric room.
- The tree has one `Company` root row. It is collapsible, and a brand-new company renders no child rows until folders, projects, or Logic Gates are created.
- Direct project and Logic Gate rows render immediately under their expanded folder. Placed items and child folders share the same sparse ordering inside that folder, so users can vertically reorder folders, projects, and Logic Gates together.
- The old virtual `Nodes`, `Logic Gates`, `All Nodes`, `All Logic Gates`, Knowledge, and Knowledge Nodes rows are removed from the Explorer tree.
- Folder rows use fixed yellow icons, project rows use project icons, and logic-gate rows use fixed green circuitry AND-gate icons. Node icons are reserved for open-only search results and non-Explorer node surfaces. These icon colors do not follow frame colorways.
- Explorer row labels do not include live item counts. Count queries belong in bounded API/read models, not in every tree row render.
- Explorer renders faint vertical hierarchy guide lines for ancestor depth rails. The rails align with the expand/collapse arrow column for each ancestor level. The lines are a human scanning aid only; placement, ownership, permissions, map scope, drag/drop behavior, and API writes still come from the existing folder/item/assignment data model.
- Explorer rows show a small lock marker when the row has explicit permission rules. This marker applies to folders, logic gates, and projects from the same `has_permission_rules` read-model flag; it is not rendered for normal node rows because nodes are not final Company Explorer rows.
- Folder creation is now a Company Explorer context-menu action, not an inline plus button. Right-clicking the tree body opens Explorer actions, while frame-level actions remain scoped to the frame/module title plate.
- The final Explorer context menu creates Explorer folders and supported Explorer resources without offering node placement into the tree.
- Right-clicking a concrete folder, project, or logic gate exposes the actions allowed for that resource. Node search results are open-only and do not expose Explorer mutation affordances.
- Right-clicking a concrete logic gate can expose `Find Logic Gate`. Node search results can be opened, but they are not Explorer placement rows.
- Double-clicking a Company Explorer row label must not enter inline rename mode; rename is available only through explicit actions for folders, projects, and Logic Gates.
- Left-clicking elsewhere inside Company Explorer closes the Explorer context menu before applying the new selection.
- New folders are created inside the right-clicked Explorer folder/tree. New Logic Gates and projects are created through canonical APIs and placed through final Explorer placement storage when a folder target exists. New nodes are created from node/work surfaces, not placed into Company Explorer folders.
- After any Explorer create action, the newly created folder, project, or Logic Gate becomes the selected highlighted row.
- Plain click selects one row, Shift-click adds the visible range from the anchor row without clearing previous selections, and Ctrl/Cmd-click toggles individual rows. This selection state is UI-local until a concrete action consumes it, keeping linked map broadcasts focused on the active row.
- Project, logic-gate, and folder moves use the Company Explorer APIs, so headless callers can perform the same placement changes without a browser.
- Drag-and-drop accepts supported Explorer rows inside a folder section. Dropping a project or Logic Gate on a child row resolves to that row's containing folder, while dropping directly on a compatible folder still targets that folder. Dropping a node into Company Explorer is rejected.
- Dragging over the top or bottom half of a sibling row reorders the dragged folder/item before or after that row, using the same sparse-position pattern as Kanban cards. Folders and items participate in the same visible sibling order for their compatible parent.
- Dragging a folder across folder levels can now land before or after a row in the target folder instead of only appending inside the target. The UI sends the same sparse `position` writes that headless callers can send through the folder APIs.
- Dropping a folder on the `Company` root moves that folder back to the root of its node or logic-gate tree.
- Drag moves do not auto-expand the moved folder or the target folder; expanded/collapsed state remains a user-controlled local view.
- The Explorer tree supports keyboard navigation: Up/Down moves selection through visible rows, Right expands a selected folder, and Left collapses a selected folder. The module keeps the last interacted Explorer active for arrow commands even when browser focus would otherwise fall back to the frame shell.
- Row hover shows a visual selection preview only. It does not publish linked-map context or write API state, which keeps accidental mouse movement off the hot synchronization path.
- Expanded rows, tree scroll position, and root-level order for unplaced rows persist in localStorage per company/frame on the user's own machine. This state is intentionally not propagated through backend or company-wide sync.
- The Explorer tree owns its vertical overflow and uses the same thin scrollbar treatment as Editor surfaces. The scrollbar is browser-native, appears only when the tree exceeds the frame height, and keeps rendering virtualized for large company trees. Light frames use the Editor light-mode cyan scrollbar color.
- Selecting a logic-gate folder broadcasts the folder context for Logic Gate Map. Company Explorer folders do not define node-map node membership.
- Selecting an individual Logic Gate inside a folder keeps that folder scope in the broadcast, so linked maps can select the item without expanding back to the whole company.
- Relationships are displayed from source-of-truth relationship/assignment read models, not from Company Explorer node placement. Moving a project or Logic Gate in Company Explorer does not create node placement edges.
- Node Map and Logic Gate Map can emit `mangorts:company-explorer-find-requested`
  with `{ companyID, targetFrameIDs, entities: [{ kind, id }] }`. Explorer
  applies that local API by selecting every matching visible Logic Gate row, or
  by opening node search results through source-of-truth node context. It does
  not require node folder placement in Company Explorer.

Project leaf update (2026-06-24):
- Project rows are standalone Company Explorer resources and do not expose nested project-relationship children.
- A project relationship can still exist for the Project UI, but it must not create a second Company Explorer row for the related node, logic gate, or project.
- Explorer placement remains single-parent/single-instance: moving a resource changes its `company_explorer_items` placement rather than adding another visible location.

Explorer move/search update (2026-06-24):
- Dragging or placing nodes through the normal Company Explorer tree is rejected. Logic Gate assignment is handled by Logic Gate/Kanban/Home/My Work command paths, not by Explorer placement storage.
- Company Explorer search can still return node matches from source-of-truth node storage. Node search result rows are open-only and do not become Explorer tree rows.
- Hidden folder ancestry must hide search result paths even when the underlying resource has direct view access; standalone accessible node results may still appear with an empty Explorer path.

Email-to-Explorer business rule (2026-07-06):
- Drag payloads from My Triage or mailbox-capable Shared Triage can cross Chrome windows/tabs and carry message IDs plus source mailbox scope. Cross-browser application drag/drop is not part of the documented Company Explorer requirement unless a separate compatibility rule and test are added.
- Company Explorer accepts those email drops only on Logic Gate rows.
- The drop invokes the communications conversion target for that Logic Gate and creates a Pending direct email-created node/card on the Logic Gate's Kanban/work path.
- The created node/card shows the normal email/source icon/state expected by email-created Kanban cards.
- The created node/card must not be rendered as a Company Explorer entity, must not create an Explorer V2 row, and must not insert a `node` target into `company_explorer_items`.
- Company Explorer folder and project rows are not email conversion targets. Dropping an email on a Company Explorer folder must not create a node in that folder.

Visual hierarchy update (2026-06-29):
- Company Explorer row indentation may allocate extra horizontal room so nested rows read clearly at sidebar widths.
- Vertical depth guide lines are derived from the rendered tree row depth and collapse/filter with the visible rows. They must line up under the arrow/disclosure column for each ancestor level and must not introduce new hierarchy, parentage, or scope semantics.
- The last visible row at a depth renders a terminal connector: the vertical rail stops at the row midpoint and turns right toward the row icon. This endpoint is computed from the visible row sequence, so collapsed and filtered branches do not leave dangling rails.
- Search/path rows may use the same depth guide rendering as normal tree rows because the guide is presentational and follows the existing `ExplorerTreeNode.depth` value.

Permission marker update (2026-06-29):
- Company Explorer preserves the V2 `has_permission_rules` flag for folders, logic gates, and projects. The backend must set that flag for project and logic-gate rows when the resource has `default_access=no_access` or explicit `resource_permissions` override rows.
- Folder, logic-gate, and project rows render the same lock marker when that flag is true, so resource-specific permission rules are visible directly in the tree.
- The lock is a status indicator only. It does not open permissions, grant access, deny access, or change the context-menu rules by itself.

Bug history (2026-07-01):
- A previously opened lazy folder could later reopen with only the disclosure arrow changing to expanded and no child rows appearing. The stale state was a branch marked loaded while its V2 child rows were no longer materialized. Expanded `has_children` folders now refetch when their loaded marker has no visible child rows behind it.

Legacy Kanban Explorer note (superseded by final tree contract):
- Earlier drafts explored Kanban boards as Explorer items. The final Company Explorer tree is now folders, projects, and Logic Gates only.
- Kanban board state and direct email-created cards belong to Kanban/Logic Gate work surfaces. They do not create Company Explorer item rows.
- Selecting or finding Kanban cards may still open source nodes or Logic Gates through their own surfaces/search, but it must not depend on node or Kanban placement inside Company Explorer.

Unified map/linking update (2026-05-03):
- The module picker now exposes one `Map` module. The map switches between node and logic-gate views from source-of-truth context; Company Explorer folders do not define node placement membership.
- Legacy `nodes-map` and `logic-map` frame kinds still load for existing saved layouts, but new workspaces should use `map`.
- Explorer context is broadcast to every connected frame in the link graph, not just directly linked neighbors. If Explorer is linked to Map and Map is linked to Editor, Explorer context reaches the Editor as well.
- Folder, node, and logic-gate rename responses patch the shared graph caches immediately so Explorer, Map, and Editor converge without waiting for a full workspace snapshot refresh.

Kanban drag update (2026-05-01):
- Legacy drafts allowed node rows to drag from Explorer into Kanban. The final Company Explorer tree no longer renders normal node rows.
- Kanban consumes node payloads from node-capable surfaces through its API-first board contract so the same operation can be performed by headless agents.

Kanban multi-drag update (2026-05-03):
- Explorer rows support click, Ctrl/Cmd-click, and continuous Shift-click selection for navigation and supported Explorer actions.
- Node batch drags belong to node-capable surfaces, not final Company Explorer tree rows.
- A linked Kanban card click may use source-of-truth node context or search to open the matching node, but it must not require a node row in Company Explorer.

Email-to-work drag update (2026-07-07):
- Company Explorer and Logic Gate Kanban both consume the Home triage email drag payload `application/x-mangorts-communications-triage-messages`.
- The payload preserves one exact mailbox identity end to end: Shared Triage sends `shared_inbox_id`, while My Triage sends the selected personal account as normalized lowercase `account_email`; neither target may substitute a fallback personal account.
- Dropping the payload on a Company Explorer Logic Gate converts the email into that Logic Gate through the existing priority picker.
- Dropping the same payload directly on a Logic Gate Kanban column converts the email into that board and column through `POST /v1/communications/triage/convert` with `target.mode = existing_logic_gate` and `column_id`.
- Both surfaces dispatch `mangorts:home-triage-conversion-applied` so Home reconciles source mail rows, Logic Gate placement, and unstarred state consistently.

---

## 6) Data/backend stance

Workspace folder structure is API-backed for UI and future headless agents.

Implementation principle:

- keep existing node/relationship/information contracts,
- store folder hierarchy and item placement with small indexed tables,
- keep map filtering against the existing workspace snapshot cache for current runtime,
- expose direct Explorer APIs so agents can create folders and move projects/Logic Gates without a browser.

Headless API surface:
- `GET/POST /v1/company-explorer/folders`
- `PUT /v1/company-explorer/folders/{folder_id}` for folder rename, move, and/or `position` reorder
- `DELETE /v1/company-explorer/folders/{folder_id}`
- final placement APIs for project and Logic Gate items only

This keeps source-of-truth entity IDs and persistence semantics intact while making Explorer organization durable.
Folder move writes reject self/descendant parents so the folder tree remains safe for recursive scope filtering. `position` is part of the API contract so agents can reorder Explorer rows without relying on browser-only drag state.
Final placement storage accepts project and Logic Gate targets only. Nodes stay in source-of-truth node, project relationship, Logic Gate assignment, search, Kanban, and editor surfaces rather than Company Explorer placement rows.

---

## 7) Non-goals (v1)

- No template locking policy in v1.
- No deeper-than-2-level frame nesting semantics in v1 (defined by Nested Frame spec).
- No requirement to replace Node Map or Node Doc behavior; Explorer complements them.
