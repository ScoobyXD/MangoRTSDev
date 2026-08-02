# Speed Up Large Nodes

Last updated: 2026-07-16

Status: Phase 1 editor-input batching is implemented, verified, and merged into local `main` on 2026-07-16. The highlight, chat-rerender, eager-DOM, and image-pressure work remains open.

## Executive verdict

Very large nodes are slow primarily because Mango repeatedly performs work proportional to the entire open node while the user is interacting with one small part of it.

The main problems are:

1. A normal node-editor keystroke performs several full-document text, HTML, sanitization, selection, undo, and collaboration operations.
2. Node highlights and change markers repeatedly rescan the document and ask the browser for geometry. Some of the offset conversion work can become quadratic in the number of text nodes.
3. The chat draft is owned by the whole node workspace. Each chat-composer keystroke can rerender every mounted block, editor, chat, and message subtree even though only one textarea changed.
4. All blocks and most chats, messages, and attachment thumbnails are mounted eagerly. After five seconds, the editor image hydrator schedules every remaining image, defeating its viewport-based loading policy.
5. The collaboration system delays transmission by 160 ms but does not truly combine the per-keystroke operations already created. Large-string comparison, IndexedDB persistence, acknowledgements, full canonical writes, and projection materialization therefore scale with typing activity.

The report is not explained by one slow request. Open-time request costs exist, but the sustained lag after a node is open is mainly browser main-thread CPU, React rerender fan-out, DOM/layout/paint cost, image memory pressure, and per-input collaboration bookkeeping.

## 2026-07-16 Phase 1 implementation: batched editor input

### What changed

Ordinary native and shared scripted typing now uses a real DOM input batch in every unified rich-editor surface:

- The first edit in a burst captures one exact rich-HTML undo-before snapshot.
- Later keystrokes continue mutating the browser's live DOM without another full undo snapshot, post-edit snapshot, sanitizer pass, or persistence serialization.
- The batch flushes after 160 ms without input and cannot remain open longer than 500 ms during continuous typing.
- Flush captures one undo-after snapshot and performs one sanitized full-document serialization. The same serialized HTML is reused for persistence instead of serializing again for the save.
- The existing collaboration layer computes one bounded HTML delta from that batch and persists/submits it immediately, bypassing its old second 160 ms debounce.
- Undo/redo, input-kind changes, keyboard navigation, pointer selection, paste/drop/cut, formatting, structural commands, blur, and unmount close the batch before their own work. IME composition is treated as one batch.

The shared scheduler lives in `frontend/src/modules/editor/editorInputBatch.ts`. The unified DOM event integration and one-pass batch commit live in `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts`.

### Quantified code-path reduction

For `K` ordinary character inputs inside one batch, the audited path performed approximately:

- `K` full undo-before serializations.
- `K` full undo-after serializations.
- `K` additional full persistence serializations.
- `K` collaboration full-string checks/diffs, IndexedDB operation creations, and eventual backend operations.

That was roughly `3K` whole-document sanitize/serialize passes around a typing burst.

The new path performs:

- One full undo-before serialization at batch start.
- One full undo-after/persistence serialization at batch flush.
- One collaboration full-string diff and durable operation for the batch, unless an unusually large insertion must be split by the existing transport limit.

That is two whole-document serialize passes per batch instead of three per character. A ten-character burst therefore drops this specific static operation count from about 30 full serializations to 2, a reduction of roughly 93%. This is a code-path count, not a browser timing claim; representative large-node performance traces are still required.

### Why undo still uses full snapshots

The implementation deliberately keeps exact rich-HTML before/after snapshots for one batch rather than introducing a second undo delta format in the same change. Mango undo must restore tables, lists, mentions, image references, formatting, and selection offsets exactly. Reducing snapshot frequency from every character to one pair per batch removes the dominant repeated work while preserving that proven restoration model. Incremental undo storage remains a possible later memory optimization after browser profiling.

### Realtime and durability protection

A naive DOM debounce could lose local characters if a remote collaboration patch arrived during the 160-500 ms staging window. The implementation closes that race explicitly:

