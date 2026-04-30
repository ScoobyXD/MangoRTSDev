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

## 9) Migration status update (2026-04-30)

Implemented in this phase:

1. Node Map selection intent now writes through backend workspace context API (`POST /v1/workspace/context-events`) before broadcasting updates to peers.
2. Local `revision` fallback in shared sequence parsing was removed; canonical envelope sequence is now required for sequence guards.
3. Explorer / Editor / Stats now attempt canonical projection reads first for linked map selection context, and no longer treat Node Map localStorage map-state as primary authority.

Still in progress:

1. Explorer / Editor / Stats still keep limited localStorage fallback reads for explorer-context compatibility only; full fallback removal is pending final cutover.
2. Explicit reconcile endpoint contract (gap-recover policy with formal cursor/watermark handoff) is still pending.

Junior engineer note:
- We intentionally remove sequence-authority split first (writes), then tighten read paths next.
- This sequencing avoids a risky "all modules switch everything at once" rollout.

Junior engineer note:
- If two modules can both overwrite the same context directly, bugs look random.
- The contract removes that randomness by giving one canonical path for writes and reads.
