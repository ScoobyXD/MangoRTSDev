# Editor Module

## Purpose
The Editor module is the linked document workspace for MangoOS. It gives the selected node or logic gate one full-frame writing surface with native caret behavior, scrolling, and projection-backed persistence.

## Key Responsibilities
- Resolve which Node Map frame this editor is linked to through the frame-link graph + frame registry.
- Resolve which Logic Gate Map frame this editor is linked to through the same frame-link graph + frame registry.
- Read the currently selected node from linked Node Map local state.
- Read the currently selected logic gate from linked Logic Gate Map local state.
- Load selected node details and latest `Text box` projection rows.
- Load selected node/logic-gate projection rows for latest text-box values.
- Render a single native document editor surface that supports normal click-to-place caret, blinking insertion point, typing, spacing, tabs, and scroll overflow.
- Persist document edits back to backend node/logic-gate information APIs with a stable `information_id`.
- Clear a document by deleting its latest projection row instead of writing blank history rows.
- Surface node context from the same selected node (metadata summary, history timeline, and non-text info preview).
- Support generic node title updates directly from editor context header (`PUT /v1/nodes/:node_id`), including inline rename UX.

## Important Data/Integration Paths
- **Input from Node Map:** selected node state (`node-map-state-v1:<company_id>:<map_widget_id>`).
- **Linking source:** generic frame-link graph (`frame-module-links-v1`) + frame registry (`frame-module-registry-v1`) with graph traversal to nearest linked map frame.
- **Explorer fallback context source:** editor can read explorer-driven node selection from `node-map-explorer-context-v1:<company_id>:<editor_widget_id>` when no direct map-state context is available.
- **Backend read path:** `GET /v1/nodes/:node_id?company_id=...`.
- **Backend write path:** `POST /v1/nodes/:node_id/information` for text-box payloads.
- **Logic gate write path:** `POST /v1/logic-gates/:logic_gate_id/information` for text-box payloads.
- **Backend document clear path:** `DELETE /v1/nodes/:node_id/projection/:information_id?company_id=...`.
- **Backend logic-gate document clear path:** `DELETE /v1/logic-gates/:logic_gate_id/projection/:information_id?company_id=...`.
- **Backend node-title update path:** `PUT /v1/nodes/:node_id` with `{ company_id, title }`.
- **Backend logic-gate header update path:** `PUT /v1/logic-gates/:logic_gate_id` with `{ company_id, header }`.
- **Backend projection read path:** `GET /v1/nodes/:node_id/projection?company_id=...` (typed node projection rows for hot editor loads).
- **Backend logic-gate projection read path:** `GET /v1/logic-gates/:logic_gate_id/projection?company_id=...` (typed latest logic-gate information rows).
- **Event sync hooks:** `EVENT_FRAME_LINK_GRAPH_UPDATED`, `EVENT_NODE_MAP_SELECTION_UPDATED`, `EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED`, `EVENT_EXPLORER_CONTEXT_UPDATED`, and `storage` events.

## Unified Map + Rename Sync Update (2026-05-03)
- The Editor can follow the single `map` module for both node and logic-gate context. For logic-gate selection it reads `logic-gate-map-state-v1:<company_id>:<map_widget_id>` from the same linked map frame when no legacy `logic-map` frame exists.
- The Editor subscribes to the node and logic-gate graph caches while an entity is selected. If Map or Company Explorer renames that entity, the Editor title updates from the cache immediately.
- Editor-origin title edits still write through canonical APIs first, then patch the shared graph cache so Map and Company Explorer update without waiting for SSE or a full snapshot refresh.