- `EditorContent` and every Node/Project text block expose their pending DOM batch to the frontend-backend textbox sync.
- Before applying a remote commit, recovery snapshot, or snapshot-retry reconciliation, the frontend-backend textbox sync forces the staged local batch through serialization and into the durable ordered pending-operation queue.
- It waits for that IndexedDB persistence before advancing remote state, so the existing patch transform/rebase path preserves both edits.

This wiring spans `editorTextboxSync.ts`, `useEditorTextboxSync.ts`, `useEditorDocumentPersistence.ts`, `EditorContent.tsx`, `NodeWorkspaceSurfaceParts.tsx`, and `UnifiedRichEditorSurface.tsx`.

### Proof added

- `editorInputBatch.test.ts` proves one before snapshot per burst, idle flush, bounded 500 ms maximum latency, IME timer deferral until composition ends, edit-kind boundaries, and no persistence work for a before-input event with no DOM mutation.
- `editorToolbarInteractions.test.tsx` mounts the real shared editor, types three separate characters, proves no save occurs before the batch boundary, proves exactly one save afterward, and proves one undo restores the complete burst.
- `editorTextboxSync.test.ts` stages a local batch while a disjoint remote commit arrives and proves the local/remote HTML converges without data loss.
- `unifiedRichEditorContract.test.ts` now owns the shared IME/batch integration contract.
- `docs/tests/editor.md` ED43 and ED77 define the durable batching and realtime-ordering behavior.

Verification completed so far:

- `npm.cmd run test:node-relationships` — pass.
- `npm.cmd run build` — pass.
- `node scripts/run_all_tests.mjs` — pass (`All test suites passed.`).

### What this phase does not solve

This phase directly addresses the highest-value node typing hot path and reduces backend operation frequency for typing. It does not yet fix highlight geometry rescanning, per-input selection/mention state work, broad chat-composer rerenders, eager mounting of blocks/messages/images, the image load-all watchdog, or CSS paint pressure. Those remain ranked below.

## Ranked root causes (audit baseline)

The evidence below was captured at starting HEAD `ae96f883329a7c81d6be1af8c4971ed53218e59a`, before this branch's Phase 1 edits. Its paths and function names identify the audited owners, but the line numbers and per-input wording in causes 1 and 5 are historical baseline evidence; the implementation record above describes their current behavior. Causes 2-4 and the remaining contributors were not changed in Phase 1.

### 1. Confirmed: each node-editor keystroke performs repeated whole-document work

#### Current path

- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:4480` — `handlers` owns the native editor event path.
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:4650-4652` — ordinary insertion takes a pre-edit snapshot in `onBeforeInput`.
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:4799-4819` — `onInput` records a post-edit snapshot and commits the document.
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:2635-2640` — `commitEditorDocument` applies list markers, reads the full document text, serializes the full document HTML, and updates indentation state.
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:2642-2649` — `snapshotEditorDocumentRoot` captures selection offsets, full fallback text, and full serialized HTML.
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:2652-2659` — `recordEditorDocumentMutation` takes the post-edit snapshot.
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:4986-4989` — `onKeyUp` performs another selection/mention refresh.
- `frontend/src/modules/editor/richTextEditing.ts:1008-1019` — `sanitizeEditorDocumentHTML` parses HTML into a template, recursively rebuilds sanitized DOM, trims it, collapses spans, normalizes highlights and lists, and serializes it again.
- `frontend/src/modules/editor/richTextEditing.ts:1088-1161` — `readEditorDocumentText` recursively walks the entire editor DOM.
- `frontend/src/modules/editor/richTextEditing.ts:1164-1167` — `serializeEditorDocumentHTML` sanitizes `root.innerHTML` and then reads the full text again.
- `frontend/src/modules/editor/richTextEditing.ts:947-963` — `collapseRedundantFontSizeSpans` repeatedly queries all spans until stable, which can be worse than linear for deeply nested spans.
- `frontend/src/modules/editor/editorUndoHistory.ts:55-56` — document undo retains up to 40 groups and 6,000,000 stored characters, using full before/after HTML snapshots.

#### What the user experiences

Typing one character does not cost roughly one character. For an ordinary native insertion, the current path takes a full pre-edit document snapshot, a full post-edit snapshot, and a committed full serialization. Each serialization itself performs full-DOM sanitization and another full-text walk. That is at least three whole-document sanitize/serialize passes around a normal edit, plus selection and formatting work.

If the document HTML has length `N`, the common path is at least `O(N)` per keystroke with a large constant. Repeated span collapsing can be superlinear for pathological nested markup. The undo snapshots also create large temporary strings and retained history, increasing garbage collection and memory pressure.

The text update then reaches:

- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:993-999` — `scheduleNodeDocumentSave` calls `onDocumentChange` and schedules collaboration.
- `frontend/src/modules/nodes/NodeWorkspaceSurface.tsx:1150-1163` — `updateTextBlockContent` maps the complete `blocks` array and updates the block timestamp.

