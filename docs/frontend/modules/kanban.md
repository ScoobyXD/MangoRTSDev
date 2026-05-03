# Kanban Board Module

## Purpose
Kanban board is a module for placing `node` and `logic_gate` work items into titled columns.

Users can:
- add columns,
- rename column titles inline,
- delete columns,
- drag column headers left/right to reorder columns,
- resize columns horizontally and vertically,
- drag nodes and logic gates from Company Explorer into a column,
- drag cards between columns,
- collapse card description text.

## Visual Rules
- The board surface stays white in the light theme.
- Columns stay directly on the module surface; do not wrap all columns in a second board frame.
- The right edge includes a square add-column control with a solid black border and a small hover shadow.
- Column titles preserve user-entered casing; the UI must not force uppercase display.
- The module reserves top clearance for the frame title plate and linked-module hexagon so column headers do not bleed into frame chrome.
- The top clearance remains empty for now. It belongs to frame tabs/title/link state; board controls should not be rebuilt below the divider.

## Linkable Frame Behavior
Kanban board is a linkable frame kind (`kanban`).

It participates in the same `frame-module-links-v1` graph as Explorer, Node Map, Logic Gate Map, and Editor. Parent/Child Frame behavior remains owned by the app layer:
- dropping a frame into another frame creates the existing child-frame relationship,
- parent/child frame groups are auto-linked by the frame link plan,
- a child Kanban board can therefore receive linked Explorer context without adding a second link model.

Linked Explorer selection highlights matching cards on the board.

## Drag Contract
Company Explorer writes drag payloads using:

```text
application/x-mango-explorer-entity
```

Payload:

```json
{
  "itemType": "node",
  "itemID": "node-id",
  "label": "Visible title"
}
```

`itemType` may be `node` or `logic_gate`.

## Backend/API Contract
Kanban board is API-first so future agents can operate boards without rendering React.

Endpoints:
- `GET /v1/kanban/columns?company_id=...&board_id=...`
- `POST /v1/kanban/columns`
  - `{ company_id, board_id, title, position?, width_px?, height_px? }`
- `PUT /v1/kanban/columns/:column_id`
  - `{ company_id, board_id, title?, position?, width_px?, height_px? }`
- `DELETE /v1/kanban/columns/:column_id?company_id=...&board_id=...`
- `GET /v1/kanban/cards?company_id=...&board_id=...&column_id=...&after_position=0&limit=200`
- `POST /v1/kanban/cards`
  - `{ company_id, board_id, column_id, item_type, item_id, title_snapshot, position?, description_snapshot?, work_type?, assigned_to?, assigned_by?, actor_id?, last_activity? }`
- `PUT /v1/kanban/cards/:card_id`
  - `{ company_id, board_id, column_id, position?, status?, work_type?, assigned_to?, assigned_by?, actor_id?, description_snapshot?, last_activity? }`
- `DELETE /v1/kanban/cards/:card_id?company_id=...&board_id=...`

`POST /v1/kanban/cards` is idempotent per board and entity. If the same node or logic gate is dropped again, the existing card moves instead of duplicating.

The removed `/v1/kanban/query` endpoint should stay removed until a specific filter or grouping capability is designed again. Headless agents should currently use the same bounded column/card APIs as the UI.

Hot metadata fields:
- `status`: defaults to the destination column title.
- `status_entered_timestamp`: changes when `status` changes, used for status age.
- `work_type`: defaults to `Node` or `Logic Gate`, but agents can set domain-specific work types.
- `assigned_to` and `assigned_by`: external user/agent IDs; no UI-only assignment state.
- `created_by`, `updated_by`, and `last_activity`: enough current activity context for board reads without fetching an audit stream.

## Hot Path Rules
- Reads are scoped by `company_id` and `board_id`.
- Cards are fetched with an explicit limit; the UI reads a bounded first window and agents should page with `after_position`.
- Backend tables keep board/column position indexes for fast interactive reads. Extra filter indexes were removed with the old query surface.
- Column reorder usually writes only the moved column position. Rare position compaction is scoped to visible board columns.
- Column width and height are stored on the column row so UI users and headless agents share the same layout contract.
- Card rows store a title snapshot to avoid requiring a details lookup on every board render.
- Card rows store a small set of direct metadata columns instead of JSON so the first production query path can stay index-friendly.
- Node and logic gate IDs remain the source of truth; the snapshot is display-only.

Junior engineer note: keep future bulk behavior as paged API reads. Do not load every card for a company-wide board into React.
When adding filters back, add only the specific filter the product needs, then pair it with a measured read path and a matching index or projection.
