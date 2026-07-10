Last updated: 2026-07-10

# Unified Editor Tests

Coverage Status:
- People-picker profile palette stability, fallback-key behavior, and minimum contrast are covered by `tests/frontend/modules/editor/editorMentions.test.ts`.
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (`tests/frontend/modules/editor/unifiedRichEditorContract.test.ts` covers the unified surface contract, unified toolbar source/inventory, full mail compose/attached-reply control exposure, shared controller wiring, and EmailPickerModal attach-only source guard; shared editing primitives also have rich/plain editor module tests, including automatic outline numbering toggle behavior and the durable rich-editor image attachment reference source; `tests/frontend/pages/home/homeCommands.test.ts` covers rich email compose send serialization and Mango attachment-reference payloads; backend communications tests cover send-time attachment byte resolution outside the shared editor contract)

## Business Logic

### 2026-07-10 Node Text-Box Lifecycle Boundary

- The unified node editor owns text-box editing and projection deletion, but deleting a text box must not cascade into node file resource links or attached-email projections. Attachment and email retention is a node-domain rule, not rich-editor document ownership.
- Origin metadata may continue to identify the deleted text-box ID for provenance. Unified editor adapters must tolerate that missing live block without recreating a block, moving the association into another block, or dropping it from node-level lists.
- Node-level attachment preview and the global attached-email organizer modal are overlay surfaces outside the editable rich-text document. Opening or closing them must not mutate editor content, steal a durable selection target, create a projection save, or mark a text block as changed.
- The standalone global attached-email organizer, including its folders/list and selected conversation, must work with zero text boxes and in read-only node windows. Per-text-box conversation panes remain unchanged for surviving text boxes.
- Attachment-row activation previews supported content in app; the row's explicit download action remains a separate command. Preview cleanup must release transient requests/object URLs when the overlay closes or switches files.

Required regression scenario:
- Delete a text box that originated files and attached emails while projection saving is active, then reopen the node through more than one unified node-shell opener.
- Confirm the text-box projection stays deleted, no replacement block is created, retained associations remain in the node-level lists, previews and the standalone global email organizer do not dirty editor state, and view-only access can use both viewers.