This confirmed cause directly explains slow node typing. The resulting React update and highlight work also increase rendering and layout cost around the editor.

### 2. Confirmed: highlight geometry rescans the document and forces layout after edits and inner-editor scrolling

#### Current path

- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:818-826` — `NodeTextBlockEditor` owns highlight and scroll-related state.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:844-858` — `refreshTextHighlights` rebuilds chat highlights and content-change visuals.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:877-890` — a `ResizeObserver` reads geometry with `getBoundingClientRect` and refreshes highlights.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:892-898` — changes to `documentValue`, `documentScrollTop`, or editor height schedule a highlight refresh.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:932-934` — document changes reread the complete document for indentation guides.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:435-483` — `buildTextHighlightRects` reads the full text, resolves every chat anchor, creates a DOM `Range` for each, and calls `getClientRects`/`getBoundingClientRect`.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:518` — `buildNodeContentChangeVisuals` begins a similar geometry path for unseen changes.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:357-396` — `locateTextRangeBoundary` recursively visits text nodes and repeatedly asks for document offsets.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:421-429` — `getSelectionPointDocumentOffset` clones the root-prefix `Range` contents and rereads the resulting text.
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:5000-5007` — the editor `onScroll` handler updates `documentScrollTop` on every inner scroll event.
- `frontend/src/modules/nodes/editorTextBlockChatHighlights.ts:18-40` — every anchor is resolved independently; stale offsets fall back to `documentText.indexOf(quote)` at line 33.

#### What the user experiences

After a node edit, Mango recalculates annotation geometry. During inner-editor scrolling, every scroll event updates React state and schedules that work again. Geometry calls force the browser to ensure layout is current before returning rectangles.

The offset converter is especially expensive. While walking text nodes, it repeatedly builds a range from the document root to the current point, clones its contents, and rereads the text. In the worst case this repeatedly processes larger prefixes of the same document, approaching `O(T^2)` for `T` text nodes for one range. That cost is then multiplied by the number of chat anchors and content-change markers. Stale anchors add up to `O(M * N)` quote searches for `M` messages over document text length `N`.

This confirmed cause explains slow inner-editor scrolling and adds substantial work to node typing. It can also trigger long layout and paint tasks when many highlight rectangles are present.

### 3. Confirmed: chat typing rerenders the large shared node subtree

#### Current state ownership and render path

