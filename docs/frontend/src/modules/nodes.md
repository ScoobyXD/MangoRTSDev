# Nodes Module (Frontend) — Feature Documentation

This document captures the full behavior and implementation details currently present in the **Nodes** family of modules loaded inside dashboard **frames** (UI containers):

- **Map** (`map`) for new workspaces; legacy `nodes-map` and `nodes` frames still load the node-map path for saved layouts.
- **Node Doc** (`node-doc`)

Implementation is now organized under:

- `frontend/src/modules/node-map/NodeMapContent.tsx`
- `frontend/src/modules/node-map/NodeMapControls.ts` (Node Map keyboard/mouse/pointer control hooks + multi-select/line-hit helpers)
- `frontend/src/modules/node-map/shared.ts` (shared types/constants/helpers)
- `frontend/src/modules/map/MapContent.tsx` (unified map entry point that switches between node and logic-gate views from Explorer context)

---

## 1) Purpose

The Nodes modules provide a visual “canvas-inside-canvas” experience plus linked node documentation inside dashboard widgets where users can:

- create and delete nodes,
- create directional relationships from side handles,
- drag nodes on a fine grid,
- zoom and pan across a larger virtual node world,
- box-select multiple nodes,
- view relationship lines between nodes,
- add node information records,
- and keep node layout/view state persisted locally.
- and persist shared node positions through the backend map-layout API.
- link a Node Map module to a Node Doc module,
- and edit text-box notes in Node Doc that attach to whichever node is currently selected in the linked Node Map.

### Terminology (authoritative)

- **Node**: the node box/card UI element.
- **Node title**: canonical text label shown on node cards and explorer rows.
- **Relationship line**: the literal line UI element connecting two nodes on the canvas.
- **Relationship**: the parent/child/peer data relationship represented by a `node_relationships` row.

### V1 Unified Node Shell Direction (2026-07-08)

- The V1 unifying nodes project is about full node editor/window shell behavior, not legacy Map behavior.
- Full node windows opened from Home, Updates, Company Explorer/sidebar, Kanban/My Work, dock restore, and Projects should share one user-facing shell source wherever practical.
- The shared shell should own header/title behavior, top-right actions, close/minimize/open/fullscreen/delete controls, sizing/resizing, dock/minimize behavior, and the body layout around text boxes, attached emails, and chats.
- Shared shell behavior does not require one opener, route, page state, permission source, or backend persistence path.
- Project critical-path inline node windows should use the same shell/editor behavior while node edits still save to node information/projection state.
- Node/project text-block chats remain conversation UI and are outside the unified rich editor semantics.
- Node/project email pickers are attach/select surfaces only and must not compose, send, schedule, or save email drafts.
- Map and legacy map-specific node behavior are out of scope unless a live non-map node-window surface imports a helper that must change for this shell contract.

### V1 Unified Editor Phase 1 Note (2026-07-08)

- Node workspace text boxes and project-inline node text boxes keep using the editor module rich-text behavior and node information/projection persistence.
- `EmailPickerModal` in `NodeWorkspaceSurfaceParts.tsx` is now explicitly an attach/select picker: mailbox tabs, search, unread filter, list scrolling/prefetch, and attach remain; compose/send/schedule/draft UI and logic do not belong there.
- Attached-email reply bodies that send real mail use the unified rich editor adapter while the send call remains scoped to the existing email reply flow.

### V1 Unified Node Shell Phase 2 Note (2026-07-09)

- `UnifiedNodeShell` is the shared full-node-window shell source for Home, app/sidebar Company Explorer, dock-restored, Updates, Kanban/My Work, and Project critical-path inline node windows.
- The shared shell owns top-right action ordering, accessible action labels, shell/body metadata, and the shared `node-workspace` body boundary.
- Home/app popup sizing, fullscreen state, sidebar collision bounds, dock tab restore, Kanban overlay ratios, Updates row context, and Project critical-path row selection remain opener-owned adapters.
- Node editor content still flows through `EditorContent` and `NodeWorkspaceSurface`, preserving node information/projection saves, attached-email behavior, and separate chat panes.
- Project critical-path inline node windows mount the shared shell while edits inside them remain node editor mutations rather than project critical-path mutations.

### Stable Text-Box Scrolling And Linked Email Preview (2026-07-21)

- The bounded Node text-box list keeps stable leading, trailing, and pinned-row spacer identities while its mounted window advances. The virtualizer also preserves the latest native scroll position across the React commit, so rapid wheel or trackpad input cannot be clamped back to a previously mounted text box.
- The Node scroll root disables browser scroll anchoring and contains vertical overscroll. Inner editor, chat, and email scroll areas retain their own scrolling, while the outer text-box list remains monotonic from the first row through the last.
- An email-associated text box exposes a clear **Show email** button in its header. It expands the existing full email conversation viewer inside that fixed-height text-box card without inserting provider content into the editable document.
- The expanded viewer shows the provider message body and available From, To, Cc, and Bcc metadata. **Hide email** removes that viewer and restores the full editor/chat height; this display state is local UI only and does not alter the text-box document or email association.