ED1 - Unified editor means shared user-facing editing semantics across rich editor surfaces; it does not require one shared backend table, API route, save controller, or storage owner.
ED2 - The unified editor contract applies to Logic Gate editor text, node editor text boxes wherever a node editor is opened, project text boxes, project inline critical-path node windows, My Triage compose/reply, Shared Triage compose/reply, and attached-email reply bodies that send or draft real mail.
ED3 - Node text boxes must keep saving through node information/projection persistence, Logic Gate text through Logic Gate information/projection persistence, project text boxes through project information/projection persistence, personal compose/reply through personal mailbox draft/send scope, and shared compose/reply through the selected shared mailbox scope.
ED4 - Editing semantics for Enter, Backspace, Delete, Tab, Shift+Tab, indent/outdent, copy, cut, paste, paste cleanup, source-font normalization, linkification, undo/redo routing, selection preservation, and keyboard shortcut routing must come from one shared editor behavior source or a deliberately shared helper used by every target surface.
ED5 - Rich controls for numbered/alphanumerical lists, bullet lists, checklist, indent guides, font size, bold, underline, hyperlink creation, and table insertion where supported must not be reimplemented per surface with divergent semantics.
ED6 - Pasted rich text in any unified editor surface must normalize to the app/editor font family and must not add extra blank rows around selected inline pasted text because of source boundary whitespace.
ED7 - Legacy plain text loaded into a unified rich editor surface must load through safe escaping/linkification and must not bypass the same sanitization boundary used for rich HTML.
ED8 - Email compose/reply bodies using the unified editor must send sanitized rich HTML and preserve sanitized block indentation, including indent/outdent and blockquote-style indentation.
ED9 - Chat panes inside node/project text boxes are conversation UI, not unified editor surfaces; chat textareas must not inherit rich editor toolbar, indentation, paste, or delete semantics unless a future chat-specific rule explicitly adds that behavior. They may share the people suggestion component used by rich editors, including its visible per-user profile colors.
ED10 - Node/project email pickers are attach/select surfaces only and must not expose compose, send, scheduled send, or draft-save behavior.
ED11 - Map and legacy map-specific editing behavior is outside the V1 unified editor project unless a live non-map editor surface imports a helper that must be changed for the shared contract.
ED12 - Any future change to unified editor semantics must update one shared behavior test plus adapter/mount coverage proving each target surface receives the shared behavior.
ED13 - The V1 shared rich editor behavior source is the editor module handler contract behind `useEditorDocumentSurfaceHandlers`; target surfaces must either call that handler directly or mount a narrow adapter such as `UnifiedRichEditorSurface`, while preserving their own persistence/send adapter.
ED14 - Mail compose/reply and attached-email reply must expose the shared editor format/outline toolbar controls for font size, bold, underline, the outline-style dropdown, and table insertion where supported; mail-specific wrapper controls may add list insertion, indent/outdent, and link commands, but must call the shared editor controller instead of local DOM commands.
ED15 - Nodes opened from Projects participate in the same unified editor contract in both project entry paths: the Critical Path inline node window and the Logic Gates / Nodes tab double-click opener. The Logic Gates / Nodes opener may route to the standard standalone node popup, but the node text boxes inside that popup must still use the shared node editor behavior rather than a project-local editor implementation.
ED16 - The Logic Gate editor text body is a unified editor surface.
ED17 - Node editor text boxes are unified editor surfaces wherever a full node editor is opened, including Home, My Work, Updates, Kanban, Company Explorer/sidebar, minimized dock restore, Project critical-path inline node windows, and Project Logic Gates / Nodes double-click node popups.
ED18 - Project text boxes and project information editors are unified editor surfaces.
ED19 - My Triage email compose and reply bodies are unified editor surfaces.
ED20 - Shared Triage email compose and reply bodies are unified editor surfaces.
ED21 - Attached-email reply bodies opened from an email attached to a node or project are unified editor surfaces when that reply sends or drafts real mail.
ED22 - Chat panes inside node or project text boxes are explicitly not unified editor surfaces; they are conversation UI with chat-specific behavior.
ED23 - Node and project email pickers are explicitly not compose editor surfaces; they may search, filter, scroll, drag, and attach existing email, but they must not contain compose, send, scheduled send, draft-save, or rich body editing behavior.
ED24 - Map and legacy map-specific editor surfaces are explicitly outside the V1 unified editor contract unless they import a helper that is actively shared by a live non-map unified editor surface.
ED25 - Backend persistence unification is explicitly outside the unified editor contract; shared editing behavior must not force node, Logic Gate, project, personal mailbox, shared mailbox, or attached-email reply content into one storage owner.
ED26 - Rich-editor pasted or dropped inline images in unified editor surfaces must follow the global attachment contract in `docs/tests/attachments.md`: temporary previews are allowed, durable editor/email content stores attachment references instead of data URLs or base64 bytes, and email adapters convert those references to CID attachments only at the backend send boundary.
ED27 - Chat attachments remain outside the unified rich-editor contract; they must use the global attachment contract as chat attachments rather than inheriting rich-editor body semantics.
ED28 - Project text boxes must expose the same shared format and outline toolbar controls as node text boxes, including font-size controls, bold, underline, automatic numbering, bullets, checklist, and outline-style selection; project-specific toolbar toggles must call the shared editor controller instead of defining separate semantics.
ED29 - The unified rich-editor toolbar source is `EditorTabBar`. Any rich editor surface that exposes formatting controls must use the same font-size minus/value/plus controls, bold/underline controls, and outline-style dropdown UI instead of reimplementing a look-alike toolbar.
ED30 - The shared outline-style dropdown inventory is Automatic Numbering, Indent Guides, Bullet Points, and Checklist. The compact toolbar inventory used by project text boxes, mail compose/reply, and attached-email reply must come from one shared toolbar tab list so adding, removing, renaming, or restyling those controls changes every compact editor surface together.
ED31 - Font-size toolbar actions must route through the shared editor formatting controller/helper for every unified rich editor surface, including Logic Gate editor text, node text boxes, project text boxes, My Triage/Shared Triage compose and reply bodies, and attached-email reply bodies. A surface must not keep a local font-size span mutation path behind the shared toolbar.
ED32 - The shared formatting controller must restore the last valid editor range before toolbar actions that can move browser focus. Font size applies to the restored range or pending caret, and Bold/Underline state must reflect the browser command state so activating the same control again removes the format.
ED33 - An image-only rich email body containing a durable Mango attachment image counts as sendable content. The frontend must preserve the reference without raw bytes, and the backend email adapter must authorize/resolve it and produce provider-ready CID HTML plus an inline attachment.