- `frontend/src/modules/nodes/NodeWorkspaceSurface.tsx:383` — the complete `blocks` collection is state on `NodeWorkspaceSurface`.
- `frontend/src/modules/nodes/NodeWorkspaceSurface.tsx:384` — all `chatMessages` are state on the same component.
- `frontend/src/modules/nodes/NodeWorkspaceSurface.tsx:391` — all `chatDrafts` are also state on the same component.
- `frontend/src/modules/nodes/NodeWorkspaceSurface.tsx:2614` — the parent maps every block during render.
- `frontend/src/modules/nodes/NodeWorkspaceSurface.tsx:2618` — any block with messages automatically shows its chat unless explicitly closed.
- `frontend/src/modules/nodes/NodeWorkspaceSurface.tsx:2901` — every text block renders a `NodeTextBlockEditor`.
- `frontend/src/modules/nodes/NodeWorkspaceSurface.tsx:2957` — every visible chat renders a `ChatPane`.
- `frontend/src/modules/nodes/NodeWorkspaceSurface.tsx:2964` — the draft value flows from the parent into the chat pane.
- `frontend/src/modules/nodes/NodeWorkspaceSurface.tsx:2981` — `onDraftChange` replaces parent `chatDrafts` state.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:1690` — `ChatPane` is a normal function component, not a memoized boundary.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:1734` — `buildChatThreads` is memoized, but that does not prevent the component and message tree from rendering.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:2052-2076` — all thread roots are mapped.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:2371` — `ChatThreadItem` is also a normal function component.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:2499-2524` — replies are recursively rendered.
- There are no `React.memo` boundaries in `NodeWorkspaceSurface.tsx`, `NodeWorkspaceSurfaceParts.tsx`, or `EditorDocumentSurface.tsx`.

#### Composer-local work

- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:1761-1774` — `resizeComposer` writes textarea height, reads `scrollHeight`, writes height again, and updates state.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:1792-1795` — a layout effect invokes that resize after draft changes.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:2225-2230` — textarea `onChange` updates parent draft state and local mention state.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:2199` — `onKeyUp` refreshes mention state again.

#### What the user experiences

Every character typed into one chat composer updates state at the top of the entire node workspace. React then revisits the `blocks.map`, every mounted editor, every mounted chat, and every mounted message/reply subtree. The rough React cost is proportional to the number and size of mounted block/chat/message subtrees, not the one textarea being edited.

The textarea also performs a synchronous height write/read/write sequence, which can force layout, and mention handling repeats work. Those are real secondary costs. The primary reason chat typing slows down only on very large nodes is the shared-parent rerender fan-out.

Chat typing does not sanitize or serialize the node document and does not send network requests before submission. The composer is coupled to an expensive shared tree; it is not using the node editor's full-document input pipeline.

### 4. Confirmed: the node eagerly mounts large DOM and image subtrees

#### Current path

- `frontend/src/modules/nodes/NodeWorkspaceSurface.tsx:2614` — all node blocks are mounted through one `blocks.map`; there is no windowing or virtualization.
- `frontend/src/modules/nodes/NodeWorkspaceSurface.tsx:2618` — chats with messages are shown automatically unless closed.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:2052-2076` and `2499-2524` — every message thread and reply is mounted recursively.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceShared.tsx:121-124` — text blocks and chats have large minimum/maximum dimensions.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceShared.tsx:134` — the default chat height is 698 pixels.
- No `content-visibility`, `contain-intrinsic-size`, or list-windowing boundary exists in this node/chat path.
- `frontend/src/modules/editor/editorImages.ts:75-79` — image hydration uses an 800-pixel root margin, four concurrent requests, and a five-second watchdog.
- `frontend/src/modules/editor/editorImages.ts:469` — hydration starts by querying every image frame.
- `frontend/src/modules/editor/editorImages.ts:562-576` — an `IntersectionObserver` initially gates hydration by proximity.
- `frontend/src/modules/editor/editorImages.ts:577-579` — after five seconds, the watchdog schedules every attachment that remains, defeating long-term viewport gating.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:2562-2607` — chat attachment lists eagerly map every attachment.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:2728-2734` — each mounted thumbnail calls `useAttachmentObjectURL` without viewport gating.

#### What the user experiences

Once a large node is open, the browser retains a large DOM tree containing all text blocks, chats, messages, replies, and attachment consumers. Scrolling the outer node or chat list does not run a Mango scroll algorithm, but the browser still has to style, lay out, paint, composite, and retain this entire mounted surface.

Images amplify the cost. The initial observer is bounded, but the five-second watchdog eventually asks every remaining editor image to hydrate. All mounted chat thumbnails request their image immediately. Decoded image memory can be much larger than compressed transfer size, so many large images increase memory pressure and paint/compositing cost even after network requests finish.

This confirmed cause explains slow outer-node and chat scrolling and amplifies both node and chat typing because React and the browser have more mounted work to revisit.

### 5. Confirmed: the 160 ms collaboration batch delays work but does not combine per-keystroke operations

#### Frontend path