### Node Email Focus And Compact Chat Note (2026-07-21)

- A newly opened Node chat starts at 340 pixels wide. Per-text-box drag resizing still clamps to the existing safety bounds and persists normally.
- The Node email header's old collapse arrow is removed. The Node-level Email control still hides or reopens the whole email column.
- The replacement email-focus button animates between normal and focused layouts. Focused email receives every available horizontal pixel except the 38-pixel text-box timeline rail on the right.
- Focus mode keeps editor and chat components mounted so unsaved local UI state is preserved, but the clipped rail is inert and hidden from assistive technology until normal layout is restored.
- Entering focus mode does not rewrite the user's saved email or chat separator widths; restoring returns to those normal widths.

### V1 Mango Attachment System Note (2026-07-09)

#### Retained Associations And In-App Preview (2026-07-10)

- A text-box `information_id` on a node file records where the upload originated; it does not make the text box the file's lifetime owner. Deleting that box leaves the attachment metadata, S3 object, and node resource link intact.
- The node-header attachment counter/list is independent of text-box existence. It shows all retained node files, and a file whose origin no longer resolves to a live box uses a clear deleted-text-box fallback label.
- Activating a file row opens an authenticated node-level preview overlay and does not download automatically. The right-side download icon remains the only row command that downloads the original file.
- The preview overlay renders browser-supported images, PDF, text/code/CSV/JSON/XML, audio, and video. For text-like files it decodes only `blob.slice(0, 256 KiB)` and renders at most 200,000 decoded characters. Larger text remains previewable in truncated form and shows `Preview limited to 256 KiB / 200,000 characters.` Office documents, archives, and unknown binary files show a preview-unavailable message with metadata and download still available.
- Preview content comes from Mango's authorized attachment-content path. The current endpoint may transfer the full authenticated blob before the client applies its text decode/render caps. Temporary object URLs and obsolete requests are cleaned up when the user closes the overlay or switches files; the 256 KiB decode and 200,000-character render caps prevent unbounded text preview work.
- Deleting a text box also leaves attached-email projections intact. The global node-header email counter/list opens a node-level modal containing `AttachedEmailOrganizerPane`, including its folders/list and selected conversation, independent of any text box. Retained mail therefore remains viewable with zero boxes and under read-only access, while per-text-box email panes keep their existing behavior for surviving boxes.
- No automatic replacement text box is created, and retained files or emails are not silently reassigned to a surviving box. Removal requires a separate explicit unlink/remove action.
- Browser uploads use Mango's direct-upload policy, which defaults to 1 GiB per file. Files through 64 MiB use one presigned S3 `PUT`; larger files use resumable 16 MiB multipart parts. The browser hashes bounded slices incrementally, sends no file bytes through the Mango API, and shows per-file progress, retry, and cancellation state.

- Node text-box inline images, node attachment-button uploads, node text-block chat attachments, and attached-email reply attachments use the global Mango attachment system for new writes.
- Durable node projection/information payloads store attachment references only. The known slow node with multi-megabyte pasted screenshots is the evidence case for removing inline data URLs/base64 from node content.
- The shared node shell keeps attachment button behavior in the shared node workspace/body path, not separately for Home, sidebar, Updates, Kanban/My Work, dock restore, and Project inline node openers.
- Node chats remain separate chat UI; they store attachment references without inheriting rich-editor toolbar/list/indent semantics.
- Incoming provider attachments on attached emails remain provider-referenced until a product path explicitly selects them for Mango ownership/cache.
- `NodeWorkspaceSurface` performs one node-scoped attachment metadata load, filters `file_attachment` relationships for the `node_text_block` editor surface, and derives both per-information-ID lists and the node-wide union from that result. Text-box dropdowns must not each issue their own list request.
- Node attachment upload completion merges successful results into the latest text-block state, deduplicated by durable attachment ID. The node is the durable attachment owner; a text-block information ID is only projection metadata. Partial multi-file failures preserve every successful S3-backed attachment instead of replacing a batch with stale captured state, and deleting a text block never deletes or hides its node attachments.
- Upload callbacks carry the company/node/text-block generation and edit scope that started them. Navigation, attachment-scope changes, edit-permission loss, and text-block deletion invalidate pending callbacks, so late completion cannot mutate the newly opened node or recreate a deleted projection.
- Attachment rows use shared presentation helpers to split the filename from its final extension and to classify common image, spreadsheet, document, presentation, PDF, archive, text/code, audio, and video formats. A recognized final extension takes priority over an unhelpful MIME value. The filename base may ellipsize, but its extension is rendered in a non-shrinking badge as uppercase `.EXT`; extensionless, hidden-dot, and trailing-dot names use `NO EXT` and retain their full base name. The download icon remains a separate far-right action.
- Image rows use `IntersectionObserver` with a small vertical prefetch margin, so closed menus and off-screen aggregate rows do not fetch file bytes. A visible/near-visible row requests authenticated `thumbnail` content first, then `display` on failure; the backend may resolve a missing variant to the original.
- Thumbnail requests are abortable and short-lived object URLs are revoked on image failure, dependency change, menu close, and unmount. Non-image and failed-thumbnail rows render the classified file icon, with a generic icon as the final fallback.
- Every listed attachment keeps a right-side download action that requests the authenticated `original` variant and preserves the stored filename. View-only node users may list/download; only editors may upload.

