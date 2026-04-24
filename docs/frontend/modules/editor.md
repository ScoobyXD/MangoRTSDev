# Editor Module

## Purpose
The Editor module is the node-linked text workspace for MangoOS. It lets users view and edit structured text boxes that are persisted as `Text box` node information records.

## Key Responsibilities
- Resolve which Node Map widget this editor is linked to via `EDITOR_LINKS_KEY`.
- Read the currently selected node from linked Node Map local state.
- Load selected node details and extract text-box records from node information.
- Render draggable/resizable text boxes inside the editor canvas.
- Persist text-box create/move/resize/edit updates back to backend node information APIs.
- Surface lightweight context from the same selected node (header + non-text info preview).

## Important Data/Integration Paths
- **Input from Node Map:** selected node state (`node-map-state-v1:<company_id>:<map_widget_id>`).
- **Linking source:** editor/map linkage key (`EDITOR_LINKS_KEY`).
- **Backend read path:** `GET /v1/nodes/:node_id?company_id=...`.
- **Backend write path:** `POST /v1/nodes/:node_id/information` for text-box payloads.
- **Event sync hooks:** `EVENT_EDITOR_LINKS_UPDATED`, `EVENT_NODE_MAP_STATE_UPDATED`, and `storage` events.

## UX Notes
- Text boxes support drag and edge/corner resize interactions.
- Double-clicking the canvas creates a new text box at pointer position.
- Box geometry and text are stored in each information payload to preserve layout.

## Commenting Convention Reminder
When editing this module, prefer comments that summarize intent and feature responsibilities (what this block controls), not line-by-line implementation mechanics.
