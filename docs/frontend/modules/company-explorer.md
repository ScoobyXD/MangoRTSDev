# Company Explorer Module — Product & Interaction Specification

Status: Draft v1 (2026-04-21)

---

## 1) Purpose

`Company Explorer` is a standalone frontend module that provides a file-explorer-style navigation surface for company knowledge.

It is intended to be the master browsing experience for:

- nodes,
- logic gates,
- and related company artifacts.

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

Each explorer row represents one company "file" entity with a normalized type:

- `node`
- `logic_gate`
- `kanban`

### 2.3 Tree UX rules

- Expand/collapse per row with caret semantics.
- Hierarchy is shown through indentation and fixed entity icons; guide-lines are intentionally not rendered in the tree.
- Multi-select behavior mirrors existing platform expectations (`Shift`/`Ctrl`).
- Context menu available per item and per empty area.
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
- Default Node View
- Default Company Explorer View
- Save Current as Template

Notes:

- `Default Node View` and `Default Company Explorer View` are hardcoded baseline view entries.
- Both defaults remain user-editable after opening.
- `Save Current as Template` persists the current arrangement as reusable user-defined layout.

---

## 5) Linked behavior in the Default Node View

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
- Graph cache reducers preserve map-layout positions when applying node/gate/relationship deltas, so Explorer-driven creates/deletes and SSE updates cannot accidentally drop layout state and force the map to regenerate positions.
- Explorer publishes a `selectionIntent` with live selections. Pointer selection uses `activate`, so linked Editor frames can focus the document for immediate typing; keyboard tree navigation uses `navigate`, so Up/Down/Left/Right can be repeated without the Editor stealing focus.