### Shared People Picker Color Note (2026-07-10)

- The shared people suggestion rows opened by `@` or `!` in node rich text, Logic Gate rich text, and chat composers derive one of twelve deterministic dark, saturated profile palettes from normalized user ID, falling back to normalized email and then display name.
- Each profile palette uses an opaque background, white foreground, and dark border with tested contrast. Keyboard-active rich-editor rows add a low-alpha tint of that same profile color plus the existing active rail while keeping the avatar opaque; chat keeps its existing active-row treatment while also keeping the avatar opaque and full-color.

### Node Attachment Lists And Downloads (2026-07-10)

- An explicit file uploaded from a node text box is linked to the node with `relationship_kind=file_attachment`, `information_id=<text block ID>`, and `editor_surface=node_text_block`.
- The attachment-list control beside a text box's upload paperclip shows only active `file_attachment` links whose `information_id` matches that text box.
- The shared node toolbar has one aggregate attachment control for all active node `file_attachment` links. It uses the matching text-box title as row context when available and keeps unresolved-but-active node file links visible with fallback context.
- These explicit-file lists do not include `inline_image`, `chat_attachment`, `email_attachment`, attached-email records, or any other relationship kind.
- Each row displays the original filename and file size and places a download action on the right.
- Downloads request the `original` variant through the authenticated Mango attachment-content API and use the original filename; the frontend never opens a private S3 key/URL or a legacy `dataURL` as the download source.
- Counts/lists/downloads are read behavior and remain available in a read-only node workspace. The upload control remains edit-only.
- Backend node resource links are the canonical list source after load or upload. Projection references remain useful for editor persistence but do not decide whether an authorized S3-backed attachment can be listed or downloaded.

---

## 2) API contracts used by the module

Base values are read from:

- `VITE_API_BASE_URL` (default `http://localhost:8080`)
- `VITE_COMPANY_ID` (default `11111111-1111-1111-1111-111111111111`)

### Endpoints used

- `GET /v1/nodes?company_id=...`
  - loads the nodes list.
- `GET /v1/nodes/:node_id?company_id=...`
  - loads node details (relationships + information) for one node.
- `GET /v1/nodes/:node_id/projection?company_id=...`
  - loads typed node information projection rows for hot-path editor rendering.
- `POST /v1/nodes`
  - creates a node with `{ company_id, title }`.
- `DELETE /v1/nodes/:node_id?company_id=...`
  - deletes selected node.
- `POST /v1/node-relationships`
  - creates relationship with `{ company_id, node_id_a, node_id_b, a_position, b_position }`.
- `DELETE /v1/node-relationships/:node_relationship_id?company_id=...`
  - deletes a relationship by id.
- `POST /v1/nodes/:node_id/information`
  - adds info item with `{ company_id, type, information }`.
- `GET /v1/map-layout?company_id=...&map_type=node`
  - reads canonical shared node positions for UI users and headless agents.
- `PUT /v1/map-layout`
  - bulk upserts changed node positions with `{ company_id, map_type: "node", positions: [{ entity_id, x, y }] }`.
- `GET /v1/workspace/snapshot?company_id=...`
  - hot initial read includes `node_map_positions` alongside nodes and relationships.
- `GET /v1/attachments/upload-policy`
  - returns the authenticated browser-upload policy and configured size, strategy, part-size, concurrency, and expiry limits.
- `POST /v1/attachments/upload-intents`
  - authenticates and authorizes the target resource, creates an idempotent durable upload intent, assigns the attachment ID and object key, and returns either a short-lived single-`PUT` request or multipart instructions. The active company is carried only as the membership-validated Mango control-plane header `X-Mango-Company-ID`; it is not part of the intent metadata or any S3 request.
