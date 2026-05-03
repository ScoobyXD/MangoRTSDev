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
- While focus is inside the document textarea or inline title editor, `Ctrl/Cmd + Z`, `Ctrl/Cmd + Shift + Z`, and `Ctrl/Cmd + Y` are left to the browser's native text undo/redo stack. Dashboard frame undo only runs when focus is outside editable text.
- Typing schedules a debounced save. Blur, node switch, and unmount flush the latest pending value so edits do not wait for a manual save action.
- Saves are serialized per editor instance. If a save is in flight, the editor queues only the latest follow-up value, preserving user-perceived order without flooding the API.
- The editor surface owns the full frame height. This prevents the textarea viewport from collapsing to a thin strip and lets mouse-wheel scrolling behave like a regular text editor.
- Metadata and History are isolated from the document body. The textarea stays mounted to preserve draft/autosave state, but it is hidden, removed from tab order, and made non-interactive whenever another tab owns the frame.
- Switching away from the Editor tab flushes the same pending document save path used by blur. This keeps UI tabs and future headless API flows on the same persistence contract instead of adding tab-specific write behavior.
- Selecting a linked node or logic gate switches back to the Editor tab and focuses the document so the caret starts blinking immediately.
- Enter is native textarea Enter. Tab inserts five plain spaces through the browser text-insertion path when available, so the Tab edit participates in normal textarea undo. There is no automatic list or outline formatting in this pass.
- Clearing all text calls the projection delete API. This keeps reload behavior correct while preserving append-only nonblank history for audit and scale.
- The same APIs work for headless agents: agents can post latest document text with a stable `information_id`, read projections for sub-100ms hot paths, and delete a projection to clear the latest document value.

## Approved Editor Feel
- Keep the editor feeling like this: a simple, fast, native text document surface with immediate caret focus after linked selection, natural typing, native Enter/new-line behavior, vertical mouse-wheel scrolling, and projection-backed autosave.
- Do not add automatic bullets, numbered-list transforms, outline transforms, or rich-text behavior unless there is a specific future product decision and matching tests. The current plain-text behavior is the desired baseline.
- Tab is intentionally five literal spaces. This is UI-only text input behavior; the backend remains the same headless API contract for users and agents.

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
- Text value is persisted server-side through append-only history plus latest-value projections.

## Commenting Convention Reminder
When editing this module, prefer comments that summarize intent and feature responsibilities (what this block controls), not line-by-line implementation mechanics.