Folder runtime update (2026-05-02):
- Explorer folders are now durable backend rows, not local-only UI state.
- `company_explorer_folders` stores nested folders separately for `node` and `logic_gate` trees. A folder can only contain matching node or logic-gate items, which keeps UI behavior and headless API writes aligned.
- `company_explorer_folder_items` stores one placement per node or logic gate, matching file-explorer move semantics.
- Folder and folder-item rows carry sparse integer `position` values. New API-created rows append after both folder and item siblings in the same parent, so the backend preserves the mixed order users see instead of maintaining separate folder/item queues. Reorder writes usually update one row; compaction is limited to the visible sibling set only when adjacent positions no longer have numeric room.
- The tree has one `Company` root row. It is collapsible, and a brand-new company renders no child rows until folders, nodes, or logic gates are created.
- Direct nodes or logic gates render immediately under their expanded folder. Placed items and child folders share the same sparse ordering inside that folder, so users can vertically reorder folders, nodes, and logic gates together.
- The old virtual `Nodes`, `Logic Gates`, `All Nodes`, `All Logic Gates`, Knowledge, and Knowledge Nodes rows are removed from the Explorer tree.
- Folder rows use fixed yellow icons, node rows use fixed black-and-white document icons, and logic-gate rows use fixed green circuitry AND-gate icons. These icon colors do not follow frame colorways.
- Explorer row labels do not include live item counts. Count queries belong in bounded API/read models, not in every tree row render.
- Explorer no longer renders vertical or horizontal hierarchy guide lines; indentation and icons carry the tree structure.
- Folder creation is now a Company Explorer context-menu action, not an inline plus button. Right-clicking the tree body opens Explorer actions, while frame-level actions remain scoped to the frame/module title plate.
- When the right-click context has no folder type, the menu order is `Create node folder`, `Create node`, `Create logic gate folder`, `Create logic gate`. Typed folder creation keeps empty folders aligned with the backend item-type invariant. Right-clicking typed rows uses the compatible single `Create folder` action.
- Right-clicking a concrete folder, node, or logic gate exposes `Rename` and `Delete`, backed by folder/node/logic-gate APIs.
- Right-clicking a concrete node or logic gate also exposes `Find Node` or `Find Logic Gate`. The action emits a lightweight focus request to the linked map frame, selects the entity on the map, and pans the map so the card is centered without issuing a new graph read.
- Double-clicking the title text of a concrete folder, node, or logic gate starts inline rename with the caret at the end of the current title. Double-clicks on the disclosure control, icon, indent, or blank row area only select/toggle and never start rename.
- Left-clicking elsewhere inside Company Explorer closes the Explorer context menu before applying the new selection.
- New folders are created inside the right-clicked compatible folder/tree. New nodes and logic gates are created through their canonical APIs and then assigned to the compatible right-clicked folder through `company_explorer_folder_items` when a folder target exists.
- After any create action, the newly created folder, node, or logic gate becomes the selected highlighted row.
- Plain click selects one row, Shift-click adds the visible range from the anchor row without clearing previous selections, and Ctrl/Cmd-click toggles individual rows. This selection state is UI-local until a concrete action consumes it, keeping linked map broadcasts focused on the active row.
- Node, logic-gate, and folder moves still use the existing folder APIs (`POST /v1/company-explorer/folder-items` and `PUT /v1/company-explorer/folders/{folder_id}`), so headless agents can perform the same placement changes without a browser.
- Drag-and-drop now accepts any compatible row inside a folder section. Dropping a folder, node, or logic gate on a child row resolves to that row's containing folder, while dropping directly on a compatible folder still targets that folder.
- Dragging over the top or bottom half of a sibling row reorders the dragged folder/item before or after that row, using the same sparse-position pattern as Kanban cards. Folders and items participate in the same visible sibling order for their compatible parent.
- Dragging a folder across folder levels can now land before or after a row in the target folder instead of only appending inside the target. The UI sends the same sparse `position` writes that headless callers can send through the folder APIs.
- Dropping a folder on the `Company` root moves that folder back to the root of its node or logic-gate tree.
- Drag moves do not auto-expand the moved folder or the target folder; expanded/collapsed state remains a user-controlled local view.
- The Explorer tree supports keyboard navigation: Up/Down moves selection through visible rows, Right expands a selected folder, and Left collapses a selected folder. The module keeps the last interacted Explorer active for arrow commands even when browser focus would otherwise fall back to the frame shell.
- Row hover shows a visual selection preview only. It does not publish linked-map context or write API state, which keeps accidental mouse movement off the hot synchronization path.
- Expanded rows, tree scroll position, and root-level order for unplaced rows persist in localStorage per company/frame on the user's own machine. This state is intentionally not propagated through backend or company-wide sync.
- The Explorer tree owns its vertical overflow and uses the same thin scrollbar treatment as Editor surfaces. The scrollbar is browser-native, appears only when the tree exceeds the frame height, and keeps rendering virtualized for large company trees. Light frames use the Editor light-mode cyan scrollbar color.
- Selecting a node folder broadcasts `selectedFolderID`/`selectedFolderKind=node`; linked Node Map filters its cached graph to nodes placed in that folder or any descendant folder.
- Selecting a logic-gate folder broadcasts `selectedFolderID`/`selectedFolderKind=logic_gate`; linked Logic Gate Map applies the same folder-scope rule for gates.
- Selecting an individual node or logic gate inside a folder keeps that folder scope in the broadcast, so linked maps can select the item without expanding back to the whole company.
- Relationships are displayed only when both endpoints are inside the active folder scope. Existing cross-folder relationships are hidden in scoped map views; moving a node or logic gate to a different Explorer folder level through the `POST /v1/company-explorer/folder-items` API deletes relationships touching that entity, and local graph caches prune those edges immediately so the map matches the new folder context.
- Node Map and Logic Gate Map can emit `mangoos:company-explorer-find-requested`
  with `{ companyID, targetFrameIDs, entities: [{ kind, id }] }`. Explorer
  applies that local API by selecting every matching node/logic-gate row,
  expanding the containing folder path from `company_explorer_folder_items` and
  `company_explorer_folders`, and scrolling the first requested row into view.
  This uses entity IDs and indexed folder data, not DOM scanning, so the cost is
  bounded by the requested batch and folder ancestry.

