# Process Story: Changed editor history saves when the resource is left

A user edits a Node, Logic Gate, or Project textbox
↓
The existing current-textbox autosave continues saving the latest JSON to the matching permanent textbox table, while Mango marks only that open resource as changed for history
↓
The user closes the Node window or preview, switches resources, follows another Mango URL, uses browser Back or Forward, refreshes, navigates away, or closes the tab
↓
Mango first asks every mounted textbox for that resource to finish its current save and then calls the same history-snapshot path used by the manual history button
↓
One successful history batch clears that resource's changed marker, so nested unmounts and a simultaneous manual save do not create duplicate batches
↓
An unchanged resource creates no exit history; a failed exit attempt stays changed for a later retry, while refresh, external navigation, and tab close remain browser best effort

Last updated: 2026-08-06

# Process Story: typed arrow pairs become durable editor arrows

A user types `->` or `<-` in an ordinary text position in a Node, Project, or Logic Gate editor body
&darr;
The shared Tiptap input rule replaces the completed pair with one right arrow `U+2192` or one left arrow `U+2190`
&darr;
The caret continues immediately after that single arrow in the same paragraph, heading, list item, Checkbox item, or table cell
&darr;
The Unicode arrow remains unchanged in JSON saves, sleeping rendering, copy output, rich-HTML sanitization, history, recovery, and realtime snapshots
&darr;
Pasted or previously stored ASCII pairs are not silently rewritten, and code blocks retain literal input-rule behavior

Last updated: 2026-08-06

# Process Story: editor activation and table growth stay visually stable

A user clicks the exact place they want to type in a sleeping Node, Project, or Logic Gate editor
↓
The sleeping document remains painted while Mango attaches and focuses the matching live Tiptap document behind it
↓
Mango reveals the live document only after the caret is ready, without replacing an identical canonical document, blinking, changing scroll, saving, or creating an empty row
↓
Automatic Numbering uses lowercase alphabetic markers, while Checkbox Enter creates one unchecked Checkbox row with the caret beside its box and no intervening ordinary row
↓
A table starts at the size required by its equal cells instead of filling the editor width
↓
Right-clicking a cell opens the shared elevated menu above editor clipping, with grouped create actions and a red delete section
↓
Dragging the table's bottom-right handle previews whole equal rows and columns, then commits those additions once when the pointer is released
↓
Every committed text, Checkbox, or table change follows the existing revisioned JSON recovery, autosave, history, and realtime rules

Last updated: 2026-08-06

# Process Story: a copied editor image pastes outside Mango

A user clicks an attachment image in an active Node, Project, or Logic Gate editor and presses Copy
↓
Mango recognizes the Tiptap image node selection instead of exporting its private attachment element
↓
The synchronous copy event keeps Mango round-trip HTML and filename text while the system clipboard receives the authorized original image bytes plus portable data-image HTML
↓
The user can paste the image into another application that accepts image bytes or rich HTML
↓
Copying is read-only: it does not upload, duplicate, relink, save, or otherwise mutate the document or attachment relationship

# Process Story: The universal picker references or links a typed resource

A user types `#` at the caret in a Node, Logic Gate, or Project text box
↓
One elevated shared picker opens at the caret with its search field focused, type buttons for Nodes, Logic Gates, and Projects, and the user's complete Pinned tree when the query is blank
↓
The user may type a query, click a type button, or use N then Tab, L then Tab, or A then Tab to limit the search
↓
Reference mode inserts one durable typed entity chip without changing any business relationship
↓
Typing a second `#` in the picker selects link mode only where the source editor supports it: Node to Logic Gate or Project, and Logic Gate to Project; Project has no link mode
↓
The picker sends the chosen typed IDs to the existing permission-checked relationship command, then replaces the unchanged trigger with the same durable entity chip
↓
Deleting or unwrapping that chip edits only the text document and never removes the business relationship

Last updated: 2026-08-05

# Process Story: rich editor interactions work on the first action

A user opens a fresh Node, Project, or Logic Gate editor and clicks the exact place they want to type
↓
Mango finishes attaching the live Tiptap surface before it applies that pointer position, keeps the text-box scroll position, and shows the caret on the first click
↓
The selected Outline Style controls future Enter and Tab behavior: Automatic Numbering continues ordered rows, Bullet Points and Checkbox start on an empty row, and Indent Guides change only the current text row
↓
Nested numbering rotates through `1.`, `a.`, `1)`, and `a)`; bullets rotate through solid circle, hollow circle, solid square, and hollow square; Checkbox rows keep one checkbox symbol
↓
Vertical indentation lines paint only in Indent Guides mode
↓
An attachment image can be dragged from its visible frame, while a table has an elevated shared right-click menu and a bottom-right handle that grows equal rows and columns
↓
Every real document mutation follows the existing revisioned JSON recovery, autosave, history, and realtime rules


# Process Story: Editors preserve dormant change anchors without an unread feature

A user selects a Node or Logic Gate from Explorer, Home, Kanban, Project, or a direct route
↓
The generic live-selection and route contracts open the exact existing Editor document
↓
Persisted Tiptap `change` annotations load as dormant metadata and map through edits without painting, counting, navigating, activating, or calling a seen API
↓
The Editor preserves normal collaboration, attachments, emails, chats, permissions, title updates, and revision behavior
↓
Autosave, recovery, Manual Save, saving-user identity, History, and Restore retain the dormant ranges through the final current/history JSON tables
↓
The old Node unread-highlight UI, routes, caches, writers, baselines, and database storage do not exist

# Editor Process Map

## Process Story: Logic Gate editor uses final storage

A user opens the one document owned by a Logic Gate
↓
The projection-shaped load identifies the document from `logic_gate_textboxes` and decorates it with final email and attachment relationships
↓
The editor JSON save updates that exact final textbox row, while manual history uses `logic_gate_textboxes_history`
↓
Old information/projection writes are refused, and no Logic Gate chat feature or table is invented
↓
Delete, recycle, and later operator-controlled retirement use the final ownership rules

## Process Story: Node textbox JSON uses final storage

A user opens or edits a Node textbox
↓
The backend reads and writes the exact `node_textboxes` TipTap JSON row, including valid dormant `change` annotations
↓
Saved batches are stored in `node_textboxes_history`; no separate unread-change or viewer-baseline row is created
↓
An empty document remains valid TipTap JSON with one explicit empty paragraph; an exact bad conversion is repaired in current, history, seen, and recycle copies without changing its identity or revision
↓
The frontend keeps its stable projection-shaped `information_id`, assembled from final textbox, email, chat, and attachment rows
↓
The old Node information/projection writer is rejected; there is no fallback or dual write

## Process Story: Node textbox chats use their permanent table

A user opens a Node and reads, creates, replies to, edits, or deletes a textbox chat
↓
The backend uses `node_textbox_chats` as the current authority and rebuilds the existing frontend payload from its permanent columns and attachment relationships
↓
New writes do not create `Text block chat` rows in `node_projection_table` or `node_information`
↓
Deleting a textbox deletes every chat owned by that textbox, including a chat that selects or quotes an attached email, and removes the chat's attachment relationships
↓
The normalized email message, email thread, and email attachments remain because the textbox owns the chat but does not own the email
↓
The legacy Node chat source rows are retirement evidence only and are excluded from current reads; the migration-only source view is not recreated

## Process Story: compact JSON keeps the same editor document

A user types, formats text, inserts blank lines or hard breaks, or adds an attachment image in a Node, Project, or Logic Gate text box
↓
When the normal quiet-period or explicit save captures Tiptap JSON, Mango removes optional node and mark attributes whose values exactly equal defaults declared by the active ProseMirror schema. Required identity fields are never removed as defaults
↓
Stable block IDs, text, intentional empty paragraphs, hard breaks, custom formatting, links, attachment IDs, filenames, MIME types, intrinsic/display dimensions, alt/title text, and every nondefault layout value remain in the one captured document. A `mangoEntityLink` always retains its required entity type, ID, and label, including when the type is `node` and matches the frontend schema default
↓
The same compact object is written to IndexedDB recovery storage and sent in the normal revisioned request; Mango does not stringify or reparse it for compaction
↓
If that exact text box has a failed browser-recovery draft written by an older Mango version, Mango repairs repeated or missing block IDs and restores the legacy omitted Node entity type before retrying it
↓
Because the repaired JSON is different, Mango persists it under a fresh operation ID while retaining its original base revision for normal conflict checks. A valid cached operation is never rewritten, so lost acknowledgements still replay the exact original operation
↓
The backend applies the matching known-default compaction before current/history storage and compares compact and older expanded JSON as the same content during stale-edit merge
↓
When an active editor reopens the document, ProseMirror restores omitted defaults from its schema. When a sleeping editor paints the document directly, its renderer applies the same visible defaults
↓
Older verbose documents remain readable and compatible, while new reads and saves stop repeating null, zero, empty-string, left-alignment, break-position, and content-layout defaults

## Process Story: Logic Gate overview image paste keeps durable attachment identity

A user opens a Logic Gate overview and pastes an image
↓
Mango owns the paste, prepares the Logic Gate attachment resource, and uploads or links the image before inserting editor content
↓
When the selected text box has a real UUID information ID, Mango includes that ID so the attachment keeps its text-box provenance
↓
When an empty Logic Gate uses the special `logic-gate-overview` document alias, Mango omits that alias from UUID-only attachment metadata while retaining the Logic Gate resource type and ID
↓
The attachment API performs its normal resource edit authorization and creates the durable resource link
↓
Only a `mangoAttachmentImage` node with a non-empty attachment ID enters the JSON document; temporary `blob:` URLs, `data:` URLs, remote source URLs, signed URLs, and image bytes never persist

## Process Story: the editor has one permanent JSON storage path

A user opens or edits a Node, Project, or Logic Gate text box
↓
Mango always uses the TipTap JSON API and the current owner-specific textbox table; there is no workspace cutover flag and no HTML collaboration fallback
↓
Each current row stores the owner and textbox IDs, the complete `body_json` envelope, `revision`, display order where applicable, and lifecycle timestamps. Node text boxes do not duplicate the document into legacy JSON, plain-text, checksum, migration, actor, or idempotency columns
↓
Normal saves continue to write current history, operation, and realtime-outbox records. Information and projection tables remain available for their current read-model and compatibility responsibilities
↓
The retirement migration drops the 21 Node V2, editor-cutover, and HTML-collaboration tables with strict statements. If an expected object is missing, migration stops and exposes schema drift instead of silently skipping it
↓
A fresh database built from `schema.sql` never creates those retired tables


## Process Story: visible editors subscribe before their canonical refresh

A prepared Node, Project, or Logic Gate JSON text box enters the visible viewport
↓
Mango first opens the exact realtime scope for that document, then requests a fresh canonical snapshot
↓
If the near-viewport recovery is still running, the visible refresh waits for it and performs one trailing canonical read instead of treating the visible refresh as a duplicate
↓
An update committed between the earlier snapshot request and the realtime subscription is therefore recovered by the trailing read
↓
Repeated overlapping recovery callers still share their active request; only the explicit visible refresh guarantees the one post-subscription read

## Process Story: one unique identity for every editor block

You open a Node, Project, or Logic Gate document
↓
Before the JSON enters Tiptap, Mango walks the document once. The first occurrence of every existing block ID stays unchanged; a missing ID or a later duplicate receives a fresh ID. Opening alone does not save or create a revision
↓
You press Enter in a list, paste structured content, nest a list item, or perform another structural edit
↓
ProseMirror may copy the source node's attributes while it creates the new block
↓
The block-identity plugin tracks ID counts and inspects only the ranges changed by the transaction. The original block keeps its ID and every new copy receives a fresh ID
↓
Within one editor document, each paragraph, heading, quote, code block, divider, list, list item, task list, task item, and table has one non-empty block ID that no other block in that document uses. IDs do not need to be globally unique across unrelated documents
↓
When the document is next saved, the repaired IDs are included in the normal full JSON snapshot
↓
The Go API continues to read older snapshots that contain duplicate IDs so those documents can open and repair safely, but it rejects a new commit if any supported block ID is repeated
↓
Block navigation, comments, chats, and future collaboration code can resolve a block ID to exactly one block


## Process Story: stable typing with comments, chats, and dormant change anchors

You type one character in an active Node, Project, or Logic Gate JSON editor
↓
ProseMirror applies one real document transaction and immediately paints the character
↓
The annotation plugin maps existing comment, chat, email-selection, and dormant change positions through that document transaction; dormant changes create no decoration, and an owner-provided list cannot erase them merely by omitting them
↓
If the parent supplies a new annotation array whose meaningful values are identical, Mango compares its contents with the mapped annotation contents and stops. It creates no annotation replacement transaction
↓
If an annotation ID, kind, range, active state, or durability really changed, Mango dispatches exactly one replacement transaction and redraws those decorations
↓
Annotation-only transactions do not recalculate or republish font, highlight, alignment, bold, underline, italic, or strikethrough toolbar state
↓
Document transactions update toolbar state when the document changed without a separate selection event; stored-mark transactions update it when caret formatting changed; selection changes use Tiptap's selection callback
↓
If the published inline-format values equal the React parent's current values, the parent keeps the same state object and does not schedule another render
↓
Node chat-message arrays are grouped and, where legacy email chat must be merged into a text-box row, sorted once in a memoized map. An unrelated toolbar render reuses the same per-row message arrays
↓
The normal 500-millisecond quiet save and 10-second maximum save continue independently. Saving, IndexedDB recovery, backend versions, operations, and realtime outbox work are not part of this render/annotation loop

## Opt-in dev editor tracing

Open the exact Node, Project, or Logic Gate editor on the dev site with `editorTrace=1` in the URL query string. Use `?editorTrace=1` when it is the first query value or `&editorTrace=1` when the URL already has a query
↓
A fixed panel appears at the top-right and says **Editor trace recording**. If the panel does not appear, tracing is not active
↓
Type normally until the freeze happens. Leave the recorder running through the freeze and the burst of delayed characters
↓
While enabled, Mango records high-resolution timestamps for browser keyboard/input events, ProseMirror transactions, important ProseMirror plugins, Tiptap callbacks, selection/toolbar calculation, React editor commits, lifecycle pinning, the 500-millisecond and 10-second timers, JSON snapshot creation, IndexedDB recovery work, request JSON serialization, fetch/response parsing, long tasks, long animation frames, and delayed animation frames
↓
The trace records counts, sizes, states, durations, and function names. It does **not** record document text, pasted text, request or response bodies, authorization tokens, operation IDs, company IDs, resource IDs, or URL query values
↓
Immediately after reproducing the freeze, click **Stop & download**. Chrome downloads one file named `mango-editor-trace-<timestamp>.json`
↓
Attach that JSON file to the Codex task. The raw ordered events allow the freeze window to be matched to the exact main-thread function, timer, IndexedDB operation, network phase, React commit, long task, or frame gap
↓
Use **Start new** only when you want to discard the current in-memory recording and begin a clean reproduction

Tracing is completely dormant unless `editorTrace=1` is present, and it is accepted only on localhost, `dev.mangorts.com`, or a subdomain of `dev.mangorts.com`. The recorder keeps at most 250,000 events in memory and reports any dropped-event count in the export.

## Normal typing and saving

You type
↓
ProseMirror immediately updates its structured document tree in memory and paints the visible text
↓
The first unsaved document change makes Mango mark that text box Dirty, pin its row so virtualization cannot destroy it, and start two timers: a 500-millisecond quiet timer and a separate 10-second maximum timer
    1. Every later document change restarts the 500-millisecond quiet timer, but the 10-second maximum timer keeps counting from the first unsaved change
    2. Saving begins when typing has been quiet for 500 milliseconds, the 10-second maximum is reached, or Mango must save immediately because focus leaves the  editor or the editor is closing
↓
Tiptap's getJSON() translates the current ProseMirror tree—including text, formatting, lists, tables, images, and other supported content—into a plain JavaScript JSON object
↓
Mango wraps that JSON object in a local recovery record. The record identifies the exact document, numbers the local change, says which server revision it started from, gives the save a unique operation ID for safe retries, and includes saved annotation positions
↓
Mango stores the complete recovery record in browser IndexedDB. IndexedDB keeps one latest-unsaved record for each document, so storing a newer record for the same document replaces its older recovery record
↓
Mango builds an HTTP save request from that record, and JSON.stringify changes the JavaScript request object into JSON text
↓
Chrome sends that JSON text in an HTTPS POST from the browser to Mango's Go API in AWS
↓
The Go API authenticates the user, checks edit permission, parses the JSON text into Go request data, and validates the document, operation ID, and server revision on which the edit was based
↓
The Go API sends the document JSON to PostgreSQL in one transaction. PostgreSQL then parses it as JSONB, updates the current-document table with the newest full document and revision, adds a version-history row, adds an operation row for safe retry detection, and adds a realtime-outbox row for delivery to other browsers
↓
All four database writes succeed together, or PostgreSQL rolls all four back together
↓
After the transaction succeeds, the Go API wakes the realtime sender and sends an HTTP 200 response from AWS back to the same browser. That response contains the operation ID, the new server revision, and the commit time
↓
The browser verifies that the response belongs to the same save, then asks whether that save's local change number is still the newest local change
↓
If no newer typing exists, Mango deletes only that save's matching IndexedDB recovery record, marks the document Saved, and unpins its row
↓
If newer typing exists, Mango does not clear the recovery storage, keeps the document Dirty and pinned, bases the next save on the newly confirmed server revision, and repeats the save flow

## Failure and other-browser behavior

A failed or unacknowledged save keeps the IndexedDB recovery record and retries with the same operation ID. If PostgreSQL already committed the first request but its response was lost, the operation table recognizes the retry and returns the original result instead of creating another version
↓
After a successful commit, the realtime sender reads the outbox row and sends other browsers a small WebSocket notice containing the document identity and new revision, not the complete document
↓
Another browser downloads the newest complete JSON document only when it has no unsaved local work. If it does have unsaved work, the notice does not overwrite that work; a later revision mismatch uses Mango's existing conflict flow

Last updated: 2026-08-02

# Unified Editor Tests

Coverage Status:
- The active Node, Project, and Logic Gate Tiptap JSON path is covered by `mangoTiptapFoundation.test.ts`, `mangoTiptapRichClipboard.test.ts`, `mangoTiptapEditorIntegration.test.tsx`, `editorRowVirtualizationReact.test.tsx`, backend editor JSON store/HTTP tests, and the normal full-repository verification gate. These suites cover the bare-bones save batch, exact latest-record recovery, generation-safe acknowledgements, stable-operation retry, unusual cosmetic formatting, durable image import, mixed rich paste, edits made while images import, permanent page-session failure attention, annotation mapping, sleeping rows, revision conflicts, and compact save acknowledgements.
- The opt-in dev trace is covered by `editorTrace.test.ts`, `requestJSON.test.ts`, and `mangoTiptapFoundation.test.ts`; they verify raw event ordering, span completion, content exclusion, default-off behavior, request-boundary timing, quiet-timer behavior, IndexedDB work, save acknowledgement, and downloadable-export data integrity.
- The July 31 annotation/React feedback-loop regression is covered by `mangoTiptapFoundation.test.ts`, `mangoTiptapEditorIntegration.test.tsx`, and `editorOpenPerformanceContract.test.ts`. The tests prove that a new but content-identical annotation array dispatches zero ProseMirror transactions, a real annotation change dispatches exactly once, one forced parent rerender settles within two editor commits, annotation-only work does not republish toolbar state, caret formatting still updates immediately, and Node row message arrays remain stable outside real message changes.
- People-picker profile palette stability, fallback-key behavior, and minimum contrast are covered by `tests/frontend/modules/editor/editorMentions.test.ts`.
- The August 2 Project compaction and Logic Gate image-paste regressions are covered by `mangoTiptapFoundation.test.ts`, `postgres_editor_textboxes_test.go`, and `mangoTiptapRichClipboard.test.ts`; they prove repeated legacy block IDs are repaired, required Node entity-link identity survives both frontend and backend compaction, stale per-textbox browser recovery is upgraded under a fresh operation without changing valid lost-ack operations, and the special Logic Gate overview alias is omitted from UUID-only attachment metadata while real UUID text-box identity remains.
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial overall. `editorExitHistory.test.ts` covers unchanged exits, one changed snapshot, manual/exit in-flight deduplication, failure retry, unmount triggering, pagehide behavior, and exact resource-wide textbox flushing. `editorTextboxSync.test.ts`, `realtimeWebSocket.test.ts`, backend sync/store/HTTP/cross-instance tests, and `unifiedRichEditorContract.test.ts` cover bounded HTML patches, deterministic disjoint-edit convergence, durable pending storage/recovery, exact subscription recovery/health, metadata isolation, and mounted Node/Logic Gate/Project adapters. `editorRowVirtualization.test.ts` covers window arithmetic, monotonic window movement, bottom reachability, fast-jump bounds, spacer geometry, and stable spacer identities across successive and pinned-row windows; `editorRowVirtualizationReact.test.tsx` renders the real Node and Project hosts to cover loaded-empty then late/incremental projections, zero-email and attached-email Node defaults, manual pane closure retention, correct editor/chat association, monotonic scrolling to the last row, handled target non-replay, mounted-row bounds, edited-row sync flush, unmount/remount preservation, exact single-message linked-email Show/Hide behavior, text-box-header navigation back to the exact message in the left thread column, rich-email chat-selection highlights, and unchanged Project defaults. `editorTextBlockChatNavigation.test.tsx` covers one explicit chat-to-source request scrolling exactly once, duplicate rerenders preserving the user's later scroll position, and a later request ID allowing one new navigation. `unifiedRichEditorContract.test.ts` records the matching parent-consumption and legacy/JSON acknowledgement wiring. Rich-editor DOM suites cover toolbar, bounded attachment hydration, formatting, and host behavior. The dedicated production-path realtime runner and browser-driven workflow coverage were removed from CI on 2026-07-28. Focused frontend, backend, and infrastructure suites remain; visible multi-user editor workflows require manual acceptance until replacement automation is added.
- ED88 selected-text chat cancellation is covered by unifiedRichEditorContract.test.ts, including both the quote X and whole-chat close paths.

## Business Logic

### 2026-08-06 Bidirectional Smart Arrows

- In an editable Node, Project, or Logic Gate Tiptap body, completing the typed pair `->` inserts one durable Unicode right arrow `U+2192`, and completing `<-` inserts one durable Unicode left arrow `U+2190`.
- The rule is owned by the shared Tiptap extension set and therefore applies in ordinary paragraphs, headings, list items, Checkbox items, and table cells across all three resource editors. Code blocks retain literal typing because editor input rules do not rewrite code.
- Conversion occurs only as the user completes a pair. Loading, pasting, canonical refresh, and sleeping rendering do not scan or rewrite existing ASCII text.
- Unicode arrows are document text. JSON persistence, history, recovery, realtime refresh, HTML sanitization, and rich clipboard output must preserve them instead of converting them back to ASCII pairs.

### 2026-08-06 Stable Activation, Checkbox, And Table Growth

