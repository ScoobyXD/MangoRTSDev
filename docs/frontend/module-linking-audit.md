# Module Linking Audit (Explorer + Node Map + Editor)

This note explains how context linking currently works across frames/modules in the frontend.

## 1) Link graph model

- Frame-to-frame links are stored as undirected `FrameLinkEdge` records (`a`, `b`, `mode`) in localStorage key `frame-module-links-v1`.
- Frame kinds are normalized with `classifyFrameKind` (`map`, `editor`, `explorer`, `logic-map`).
- When a module needs "its linked map", it runs a BFS over the frame link graph (`resolveLinkedFrameByKindFromGraph`) and picks the first reachable frame of kind `map`.

## 2) Broadcast channels

Shared event names:
- `mangoos:frame-link-graph-updated`
- `mangoos:node-map-selection-updated`
- `mangoos:explorer-context-updated`

These are dispatched with `emitDashboardEvent(...)` as typed `CustomEvent`s.

## 3) Node Map -> Explorer/Editor selection flow

- Node Map writes its selection into scoped localStorage state: `node-map-state-v1:<companyID>:<mapWidgetID>`.
- Node Map emits `EVENT_NODE_MAP_SELECTION_UPDATED` with payload including `mapWidgetID`, `selectedNodeID`, and a monotonic-ish `revision`.
- Explorer and Editor each resolve their linked map frame first, then ignore node-map events unless `detail.mapWidgetID` matches that resolved map frame.
- Both consumers use `revision` guards to drop stale/out-of-order updates.

## 4) Explorer -> Node Map/Editor context flow

- Explorer broadcasts only on semantic selection changes (`shouldBroadcastSelection`).
- Explorer writes payload into per-target localStorage keys: `node-map-explorer-context-v1:<companyID>:<targetFrameID>`.
- Explorer emits `EVENT_EXPLORER_CONTEXT_UPDATED` with target metadata.
- Editor listens for this and uses explorer context as fallback when map selection is absent.

## 5) Echo-loop prevention

- Explorer applies map-originated selection only if the node/tree values actually change (`shouldApplyMapSelection`).
- When Explorer applies map-driven state, it sets `suppressNextExplorerBroadcastRef` so it does not immediately rebroadcast the same state.

## 6) "How does each module know what to view?"

Priority model currently implemented:
1. Resolve linked map frame through frame-link graph + frame registry.
2. Try map-selected node from linked map state/event.
3. If no map selection, Editor can fallback to explorer context key targeted at the editor frame.
4. Ignore events whose `mapWidgetID`/target does not match the current linked topology.

This design makes view selection topology-aware (via links), scoped (via frame IDs), and resilient to stale events (via revisions and no-op guards).