- `GET /v1/attachments/upload-intents/:intent_id`
  - returns authoritative intent state and accepted multipart parts so an interrupted browser upload can resume without persisting presigned URLs.
- `POST /v1/attachments/upload-intents/:intent_id/parts`
  - validates and records a requested part and returns a refreshed short-lived presigned request for that exact part.
- `POST /v1/attachments/upload-intents/:intent_id/complete`
  - verifies S3 size/checksum state, atomically creates permanent attachment metadata and the node resource link, and idempotently returns the completed attachment.
- `DELETE /v1/attachments/upload-intents/:intent_id`
  - aborts an in-progress upload and schedules/removes any multipart or single-object residue.
- `GET /v1/resources/node/:node_id/attachments?company_id=...`
  - lists authorized node resource links with attachment metadata; the node workspace filters active `file_attachment` links for its explicit-file controls.
- `GET /v1/attachments/:attachment_id/content?company_id=...&variant=original`
  - performs an authorized read of the original S3-backed bytes used by the attachment-row download action.

### Error handling

All HTTP calls go through a shared `requestJSON` helper:

- Sets `Content-Type: application/json`.
- On non-2xx responses, surfaces backend `error` when available.
- Handles `204` with empty object return.

---

## 3) Canvas model and rendering

### Coordinate spaces

The module uses a virtual world and a viewport:

- **World size**: `WORLD_W = 6400`, `WORLD_H = 4400`
- **Viewport**: container inside widget (`minHeight: 560`)

Nodes are positioned in **world coordinates**, while pan/zoom transform the world into viewport screen space.

Node positions are no longer browser-only truth. The browser keeps only small
viewport/selection cache data in `localStorage`; canonical shared geometry lives
in `node_map_positions` and is exposed through `GET/PUT /v1/map-layout`. The UI
writes only changed positions after drag/resize activity settles, so position
writes scale with user action size instead of full company map size.

### Grid

- Fine grid step: `MINI_GRID = 12`
- Grid-snap applied to node movement and placement via `snapToGrid(...)`.
- The visual background uses a repeated SVG plus-sign tile, not one DOM node per cell.
- `adaptivePlusGridWorldStep(...)` coarsens the plus grid when zoomed out and adds detail when zoomed in so the canvas stays readable without creating millions of rendered grid elements.
- The larger plus-sign layer is offset onto the same horizontal/vertical axes as the smaller plus signs, so major marks reinforce the grid instead of sitting in the middle of four minor marks.

### Node card sizing

- `NODE_W = 148`
- `NODE_H = 96`

---

## 4) Interaction model

### 4.1 Panning

- Pointer down on blank canvas starts pan drag.
- Pointer move updates `pan` from drag delta.
- Pointer up ends panning.

### 4.2 Zooming

- Mouse wheel:
  - wheel up => zoom in
  - wheel down => zoom out
- Zoom clamped to `[0.45, 2.7]`.
- Zoom is cursor-centered (keeps world-under-cursor stable while zooming).

### 4.3 Node drag

- Dragging a node moves selected node(s).
- Positions are clamped to world bounds.
- Positions are snapped to grid.

### 4.4 Multi-select

- `Shift + drag` **or** `Ctrl + drag` on canvas creates a multi-select box.
- Nodes intersecting the box become selected.
- `Shift + click` **or** `Ctrl + click` on node cards toggles nodes in/out of the current selection set.
- `Shift + drag` over an existing multi-selection now adds newly boxed nodes/relationship lines into the current selection set (additive multi-select) instead of replacing the existing batch.
- Multi-select behavior is now **pointer-session locked**: once a multi-select drag starts in additive mode (`Shift`/`Ctrl` held at drag start), the session remains additive until pointer-up even if modifier keys are released mid-drag.
- Relationship-line multi-select inclusion uses the same pointer-session rectangle as node-card inclusion so mixed node+line selection is deterministic during long drag gestures.
- Visual indicators:
  - selected border/outline/glow,
  - selected dot marker on card,
  - “Group selected: N” badge for multi-select.
- Clicking blank canvas preserves a single selected node so linked Editors keep
  showing that node's content while the user pans. Clicking blank canvas after
  a multi-select batch clears the batch only when the gesture stays a click;
  click-dragging keeps the batch selected.
- Pointer-down on an already selected node batch keeps the full batch available
  for drag. If that gesture does not move past the click threshold, it clears
  the batch instead of dragging it.

### 4.5 Node title inline editing (seamless caret behavior)

