# Editor Module

## Dormant Node change annotations (2026-08-05)

Persisted Tiptap annotations with `kind: "change"` remain valid positional metadata. `mangoTiptapAnnotations.ts` retains ownerless dormant changes, maps their ranges through ProseMirror transactions, and publishes them with the matching revisioned JSON save. Recovery, remount, static sleep/wake, reload, and history preserve them.

Dormant changes never create decorations, unread counts, navigation targets, activation callbacks, seen requests, or Node-view cache work. Comment, chat, and email-selection annotations keep their normal rendering and navigation. The old Node changes API and UI are not compatibility paths.

## Purpose
The Editor module is the linked document workspace for MangoRTS. It gives the selected node or logic gate one full-frame writing surface with native caret behavior, scrolling, and final textbox-backed persistence.

## Retired Node v2/Yjs path (historical record, 2026-07-28)

This path was removed before rollout. Node, Project, and standalone Logic Gate Tiptap editors now use the same `MangoTiptapEditor` and `MangoTiptapSync` revisioned JSON path: quiet-period whole-document batches, one exact IndexedDB recovery operation, optimistic server revisions, and realtime snapshot refreshes. There is no Hocuspocus service, Yjs provider, collaboration URL, or Node v2 frontend in the customer runtime.

Empty Logic Gates use the stable `logic-gate-overview` document ID so the editor renders before any text exists. Historical schema migrations remain immutable records only.


## Gated JSON-Native Tiptap Implementation (2026-07-18)

The repository now contains one reusable Tiptap/ProseMirror 3.28.0 editor core for Node, Project, and standalone Logic Gate/Editor documents. It is inactive for existing data because the company/workspace data-format gate defaults to `legacy_html/not_started`. The Tiptap chunk is lazy-loaded only after a complete JSON-ready gate is verified.

`tiptap/mangoTiptapDocument.ts` defines strict schema version 1. Unknown structure, legacy HTML nodes, unsafe links, transient Blob/data URLs, and unsupported versions fail closed. `MangoTiptapEditor.tsx` owns lifecycle, native transactions/history/selection/commands, static sleeping render, mentions, tables, lists, annotations, deep links, attachments, and surface actions. JSON-mode annotation fields are genuine ProseMirror positions and are mapped through transactions; durable comment, dormant-change, chat, and email-selection positions are committed atomically with the matching document revision, while ephemeral local selections are not persisted. Legacy HTML surfaces retain their legacy text offsets. `mangoTiptapSync.ts` owns one exact IndexedDB pending record, quiet-period batching, retries, optimistic revision checks, stable-operation idempotency, conflicts, and visible-only exact realtime recovery.

Full-document validation, serialization, UTF-8 sizing, and persistence packaging occur at the quiet/max/flush batch boundary instead of on each React render or typed character. Recovery replays an exact stable operation before treating a revision mismatch as a conflict, which recognizes a save already accepted by the backend after a lost HTTP acknowledgement. Browser recovery-storage failures are visible and accurately state that browser recovery is unavailable; backend acknowledgement still releases dirty row pinning even when IndexedDB cleanup fails.

Mango owns the frontend-backend textbox sync and every server responsibility. No Tiptap Cloud, Hocuspocus, Yjs provider, external Tiptap server, HTML compatibility adapter, dual-write, or per-document format fallback exists on this path. Email is deliberately outside this JSON path: compose, reply, forward, attached-email reply, drafts, signatures, display, recovery, and delivery remain on the existing rich-HTML editor and storage contracts.

The old editor remains authoritative until a future whole-workspace conversion validates every document and flips the atomic gate. Do not create JSON-only documents in a legacy production workspace.

## Inline Workspace Entity Links (2026-07-21)

All unified rich-editor surfaces use the same inline workspace-entity behavior. This includes Node and Project text boxes, standalone Logic Gate/Editor documents, project inline Node editors, personal/shared mail compose and reply, attached-email reply, and mailbox signature editors. The shared legacy handler and shared Tiptap extension own the behavior; individual screens must not implement a separate picker or chip format.