- The sleeping JSON renderer remains visible until the attached live Tiptap DOM has accepted the requested pointer caret and focus. Activation preserves editor scroll and selection, performs no document mutation or save, and never creates an empty block. A canonical refresh whose parsed ProseMirror document equals the live document updates revision authority without dispatching `setContent`.
- Automatic Numbering uses the repeating four-depth cycle `1.`, `a.`, `1)`, `a)`. Alphabetic markers are lowercase at every repeated alphabetic depth.
- The user-facing outline option is **Checkbox**. On an empty ordinary row, Enter converts that row to one unchecked Checkbox row and leaves the caret in its text area. On a nonempty ordinary row, the split and Checkbox conversion are one document transaction with no plain empty row between the surrounding content and the Checkbox row. Enter inside a Checkbox row creates the next adjacent unchecked Checkbox row, and Tab/Shift+Tab nest or unnest only that row without changing the checkbox symbol.
- The active and sleeping Checkbox DOM structures must have matching label, input, and content wrappers so activating an editor cannot change row geometry.
- A table occupies only the intrinsic width of its equal 112-pixel columns and equal 36-pixel rows. It does not expand to the full editor width merely because space is available.
- The table-cell context menu uses the shared elevated right-click surface, is portaled to viewport coordinates outside editor overflow clipping, and follows the shared grouped pattern: column actions, a separator, row actions, a separator, then red delete actions at the bottom.
- Selecting a table exposes one bottom-right growth handle. Pointer movement previews only whole nonnegative row and column additions using the table's equal cell geometry. Pointer cancel makes no change; pointer release commits all previewed additions in one ProseMirror transaction and clears stored column widths so every resulting column remains equal.
- Table menu and growth mutations use the normal revisioned document save path. Neither interaction creates a separate table persistence path.

### 2026-08-06 Portable Tiptap Image Copy

- Copying a selected attachment image in the active Tiptap editor must not leave the clipboard with only the private `mango-attachment-image` serialization, because external applications cannot render that element.
- The copy event writes an immediate Mango HTML/text fallback and starts the standards-based system clipboard write during the same user action. The system item reloads the authorized original attachment bytes, exposes the supported image MIME when the browser permits it, embeds those bytes as a data image in `text/html`, and uses the filename for `text/plain`.
- Image copy is read-only. It never creates an attachment, changes attachment ownership or relationships, duplicates the editor node, changes the document revision, or schedules a save.

### 2026-08-05 Tiptap Interaction Semantics

- First pointer activation keeps the sleeping renderer painted while the live Tiptap surface attaches, resolves the pointer position, and accepts focus. The first click places the caret, keeps the exact text-box scroll offset, performs no document mutation, and does not require a second click.
- The outline preference is shared with the active Node, Project, and Logic Gate JSON editor. Changing it controls future input and does not rewrite existing rows.
- Tab and Shift+Tab on an ordinary Tiptap paragraph or heading change only the block containing the caret by one bounded `indentLevel`; they do not insert a tab character, replace a selected range, or change neighboring rows. Structural list Tab/Shift+Tab uses normal one-item nesting/outdent behavior and remains inside table cells.
- Enter on an empty ordinary row starts the selected Automatic Numbering, Bullet Points, or Checkbox structure. In Bullet Points or Checkbox mode, Enter in a nonempty ordinary row splits at the caret and changes only the new row into the selected list in one transaction. Enter in an existing list keeps that list's normal continue/exit behavior.
- Active JSON ordered-list markers rotate by nesting depth as `1.`, `a.`, `1)`, `a)`, then repeat. Bullet markers rotate solid circle, hollow circle, solid square, hollow square, then repeat. Nested Checkbox items retain the checkbox marker.
- Thin nested-list and block-indent guide lines are conditional presentation. They paint only when the current outline preference is Indent Guides and never leak into Automatic Numbering, Bullet Points, or Checkbox mode.
- The visible attachment-image frame is a real Tiptap drag handle. Dragging it moves the existing durable image node; it does not upload, duplicate, or change attachment ownership.
- Right-clicking an active table cell selects that cell and opens the shared elevated table menu for row/column creation and deletion plus table deletion. Dragging the selected table's bottom-right handle previews and commits equal rows and columns. These commands mutate the same Tiptap document and use normal recovery/autosave/revision handling.

### 2026-08-02 Project Entity Links And Logic Gate Image Paste

- Block IDs, mention user identity, entity-link type/ID/label, and image attachment IDs are required durable identity, not cosmetic defaults. Frontend and backend compaction may remove optional defaults, but they must never remove these required fields. In particular, `mangoEntityLink.entityType` remains explicit when it is `node`, even though the active editor schema uses `node` as its read-time default.
- Attachment `information_id` is UUID-only. A real Node or Logic Gate text-box UUID remains on its attachment link for provenance, but special editor document aliases such as `logic-gate-overview` must be omitted rather than sent to the upload API.
- A browser recovery record is exact pending user work, but known server-invalid JSON created by Mango's former compactor must be upgraded before retry. Repair restores only the former omitted `node` entity type and block identity, persists the repaired draft under a fresh operation ID with its original base revision, and leaves already-valid records byte-for-byte and operation-for-operation stable.
- A repaired recovery record remains subject to normal backend validation; recovery repair does not weaken entity, image, link, annotation, or transient-URL security rules.
- Omitting a non-UUID document alias does not weaken access or image validation. The upload remains scoped and authorized by company, resource type, and resource ID, and durable editor JSON still requires a non-empty attachment ID and rejects transient or unsafe URLs.

### 2026-07-30 Async Tiptap Paste Target Guard

- Potential future bug: a user starts a slow image paste in document A and switches the same panel to document B before the upload finishes. If a future host reuses the same live Tiptap editor instance for both document IDs, the completed paste could be inserted into document B unless completion verifies the original document identity.
- This is not a current known bug. Every active Node, Project, and Logic Gate host keys `MangoTiptapEditor` with its company/resource/document identity, so switching targets destroys document A's editor. The pending rich-paste callback checks `editor.isDestroyed` and refuses the stale insertion.
- Future Codex changes must preserve that document-keyed remount behavior or add an explicit company/resource/document identity check before an asynchronous paste or upload inserts content. Do not rely on a reusable editor instance without one of those guards.

### 2026-07-10 Node Text-Box Lifecycle Boundary

- The unified node editor owns text-box editing and projection deletion, but deleting a text box must not cascade into node file resource links or attached-email projections. Attachment and email retention is a node-domain rule, not rich-editor document ownership.
- Origin metadata may continue to identify the deleted text-box ID for provenance. Unified editor adapters must tolerate that missing live block without recreating a block, moving the association into another block, or dropping it from node-level lists.
- Node-level attachment preview and the global attached-email organizer modal are outside the editable collaboration document. Opening or closing them must not mutate editor content, steal a durable selection target, create an editor operation, or mark a text box pending.
- The standalone global attached-email organizer, including its folders/list and selected conversation, must work with zero text boxes and in edit-authorized node windows. Per-text-box conversation panes remain unchanged for surviving text boxes.
- Attachment-row activation previews supported content in app; the row's explicit download action remains a separate command. Preview cleanup must release transient requests/object URLs when the overlay closes or switches files.

Required regression scenario:
- Delete a text box that originated files and attached emails while projection saving is active, then reopen the node through more than one unified node-shell opener.
- Confirm the text-box projection stays deleted, no replacement block is created, retained associations remain in the node-level lists, previews and the standalone global email organizer do not dirty editor state, and a no-access actor cannot use either viewer.

ED1 - Unified editor means shared user-facing editing semantics across rich editor surfaces; it does not require one shared backend table, API route, save controller, or storage owner.
ED2 - The unified editor contract applies to Logic Gate editor text, node editor text boxes wherever a node editor is opened, project text boxes, project inline critical-path node windows, My Triage compose/reply, Shared Triage compose/reply, attached-email reply bodies that send or draft real mail, and mailbox-scoped personal/shared email signature editing.
ED3 - Node, Logic Gate, and Project shared rich-text bodies persist through one collaboration operation/snapshot protocol while retaining exact resource/document ownership; title and attachment metadata remain resource-owned. Personal/shared mail compose, replies, email-collaboration drafts, and signatures retain their existing mailbox/draft persistence boundaries and are not silently made offline-capable.
ED4 - Editing semantics for Enter, Backspace, Delete, Tab, Shift+Tab, indent/outdent, copy, cut, paste, paste cleanup, source-font normalization, linkification, undo/redo routing, selection preservation, keyboard shortcut routing, and formatting-command routing must come from the shared editor behavior/controller sources used by every target surface.
ED5 - Rich controls for numbered/alphanumerical lists, bullet lists, checklist, indent guides, font size, bold, underline, italic, strikethrough, text highlight color, left/center/right alignment, hyperlink creation, and table insertion where supported must not be reimplemented per surface with divergent semantics.
ED6 - Pasted rich text in any unified editor surface must normalize to the app/editor font family and must not add extra blank rows around selected inline pasted text because of source boundary whitespace.
ED7 - Legacy plain text loaded into a unified rich editor surface must load through safe escaping/linkification and must not bypass the same sanitization boundary used for rich HTML.
ED8 - Email compose/reply bodies using the unified editor must send sanitized rich HTML and preserve sanitized block indentation, including indent/outdent and blockquote-style indentation.
ED9 - Chat panes inside node/project text boxes are conversation UI, not unified editor surfaces; chat textareas must not inherit rich editor toolbar, indentation, paste, or delete semantics unless a future chat-specific rule explicitly adds that behavior. They share the rich-editor people suggestion component and accepted @mentions/!urgent mentions remain principal entities while rendering as visible normal/urgent chips in the composer and sent message.
ED10 - Node/project email pickers are attach/select surfaces only and must not expose compose, send, scheduled send, or draft-save behavior.
ED11 - Node Map and Logic Gate Map are retired product features. No editor surface, title editor, route, frame, or compatibility helper may depend on either retired Map.
ED12 - Any future change to unified editor semantics must update one shared behavior or formatting-controller test plus adapter/mount coverage proving each target surface receives the shared behavior.
ED13 - The shared rich editor behavior source is `useEditorDocumentSurfaceHandlers`; the shared formatting-command source is `useEditorDocumentFormattingController`; and `EditorDocumentSurface` is the only reusable rich `contentEditable` host. Target adapters may preserve their own persistence/send callbacks, but must not render another rich editable DOM host or reimplement a local formatting controller.
ED14 - Mail compose/reply, attached-email reply, and email signature editing must expose the shared editor format/outline toolbar controls for font size, bold, underline, italic, strikethrough, highlight color, left/center/right alignment, the outline-style dropdown, and table insertion where supported. Wrapper-specific controls may add commands, but must call the shared formatting controller instead of local DOM commands.
ED15 - Nodes opened from Projects participate in the same unified editor contract in both project entry paths: the Critical Path inline node window and the Logic Gates / Nodes click-to-expand inline editor. The node text boxes in both paths use the shared node editor behavior rather than a project-local implementation.
ED16 - The Logic Gate editor text body is a unified editor surface.
ED17 - Node editor text boxes are unified editor surfaces wherever a full node editor is opened, including Home, My Work, Updates, Kanban, Company Explorer/sidebar, minimized dock restore, Project critical-path inline node windows, and Project Logic Gates / Nodes inline node editors.
ED18 - Project text boxes and project information editors are unified editor surfaces.
ED19 - My Triage email compose and reply bodies are unified editor surfaces.
ED20 - Shared Triage email compose and reply bodies are unified editor surfaces.
ED21 - Attached-email reply bodies opened from an email attached to a node or project are unified editor surfaces when that reply sends or drafts real mail. Node replies use their attached-email resource context; project replies use the project resource plus the originating project text-block information ID, so file and inline-image tools remain durable on both hosts.
ED22 - The shared `ChatPane` used by node, project, My Triage, Shared Triage, and email-collaboration chat is explicitly not a unified editor surface; it is conversation UI with chat-specific behavior, including Tab acceptance of the highlighted people suggestion and visible composer entity chips. A painted accepted mention must use the same text metrics and inline advance as the transparent textarea that owns input, so its native collapsed caret remains immediately after the accepted token and later typing paints at the caret instead of appearing in a different position.
ED23 - Node and project email pickers are explicitly not compose editor surfaces; they may search, filter, scroll, drag, and attach existing email, but they must not contain compose, send, scheduled send, draft-save, or rich body editing behavior.
ED24 - Shared editor helpers live under surviving editor, Node, Logic Gate, relationship, or generic event modules; no shared editor behavior may be restored under a retired Map module.
ED25 - Shared editing behavior does not collapse all product domains into one table: Node, Logic Gate, and Project document identities remain distinct, while mail compose/draft/signature storage remains mailbox-owned. The shared collaboration engine, outbox spine, socket, health, and recovery protocol are reused only by the approved collaborative document surfaces.
ED26 - Rich-editor pasted or dropped inline images in unified editor surfaces must follow the global attachment contract in `docs/tests/attachments.md`: temporary previews are allowed, durable editor/email content stores attachment references instead of data URLs or base64 bytes, copying an existing attachment-backed image links that attachment to the target editor resource before insertion, and email adapters convert those references to CID attachments only at the backend send boundary. An asynchronous image upload/link may commit only while the original editor root, document target, and attachment resource context remain current; a target switch or unmount must not mutate the next document. In the active Tiptap JSON editor, a saved insertion bookmark is mapped through intervening ProseMirror transactions so ordinary typing while image imports are running does not cancel or discard the paste.
ED27 - Chat attachments remain outside the unified rich-editor contract; they must use the global attachment contract as chat attachments rather than inheriting rich-editor body semantics.
ED28 - Project text boxes must expose the same shared format and outline toolbar controls as node text boxes, including font-size controls, bold, underline, italic, strikethrough, highlight, left/center/right alignment, table insertion, automatic numbering, bullets, Checkbox, and outline-style selection; project-specific toolbar toggles must call the shared editor controller instead of defining separate semantics.
ED29 - The unified rich-editor toolbar source is `EditorTabBar`. Every unified rich editor surface must use the same font-size minus/value/plus, Bold, Underline, Italic, Strikethrough, Highlight, left/center/right alignment, table where supported, and outline-style controls instead of reimplementing a look-alike toolbar. Hover, focus, selected, and active styling belongs to the individual clickable hitbox, never the containing format group; hover uses a luminous cyan/light-blue-to-lavender wash with a crisp cyan edge, while active/selected uses the stronger saturated cyan-to-violet fill, persistent cyan ring, soft two-color glow, and dark high-contrast icon/text after the pointer leaves. Keyboard focus keeps a distinct cyan/violet indicator and disabled controls remain visibly subdued. Strikethrough renders as a crossed-out letter A and, like every control, retains a clear accessible name and tooltip, pressed state where applicable, and keyboard focus indicator.
ED30 - The shared outline-style dropdown inventory is Automatic Numbering, Indent Guides, Bullet Points, and Checkbox. The compact toolbar inventory used by project text boxes, mail compose/reply, attached-email reply, and email signature editing must come from one shared toolbar tab list so adding, removing, renaming, or restyling those controls changes every compact editor surface together.
ED31 - Font-size toolbar actions must route through the shared editor formatting controller/helper for every unified rich editor surface, including Logic Gate editor text, node text boxes, project text boxes, My Triage/Shared Triage compose and reply bodies, attached-email reply bodies, and mailbox-scoped email signatures. A surface must not keep a local font-size span mutation path behind the shared toolbar.
ED32 - The shared formatting controller must restore the last valid editor range before toolbar actions that can move browser focus. Font size and highlight apply immediately to a restored selected range; at a collapsed caret they become visible pending typing styles, including composition/IME text, so the next typed characters use the chosen size/color. Repeated font-size minus/plus clicks preserve and update both the same selected range and the same collapsed-caret pending size; selected text increases on every click, the caret/typing height reflects the chosen size when editor focus returns, and subsequent typing keeps the chosen size until a later user command or legitimate caret-context change replaces it. The literal numeric font-size value is the compact 9px readout between the shared minus/plus controls. **No highlight** clears selected highlighting or records an unhighlighted pending typing style at a collapsed caret. Bold, Underline, Italic, and Strikethrough state must reflect the active or pending command state so activating the same control again removes the format; Italic and Strikethrough selected from a collapsed caret remain pending across toolbar focus and apply to subsequent typing. Enter in the numeric font-size input commits once, while Escape cancels the draft, keeps keyboard focus in the control, and must not let the following blur commit it. Escape from a shared popover consumes the event, closes only that popover, and restores focus to its trigger without closing the surrounding node/editor window; passive format-state reads may restore the saved range but must not force focus out of the toolbar or discard pending marks.
ED33 - An image-only rich email body containing a durable Mango attachment image counts as sendable content. The frontend must preserve the reference without raw bytes, and the backend email adapter must authorize/resolve it and produce provider-ready CID HTML plus an inline attachment.
ED34 - Normal browser attachment file bodies bypass Mango API and editor persistence: the editor requests an authorized upload intent with JSON metadata, incrementally hashes with bounded memory, and sends raw File/Blob bytes to private S3 through the exact presigned request. Server-originated email/import/migration/job uploads retain their separate streaming path.
ED35 - Node attachment progress is transient node-level UI outside the rich document. It exposes per-file byte progress, preparing/uploading/retrying/completing/complete/canceled/failed states, cancel, and retry without blocking edits or creating collaboration operations; pending/failed/canceled items do not enter normal attachment counts.
ED36 - Deleting the origin text box does not cancel node ownership, delete a completed attachment/attached email, or recreate the projection. An active upload can remain in node-level progress and finalize to the node only when the node exists and current edit permission still passes.