- Node title editing in both **Node Map** and **Editor** is intentionally inline and seamless.
- Clicking a title should only reveal a text caret; it must not introduce a temporary bordered/background input box.
- Implementation rule: edit-mode typography must match read-mode typography so there is no visual compression/jump when entering edit mode.
- If a read-mode prefix is present (for example `Node:` in Editor), that prefix must remain visually stable during edit mode so users see zero title-line jitter.
- This keeps title edits aligned with latency-obsession UX guidance: minimal render churn and no distracting state-switch visuals on hot interaction paths.

---

## 5) Relationship creation rules

The primary selected node card shows **two controls per side**:

- `+` icon keeps the existing behavior: create a new linked node off that side.
- Arrow-line icon handles direct relationship creation between existing nodes.

- Top icon arrow points up.
- Right icon arrow points right.
- Bottom icon arrow points down.
- Left icon arrow points left.

Relationship creation uses a two-click attach flow between existing nodes:

1. Click a side handle on the source node.
2. A trace line is shown from source side to cursor.
   - The draft trace uses the same obstacle-aware orthogonal router as persisted relationship lines, so it follows mini-grid lanes and wraps around node cards while the cursor moves.
3. All node relationship-side icons switch into a **receive icon** state while drafting.
4. Click a side receive icon on the target node.
5. The module writes one relationship row.

Illegal relationship-side pairs are rejected before write:

- Source `left`/`right` (peer) can only attach to target `left`/`right` (peer).
- Source `top` can only attach to target `bottom`.
- Source `bottom` can only attach to target `top`.
- Illegal target sides are visually de-emphasized while drafting and do not write DB rows.

### Position mapping currently used when creating relationship records

Source node is always `node_id_a`, target node is always `node_id_b`.

#### Existing-node attach flow (arrow icon)

Role write semantics are source-side driven (same vertical contract as `+` creation):

- Source side `top` -> write `(a_position=Child, b_position=Parent)`.
- Source side `bottom` -> write `(a_position=Parent, b_position=Child)`.
- Source side `left` / `right` -> write `(a_position=Peer, b_position=Peer)`.

The target click side is still captured for anchor routing (`anchor.to`) but does not flip role semantics.

#### `+` linked-node creation flow (create a new node from one side)

For `+` creation, the target node is spawned on the opposite side, but vertical role writes are intentionally normalized so selected-node relationship coloring is correct for both nodes:

- Source side `top` -> write `(a_position=Child, b_position=Parent)` and anchor `(from=top, to=bottom)`.
- Source side `bottom` -> write `(a_position=Parent, b_position=Child)` and anchor `(from=bottom, to=top)`.
- Source side `left` -> write `(Peer, Peer)` with `(from=left, to=right)`.
- Source side `right` -> write `(Peer, Peer)` with `(from=right, to=left)`.

This replaces the old incorrect vertical swap behavior.

### Relationship deletion

- Relationship rows are removable from the details panel via **Snip**.
- Relationship lines can also be selected directly on canvas by clicking the line path (multi-select with `Shift`/`Ctrl` + click).
- Relationship lines are included in multi-select (`Shift`/`Ctrl` + drag) so line-only and mixed node+line group selection works with the same drag gesture family used for nodes.
- Relationship lines can be snipped directly on-canvas via line **double-click**.
- Keyboard `Delete` / `Backspace` deletes selected relationships.
- When a mixed selection includes both nodes and relationship lines, one delete confirmation now covers both so nodes are not left behind after line deletion.
- Right-clicking a relationship line opens a relationship context menu with **Delete relationship** (or plural delete when a selected line group is active).
- Deletes call `DELETE /v1/node-relationships/:node_relationship_id`.
- Relationship-line delete operations remove only relationship rows; connected nodes remain intact.
- Batch relationship deletion now routes the request de-dupe and partial-failure summary through `frontend/src/modules/node-map/nodeMapCommands.ts`, so the same command behavior can be tested or reused without rendering the Node Map canvas.

---

## 6) Relationship line rendering

Relationships are rendered on a world-space `<canvas>` for performance, with a lightweight SVG hit layer for direct relationship line selection.

### Anchor behavior

- A relationship remembers creation-side anchors when created in-session.
- If no remembered anchor exists, anchor side is inferred via a shared projection helper:
  - `(a=Child, b=Parent)` -> `top -> bottom`
  - `(a=Parent, b=Child)` -> `bottom -> top`
  - peer links fall back to geometry-based horizontal/vertical inference.
- Anchor and role inference now live in `frontend/src/modules/node-map/relationshipProjection.ts` to avoid duplicated/contradictory logic in render and write paths.

### Routing behavior