## Scenarios

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

Given:
- A user can edit a Logic Gate body, a node text box, a project text box, a My Triage compose body, a Shared Triage compose body, and an attached-email reply body.
- A user can open a node from a Project critical-path row and by double-clicking a node in the Project Logic Gates / Nodes tab.
- The implementation changes indentation, paste cleanup, list behavior, hyperlink creation, font size, the format toolbar, the outline-style dropdown, Delete/Backspace, copy/cut/paste, or keyboard routing.

Expected:
- The behavior change is made in the shared editor behavior source or deliberately shared helper.
- Each target surface receives the same user-facing semantics.
- The unified editor target inventory is Logic Gate editor text, node editor text boxes from every full node editor opener, project text boxes/information editors, My Triage compose/reply, Shared Triage compose/reply, and attached-email reply bodies that send or draft real mail.
- Project critical-path node text boxes and Project Logic Gates / Nodes standalone node-popup text boxes receive the same node editor semantics.
- No target surface keeps a separate local implementation that disagrees with the shared behavior.
- Tests cover the shared behavior once and prove each adapter/mount uses that shared behavior.
- Mail compose/reply adapters do not call browser `document.execCommand` directly for rich editing commands when a shared editor command exists.
- Mail compose/reply and attached-email reply adapters expose numbered list, indent, outdent, bullet list, checklist, font size, bold, underline, link, and table controls where table insertion is supported.
- Font size, bold, underline, the outline-style dropdown, and table insertion where supported are supplied by the shared editor toolbar control source rather than a compose-only, project-only, Logic Gate-only, node-only, or attached-reply-only toolbar implementation.
- The same visible toolbar styling is used for the format controls wherever the shared toolbar appears.
- The outline-style dropdown lists Automatic Numbering, Indent Guides, Bullet Points, and Checklist from the shared inventory.
- Font-size minus/value/plus actions route through the shared formatting helper/controller for selected text and sticky collapsed-caret formatting.
- Toolbar focus changes do not discard the editor range; Bold and Underline toggle off on their second activation and active state follows the caret/selection.
- Project text-box adapters expose the shared node-style format and outline controls and route those actions through the shared editor controller.

### Scenario ED-S2: Domain Persistence Stays Separate

Business logic covered:
- ED1
- ED3
- ED25

Given:
- A user edits node, Logic Gate, project, personal email, and shared email rich editor content.

Expected:
- Node edits persist to node information/projection state.
- Logic Gate edits persist to Logic Gate information/projection state.
- Project edits persist to project information/projection state.
- Personal email compose/reply sends or drafts through the personal mailbox scope.
- Shared email compose/reply sends or drafts through the selected shared mailbox scope.
- The shared editor behavior does not force unrelated domains into one backend persistence path.

### Scenario ED-S3: Email Compose And Reply Use Unified Rich Editing

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

Given:
- A user writes a personal compose, personal reply, shared compose, shared reply, or attached-email reply body.
- The body contains links, pasted content, rich formatting, indented blocks, or legacy plain text loaded from a draft.

Expected:
- The body editor uses the shared editor behavior.
- Legacy plain text loads safely as escaped/linkified rich content.
- Sent or saved rich content is sanitized.
- Indented blocks remain indented in sent HTML instead of flattening.
- Numbered-list toolbar actions create or toggle a shared automatic numbered/alphanumerical list item rather than only changing an outline-style setting.
- The visible mail toolbar includes the shared font-size control, bold/underline controls, and outline-style dropdown used by the main editor.
- The numeric font-size picker restores the prior editor selection before applying, and Bold/Underline are reversible toggles whose serialized HTML preserves the final state.
- A body containing only a pasted attachment-backed image is sendable without adding placeholder text.

### Scenario ED-S4: Chat Is Excluded

Business logic covered:
- ED9
- ED22

Given:
- A user opens a chat pane inside a node or project text block.