ED37 - The personal-account and shared-inbox email signature editor is a mailbox-scoped unified rich editor surface. It must use `UnifiedRichEditorSurface` plus `EditorTabBar`, store the exact flushed sanitized editor HTML, reject embedded inline file bytes at the durable API boundary, and keep its existing mailbox signature persistence boundary; a native signature `<textarea>` is not an allowed implementation. An in-flight remote load must not overwrite a newer local edit, an existing remote row is authoritative even when its body is empty, and success UI is shown only after the remote save resolves. A failed remote save keeps an exact mailbox-scoped pending-sync body, retries it before accepting an older remote row, and clears that marker only after the same body is saved successfully. Remote loads and legacy backfills are serialized with user saves, focused external hydration preserves the live selection, and each mailbox signature/draft/reply target remounts with isolated selection and undo state.
ED38 - `EditorDocumentSurface` is the sole rich editable DOM component for Logic Gate, node, project, triage compose/reply, attached-email reply, and signature surfaces. `EditorContent`, `NodeTextBlockEditor`, `UnifiedRichEditorSurface`, and domain wrappers configure or mount it, but do not render their own `contentEditable` element.
ED39 - `useEditorDocumentFormattingController` is the sole controller for font size, bold, underline, italic, strikethrough, highlight color, left/center/right alignment, list/indent commands, links, tables, selection restoration, format-state reads, and pending-caret formatting. Logic Gate, node/project, and mail/signature hosts must all use that hook rather than constructing controller objects locally.
ED40 - Text highlighting uses one shared `EditorTabBar` split control and one `applyEditorHighlightColorToRoot` command. Its left/main hitbox displays and applies/toggles the currently selected color to the restored selection or collapsed-caret pending style without opening the picker; its adjacent right/arrow hitbox opens the color picker without applying a color. The two independently keyboard-accessible hitboxes read visually as one compact control and keep distinct tooltips, ARIA labels, focus indicators, and click behavior. The picker offers a clearly labeled **No highlight** choice, persists/reports the chosen or pending color in shared toolbar state, and round-trips highlighting as sanitized rich HTML through node, Logic Gate, project, draft, sent-mail, attached-reply, and signature serialization. At a collapsed caret, a color or **No highlight** becomes the active typing style for subsequent input. Font-size and highlight range commands format strict selected text-run intersections without wrapping paragraph, list-item, or table block ancestors inside an inline span; selecting one line/list item must not partially mark the following sibling, while an intentional selection spanning multiple lines/items still formats every selected run. Repeated font-size changes split/normalize the prior wrapper rather than nesting indefinitely.
ED41 - Focusing an attached-email reply invalidates the surrounding node/project text-block formatting target immediately. The outer toolbar must disable instead of retaining a stale controller that could format the previously focused text block; the reply's own shared toolbar remains the only formatting owner while the reply editor has focus.
ED42 - Committed remote editor operations are applied as remote transactions without echo-saving while the shared hydration boundary preserves the logical selection/range. A duplicate is ignored; a revision gap, divergence, reconnect, or explicit snapshot-required event performs automatic full-snapshot recovery instead of deferring a whole-document conflict until blur.
ED43 - Each collaborative body owns a target-safe ordered pending-operation queue with stable IDs. Ordinary typing first crosses the bounded ED77 DOM batching boundary; the resulting HTML delta is then retained durably before loss, submitted sequentially without a second debounce, and cleared only by commit acknowledgement/deduplication. Title/attachment metadata queues cannot carry or overwrite the document body; hidden documents never accept toolbar formatting commands.
ED44 - Logic Gate root/body, Node root/body and every individual Node text box, and Project text boxes use exact live collaboration scopes on the one shared realtime client. Normal writes/fan-out are structured deltas, not whole bodies; full snapshots are reserved for open, refresh, reconnect, gaps, divergence, and saved-version replacement. No separate editor socket, registry, heartbeat, or reconnect loop exists.
ED45 - Durable Node chat create/delete publishes compact committed hints only to `chat:node:{node_id}` while that existing same-company Node chat is mounted. Subscription admission requires effective Edit access, and every publication re-resolves the current exact Edit audience; a user whose access is revoked after subscribing receives no later identifier/hint. Project chat has no retained realtime subscription, and Node chat publication never uses a generic editor/document or workspace scope.
ED46 - Attachment-backed image hydration has exactly one owner for each rich-editor DOM/document update across `EditorContent`, `NodeTextBlockEditor`, and `UnifiedRichEditorSurface`. That owner returns stable cleanup, replaces its current hydration generation before DOM replacement or context change, observes near-viewport frames relative to the actual editor scrollport, uses the shared bounded display-load queue/Blob singleflight, retries failed frames with bounded backoff, and revokes every consumer-owned object URL on replacement or unmount. Delete followed by editor undo/redo must refresh that same owner so a restored attachment frame immediately receives a live image source; the refresh revokes superseded URLs without leaking them, and the original owner cleanup still cleans the newest generation.
ED47 - Node and Logic Gate saved-version history is progressive Save Settings data. Initial document open does not request history. Manual Save first flushes acknowledged collaboration operations and snapshots the canonical head; confirmed restore commits a canonical snapshot replacement plus a compact `editor.snapshot.required` outbox event so exact subscribers recover without full-body fan-out.
ED48 - Mounted Node chat retains its exact `chat:node:{node_id}` recovery behavior on the shared client. Collaborative documents add only `editor:{resource_type}:{resource_id}:{document_id}` scopes; Project chat, generic workspace, replay, and broad event-history scopes remain forbidden.
ED49 - A successful same-window Node or Logic Gate rename patches the mounted editor label through the concrete committed-title event without replacing dirty, debounced, queued, or in-flight document text. If the Editor title `contentEditable` is active, the incoming label is deferred until editing ends and cannot replace its DOM draft or move its caret.
ED50 - Blocking editor-adjacent popups, modals, previews, and expanded/fullscreen node panels must mount through the shared body-level `AppModalPortal` layer. That layer escapes feature-local stacking contexts, remains above Key Views, Explorer, Search Explorer, and other app chrome, traps keyboard focus within the topmost modal, and restores the prior focus when it closes. Each consumer keeps its existing dialog naming, Escape/backdrop close rules, and live editor instance when toggling fullscreen.
ED51 - Node, Logic Gate, and Project editor headers keep Editor, Permissions, the shared Format controls, and Outline Styles/Automatic Numbering in the primary left-to-right area. Where present, Relationships, Metadata, History, Save Settings, version/related-node commands, and surface-specific secondary actions move into one keyboard-operable **More editor actions** overflow menu without losing permission checks, disabled states, active state, or behavior. Project secondary actions include Assignments and the available open/minimize commands.
ED52 - Node and Logic Gate entity headers keep shared controls, Outline Styles/Automatic Numbering, and More on one nonwrapping line, with More immediately following the outline control. The four GVIC cards remain in one compact horizontal row and may clip beneath a narrowing side pane instead of wrapping vertically. Apply-to-assigned-nodes is available only from More and requires an explicit Yes/No confirmation; only Yes performs the write.
ED53 - A persisted person/entity mention retains its current chip appearance, identity, attributes, profile actions, and noneditable atomic DOM representation while participating in editing as one movable character. The caret can occupy the positions immediately before and after it; Left/Right crosses one entity at a time; adjacent entities, entity-only lines, and list items preserve valid boundary positions; Backspace/Delete removes or crosses the expected unit; and undo restores the entity with its identity intact. Backspace immediately before an entity at the start of a line performs the normal previous-line join/move instead of hitting a dead zone, and Enter immediately before it splits/moves content without downgrading the entity to plain text or corrupting list indentation.
ED54 - Table creation and editing remain shared editor capabilities, but a table must not inject cell-level or table-overlay left/center/right alignment icons into its top-left cell. Alignment remains available only through the shared header toolbar, and removing the embedded controls must not remove table selection, caret placement, row/column editing, or the shared toolbar's active-table alignment behavior.
ED55 - Double-clicking an inline editor image opens its final dark fullscreen overlay directly through the shared modal layer, without a transient intermediate panel, outline, unmeasured window, or geometry jump while the image source loads. The dark backdrop is visibly translucent so the app beneath remains faintly visible rather than becoming fully black, while the image and controls remain readable. The overlay uses the standard compact node-editor close-button template: a glossy bright-red square with the same border, shadow, radius, and uppercase white `X`; a clearly visible bottom-right image download button remains separate. Both controls have accessible button semantics. The X closes the preview, the download control downloads the original image, and supported Escape/backdrop dismissal remains intact.
ED56 - The shared `ChatPane` may render one optional caller-owned `headerTrailing` slot in its existing header above the unchanged conversation rows. The slot is presentation input only: `ChatPane` does not fetch email collaborations, derive participant or group membership, or change message ordering, reply indentation, composer, attachment, mention, deletion, or realtime behavior. `EmailCollaborationChatSurface` may supply the EMAIL77 participant-roster header, while existing Node and Project callers that omit the slot retain their current UI and data dependencies.
ED57 - A Node/project text-block annotation preserves its stable chat comment ID through highlight geometry. A normal click hit-tests that annotation without making the overlay intercept selection/editing, opens the shared chat surface, expands ancestors, scrolls the exact comment into view, and focuses its labeled article with `aria-current` and a visible focus outline; active selections and prevented editor actions do not navigate. The reverse chat-to-source action is a consumed one-shot request: every explicit click receives a new monotonic request ID, remains pending only until its source range is available, scrolls/focuses that range at most once, and is then acknowledged and cleared. Holding the pointer, releasing it, ordinary rerenders, chat updates, focus or selection changes, and virtualized unmount/remount must not replay a handled request or override the user's later caret or scroll position; only another explicit click may create one new navigation.
ED58 - Node text-block comment selections use the same canonical plain-text model as saved annotation highlights, including block separators. A selection that visually wraps or crosses rendered lines must expose the comment action and persist the exact trimmed quote/start/end offsets; ordinary single-line selection remains unchanged.
ED59 - Pasted ordered, alphanumeric, bullet, and nested list content is sanitized into editor-owned list structure. Safe ordered-list marker type/start/reversed semantics may survive, but source positioning/margins do not; list boxes, markers, and long content remain contained inside every editor/node border.
ED60 - The mailbox signature surface provides a practical full editor and an explicit Edit/Preview mode using the same sanitized unified rich editor. Stored Mango attachment image references hydrate eagerly in both signature preview and composed message surfaces; preview never introduces public URLs, raw image bytes, or a second sanitizer.
ED61 - Pasting one copied ordered/alphanumeric/bullet/checklist row at a collapsed caret inserts that row's inline content exactly at the caret in the current item; a caret at the first character must not create a duplicate structural row. Enter at the end of a parent item leaves its nested child list with that parent. Structural Tab/Shift+Tab prevent browser focus escape, preserve the active item's text and caret offset, and never consume a following row.
ED62 - A single-clicked node/project inline image exposes a small download button anchored to that image's bottom-right corner while retaining its comment/create-node actions. Scrolling the nested editor recomputes the controls from the live image frame, so the download button travels with the thumbnail and disappears while the image is offscreen instead of staying pinned to browser chrome. Turning an attachment-backed image into chat opens the composer, places keyboard focus and the text caret in its textarea even when that pane was already open, and stages its thumbnail immediately as `processing`, then creates only the existing attachment's `chat_attachment` resource link; it must not download or reupload the bytes. Chat send stays disabled until reconciliation replaces the pending item with the durable attachment. Failure keeps a visible removable failed item and never fabricates a saved attachment. Only a legacy image with no attachment ID may use the byte-upload fallback. Copy publishes the richest standards-supported clipboard payload: an image MIME representation plus portable data-image HTML and filename text when Async Clipboard supports them, with the existing sanitized Mango HTML fallback for editor-to-editor copy. The selected-image download and comment/create-node controls render in the current shared app overlay target with fixed viewport coordinates: inside the enclosing editor modal layer when one exists, or at app-body level otherwise. They stay anchored while the nested editor scrolls, and the elevated comment/create-node surface sits immediately outside the image's right edge instead of above it. Controls clamp only at the browser viewport so editor/card overflow cannot clip or hide them.
ED63 - Creating a node text box with the + action scrolls the new block into the visible workspace, focuses its rich editor, and places a usable caret at its end.
ED64 - Turning selected text into chat keeps the source quote visibly annotated as soon as the chat composer opens and after the durable chat is created. The same canonical offset/quote fallback applies inside nested bullet and alphanumeric structures.
ED65 - Unified-editor attachment hydration owns setup and cleanup in the same layout lifecycle. Cleanup replay cannot leave a durable `mango-attachment:` source stranded behind an already-applied-value guard: the authenticated hydration restarts whenever no active owner remains. Durable frames expose loading/ready/error state, hide native broken-image glyphs, use contain sizing, preserve the stored reference on failure, and retain double-click original-image viewing through its separately authorized loader.
ED66 - In every unified rich editor surface from ED2, Tab is an editor indentation command and never browser focus navigation except while the people picker is open, when plain Tab accepts the highlighted @mention/!urgent-mention entity before indentation routing. Plain text and table-cell text receive one editor indent; Mango bullet/checklist items and sanitized pasted ordered-list items nest through the shared list command while retaining the active row and caret. Shift+Tab performs the corresponding shared outdent or a prevented no-op when no outdent is possible. Tab must not move between table cells, leave the editor, or focus another app control. An enclosing modal focus trap must ignore the editor's already-default-prevented Tab event instead of cycling focus to Chat or another node-window control.
ED67 - Selecting an inline image, opening its chat action, or focusing/blurring an unchanged Node/Project text box is not a document operation. A real DOM mutation produces one bounded HTML-patch micro-batch; title/attachment metadata changes remain separately serialized and cannot smuggle the document body.
ED68 - An editable Node with at least one loaded text box must select and publish a deterministic text-block formatting target during initial hydration without moving browser focus. The outer toolbar is therefore enabled, clickable, and hover-responsive immediately; clicking a different text box retargets it normally. Permission-denied nodes, hidden document modes, nodes with no text box, and the attached-email reply focus boundary in ED41 remain disabled.
ED69 - Attachment hydration cleanup is tied to actual editor lifecycle/context/value replacement, not every controlled `value` rerender. A local input update that serializes the same live DOM keeps the active hydration owner, image element, decoded object URL, and selection intact; StrictMode replay and unmount still restart or dispose exactly once and revoke every owned URL.
ED70 - Typing a dash followed by one space at the otherwise-empty current line start converts that line immediately into an empty structural bullet-list item in every unified editor surface, independent of the selected outline style. The physical Space key path must own this shortcut even when Chrome/React exposes text data without a native `inputType`; before-input remains the non-keyboard fallback. The shortcut consumes the dash and space, keeps focus and the caret in the new item, works inside a table cell, preserves unrelated inline images/rich DOM, and does not activate inside an existing structural list item or in the middle of ordinary text.
ED71 - Personal/shared Forward reuses the same `ComposePanel` and `UnifiedRichEditorSurface` as ordinary compose/reply for the user's authored content, selection, formatting, inline-image, attachment, flush, and persistence behavior. The sanitized original-message block is locked preview/context outside the editable document and is combined with the authored HTML only by the shared forwarding renderer, so editing cannot corrupt the retained original.
ED72 - A collaboration snapshot is canonical rich HTML. Node and Logic Gate load that HTML as formatted DOM, never literal tags. Acknowledgement, broadcast, refresh, reconnect, and revision-gap recovery preserve paragraphs, rows, lists, formatting, tables, mentions, and durable attachment references; Saved is reached only after backend commit/deduplication proof.
ED73 - Structured inline style attributes must be canonical: CSS represented by bold/italic/underline/strike/highlight/font-size OT attributes is not retained a second time in `span_style`. Materialization must not duplicate a property across round trips, while unrelated safe span style survives.
ED74 - Every unified rich editor adapter receives the active company people inventory. Typing @ or ! plus a partial name opens the shared people picker; Enter or plain Tab inserts the recommended user as the existing noneditable mention entity, including urgent-kind metadata and styling, rather than ordinary text. Both menus use the same compact 42-pixel row and show at most five rows before scrolling. Fixed overlay suggestion menus recalculate from their caret anchor during page or nested-editor scrolling instead of remaining pinned to the viewport.
ED75 - Pasting a mixed rich document from an external app into any ED2 unified editor preserves the supported semantic order of headings, paragraphs, bold/italic/underline/strikethrough, highlights, font sizes, links, tables, alignment, indentation, ordered/bullet/checklists, and inline images. The shared path resolves every image to an authorized durable Mango attachment before one document commit: matching clipboard files upload directly, existing Mango references link to the destination, and external HTTP(S) sources use the protected server importer. Repeated sources import once and render at every occurrence, at most three unique images resolve concurrently, and one failed image preserves the rest of the document with safe fallback text instead of retaining an external, blob, data, or base64 source. Completion may commit only while the original editor root, target, resource context, saved range, and starting document remain current.
ED76 - A Node owns at most one full-height email column, separate from its text-box rows. With no attached email the column is absent; attaching any message opens the column and loads that message's full provider thread once as collapsed message cards on the same compact line-and-dot timeline used by the mail viewer. Expanding a selected email grows the column to the message's complete natural height without the former 620-pixel/72vh cap or a nested body scrollbar. Email bodies remain white and only email headers receive the message accent. A message with no provider thread identifier is a complete one-off message and must not display the incomplete-thread retry warning. Each thread header and the column header can collapse or expand the complete thread. Text boxes remain editor-plus-optional-chat rows. A text box created from an email message or highlighted email text persists the provider message ID and a unique accent; older duplicates are repaired. Its header and matching message card share that accent. Clicking either side smoothly reveals/pulses its exact partner. Email-selection chats persist exact provider message/quote/offsets against the linked text box without copying the Triage conversation.
ED77 - Ordinary native or shared scripted typing uses one document-input batch across every unified editor surface. The batch captures one exact rich-HTML undo-before snapshot at its first mutation, keeps subsequent keystrokes on the live DOM without full serialization, and after 160 ms idle or 500 ms maximum captures one undo-after snapshot, sanitizes/serializes once, and emits one durable collaboration HTML delta. Input-kind changes, undo/redo, navigation, pointer selection, paste/drop/cut, structural commands, formatting, blur, and unmount flush the current batch before their own mutation. IME composition is one batch: composition updates defer idle/maximum timers until composition ends, then arm the normal idle boundary. A pending local DOM batch must be persisted into the ordered operation queue before a remote commit, recovery snapshot, or snapshot-retry reconciliation is applied, so batching cannot discard or overwrite concurrent local typing.
ED78 - Node and Project text-box lists use one bounded fixed-row window. Only visible rows, two-row overscan, and a small number of active pinned rows may mount; height-preserving spacers retain full scroll geometry, animation-frame scheduling moves the window without mounting intervening rows, and browser anchoring cannot undo a window change. Dynamic linked-email expansion temporarily pins all rows so natural message height cannot be clipped; collapsing restores the fixed-row window. A normal open starts at the top, while block, chat, email, highlight/change, selection, search/navigation, and restoration targets mount and scroll their owning neighborhood exactly once. An empty box opens only its Editor: saved Email or Chat state is restored initially only when that pane has corresponding data. Node rows use a left content column and optional independent chat-right column, while the one Node-wide email column sits left of the list. Once attached emails exist, the Node-wide email shell remains mounted across its toggle and uses a stable three-track grid: open restores the saved email width, closed animates that track to zero while fading/translating the pane and marking it inert, hidden from accessibility, and pointer-disabled. Email, Editor, Chat, and email/chat tab entry use the shared short pane transition; column tracks transition for 180-200 milliseconds, and `prefers-reduced-motion` removes entrance/layout animation. These presentation transitions never mount extra durable surfaces or mutate projection/draft state. Project rows retain independent controls; late IDs receive normal defaults, explicit closures persist, narrow windows scroll horizontally, and pending input flushes before unmount.
ED79 - A Node chat opened beside an editor uses a compact 340-pixel default width; an explicit drag may resize and persist it. A Node-wide email column with visible text boxes exposes an accessible email-focus toggle. Activating it animates the email column across the workspace in 180 milliseconds while retaining only the 38-pixel timeline rail; clipped editor/chat controls are inert. Restoring focus returns the prior layout without overwriting saved widths. Triage's shared ChatPane may opt into container-filled height, which disables its obsolete vertical resize strip and stretches message history/composer to the rail's bottom edge. Node fixed-row ChatPane height and horizontal resize semantics remain unchanged.
ED80 - A Node text box linked to an email message exposes a header-level Show email control. Activating it opens one self-contained plane for the exact linked message and shows its full natural-height body plus available Subject, From, To, Cc, and Bcc metadata without copying any of that content into the editable document. The preview belongs only to the row's left content column; an open Editor keeps its normal body below the preview. An open Chat remains a separate right column at the full text-box body height and is never shortened, covered, or placed below the email preview. The preview must not include sibling thread messages, thread timeline chrome, or reply controls. A child-message link whose Node attachment stores the thread root resolves the matching attached thread and mailbox but renders only that child. The separate header background retains ED76 navigation to the exact message in the left email column. The control becomes Hide email and removes the preview on a second activation. Expanding, hiding, virtualizing, or remounting the row does not mutate the text-box document, chat, or persisted email association.
ED81 - Every ED2 unified editor surface exposes one shared inline workspace-entity contract. A surface may supply its own persistence callback and navigation adapter, but it must not implement a local `#` picker, selection-to-Node action, chip schema, sanitization rule, or entity keyboard behavior.
ED82 - A nonblank editor selection exposes the contextual action named `Create node from this highlighted piece of text.` The action is a square outline with a plus sign, not a text glyph or wide empty panel. On a Node/Project row it is the same 28-pixel size as the chat icon and sits immediately to the chat icon's right with a compact gap; the JSON editor preserves the same chat-then-create ordering with equal 30-pixel controls. The elevated action surface remains at the selection's top-right at every editor scroll position. It uses the existing Node-title whitespace normalization and 500-character limit, creates a real company-scoped Node, and replaces only the unchanged selection with an atomic Node entity. Failure leaves editable content intact; a post-create selection/target change clearly says the Node exists and must not insert into another document.
ED83 - Typing `#` with a collapsed caret opens one shared elevated Universal picker at the caret and immediately focuses its top search field. The popup uses the editor's neomorphic surface, shows a `#` or `##` mode mark, and has canonical icon buttons for Nodes, Logic Gates, and Projects. When the editor is inside the Node popup, the picker belongs to that active app-modal layer so the popup's stacking and focus trap cannot hide it or steal its input focus. Arrow keys move selection, Enter and plain Tab select the highlighted result, Escape closes the popup while leaving the typed trigger, and pointer selection is equivalent. The selected value inserts as a typed entity object with the correct product icon/name, not plain text or a generic tag.
ED84 - Inline entity identity survives undo/redo, atomic keyboard navigation, copy/paste, legacy rich-HTML sanitization, JSON schema validation, persistence, static/read-only rendering, and remount. Pointer click, Enter, and Space open the deep route determined by the stored entity type and ID. Legacy HTML keeps only canonical `data-mango-entity-*` attributes; JSON schema version 1 keeps a strict `mangoEntityLink` atom.
ED85 - Typed entity search and Node creation preserve company/workspace scope and effective resource access; search cannot reveal inaccessible entities, hidden path resources, unsupported types, folders, or cross-company results. A blank Universal picker intentionally reads the current user's complete company-scoped Pinned tree and therefore follows PIN7-PIN9 snapshot, stale-pin, and destination-permission rules instead of behaving like blank search. No reference chip creates an Explorer placement or requires a database migration.
ED86 - Editable entity activation uses in-app history and route notification without `location.assign`, browser reload, authentication restart, or a login-page flash. A Node opened through an inline Node entity from another Node records only a validated target-specific source-Node return marker. The target Node's X invokes browser Back exactly once and restores that source Node. Direct opens, non-Node source routes, non-Node targets, and stale or mismatched markers keep the existing close-to-home behavior.
ED87 - Backspace on a selected/focused inline entity, or at a collapsed caret immediately after it, replaces the entity atom with its stored label as ordinary text and places the caret after the label. This operation changes only document markup; it never deletes or edits the real Node, Logic Gate, or Project. Undo restores the entity and its identity, while subsequent ordinary-text Backspace follows native text editing. Delete retains the editor's existing atomic deletion behavior.
ED88 - Turning selected Node text into a pending chat quote preserves only the temporary source annotation needed while composing. Clicking the quote X or closing that pending chat removes the quote/annotation and collapses the native/ProseMirror selection, so no selected-text highlight survives cancellation. Sending successfully may replace the temporary annotation with the durable chat annotation.
ED89 - For editor entity ranking, a Node is done only when its status is `Done`; a Project is done when its status is `Done`, `Completed`, or `Archived`. Every other nonblank or missing Node/Project status stays in its active bucket, so Planning, On Hold, Pending, Review, and similar work remain discoverable before Logic Gates.
ED90 - The PostgreSQL editor-only search applies text filtering and effective-access/visible-location checks before its bounded sort and does not construct unused Explorer location-path JSON. Case-insensitive contains search uses canonical `pg_trgm` GIN indexes on Node names, Project names, and Logic Gate headers. Ordinary Company Explorer search retains its separate tree/path response and ordering.
ED119 - The Universal picker begins in reference mode. A second `#` typed into its empty focused field switches to link mode only when the source editor supplies a link command. Node editors permit Logic Gate and Project targets, Logic Gate editors permit Project targets, and Project editors do not expose link mode.
ED120 - Node-to-Logic-Gate link mode requires the Node's valid priority and uses the existing assign-or-move command with destination status Requested. Node-to-Project uses the existing atomic Node Project relationship command. Logic-Gate-to-Project creates or reuses the existing Gate/Project row. Each command retains its normal authorization, cardinality, idempotency, event, projection, and timeline behavior.
ED121 - Clicking a type button filters to that exact type. With the picker input containing only N, L, or A, plain Tab selects Nodes, Logic Gates, or Projects respectively and clears the shortcut text. A disabled category cannot be selected in link mode. Typed search requests only allowed selected types; matching Pinned resources appear first and exact typed IDs are deduplicated.
ED122 - The blank picker renders the complete stored Pinned folder/pin tree in mixed sibling order with nested indentation and one scroll container. It does not calculate recency, store recent usage, write browser storage, or introduce a second pin API/table.
ED123 - A successful link command is independent from its inserted target-reference chip. Backspace, Delete, undo, document replacement, or any later chip removal changes only editor content and never unassigns, moves, or removes the business relationship. If the editor trigger changed after the relationship succeeded, Mango reports that the relationship completed without inserting the chip and never repeats or rolls back the command implicitly.
ED91 - The completed textbox cutover stores current Node, Project, and Logic Gate documents in their permanent owner textbox tables. Ordinary edits update `body_json` and `revision`, keep annotations inside the same JSON value, and do not write the retired generic or owner-specific operation/version tables. Current reads and writes do not use the legacy owner information/projection tables; destructive retirement remains a separately gated operator action.
ED91 - Every sent comment rendered by the shared `ChatPane` exposes Edit only to its original author. Edit opens an inline text area with Save/Cancel and Ctrl+Enter submission, keeps the editor open when persistence fails, and shows an Edited marker after success. The edit changes only message text and current mention IDs; it preserves the stable comment ID, author, created timestamp, reply/source-selection context, attachments, thread position, and all unrelated payload fields. Blank text remains valid only when the comment still has an attachment.
ED92 - The shared Node/Project `ChatPane` composer applies the workspace-entity `#` search contract alongside its existing `@` and `!` people picker. `#` queries the same company-scoped, permission-filtered Nodes/Logic Gates/Projects endpoint and ranking as the editor, Arrow Up/Down navigate, Enter or plain Tab accepts, Escape closes, and pointer selection matches the keyboard result. Acceptance inserts readable `#Name` text plus durable type/ID/label offsets in the existing chat payload; sent and reloaded comments render the correct product icon and open the same in-app deep route without a page reload. Ordinary composer edits remap intact references and discard a reference edited through its label. This adds no table, placement, or migration.
ED93 - An editable JSON/Tiptap attachment image uses the hand-selection cursor and direct manipulation instead of a detached labeled action strip. Its body remains a native movable ProseMirror node; selection shows eight edge/corner resize handles, an image-anchored bottom-right download icon, and icon-only comment/create-node actions when supported. Double-click uses the shared fullscreen image modal, and native Delete/Backspace removes the selected image. Selecting, dragging without a drop, opening controls, or previewing does not create a document operation; committed move, resize, or deletion does.
ED94 - PostgreSQL realtime audience resolution recognizes Project resources for exact Project editor scopes. Every Project JSON/HTML editor event rechecks the current candidate subscribers through the same effective Edit-access function as Node and Logic Gate events, so authorized remote Project edits fan out immediately without refresh while revoked, inaccessible, missing, and cross-company targets fail closed.
ED95 - Node text boxes, Project text boxes, and Logic Gate editor bodies use the active Tiptap JSON save contract in ED95-ED112. Email compose, reply, forward, draft, signature, and rendered email bodies retain their separate rich-HTML persistence contract. Older HTML collaboration rules in this document do not override the active JSON contract for Node, Project, or Logic Gate documents.
ED96 - The active JSON save architecture is deliberately bare-bones. One ProseMirror transaction changes the live editor, one batching owner captures the complete Tiptap JSON object, one latest-unsaved IndexedDB record protects it, and one full-document POST commits it. The capture may perform one schema-driven walk that removes only attributes equal to declared ProseMirror defaults; the resulting object is the one recovery/request snapshot. The ordinary path must not add Yjs, Hocuspocus, Tiptap Cloud, a Web Worker, another state-management framework, a second queue, a second debounce, an arbitrary save-time normalization pass, a separate recursive frontend validator, a full-document equality stringify, a parse/stringify/reparse loop, or parent-owned complete-document state.
ED97 - A document already open in the configured Tiptap/ProseMirror schema is valid for ordinary saving. Mango must not reject the complete document because a pasted font size is fractional or outside a Mango range, a color is RGB or Display-P3 instead of `#RRGGBB`, a highlight uses an unfamiliar cosmetic value, or another supported mark has unusual cosmetic attributes. Unsupported external cosmetics are ignored at the paste boundary while supported text and structure are retained. The durable boundary keeps only authentication, edit permission, company/resource scope, revision protection, stable operation IDs, request-size limits, safe link protocols, durable attachment identity, prohibition of persisted `blob:` URLs or embedded raw image bytes, and the minimum envelope/structure needed for the configured Tiptap schema to reopen the document.
ED98 - Local editing is immediate and does not wait for IndexedDB, JSON capture, serialization, or the network. Every local document change increments a small generation, publishes Pending from the one sync owner, and resets one approximately 500 ms quiet timer; ordinary keystrokes do not capture or write the complete JSON document. The first unsaved change also starts one approximately 10-second maximum timer that later keystrokes do not extend, so uninterrupted typing is still captured periodically. The 500 ms quiet period avoids starting expensive full-document work between normal keystrokes and short word pauses, while the 10-second maximum limits how much continuously typed work can remain outside IndexedDB and the server. Blur, navigation, explicit flush, and editor shutdown capture immediately instead of waiting for either timer. These timers change only when the existing full-document recovery/save runs; they do not change the JSON format, IndexedDB record, revision rules, or backend contract.
ED99 - When a batch fires, the status icon becomes Saving, the sync owner calls the active editor's JSON getter once, and removes attributes equal to defaults from that in-memory object without stringifying or reparsing it. The resulting compact object is the batch snapshot stored in structured IndexedDB and passed to the HTTP helper; no extra complete-document string is created for comparison, React parent state, validation, recovery storage, or reparsing. JSON serialization occurs once at the HTTP request boundary.
ED100 - IndexedDB holds one latest-unsaved recovery record for the exact active company/resource/document key, not a pending commit queue and not every document's recovery state in memory. The record contains the Tiptap JSON object, mapped durable annotations, local generation, stable operation ID, base revision, and capture timestamp. A newer captured batch overwrites the older record. A failed request retains it. A latest-generation acknowledgement deletes it only when the stored operation ID still matches.
ED101 - Every save attempt captures its generation. An acknowledgement may show Saved and clear the recovery record only when it acknowledges the latest local generation. If typing occurred after that request began, the older acknowledgement advances the base revision but must leave the newer generation Pending and schedule it. A lost acknowledgement is retried with the same operation ID so the backend can deduplicate the already-committed operation. A genuinely divergent base revision uses the existing conflict choice instead of overwriting either document.
ED102 - The ordinary JSON save response contains only `operation_id`, `revision`, the server `committed_at` timestamp, and optional `deduplicated`; it does not echo the complete committed document. The originating browser already owns the submitted document. The server commits the document, revision/version state, stable operation result, and existing realtime revision event together. The Saved timestamp comes from `committed_at`.
ED103 - Save status has one authoritative publisher and four user-facing states: Pending, Saving, Saved, and Save failed. Meaningfully identical states are not republished. Pending, Saving, Saved, and timestamp changes render only at the textbox-row/status-icon boundary and must not rerender the complete Node, Project, or Logic Gate surface. Only failure attention may update the outer textbox frame.
ED104 - Failure attention is intentionally permanent for the current page session. The first Save failed, image upload failure, or rich-image import failure for a document latches the status icon and complete textbox frame in the failed state; the frame remains red and visibly pulses every two seconds until a full browser refresh. Later Pending, Saving, Saved, or acknowledgement states do not replace that visible failure. Saving, retry, acknowledgement, recovery cleanup, revision advancement, and dirty-row unpinning continue underneath the latched warning. This is intentionally conservative: after Mango has told the user that any part of their attempted work failed, a later unrelated success must never imply that the earlier failed content was recovered.
ED105 - On refresh or reactivation, Mango reads only the exact active document's recovery key. A recovery record is loaded into the editor before the canonical server snapshot can erase it, and its stable operation ID is retried. Realtime or canonical refresh must not replace an editor with an unsaved generation, scheduled snapshot, retained failed operation, or in-flight request. A latched ED104 warning that remains after the failed work was later acknowledged is presentation state and does not manufacture unsaved work. A browser recovery-storage failure is stated explicitly; Mango must not claim crash recovery when IndexedDB was unavailable, rejected the write, exceeded quota, or failed cleanup.
ED106 - Ordinary pasted or dropped image files upload and link to the exact resource before an image node is inserted into the Tiptap document. The inserted node stores a durable attachment ID and approved metadata, never an S3 signed URL, third-party URL, `blob:` URL, data URL, or raw bytes. If upload/linking fails, no pretend durable image is inserted and the permanent page-session failure state is raised. Each successfully inserted image then follows the same JSON batch, recovery, revision, and acknowledgement rules as typed text.
ED107 - Mixed rich paste owns clipboard HTML containing images. Mango preserves supported paragraphs, headings, lists, checklists, tables, links, marks, and readable text; resolves matching clipboard files, existing Mango attachments, data/blob sources, or retrievable HTTP(S) sources into durable attachments; deduplicates repeated sources; limits unique image imports to the configured bounded concurrency; and preserves source order. Only after the durable image resolutions settle does Mango insert the prepared rich selection into Tiptap, producing the normal document save rather than a separate document-writing path.
ED108 - A large mixed paste must not be rejected merely because the user types or formats something while its images are importing. The editor captures a ProseMirror selection bookmark and maps it through every intervening document transaction. When imports finish, the complete prepared text and successful images are inserted at the mapped range, while the intervening edits remain in the document. Destroying the editor or changing the document target still prevents stale insertion into another document.
ED109 - A partial rich-image import preserves the paste. Supported text, formatting, structure, and every successfully imported image are inserted; each failed image becomes a safe visible fallback label. The failure is reported and latches permanent page-session failure attention, but it must not reject or remove the rest of the pasted selection. The saved JSON contains no failed third-party source, temporary URL, signed credential, or embedded bytes.
ED110 - Block identity and annotation work are proportional to the change. Missing block IDs are assigned only inside changed transaction ranges, never by walking the complete document after each keystroke. With zero annotations, annotation code does not scan the document. Existing decorations map through the ProseMirror transaction; atom lookup uses `nodesBetween(annotation.from, annotation.to)`; and unchanged meaningful annotation values are not redispatched during saving.
ED111 - Save processing does not synchronously push a complete document through Node, Project, or Logic Gate React state. The active editor remains the live authority while typing. A sleeping editor retains its latest document for static rendering, but that React state is updated after the browser has had a chance to paint or immediately before deactivation, not inside the critical save task. Dirty virtualized rows remain mounted until their pending document work is acknowledged.
ED112 - Existing committed-snapshot realtime notifications remain the collaboration mechanism. The saving browser does not reload the document it just submitted. Another subscribed browser reacts to the compact revision event by fetching the complete committed Tiptap JSON only when it has no unsaved local edits. Pending, Saving, or failed local work is never replaced by that fetch; existing revision protection raises the conflict choice where appropriate.
ED113 - Saving must not interrupt typing by routing dirty/saved bookkeeping through the mounted Tiptap React component. The mounted editor treats Active and Dirty as the same React mount state; lifecycle labels and dirty-runtime counters update without rerendering that component. Node and Project row pinning is different: pin and unpin updates use normal immediate React priority because pinning protects unsaved work from virtualization. Pinning must never be delayed as a transition. The 500 ms quiet timer and 10-second maximum timer still choose when to save; they must never be used to hide a save-time typing pause.
ED114 - Detailed editor tracing is an explicit developer diagnostic, never ordinary editor persistence. It activates only when `editorTrace=1` is present on localhost or the dev-site host, displays an unmistakable fixed recording panel, holds a maximum of 250,000 ordered events in memory, performs no per-event console, network, file, or IndexedDB logging of its own, and exports one raw JSON file from a user click. The export correlates input IDs and transaction IDs with microsecond timestamps and named spans for input, ProseMirror dispatch/plugins, Tiptap callbacks, selection/toolbar calculation, React editor commits, lifecycle pinning, quiet/max/retry timers and lateness, snapshot creation, IndexedDB, request serialization/fetch/parsing, long tasks, long animation frames, and frame gaps. It may record only non-content metadata such as counts, sizes, states, duration, method, and URL path; it must never record editor/paste text, JSON bodies, response bodies, authorization data, operation/client/company/resource/document IDs, or URL query values. The normal production host and every URL without the opt-in parameter must install no trace panel, input listeners, performance observers, or trace storage.
ED115 - Annotation arrays are compared by their meaningful values, not by JavaScript array identity. A new array containing the same annotation IDs, kinds, ranges, active flags, and durability flags must dispatch zero replacement transactions. A real annotation change dispatches exactly once. Annotation-only transactions must not recalculate or republish selection-toolbar state. Document changes without a separate selection event and stored-mark changes at the caret still publish current formatting, while selection changes use the selection callback. Equal inline-format values must keep the current React state object. Node timeline rows must reuse memoized per-block chat arrays unless the underlying chat data or legacy email-chat mapping actually changes. These rules apply regardless of document length, annotation count, editor surface, or how many editor rows are mounted.
ED116 - Current Tiptap JSON snapshots omit only attributes equal to defaults in the active schema. Stable block IDs, intentional empty paragraphs, hard breaks, custom node/mark attributes, and attachment identity/metadata/dimensions/accessibility text remain explicit. ProseMirror hydration and the sleeping static renderer must apply the same omitted defaults. The backend compacts the matching known defaults before storage and canonical reads, and stale-edit merge must treat an older expanded block and a compact block as equal instead of duplicating either one. The required top-level format, schema version, document root, and annotations array remain unchanged; no database migration is required.

