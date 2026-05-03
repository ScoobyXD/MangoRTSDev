# Module Linking Audit (Explorer + Node Map + Editor)

This note explains how context linking currently works across frames/modules in the frontend.

## 1) Link graph model

- Frame-to-frame links are stored as undirected `FrameLinkEdge` records (`a`, `b`, `mode`) in localStorage key `frame-module-links-v1`.
- Frame kinds are normalized with `classifyFrameKind` (`map`, `editor`, `explorer`, legacy `logic-map`, `kanban`).
- When a module needs "its linked map", it runs a BFS over the frame link graph (`resolveLinkedFrameByKindFromGraph`) and picks the first reachable frame of kind `map`.

## 2) Broadcast channels

Shared event names:
- `mangoos:frame-link-graph-updated`
- `mangoos:node-map-selection-updated`
- `mangoos:logic-gate-map-selection-updated`
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
- Explorer broadcasts to every connected frame in the link graph. This makes `A -> B -> C` behave as one linked context group without requiring a direct `A -> C` edge.

## 5) Echo-loop prevention

- Explorer applies map-originated selection only if the node/tree values actually change (`shouldApplyMapSelection`).
- When Explorer applies map-driven state, it sets `suppressNextExplorerBroadcastRef` so it does not immediately rebroadcast the same state.
- Map selection event sequences are generated per context ID, not per React component instance. This matters for the unified Map because switching between node and logic-gate views remounts the underlying renderer; consumers must still see later selections as newer events.

## 6) "How does each module know what to view?"

Priority model currently implemented:
1. Resolve linked map frame through frame-link graph + frame registry.
2. Try map-selected node from linked map state/event.
3. If no map selection, Editor can fallback to explorer context key targeted at the editor frame.
4. Ignore events whose `mapWidgetID`/target does not match the current linked topology.

This design makes view selection topology-aware (via links), scoped (via frame IDs), and resilient to stale events (via revisions and no-op guards).

## 6.1 Logic Gate Map Linking

Logic Gate Map participates through the unified `map` kind for new frames. Legacy saved frames using `logic-map` still resolve as logic-gate maps.

- Logic Gate Map writes scoped selection state to `logic-gate-map-state-v1:<companyID>:<mapWidgetID>`.
- Logic Gate Map emits `mangoos:logic-gate-map-selection-updated`.
- Company Explorer writes logic-gate context to `logic-gate-map-explorer-context-v1:<companyID>:<targetFrameID>`.
- Editor prefers direct linked-map selection first, then Explorer fallback context.
- The unified Map chooses node vs logic-gate rendering from the newest Explorer context key for its frame.

Junior engineer note:
- Node and logic-gate contexts use separate storage keys/events so a node click cannot accidentally overwrite a logic-gate workflow, and vice versa.

## 6.2 Kanban Linking

Kanban participates in the same frame-link graph using kind `kanban`.

- Company Explorer rows are draggable as node/logic-gate payloads.
- Kanban consumes those payloads and writes durable cards through `/v1/kanban/cards`.
- Linked Explorer selection is read from the existing Explorer context keys and highlights a matching Kanban card.
- Kanban card clicks write node context back to directly linked Explorer frames using the same Explorer context key family, allowing the matching Explorer node row to highlight.
- Company Explorer can export selected node rows as a node-only drag batch; Kanban de-dupes that payload and upserts each node card into the dropped column.
- Parent/Child Frame auto-linking works without extra Kanban-specific storage because child frame groups already run through the generic link plan.


## 7) Gaps identified by latency architecture contract
Current behavior is functional, but these gaps were identified during architecture review:

1. **Event envelope field mismatch.**
   - Current broadcasts are typed but not yet standardized on a locked envelope requiring `context_id`, `source_module_id`, `sequence`, `timestamp`, and `user_action_type`.

2. **Sequence semantics are module-local.**
   - Current revision guards are "monotonic-ish" and scoped to module behavior rather than a single canonical workspace sequence contract.

3. **Authority is still partly implicit.**
   - Some context write/read decisions are embedded in module logic instead of a single explicit authority matrix per context type.

4. **Reconciliation trigger is not yet formalized.**
   - We already do selective refresh in places, but sequence-gap-triggered targeted reconciliation must be explicit and testable.

## 8) Migration target (explicit contract)
The target state is:

- modules emit **intent** messages only, including `user_action_type`
- shared context engine validates ordering/idempotency
- projection updates are emitted with sequence semantics
- modules render from projection updates
- sequence gaps trigger scoped reconcile

Junior engineer note:
- If two modules can both overwrite the same context directly, bugs look random.
- The contract removes that randomness by giving one canonical path for writes and reads.