Expected:
- Chat remains a conversation composer.
- Chat does not show the unified rich editor toolbar.
- Chat does not receive rich editor indentation, paste, delete, list, or font-size semantics.
- Chat-specific quote/prefill and mention behavior can continue independently.
- Typing `@` or `!` in node, Logic Gate, or chat text opens a people list whose profile color is derived first from normalized user ID, then normalized email, then normalized display name, so the same user keeps the same color between openings and surfaces.
- The shared palette uses opaque, dark profile backgrounds with readable white foregrounds and dark borders. Profile/avatar color remains visible on ordinary, hovered, keyboard-active, and selected suggestion rows and must meet the shared minimum contrast test.
- A keyboard-active rich-editor row adds only a translucent tint of that user's profile color plus the existing active rail; it does not replace the opaque full-color avatar. Chat may retain its existing active-row treatment, but its avatar also remains opaque and full-color.
- Missing optional profile data uses the shared deterministic fallback presentation rather than an uncolored or broken row.

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

### Scenario ED-S6: Map Is Out Of Scope

Business logic covered:
- ED11
- ED24

### Scenario ED-S7: Unified Rich-Editor Images Use Mango Attachments

Business logic covered:
- ED2
- ED3
- ED13
- ED26
- ED27
- ED33

Given:
- A user pastes or drops an image into a node text box, Logic Gate editor body, project text box, My Triage compose/reply body, Shared Triage compose/reply body, or attached-email reply body.
- A user separately attaches an image to a node/project chat.

Expected:
- The rich-editor image insertion path comes from the shared editor handler contract.
- Durable saved rich-editor content stores attachment references, not `data:image/...;base64` or durable `dataURL` values.
- For email surfaces, the backend send adapter deduplicates and resolves those references, rewrites outbound image sources to matching `cid:` values, and returns metadata-only attachment fallback data for immediate rendering.
- Each rich-editor surface still saves or sends through its own node, Logic Gate, project, personal mailbox, or shared mailbox adapter.
- Chat attachment behavior follows `docs/tests/attachments.md` as chat attachment behavior and does not become unified rich-editor content.

Given:
- A V1 unified editor implementation pass is changing rich editor behavior.

Expected:
- The pass does not spend implementation or verification time on legacy Map behavior.
- Map code is touched only if a shared helper used by live non-map editor surfaces requires a compatible update.

---

## Codex Read-Only Editor Semantics Audit (2026-07-10)

> Attribution: This entire appended audit section was explicitly authored by Codex, the OpenAI coding agent that performed the editor-semantics audit for this repository. These are Codex's findings and observations, not a pre-existing MangoRTS product specification.
>
> Investigation boundary: Codex made no code changes during this audit. The local PowerShell runner failed before every process start with Windows error 1312, so Codex could not inspect uncommitted-only local differences or execute the test suite. To continue without guessing, Codex performed a read-only inspection of the connected GitHub repository, `ScoobyXD/MangoRTSDev`, at remote `main` commit `1d3a3a119d835ae78619fbc5d683459aec30592b`. Any local-only changes after or outside that commit require a follow-up comparison.

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
| Logic Gate editor body | `EditorContent` mounts `EditorDocumentSurface` and calls `useEditorDocumentSurfaceHandlers` | Full editor toolbar, company mentions, inline images, and a visible table action | Logic Gate information/projection |
| Node text box | `EditorContent` mounts `NodeWorkspaceSurface`, whose blocks use `NodeTextBlockEditor` and the shared handler | Mentions, inline images, per-block tables, text/image comment actions, content-change overlays, attached-email pane, and separate chat pane | Node information/projection, inside the `mango-node-text-block-v1` envelope |
| Node editor opener variants | Home, sidebar, dock restore, Updates, Kanban/My Work, Company Explorer, and Project critical-path windows all mount the same node workspace | Opener chrome and state differ, but the text engine is the same | Node information/projection |
| Project text box | Project Summary directly reuses `NodeTextBlockEditor` | Same rich behavior as a node block, plus project-specific saving; its chat and attached-email panes stay separate | Project information/projection, inside the same text-block envelope |
| My Triage compose/reply | `ComposePanel` mounts `UnifiedRichEditorSurface` with `my-triage-compose` | Compact Format + Outline toolbar, no company mention users, email-draft attachment ownership | Personal mailbox draft/send |
| Shared Triage compose/reply | The same `ComposePanel` selects `shared-triage-compose` when a shared inbox is active | Same editing behavior as My Triage; mailbox and attachment ownership differ | Shared mailbox draft/send |
| Attached-email reply | The attached-email pane mounts `UnifiedRichEditorSurface` with `attached-email-reply` | Compact Format + Outline toolbar, no company mentions; inline and file attachments use the attached-email resource | Component-local reply body until direct send |