ED117 - `node_textbox_chats` is the current authority for Node textbox chats. Reads, creates, replies, edits, and deletes use that table and must not create new legacy `Text block chat` information or projection rows. Deleting a textbox deletes every chat it owns, including email-selection chats, and removes each chat's attachment relationships. The normalized email message, thread, and email attachments remain. Existing legacy chat rows are ignored by current reads and retained only as rollback and audit evidence until a separately approved retirement.
ED118 - A canonical empty TipTap document has one explicit empty paragraph inside the document root; `document.content=[]` is invalid. The forward repair may replace only that exact bad converted shape in `node_textboxes`, `node_textboxes_history`, `node_textbox_seen_snapshots`, and the same arrays inside Recycle Bin restore payloads. It preserves textbox and owner IDs, revisions, annotations, ordering, timestamps, saved-user identity, deletion state, array order, and every unrelated JSON field. The repair never rewrites the shipped cutover migration and never treats the representation correction as a user edit.
ED119 - The active Node, Project, and Logic Gate Tiptap editor must honor the shared Outline Style on its first user action. First-click activation keeps the sleeping document painted until the live editor DOM has accepted focus/caret and preserves scroll without mutating the document. Ordinary Tab/Shift+Tab changes only the current paragraph or heading indent; structural list Tab/Shift+Tab changes only the active list item and remains editor-owned in tables. Empty-row Enter starts the selected numbered, bullet, or Checkbox structure. Indentation guide lines paint only in Indent Guides mode. The visible image frame starts a real node drag, and every table command uses the same revisioned document path.
ED120 - Copying a selected attachment image in an active Node, Project, or Logic Gate Tiptap editor replaces the private ProseMirror image-node clipboard with portable output. The synchronous event clipboard retains Mango round-trip HTML and filename text, while the system clipboard reloads authorized original bytes and publishes a supported image MIME plus data-image HTML and filename text. Copy is read-only and must not upload, duplicate, relink, save, or mutate document or attachment state.
ED121 - Editor activation is selection-only. The sleeping document remains painted until the live Tiptap DOM and requested caret are ready; the reveal must not blink, change scroll, save, create a block, or add an empty row. A canonical document that is structurally equal under the active ProseMirror schema updates canonical authority without a replacement transaction.
ED122 - Automatic Numbering repeats `1.`, `a.`, `1)`, `a)` by nesting depth. The user-facing option is Checkbox. Empty-row Checkbox Enter produces one unchecked Checkbox row with its caret in that row; nonempty ordinary-row Enter performs the split and conversion atomically; existing Checkbox Enter produces the next adjacent unchecked item. Checkbox nesting changes depth without changing its symbol or inserting an ordinary row.
ED123 - The table-cell context menu uses the shared portaled right-click surface at viewport coordinates, outside editor overflow clipping. Column actions and row actions are grouped by separators, and the bottom delete row, delete column, and delete table actions use destructive red text.
ED124 - Tables begin at intrinsic content size with equal 112-pixel columns and equal 36-pixel rows instead of filling available editor width. A selected table exposes a bottom-right growth handle; its drag previews whole nonnegative row and column additions, cancel changes nothing, and release commits the preview once while preserving equal column widths and row heights.
ED125 - Completing `->` or `<-` by typing in an ordinary Node, Project, or Logic Gate Tiptap text position replaces that pair with one durable Unicode `U+2192` or `U+2190` and keeps the caret after it. This shared input rule applies to paragraphs, headings, list items, Checkbox items, and table cells, but not code blocks. It does not rewrite loaded or pasted ASCII pairs, and no sanitizer, clipboard path, history path, recovery path, or realtime path may convert a stored Unicode arrow back into ASCII.
ED126 - History snapshot creation is action-triggered, never timer-triggered. A changed Node, Logic Gate, or Project requests one history snapshot when its owning editor surface unmounts because the user closes its window, panel, Project/Updates preview, switches to another resource, changes Mango routes, or uses browser Back or Forward. The browser `pagehide` event makes the same best-effort request for refresh, external navigation, and tab/window close. No interval, background scan, inactive-resource loop, unload prompt, crash recovery, OS-kill handling, or discarded-tab service may create history snapshots.
ED127 - A resource becomes changed for exit history only after a local editable history-visible mutation: a Tiptap document transaction; a user-created Node or Project textbox or successful deletion; Node or Project textbox title/attachment metadata change; or a confirmed saved-version restore. Loading canonical data, automatically ensuring an initial empty textbox, receiving a remote refresh, focusing, selecting, scrolling, opening tabs/panes, or closing an unchanged view does not mark the resource and must create no exit-history row.
ED128 - Manual and action-triggered history use the same permanent resource history format and existing history endpoint. Before either snapshot, Mango flushes every mounted Tiptap textbox for that exact company/resource and then flushes the resource owner's changed textbox metadata. One per-resource save coordinator shares an in-flight save across nested unmounts, repeated close signals, and a simultaneous manual click. A successful manual or exit snapshot advances the same clean baseline; edits made after that success require one later snapshot. The manual button remains available and still saves even when the resource has no new changes.
ED129 - An action-triggered snapshot is quiet: it does not open history, block an in-app close, or display a success dialog. Save failure leaves the resource changed so a later close or manual save can retry. The history batch represents the committed canonical resource after the local flush; therefore already committed concurrent edits from another authorized user may also be present. Refresh, external navigation, and tab/window close are best effort because a browser may terminate asynchronous work, while Mango-controlled closes, resource switches, and route unmounts run while the application remains alive.

### Required Unified Rich-Editor Surface Inventory

| Surface | Required runtime host | Shared toolbar/controller | Persistence boundary |
|---|---|---|---|
| Logic Gate editor body | `EditorContent` configures the one `EditorDocumentSurface` | `EditorTabBar` + `useEditorDocumentFormattingController` + `useEditorDocumentSurfaceHandlers` | `logic_gate_textboxes` current JSON and `logic_gate_textboxes_history` manual/action-triggered saves |
| Node text box in every full node opener | `NodeTextBlockEditor` configures the one `EditorDocumentSurface` | Same shared toolbar, controller, and behavior handler | `node_textboxes` current JSON and `node_textboxes_history` manual/action-triggered saves |
| Project textbox editor | Project Summary reuses `NodeTextBlockEditor` and the one `EditorDocumentSurface` | Same shared toolbar, controller, and behavior handler | `project_textboxes` current JSON and `project_textboxes_history` manual/action-triggered saves |
| My Triage compose/reply | `ComposePanel` mounts `UnifiedRichEditorSurface`, which mounts the one `EditorDocumentSurface` | Same shared toolbar, controller, and behavior handler | Personal mailbox draft/send |
| Shared Triage compose/reply | The same `ComposePanel`/`UnifiedRichEditorSurface` path selects shared mailbox scope | Same shared toolbar, controller, and behavior handler | Shared mailbox draft/send |
| Attached-email reply from a node or project | `EmailConversationPane` mounts `UnifiedRichEditorSurface`, which mounts the one `EditorDocumentSurface` | Same shared toolbar, controller, and behavior handler | Source personal/shared mailbox send scope; draft lifecycle remains domain-owned |
| Personal/shared email signature | The signature panel mounts `EditorTabBar` and `UnifiedRichEditorSurface`, which mounts the one `EditorDocumentSurface` | Same shared toolbar, controller, behavior handler, and highlight palette | Mailbox-scoped personal-account or shared-inbox signature record |

The architecture has four distinct responsibilities: `EditorDocumentSurface` owns the actual rich editable DOM; `useEditorDocumentSurfaceHandlers` owns keyboard, clipboard, paste/drop, list, image, mention, undo/redo, and flush semantics; `useEditorDocumentFormattingController` owns every toolbar command and selection/pending-format state; and `EditorTabBar` owns the visible controls. Domain adapters own only loading, value changes, flush/save/send callbacks, permissions, attachment context, and surface-specific layout.

## Scenarios

### Scenario ED-S114: Export One Complete Freeze Trace

Business logic covered:
- ED114

Given:
- A developer opens a Node, Project, or Logic Gate JSON editor on localhost or the dev site with `editorTrace=1`.
- The fixed panel visibly says that recording is active.

When:
- The developer types through a visible freeze and delayed-character burst.
- The developer immediately clicks **Stop & download**.

Then:
- Chrome downloads one `mango-editor-trace-<timestamp>.json` file containing ordered input, transaction, function-span, timer, IndexedDB, request, React, long-task, and frame timing.
- The export reports any dropped-event count and unfinished spans.
- The export contains counts and paths but contains none of the typed document text, request/response content, credentials, stable operation identities, resource identities, or query values.
- The same page without `editorTrace=1`, and the normal production host even with that query value, installs no recorder UI or browser observers.

Automated coverage:
- `editorTrace.test.ts` covers ordered span export, shape-only document summaries, error outcomes, unfinished spans, duplicate-end protection, privacy, and default-off behavior.
- `requestJSON.test.ts` covers serialization/fetch/parse timing and removal of query values and payload content.
- `mangoTiptapFoundation.test.ts` covers the quiet timer through snapshot capture, IndexedDB persistence, POST acknowledgement, recovery cleanup, pin/save states, and content exclusion.

### Scenario ED-S1: Shared Editing Semantics Across Target Surfaces

Business logic covered:
- ED1
- ED2
- ED4
- ED5
- ED6
- ED12
- ED13
- ED14
- ED15
- ED16
- ED17
- ED18
- ED19
- ED20
- ED21
- ED28
- ED29
- ED30
- ED31
- ED32
- ED37
- ED38
- ED39
- ED40
- ED53
- ED54
- ED55
- ED61
- ED62
- ED63
- ED64
- ED68

Given:
- A user can edit a Logic Gate body, a node text box, a project text box, a My Triage compose body, a Shared Triage compose body, an attached-email reply body, and a personal/shared mailbox signature.
- A user can open a node from a Project critical-path row and expand a node by clicking its row in the Project Logic Gates / Nodes tab.
- The implementation changes indentation, paste cleanup, list behavior, mention/entity boundaries, hyperlink creation, font size, inline formatting, highlight color, text alignment, table insertion, inline-image preview, the format toolbar, the outline-style dropdown, Delete/Backspace, copy/cut/paste, or keyboard routing.

Expected:
- The behavior change is made in the shared editor behavior source or shared formatting-controller hook.
- Each target surface receives the same user-facing semantics.
- The unified editor target inventory is Logic Gate editor text, node editor text boxes from every full node editor opener, project text boxes/information editors, My Triage compose/reply, Shared Triage compose/reply, attached-email reply bodies that send or draft real mail, and personal/shared mailbox signatures.
- Project critical-path node text boxes and Project Logic Gates / Nodes inline node-editor text boxes receive the same node editor semantics.
- No target surface keeps a separate local implementation that disagrees with the shared behavior.
- Tests cover the shared behavior once and prove each adapter/mount uses that shared behavior.
- Every rich target mounts the one `EditorDocumentSurface` editable host and uses `useEditorDocumentFormattingController`.
- Mail compose/reply adapters do not call browser `document.execCommand` directly for rich editing commands when a shared editor command exists.
- Mail compose/reply, attached-email reply, and signature adapters expose numbered list, indent, outdent, bullet list, Checkbox, font size, bold, underline, italic, strikethrough, highlight color, left/center/right alignment, link, and table controls where table insertion is supported.
- Font size, Bold, Underline, Italic, Strikethrough, Highlight, left/center/right alignment, the outline-style dropdown, and table insertion where supported are supplied by the shared editor toolbar control source rather than a compose-only, signature-only, project-only, Logic Gate-only, node-only, or attached-reply-only toolbar implementation.
- The same visible toolbar styling is used for the format controls wherever the shared toolbar appears.
- Hover, focus, selected, and active styling is scoped to the individual toolbar hitbox rather than painting the entire grouped toolbar; hover uses the bright shared cyan/violet wash, active/selected state uses the stronger cyan-to-violet treatment with dark high-contrast text, focus remains visibly outlined, and disabled state remains subdued.
- Each target DOM has one attachment hydration owner; duplicate passive/layout hydration effects are forbidden, and cleanup runs before external HTML replacement or unmount.
- The outline-style dropdown lists Automatic Numbering, Indent Guides, Bullet Points, and Checkbox from the shared inventory.
- Font-size minus/value/plus actions route through the shared formatting helper/controller for selected text and sticky collapsed-caret formatting; repeated plus/minus clicks retain the saved caret, update its pending size, and format subsequent typing after focus returns.
- Toolbar focus changes do not discard the editor range or pending marks; Bold, Underline, Italic, and Strikethrough toggle off on their second activation, including collapsed-caret Italic typing; Strikethrough uses the shared crossed-out A icon without changing its accessible name; font/highlight state follows the caret, selection, or pending collapsed-caret format; and alignment follows the current paragraph/selection or active-table context.
- Highlight selection, **No highlight**, pending-caret typing, boundary-safe selected-run formatting, and sanitized serialization use one shared split control and command on every target: the main hitbox applies the chosen color without opening the picker, and the arrow opens the picker without applying color.
- Person/entity chips behave as atomic character-like units at their before/after boundaries across adjacent chips, entity-only lines, and lists; navigation, Backspace/Delete, Enter, selection, and undo preserve entity identity and normal line/list behavior.
- New tables expose alignment only through the shared header toolbar and do not inject alignment-icon overlays into a table cell.
- Inline image preview mounts directly in its stable dark, visibly translucent overlay with a square node-style red X, a bottom-right download control, and no transient panel, outline, or geometry jump. The app beneath remains faintly visible without reducing image/control readability. A selected inline image exposes its own bottom-right download control; attachment-backed copies publish portable image clipboard data when supported.
- A one-row list paste inserts at the exact caret without creating a second row; Enter preserves nested child hierarchy; Tab/Shift+Tab keep focus and the caret in the affected list item without consuming the following row.
- Image-to-chat works for both inline data images and hydrated Mango attachment images, and selected text remains highlighted while the chat draft is open and after it is saved, including in nested lists.
- The node + action scrolls and focuses the newly created text box.
- An editable Node with a loaded text box publishes the first text box as its formatting target before any editor click, so the shared toolbar is immediately enabled and hover-responsive without stealing focus; later text-box focus retargets it.
- Project text-box adapters expose the shared node-style format and outline controls and route those actions through the shared editor controller.