Selecting nonblank text exposes a compact highlighted-text action strip. The create action is a square outline with a plus sign and keeps the accessible name **Create node from this highlighted piece of text.** On Node and Project text rows that also expose the chat action, the create button uses the same 28-pixel footprint and sits immediately to the chat button's right with one compact gap; the JSON editor uses the same ordering with matching 30-pixel buttons. The create action must not render as a wide empty popover. It collapses whitespace and applies the existing 500-character Node-title limit, creates the real Node through the scoped workspace entity-batch API, then replaces the still-current selection with a Node entity chip. If creation fails, the selection remains editable and the error is shown. If the document or selection changes after the server creates the Node, the editor clearly reports that the Node exists and instructs the user to insert that existing Node with `#`; it never silently inserts into a different document.

Typing `#` at a text boundary opens the Universal Picker containing accessible Nodes, Projects, Logic Gates, and Emails. A selected tab searches only that exact source. A nonblank All query requests `/v1/company-explorer/search` with `resource_types=node,project,logic_gate` and `ranking=editor_entities`, then searches the connected personal mailbox. Workspace results stay in exact Node, Project, Logic Gate order regardless of completion status; Emails follow them. The backend first ranks a bounded source-table candidate batch and only then checks permission and the exact candidates' visible organizational paths. Within each type, typed search ranks exact, prefix, contains, then ID matches before recency and deterministic name/ID ties. A newer keystroke aborts the older workspace and email requests. Arrow keys move the highlighted option, Enter or unshifted Tab inserts it, Escape closes the picker, and pointer selection follows the existing mention-menu behavior. Each result and inserted chip shows its entity type and corresponding canonical icon.

Entity links are atomic editor objects, not generic tags or plain text. Legacy rich HTML persists a sanitized, noneditable element containing `data-mango-entity-link="true"`, `data-mango-entity-type`, `data-mango-entity-id`, and `data-mango-entity-label`. JSON mode persists `{ "type": "mangoEntityLink", "attrs": { "entityType": "node|logic_gate|project", "entityId": "...", "label": "..." } }` under schema version 1. Unknown types, blank IDs, blank labels, event handlers, and untrusted styling fail validation or are removed at the sanitization boundary.

A chip participates in native editor undo/redo, atomic keyboard navigation, selection, HTML copy/paste, JSON serialization, static/read-only rendering, and sanitized persistence. Delete retains the editor's atomic deletion behavior. Backspace has a deliberate unlink behavior: when the chip is selected/focused or the collapsed caret is immediately after it, one Backspace replaces only the inline object with its stored label as ordinary editable text and places the caret after that label. It does not delete or modify the real Node, Logic Gate, or Project. Undo restores the entity atom with its identity; a later Backspace edits the restored ordinary text normally.

