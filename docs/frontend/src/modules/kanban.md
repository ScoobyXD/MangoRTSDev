# Kanban Board Module

## Purpose
Kanban board is a module for placing `node` work items into titled columns.

Users can:
- rename the active board from the header,
- search saved Kanban board views from the header,
- switch between saved Kanban board views from the header All Boards list,
- save the current board view into the company-wide board list,
- create a new saved board view,
- add columns,
- rename column titles inline,
- drag column headers left/right to reorder columns,
- resize columns horizontally and vertically,
- drag nodes from Company Explorer into a column,
- drag a selected batch of Company Explorer node rows into a column,
- drag email rows from My Triage or mailbox-capable Shared Triage directly into a Logic Gate Kanban column,
- drag cards between columns and vertically reorder cards inside a column,
- see when a Kanban card was created directly from an email,
- drag a direct email-created card onto another node card to transfer the email attachment and remove the source email node,
- select one or more cards with click, Ctrl/Cmd-click, and continuous Shift-click range selection across columns,
- request selected-card deletion with Delete, Backspace, or the card context menu.

## Visual Rules
- The board surface stays white in the light theme.
- Columns stay directly on the module surface; do not wrap all columns in a second board frame.
- The right edge includes a square add-column control with a solid black border and a small hover shadow.
- Column titles preserve user-entered casing; the UI must not force uppercase display.
- Column title text enters edit mode on one click. Header dragging still starts from the header before a click is completed.
- Column header actions create a new node in that column. Columns are not deleted from the board UI.
- Right-clicking a column opens column actions: create a node, rename, and native RGB color selection for cards inside that column.
- Right-clicking a card opens card actions: Find on company explorer and Delete card.
- Logic Gate work boards include a `Backlogs` status before `Pending`. The standard work statuses remain in the top row, while `Backlogs` renders as a full-width bottom lane that still accepts the same card drops and create-node flow as other columns.
- Selected cards use a thin, vibrant frame in the card's column item color. Do not use the old heavy global-accent outline.
- The left color rail is always rendered from the card's column item color and must not disappear when selection changes.
- Card deletion is confirmation-gated. Delete and the card context menu only open the confirmation modal; the card is removed only after Yes.
- Backspace uses the same confirmation-gated delete path as Delete.
- Card delete confirmation must state that only the Kanban board card is removed and the underlying node continues to exist outside the board.
- Clicking a card publishes that node selection to directly linked Company Explorer frames so the Explorer row highlights with the selected card. Multi-selected cards publish all selected node IDs so Explorer can mirror the selected rows.
- Explorer-originated node selections replace the current Kanban card selection unless the Explorer selection itself is a Shift/Ctrl multi-selection payload.
- Cards do not show a top-right expand/collapse control. Card titles and optional descriptions render directly.
- Cards created directly from an email show a small envelope icon on the card. A normal node card with an attached email does not show this icon unless the card itself was the direct email-created node.
- Dragging a direct email-created card over another card shows a whole-card email attachment target state. Normal card reordering continues to use the before/after insertion marker.
- Drag previews for Explorer-to-Kanban node batches and Kanban card batches show the selected batch, not just the row under the cursor.
- The module reserves top clearance for the frame title plate and linked-module hexagon so column headers do not bleed into frame chrome.
- The top clearance owns the editable board name, search box, and `All Boards` list button. The list groups boards by Company Explorer folder label.
- The main board viewport uses the same thin horizontal/vertical scrollbar treatment as Editor and Company Explorer.

## Linkable Frame Behavior
Kanban board is a linkable frame kind (`kanban`).

It participates in the same `frame-module-links-v1` graph as Explorer and Editor. Parent/Child Frame behavior remains owned by the app layer:
- dropping a frame into another frame creates the existing child-frame relationship,
- parent/child frame groups are auto-linked by the frame link plan,
- a child Kanban board can therefore receive linked Explorer context without adding a second link model.

Linked Explorer selection highlights matching cards on the board.
Linked Explorer selection of a Kanban board opens that board in the linked Kanban frame. Kanban board selections are ignored by Editor modules; no Node Map or Logic Gate Map module exists.

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

Home mail and Shared Triage rows write email conversion drags using:

```text
application/x-mangorts-communications-triage-messages
```

Payload:

```json
{
  "kind": "triage_messages",
  "company_id": "company-id",
  "message_ids": ["message-id"],
  "shared_inbox_id": "shared-inbox-id"
}
```

The drag payload carries exactly one mailbox identity. Shared Triage sources carry `shared_inbox_id`; personal mailbox/My Triage sources omit it and carry the selected account as normalized lowercase `account_email`. Logic Gate Kanban columns accept this payload directly and preserve that exact identity in `/v1/communications/triage/convert`; there is no fallback to another personal account. The conversion uses `target.mode = existing_logic_gate` and `column_id` set to the dropped column. Dropping on an ordinary card or blank column space targets that card's/column's status lane and uses the backend default priority. Dropping on a supported priority group header or grouped card also sends that priority.

Kanban dispatches the same `mangorts:home-triage-conversion-applied` local event as Company Explorer email drops before and after the conversion. This keeps Home's source mail list, local freshness suppression, Logic Gate placement marker, and `unstarred_message_ids` reconciliation consistent across direct Kanban drops and Explorer drops.

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