### Scenario ED-S2: Domain Persistence Stays Separate

Business logic covered:
- ED1
- ED3
- ED25
- ED37

Given:
- A user edits node, Logic Gate, project, personal email, shared email, and mailbox signature rich content.

Expected:
- Node edits persist to `node_textboxes`.
- Logic Gate edits persist to `logic_gate_textboxes` and manual saves persist to `logic_gate_textboxes_history`.
- Project edits persist to `project_textboxes`.
- Personal email compose/reply sends or drafts through the personal mailbox scope.
- Shared email compose/reply sends or drafts through the selected shared mailbox scope.
- Personal and shared signatures save through their current mailbox-scoped signature record.
- The shared editor behavior does not force unrelated domains into one backend persistence path.

### Scenario ED-S3: Email Compose, Reply, Forward, And Signature Use Unified Rich Editing

Business logic covered:
- ED2
- ED7
- ED8
- ED14
- ED19
- ED20
- ED21
- ED32
- ED33
- ED37
- ED40
- ED71

Given:
- A user writes a personal/shared compose, reply, or forward, an attached-email reply body, or a mailbox-scoped email signature.
- The body contains links, pasted content, rich formatting, indented blocks, or legacy plain text loaded from a draft.

Expected:
- The body editor uses the shared editor behavior.
- Every email body and signature remains on `UnifiedRichEditorSurface`/`EditorDocumentSurface` with rich HTML as its only editable and stored body. Email does not consult the Tiptap workspace gate, write `editor_json_documents`, or maintain JSON/HTML dual state.
- Legacy plain text loads safely as escaped/linkified rich content.
- Sent or saved rich content is sanitized.
- Indented blocks remain indented in sent HTML instead of flattening.
- Numbered-list toolbar actions create or toggle a shared automatic numbered/alphanumerical list item rather than only changing an outline-style setting.
- The visible compose/reply/forward/signature toolbar includes the shared font-size, Bold, Underline, Italic, Strikethrough, highlight split control, and outline-style dropdown used by the main editor; Forward keeps the sanitized original preview locked outside the editable document.
- Font-size controls and both highlight split-button hitboxes restore the prior editor selection before acting. Repeated font-size plus/minus interactions preserve visible pending collapsed-caret size, Italic/Strikethrough remain pending for subsequent collapsed-caret typing, and all reversible inline toggles preserve their final state in serialized HTML.
- Signature content round-trips as sanitized rich editor HTML and inserting it into a message preserves formatting and highlight color.
- A body containing only a pasted attachment-backed image is sendable without adding placeholder text.

### Scenario ED-S4: Chat Is Excluded

Business logic covered:
- ED9
- ED22
- ED56
- ED92

Given:
- A user opens a chat pane inside a node or project text block.
- An email collaboration supplies its participant roster through the optional shared ChatPane header slot, while Node and Project callers omit it.

Expected:
- Chat remains a conversation composer.
- Chat does not show the unified rich editor toolbar.
- Chat does not receive rich editor indentation, paste, delete, list, or font-size semantics.
- Chat-specific quote/prefill and mention behavior can continue independently.
- The email caller's roster renders above the shared conversation, but ChatPane performs no collaboration/member lookup; callers that omit the slot render exactly their existing chat header and behavior.
- Typing `@` or `!` in node, Logic Gate, or chat text opens a people list whose profile color is derived first from normalized user ID, then normalized email, then normalized display name, so the same user keeps the same color between openings and surfaces.
- The shared palette uses opaque, dark profile backgrounds with readable white foregrounds and dark borders. Profile/avatar color remains visible on ordinary, hovered, keyboard-active, and selected suggestion rows and must meet the shared minimum contrast test.
- A keyboard-active rich-editor row adds only a translucent tint of that user's profile color plus the existing active rail; it does not replace the opaque full-color avatar. Chat may retain its existing active-row treatment, but its avatar also remains opaque and full-color.
- Missing optional profile data uses the shared deterministic fallback presentation rather than an uncolored or broken row.
- Typing `#` in the shared Node/Project chat composer searches the same permission-filtered Nodes, Logic Gates, and Projects inventory as the editor; selection stores durable entity identity and sent/reloaded comments render a clickable in-app entity chip.

### Scenario ED-S5: Node And Project Email Picker Is Attach Only

Business logic covered:
- ED10
- ED23

Given:
- A user opens an email picker from a node or project surface.

Expected:
- The picker allows finding, filtering, scrolling, dragging, and attaching an existing email where permitted.
- The picker does not allow composing a new email.
- The picker does not send email, schedule email, save drafts, or mount a compose body editor.

### Scenario ED-S6: Retired Maps Cannot Host Editors

Business logic covered:
- ED11
- ED24

Given:
- A user opens a Node, Logic Gate, or Project editor from any supported route or surviving workspace surface.
- Old browser state may still contain a retired Map frame identifier.

Expected:
- The editor opens through a surviving route and reads no Map frame, geometry, coordinate, or position state.
- Retired Map frames are discarded rather than translated into an editor or replacement canvas.
- No Map module, route, compatibility helper, or editor title surface is restored.

### Scenario ED-S7: Unified Rich-Editor Images Use Mango Attachments

Business logic covered:
- ED2
- ED3
- ED13
- ED26
- ED27
- ED33
- ED34
- ED35
- ED36

Given:
- A user pastes or drops an image into a node text box, Logic Gate editor body, project text box, My Triage compose/reply body, Shared Triage compose/reply body, or attached-email reply body.
- A user separately attaches an image to a node/project chat.

Expected:
- The rich-editor image insertion path comes from the shared editor handler contract.
- Durable saved rich-editor content stores attachment references, not `data:image/...;base64` or durable `dataURL` values.
- For email surfaces, the backend send adapter deduplicates and resolves those references, rewrites outbound image sources to matching `cid:` values, and returns metadata-only attachment fallback data for immediate rendering.
- Each rich-editor surface still saves or sends through its own node, Logic Gate, project, personal mailbox, or shared mailbox adapter.
- Chat attachment behavior follows `docs/tests/attachments.md` as chat attachment behavior and does not become unified rich-editor content.
- Browser file bytes use the direct S3 data plane rather than editor HTML/projection or Mango API byte bodies, while the Mango control plane remains authoritative.
- Node upload progress stays outside the rich document, does not dirty editor content, and refreshes the shared completed-attachment query only after completion.
- Deleting the origin text box keeps the projection deleted and preserves node-owned completed files/attached emails; an authorized in-flight upload may complete without recreating the box.

### Scenario ED-S8: One Rich DOM Host, Shared Formatting Controller, Signature, And Highlight

Business logic covered:
- ED5
- ED13
- ED29
- ED31
- ED32
- ED37
- ED38
- ED39
- ED40

Given:
- A user selects text, places a collapsed caret, or returns to a saved rich selection in any unified editor surface.
- The user changes font size, toggles Bold/Underline/Italic/Strikethrough, applies the current highlight color or opens the highlight picker, changes alignment, or inserts a table from the shared toolbar.
- The active surface may be Logic Gate, node, project, My Triage, Shared Triage, attached-email reply, or personal/shared email signature.

Expected:
- `EditorDocumentSurface` is the only target component that emits the rich `contentEditable` DOM element.
- Each domain host uses `useEditorDocumentFormattingController` and passes its own save/send callbacks to the shared surface instead of reimplementing formatting commands.
- Toolbar interaction restores the last valid editor range before formatting commands run. Only the hitbox under the pointer or keyboard focus receives hover/focus/active styling, and active styling uses the app's vibrant highlight language without obscuring focus or disabled state.
- A non-collapsed range is formatted immediately. At a collapsed caret, repeated font-size plus/minus clicks retain and update visible pending size, the caret/typing height reflects that size after focus returns, and subsequently typed or IME-composed text keeps the chosen size until legitimately changed.
- `EditorTabBar` exposes one shared highlight split button on every target surface. Its main hitbox shows and applies/toggles the chosen color without opening the picker; its arrow hitbox opens the palette without applying color. The palette includes clearly labeled **No highlight**, which removes selected highlighting or clears the active collapsed-caret highlight style.
- Bold, Underline, Italic, and Strikethrough work for selected text and collapsed-caret typing; toolbar focus does not discard pending Italic or Strikethrough state. Left/center/right alignment reports and changes the active paragraph/selected block or active-table context.
- Highlighting one line/list item does not mark the first characters of its following sibling, while an intentional multi-line selection remains supported.
- Table insertion is exposed by the shared toolbar wherever the formatting controller supports it; node/project text-box headers do not render duplicate table buttons, and tables do not inject cell-level alignment-icon overlays.
- `applyEditorHighlightColorToRoot` is the single highlight mutation path.
- The sanitizer preserves only supported safe highlight colors, strips unsupported background styling, and serialized/saved/reloaded rich HTML retains supported highlighting.
- The signature surface mounts `EditorTabBar` and `UnifiedRichEditorSurface`, never a native signature `<textarea>`.

---

## Codex Read-Only Editor Semantics Audit (2026-07-10)

> Attribution: This entire appended audit section was explicitly authored by Codex, the OpenAI coding agent that performed the editor-semantics audit for this repository. These are Codex's findings and observations, not a pre-existing MangoRTS product specification.
>
> Investigation boundary: Codex made no code changes during this audit. The local PowerShell runner failed before every process start with Windows error 1312, so Codex could not inspect uncommitted-only local differences or execute the test suite. To continue without guessing, Codex performed a read-only inspection of the connected GitHub repository, `ScoobyXD/MangoRTSDev`, at remote `main` commit `1d3a3a119d835ae78619fbc5d683459aec30592b`. Any local-only changes after or outside that commit require a follow-up comparison.
>
> Historical-status note: this section records the pre-remediation snapshot at that commit. Its observations about multiple rich DOM wrappers, local formatting controllers, and the native signature textarea explain the defects that prompted ED37-ED40; the required contract and surface inventory above supersede those observations for the implementation end state. Any Map surface or Map title editor mentioned in this historical snapshot has since been deleted and is not a current product contract.

### Codex Audit Summary

The editor is a custom React `contentEditable` implementation, not TipTap, Lexical, ProseMirror, Slate, or another established editor engine. The app has a meaningful shared behavior layer, but it currently mixes three incompatible representations:

1. Automatic decimal/alphabetic/Roman outlines are literal plain text plus five-space indentation.
2. Mango bullet lists and checklists are structural custom `<ul>/<li>` DOM nodes with Mango data attributes.
3. Pasted ordered lists remain native `<ol>/<li>` DOM nodes without Mango list attributes.

That representation split is the central cause of the inconsistent Enter, Tab, Shift+Tab, paste, copy, image, and list behavior documented below.

### Rich-Editor Surface Inventory

The declared unified surface IDs and persistence boundaries live in `frontend/src/modules/editor/unifiedRichEditorContract.ts`.

| Surface | Runtime wrapper and shared behavior | Surface-specific differences | Persistence boundary |
|---|---|---|---|
| Logic Gate editor body | `EditorContent` mounts `EditorDocumentSurface` and calls `useEditorDocumentSurfaceHandlers` | Shared toolbar including table insertion, company mentions, and inline images | `logic_gate_textboxes` |
| Node text box | `EditorContent` mounts `NodeWorkspaceSurface`, whose blocks use `NodeTextBlockEditor` and the shared handler | Mentions, inline images, shared-toolbar table insertion, text/image comment actions, content-change overlays, attached-email pane, and separate chat pane | `node_textboxes` |
| Node editor opener variants | Home, sidebar, dock restore, Updates, Kanban/My Work, Company Explorer, and Project critical-path windows all mount the same node workspace | Opener chrome and state differ, but the text engine is the same | `node_textboxes` |
| Project text box | Project Summary directly reuses `NodeTextBlockEditor` | Same rich behavior as a node block, plus project-specific saving; its chat and attached-email panes stay separate | `project_textboxes` |
| My Triage compose/reply/forward | `ComposePanel` mounts `UnifiedRichEditorSurface` with `my-triage-compose` | Compact Format + Outline toolbar, no company mention users, email-draft attachment ownership; Forward adds a locked sanitized original preview outside the editor | Personal mailbox draft/send |
| Shared Triage compose/reply/forward | The same `ComposePanel` selects `shared-triage-compose` when a shared inbox is active | Same editing and locked-forward-preview behavior as My Triage; mailbox and attachment ownership differ | Shared mailbox draft/send |
| Email collaboration shared draft | The same `ComposePanel` selects `email-collaboration-shared-draft` for a revisioned participant draft | Same editor, selection, toolbar, inline-image, and flush behavior; collaboration participation and revision replace mailbox ownership | Collaboration-scoped shared draft/send |
| Attached-email reply | The attached-email pane mounts `UnifiedRichEditorSurface` with `attached-email-reply` | Compact Format + Outline toolbar, no company mentions; inline and file attachments use the attached-email resource | Component-local reply body until direct send |

There are three separate rich-editor DOM wrappers even though they share the same handler:

- Full linked document: `frontend/src/modules/editor/EditorDocumentSurface.tsx`.
- Node/project text block: `NodeTextBlockEditor` in `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx`.
- Mail adapter: `frontend/src/modules/editor/UnifiedRichEditorSurface.tsx`.

Only the mail adapter emits `data-mango-unified-rich-editor`. Node, project, and Logic Gate surfaces rely on source wiring rather than a common runtime surface identity.

### Plain And Intentionally Excluded Writing Surfaces

These surfaces do not inherit the rich editor's list, indentation, paste, image, or formatting semantics:

- Node/project chat composer: native textarea. Enter sends, Shift+Enter inserts a newline, and Tab accepts an open mention or follows normal focus behavior.
- Email signature editor: native textarea with ordinary browser Enter and Tab behavior.
- Header and map title editors: single-line `contentEditable` fields that commit on Enter and cancel on Escape.
- Search, recipient, metadata, project-title, due-date, and critical-path fields: ordinary form inputs.
- Node/project email picker: attach/select UI only, not a compose editor.
- Legacy Map editing: outside the V1 unified rich-editor contract unless it imports a live shared helper.

### Typography, Spacing, And Preference Rules

- A keyboard Tab outside structural lists and tables is exactly five literal ASCII spaces: `EDITOR_TAB_TEXT = "     "`.
- CSS `tab-size` is also set to five so pasted literal tab characters use five-space tab stops.
- Logic Gate/full linked documents default to 15px text with 1.55 line height.
- Node and project text blocks use 14px text with 1.45 line height.
- My/Shared Triage compose uses approximately 12px text with 1.45 line height.
- Attached-email reply explicitly uses 12px text with 1.35 line height.
- All three rich wrappers currently use `white-space: pre-wrap`, aggressive word breaking, and hidden horizontal overflow.
- Mango structural lists use 20px list padding and 24px item padding. Nested lists add approximately another 48px of structural indentation per level.
- Bullet marker shapes rotate by structural depth: solid circle, hollow circle, solid square, hollow square, then repeat.
- Automatic numbering rotates by five-space depth: decimal, alphabetic, Roman, then repeat.
- Indent-guide depth is the floor of leading whitespace columns divided by five. A literal tab counts as five columns.
- An entirely empty blank line inherits the preceding nonblank line's guide depth so vertical guides continue through it.
- Indent-guide horizontal positions assume an app-font space width of 0.25em, so each five-space level advances 1.25em.
- Changing the Outline Style affects future input. It does not convert or rewrite existing content or an existing structural list.
- Logic/node outline preference persists by company plus editor widget scope, not by document. The same node can therefore use different modes in different opener windows.
- Project outline preference persists per company/project.
- Mail compose and attached-email reply initialize to Automatic Numbering with component state and reset on remount. The outline mode is not stored in the draft.

### Current Enter, Tab, And Shift+Tab Matrix

| Context | Enter | Shift+Enter | Tab | Shift+Tab |
|---|---|---|---|---|
| Ordinary text in Automatic Numbering mode | Plain newline unless the current line parses as an outline marker | Plain newline with continuation disabled and no copied automatic indentation | Five spaces unless the line parses as an outline item | Removes leading indentation; a parsed marker moves toward the parent marker family |
| Parsed automatic outline item | Nonempty items continue the current marker and delimiter; empty root or nested items exit numbering and leave only their indentation | Inserts a raw newline without copying the item's indentation | Adds one five-space depth and changes family decimal -> alpha -> Roman -> decimal | Removes one five-space depth and recomputes the marker for the destination depth; a root item removes the marker |
| Indent Guides mode | Newline plus the current line's exact leading whitespace | Same as Enter | Inserts five literal spaces at the selection | Removes one leading tab or up to five leading spaces from the start of the active line |
| Bullet/Checklist mode outside a structural list | Creates a new structural list at the insertion point; a whitespace-only line becomes the first item | Inserts a soft newline and copies the current leading whitespace | Inserts five spaces | Removes leading whitespace from the active line |
| Existing Mango bullet/checklist item | Splits a nonempty item; an item classified as empty exits the list | Inserts a soft newline inside the same item | Nests the current item under its previous sibling | Moves the current item outward by one structural list level |
| Root Mango list item without a previous sibling | Normal list Enter behavior | Soft newline | Tab is prevented but cannot indent, so it is a swallowed no-op | Shift+Tab is prevented but cannot outdent, so it is a swallowed no-op |
| Table cell | Inserts a `<br>`; Bullet/Checklist mode may convert the entire cell to a list | Inserts a `<br>` | Inserts one editor indent in the current cell and keeps focus/caret there | Performs the shared outdent or a prevented no-op and keeps focus/caret in the current cell |
| List inside a table cell | Enter gets special list handling | Soft line break | Nests the current structural item without navigating cells | Outdents the current structural item without navigating cells |
| Mention menu open | Accepts the highlighted mention | Also accepts the highlighted mention | Accepts the highlighted mention entity | Runs the current editor outdent and does not accept the mention |
| Selected image | General Enter behavior; there is no dedicated image Enter contract | General Shift+Enter behavior | General Tab behavior after the image selection is cleared | General Shift+Tab behavior |
| Pasted sanitized ordered-list item | Splits the active item and leaves the caret in the new row | Soft newline | Nests the active row under its previous sibling and preserves the caret | Moves the active row outward by one structural list level |

### Automatic Numbering Rules

- The recognized marker grammar accepts digits, dotted digits, or any alphabetic word followed by `.` or `)`, with optional spacing.
- Depth zero expects decimal markers, depth one alphabetic markers, and depth two Roman markers; the families repeat every three levels.
- Enter increments the current marker for nonempty outline items. It does not renumber the rest of the outline.
- Tab and Shift+Tab recompute only the active line's marker based on previous lines at the destination depth.
- A newly typed first non-whitespace character on an indentation-only line automatically receives the next marker for that depth.
- Marker delimiter and spacing are preserved when possible.
- A blank automatic item exits numbering. Enter on `2. ` leaves a plain blank line after the previous item, and Enter on a nested empty alphabetic item such as `     a. ` leaves a five-space indented blank line instead of creating `     b. `.
- Top-level Shift+Tab removes the automatic marker and leaves the item body as plain text.
- Backspace treats an empty automatic marker atomically and removes it back to the previous plain line/indentation.
- Shift+Enter in a nested automatic item creates an unindented next line rather than a visually aligned soft line.
- The parser is over-broad: ordinary text such as `Note. details` is parsed as an outline marker. Tab or numbered-toggle commands can rewrite it as a list item.
- Marker text is normalized to lowercase when parsed and rewritten.
- Pasted top-level alphabetic or Roman marker text does not reliably continue because the expected marker family is tied rigidly to indentation depth.
- Numbered-list toggle behavior, where reachable through a controller, affects only the active line rather than a multiline selection.

### Indent Guides And Plain Indentation Rules

- Enter copies the line's exact leading spaces, tabs, and nonbreaking spaces.
- Tab inserts five spaces at the caret.
- Shift+Tab removes one literal leading tab, or up to five leading spaces, from the active line.
- Shift+Tab acts on only the line containing the selection start; it does not outdent every selected line.
- A mixed indentation prefix such as spaces followed by a tab can require multiple Shift+Tab presses because removal handles the leading space run first.
- Backspace collapses exactly five consecutive literal spaces immediately before the caret when all five are on the same line.
- Backspace does not atomically remove an arbitrary partial indentation run or a literal tab through the shared helper; those fall back to browser behavior.
- Indent guides are visual overlays only. They are not semantic DOM nodes and are recomputed from the plain-text projection.

### Structural Bullet And Checklist Rules

- Native pasted `<ul>` elements are converted into Mango structural bullet lists.
- New bullet/checklist items are created with `<li data-mango-editor-list-item>`.
- New checklist items start unchecked.
- Clicking the checklist marker toggles `data-mango-editor-checklist-checked`.
- There is no keyboard command, checkbox role, or checked-state announcement for toggling a checklist item.
- Enter in a nonempty item splits at the caret.
- Enter in an item considered empty exits the list.
- Backspace at a collapsed caret in an empty item exits that one item. A noncollapsed selection spanning empty bullet/checklist rows remains a native selected-range deletion, even when its placeholder-only rows flatten to identical text offsets.
- Tab nests only if the item has a previous sibling.
- Shift+Tab outdents only if the item is already inside a nested list.
- Tab/Shift+Tab affect one active item, not every selected list item.
- Changing the Outline Style while the caret is already in a structural list does not change that list's kind. Enter continues the existing bullet/checklist kind.
- Checklist checked state survives Mango rich HTML save and rich HTML copy.
- Plain-text copy contains only item text; it loses the bullet marker, checklist marker, and checked state.

### Table Keyboard Rules

- Tab and Shift+Tab stay inside the active cell and route through shared indent/outdent behavior rather than navigating between cells.
- A structural list inside a cell receives the same row nesting/outdent behavior as a list outside a table.
- Enter inserts a line break in an ordinary cell.
- In Bullet/Checklist mode, typing into an empty cell can start a structural list.
- In Bullet/Checklist mode, Enter in a nonempty ordinary cell can wrap all editable cell content into a first list item and append an empty item, regardless of the caret split point.
- Automatic Numbering does not receive special continuation behavior in table cells.
- Table paste normalizes to at most 20 rows and 8 columns.
- Pasted tables force the first row and first column into Mango header semantics, even if the source table did not define both as headers.

### Other Editing Rules