There are three separate rich-editor DOM wrappers even though they share the same handler:

- Full linked document: `frontend/src/modules/editor/EditorDocumentSurface.tsx`.
- Node/project text block: `NodeTextBlockEditor` in `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx`.
- Mail adapter: `frontend/src/modules/editor/UnifiedRichEditorSurface.tsx`.

Only the mail adapter emits `data-mango-unified-rich-editor`. Node, project, and Logic Gate surfaces rely on source wiring rather than a common runtime surface identity.

### Plain And Intentionally Excluded Writing Surfaces

These surfaces do not inherit the rich editor's list, indentation, paste, image, or formatting semantics:

- Node/project chat composer: native textarea. Enter sends, Shift+Enter inserts a newline, and Tab accepts an open mention or follows normal focus behavior.
- Node Map inline comments: native textarea. Ctrl/Cmd+Enter submits.
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
| Table cell | Inserts a `<br>`; Bullet/Checklist mode may convert the entire cell to a list | Inserts a `<br>` | Moves to the next cell; Tab from the last cell creates a row up to the 20-row limit | Moves to the previous cell; the first cell remains selected |
| List inside a table cell | Enter gets special list handling | Soft line break | Table navigation wins, so the list cannot indent | Table navigation wins, so the list cannot outdent |
| Mention menu open | Accepts the highlighted mention | Also accepts the mention because Shift is not distinguished | Accepts the mention | Also accepts the mention |
| Selected image | General Enter behavior; there is no dedicated image Enter contract | General Shift+Enter behavior | General Tab behavior after the image selection is cleared | General Shift+Tab behavior |
| Pasted native ordered-list item | Generic text Enter rather than structural list splitting | Generic text newline | Inserts spaces instead of nesting the native ordered item | Runs plain-text outdent rather than structural list lifting |

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
- Tab nests only if the item has a previous sibling.
- Shift+Tab outdents only if the item is already inside a nested list.
- Tab/Shift+Tab affect one active item, not every selected list item.
- Changing the Outline Style while the caret is already in a structural list does not change that list's kind. Enter continues the existing bullet/checklist kind.
- Checklist checked state survives Mango rich HTML save and rich HTML copy.
- Plain-text copy contains only item text; it loses the bullet marker, checklist marker, and checked state.

### Table Keyboard Rules

- Tab and Shift+Tab are reserved for cell navigation before structural list routing runs.
- Tab from the final cell creates a new row, capped at 20 rows.
- Shift+Tab in the first cell stays in that cell rather than leaving the table.
- Enter inserts a line break in an ordinary cell.
- In Bullet/Checklist mode, typing into an empty cell can start a structural list.
- In Bullet/Checklist mode, Enter in a nonempty ordinary cell can wrap all editable cell content into a first list item and append an empty item, regardless of the caret split point.
- Automatic Numbering does not receive special continuation behavior in table cells.
- Table paste normalizes to at most 20 rows and 8 columns.
- Pasted tables force the first row and first column into Mango header semantics, even if the source table did not define both as headers.

### Other Editing Rules

- Ctrl/Cmd+Z and redo shortcuts route through a custom editor undo history.
- Ctrl/Cmd+B and Ctrl/Cmd+U remain browser rich-text commands, with mutations subsequently sanitized and saved.
- Font size is clamped to 10-28px for toolbar operations.
- A collapsed caret can hold a pending font size for the next typed character.
- Escape clears editor selections/menus and blurs the editor, which also flushes pending persistence.
- Pasted and legacy plain-text URLs are linkified only for HTTP(S) URLs.
- Typing a URL does not generally create a link automatically.
- Clicking an existing link opens it in a new tab rather than placing the caret in it.
- Mention Enter/Tab acceptance takes priority over newline and indentation behavior.
- Mention nodes are noneditable spans. Editing adjacent to one first breaks it back into ordinary text.
- Images are noneditable frames. Clicking selects them, dragging moves them, edge/corner dragging resizes them, double-click opens a preview, and Delete/Backspace removes a selected image.
- Image insertion always adds a clear break and a caret node after the frame.
- Right-click exposes a Create Table command through the shared handler even on compact mail surfaces whose toolbar intentionally does not expose a table button.

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
- Converts the Unicode right-arrow character to the two ASCII characters `->` during sanitization.
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
- A custom-selected image uses a dedicated copy path.
- There is no dedicated `onCut` handler despite the documented shared copy/cut contract.

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