- `frontend/src/modules/editor/editorTextboxSync.ts:80` — the product caps one canonical editor document at 2 MiB.
- `frontend/src/modules/editor/editorTextboxSync.ts:386-398` — each mounted text block starts its own exact-scope frontend-backend textbox sync subscription.
- `frontend/src/modules/editor/editorTextboxSync.ts:413-460` — `queueDocumentChange` checks/encodes the full HTML, calculates the patch, creates a pending operation, persists it to IndexedDB, and applies it locally.
- `frontend/src/modules/editor/editorTextboxSync.ts:419-425` — each queued change scans and UTF-8 encodes the full HTML.
- `frontend/src/modules/editor/editorTextboxSync.ts:428-430` — the persistence chain computes a full common prefix/suffix diff.
- `frontend/src/modules/editor/editorTextboxSync.ts:433-447` — one pending operation is created per scheduled document change.
- `frontend/src/modules/editor/editorTextboxSync.ts:449` — each operation is persisted with `putPending`.
- `frontend/src/modules/editor/editorTextboxSync.ts:467-477` — the 160 ms timer arms the drain; it does not merge operations already created.
- `frontend/src/modules/editor/editorTextboxSync.ts:252-269` — `editorHTMLPatchForChange` compares full old/new strings and encodes the prefix.
- `frontend/src/modules/editor/editorTextboxSync.ts:272-283` — `applyEditorHTMLPatch` encodes and rebuilds the canonical string.
- `frontend/src/modules/editor/editorTextboxSync.ts:555-581` — `performDrain` posts pending operations sequentially.
- `frontend/src/modules/editor/editorTextboxSync.ts:636-654` — acknowledgement applies canonical state, deletes the completed operation, and rewrites the remaining pending collection.
- `frontend/src/modules/editor/useEditorTextboxSync.ts:63-66` — every editor document change is scheduled into this path.

#### Backend path

- `backend/internal/http/editor_collaboration_handlers.go:85-111` — the collaboration commit HTTP handler.
- `backend/internal/store/postgres_editor_collaboration.go:82` — `CommitEditorCollaborationOperation` starts the transaction.
- `backend/internal/store/postgres_editor_collaboration.go:151` — the patch is applied to the full canonical HTML.
- `backend/internal/store/postgres_editor_collaboration.go:193-200` — the complete canonical HTML row is updated.
- `backend/internal/store/postgres_editor_collaboration.go:202` — the projection is materialized.
- `backend/internal/store/postgres_editor_collaboration.go:665-698` — materialization reads the current projection, wraps the complete document, and upserts the full projection row.
- `backend/internal/store/editor_collaboration.go:218-237` — `ApplyEditorHTMLPatch` copies/rebuilds the full byte string.

#### What the user experiences

The 160 ms delay reduces immediate request frequency only when typing is slower than the drain. It does not combine the durable operations already produced for individual input events. Large-string scans, encodes, IndexedDB writes, acknowledgement handling, and garbage collection still compete for the browser main thread. The server may process a transaction, full canonical write, and projection materialization for each accepted input operation.

Network and backend work are asynchronous, so they are not the first synchronous blocker on a keydown. They are still a sustained contributor during active editing and become more expensive as canonical HTML grows.

## Open-time work versus sustained lag

The node-open path was rechecked because earlier fixes changed it.

- `frontend/src/modules/editor/EditorContent.tsx:2288-2483` — the editor load effect.
- `frontend/src/modules/editor/EditorContent.tsx:2410-2416` — the node path invalidates and loads the node record, projection, content changes, and GVIC in parallel.
- `frontend/src/modules/nodes/NodeRecordStore.ts:107-147` — `getNodeViewPayloadSingleFlight` consolidates the node view through `/v2/nodes/{id}/view`, shares in-flight work, and uses the ETag cache.
- `backend/internal/http/consolidated_view_handlers.go:23-63` — the backend authorizes and computes the ETag.
- `backend/internal/http/consolidated_view_handlers.go:42` — `writeNotModifiedWithETag` can return 304 before `GetNodeView` runs at line 45.
- `frontend/src/modules/nodes/NodeWorkspaceSurface.tsx:888-961` — after data arrives, the workspace maps every text projection, parses all chat/email data, replaces broad state collections, and builds maps/filters.
- `frontend/src/modules/nodes/editorProjection.ts:99-115` — projection parsing enumerates blocks and chat records.
- `frontend/src/modules/nodes/editorProjection.ts:188-197` — text block content is parsed from JSON.