- Ctrl/Cmd+Z and redo shortcuts route through a custom editor undo history.
- Ctrl/Cmd+B and Ctrl/Cmd+U remain browser rich-text commands, while Bold, Underline, Italic, and Strikethrough toolbar actions share selection restoration and pending-caret command state; all mutations are subsequently sanitized and saved.
- Font size is clamped to 10-28px for toolbar operations.
- A collapsed caret can hold pending font size, Italic, Strikethrough, and highlight typing styles for the next typed or IME-composed characters; repeated font-size plus/minus interactions preserve and update that state, and **No highlight** records an explicitly unhighlighted pending state.
- Escape inside the editable document clears editor selections/menus and blurs the document, which also flushes pending persistence. Toolbar inputs and popovers follow the focus-preserving cancellation rules in ED32.
- Pasted and legacy plain-text URLs are linkified only for HTTP(S) URLs.
- Typing a URL does not generally create a link automatically.
- Clicking an existing link opens it in a new tab rather than placing the caret in it.
- Mention Enter and plain-Tab acceptance take priority over newline and indentation behavior while the people picker is open; Shift+Tab remains the editor outdent command.
- Mention/entity nodes are noneditable atomic spans that retain their identity and appearance while behaving as one character at their before/after boundaries. Navigation, range selection, Backspace/Delete, Enter, line joining/splitting, lists, adjacent entities, and undo must not create dead zones or first downgrade an entity to ordinary text.
- Images are noneditable frames. Clicking selects them and exposes a bottom-right download button, dragging moves them, edge/corner dragging resizes them, double-click opens the stable dark fullscreen preview with its square node-style red X and image download button, and Delete/Backspace removes a selected image.
- Image insertion always adds a clear break and a caret node after the frame.
- Table insertion is a shared-toolbar command wherever the host supplies the table capability; compact hosts may omit it only through that explicit capability boundary. Node/project text-box headers do not duplicate the shared toolbar button, and table cells do not render their own alignment-icon overlay.

### Paste And Drop Priority

Paste and drop share this priority order:

1. If the transfer exposes any image file, the first image file is uploaded and inserted.
2. Otherwise, if HTML contains a recognized Mango image frame or safe raster data image, the first matching image is uploaded/reused and inserted.
3. Otherwise, sanitized HTML is inserted.
4. If sanitized HTML is empty, plain text is escaped, safe URLs are linkified, and the resulting HTML is inserted.

Consequences of this priority:

- An image file wins over all accompanying HTML and text.
- HTML containing text, lists, and one or more recognized images is reduced to only the first image.
- Multi-image paste inserts only one image.
- An image upload failure does not fall back to the accompanying HTML or plain text.
- The same loss occurs on drop.
- Remote HTTP(S) image sources are dropped rather than fetched or proxied.
- Raster `data:image` PNG/JPEG/GIF/WebP sources are accepted into the upload flow.
- SVG data images are rejected.
- Durable saved editor content uses `mango-attachment:` references rather than base64 file bytes.

### Rich HTML Sanitization And Paste Cleanup

The browser sanitizer:

- Preserves safe HTTP(S) anchors and normalizes them to new-tab links.
- Removes unsafe link schemes while retaining the link label.
- Preserves `b`, `strong`, `u`, `i`, and `em`.
- Preserves safe inline span font sizes between 6px and 96px.
- Removes source font-family and color styling.
- Preserves safe inline block `margin-left` or `padding-left` values.
- Converts blockquotes to an indented div when no explicit safe indentation is present.
- Preserves Mango mentions, image frames, tables, bullet lists, and checklists.
- Converts native `<ul>` to Mango bullets.
- Preserves native `<ol>` as native ordered lists.
- Preserves Unicode left- and right-arrow characters during sanitization.
- Trims leading/trailing newline text nodes at the paste fragment boundary.

It does not fully preserve common source structures:

- Ordered-list `start`, `reversed`, `type`, and item `value` attributes are discarded.
- Alphabetic, Roman, reversed, or non-1 native ordered lists therefore change visual numbering.
- External task-list checkbox inputs are discarded, so their list becomes an ordinary bullet list.
- Headings and other unrecognized block tags have their children appended without a block newline. For example, `<h1>Title</h1><p>Body</p>` can become `TitleBody`.
- Class-based indentation is discarded.
- Inline CSS indentation can remain visually indented but is not converted to five-space semantic indentation, so Shift+Tab cannot remove it.
- Tab after such a block adds literal spaces on top of the visual CSS margin, mixing two indentation systems.
- Boundary cleanup removes only root newline text nodes. Empty wrappers such as `<div><br></div>` and `<p><br></p>` can survive and add blank rows.
- Source font-size units are parsed numerically and rewritten as pixels. For example, 12pt can become 12px rather than its CSS-equivalent pixel size.
- CSS-only bold/underline formatting can be lost when the source does not use semantic tags.
- Plain-text bullets such as `- item`, `* item`, or `- [x] item` are not parsed into structural Mango lists.

### Copy And Cut Rules

- A selected rich DOM range is copied as sanitized `text/html` plus `text/plain`.
- A selection inside one Mango list item is wrapped in a Mango list fragment so rich paste can preserve the list kind.
- A selection across structural list content attempts to preserve Mango list attributes in rich HTML.
- Plain-text list copy contains item text but not generated bullet/check markers or checklist state.
- Range copy that includes an image can preserve the frame in rich HTML, but the plain-text output has no image placeholder beyond any surrounding text.
- A custom-selected image uses a dedicated copy path. Attachment-backed images reload original bytes for a standards-supported image MIME clipboard item and portable data-image HTML, while sanitized Mango frame HTML remains the synchronous fallback.
- A dedicated image `onCut` path copies successfully before deleting the selected frame.

### Complete Codex Findings Register

The following findings are ordered roughly by user impact and architectural significance.

#### Finding 1: Pasted Ordered Lists Use The Wrong Semantic Engine

Expected:
- Pasted numbered, alphabetic, and Roman lists should split, nest, outdent, and exit consistently with Mango automatic outlines.

Actual:
- The sanitizer creates native `<ol><li>` nodes.
- Structural key routing recognizes only `li[data-mango-editor-list-item]` under Mango custom `<ul>` nodes.
- Enter therefore runs generic text insertion rather than structural item splitting.
- Tab inserts spaces rather than nesting.
- Shift+Tab performs plain-text outdent rather than structural lifting.
- The visible browser marker is not present in `readEditorDocumentText`, so the automatic plain-text engine cannot infer it.
- Ordered-list start, type, reversed, and per-item values are lost on sanitation.

Primary references:
- `frontend/src/modules/editor/richTextEditing.ts:457-472`
- `frontend/src/modules/editor/richTextEditing.ts:688-695`
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:1265-1300`
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:4081-4237`

#### Finding 2: Mixed Image And Text Paste Loses Everything Except The First Image

Expected:
- Preserve the full clipboard fragment, including text, lists, images, and their order.

Actual:
- The image-file path selects the first image and returns.
- The HTML image path selects the first Mango frame or first safe image and returns.
- Surrounding text, list structure, and every additional image are discarded.
- The same behavior exists for drop.
- Upload failure does not fall back to the remaining clipboard representations.

Primary references:
- `frontend/src/modules/editor/editorImages.ts:201-219`
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:3613-3631`
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:3678-3698`

#### Finding 3: Image-Only Bullet Or Checklist Items Are Classified As Empty

Expected:
- An image is meaningful list-item content.

Actual:
- Item emptiness checks only the item's own text nodes.
- An image-only item therefore counts as empty.
- Enter or Backspace invokes list-exit behavior, removes the entire `<li>`, and can delete the image.
- Typing after an image-only item uses the empty-item path and can insert text before the image rather than after it.

Primary references:
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:1302-1327`
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:1336-1402`
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:4081-4131`

#### Finding 4: The Editor Uses Incompatible Caret-Offset Models

Expected:
- A single canonical DOM-to-plain-text position map should govern selections, list calculations, edits, undo restoration, images, line breaks, tables, and blocks.

Actual:
- `getEditorSelectionOffsets` uses `Range.toString()`.
- `setEditorSelectionByOffsets` walks text nodes only.
- `readEditorDocumentText` counts `<br>` and synthesizes block/table newlines.
- `locateEditorPlainTextBoundary` uses yet another mapping and explicitly counts `<br>`.
- Images contribute no plain text, but insertion adds a clear break that some maps count and others do not.
- Native lists and block elements can therefore shift later edit offsets.
- Automatic markers, outdents, selection restoration, or edits after images/blocks can land at the wrong DOM boundary.

Primary references:
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:214-269`
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:1705-1805`
- `frontend/src/modules/editor/richTextEditing.ts:873-946`

#### Finding 5: Empty-Item Exit Loses The List Position

Expected:
- Exiting an empty middle item should split the list at that location.
- Exiting a nested empty item should create an outdented sibling.

Actual:
- The item is removed.
- If the list still has any items, one newline is placed after the entire list.
- Exiting an empty middle item jumps the caret after every later sibling.
- In a nested list, the newline is inserted inside the parent `<li>` rather than as an outdented sibling.

Primary reference:
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:1640-1653`

#### Finding 6: Persisted Image Copy And Cut Are Broken Or Destructive (Resolved)

Expected:
- Copy should place usable image HTML/data on the clipboard.
- Cut should copy successfully before deleting.

Current behavior:
- Hydrated and nonhydrated durable images use their attachment ID to reload original bytes.
- Async Clipboard receives the supported image MIME, portable data-image HTML, and filename text; the synchronous editor clipboard keeps sanitized Mango HTML.
- Copy reports handled only after the synchronous representation is written, and image cut runs that copy path before deletion.

Primary references:
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:2242-2250`
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:4058-4066`
- `frontend/src/modules/editor/editorImages.ts:53-57`
- `frontend/src/modules/editor/editorImages.ts:173-198`
- `frontend/src/modules/editor/editorImages.ts:382-393`

#### Finding 7: Structural List Enter Can Move Existing Child Hierarchy (Resolved)

Expected:
- Splitting a parent item at the end of its text should leave an existing child list attached to the intended parent.

Current behavior:
- The split range ends before the direct nested list, so Enter can split the parent's own content without moving its existing child hierarchy.

Primary reference:
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:1550-1577`

#### Finding 8: Tab Selection Retains Content (Resolved)

Expected:
- Indent selected lines/items while retaining their content and a useful selection.

Current behavior:
- Outside a structural list, Tab prefixes one five-space editor indent to every selected line while retaining its content and useful selection bounds.
- Shift+Tab removes one shared indent from each selected line without navigating focus.
- Structural-list Tab/Shift+Tab applies the shared nest/outdent command to the active item and preserves its text, caret, following rows, and editor focus.
- Mounted interaction and plain editing tests lock in the non-destructive behavior.

Primary references:
- `frontend/src/modules/editor/plainTextEditing.ts:254-272`
- `tests/frontend/modules/editor/plainTextEditing.test.ts:10-18`

#### Finding 9: Automatic Numbering Lacks Normal List-Exit Semantics

Expected:
- Enter on an empty item, Shift+Tab at the root, or Backspace at an empty marker should offer a predictable way to leave numbering.

Actual:
- Empty `2. ` continues to `3. `.
- Root Shift+Tab is prevented but normally changes nothing.
- Backspace removes marker text character by character.
- Shift+Enter in a nested item inserts an unindented line.
- Structural bullet/checklist exit rules therefore differ materially from automatic numbering.

Primary references:
- `frontend/src/modules/editor/plainTextEditing.ts:275-303`
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:4136-4237`

#### Finding 10: Automatic Marker Parsing Accepts Ordinary Sentences

Expected:
- Only valid, intentionally list-like marker tokens should activate outline rewriting.

Actual:
- The marker grammar accepts any alphabetic word followed by `.` or `)`.
- `Note. details` is therefore treated as a parsed list item.
- Tab, Shift+Tab, or numbered-toggle can replace `Note.` with a generated marker.
- Parsed marker case is forced to lowercase.

Primary reference:
- `frontend/src/modules/editor/plainTextEditing.ts:84-96`

#### Finding 11: Table Tab Routing No Longer Navigates Cells (Partially Resolved)

Expected:
- Lists inside cells should have an explicit and consistent nesting/outdent contract.

Current behavior:
- Tab/Shift+Tab never navigates to another cell or leaves the editor. Ordinary table-cell text receives the shared indent/outdent behavior, while a structural list inside a cell uses the shared list nest/outdent command.
- Table-cell detection remains for table-specific Enter and deletion behavior.
- In Bullet/Checklist mode, Enter in a nonempty ordinary cell can wrap the entire cell as a list instead of splitting at the caret.
- Automatic numbering does not continue inside cells.

Primary references:
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:1597-1638`
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:3975-4032`

#### Finding 12: Rich Paste Loses Common Document Structures

Expected:
- Preserve meaningful headings, ordered-list variants, task-list state, block boundaries, and removable indentation.

Actual:
- Native ordered-list metadata is discarded.
- External task-list checkboxes become ordinary bullets.
- Headings and other unrecognized block tags can concatenate with adjacent blocks.
- Empty block wrappers can create blank rows.
- CSS/class indentation and five-space indentation are not normalized into one model.
- Source font-size units can be rewritten incorrectly as pixels.
- CSS-only inline formatting may disappear.

Primary reference:
- `frontend/src/modules/editor/richTextEditing.ts:429-729`

#### Finding 13: Same-Kind Structural List Paste Ignores The Caret Split (Partially Resolved)

Expected:
- Pasting list items in the middle of an item should preserve text before and after the caret in a predictable list structure.

Current behavior:
- A single same-kind list item without a nested child is unwrapped and inserted exactly at the collapsed caret in the current row, including at its first character.
- Multi-item, nested, noncollapsed, or mixed-kind paste retains the existing structural-fragment behavior and remains a follow-up area for a fuller split/merge contract.

Primary reference:
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:448-528`

#### Finding 14: The Toolbar Contract And Visible Implementation Disagree

Expected by this document's scenarios:
- Numbered-list, indent, outdent, bullet, checklist, link, and table actions should call shared controller commands.

Actual:
- Controllers define `toggleNumberedList`, `indent`, `outdent`, `insertList`, and `insertLink`.
- The visible toolbar exposes font size, bold, underline, and Outline Style.
- The Outline Style menu changes future input mode; it does not invoke numbered-list toggle or convert the current selection.
- Code search found no production caller for several controller list/link commands.
- Mail contract tests explicitly require old numbered-list, indent, outdent, bullet-list, checklist, link, and table toolbar labels/callers to be absent, contradicting ED14/ED28 and Scenario ED-S1/ED-S3.
- A right-click Create Table command remains available through the shared context menu even where the toolbar says table insertion is unsupported.

Primary references:
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:1417-1496`
- `frontend/src/modules/editor/UnifiedRichEditorSurface.tsx:221-328`
- `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts:14-126`
- `docs/tests/editor.md:127-135`

#### Finding 15: Checklist Semantics Are Pointer-Only And Do Not Travel In Plain Text

Expected:
- Checklists should remain semantically checklists for keyboard users, clipboard fallbacks, and outbound email.

Actual:
- Marker clicking is the only check/uncheck input path.
- Items do not expose checkbox roles or keyboard toggles.
- Plain-text copy loses both the checkbox marker and checked state.
- The email body includes Mango data attributes but does not include the editor's checklist pseudo-element CSS.
- External email clients and the app's email iframe therefore render checklist items as ordinary bullets, with checked and unchecked items visually indistinguishable.

Primary references:
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:1685-1697`
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:3788-3798`
- `frontend/src/modules/editor/richTextEditing.ts:820-855`
- `frontend/src/index.css:682-740`

#### Finding 16: Root Shift+Tab Is Swallowed For Structural Lists

Expected:
- Define whether root Shift+Tab exits a list or leaves browser focus behavior intact.

Actual:
- Keydown always prevents default when a Mango list item is active.
- `outdentEditorListItem` returns false at the root because there is no parent list item.
- The result is a silent no-op.

Primary references:
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:1674-1683`
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:4103-4120`

#### Finding 17: Paste Boundary Cleanup Is Too Narrow

Expected:
- Selected inline paste should not add source-only blank rows around the fragment.

Actual:
- Cleanup trims only leading/trailing newline text nodes at the fragment root.
- Empty div/paragraph wrappers with `<br>` remain.
- Indented blocks can also carry both block layout and an explicit trailing newline, producing spacing that differs between the editor and email HTML.

Primary references:
- `frontend/src/modules/editor/richTextEditing.ts:759-779`
- `docs/tests/editor.md:14-17`

#### Finding 18: Selected Durable Image Copy Reports Success Even When Nothing Was Written (Resolved)

This is the focused clipboard-state portion of Finding 6:

- `copySelectedEditorImage` now requires the synchronous HTML/text write to succeed before it reports handled and separately publishes the richest supported async image payload.

#### Finding 19: Rich Text Defines Custom Copy But No Custom Cut (Image Case Resolved)

- The shared handler now provides a dedicated custom-selected-image cut path that copies before deletion. Native range-cut semantics for arbitrary mixed custom lists/mentions remain outside this focused image fix.

Primary reference:
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:113-130`

#### Finding 20: Image Paste And Upload Are Asynchronous Against A Live Range

Static risk:
- Paste clones a Range and starts an asynchronous file preparation/upload.
- The user can continue typing or move the selection while upload is in flight.
- The stored Range is live and may move as the DOM changes.
- The eventual image insertion uses that old/live range if it remains inside the editor.
- The undo-before snapshot was captured before the upload and can therefore span unrelated typing that happened while waiting.

Primary references:
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:1148-1257`
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:3613-3631`

#### Finding 21: Cross-Surface Attachment Image Copy Reuses Ownership Without Reattachment

Static risk:
- Clipboard image data containing an attachment ID is inserted directly with that same ID.
- The target editor does not upload a new attachment or explicitly create a new target-resource relationship in that branch.
- Copying an inline image from one node/project/draft to another can therefore leave lifecycle and ownership tied to the source resource.

Primary reference:
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:1191-1226`

#### Finding 22: Image-Only Mail Drafts Can Be Deleted Or Skipped

Expected:
- If an attachment-backed image counts as sendable body content, it must also count as draft content.

Actual:
- `editorBodyHasEmailContent` explicitly recognizes an image-only Mango attachment body.
- `composeHasDraftContent` converts rich HTML to text by stripping every tag.
- An inline image contributes no text.
- A draft containing only an inline image can therefore be considered empty and deleted or not saved.

Primary references:
- `frontend/src/pages/home/homeMailDrafts.ts:369-409`
- `frontend/src/modules/editor/richTextEditing.ts:857-867`

#### Finding 23: Rich Draft Snippets Can Expose Marker And HTML Text

- `homeMailDraftToMessage` derives the list snippet directly from the raw stored editor body.
- The `mango-editor-html-v1` marker and serialized tags can leak into the draft preview/snippet instead of a sanitized plain-text summary.

Primary reference:
- `frontend/src/pages/home/homeMailDrafts.ts:454-462`

#### Finding 24: Indent-Guide Vertical Metrics Drift On Compact Mail Surfaces

Expected:
- The guide overlay should use the same actual font size and line height as the editable content.

Actual:
- `UnifiedRichEditorSurface` computes segment top/height with the global 15px x 1.55 metric.
- The overlay's visible font style can be overridden by the mail surface.
- My/Shared Triage and attached reply render around 12px with 1.45 or 1.35 line height.
- Guide segments therefore drift vertically from their lines as line count increases.

Primary reference:
- `frontend/src/modules/editor/UnifiedRichEditorSurface.tsx:102`
- `frontend/src/modules/editor/UnifiedRichEditorSurface.tsx:353-368`

#### Finding 25: Indent-Guide Typography Documentation Contradicts Runtime

- `docs/frontend/src/modules/editor.md` says Indent Guides must use matching monospace metrics.
- `getEditorDocumentFontFamily` ignores the outline style and always returns the proportional Mango app font.
- `editorIndentGuideLeftForDepth` now uses a hard-coded 0.25em space-width estimate instead.
- The documentation and implementation describe different approved behavior.

Primary references:
- `docs/frontend/src/modules/editor.md:95-106`
- `frontend/src/modules/editor/useEditorPreferences.ts:22-25`
- `frontend/src/modules/editor/editorIndentGuides.ts:7-17`

#### Finding 26: Long-Line Documentation Contradicts Every Wrapper

- The editor documentation promises horizontal overflow and no wrapping for long lines.
- All three wrappers use `pre-wrap`, `overflow-wrap: anywhere`, `word-break: break-word`, and hidden horizontal overflow.

Primary references:
- `docs/frontend/src/modules/editor.md:87`
- `frontend/src/modules/editor/EditorDocumentSurface.tsx:213-223`
- `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx:1316-1318`
- `frontend/src/modules/editor/UnifiedRichEditorSurface.tsx:479-485`

#### Finding 27: The Same Node Can Have Different Outline Modes By Opener

- The preference key includes editor/widget scope rather than the document/entity ID.
- Home, Updates, Kanban, sidebar, dock, and project inline windows create distinct scopes.
- The same underlying node document can therefore behave as Automatic Numbering in one opener and Bullet/Checklist/Indent Guides in another.

Primary reference:
- `frontend/src/modules/editor/EditorContent.tsx:591-635`

#### Finding 28: Mail Outline Mode Does Not Persist

- Compose/reply and attached-email reply each initialize local state to Automatic Numbering.
- Mode changes are not stored in local storage, the draft, or the outgoing editor body.
- Closing/remounting the surface resets the mode.

Primary references:
- `frontend/src/pages/home/HomeParts.tsx:4933`
- `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx:4188`

#### Finding 29: Project Text Boxes Leak Node Identity

- Project text boxes reuse `NodeTextBlockEditor`.
- The DOM emits `data-node-text-block-id`.
- Accessibility announces `aria-label="Node text block"` even when the persistence owner is a project.

Primary reference:
- `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx:1211-1213`

#### Finding 30: Mail Placeholder Text Appears Unwired

- `UnifiedRichEditorSurface` emits `data-placeholder`.
- Repository CSS contains no matching empty-editor pseudo-element using `content: attr(data-placeholder)`.
- The supplied Message/Reply placeholder may therefore never be visible.

Primary reference:
- `frontend/src/modules/editor/UnifiedRichEditorSurface.tsx:380-388`

#### Finding 31: Sanitized Saved HTML And The Live DOM Can Diverge

Static risk:
- Native browser input mutates the live `contentEditable` DOM.
- `onInput` marks the bounded ED77 batch dirty; the batch flush later serializes and sanitizes the live DOM once for undo and persistence.
- It does not replace the current live DOM with the sanitized result.
- Continued key handling can therefore operate on browser-generated divs, native list mutations, or other transient structures that differ from what reload will restore.
- A save/reload round trip can visibly change structure or caret behavior.

#### Finding 32: Urgent Mention Kind Is Not Preserved By Sanitization

Static code-path finding:
- Urgent mentions use `data-mango-mention-kind="urgent"`.
- The mention sanitizer creates a new mention span and copies the user ID.
- It does not copy the urgent-kind attribute before applying mention style.
- A saved/reloaded urgent mention retains its visible text but loses urgent metadata/styling.

Primary references:
- `frontend/src/modules/editor/editorMentions.ts:27-34`
- `frontend/src/modules/editor/richTextEditing.ts:652-664`

#### Finding 33: Manual Link Creation Is Effectively Unreachable