Kanban Explorer update (2026-05-04):
- Kanban boards are durable Explorer items with `item_type=kanban` and a fixed three-column board icon.
- Kanban boards can be placed in either node folders or logic-gate folders. Folder kinds remain `node` and `logic_gate`; Kanban is an item type, not a third map scope.
- Right-clicking Explorer now offers `Create new kanban`. The board is created through `/v1/kanban/boards` first, then assigned to the target folder with `/v1/company-explorer/folder-items` when a folder target exists.
- Kanban board rows support selection, drag/drop placement, inline rename, and delete through the same Explorer interaction model as node and logic-gate rows.
- Selecting a Kanban board broadcasts a `kanban` live-selection event to linked Kanban frames so they open that board. Map and Editor modules explicitly ignore `kanban` selections, because boards are not displayable map/editor entities.
- Selecting a card in Kanban can target Explorer with all selected node IDs. Explorer expands the containing folders for those node rows so `Find on company explorer` works for deeply nested cards.

Unified map/linking update (2026-05-03):
- The module picker now exposes one `Map` module. The map switches between node and logic-gate views from the latest Explorer context: node folders/items show nodes, logic-gate folders/items show logic gates.
- Legacy `nodes-map` and `logic-map` frame kinds still load for existing saved layouts, but new workspaces should use `map`.
- Explorer context is broadcast to every connected frame in the link graph, not just directly linked neighbors. If Explorer is linked to Map and Map is linked to Editor, Explorer context reaches the Editor as well.
- Folder, node, and logic-gate rename responses patch the shared graph caches immediately so Explorer, Map, and Editor converge without waiting for a full workspace snapshot refresh.

Kanban drag update (2026-05-01):
- Node and Logic Gate rows are draggable.
- Drag payloads use `application/x-mango-explorer-entity` with `{ itemType: "node", nodeID, label }`.
- Kanban consumes node payloads through its API-first board contract so the same operation can be performed by headless agents. Logic gates are intentionally not exported as Kanban drag payloads.

Kanban multi-drag update (2026-05-03):
- Explorer rows support click, Ctrl/Cmd-click, and continuous Shift-click selection for drag batching.
- Dragging from any selected node row exports all selected node rows as `{ itemType: "node_batch", nodes: [...] }` on `application/x-mango-explorer-entity`.
- The browser drag image for a selected node batch shows the batch rows and count so the cursor preview matches the transfer intent.
- Non-node rows can stay selected for Explorer navigation, but Kanban batch payloads include node rows only.
- A linked Kanban card click can target this Explorer with `node-map-explorer-context-v1:<companyID>:<explorerFrameID>` so the matching node row highlights.

---

## 6) Data/backend stance

Workspace folder structure is API-backed for UI and future headless agents.

Implementation principle:

- keep existing node/relationship/information contracts,
- store folder hierarchy and item placement with small indexed tables,
- keep map filtering against the existing workspace snapshot cache for current runtime,
- expose direct folder APIs so agents can create folders and move nodes/gates without a browser.

Headless API surface:
- `GET/POST /v1/company-explorer/folders`
- `PUT /v1/company-explorer/folders/{folder_id}` for folder rename, move, and/or `position` reorder
- `DELETE /v1/company-explorer/folders/{folder_id}`
- `GET/POST/DELETE /v1/company-explorer/folder-items`

This keeps source-of-truth entity IDs and persistence semantics intact while making Explorer organization durable.
Folder move writes reject self/descendant parents so the folder tree remains safe for recursive scope filtering. `position` is part of the API contract so agents can reorder Explorer rows without relying on browser-only drag state. Folder-item assignment is also the relationship-boundary API: if a node or logic gate changes folder level, relationships touching that entity are removed in the same canonical write.
Folder item `item_type` accepts `node`, `logic_gate`, and `kanban`; folder `folder_kind` remains limited to `node` and `logic_gate`.

---

## 7) Non-goals (v1)

- No template locking policy in v1.
- No deeper-than-2-level frame nesting semantics in v1 (defined by Nested Frame spec).
- No requirement to replace Node Map or Node Doc behavior; Explorer complements them.