## Logic Gate Context Update (2026-05-01)
- When Editor is linked to a Logic Gate Map, the context header says `Logic Gate:` instead of `Node:`.
- Logic-gate documents use the same text surface as node documents. Saves append history to `logic_gate_information` and upsert latest values into `logic_gate_projection_table`.
- Editor loads latest logic-gate document text from `GET /v1/logic-gates/:logic_gate_id/projection`, matching the node projection path.
- Blank/whitespace-only editor contents are never sent as information writes; old blank logic-gate text rows are ignored when choosing the document to display.
- This keeps UI and headless API behavior equivalent: agents can create/edit logic-gate notes without needing the visual editor.

## Document Editing Reliability Update (2026-05-03)
- The body editor uses a styled native `textarea`, not raw `contentEditable`, so browser-native caret drawing, insertion point movement, text input, and scrollbars remain reliable inside frame wrappers.
- While focus is inside the document textarea, `Ctrl/Cmd + Z`, `Ctrl/Cmd + Shift + Z`, and `Ctrl/Cmd + Y` use the editor's bounded local text undo/redo stack. Dashboard frame undo only runs when focus is outside editable text.
- Editor undo stores compact changed ranges, not full document snapshots per step. It is capped per mounted editor and reset when a different node or logic-gate document is loaded.
- Editor undo is UI-local only. It does not add rows, columns, or undo payloads to `node_information`, `logic_gate_information`, or projection tables.
- Typing schedules a debounced save. Blur, node switch, and unmount flush the latest pending value so edits do not wait for a manual save action.
- Saves are serialized per editor instance. If a save is in flight, the editor queues only the latest follow-up value, preserving user-perceived order without flooding the API.
- The editor surface owns the full frame height. This prevents the textarea viewport from collapsing to a thin strip and lets mouse-wheel scrolling behave like a regular text editor.
- Metadata and History are isolated from the document body. The textarea stays mounted to preserve draft/autosave state, but it is hidden, removed from tab order, and made non-interactive whenever those tabs own the frame.
- Switching away from the Editor tab flushes the same pending document save path used by blur. This keeps UI tabs and future headless API flows on the same persistence contract instead of adding tab-specific write behavior.
- Selecting a new linked node or logic gate switches back to the Editor tab and focuses the document without forcing the document viewport to the bottom.
- The editor remembers the last scroll offset per open document target in a small bounded in-memory cache. Returning to a node, logic gate, or the Editor tab restores that viewport; unseen documents start at the top.
- The Format tab stays next to the Editor tab and keeps the document surface interactive. It exposes deterministic text commands for bold (`**text**`), underline (`<u>text</u>`), hyperlinks (`[text](url)`), and local document font size.
- The Outline Styles header tab is a selectable dropdown with `Automatic Numbering` and `Indent Guides`. Picking a mode changes future input behavior only; it does not rewrite the existing document.
- `Automatic Numbering` affects new Enter/Tab/Shift+Tab presses after outline markers. Enter continues the current marker family, Tab nests to the next marker family, and Shift+Tab returns to the parent flow. Marker families rotate by depth: decimal, alphabetic, roman, then repeat.
- `Indent Guides` keeps text input plain and draws lightweight vertical indentation guides only for actual indented lines. It uses the same monospace document metrics as the textarea and places guides on VS Code-style indent boundaries instead of centered inside the space run.
- In `Indent Guides`, Enter copies the current line indentation, Shift+Tab removes one indent level, and Backspace deletes a preceding tab-sized five-space run in one edit.
- Clearing all text calls the projection delete API. This keeps reload behavior correct while preserving append-only nonblank history for audit and scale.
- The same document APIs work for headless agents: agents can post latest document text with a stable `information_id`, read projections for sub-100ms hot paths, and delete a projection to clear the latest document value. The outline and inline-format helpers are pure frontend functions, so future agent-facing command APIs can reuse the same text-edit rules without needing a browser.