- A shared `applyEditorLinkToRoot` helper and mail adapter `insertLink` controller method exist.
- The visible shared toolbar has no Create Link control.
- Main node/project/Logic Gate formatting controllers do not expose the same manual link path consistently.
- Production code search found no visible caller for the adapter's `insertLink`.
- Users primarily obtain links through pasted/legacy URL linkification.

#### Finding 34: Automatic And Structural Lists Have Different Persistence Semantics

- Automatic outlines persist marker characters and five spaces as text.
- Bullets/checklists persist custom semantic DOM attributes.
- Native ordered lists persist browser list DOM.
- Plain-text extraction drops custom markers but retains automatic marker characters.
- Copy, search, chat anchoring, email serialization, and downstream consumers therefore see different representations for conceptually similar lists.

#### Finding 35: Checklist Email Rendering Loses Checked State

- In-editor checkbox visuals come exclusively from selectors in `frontend/src/index.css`.
- Outgoing email and iframe display wrappers do not include those selectors or inline checkbox glyphs.
- Checked and unchecked checklist items become ordinary list items outside the editor.
- The data attribute remains in HTML but has no visual/semantic effect for normal email clients.

#### Finding 36: Structural List Plain-Text Copy Loses Markers

- Rich HTML copy can preserve Mango attributes.
- `text/plain` uses `Range.toString()`, which contains item text but not generated pseudo-element bullets/check boxes.
- Pasting into plain-text destinations destroys the list/checklist meaning.

#### Finding 37: Pasted Visual Block Indentation Cannot Be Shift+Tabbed

- The sanitizer can preserve a safe `margin-left` or `padding-left`.
- Plain text contains no matching leading spaces for that CSS indentation.
- Shift+Tab searches for whitespace at the line start and cannot remove the visual margin.
- Tab then mixes five literal spaces with the existing CSS margin.

#### Finding 38: Source Font-Size Units Are Not Converted Correctly

- `applySafeFontSize` runs `parseFloat` against the source inline size and emits that number in pixels.
- A source size such as 12pt can become 12px.
- Relative units may be discarded or materially changed.

Primary reference:
- `frontend/src/modules/editor/richTextEditing.ts:119-125`

#### Finding 39: Image-Only Content Has Inconsistent Meaning Across Systems

- Rich editor serialization treats image HTML as content.
- Email send validation explicitly treats durable attachment images as content.
- List-item emptiness treats images as empty.
- Draft-content detection treats images as empty.
- Plain-text extraction treats images as zero characters.
- These conflicting definitions cause deletion, save, offset, and validation defects.

#### Finding 40: Shared Behavior Is Centralized But Runtime Adapters Can Still Drift

- The one shared handler is a strong base.
- Three wrappers separately wire editable state, event props, font metrics, padding, scrolling, placeholder behavior, selection integration, and persistence callbacks.
- Only source-pattern tests prove their wiring.
- Wrapper-specific branches already produce typography, identity, table-control, mention, and preference differences.

### Test And Verification Audit

Existing automated coverage:

- `plainTextEditing.test.ts` covers five-space Tab, Automatic Numbering happy paths, empty root and nested automatic-item exit behavior, Indent Guides Enter/Shift+Tab, five-space Backspace, marker-family cycling, root marker removal, and one automatic outdent path.
- `richTextEditing.test.ts` covers linkification, email serialization strings, legacy escaping, a limited sanitizer fallback, attachment source helpers, image geometry helpers, alignment sanitization, and strict selected-run boundary splitting used to prevent highlight bleed.
- `unifiedRichEditorContract.test.ts` verifies the surface inventory and adapter wiring, per-control toolbar hover contracts, expanded formatting inventory, pending-caret font/highlight wiring, shared table placement, header primary/overflow organization, and modal portal source contracts by reading source files and matching regular expressions.
- `editorUndoHistory.test.ts` covers pure undo-history snapshots/classification.
- `editorIndentGuides.test.ts` covers pure guide segment geometry.
- Related home/backend tests cover outgoing rich email serialization and send-time attachment resolution.
- Keyboard-routing tests verify that dashboard shortcuts defer to editable targets.

Major coverage gaps:

1. There are no browser-level editor tests using Playwright or an equivalent real DOM environment.
2. There are no direct behavioral tests for the approximately 4,281-line `useEditorDocumentSurfaceHandlers` hook.
3. There are no real `Selection`, `Range`, `beforeinput`, `DataTransfer`, clipboard, drop, or composition tests.
4. There are no structural bullet/checklist Enter, split, exit, nest, outdent, Backspace, or multi-item tests.
5. There are no pasted native `<ol>` editing tests.
6. There are no mixed image/text, multiple-image, upload-failure fallback, async-caret, or image-adjacent typing tests.
7. There are no durable selected-image clipboard round-trip or cut tests.
8. There are no image-only list-item tests.
9. There are no list-inside-table priority tests.
10. There are no multiline or multi-item indentation tests.
11. There are no Word, Google Docs, Outlook, browser-selection, external task-list, or nested native-list paste fixtures.
12. There are no DOM -> sanitized storage -> reload -> continued-edit round-trip tests.
13. There are no browser rendering tests for line height, visible spaces, marker alignment, guide alignment, image/list adjacency, or email output.
14. Cross-surface tests prove imports/source strings, not identical runtime behavior across Logic Gate, node, project, My Triage, Shared Triage, and attached-email surfaces.
15. Node-based sanitizer tests do not exercise the browser DOM sanitizer. When `document` is unavailable, `sanitizeEditorDocumentHTML` uses a much smaller regex-only fallback.
16. Browser-level multi-user collaboration coverage should be expanded beyond protocol/store and mounted-adapter tests to exercise simultaneous rich DOM editing, caret preservation, undo/redo, images, and reconnect in a real browser.
17. The specification does not define deterministic expected behavior for first-item Tab, Shift+Enter in automatic outlines, multiline selection indentation, pasted native ordered lists, image-only list items, mixed image/text paste, list paste at a mid-item caret, or lists inside tables.
18. No literal TODO/FIXME in the core editor files calls out these gaps; the main documented signal is the generic Partial coverage status.

### What Codex Found To Be Working Well

- One shared handler now governs every declared rich-editor surface.
- Domain persistence remains correctly separate for node, Logic Gate, project, personal mailbox, shared mailbox, and attached-email reply.
- Basic five-space indentation and decimal/alpha/Roman continuation are deterministic and unit-tested.
- Native unordered lists are normalized into one durable Mango bullet representation.
- Mango bullet marker depth styling is recalculated on commit.
- Checklist state survives Mango rich HTML save and rich HTML copy.
- Plain-text paste is escaped and safe URLs are linkified.
- Unsafe link schemes, source font families/colors, SVG data images, and remote images are removed.
- Legacy plain text loads through safe escaping/linkification.
- Inline image persistence stores attachment references instead of durable base64 bytes.
- Table cell navigation and final-cell row creation are explicit and bounded.
- Global dashboard copy/paste/delete/undo shortcuts defer to editable surfaces.
- Blur, tab switches, and persistence adapters attempt to flush pending content.

### Codex Overall Assessment

The consolidation work is directionally sound, but the current editor is not yet governed by one coherent document model. Automatic outlines, Mango bullets/checklists, native pasted ordered lists, CSS-indented blocks, tables, and image frames each participate in different caret and serialization rules. Most pure helper happy paths work; the failures cluster where those representations meet.

The highest-value remediation order identified by Codex is:

1. Establish one canonical semantic list and DOM-to-position model.
2. Preserve complete mixed clipboard fragments and normalize native ordered/task lists.
3. Correct structural list split/exit/nest behavior, including image-only items and selections.
4. Repair durable image copy/cut and image-only draft detection.
5. Define table/list and checklist keyboard/email behavior.
6. Reconcile toolbar/specification contradictions and surface preference/metric drift.
7. Add real browser interaction tests across all six declared rich-editor surfaces before changing more edge cases.

This audit section intentionally records findings only. It was appended by Codex at the user's request and does not claim that any of the defects above were fixed as part of the audit.

### Scenario E-S-IMAGE-CARET: Shared Image Selection Places A Caret Before The Frame

Business logic covered:
- `docs/tests/attachments.md` ATT5
- `docs/tests/attachments.md` ATT6
- `docs/tests/attachments.md` ATT25
- ED55
- ED93

Given:
- Any unified rich-editor surface contains a resizable image frame.
- The user double-clicks that image, closes the preview, deletes the image, and undoes the deletion.

Expected:
- A single click selects the image and places a collapsed caret immediately before its frame.
- The image body uses the hand-selection cursor, remains draggable as one ProseMirror node, and exposes all eight edge/corner resize handles while selected.
- The old detached Move/Download/Preview/Comment/Create Node/alignment/resize/delete label strip is absent; selected-image actions are the frame-anchored download icon plus supported icon-only comment/create-node actions.
- Typing or pressing Space inserts content before the image.
- Dragging the image body still moves it, dragging an edge/corner still resizes it, and Delete/Backspace still removes a selected image.
- Double-click mounts the final dark fullscreen overlay directly, without a transient panel/outline or geometry jump; its bright-red top-right close X is an accessible button and closes the preview.
- Undo restores the deleted attachment-backed image fully rendered immediately, without refresh and without retaining a leaked superseded object URL.
- The behavior is identical in node, Logic Gate, project, My Triage, Shared Triage, and attached-email reply editors.

### Scenario ED-S9: Single Hydration Ownership And Progressive Save History

Business logic covered:
- ED26
- ED38
- ED42
- ED46
- ED47

Given:
- A document contains repeated attachment-backed images and mounts under React StrictMode.
- The user deletes a hydrated inline image, invokes editor undo/redo, and continues editing without refreshing the page.
- The user opens the editor document, later activates Save Settings, then switches document targets.

Expected:
- One hydration owner observes and schedules each unique visible/near-visible attachment+variant load; passive and external-value paths do not race a second hydration pass.
- Compatible consumers share Blob work but create and revoke their own object URLs.
- Undo/redo refreshes the current hydration generation so a restored frame receives a fresh rendered source immediately; the superseded generation's object URL is revoked rather than leaked.
- Replacing external HTML, switching attachment/auth context, or unmounting runs the previous hydration cleanup before new work can mutate the DOM, and the original owner cleanup always disposes whichever refreshed generation is current.
- Opening the document does not load saved versions. Activating Save Settings loads the current target's history without changing manual save or restore behavior.

### Scenario ED-S10: Retained Chat Reconciliation And Safe Title Convergence

Business logic covered:
- ED44
- ED45
- ED48
- ED49

Given:
- A Node editor has loaded durable chat and then receives its first accepted chat subscription or reconnects while a canonical chat read is slow; a second Editor may join the already accepted scope, and one legitimately subscribed user then loses Node Edit access before another message commits.
- Node or Logic Gate document text may be dirty, debounced, queued, or saving.
- A successful rename commits from any supported same-window rename entry point.
- The mounted Editor title `contentEditable` may have a live draft and caret.

Expected:
- First subscription acceptance, reconnect acceptance, immediate acceptance of a late local handler, and chat create/delete hints run one canonical durable-chat read at a time with at most one queued final read.
- Publication rechecks the exact current Node Edit audience, so the revoked subscriber receives no later chat hint without reconnecting while still-authorized subscribers do.
- Project chat and generic editor/document scopes remain absent, with no replay log or recovery worker.
- The committed-title event updates the mounted editor label immediately unless that title is actively edited, in which case it applies after editing ends.
- Existing title DOM draft/caret, dirty or in-flight document text, and save state remain untouched while editing is active.

### Scenario ED-S11: Shared Header Organization And Blocking Modal Layer

Business logic covered:
- ED29
- ED50
- ED51
- ED52
- ED55

Given:
- A Node, Logic Gate, or Project editor is open with the shared header.
- Key Views, Explorer, or Search Explorer chrome creates its own local stacking context.
- The user opens an image/attachment/email preview, permissions/assignment dialog, email picker, node popup, or expanded Kanban node panel.

Expected:
- The header primary area orders Editor, Permissions, shared Format controls, and Outline Styles/Automatic Numbering immediately before **More**, and Node/Logic Gate headers remain on one nonwrapping line at narrowed widths.
- The four GVIC cards remain in one compact horizontal row that may clip beneath a narrowing side pane rather than wrapping into additional header rows.
- Apply-to-assigned-nodes appears only in **More** and requires an explicit Yes/No confirmation; No or cancel makes no change and only Yes performs the write.
- Where supported, Relationships, Metadata, History, Save Settings, version/related-node commands, and surface-specific secondary actions remain available in the **More editor actions** menu with their existing authorization and disabled behavior.
- Opening the menu moves focus to its first enabled action; Arrow Up/Down, Home, and End move among enabled actions; Escape closes it and restores focus to **More**.
- The blocking surface mounts under the shared body-level modal layer and therefore paints and receives interaction above Key Views, Explorer, Search Explorer, and feature-local stacking contexts.
- An inline-image preview mounts directly into its final dark overlay without an intermediate outline/geometry jump and exposes the standard compact glossy bright-red node close button with an uppercase white `X` and accessible name.
- The topmost blocking modal traps Tab/Shift+Tab, closing restores prior focus, and existing accessible dialog naming plus Escape/backdrop close behavior remains intact; anchored Kanban editor panels may remain intentionally modeless until fullscreen.
- Switching a Kanban node panel into or out of fullscreen changes viewport geometry without remounting its live editor or losing its opener state.
- The Project Logic Gates / Nodes editor remains inline beneath its selected row and does not enter the blocking modal layer.

### Scenario ED-S12: Highlight Click Reveals The Exact Chat Comment

Business logic covered:
- ED57

Given:
- A Node or project text block has multiple persisted annotations, and one target comment is nested in a collapsed chat thread.
- The user clicks a highlight, drags a new text selection across it, and continues typing with the keyboard.
- The user clicks a chat comment to reveal its source once, then scrolls or places the caret elsewhere while chat data rerenders or the row remounts.

Expected:
- The simple click opens the shared chat pane, expands the target's ancestors, scrolls the exact stable comment ID into view, and places visible accessible focus on its labeled comment article.
- The chat composer does not steal requested comment focus.
- Chat-to-source navigation scrolls exactly once for that click, consumes the matching request after success, and does not pull the user back after later scrolling, caret movement, rerenders, pointer hold/release, chat updates, or row remounts. A later explicit click receives a new request ID and may navigate exactly once again.
- Drag selection, editing, and prevented/default editor actions do not navigate, and multiple highlights never collapse to the wrong comment.

### Scenario ED-S13: Wrapped Comments, Pasted Lists, And Signature Preview

Business logic covered:
- ED4
- ED26
- ED37
- ED58
- ED59
- ED60
- ED65

Given:
- A user selects text that wraps from the right edge of one rendered line to the left edge of the next and also selects an ordinary inline range.
- External rich content contains numbered/alphanumeric/bullet lists with negative source margins and long items.
- A mailbox signature contains a durable Mango image reference.

Expected:
- Both selections expose Comment and persist quotes/offsets that re-highlight the exact canonical text.
- Paste keeps useful list semantics but removes source positioning and keeps markers/content inside the editor border.
- The larger signature editor switches coherently between Edit and read-only Preview, and its image displays through authenticated eager attachment hydration in both preview and compose.
- Cleaning up and immediately replaying the editor lifecycle restarts exact-mailbox hydration; loading hides the durable protocol source, success uses contain sizing, and terminal failure shows Preview unavailable without losing the reference or double-click original view.
- Sanitization still rejects unsafe attributes, public storage shortcuts, data URLs, and embedded file bytes.

### Scenario ED-S14: Immediate Image Chat And Editor-Owned Tab

Business logic covered:
- ED62
- ED66
- ED67
- ED70

Given:
- A node or project text block contains an attachment-backed inline image.
- Its authorized attachment-link request is deliberately held open and may succeed or fail.
- The user presses Tab or Shift+Tab in plain text, a structural list, and a table cell.
- The user selects the image or blurs the unchanged text block.

Expected:
- Clicking the image chat action opens the chat pane and paints the selected thumbnail in a processing attachment row before the link request resolves.
- The attachment-backed path creates the chat_attachment link without reading attachment content or starting a direct upload; success reconciles to the durable attachment, while failure remains visible, removable, and unsendable.
- Scrolling the editor moves the inline download action by the same amount as the image frame and hides it while the image is outside the editor viewport.
- Tab and Shift+Tab are always prevented from navigating browser focus; the shared editor indents or outdents the current text/list context, plain Tab accepts the highlighted mention when the people picker is open, and neither key moves to another table cell.
- Image selection and an untouched focus/blur cycle issue no collaboration operation, while a subsequent real mutation retains normal HTML-patch micro-batch behavior.
- Typing `- ` on an otherwise-empty line replaces the shortcut characters with a structural bullet item, keeps the caret in that item even inside a table cell, and preserves unrelated inline images.

### Scenario ED-S14B: Mention Entities, Repeated Font Size, And Pasted Ordered Rows

Business logic covered:
- ED9
- ED22
- ED32
- ED66
- ED74
- ED92

Given:
- A company user types `@Ad` or `!Ad` in a unified rich editor or chat composer and presses Tab while Ada is highlighted.
- The user types `#Pro` in a Node or Project chat composer, selects a Project, sends the comment, and reloads it.
- The user selects one text range and presses the font-size plus control more than once.
- The user pastes an ordered/alphanumeric list, presses Enter at the end of a row, then presses Tab in the new row.

Expected:
- Rich editors insert the existing atomic mention/urgent-mention span, every unified adapter can open the people picker, and chat keeps its existing mentioned-principal model while visibly painting the accepted token as a normal or urgent entity chip. The shared chat overlay does not change the token's text metrics or inline advance, so the native collapsed caret remains after the accepted mention and subsequent typing paints at that same position.
- The chat `#` picker offers permission-filtered Nodes, Logic Gates, and Projects, stores the selected type/ID/label separately from readable `#Name` text, and the sent/reloaded chip opens the exact in-app entity route.
- Every font-size click increases the same selected text again, without stale boundary reads or empty nested font wrappers, and the numeric readout remains compact.
- Enter leaves the caret in the new pasted ordered-list row; Tab indents that new row under its previous sibling and keeps the caret there instead of moving back to or indenting the original row.

### Scenario ED-S14C: Import An External Rich Document With Inline Images

Business logic covered:
- ED2
- ED4
- ED6
- ED12
- ED26
- ED107
- ED108
- ED109
- ED75

Given:
- A user selects an entire ClickUp, Linear, or similar SOP page containing rich text, nested lists or checklists, a table, and multiple inline images, then copies and pastes it into any unified editor.
- The clipboard may provide image files, data/blob image sources, existing Mango attachment references, or retrievable external HTTP(S) image URLs, and one image may fail to import.

Expected:
- Mango keeps the text, supported rich structure, and image ordering; ignores unsupported external cosmetics at the paste boundary; and inserts the prepared selection once after all durable image resolutions settle.
- Repeated image sources create one imported attachment and multiple frames, no more than three unique images resolve concurrently, and every successful frame stores a durable Mango attachment reference.
- The existing hydration owner immediately discovers those newly inserted frames, loads their display sources, and moves them from loading to ready without a browser reload or editor remount; saved editor content continues to contain durable Mango references rather than temporary display URLs.
- An image failure leaves the text, formatting, lists, and successful images intact, inserts a safe image fallback label, reports the partial failure, and persists no third-party URL, blob URL, data URL, base64 bytes, credentials, or signed URL.
- In a Node, Project, or Logic Gate Tiptap JSON editor, typing or formatting while imports run maps the saved ProseMirror insertion bookmark and preserves both the intervening edit and the complete prepared paste. Switching targets, destroying the editor, or unmounting still prevents stale insertion into another document.

### Scenario ED-S15: Inline Images Stay Stable While Typing

Business logic covered:
- ED65
- ED69

Given:
- A unified mail editor has eagerly hydrated one durable Mango image and reports each input through its controlled value.
- The user types characters before and after the image, then the editor is unmounted.

Expected:
- Controlled rerenders retain the same image DOM node and object URL, issue no replacement fetch, and never show a one-frame blank or broken thumbnail.
- Real unmount/context replacement still aborts pending work, restores the durable source, and revokes the owned object URL without weakening sanitization or original-image authorization.

### Scenario ED-S16: Large Node And Project Keep A Bounded Text-Box Window

Business logic covered:
- ED43
- ED76
- ED77
- ED78
- ED80

Given:
- A Node or Project contains hundreds of text boxes, each with existing rich HTML, email associations, chat, images, and highlights.
- Projection loading may report complete while the Node text-block list is still empty or partial, then deliver additional text blocks, chats, or attached emails for the same Node.
- The user opens it normally, scrolls gradually, jumps near the end, or follows a target to a block, chat message, email message, or other active deep row content.
- The user independently closes and reopens the email, text-editor, or chat section; edits content immediately before the row leaves the mounted window; and narrows the app window.

Expected:
- The normal open mounts only the top viewport plus two-row overscan. A target open first mounts a bounded neighborhood centered on the target row; unresolved target intent waits for projections instead of falling back permanently to row zero.
- Scroll spacers retain exact row order, scrollbar geometry, position, and stable leading/trailing or pin-anchored DOM identities. Repeated downward input moves monotonically through multiple windows and reaches the final row without snapping back; the latest native scroll position is restored if a window commit briefly clamps it, and a fast long jump never mounts every intervening editor. A handled target or old restoration position is not reapplied after the user scrolls elsewhere. The mounted count remains the viewport window plus only a small active pin allowance.
- Node and Project rows both show email-left, text-editor-middle, chat-right. Email-created Nodes use the same layout and retain their original email/chat associations.
- An email-linked Node text box has a Show email button. It expands only the exact linked provider message and its Subject, From, To, Cc, and Bcc fields inside the row, including when that message is a child of the attached thread root; no sibling message, thread timeline, or reply control appears. It changes to Hide email and removes the preview on a second activation without changing the editor document. Clicking the surrounding linked text-box header still reopens the left email column and scrolls to that exact message. Text selected to create an email chat remains highlighted in both plain and rich email bodies.
- The three header toggles are separate keyboard-operable buttons. A zero-attached-email Node first opens editor and chat with email closed; a Node with one or more attached emails first opens all three; Project rows retain their all-three-open default. Late or incremental block projections initialize editor/chat and the applicable email default instead of rendering blank row shells. Closing one section unmounts only that section, preserves its data/draft association, and is not undone by later projection updates; an active unsent email reply is the bounded exception and stays pinned rather than being discarded.
- Rows keep one fixed vertical height. No Node/Project text-box or chat-pane vertical resize control is exposed; email/chat column width separators still resize horizontally. Narrow windows scroll horizontally across the columns without changing row height.
- Pending local document input flushes into the existing durable save path before editor unmount. Remount restores the current content and remembered inner scroll position for that document.
- Logic Gate keeps its existing editor behavior and does not use the Node/Project row virtualizer.

### Scenario ED-S17: Transient Inline-Image Loads Recover In Place

Business logic covered:
- ED46
- ATT34
- ATT60
- ATT62

Given:
- A visible attachment-backed image in a mounted Node or Project text box encounters several temporary authenticated content-load failures.
- The user leaves the row mounted or double-clicks the unavailable frame to open its original preview.