The shared attachment in-flight cache, deferred saved-version history, earlier node-view 304 handling, and consolidated GVIC are present. They reduce open/revalidation cost. They do not remove the sustained per-input, rerender, layout, eager-mounting, or image-memory costs described above.

## Scrolling behavior

### Outer node and chat scrolling

- `frontend/src/modules/nodes/NodeWorkspaceSurface.tsx:2347-2369` — the outer node root is the scrolling container. It only stops wheel propagation; it has no application `onScroll` handler.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:2052` — the chat list has no application scroll handler.

Therefore, ordinary outer-node and chat-list scrolling does not itself cause an API call or a Mango JavaScript refresh. Its slowness comes from the large mounted DOM, layout, paint/compositing, image decoding/memory, and any CSS paint effects.

### Inner editor scrolling

Inner-editor scrolling is different. `useEditorDocumentSurfaceHandlers.ts:5000-5007` updates React state on every scroll, and `NodeWorkspaceSurfaceParts.tsx:892-898` schedules highlight rebuilding when that scroll state changes. This couples scrolling directly to full-text/range/geometry work and is a confirmed main-thread cause.

### CSS paint cost

`frontend/src/index.css:530-573` applies transitions and multi-layer box shadows around editor hover/focus states. These effects are plausible paint amplifiers over large surfaces. Static inspection cannot show what fraction of dropped frames they cause, so CSS is not ranked above the confirmed CPU, rerender, eager-DOM, and image problems.

## Image fetching, memory, and object URLs

The current shared blob path was rechecked:

- `frontend/src/modules/attachments/attachmentApi.ts:372` — `fetchMangoAttachmentBlob` begins the shared fetch/cache path.
- `frontend/src/modules/attachments/attachmentApi.ts:381` — the cache key includes authorization and requested variant.
- `frontend/src/modules/attachments/attachmentApi.ts:395-400` — display/thumbnail blobs use a two-minute retained cache bounded at 32 MiB; originals are not retained in that cache.
- `frontend/src/modules/attachments/attachmentApi.ts:471-479` — each consumer creates its own object URL.
- `frontend/src/modules/nodes/NodeWorkspaceSurfaceParts.tsx:633-670` — `useAttachmentObjectURL` aborts work and revokes its object URL on cleanup.

There is no confirmed unbounded object-URL leak in these paths. Mounted consumers still keep their own URLs and decoded image resources live, so eager mounting remains expensive.

The backend still contains original-file fallback behavior:

- `backend/internal/http/attachment_handlers.go:123-130` — when a derivative object is missing, the response can fall back to the original object.
- `backend/internal/http/attachment_handlers.go:178-188` — `attachmentOriginalContentRead` reads the original content.

Full-original pressure is a plausible contributor when an affected node's display/thumbnail derivative is missing. It is not proven for a specific user node without inspecting that node's attachment data and browser requests.

## Realtime refresh and subscription fan-out

- `frontend/src/modules/editor/EditorContent.tsx:1901-1958` — `refreshEditorSnapshot` invalidates and reloads node projections and content changes.
- `frontend/src/modules/editor/EditorContent.tsx:1960-1993` — the node subscribes to `chat:node`; accepted/create/delete hints schedule a coalesced full canonical refresh after 80 ms.
- `frontend/src/modules/editor/editorTextboxSync.ts:386-398` — each mounted text block owns an exact frontend-backend textbox sync subscription.
- `frontend/src/modules/editor/editorTextboxSync.ts:503-545` — recovery performs snapshot GETs, including requests at lines 506 and 523.

Ordinary typing or scrolling does not trigger the broad chat snapshot refresh. Incoming chat activity, reconnect, revision recovery, and related realtime events can. On a large node, that refresh reparses and replaces broad state, causing a large rerender. Open/reconnect subscription and recovery work also scales with text-block count.

This is a confirmed broad refresh path but an event-driven contributor, not the cause of every slow keystroke or scroll frame.

## Network and server work

### During node typing

Editor changes enter the collaboration queue on each committed input. They can produce IndexedDB work and later collaboration POSTs. The backend applies patches, writes full canonical HTML, and materializes the full projection. This is sustained edit work, although the most immediate synchronous lag starts in the browser's full-document editing pipeline.

### During chat typing

There is no chat draft autosave or HTTP request on ordinary chat-composer keystrokes. The request is made only on submit through `frontend/src/modules/nodes/NodeWorkspaceSurface.tsx:1492`, which posts to `/v1/nodes/{nodeID}/information`. The backend handles that submit in `backend/internal/http/node_handlers.go:720-814` and publishes the chat hint at line 808.

### During scrolling

Ordinary outer-node, chat-list, and editor scrolling does not intentionally make network requests. Inner-editor scrolling performs expensive local highlight/layout work. Image requests may continue after open, especially when the five-second image watchdog schedules remaining attachments.

## Confirmed causes, plausible contributors, and ruled-out theories

### Confirmed

1. Repeated full-document sanitize, serialize, text-read, selection, and undo snapshot work on node-editor input.
2. Annotation/change-marker rescanning and forced geometry after edits and inner-editor scroll.
3. Chat draft state at the whole-node parent, causing broad rerender fan-out on every composer character.
4. Eager mounting of every node block and most chats/messages/attachments, plus the five-second editor-image load-all watchdog.
5. Per-change collaboration diff/encode/IndexedDB/backend projection work that is delayed but not truly coalesced.
6. Broad full-node refresh after relevant incoming chat/recovery events.

### Plausible secondary contributors requiring runtime evidence

1. Multi-layer shadows/transitions increasing paint time.
2. Full-original image fallback when derivatives are absent for the affected attachments.
3. Browser garbage collection caused by large temporary HTML strings and undo snapshots.
4. Decode/compositing cost varying with the affected image dimensions, browser, GPU, and memory pressure.

### Ruled out as the primary sustained cause

1. Chat typing does not run node HTML sanitization/serialization.
2. Chat typing does not send a network request until submit.
3. Outer-node/chat scrolling has no Mango scroll-event refresh or API path.
4. Saved-version history is not produced on ordinary typing: `frontend/src/modules/editor/EditorContent.tsx:162` keeps automatic saved-version creation disabled, and history is loaded only for the `save-settings` tab near line 914.
5. The old duplicate attachment-fetch storm is not the primary current explanation because shared in-flight blob caching and object-URL cleanup are present.
6. The previous payload-before-304 node-view problem is fixed in the current handler and concerns open-time/revalidation, not ongoing typing and scrolling.

## Prioritized remediation plan

### Priority 1: remove whole-document work from the native input hot path

- Do not sanitize and serialize the entire document three times for a normal character insertion.
- Keep the browser's native DOM mutation as the immediate source for ordinary text input.
- Represent undo as incremental operations or bounded affected-fragment snapshots rather than full before/after HTML for every input.
- Keep strict sanitization at untrusted boundaries such as paste/import and perform canonical full serialization once per true collaboration/save batch.
- Cache document text/HTML metadata so selection and formatting code does not recursively reread the entire root for one character.

The acceptance target is that ordinary input cost is proportional to the changed block or range, not total document HTML.

### Priority 2: replace repeated highlight offset reconstruction

- Build one cached text-node index with cumulative offsets after a document mutation.
- Resolve all anchors against that index instead of cloning root-prefix ranges repeatedly.
- Recompute geometry only for visible annotations and changed ranges.
- Throttle inner-scroll geometry to at most one `requestAnimationFrame` callback and skip work when no highlights are visible.
- Avoid `getClientRects`/`getBoundingClientRect` loops that interleave layout reads with React state writes.

### Priority 3: isolate chat composer state

- Move the active draft into the composer or a keyed external/local store that does not update `NodeWorkspaceSurface` on every character.
- Add stable memoized boundaries around node blocks, editors, chat panes, and chat thread items.
- Ensure callbacks and data props remain referentially stable so memoization is effective.
- Keep textarea auto-resize local and batch its height measurement to animation frames.

The acceptance target is that React Profiler shows only the active composer and its small mention/resize helpers rendering for one chat keystroke.

### Priority 4: bound mounted DOM and image work

- Window or defer offscreen node blocks and chat messages while preserving selection, anchor navigation, focus, and scroll position.
- Mount chats only when open or near the viewport; do not automatically retain every historical chat subtree.
- Use `content-visibility`/containment as an incremental browser-level safeguard where true virtualization is risky.
- Remove the five-second load-all attachment watchdog or replace it with bounded retry behavior that keeps viewport eligibility.
- Add viewport gating to chat thumbnails and release decoded images/object URLs when far offscreen.
- Repair missing derivatives so display/thumbnail requests do not serve full originals.

### Priority 5: make the 160 ms collaboration batch a real coalescing boundary

- Combine multiple unsent local edits into one bounded durable operation per document/batch while preserving crash recovery and stable operation identity.
- Avoid repeatedly UTF-8 encoding and comparing the complete HTML for each input event.
- Persist the minimum durable delta necessary for recovery rather than rewriting a growing pending collection.
- Materialize the canonical projection once per coalesced batch where product durability and collaboration semantics allow it.

### Priority 6: target realtime refreshes

- Reconcile an incoming chat event into the affected chat/message collection instead of invalidating and reloading all node projections.
- Avoid replacing unrelated block/editor props after chat-only activity.
- Keep exact-scope subscriptions, but defer/recover offscreen block controllers if product semantics permit.

### Priority 7: tune paint only after the structural fixes

- Profile shadows, transitions, gradients, and oversized surfaces with paint flashing and layer borders.
- Reduce the effects proven to create large paint regions, especially around focused editors during typing.

## Required browser profiling before and after implementation

Static inspection proves the expensive code paths and their scaling shape, but it cannot provide millisecond shares, actual dropped-frame counts, heap size, decoded image memory, or the affected user's DOM/message/image counts. A safe runtime profile requires a sanitized representative large-node fixture rather than typing into a real user node.

Capture separate traces for:

1. Ten seconds of node-editor typing.
2. Ten seconds of chat-composer typing.
3. Outer-node scrolling.
4. Inner-editor scrolling with many chat anchors/content-change markers.
5. Open through at least six seconds, so the image watchdog behavior is visible.

For each trace, collect:

- Chrome Performance Bottom-Up and Call Tree time for `sanitizeEditorDocumentHTML`, `serializeEditorDocumentHTML`, `readEditorDocumentText`, snapshot/history functions, highlight builders, range geometry, and textarea `scrollHeight` reads.
- Long tasks over 50 ms, input delay, frame rate, layout duration, paint duration, and forced-layout warnings.
- React Profiler render reasons and commit durations for `NodeWorkspaceSurface`, every `NodeTextBlockEditor`, `ChatPane`, `ChatThreadItem`, and the active composer.
- Total DOM node count; mounted block, message, reply, image-frame, and thumbnail counts.
- Heap snapshots and decoded-image/memory evidence before and after the five-second watchdog.
- Network request counts and payload sizes for editor collaboration, node view/projection refreshes, and attachment content/variants.
- IndexedDB operation frequency and pending-operation growth during a typing burst.

Minimum acceptance goals:

- No repeated over-50-ms main-thread task during ordinary typing or smooth scrolling on the agreed large fixture.
- Node input cost is tied to the changed range rather than whole-document size.
- One chat keystroke rerenders only the active composer subtree.
- Mounted chat messages and image consumers stay bounded by the visible/near-visible region.
- One collaboration operation is emitted per real coalescing window, not per DOM input callback.
- Outer scrolling produces no new network work except genuinely newly visible, bounded attachment hydration.

## Audit provenance

This diagnosis was performed against the current checkout at the time of the audit, after rereading `AGENTS.md` and the relevant owner contracts in:

- `docs/tests/editor.md`
- `docs/tests/nodes.md`
- `docs/tests/attachments.md`
- `docs/tests/attachment-streaming.md`
- `docs/tests/REST API & WebSocket.md`

The audit began and ended on:

- Branch: `codex/investigate-large-node-interaction-slowness0000598`
- HEAD: `db8d9ca5a4995af824b876514f8c7950e495844b`
- Original read-only audit status: clean
- Original `git diff --stat`: empty
- Original `git diff --cached --stat`: empty

That proof applies to the investigation itself. This document was created afterward at the user's explicit request so the diagnosis can be integrated into `main` as an implementation task charter.