## Approved Editor Feel
- Keep the editor feeling like this: a simple, fast, native text document surface with natural typing, preserved document viewport, vertical mouse-wheel scrolling, and projection-backed autosave.
- Outline behavior must stay input-only. Switching outline modes must never scan and transform the whole existing document.
- Tab is intentionally five literal spaces. This is UI-only text input behavior; the backend remains the same headless API contract for users and agents.
- Formatting is intentionally represented as plain text tokens until the backend owns a richer document model. This keeps writes append-only, API-friendly, and cheap to serve through projection hot paths.

## Semantic vs layout persistence policy (2026-04-27)
- Editor information values are persisted server-side and served through typed node/logic-gate projection rows for hot-path loads.
- The editor no longer persists document geometry. Frame geometry remains dashboard layout state; document text remains semantic data.
- This removes hot-path JSON geometry reconstruction work while preserving fast local layout interaction.

## Latency hardening update (2026-04-26)
- Editor no longer depends on legacy editor->map localStorage mapping updates.
- Link-resolution refresh is now triggered by dedicated graph-change events (or frame-link storage key changes), not by unrelated app layout churn.
- Node map selection sync now consumes semantic selection events (with revision metadata) rather than high-frequency full map-state event fanout.

## Editor persistence + reload correctness update (2026-04-26)
- Text box blur-save now commits the current textarea value directly, preventing stale state snapshots that could previously persist blank/old text and then rehydrate incorrectly after node switches.
- Blur-save now short-circuits when document text has not changed, and also skips creating a brand-new projection row for empty content. This prevents accidental blank projection/history rows when a node is selected but never edited.
- Empty double-click box creation no longer writes an immediate blank persistence row; persistence starts once there is user-entered content or subsequent geometry/text save action.
- Semantic event precedence update: when map/explorer selection events arrive, Editor applies selected-node IDs directly from event context instead of waiting for debounced map-state storage reads, preventing stale-node display during explorer-driven selection changes.

## Projection identity hardening update (2026-04-28)
- Every newly created editor textbox now gets a stable client-generated UUID `information_id` immediately (before first network save).
- Blur saves and follow-up saves continue using that same textbox identity key.
- The API still appends history rows to `node_information`, but projection identity now remains stable in `node_projection_table`.
- Logic-gate text boxes follow the same contract with `logic_gate_information` history rows and `logic_gate_projection_table` latest rows.
- This prevents textbox duplication after refresh caused by projection-key drift during rapid save/blur sequences.
- Multiple projection rows per node or logic gate are intentional when they have different `information_id` values. Each row is the latest hot-read value for one document/widget/link/media attachment; updating the same attachment must reuse its stable `information_id` instead of creating a second projection row.

## Blank-title inline-edit continuity fix (2026-04-29)
- Editor now keeps the node-title header visible whenever a node is selected, even if the node title is currently blank.
- This preserves the inline title editing surface after users backspace the full title.
- Typing after blanking a title now correctly targets the title editor (after clicking title area) instead of accidentally creating a new canvas textbox due to missing header UI.
- Editor canvas `onKeyDown` now explicitly ignores key events coming from `contentEditable`, `textarea`, and `input` targets so title typing cannot be interpreted as canvas textbox creation when no textbox exists yet.

## UX Notes
- Node context header content is intentionally offset below the frame title strip to avoid overlap with top-left module chrome.
- Node title uses single-click inline edit activation in the header (no double-click required), and click handling is isolated so editor-canvas textbox creation does not trigger from title edits.
- The document surface fills the remaining frame body. Clicking normal text places the caret there; clicking below the written text focuses the editor at the document end, matching native document editor behavior.
- Long documents scroll inside the editor body with a thin frame-themed scrollbar.
- Long documents restore the user's last in-session scroll position when they return to the same document target.
- Editor document controls mark themselves as frame-interactive so tab clicks, outline-style buttons, and typing do not select or drag the containing frame.
- Text value is persisted server-side through append-only history plus latest-value projections.

## Commenting Convention Reminder
When editing this module, prefer comments that summarize intent and feature responsibilities (what this block controls), not line-by-line implementation mechanics.
