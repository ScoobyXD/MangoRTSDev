# Kanban Module

## Purpose
Kanban is a board module for placing `node` and `logic_gate` work items into titled columns.

Users can:
- add columns,
- rename column titles inline,
- drag nodes and logic gates from Company Explorer into a column,
- drag cards between columns.

## Linkable Frame Behavior
Kanban is a linkable frame kind (`kanban`).

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
Kanban is API-first so future agents can operate boards without rendering React.

Endpoints:
- `GET /v1/kanban/columns?company_id=...&board_id=...`
- `POST /v1/kanban/columns`
  - `{ company_id, board_id, title, position? }`
- `PUT /v1/kanban/columns/:column_id`
  - `{ company_id, board_id, title }`
- `DELETE /v1/kanban/columns/:column_id?company_id=...&board_id=...`
- `GET /v1/kanban/cards?company_id=...&board_id=...&column_id=...&after_position=0&limit=200`
- `POST /v1/kanban/cards`
  - `{ company_id, board_id, column_id, item_type, item_id, title_snapshot, position? }`
- `PUT /v1/kanban/cards/:card_id`
  - `{ company_id, board_id, column_id, position? }`
- `DELETE /v1/kanban/cards/:card_id?company_id=...&board_id=...`

`POST /v1/kanban/cards` is idempotent per board and entity. If the same node or logic gate is dropped again, the existing card moves instead of duplicating.

## Hot Path Rules
- Reads are scoped by `company_id` and `board_id`.
- Cards are fetched with an explicit limit; the UI reads a bounded first window.
- Backend tables have board/column position indexes for fast interactive reads.
- Card rows store a title snapshot to avoid requiring a details lookup on every board render.
- Node and logic gate IDs remain the source of truth; the snapshot is display-only.

Junior engineer note: keep future bulk behavior as paged API reads. Do not load every card for a company-wide board into React.