#### Finding 6: Persisted Image Copy And Cut Are Broken Or Destructive

Expected:
- Copy should place usable image HTML/data on the clipboard.
- Cut should copy successfully before deleting.

Actual:
- A hydrated durable image usually has a `blob:` display source plus an attachment ID.
- A nonhydrated durable image has a `mango-attachment:` source.
- Both clipboard writers require a safe raster data URL and reject those durable/display sources.
- `copySelectedEditorImage` returns handled even when the clipboard writes fail.
- The handler prevents the browser's default copy, potentially leaving an empty clipboard.
- Ctrl+X directly removes the selected image without a dedicated cut/copy step.

Primary references:
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:2242-2250`
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:4058-4066`
- `frontend/src/modules/editor/editorImages.ts:53-57`
- `frontend/src/modules/editor/editorImages.ts:173-198`
- `frontend/src/modules/editor/editorImages.ts:382-393`

#### Finding 7: Structural List Enter Can Move Existing Child Hierarchy

Expected:
- Splitting a parent item at the end of its text should leave an existing child list attached to the intended parent.

Actual:
- `insertEditorListItemAfter` extracts everything from the caret to the end of the `<li>`.
- That trailing fragment can include an existing nested list.
- Enter at the end of parent text can move the child list under the newly created blank sibling.

Primary reference:
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts:1550-1577`

#### Finding 8: Tab With A Selection Is Destructive

Expected:
- Indent selected lines/items while retaining their content and a useful selection.

Actual:
- Outside a structural list, Tab replaces the entire selected range with five spaces.
- Multiline indentation is not implemented.
- Shift+Tab modifies only the line containing selection start and collapses the selection.
- Structural list Tab affects one active item rather than every selected item.
- The current unit test explicitly requires selected-text replacement, so the undesirable behavior is locked in as an expected result.

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

#### Finding 11: Table Routing Overrides List Routing

Expected:
- Lists inside cells should have an explicit and consistent nesting/outdent contract.

Actual:
- Table-cell detection runs before list detection.
- Tab/Shift+Tab always navigate cells and cannot nest/outdent the list.
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

#### Finding 13: Same-Kind Structural List Paste Ignores The Caret Split

Expected:
- Pasting list items in the middle of an item should preserve text before and after the caret in a predictable list structure.

Actual:
- When the pasted fragment consists entirely of same-kind lists and the selection is collapsed, every pasted item is inserted after the current item.
- The active item is not split at the caret.
- Trailing text remains in the original item.
- Noncollapsed or mixed-kind paste falls back to generic fragment insertion and can create awkward nested structures.

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

#### Finding 18: Selected Durable Image Copy Reports Success Even When Nothing Was Written

This is the focused clipboard-state portion of Finding 6:

- `copySelectedEditorImage` ignores the boolean result of `writeImageClipboardData`.
- It also invokes the async system writer without waiting for success.
- It then returns `true`, so `onCopy` prevents the browser default.
- This can blank a user's clipboard while presenting no error.

#### Finding 19: Rich Text Defines Custom Copy But No Custom Cut

- The shared handler contract includes `onCopy` but not `onCut`.
- Browser cut behavior can mutate custom lists/mentions/images through native DOM rules.
- A custom-selected image is not necessarily represented by a DOM range, so native cut cannot reliably copy it.
- Ctrl+X special-cases only deletion of the selected image.

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
- `onInput` serializes and sanitizes that DOM for persistence.
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
- `richTextEditing.test.ts` covers linkification, email serialization strings, legacy escaping, a limited sanitizer fallback, attachment source helpers, and image geometry helpers.
- `unifiedRichEditorContract.test.ts` verifies the surface inventory and adapter wiring by reading source files and matching regular expressions.
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
16. `editorProjectionDeltas.test.ts` exists but is not included in the frontend node-test runner or its test TypeScript configuration.
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

Given:
- Any unified rich-editor surface contains a resizable image frame.

Expected:
- A single click selects the image and places a collapsed caret immediately before its frame.
- Typing or pressing Space inserts content before the image.
- Dragging the image body still moves it, dragging an edge/corner still resizes it, Delete/Backspace still removes a selected image, and double-click still opens preview.
- The behavior is identical in node, Logic Gate, project, My Triage, Shared Triage, and attached-email reply editors.