- Polyline routes are orthogonal and grid-snapped.
- Lines originate from side anchors that correspond to `+` side conventions.
- Routing now uses obstacle-aware orthogonal pathing on the mini-grid so relationship lines remain continuous and do not visually cut through node cards when nodes are moved.
- Draft relationship traces now use that same routing engine during pointer-move previews, preventing temporary straight-line previews that diverge from final saved path behavior.
- Connector paths are simplified after routing to keep turns clean while preserving continuous end-to-end segments.
- Optional relationship role coloring is on by default and can be toggled off.
  When active, lines connected to the active selected node (single-selection
  focus) are color-coded by the opposite-side role field in the row
  (`node_id_a` uses `b_position`, `node_id_b` uses `a_position`) so visual
  direction reflects the connected side relative to the selected node. When the
  toggle is off, relationship lines use only the map accent color even if nodes
  are selected.
- Visual rendering sits under node cards, and a transparent hit layer enables selection without degrading line draw performance.

---

## 6.1 Relationship projection helper (phase 1/2 hardening)

`relationshipProjection.ts` is now the single semantic source for:

- side -> role mapping,
- linked-node payload generation for `+`,
- existing-node attach payload generation,
- selected-node role resolution,
- anchor inference,
- projected visual relationship line metadata (`sourceNodeID`, `targetNodeID`, `sourceAnchor`, `targetAnchor`, `selectedRole`, `strokeColor`, `alpha`).

The projection object is **derived in memory** during render. It is not persisted to PostgreSQL and is not added to the workspace snapshot API payload.

---

## 7) Data loading strategy

- `loadNodes()` loads all nodes.
- `loadDetails(selectedNodeID)` loads details panel data for one selected node.
- `loadGraphRelationships(nodes)` reuses workspace snapshot relationship payloads filtered to currently loaded nodes.
- `NodeRelationshipGraph.ts` is an in-browser projection/cache helper. It applies committed mutation results locally and relies on canonical HTTP snapshot reloads; Node Map does not own a backend cross-user realtime stream.
- Relationship-create writes between existing nodes are executed through one internal helper path (`commitRelationshipBetweenNodes`) to avoid duplicate declaration/runtime drift in the canvas module.
- Folder scope is applied in memory from `folders` + `folder_items` in the workspace snapshot. When Company Explorer selects a node folder, Node Map renders nodes placed in that folder or descendant folders and only relationships whose endpoints are both visible.
- When Company Explorer selects an individual node inside a folder, Node Map keeps the folder scope active and selects that node instead of expanding back to the all-node graph.
- New nodes created while a folder scope is active are placed into that folder through `POST /v1/company-explorer/folder-items`, so UI-created nodes and agent-created nodes share the same API-backed placement model.
- Moving a node to a different Company Explorer folder level through `POST /v1/company-explorer/folder-items` removes relationships touching that node. Node Map prunes those relationship lines from the local graph cache immediately from the committed response and confirms later state through canonical HTTP reloads.

---

## 7.1 Tests for relationship semantics

### Files under test

- `frontend/src/modules/node-map/relationshipProjection.ts`

### Test file

- `frontend/src/modules/node-map/relationshipProjection.test.ts`

### Available tests in that file

1. maps side to relationship role for direct links
2. maps plus-link top/bottom to correct parent-child semantics
3. keeps peer semantics for plus-link left/right
4. uses source-side semantics for existing-node relationship writes
5. enforces illegal side-pair rules for existing-node relationship drafts
6. resolves selected role from the opposite-side position field
7. infers deterministic anchor for parent-child and child-parent rows
8. projects visual relationship line metadata without persistent storage

### How to run

From `frontend/`:

```bash
npm run test:node-relationships
```

What the command does:

1. Compiles only the node-relationship projection test targets with `tsc -p tsconfig.node-tests.json`.
2. Runs Node’s built-in test runner against the emitted JS test file in `.test-dist/`.

---

## 8) Local persistence (viewport only)

The module persists small viewport/selection state in `localStorage` keyed per company and frame scope:

- Key format: `node-map-state-v1:<companyID>:<frameId-or-global>`
- Stored fields:
  - `zoom`
  - `pan`
  - `selectedNodeID`

`nodePositions` may appear in old cached payloads for migration compatibility, but new writes keep that field empty. Shared geometry is stored through `GET/PUT /v1/map-layout`.

### Restore behavior

On mount:

- Attempt to restore saved state.
- Sanitize/clamp values.
- If no saved viewport exists, center the world once as fallback.

### Save behavior

Whenever restored state is active, writes latest `{ zoom, pan, selectedNodeID }` back to localStorage.

This keeps the viewport stable without letting browser storage become the layout source of truth.

---

## 9) Node Doc module (linked documentation surface)

`NodeDocContent` is a blank document-like canvas that creates movable text boxes and stores their contents as `Text box` records in `node_information`.