Pointer click, Enter, or Space opens the actual entity through same-document app routing (`history.pushState` plus the app's route event), so the browser document and authenticated Mango shell stay mounted and no login/autologin flash occurs. When an inline Node is opened from a Node route, the new history entry records a validated target-specific source-Node marker. Closing that target Node with X consumes browser history to restore the source Node. Directly opened Nodes, stale/mismatched markers, and Node links opened from non-Node routes retain the ordinary close-to-home behavior. Read-only JSON rendering uses a real deep-link anchor. The stored label is the display snapshot while the durable entity ID and type determine navigation.

Search and creation retain the current company/workspace scope and existing effective-access checks. The combined picker cannot reveal inaccessible Nodes, Logic Gates, or Projects, and creating a Node requires the existing editable workspace path. No entity-link feature adds a new persistence table or bypasses domain authorization.

## Unified Editor Direction (2026-07-08)
- The rich editor must become a shared user-facing behavior source for node text boxes, Logic Gate text, project text boxes, My Triage compose/reply, Shared Triage compose/reply, and attached-email reply bodies that send or draft real mail.
- Shared behavior means editing semantics: indentation, Delete/Backspace, copy/cut/paste, paste cleanup, lists, checklist, link creation, font size, bold, underline, table insertion where supported, selection behavior, keyboard routing, sanitization, and legacy plain-text loading.
- Shared behavior does not mean shared persistence. Node, Logic Gate, project, personal mailbox, and shared mailbox saves must continue to use their own domain adapters and authorization scopes.
- Chat panes inside node/project text boxes are conversation UI and must remain outside the unified rich editor contract.
- The Universal picker's Emails category is the Node/Project attach/select surface; compose/reply bodies belong in real mail compose/reply surfaces and should use the unified editor.

## Unified Editor Implementation Update (2026-07-08)
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts` is the shared rich editor behavior source for keyboard routing, paste cleanup, deletion, lists/checklists, font sizing, bold/underline, links, tables, selection, undo/redo, and sanitized serialization.
- `frontend/src/modules/editor/UnifiedRichEditorSurface.tsx` is the narrow adapter for rich editor surfaces that do not need the full linked-document frame, currently including My Triage compose/reply, Shared Triage compose/reply, and attached-email reply bodies.
- `frontend/src/modules/editor/unifiedRichEditorContract.ts` records the Phase 1 surface IDs and persistence boundaries used by focused frontend tests.
- Node text blocks, project text blocks, project inline critical-path node text boxes, and Logic Gate editor text continue to keep their domain persistence adapters while using the same editor handler behavior.
- `UniversalEntityPicker` plus `UniversalPickerEmailPane` own Node/Project email selection. The obsolete `EmailPickerModal` is removed; the shared picker may search, filter, page, and attach existing email but must not contain compose, reply, send, schedule, draft-save, mailbox-mutation, or compose-body editor behavior.

## Unified Node Shell Implementation Update (2026-07-09)
- `frontend/src/modules/editor/UnifiedNodeShell.tsx` is the shared user-facing shell source for full node-window chrome/action ordering and the node-workspace body boundary.
- `frontend/src/modules/editor/unifiedNodeShellContract.ts` records the Phase 2 surface contract for Home, app/sidebar, dock-restored, Updates, Kanban, and Project critical-path inline node windows.
- The shared shell owns top-right action rendering, accessible labels, action ordering, and data attributes identifying the shell and `node-workspace` body.
- The shared shell does not own opener state or persistence. Popup size/fullscreen state, sidebar-aware bounds, dock restore state, Kanban overlay ratios, Updates notification context, and Project critical-path row selection remain with their current openers.
- Node content still mounts through `EditorContent` and `NodeWorkspaceSurface`, so node text boxes, attached emails, and chats keep node information/projection persistence and the Phase 1 editor/chat boundaries.

## Bounded Node And Project Rows (2026-07-17)

- `editorRowVirtualization.ts` is the shared Node/Project equal-row window. It mounts the viewport plus two-row overscan, preserves the complete list height with spacers, pins only active rows that must remain alive, schedules raw scroll updates through one animation frame, and preserves the logical row when container-driven row height changes.
- Normal opens begin at the top. Navigation first resolves a requested block, chat message, attached email, or email message to its text-box row; the row's neighborhood mounts before scrolling or focus. An unresolved request stays pending until the needed projections arrive.
- Every Node and Project text-box row has one layout: email left, text editor middle, chat right. Email-created Nodes keep their original data associations but do not have a different visual row type.
- The three header buttons independently mount or unmount email, editor, and chat. All three are open on a first open. Section data and drafts remain owned above the mounted section. An active unsent email reply is the one correctness exception: its row and reply UI remain pinned when the email column closes so the draft is not discarded.
- `resolveTextBlockViewportGeometry` gives Node and Project one row height from the visible timeline container. The row fills that space except for the shared next-row preview, while a small safety minimum protects the editor/email/chat controls in unusually short containers. The editor, ChatPane, timeline rail, and virtual spacers consume that same geometry. User-controlled vertical text-box resizing remains removed. Email/chat column widths remain horizontally adjustable, and a narrow viewport still scrolls across the columns.
- Inner editor scroll memory lives above virtual rows. Unmount cleanup flushes pending local input through the existing frontend-backend textbox sync before stopping the mounted editor lifecycle.
- Logic Gate remains on its existing nonvirtualized document surface.

## V1 Mango Attachment System Direction (2026-07-09)
- Rich-editor pasted/dropped inline images should be integrated at the shared `useEditorDocumentSurfaceHandlers` / `editorImages` path so node, Logic Gate, project, My Triage, Shared Triage, and attached-email reply bodies all store Mango attachment references instead of data URLs.
- Temporary image previews may exist in component state while upload is pending, but durable editor, projection, saved-version, draft, and send payloads must not contain base64 file bytes.
- Chat attachments are intentionally separate from unified rich editor semantics; convert `NodeWorkspaceSurfaceShared.readChatAttachment` and related chat rendering to use Mango attachment references without turning chat into rich-editor content.
- Email compose/reply file attachments should use a mail attachment path backed by Mango attachments. Inline body images use the unified rich-editor image path; normal file attachments use attachment references that the backend reads from S3 at send time.

## V1 Mango Attachment System Implementation Update (2026-07-09)
- Rich-editor image frames can now carry `data-mango-editor-attachment-id` metadata and persist a `mango-attachment:` reference source instead of durable data URLs.
- The shared paste/drop image path uploads node, Logic Gate, project, My Triage, Shared Triage, and attached-email reply rich-editor inline images through `/v1/attachments` before committing the editor mutation when the surface provides attachment context.
- Reloaded attachment image frames hydrate their inline display image through Mango attachment content reads, and double-click fullscreen preview asks for the `original` variant when an attachment ID is available.
- Email compose/reply file attachments use `email_draft` resources, attached-email reply file attachments use `attached_email` resources, and backend communications send resolves those Mango attachment references from S3 only at the provider send boundary.
- Incoming provider attachment bytes remain provider-referenced unless a product path explicitly selects them for Mango ownership; that cache/persist step belongs with the attachment ownership contract rather than the shared editor behavior source.

## Browser-To-S3 Node Attachment Update (2026-07-10)

- Browser-selected attachment bytes travel directly from the browser to private S3 through short-lived, intent-owned presigned requests. Mango API remains the control plane for authentication, node authorization, IDs/keys, the configurable 1 GiB default limit, completion/abort, S3 verification, metadata, and the durable node resource link; browser file bytes never travel through Mango API or editor projections.
- Files through and including 64 MiB use one presigned PUT. Larger files use resumable 16 MiB multipart parts. Raw file SHA-256 preparation is incremental and bounded-memory; the editor must not use whole-file `arrayBuffer()`, base64, data URLs, or persisted File/Blob state for the new upload path.
- Upload progress is node-level transient UI, not text-box projection content. Each selected file appears once with filename, visibly pinned extension, size, byte progress, preparing/uploading/retrying/completing/complete/canceled/failed state, cancel, and retry. Transfers do not block editing, completed siblings survive another file's failure, and the completed attachment query refreshes once per completed file rather than once per part.
- The durable owner of an explicit node attachment is the node `resource_attachments` link. `information_id` identifies origin/display context only. Deleting a text box neither deletes nor hides its completed files or attached emails; an in-flight item remains in node-level progress and can complete when the node still exists and current edit authorization passes, without recreating the deleted text-box projection.
- The node-wide attachment counter/list aggregates completed explicit files from every current or deleted-origin text box through one shared node metadata read. Pending/failed/canceled uploads remain outside that count/list. A deleted origin uses the explicit fallback label instead of moving the attachment to another box.
- Existing row presentation remains part of the contract: type icons, visibility-gated image thumbnails, visible extension badges, authenticated row-click preview, and a separate download action that does not also trigger preview. Preview/download continue through Mango's authenticated content endpoint rather than public S3 URLs.
- Backend-originated uploads for email, imports, migrations, and jobs retain the server streaming attachment storage path. This editor change replaces only the normal browser byte-transfer path.
- Terraform contains the private-bucket CORS, task-role, and incomplete-multipart lifecycle configuration needed by this flow, but source code is not a deployment claim. Existing singleton bucket CORS/lifecycle settings must be inventoried and reconciled/imported before an explicitly approved apply.

## Key Responsibilities
- Consume generic live Node or Logic Gate selection from directly linked surviving frames.
- Load selected entity details and projection-shaped document rows assembled from final storage.
- Render the shared rich document surface with native caret, selection, scrolling, formatting, attachment, entity-link, and collaboration behavior.
- Persist document edits through the authenticated editor JSON API with a stable document/textbox ID.
- Preserve dormant Node change annotations through edit/save/recovery/history without rendering or unread behavior.
- Keep manual Save, saving-user identity, History, and Restore through `node_textboxes_history` and `logic_gate_textboxes_history`.
- Support canonical Node and Logic Gate title updates without overwriting an active draft.

## Important Data/Integration Paths
- **Selection input:** `selectionCoordinator.ts` semantic events targeted through `frame-module-links-v1`.
- **Node read path:** Node detail/view and projection-shaped APIs with ordinary Node ETags.
- **Node document write path:** `POST /v1/editor-json/node/:node_id/documents/:document_id?company_id=...`.
- **Logic Gate document write path:** `POST /v1/editor-json/logic_gate/:logic_gate_id/documents/:document_id?company_id=...`.
- **Document clear path:** save the empty canonical JSON document through the same editor JSON path.
- **Title paths:** canonical Node and Logic Gate update endpoints, followed by committed-title cache reconciliation.

## Logic Gate Context
- A selected Logic Gate uses the `Logic Gate:` context header and the same shared text surface as a Node document.
- Ordinary saves update `logic_gate_textboxes`; manual saved versions use `logic_gate_textboxes_history`.
- Projection-shaped reads are synthesized from final textbox and relationship storage.
- Blank documents use the editor JSON contract and never create legacy information/projection rows.

## Document Editing Reliability Update (2026-05-04)- The body editor uses a constrained rich `contentEditable` surface so selected text can carry inline formatting while the frame still owns scroll, autosave, and document context.
- While focus is inside the rich document, browser-native rich text shortcuts such as `Ctrl/Cmd + B`, `Ctrl/Cmd + U`, undo, and redo stay inside the editor. Dashboard frame shortcuts only run when focus is outside editable text.
- Rich documents are stored in `Text box` information with a `mango-editor-html-v1` marker. Existing plain text documents load as escaped text and pasted URLs are converted into safe blue underlined links.
- Typing schedules a debounced save. Blur, node switch, and unmount flush the latest pending value so edits do not wait for a manual save action.
- Saves are serialized per editor instance. If a save is in flight, the editor queues only the latest follow-up value, preserving user-perceived order without flooding the API.
- The editor surface owns the full frame height. It keeps a 20-line bottom buffer, allows blank Enter-created lines to extend the scroll range, and uses horizontal overflow for long lines instead of wrapping at the right edge.
- Metadata and History are isolated from the document body. The rich document stays mounted to preserve draft/autosave state, but it is hidden, removed from tab order, and made non-interactive whenever those tabs own the frame.
- Switching away from the Editor tab flushes the same pending document save path used by blur. This keeps UI tabs and future headless API flows on the same persistence contract instead of adding tab-specific write behavior.
- Selecting a new linked node or logic gate switches back to the Editor tab and focuses the document without forcing the document viewport to the bottom.
- The editor remembers the last scroll offset per open document target in a small bounded in-memory cache. Returning to a node, logic gate, or the Editor tab restores that viewport; unseen documents start at the top.
- The Format tab stays next to the Editor tab as an icon-only font size control. A selection keeps its selection while repeated plus/minus clicks resize that text; a collapsed caret sets the font size for the next typed character.
- The Outline Styles header tab is a themed popover with `Automatic Numbering` and `Indent Guides`, hover highlighting, and a check mark for the active mode. Picking a mode changes future input behavior only; it does not rewrite the existing document or hide the node title.
- `Automatic Numbering` affects new Enter/Tab/Shift+Tab presses after outline markers. Enter continues the current marker family, Tab nests to the next marker family, and Shift+Tab returns to the parent flow. Marker families rotate by depth: decimal, alphabetic, roman, then repeat.
- `Indent Guides` keeps text input plain and draws lightweight vertical indentation guides only for actual indented lines. When this mode is active, both the editable document text and guide overlay must use the same monospace font stack so five literal spaces line up with `5ch` guide positions. Do not switch this mode to the Mango proportional UI font.
- `Indent Guides` places guides on VS Code-style indent boundaries, meaning the depth-1 guide sits at the left text edge, the depth-2 guide sits one tab width in, and each deeper guide advances by exactly one five-space tab width.
- In `Indent Guides`, Enter copies the current line indentation, Shift+Tab removes one indent level, and Backspace deletes a preceding tab-sized five-space run in one edit.
- Clearing all text calls the projection delete API. This keeps reload behavior correct while preserving append-only nonblank history for audit and scale.
- The same editor JSON document APIs work for headless agents: callers save with a stable document ID, read the projection-shaped hot response where needed, and save the empty canonical JSON document to clear it. Outline helpers remain pure frontend functions so future agent-facing command APIs can reuse the same text-edit rules without needing a browser.

## Approved Editor Feel
- Keep the editor feeling like this: a simple, fast, rich document surface with natural typing, preserved document viewport, vertical and horizontal scrolling, and final textbox-backed autosave.
- Outline behavior must stay input-only. Switching outline modes must never scan and transform the whole existing document.
- Tab is intentionally five literal spaces. This is UI-only text input behavior; the backend remains the same headless API contract for users and agents.
- Node and logic-gate title text stays neutral black in light mode, not the Mango accent. The document insertion caret also stays neutral black in light mode, not orange.
- Indent Guides are a monospace plain-text mode. Any UI refresh that changes editor typography must preserve `getEditorDocumentFontFamily("indent-guides")` returning the monospace stack and must keep the guide overlay and editable surface on identical font metrics.
- Rich formatting is intentionally kept inline and sanitized at the document boundary. This keeps writes append-only, API-friendly, and cheap to serve through projection hot paths while allowing document-level formatting in the UI.

## Semantic vs layout persistence policy (2026-04-27)
- Editor document values are persisted in final textbox tables and may be served through projection-shaped API responses for hot-path loads.
- The editor no longer persists document geometry. Frame geometry remains dashboard layout state; document text remains semantic data.
- This removes hot-path JSON geometry reconstruction work while preserving fast local layout interaction.

## Latency hardening update (2026-08-05)
- Editor selection uses the generic live coordinator and direct frame-link targets.
- Link-resolution refresh is triggered by dedicated graph-change events or the frame-link storage key, not unrelated layout churn.
- Entity record and relationship caches coalesce reads and fence stale in-flight title responses.

## Editor persistence + reload correctness update (2026-04-26)- Text box blur-save now commits the current document value directly, preventing stale state snapshots that could previously persist blank/old text and then rehydrate incorrectly after node switches.
- Blur-save now short-circuits when document text has not changed, and also skips creating a brand-new projection row for empty content. This prevents accidental blank projection/history rows when a node is selected but never edited.
- Empty double-click box creation no longer writes an immediate blank persistence row; persistence starts once there is user-entered content or subsequent geometry/text save action.

## Projection identity hardening update (2026-04-28)
- Every newly created editor textbox now gets a stable client-generated UUID `information_id` immediately (before first network save).
- Blur saves and follow-up saves continue using that same textbox identity key.
- Node textbox IDs remain stable in `node_textboxes`; manual history uses `node_textboxes_history`.
- Logic Gate textboxes keep stable IDs in `logic_gate_textboxes`; manual history uses `logic_gate_textboxes_history`.
- This prevents textbox duplication after refresh caused by projection-key drift during rapid save/blur sequences.
- The current Editor has one document surface per node or Logic Gate. The selected stable textbox row is the current document authority.
- Attachments and exact email links come from their final relationship tables and do not become extra editor documents.

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

## Unified image selection update (2026-07-10)

- Selecting a shared editor image frame also places a collapsed caret immediately before the image.
- Text or spaces can be inserted before the selected frame without forking per-surface behavior.
- Pointer dragging, edge/corner resizing, copy/cut, and double-click preview continue to come from the shared editor image and document-surface handlers used by node, Logic Gate, project, personal mail, shared mail, and attached-email reply editors.

## Commenting Convention Reminder
When editing this module, prefer comments that summarize intent and feature responsibilities (what this block controls), not line-by-line implementation mechanics.

## Sent comment editing (2026-07-22)

- The shared `ChatPane` renders Edit on every comment authored by the current user across Node, Project, My Triage, and Shared Triage chat surfaces. Other users' comments remain read-only.
- Inline Save/Cancel edits replace only trimmed text and resolved mention IDs. The server preserves stable identity, original author/creation time, reply/source-selection context, attachments, ownership, and unrelated payload fields, then records `edited_timestamp`.
- Node and email-collaboration edits use the existing exact Node chat scope and a compact `chat.message.updated` wake-up followed by canonical projection refresh. Project chat retains HTTP-only reconciliation.
- Optimistic rows roll back after failure while the inline editor keeps its draft open for retry. Server-side author checks also protect delete and reject legacy POST overwrite attempts.

## One-shot chat/source navigation (2026-07-21)

- Clicking a chat comment creates one monotonic navigation request for its linked editor annotation. The request may wait while the target row or annotation loads, but one successful range focus/scroll consumes it.
- Both the legacy HTML editor and the JSON/Tiptap editor acknowledge successful navigation. `NodeWorkspaceSurface` clears only the matching request, so a stale acknowledgement cannot erase a newer click.
- Legacy rendering also remembers the last handled request locally, and Tiptap keeps the same request-ID guard. Ordinary parent rerenders, chat-message refreshes, pointer hold/release, focus or selection updates, and row unmount/remount cannot replay a consumed request or pull the user away from a later caret/scroll position.
- A later explicit click receives a new request ID and is allowed one new navigation. Failed or not-yet-resolvable targets remain pending instead of being falsely consumed.

## Node email, editor, and chat row ownership (2026-07-20)

`NodeWorkspaceSurface` owns the Node-specific three-column composition. `AttachedEmailOrganizerPane` owns the one left email column, while each text-box row owns one Editor surface and one optional Chat surface.

- The Node email column is independent of every text box. Its organizer header is the only column header. The no-folder path renders email thread cards directly and does not synthesize an `Attached emails` group.
- The email column uses at least the shared resolved text-box row height while the root `ResizeObserver` settles, then keeps the larger remaining-viewport minimum while allowing a selected message to grow to its complete natural height. Email bodies stay white; only organizer, thread, message, and linked-preview headers receive the email accent. The selected body and its containing column do not add a nested height cap or scrollbar.
- A text-box row has exactly one horizontal chrome row. That chrome contains the optional linked-email action, the Editor label/toggle and text-box actions, then the Chat label/toggle. Node passes `hideHeader` to `ChatPane`; email collaboration and Project surfaces retain their existing ChatPane headers unless they explicitly opt out.
- A new box is editor-only. `defaultOpenTextBlockChatIDs` opens chat only when projections already contain direct chat for that box or compatible legacy email-origin chat for its stable host. Empty Node and Project boxes do not restore persisted Chat or Email panes; panes open initially only when their box contains matching data. Manual open/closed layout state continues to override that data-aware default.
- `resolveLegacyEmailChatHostBlockID` must not use render position. It prefers the persisted message association, then a declared block ID, then the oldest box. This prevents prepending a new box from moving old chat.
- `TextBlockActionsMenu` is viewport-fixed. Keeping it inside the React ownership tree preserves outside-click/Escape handling, while fixed positioning escapes the row's deliberate overflow clipping.
- `LinkedEmailPreviewPane` reuses `AttachedEmailThreadCard` and `EmailConversationPane`. It fetches and renders the email from its durable mailbox/thread reference; it does not copy provider HTML, attachments, or credentials into `Text box` information. A message without a provider thread identifier is treated as a complete one-off message, so it does not show the incomplete-thread retry warning.
- Expanding a linked email lets the exact message grow to its natural height above the normal Editor body while Chat remains an independent fixed-height right column. Dynamic linked-email expansion temporarily pins the rows instead of applying fixed-row spacers that could clip the message; collapsing returns to the bounded virtualized layout. Expansion never creates a permanent nested column or persists state.

## Contextual editor menus and selection actions (2026-07-28)

- The `@`, `!`, and `#` suggestion menus share compact 42-pixel rows and show five rows before scrolling. Fixed overlay menus recalculate from their caret anchor during page or nested-editor scrolling, so they move with the document instead of remaining pinned to the viewport. The `#` menu displays smaller product icons.
- Entity results are grouped in stable Nodes, Logic Gates, then Projects order while preserving server relevance within each group.
- Text-selection Chat/Create Node actions are elevated at the highlight's top-right and include the editor's nested scroll offset. Image-selection actions use the same elevated surface immediately outside the image's right edge.

### Error-surface rule

Optional background reads should report failure at the control that can retry them. Node attachment-list failures populate `nodeAttachmentsLoadError` and remain in `AttachmentCountDropdown`; they do not call the global `onError`. Mutations and document/chat persistence failures still call `onError` because user-authored work may require action.