Expected:
- The mounted frame uses finite spaced retries and can reach ready without requiring the user to close/reopen the Node or scroll the row out and back into the virtualized window.
- Double-clicking an unavailable frame starts fresh display hydration and a separately cancelable original-image load. The final dark overlay shows an explicit loading state, retries transient failures, and exposes a keyboard-accessible Retry button after terminal failure instead of attempting to render the internal attachment reference.
- Closing the preview, replacing the document, or unmounting the virtualized row aborts obsolete requests and revokes owned object URLs without changing the durable attachment reference.

### Scenario ED-S18: Bare-Bones Tiptap JSON Save And Recovery

Business logic covered:
- ED95 through ED105
- ED110 through ED112

Given:
- A user edits a Node, Project, or Logic Gate Tiptap document while a prior save may still be in flight.
- The user may type continuously, pause briefly, navigate inside Mango, lose one HTTP acknowledgement, or receive a realtime revision from another browser.
- The document may contain paragraphs, lists, tables, marks, durable images, workspace entities, and mapped annotations.

When:
- ProseMirror applies local transactions.
- The quiet or maximum batch timer fires.
- Mango persists and posts a generation, receives an acknowledgement, retries a lost acknowledgement, or reloads exact recovery state.
- The row sleeps, remounts, or receives a committed realtime revision event.

Expected:
- Characters and local formatting paint immediately; they never wait for JSON capture, IndexedDB, serialization, React parent state, or the network.
- Ordinary typing captures after approximately 500 ms without another document change. Uninterrupted typing captures no later than approximately 10 seconds after that unsaved batch began, while blur, navigation, explicit flush, and editor shutdown capture immediately.
- One timer owner captures the Tiptap JSON object once, overwrites one exact latest-unsaved IndexedDB record, and sends one complete-document POST with one serialization at the HTTP boundary.
- No save-time normalization, recursive frontend validation, cosmetic allowlist, whole-document equality stringify, reparse, snapshot queue, or echoed full-document acknowledgement is introduced.
- Acknowledgements clear recovery and show Saved only for the latest generation. Older acknowledgements cannot mark newer typing saved, and lost acknowledgements reuse the stable operation ID.
- The status icon owns Pending, Saving, Saved, and Save failed without rerendering the complete parent surface. A failed page session remains visibly failed under ED104 even when later work commits.
- Exact recovery wins over the canonical snapshot until replay/deduplication or an explicit conflict decision resolves it. IndexedDB failure is visible and never represented as safe recovery.
- Realtime refresh fetches the committed document only for a browser with no unsaved generation, retained failed operation, scheduled snapshot, or in-flight request. A latched ED104 warning alone does not create unsaved work.
- Zero-annotation documents perform no annotation scan; changed-range block identity and mapped decorations avoid complete-document work on ordinary keystrokes.
- Sleeping rows render the latest document without placing a complete-document React update in the critical save task.

Automated coverage:
- `tests/frontend/modules/editor/mangoTiptapFoundation.test.ts`
- `tests/frontend/modules/editor/mangoTiptapEditorIntegration.test.tsx`
- `tests/frontend/modules/editor/editorRowVirtualizationReact.test.tsx`
- Backend editor JSON store, HTTP, revision, idempotency, version, and realtime tests

### Scenario ED-S18A: Mixed Text And Images Survive Concurrent Editing

Business logic covered:
- ED26
- ED97
- ED106 through ED109

Given:
- A user pastes a large external selection containing text, formatting, lists or tables, and one or more images.
- Image sources may be clipboard files, existing Mango attachments, data/blob sources, repeated sources, or retrievable HTTP(S) URLs.
- At least one image import is delayed, and the user continues typing or formatting elsewhere before all imports finish.
- One image may fail while the other images succeed.

When:
- Mango prevents the browser's unsafe default rich-image paste.
- Durable image resolution runs with bounded concurrency.
- ProseMirror transactions occur before the prepared paste is ready.

Expected:
- The user's intervening edits remain immediately visible and are never used as a reason to reject the paste.
- The saved insertion bookmark maps through every intervening transaction, and the prepared selection is inserted at the mapped range when imports settle.
- Supported text and document structure survive even when unsupported cosmetics or one image cannot be represented.
- Every successful image is uploaded and linked first, then inserted in source order as a durable attachment-ID node.
- Repeated sources may share one imported attachment while retaining every intended image frame.
- A failed image becomes visible fallback text; it does not remove the surrounding text, structure, or successful images.
- No third-party source URL, S3 signed URL, `blob:` URL, data URL, credentials, or raw image bytes enter durable editor JSON.
- Target change, editor destruction, or unmount prevents the finished import from inserting into a different document.
- The resulting editor transaction uses the ordinary JSON batch/recovery/save path; rich paste does not own a second document save system.

Automated coverage:
- `tests/frontend/modules/editor/mangoTiptapRichClipboard.test.ts`
- `tests/frontend/modules/editor/mangoTiptapEditorIntegration.test.tsx`
- Attachment direct-upload, attachment API, hydration, and backend remote-image import tests

### Scenario ED-S18B: Failure Attention Lasts Until Refresh

Business logic covered:
- ED103 through ED105
- ED109

Given:
- A document save, ordinary image upload, or mixed rich-image import reports a failure.
- The same document later has more local edits and one or more successful backend acknowledgements.

When:
- Pending, Saving, or Saved would ordinarily replace the status icon.
- Recovery cleanup, revision advancement, retry, or dirty-row unpin completes successfully.

Expected:
- The first failure remains the visible status for that document for the rest of the current page session.
- The complete textbox frame remains red and pulses every two seconds for Nodes, Projects, and Logic Gates.
- An unrelated later success never tells the user that the earlier failed text or image was recovered.
- The permanent warning is presentation state, not a block on saving: later edits still batch, enter recovery, post, acknowledge, advance revisions, and unpin normally.
- No repeated identical failure state is published and ordinary status changes remain isolated from the complete parent surface.
- A full browser refresh starts a new page session, performs exact recovery/canonical loading, and may then present the current saved state or a new failure.

Automated coverage:
- `tests/frontend/modules/editor/mangoTiptapFoundation.test.ts`
- `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts`


### Scenario ED-S19: Create And Insert Workspace Entity Links

Business logic covered:
- ED81
- ED82
- ED83
- ED84
- ED85
- ED86
- ED87
- ED89
- ED90
- ED119
- ED120
- ED121
- ED122
- ED123

Given:
- The user opens a Node, Logic Gate, or Project JSON text box with several Pinned resources and permission to search other Nodes, Logic Gates, and Projects, while other resources are denied.
- The user highlights text containing repeated whitespace, verifies the chat-then-square-plus action order, creates a Node, types `#`, uses the N/L/A then Tab shortcuts and type buttons, searches a multiword query, tests each source editor's `##` target restrictions, and later copies, pastes, saves, remounts, opens a Node chip from another Node, closes that target Node with X, and Backspaces a chip.

Expected:
- The exact contextual label is exposed on a true square-plus icon. It matches the chat icon's size and sits directly to its right instead of creating a wide panel. One real Node is created with the normalized selected title and the unchanged selection becomes a Node chip. API failure preserves the selection. If the target changes after creation, no stale insertion occurs and the message explains that the already-created Node can be inserted with `#`.
- The elevated picker focuses its search field and shows the complete Pinned tree in stored mixed order when blank. It does not calculate recency. Typed queries use the established active/done search ranking, exact type filters, and permission checks; matching pins are first and exact typed IDs are deduplicated.
- N/L/A then Tab and the icon buttons select the exact category. A second `#` switches Node or Logic Gate sources to their allowed link targets; a Project source remains reference-only. Every link uses the normal permission-checked command and only then inserts the target chip.
- Tab inserts the current top/highlighted result, Arrow keys and Enter work, Escape closes, and mouse selection inserts the same strict entity object. A chip shows the correct type icon/name, opens the exact route without reload, and remains independent from any created business relationship.
- A Node chip opened from a source Node pushes an in-app route with a validated return marker; X on the target Node returns to the source Node. Other entry and close paths retain their current behavior.
- Backspace on/after a chip unwraps it to its label without deleting the product entity. Undo restores the chip. Legacy sanitization reconstructs only canonical entity attributes; JSON validation rejects unsupported types or missing identity; copy/paste, durable save, sleeping static render, read-only render, and remount retain the entity ID, type, and label.

Focused coverage lives in `editorEntityLinks.test.ts`, `mangoTiptapEditorIntegration.test.tsx`, backend Project relationship rule/HTTP tests, existing Logic Gate assignment/transfer tests, `editor_json_test.go`, memory Company Explorer bucket-order tests, PostgreSQL lean-query/index contract tests, and the normal unified-editor contract suites. Full repository verification must run after these focused tests.

### Scenario ED-S20: Cancel Selected Text Chat Completely

Business logic covered:
- ED88

Given:
- The user selects text in a Node text block and chooses Turn into Chat.

When:
- The user clicks X on the quoted text before sending.
- The user repeats the action and closes the pending chat instead.

Expected:
- The pending quoted-text prefill is removed in both cancellation paths.
- The temporary source annotation is removed.
- The browser and ProseMirror selection is collapsed, so no selection highlight remains.
- Unrelated draft text in the chat is not erased by clearing only the quote.
- A successful send may replace the temporary annotation with the normal durable chat annotation.

Focused automated coverage lives in tests/frontend/modules/editor/unifiedRichEditorContract.test.ts; the mounted editor suites continue to cover selection-to-chat creation and durable annotation behavior.

### Scenario ED-S21: Edit A Sent Comment

Business logic covered:
- ED91

Given:
- The shared ChatPane contains one comment authored by the current user and one authored by another user.

When:
- The current user opens Edit, changes the text and mentions, and saves.
- A later save fails and the user retries.

Expected:
- Edit appears only on the current user's comment and opens an inline Save/Cancel editor.
- Success retains the comment ID, author, creation time, attachments, reply/source link, and thread position while showing the new text and Edited marker.
- Failure leaves the draft open for retry and the persisted row is not replaced by an unsaved value.
- Blank text is rejected unless the comment retains an attachment.

Automated coverage:
- `tests/frontend/modules/editor/editorTextBlockChatNavigation.test.tsx`
- `tests/frontend/modules/editor/editorProjection.test.ts`
## Node v2 Phase 3 production-path coverage (2026-07-28)

The Node v2 final gate retains disposable PostgreSQL store tests for owner-specific Project/Logic Gate JSON cutover routing, exact verification retention pins, a 1,002-comment reply-heavy thread, and ordered company purge. The former Chromium workflow harness was removed from CI on 2026-07-28; real React/Tiptap workflow acceptance is manual until replacement coverage is added.

The separate PostgreSQL proof covers six isolated clients, offline replay, lost acknowledgement, delete-set durability, failed-write quarantine, compaction races, service restart, three-owner conversion, activation, stale rollback rejection, and restoration of post-cutover edits, creates, and deletes. All real gates remain inactive.

### Scenario ED-S22: Node Textbox Chats Use Permanent Storage

Business logic covered:
- ED117

Given:
- A Node textbox has a normal chat, a reply, a chat that selects or quotes an attached email, and a chat attachment.
- The normalized email message, thread, and email attachments exist independently of the textbox.

When:
- The user reads, creates, replies to, edits, or deletes a chat.
- The user deletes the owning textbox.

Expected:
- Current chat reads and writes use `node_textbox_chats` and do not create new legacy `Text block chat` rows.
- Deleting the textbox deletes every chat it owns, including the email-selection chat and its replies.
- Chat attachment relationships are removed with the deleted chats.
- The normalized email message, thread, and email attachments remain.
- Existing legacy chat rows remain unchanged and are ignored by current reads.

### Scenario ED-S23: Repair Exact Empty Node Documents

Business logic covered:
- ED118

Given:
- The final Node conversion stored an otherwise valid Mango TipTap envelope whose document root has an empty `content` array.
- The exact body may exist in a current or deleted textbox, manual history, a seen baseline, or one of those arrays in a Recycle Bin restore payload.

When:
- An operator runs the read-only repair preflight and then applies the reviewed forward migration.

Expected:
- Only the exact bad shape becomes a document containing one empty paragraph.
- Current, history, seen, and recycled copies all remain loadable and restorable.
- IDs, revisions, annotations, order, timestamps, saved-user identity, deletion state, and unrelated payload data remain unchanged.
- Re-running the migration repairs zero rows, and a fresh database remains a no-op.
- The shipped historical cutover file remains unchanged.


### Scenario ED-S24: Save Changed History When Leaving An Editor

Business Logic: ED126, ED127, ED128, ED129

Given:
- A user can edit a Node, Logic Gate, or Project and opens it through a full page, popup, Updates preview, or Project preview.
- The existing current-textbox save may still be quiet-debounced or in flight.

When:
- The user makes a history-visible change and closes that view, switches resources, changes routes, uses Back or Forward, or refreshes the browser.
- The same resource may emit more than one unmount/close signal, or the user may press the manual history button while an exit save is already running.

Expected:
- Every mounted textbox for only that exact company/resource flushes before the existing history snapshot runs.
- Exactly one history batch is created for the current changed baseline, and the existing current textbox tables remain the ordinary autosave authority.
- A successful manual or exit save prevents an immediate unchanged exit from creating another batch.
- An unchanged close creates no history. A failed save remains eligible for retry.
- Refresh/external navigation/tab close invoke the same path through `pagehide`, without a guarantee after browser termination and without adding a timer, prompt, scan, worker, or crash-recovery system.



# Process Story: Editor Textboxes and History

A Node or Project user opens a textbox, or a Logic Gate user opens its one document
↓
The current body comes from the exact `node_textboxes`, `project_textboxes`, or `logic_gate_textboxes` row
↓
The existing projection-shaped response is assembled from permanent textbox, attachment, chat where the product supports it, and exact email relationships instead of a stored legacy projection row
↓
Manual saves and changed-resource exit actions create one batch in the matching `node_textboxes_history`, `project_textboxes_history`, or `logic_gate_textboxes_history`
↓
Recycle snapshots and restores order the owner before its final textbox/history rows; Node and Project then restore their supported textbox chats, email relationships, and attachment relationships in dependency order
↓
At the final Node maintenance boundary, writers pause; any active legacy textbox still missing from final storage is copied with the same ID, and only ownerless legacy seen rows are discarded before the remaining baselines move to final storage

## What the user does

The user types in a Node, Project, or Logic Gate textbox. Ordinary typing saves
the latest JSON document and its annotations. The user can press the manual
save-history button, and Mango also invokes that history function after the user
changes and then leaves the resource. The user can later restore either batch.

## Ordinary save

1. The backend reads the current textbox row and locks it during the save.
2. If the submitted revision is current, the backend replaces `body_json` and
   increases `revision` by one.
3. The same transaction inserts one `realtime_outbox` event so other connected
   editors reload the new snapshot.
4. The save does not insert an operation row or an automatic version row.
5. PostgreSQL supplies the commit timestamp. A row's `updated_timestamp` is
   never earlier than its `created_timestamp`.

The permanent current tables are:

- `node_textboxes`, keyed by `company_id`, `node_id`, and `textbox_id`.
- `project_textboxes`, keyed by `company_id`, `project_id`, and `textbox_id`. It also owns the Project textbox title, email display reference/accent, metadata revision, and display order. File metadata remains in final attachment tables.
- `logic_gate_textboxes`, keyed by `company_id`, `logic_gate_id`, and
  `textbox_id`.

`body_json` contains the Tiptap document and its `annotations` array. Node and
Project rows have `display_order`. Logic Gate rows do not.

## Retired legacy storage

The current schema does not create these superseded tables:

- `editor_json_documents`, `editor_json_operations`, and
  `editor_json_versions`.
- `project_editor_documents`, `project_editor_document_operations`, and
  `project_editor_document_versions`.
- `logic_gate_editor_documents`,
  `logic_gate_editor_document_operations`, and
  `logic_gate_editor_document_versions`.

The backend current-document methods use only the three permanent textbox
tables. PostgreSQL rejects the retirement migration if any legacy table still
has rows, so a database that has not completed conversion cannot silently lose
documents. Historical conversion and verification tools remain available for
that pre-retirement work.

## UUID identity rule

Node IDs and Node textbox IDs are stored in PostgreSQL `uuid` columns. The
foundation migration accepts every value PostgreSQL recognizes as a UUID,
including Mango's UUIDv7 IDs. A UUID version describes how an ID was generated;
it is not an editor schema version and is not a reason to rewrite or reject an
existing identity. The migration stops only when a legacy Node resource or
document ID cannot be stored as a PostgreSQL UUID at all.

## Dormant Node change annotation retirement rule

- Generic annotation validation continues to accept `change` with a stable ID and non-empty range without requiring any database business row.
- The editor keeps a dormant change when active comment/chat/email annotation owners publish their list, maps its positions through edits, and saves it with the matching document revision.
- Dormant changes create no DOM decoration, unread count, navigation target, callback, or network request.
- The operator-controlled database retirement removes only obsolete feature tables and dedicated objects after the table-free runtime is deployed. It never updates current/history textbox JSON or nested annotations.

## Deleted and recycled resource rule

The generic legacy document table did not require a Node document to have a
matching live row in `nodes`. That is normal while a deleted Node is waiting in
the Recycle Bin: the old JSON document stayed outside the recycle payload and
became reachable again after restore.

The cutover converter fixes that old behavior without adding an editor table. It
puts converted `node_textboxes` rows inside the existing recycle payload. It
also converts current Node, Project, and Logic Gate textbox projections and
manual history already stored in old recycle payloads. A future delete snapshots
the surviving purpose-built current/history tables directly. Restore recreates the owner
first and then restores those textbox rows.

Verification and cleanup block when a recyclable document or old recycled
textbox/history row has not been converted. A legacy document with neither a
live owner nor a recycle payload is unreachable and may be discarded by the
cleanup; the verification script reports that count separately.

## Simple conflict rule

When the submitted revision is stale, the backend compares top-level Tiptap
block IDs:

- A server-only block stays. This means a conflicted deletion does not delete it.
- A user-only block is appended.
- If the same block ID has two different bodies, the server block stays and a
  copy of the user's block is appended with a new block ID.
- Existing server annotations stay during this emergency merge. Local absolute
  annotation positions are not copied because the appended blocks change those
  positions. The returned snapshot lets the client reload the merged result.

This is intentionally a small safety rule. It avoids silently throwing away
text; it is not a full collaborative editing engine.

## History snapshots

The permanent history tables are:

- `node_textboxes_history`
- `project_textboxes_history`
- `logic_gate_textboxes_history`

One press of the history button, or one changed-resource exit, creates one
`batch_id`. Every active textbox is copied into a separate history row with that
same batch ID. History rows do not have a user-entered save name.
`saved_by_user_id` records the saving user when that ID is available.

Project history keeps the textbox title and attachment metadata inside the
historical JSON so restoring an old batch does not lose that batch's view data.
The project name shown in the history response is read from the Project table;
the submitted snapshot name is not stored.

Old rows marked `auto` came from the retired timer-based snapshot feature. The
current action-triggered exit behavior uses the same final history batches as
the manual button, and the new history tables intentionally have no `save_kind`
column. The converter and cleanup discard the old timer rows instead of
mislabeling them as current history.

## Projection cutover status

Project runtime storage has completed the next phase:

- `project_textbox_chats` is the only current Project textbox-chat store.
- Exact Project attached-email ownership comes from `email_relationships`.
- Project textbox titles and supported display metadata live on `project_textboxes`.
- Project files come from `attachments` and `attachment_relationships`.
- The backend rebuilds the existing Project projection-shaped API response from those final tables.
- No production Project request reads or writes `project_information` or `project_projection_table`.

The two legacy Project tables are retired and absent from fresh-database schema.
Node now uses the same final-storage rule, while its separate three-table operator
retirement remains gated by copy, no-writer, smoke, soak, and snapshot evidence.

Logic Gate runtime storage has now completed its application cutover:

- `logic_gate_textboxes` is the only current Logic Gate document store.
- `logic_gate_textboxes_history` is the only manual saved-version store.
- The product has one Logic Gate document and no Logic Gate textbox chat feature or chat table.
- Exact Logic Gate attached-email ownership comes from `email_relationships` joined to `email_messages` and `email_threads`.
- Logic Gate files come from `attachments` and `attachment_relationships`.
- The backend rebuilds the existing projection-shaped API response from those final tables.
- No production Logic Gate request reads or writes `logic_gate_information` or `logic_gate_projection_table`.

The two legacy Logic Gate tables are retirement candidates only after the
separately operated PostgreSQL 17 preflight/copy, matching backend deployment,
smoke/recycle checks, reconciliation, soak, snapshot, dependency proof, and
explicit operator approval complete.

## Read-only development evidence

The 2026-08-01 database-enforced read-only audit found:

- 640 active Node manual history rows and 26 active Logic Gate manual history
  rows. All passed the production HTML-to-Tiptap converter.
- 15 more Node manual history rows inside recycle payloads.
- 58 Node, 3 Project, and 4 Logic Gate current textbox projections inside
  recycle payloads.
- 20 missing-parent Node JSON documents. Every one matched a recycle payload;
  none was unexplained or disposable orphan data.
- 43 disabled automatic snapshots: 24 active and 19 inside recycle payloads.
  These are intentionally excluded.

No document body or credential was printed or stored during the audit.

## Rollout and rollback

1. Apply `20260801_editor_textbox_storage_foundation.sql`. It creates and
   backfills the six permanent tables without deleting old data.
2. Deploy the backend that writes the new current and history tables and includes
   those six tables in Recycle Bin snapshots/restores.
3. From `frontend`, run the converter with the database-enforced read-only role.
   Dry-run is the default; it validates every selected active and recycled
   document, resolves durable attachment metadata, and writes nothing:

   ```powershell
   npm run convert:editor-textbox-history -- --company-id <company-id> --host <host> --port 5432 --database <database> --user mangorts_readonly --sslmode require
   ```

   Interactive runs always ask for the database password without displaying it,
   so a stale `PGPASSWORD` or `DB_PASSWORD` cannot be reused accidentally. The
   entered password is passed only to the converter child process; it is not
   printed, written to a file, or retained in the parent shell. Non-interactive
   automation must provide `PGPASSWORD` in its process environment.

4. Review the counts, then rerun with a human-managed writer connection and the
   explicit write confirmations. Do not give the writer credential to an agent:

   ```powershell
   npm run convert:editor-textbox-history -- --company-id <company-id> --host <host> --port 5432 --database <database> --user <writer-user> --sslmode require --apply --allow-write --confirm-database <database> --confirm-company-id <company-id>
   ```

   Apply is one guarded transaction. It inserts converted manual history, adds
   converted current/history rows to recycle payloads, removes old save rows
   from those payloads, and rolls everything back on any mismatch. It does not
   enable editor JSON mode and does not run the destructive cleanup.
5. Run `scripts/verify_editor_textbox_cutover.sql` with the read-only connection.
   Every `blocker` count must be zero.
6. Only then run `scripts/apply_editor_textbox_cleanup.sql`. It removes obsolete
   current, operation, automatic-version, and legacy save rows, but keeps the
   three phase-2 projection tables.
7. Apply `20260801_z_retire_legacy_editor_storage.sql` through the normal reviewed
   migration workflow. It records the final state when cleanup already ran and
   refuses to continue if any of the nine legacy tables is still nonempty.

Rollback before step 6 is an application rollback. The old storage is still
present. Step 6 is deliberately separate because dropping tables is not a safe
automatic rollback point.