### 9.1 Linking model

- Node Doc/Editor linkage is resolved from the frame-link graph:
  - graph key: `frame-module-links-v1`
  - frame registry key: `frame-module-registry-v1`
  - resolution rule: traverse linked frames and select nearest frame whose kind resolves to Node Map (`nodes-map`/`nodes`).
- Linking is triggered from module context menu action:
  - `Link modules: <dynamic titles joined by " + ">`
- Linked modules show a **hexagon indicator** next to the module name chip in the frame header (both Node Map and Node Doc).
- Link action supports pairwise graph edges across linkable module kinds (map/editor/explorer/logic-map).

### 9.2 Module multi-select behavior (for linking)

- Widget/module selection is additive with `Shift + click` or `Ctrl + click`.
- Right-click on an already-selected module preserves the multi-selection.
- Selection capture runs in pointer capture phase to avoid nested module interactions dropping selection.

### 9.3 Selected-node sync

Once linked, Node Doc/Editor reads selected-node context from linked map state key:

- `node-map-state-v1:<companyID>:<linkedCanvasWidgetId>`

and reads `selectedNodeID`. That selected node becomes the active storage target for Node Doc.

Selection notifications are event-driven (`EVENT_NODE_MAP_SELECTION_UPDATED`) and only emit on selected-node changes (not on pan/zoom/drag geometry churn).
Linked Company Explorer frames consume those selection events and map-state updates so Explorer row highlight follows Node Map selection in the same linked workspace.
When an event payload already includes `selectedNodeID`, linked Company Explorer applies that payload directly. The debounced `node-map-state-v1:*` value is only a fallback for selection events without an entity payload, so stale storage cannot overwrite a fresh Explorer-driven map selection.
When Node Map emits a selection after applying Company Explorer context, it includes `sourceExplorerID`; the originating Explorer ignores that self-echo, while other linked explorers can still consume the event. Empty Explorer context clears Node Map folder scope and selection, which keeps parent/root folder selection from falling back to a previous child node.
Node Map also suppresses cached selection emission while a newer Explorer context is pending in storage. This prevents a remounted unified Map from broadcasting an old cached node before it applies the Explorer click that caused the mode/scope change.
When Company Explorer selects a node in a different folder, Node Map preserves that Explorer-selected ID while the active folder projection catches up. It only falls back to the first visible node when the selected ID is absent from the known graph snapshot, so a scoped render tick cannot turn an Explorer click into a stale map-originated selection event.
During startup, the async graph load uses the latest selected-node and folder-scope refs before choosing any restored/fallback selection. A first Explorer click after opening the Vite URL therefore wins over stale cached map state.

Layout safety note:
- Node graph cache delta reducers must preserve `node_map_positions`; only a deleted node should remove its own position.
- Bulk remount/folder-broadening placement uses the stable grid bootstrap, not the current viewport insertion point. The viewport insertion point is reserved for one newly created/missing node, so stale pan cannot pack a whole workspace into the top-left and persist it.
- Delete key and node context-menu delete both resolve from the full current selection. Right-clicking a selected node must not collapse the multi-selection before the menu opens.

### 9.4 Node Doc persistence behavior

- Load:
  - `GET /v1/nodes/:node_id/projection?company_id=...`
  - consume typed node projection rows for information values
  - merge with local/per-user layout coordinates for render placement
- Save:
  - `POST /v1/nodes/:node_id/information`
  - payload stores information text/value (no geometry in hot server path)
- UI states:
  - if not linked: prompt user to link modules
  - if linked but no selected node: prompt user to select a node in linked Node Map
  - if linked and node selected: show linked node title + information summary at top of Node Doc

---

## 10) Controls and panels in module UI

### Node Map main surface

- Canvas consumes almost all remaining widget height (bottom utility rows removed).
- World grid, relationship lines, node cards, side arrow actions, selection box, and group badge.
- Node cards are title-only on the canvas (inline node id/info/relationship counters removed).
- Node title is rendered large and centered to make the card label scannable at a glance.
- Node card size is user-adjustable from all sides and all corners (custom edge/corner resize hit-zones).
- Side action controls for creating linked nodes/relationships render as square buttons (not circular chips).
- Selecting a node on canvas no longer auto-triggers details fetches unless the details panel is open for that node (hot-path read suppression).
- In-canvas instruction text.
- Right-click context menu with `Create new node` at cursor location.
- Right-click context menu also includes `Enable relationship colors` with an explicit iOS-style on/off slider (knob left = off, knob right = on).
- Map notification badges, including group-selection count and relationship
  delete status/errors, are anchored to the bottom-left of the map viewport.