When the dragged Kanban payload contains exactly one direct email-created card and the pointer is over a different target card, the card-to-card drop transfers the source email into the target node. The source email card and its temporary source node are deleted after the transfer. Multi-card drags, non-email-created cards, blank-column drops, same-card drops, and same-node drops keep normal Kanban movement semantics.

## Command Boundary
Durable Kanban workflows that used to live directly in `KanbanContent.tsx` now route through `frontend/src/modules/kanban/kanbanCommands.ts`.

The command file is the shared action boundary for:
- creating a column with the default layout contract,
- renaming, resizing, recoloring, deleting, and reordering columns,
- moving one or more selected cards with the same sparse-position plan as drag/drop,
- adding Explorer node rows to a column through idempotent card upserts,
- deleting one or more board cards.

The UI still owns visual state, selection authority, confirmation modals, drag state, and optimistic rendering. The command layer owns API call shape, request de-duping, bounded write plans, and injectable API clients for Node-based tests or future headless callers.

Headless agents should use the same endpoint semantics:
- create or update columns through the column endpoints,
- compute sparse card or column positions before writing,
- use `POST /v1/kanban/cards` for idempotent node card placement,
- page reads through the existing board/column/card list endpoints instead of loading company-wide card sets.

## Backend/API Contract
Kanban board is API-first so future agents can operate boards without rendering React.

Endpoints:
- `GET /v1/kanban/boards?company_id=...&after_position=0&limit=100`
- `POST /v1/kanban/boards`
  - `{ company_id, board_id?, title?, position? }`
- `PUT /v1/kanban/boards/:board_id`
  - `{ company_id, title?, position? }`
- `DELETE /v1/kanban/boards/:board_id?company_id=...`
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
- `POST /v1/communications/email-nodes/transfer`
  - `{ company_id, source_board_id, source_card_id, target_board_id, target_card_id }`
- `POST /v1/communications/triage/convert`
  - `{ company_id, shared_inbox_id?, account_email?, target: { mode: "existing_logic_gate", logic_gate_id }, message_ids, column_id?, priority? }`; shared sources send `shared_inbox_id`, while personal sources send normalized `account_email`, never both.

`POST /v1/kanban/cards` is idempotent per board and node. If the same node is dropped again, the existing card moves instead of duplicating.
`PUT /v1/kanban/cards/:card_id` is also used for vertical card reordering and selected-card batch moves by writing new sparse `position` values.
The card write API has no item-type field; Kanban board cards are node-only.
Direct email-created cards expose `created_from_email = true` in Kanban card reads whether the source email came from My Triage or a mailbox-capable Shared Triage inbox. The email transfer endpoint accepts a source card backed by `communications_email_nodes`; it writes the destination attachment into `communications_email_node_attachments`, adds an `Attached email` projection to the target node, and deletes the source email node/card. Transfer uses stored email-node provenance and does not require the actor to have a connected personal mailbox. It does not restore the email to My Triage.
Under the V1 Mango Attachment System, that transfer must preserve email/provider metadata and Mango attachment references only. Attachment bytes belong in S3-backed Mango attachments, not in `communications_email_node_attachments.message` or attached-email projection JSON.
Direct email-to-Kanban column conversion uses the same triage conversion endpoint with `column_id` so the backend creates the email node/card in the dropped Logic Gate status column instead of always using the default pending lane.
Saved board rows are metadata only. Columns/cards remain the source of board contents, column order, dimensions, colors, and card positions.
Kanban boards can be placed in Company Explorer through `company_explorer_folder_items` with `item_type=kanban`. This makes board organization API-first for agents while keeping board display out of maps and editors.

The removed `/v1/kanban/query` endpoint should stay removed until a specific filter or grouping capability is designed again. Headless agents should currently use the same bounded column/card APIs as the UI.

## Hot Path Rules
- Reads are scoped by `company_id` and `board_id`.
- Saved board lists are paged by `after_position` and capped by `limit`; never load every company board into React.
- Cards are fetched with an explicit limit; the UI reads a bounded first window and agents should page with `after_position`.
- Backend tables keep board/column position indexes for fast interactive reads. Extra filter indexes were removed with the old query surface.
- Column reorder usually writes only the moved column position. Rare position compaction is scoped to visible board columns.
- Card reorder usually writes only the moved card position. Rare position compaction is scoped to the visible target column.
- Card batch reorder writes only the moved selected cards when there is sparse-position room. Rare position compaction is scoped to the visible target column.
- Column width, height, and item color are stored on the column row so UI users and headless agents share the same layout contract.
- Card rows store `node_title` to avoid requiring a details lookup on every board render.
- Node rename writes update Kanban card title snapshots. The frontend also listens to the shared node graph cache so linked Explorer/Editor renames show immediately.
- Card rows intentionally do not store item type, logic-gate ID, status age, work type, or assignment metadata until a specific product/API need returns.
- Node IDs remain the source of truth; `node_title` is display-only.

Junior engineer note: keep future bulk behavior as paged API reads. Do not load every card for a company-wide board into React.
When adding filters back, add only the specific filter the product needs, then pair it with a measured read path and a matching index or projection.
