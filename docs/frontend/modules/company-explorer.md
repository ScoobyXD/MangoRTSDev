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

Folder runtime update (2026-05-02):
- Explorer folders are now durable backend rows, not local-only UI state.
- `company_explorer_folders` stores nested folders separately for `node` and `logic_gate` trees. A folder can only contain matching node or logic-gate items, which keeps UI behavior and headless API writes aligned.
- `company_explorer_folder_items` stores one placement per node or logic gate, matching file-explorer move semantics.
- The tree has one `Company` root row. It is collapsible, and a brand-new company renders no child rows until folders, nodes, or logic gates are created.
- Direct nodes or logic gates render immediately under their expanded folder, then child folders render below those item rows.
- The old virtual `Nodes`, `Logic Gates`, `All Nodes`, `All Logic Gates`, Knowledge, and Knowledge Nodes rows are removed from the Explorer tree.
- Folder rows use fixed yellow icons, node rows use fixed black-and-white document icons, and logic-gate rows use fixed green circuitry AND-gate icons. These icon colors do not follow frame colorways.
- Explorer row labels do not include live item counts. Count queries belong in bounded API/read models, not in every tree row render.
- Explorer no longer renders vertical or horizontal hierarchy guide lines; indentation and icons carry the tree structure.
- Folder creation is now a Company Explorer context-menu action, not an inline plus button. Right-clicking the tree body opens Explorer actions, while frame-level actions remain scoped to the frame/module title plate.
- When the right-click context has no folder type, the menu exposes typed folder creation (`Create node folder`, `Create logic gate folder`) so empty folders still obey the backend item-type invariant. Right-clicking typed rows uses the compatible single `Create folder` action.
- Right-clicking a concrete folder, node, or logic gate exposes `Rename` and `Delete`, backed by folder/node/logic-gate APIs.
- Double-clicking a concrete folder, node, or logic gate starts inline rename with the caret at the end of the current title.
- Left-clicking elsewhere inside Company Explorer closes the Explorer context menu before applying the new selection.
- New folders are created inside the right-clicked compatible folder/tree. New nodes and logic gates are created through their canonical APIs and then assigned to the compatible right-clicked folder through `company_explorer_folder_items` when a folder target exists.
- After any create action, the newly created folder, node, or logic gate becomes the selected highlighted row.
- Plain click selects one row, Shift-click selects the visible range from the anchor row, and Ctrl/Cmd-click toggles individual rows. This selection state is UI-local until a concrete action consumes it, keeping linked map broadcasts focused on the active row.
- Node, logic-gate, and folder moves still use drag-and-drop onto compatible folders.
- Selecting a node folder broadcasts `selectedFolderID`/`selectedFolderKind=node`; linked Node Map filters its cached graph to nodes placed in that folder or any descendant folder.
- Selecting a logic-gate folder broadcasts `selectedFolderID`/`selectedFolderKind=logic_gate`; linked Logic Gate Map applies the same folder-scope rule for gates.
- Selecting an individual node or logic gate inside a folder keeps that folder scope in the broadcast, so linked maps can select the item without expanding back to the whole company.
- Relationships are displayed only when both endpoints are inside the active folder scope. Cross-folder relationships stay persisted but are hidden in that scoped map view.

Kanban drag update (2026-05-01):
- Node and Logic Gate rows are draggable.
- Drag payloads use `application/x-mango-explorer-entity` with `{ itemType, itemID, label }`.
- Kanban consumes the payload through its API-first board contract so the same operation can be performed by headless agents.

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
- `PUT /v1/company-explorer/folders/{folder_id}` for folder rename and/or move
- `DELETE /v1/company-explorer/folders/{folder_id}`
- `GET/POST/DELETE /v1/company-explorer/folder-items`

This keeps source-of-truth entity IDs and persistence semantics intact while making Explorer organization durable.
Folder move writes reject self/descendant parents so the folder tree remains safe for recursive scope filtering.

---

## 7) Non-goals (v1)

- No template locking policy in v1.
- No deeper-than-2-level frame nesting semantics in v1 (defined by Nested Frame spec).
- No requirement to replace Node Map or Node Doc behavior; Explorer complements them.