- Right-click menu rows use left-aligned text and box-style row containers.
- This menu uses the default **Boxy Hierarchical** list style.
- Relationship role color options (`Parent`, `Peer`, `Child`) are shown directly under `Enable relationship colors` as nested controls with stronger right indentation.
- Nested role rows use Boxy Hierarchical styling: child rows are indented and boxed under the parent relationship row.
- No triangle expand/collapse indicators or decorative connector lines are used in this right-click hierarchy presentation.
- Box rows are stacked flush with no vertical gaps between adjacent rows.
- Role color pickers (`Parent`, `Peer`, `Child`) use RGB hex color inputs.
- Canvas context menu placement is clamped within the viewport so all actions stay visible near canvas edges.
- Right-click on a node opens node actions (`Find on Company Explorer`,
  `Rename node`, `Delete node`). Find emits an entity-id request that Company
  Explorer handles by selecting the matching row(s), expanding all ancestor
  folders, and scrolling the primary row into view.
- `Rename node` enters inline title-edit mode on the card and persists through the generic node-title update call (`PUT /v1/nodes/{node_id}`), while updating node-map cache without forcing full snapshot refetch.
- Delete key support for selected node(s), guarded by themed confirmation modal.
- Node delete also removes Kanban card placements for that node and clears operation pointers while keeping operation history. This keeps headless `DELETE /v1/nodes/{node_id}` usable even when the item was previously placed on boards or used by agents.

### Node Map right overlay details panel

- Double-clicking a node opens a translucent “glass” panel anchored to the right side.
- Panel can be dragged and resized.
- Panel contains:
  - add information controls,
  - delete node action,
  - relationships list,
  - information list,
  - loading/error feedback.

---

### Node Doc surface

- Top-left module label (`Node Doc`).
- Blank document area with no extra dashboard chrome inside the module body.
- Typing creates a text box when none is active.
- Double-clicking in blank space creates a new empty text box.
- Text boxes are movable and resizable from all edges/corners.
- Text boxes persist position, size, and content to the selected linked node.

---

## 11) Mango default theme update

App-level `mango` is the default colorway. Teal remains available as a selectable legacy colorway.

Default Mango tokens:

- Font: `Helvetica Neue`
- Gradient left to right: `rgba(251, 177, 82, 1)`, `rgba(254, 169, 78, 1)`, `rgba(254, 155, 70, 1)`, `rgba(255, 136, 32, 1)`
- Accent fallback: `#ff8820`

White module surfaces should remain white while selection, scrollbars, chips, and default accents use Mango orange.

---

## 12) Known scope notes

- Node layout persistence is backend-persisted in `node_map_positions`; browser storage is viewport/selection cache only.
- Relationship anchor memory for side-origin is strongest for in-session-created links; fallback inference handles existing links.
- Graph relationship loading currently calls per-node details and deduplicates results in frontend.

---

## 13) File ownership (current implementation)

Primary implementation is in:

- `frontend/src/modules/node-map/NodeMapContent.tsx` (Node Map behavior)
- `frontend/src/modules/editor/EditorContent.tsx` (Node Doc behavior)
- `frontend/src/modules/editor/NodeWorkspaceSurface.tsx` (shared node text-box upload, scoped lists, and node-wide attachment aggregation)
- `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx` (attachment count/list controls and row actions)
- `frontend/src/modules/attachments/attachmentApi.ts` (typed upload/list metadata and authenticated original-file download)
- `frontend/src/modules/node-map/shared.ts` (shared node types/constants/helpers)
- `frontend/src/app/applayout.tsx` (frame/menu integration and link action wiring)


## 16) Explorer + Editor responsibility split (2026-04-28)

- **Company Explorer** is now navigation/context handoff focused (tree selection + linked-context broadcast), not a node-details surface.
- **Editor** is now the canonical module for node metadata + history context alongside text-box information editing.
- The old Company Explorer **Related Artifacts** placeholder section has been removed.

## 17) Attached email and chat parity update (2026-07-10)

- The node-attached email organizer hydrates complete provider threads and shows To, Cc, Bcc, Reply, Reply all, attachments, CID screenshots, image download/full-screen preview, and an explicit `Expand all threads` action.
- The node-wide attached-email dialog uses the available viewport; opening a reply focuses the shared rich editor while retaining the source message above it.
- Email-count and attachment-count rows expose a red `Remove from node` context action for editors. Attachment removal unlinks the node resource relationship rather than deleting the stored object.
- Node chat renders safe HTTP(S)/`www.` URLs as blue underlined links while preserving mentions and escaping arbitrary URI schemes.
- Calendar RSVP is available when the attached message can be resolved through the active mailbox grant. Shared-inbox provenance is not yet stored in attached-email projections and must be added before shared-node RSVP can be guaranteed.
