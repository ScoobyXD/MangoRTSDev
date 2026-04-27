# Company Explorer Module — Product & Interaction Specification

Status: Draft v1 (2026-04-21)

---

## 1) Purpose

`Company Explorer` is a standalone frontend module that provides a file-explorer-style navigation surface for company knowledge.

It is intended to be the master browsing experience for:

- nodes,
- logic gates,
- note-like nodes (nodes used as notes and not attached to work),
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
- `note_node`

Where `note_node` means a node that is used as note-taking and not attached/converted into work.

### 2.3 Tree UX rules

- Expand/collapse per row with caret semantics.
- Hierarchy guide-lines rendered as thin vertical/elbow lines (VS Code-style readability).
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
- Current runtime still resolves Node Map as the active graph context provider via compatibility mapping, while the link graph is designed to extend to future module kinds (e.g. logic-map) without redesigning link storage.
- Explorer selection context is now broadcast to all directly linked frame targets (including Editor) through explorer-context localStorage/event keys so linked editors can follow selected node content without requiring an explicit map link.

Latency hardening update (2026-04-26):
- Explorer target resolution now reads direct neighbors from `frame-module-links-v1` only (legacy explorer->map bridge key no longer required in runtime writes).
- Explorer re-evaluates link targets on dedicated graph-change signals (`EVENT_FRAME_LINK_GRAPH_UPDATED`) and frame-link storage updates.
- Explorer now also listens to semantic Node Map selection events and linked map-state updates, so selecting a node in Node Map updates Explorer row selection (`node-<id>`) and keeps linked Editor context in sync bidirectionally.

---

## 6) Data/backend stance

No new backend schema is required for this phase.

Implementation principle:

- keep existing node/relationship/information contracts,
- add frontend orchestration logic so linked modules query/update/delete against the correct active IDs and scope.

This keeps source-of-truth entity IDs and persistence semantics intact.

---

## 7) Non-goals (v1)

- No template locking policy in v1.
- No deeper-than-2-level frame nesting semantics in v1 (defined by Nested Frame spec).
- No requirement to replace Node Map or Node Doc behavior; Explorer complements them.
