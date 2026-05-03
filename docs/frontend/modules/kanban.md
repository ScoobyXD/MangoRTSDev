# Kanban Board Module

## Purpose
Kanban board is a module for placing `node` work items into titled columns.

Users can:
- add columns,
- rename column titles inline,
- delete columns,
- drag column headers left/right to reorder columns,
- resize columns horizontally and vertically,
- drag nodes from Company Explorer into a column,
- drag a selected batch of Company Explorer node rows into a column,
- drag cards between columns and vertically reorder cards inside a column,
- select one or more cards with click, Ctrl/Cmd-click, and continuous Shift-click range selection across columns,
- request selected-card deletion with Delete, Backspace, or the card context menu.

## Visual Rules
- The board surface stays white in the light theme.
- Columns stay directly on the module surface; do not wrap all columns in a second board frame.
- The right edge includes a square add-column control with a solid black border and a small hover shadow.
- Column titles preserve user-entered casing; the UI must not force uppercase display.
- Column title text enters edit mode on one click. Header dragging still starts from the header before a click is completed.
- Column deletion is confirmation-gated with the same modal treatment as frame and map deletes.
- Right-clicking a column opens column actions: rename, delete, and native RGB color selection for cards inside that column.
- Right-clicking a card opens card actions only; currently that menu contains Delete card.
- Selected cards use a thin, vibrant frame in the card's column item color. Do not use the old heavy global-accent outline.
- The left color rail is always rendered from the card's column item color and must not disappear when selection changes.
- Card deletion is confirmation-gated. Delete and the card context menu only open the confirmation modal; the card is removed only after Yes.
- Backspace uses the same confirmation-gated delete path as Delete.
- Card delete confirmation must state that only the Kanban board card is removed and the underlying node continues to exist outside the board.
- Clicking a card publishes that node selection to directly linked Company Explorer frames so the Explorer row highlights with the selected card.
- Cards do not show a top-right expand/collapse control. Card titles and optional descriptions render directly.
- Drag previews for Explorer-to-Kanban node batches and Kanban card batches show the selected batch, not just the row under the cursor.
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
  "nodeID": "node-id",
  "label": "Visible title"
}
```

`itemType` must be `node`.

Company Explorer can also write a node-only batch for multi-row drags:

```json
{
  "itemType": "node_batch",
  "nodes": [
    { "nodeID": "node-id-1", "label": "Visible title 1" },
    { "nodeID": "node-id-2", "label": "Visible title 2" }
  ]
}
```

Kanban de-dupes node IDs in the payload and upserts each card into the target column.

Kanban card drags use:

```text
application/x-mango-kanban-card
```

Payload:

```json
{
  "cardID": "primary-card-id",
  "cardIDs": ["primary-card-id", "second-card-id"],
  "sourceColumnID": "source-column-id"
}
```

`cardID` is kept for old single-card payload compatibility. `cardIDs` is the selected-card batch and is moved together in visual order.

## Backend/API Contract
Kanban board is API-first so future agents can operate boards without rendering React.

Endpoints:
- `GET /v1/kanban/columns?company_id=...&board_id=...`
- `POST /v1/kanban/columns`
  - `{ company_id, board_id, title, position?, width_px?, height_px?, item_color? }`
- `PUT /v1/kanban/columns/:column_id`
  - `{ company_id, board_id, title?, position?, width_px?, height_px?, item_color? }`
- `DELETE /v1/kanban/columns/:column_id?company_id=...&board_id=...`
- `GET /v1/kanban/cards?company_id=...&board_id=...&column_id=...&after_position=0&limit=200`
- `POST /v1/kanban/cards`
  - `{ company_id, board_id, column_id, node_id, node_title, position?, description_snapshot? }`
- `PUT /v1/kanban/cards/:card_id`
  - `{ company_id, board_id, column_id, position? }`
- `DELETE /v1/kanban/cards/:card_id?company_id=...&board_id=...`

`POST /v1/kanban/cards` is idempotent per board and node. If the same node is dropped again, the existing card moves instead of duplicating.
`PUT /v1/kanban/cards/:card_id` is also used for vertical card reordering and selected-card batch moves by writing new sparse `position` values.
The card write API has no item-type field; Kanban board cards are node-only.

The removed `/v1/kanban/query` endpoint should stay removed until a specific filter or grouping capability is designed again. Headless agents should currently use the same bounded column/card APIs as the UI.

## Hot Path Rules
- Reads are scoped by `company_id` and `board_id`.
- Cards are fetched with an explicit limit; the UI reads a bounded first window and agents should page with `after_position`.
- Backend tables keep board/column position indexes for fast interactive reads. Extra filter indexes were removed with the old query surface.
- Column reorder usually writes only the moved column position. Rare position compaction is scoped to visible board columns.
- Card reorder usually writes only the moved card position. Rare position compaction is scoped to the visible target column.
- Card batch reorder writes only the moved selected cards when there is sparse-position room. Rare position compaction is scoped to the visible target column.
- Column width, height, and item color are stored on the column row so UI users and headless agents share the same layout contract.
- Card rows store `node_title` to avoid requiring a details lookup on every board render.
- Card rows intentionally do not store item type, logic-gate ID, status age, work type, or assignment metadata until a specific product/API need returns.
- Node IDs remain the source of truth; `node_title` is display-only.

Junior engineer note: keep future bulk behavior as paged API reads. Do not load every card for a company-wide board into React.
When adding filters back, add only the specific filter the product needs, then pair it with a measured read path and a matching index or projection.
