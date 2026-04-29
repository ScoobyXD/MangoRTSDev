# Editor Module

## Purpose
The Editor module is the node-linked text workspace for MangoOS. It lets users view and edit structured text boxes that are persisted as `Text box` node information records.

## Key Responsibilities
- Resolve which Node Map frame this editor is linked to through the frame-link graph + frame registry.
- Read the currently selected node from linked Node Map local state.
- Load selected node details and extract text-box records from node information.
- Render draggable/resizable text boxes inside the editor canvas.
- Persist text-box create/move/resize/edit updates back to backend node information APIs.
- Surface node context from the same selected node (metadata summary, history timeline, and non-text info preview).
- Support generic node title updates directly from editor context header (`PUT /v1/nodes/:node_id`), including inline rename UX.

## Important Data/Integration Paths
- **Input from Node Map:** selected node state (`node-map-state-v1:<company_id>:<map_widget_id>`).
- **Linking source:** generic frame-link graph (`frame-module-links-v1`) + frame registry (`frame-module-registry-v1`) with graph traversal to nearest linked map frame.
- **Explorer fallback context source:** editor can read explorer-driven node selection from `node-map-explorer-context-v1:<company_id>:<editor_widget_id>` when no direct map-state context is available.
- **Backend read path:** `GET /v1/nodes/:node_id?company_id=...`.
- **Backend write path:** `POST /v1/nodes/:node_id/information` for text-box payloads.
- **Backend node-title update path:** `PUT /v1/nodes/:node_id` with `{ company_id, title }`.
- **Backend projection read path:** `GET /v1/nodes/:node_id/projection?company_id=...` (typed node projection rows for hot editor loads).
- **Event sync hooks:** `EVENT_FRAME_LINK_GRAPH_UPDATED`, `EVENT_NODE_MAP_SELECTION_UPDATED`, `EVENT_EXPLORER_CONTEXT_UPDATED`, and `storage` events.

## Semantic vs layout persistence policy (2026-04-27)
- Editor information values are persisted server-side and served through typed node projection rows for hot-path loads.
- Editor box geometry (`x/y/w/h`) is local/per-user layout state and is intentionally not part of hot server payloads.
- This removes hot-path JSON geometry reconstruction work while preserving fast local layout interaction.

## Latency hardening update (2026-04-26)
- Editor no longer depends on legacy editor->map localStorage mapping updates.
- Link-resolution refresh is now triggered by dedicated graph-change events (or frame-link storage key changes), not by unrelated app layout churn.
- Node map selection sync now consumes semantic selection events (with revision metadata) rather than high-frequency full map-state event fanout.

## Editor persistence + reload correctness update (2026-04-26)
- Text box blur-save now commits the current textarea value directly, preventing stale state snapshots that could previously persist blank/old text and then rehydrate incorrectly after node switches.
- Empty double-click box creation no longer writes an immediate blank persistence row; persistence starts once there is user-entered content or subsequent geometry/text save action.
- Semantic event precedence update: when map/explorer selection events arrive, Editor applies selected-node IDs directly from event context instead of waiting for debounced map-state storage reads, preventing stale-node display during explorer-driven selection changes.

## Projection identity hardening update (2026-04-28)
- Every newly created editor textbox now gets a stable client-generated UUID `information_id` immediately (before first network save).
- Blur saves and follow-up saves continue using that same textbox identity key.
- The API still appends history rows to `node_information`, but projection identity now remains stable in `node_projection_table`.
- This prevents textbox duplication after refresh caused by projection-key drift during rapid save/blur sequences.

## UX Notes
- Node context header content is intentionally offset below the frame title strip to avoid overlap with top-left module chrome.
- Node title uses single-click inline edit activation in the header (no double-click required), and click handling is isolated so editor-canvas textbox creation does not trigger from title edits.
- Text boxes support drag and edge/corner resize interactions.
- Double-clicking the canvas creates a new text box at pointer position.
- Text value is persisted server-side; box geometry is preserved in local/per-user layout storage.

## Commenting Convention Reminder
When editing this module, prefer comments that summarize intent and feature responsibilities (what this block controls), not line-by-line implementation mechanics.
