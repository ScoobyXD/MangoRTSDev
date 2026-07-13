Last updated: 2026-07-13

# Nodes Tests

Coverage Status:
- Node attachment presentation and visibility-gated thumbnail behavior are covered by `tests/frontend/modules/attachments/attachmentPresentation.test.ts`; upload concurrency, partial-success, byte-limit, scope/permission invalidation, and delete-while-uploading behavior are covered by `tests/frontend/modules/editor/nodeTextBlockAttachments.test.ts`; shared people-palette behavior is covered by `tests/frontend/modules/editor/editorMentions.test.ts`.
- Attached-email thread parity, resize cleanup, red removal actions, Reply/Reply All focus, and permission Save visibility are covered by `tests/frontend/modules/editor/emailViewerContract.test.ts`; node chat URL detection is covered by `tests/frontend/modules/editor/nodeChatLinks.test.ts`.
- Shared conversion projection provenance is covered by `backend/internal/http/communications_triage_handlers_test.go` and `backend/internal/store/communications_email_conversion_test.go`.
- Browser-direct additions must prove the 1 GiB/64 MiB/16 MiB policy, node-level progress/cancel/retry/resume, completed-only counts, one completion refresh, and completion after origin text-box deletion without projection recreation.
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial. Node soft-delete edit gating and recycle-bin owner stamping have backend coverage; Company Explorer search resource-type filtering has backend coverage; node editor projection-save helpers, including target-scoped teardown and latest-content draining, have frontend coverage; Tab-at-caret editor behavior is covered by `tests/frontend/modules/editor/plainTextEditing.test.ts`; Mango email body marking/display preservation is covered by `tests/frontend/modules/editor/richTextEditing.test.ts` and `tests/frontend/pages/home/homeUtils.test.ts`; the unified editor contract, sole rich DOM host, shared highlight control, attached-email reply focus invalidation, hidden-document formatting disablement, hydration conflict handling, attached-email reply bottom buffer, EmailPickerModal attach-only boundary, red unified close chrome, unified node-shell contract/adapter mounting, and the Project Logic Gates / Nodes panel fullscreen contract are covered by `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts`; shared attachment tests cover node resource links/content authorization and `attached_email` resource authorization; GVIC picker rule IDs, the Assign to Logic Gate picker no-preload UI behavior, and node header project-assignment layout rules are not mapped to automated tests yet.

## Business Logic

### 2026-07-10 Text-Box Deletion Retention And Node-Level Viewers

- Deleting a node text box removes that text-box projection and its local UI, but it must not treat node files or attached emails referenced from that box as child records to delete. File `resource_attachments` links and attached-email projections remain associated with the node unless an editor separately invokes **Remove from node** for the specific row.
- The node header attachment counter/list remains available independently of text boxes and includes files uploaded from deleted text boxes. A missing `information_id` target is displayed with an explicit deleted-text-box origin label instead of hiding the file or assigning it to another box.
- The node header attached-email counter/list also remains available independently of text boxes. Opening it uses a standalone node-level attached-email organizer modal with its folders/list and selected conversation, not an automatically created or arbitrarily selected text box.
- A retained attached email must be viewable from the global node header when the node has no text boxes and when the user has view-only access. Existing per-text-box email conversation panes remain available for live text boxes and are not the required host for the global viewer.
- Clicking a file row opens an authenticated in-app preview without starting a download. Images, PDF, text/code/CSV/JSON/XML, audio, and video are previewable when browser-supported; text preview decodes only the first 256 KiB and renders at most 200,000 decoded characters. Larger text is shown as a bounded/truncated preview with `Preview limited to 256 KiB / 200,000 characters.`, while Office/archive/unknown binary files show preview-unavailable state and retain their explicit download control.
- Browser node attachments default to a backend-authoritative 1 GiB per-file limit with no 12 MiB text-box aggregate. Files through 64 MiB use one presigned S3 PUT; larger files use resumable 16 MiB multipart parts. Pending work is node-level upload-progress state and never inflates the completed node attachment count.

Required regression scenario:
- Attach files and emails from multiple text boxes, select an attached email, delete one originating text box, and then delete all remaining text boxes.
- Confirm the node-level file and email counters do not decrease because of text-box deletion, deleted-origin files remain labeled and usable, and the global email list opens the retained conversation in the standalone node-level organizer with zero live text boxes.
- Confirm a view-only user can list, preview, and download retained files and can open retained attached emails, while upload and other edit operations remain unavailable.

N1 - Nodes support generated, verified, consulted, and informed GVIC assignments.
N2 - Node generated and verified GVIC assignments are single-user slots.
N3 - Node generated and verified GVIC assignments must use a user principal, not a group principal.
N4 - Replacing the generated or verified user on a node removes the previous user for that role.
N5 - Node consulted and informed GVIC assignments may include users and user groups.
N6 - Node GVIC assignment pickers should display the company user-group tree as a collapsed hierarchy.
N7 - Node GVIC picker subgroups and users should be visually indented according to their hierarchy depth.
N8 - A generated or verified node assignment chip should show the assigned user's name and provide a direct remove action.
N9 - DELETE `/v1/nodes/{node_id}` is a soft delete that moves the node and related placements/projections to the deleting actor's Recycle Bin.
N10 - Node soft delete requires edit access to the node; resource admin access is not required, and view-only access is not enough.
N11 - Successful node soft delete stamps `deleted_by_user_id` with the deleting actor.
N12 - The node Assign to Logic Gate picker should not preload or display Logic Gates when opened; it should search only after the user enters text, using the Company Explorer search contract for visible folders, subfolders, and Logic Gates.
N13 - Pasted rich text in node editor surfaces must normalize to the app/editor font family instead of preserving source document fonts.
N14 - Pasting selected inline text into a node editor must not create extra blank rows above or below the pasted content from source boundary whitespace.
N15 - New node editor documents default to alphanumerical numbering, and the editor outline dropdown lists alphanumerical numbering before indent guides.
N16 - The node editor font-size control applies to selected text and, for a collapsed caret, becomes the sticky font size for subsequently typed characters until changed again.
N17 - Node editor Bold, Underline, and Italic controls must toggle selected text or collapsed-caret typing semantics and must visually reflect the formatting at the current caret or selection.
N18 - Inserting a table from the shared node editor toolbar must insert it at the current caret/selection location, not at the top-left or beginning of the editor. A node text-box/header must not render a duplicate table-insertion button.
N19 - A node header can show and edit the node's project placement: the project button displays the current project when one is known and otherwise offers project assignment.
N20 - Assigning a node to a project from the node header supports project-only assignment; selecting a Logic Gate within that project is optional and moves or assigns the node to that Logic Gate only when chosen.
N21 - A node with a known project relationship exposes a Go to Project action that opens the related project directly.
N22 - When selected node text is sent to chat as a quote/prefill, the quote preview must expose a cancel action that clears the selected-text prefill without sending a message.
N23 - Live node editor typing writes the current text-block state to the node editor projection table and must not append a full rich-text document row to `node_information` on every keystroke autosave.
N24 - Node Save Settings lists saved editor versions sorted by saved timestamp, including save kind, saving user, save time, and saved text box count; automatic saved-version creation is disabled during the emergency slowness fix.
N25 - Clicking Save in the node editor flushes pending projection saves first, then creates a manual saved editor version in `node_information`.
N26 - Node automatic saved-version creation must not run in the background during the emergency slowness fix. If auto saved versions are re-enabled later, they must only consider active nodes, must only save nodes whose editor projection has changed, and must never scan or save every node in the system.
N27 - Restoring a node saved version requires confirmation and overwrites the current node editor projection rows from that saved version without creating another saved-version row.
N28 - Node editor text-block projection saves must use one-save-at-a-time latest-content behavior per node text block: while a save is in progress, later edits update the latest in-memory content and mark that another save is needed, but they must not start overlapping `POST /v1/nodes/{node_id}/projection` requests for the same text block.
N29 - Node editor text-block save state must use the vocabulary and behavior `has changed`, `has not changed`, `save in progress`, and `save needed after current save`. A block is marked `has not changed` only when the completed request's version matches the latest local version.
N30 - Node editor forced projection flushes must save only blocks that have changed and must not `Promise.all` every text block in the node. The flush must preserve all user characters by waiting for in-progress saves and then saving the latest content if newer edits arrived.
N31 - Deleting a node text block must not race with an in-flight projection save. If a projection save is already in progress for that block, deletion must wait for that save to finish or otherwise cancel/ignore it before issuing the projection DELETE, so a late POST cannot recreate the deleted block.
N32 - Node text boxes participate in the unified editor contract: changes to indent/outdent, paste cleanup, Delete/Backspace, copy/cut/paste, lists, checklist, hyperlink, font-size, bold, underline, italic, text highlight color/No highlight, left/center/right alignment, and table semantics must apply to node text boxes wherever a node editor is opened.
N33 - Full node editor windows participate in the unified node shell contract: header, title behavior, top-right actions, close/minimize/open/fullscreen/delete controls, sizing, and body layout must come from one shared user-facing shell behavior wherever practical.
N34 - Adding, removing, reordering, or restyling a top-right node-window action must happen through the unified node shell so Home, sidebar/app shell, Updates, Kanban/My Work, dock-restored, Project critical-path inline node windows, and Project Logic Gates / Nodes embedded node panels stay aligned when the capability is available.
N35 - Unified node shell does not require one opener, route, page state, or backend path; a node may be opened from Home, Updates, Company Explorer/sidebar, Kanban/My Work, dock restore, a Project critical-path row, or the Project Logic Gates / Nodes tab while still sharing the same user-facing shell.
N36 - The node workspace body remains text boxes, attached emails, and text-block chats; chats are conversation UI and must not inherit unified rich-editor toolbar, indentation, paste, delete, list, or font-size semantics. The shared `@`/`!` people picker may still be used by node rich text and chat composers, and its user colors must remain visible rather than being neutralized by a disabled/gray presentation.
N37 - The node email picker is attach/select only and must not expose compose, send, scheduled send, or draft-save behavior.
N38 - Project critical-path inline node windows must use the unified node shell and unified node text-box editor semantics while preserving node information/projection persistence for node edits.
N39 - The V1 unified node shell source is `UnifiedNodeShell`; full node-window adapters may keep their own opener state, geometry, route handling, and permissions, but top-right node-window action ordering and shell/body data attributes must come from that shared source.
N40 - Kanban/My Work node overlays expose the same shared fullscreen shell action as Home node popups when a full node editor overlay is opened; activating fullscreen is a temporary viewport-fixed exception to Kanban board-relative bounds, while Kanban keeps the previous board-relative overlay ratio only for restoring when fullscreen is turned off.
N41 - Double-clicking a node in the Project Logic Gates / Nodes tab opens a full node editor inside the right-hand Logic Gates / Nodes region, not the app/sidebar popup and not a project text-box editor. The embedded panel must use `UnifiedNodeShell`, the shared node workspace body, unified node text-box editor semantics, node information/projection persistence, and separate chat-pane behavior. Its fullscreen action expands that same live editor to the browser viewport and toggles back to the right-hand Project region without resetting opener state.
N42 - The Home node popup is a unified node shell surface.
N43 - The app/sidebar Company Explorer node popup is a unified node shell surface.
N44 - A minimized or dock-restored node popup is a unified node shell surface.
N45 - The Updates row detail node popup or node panel is a unified node shell surface.
N46 - Kanban and My Work full node popup or overlay surfaces are unified node shell surfaces.
N47 - The Project critical-path inline node window is a unified node shell surface.
N48 - The Project Logic Gates / Nodes double-click node panel is a unified node shell surface owned as local Project opener state. It exposes close, fullscreen, open-in-new-tab, and pin actions through the shared shell contract.
N49 - Any future project or page surface that opens a full node editor/window must use the unified node shell unless a new documented exception is added with an explicit business rule and test.
N50 - Small node card previews, list rows, tree rows, timeline bars, picker rows, and other non-editor node summaries are not unified node shell surfaces unless they open into a full node editor/window.
N51 - Node text-box inline images, node attachment-button uploads, and node attachment lists must follow `docs/tests/attachments.md`: durable node information/projection rows store attachment references, not data URLs, base64 file bytes, or embedded file payloads; per-text-box and node-wide lists load metadata once at node scope and fetch attachment bytes only for authenticated thumbnails or explicit downloads.
N52 - Node text-block chat attachments remain chat-specific UI, but submitted chat payloads must store Mango attachment references instead of durable `dataURL` values.
N53 - Attached emails on nodes may store message/thread/provider metadata and Mango attachment references, but must not store attachment bytes in node projection rows or communications email attachment JSON.
N54 - The node header Assign to Project button must size to its icon and current label instead of flex-growing into all remaining toolbar space. In the unassigned state it should remain compact for the `Assign to Project` label; after assignment it may grow for `Project: <project name>` up to the node header's project-control maximum and must ellipsize overflow text instead of pushing adjacent header actions away.
N55 - The node header project assignment dropdown must use a compact horizontal width. Its nominal width is clamped to a minimum of 280px, a desktop maximum of 390px, and a compact-layout maximum of 320px, with the browser viewport maximum still allowed to reduce the rendered width when the viewport is narrower.
N56 - Opening the node header project assignment dropdown near the right edge of the visible node workspace must shift the dropdown left just enough to keep the full list visible inside the node workspace or browser viewport. The dropdown must not remain right-anchored when that would clip project names or list content, and the left shift must preserve the normal node workspace side padding.
N57 - When a user clicks Reply on an email attached inside a node, the reply composer appears as a bottom dock inside that email detail immediately; the user must not have to manually scroll down to reveal the To, Subject, toolbar, body, attachments, or send action.
N58 - The attached-email reply composer remains anchored to the bottom of the email detail while the conversation body scrolls above it, and the reply body editor grows upward as additional rows are typed until its documented maximum height is reached.
N59 - Attached-email reply sends use the same email-safe rich-editor serialization as My Triage and Shared Triage compose/reply: sanitized rich blocks, explicit line breaks, indentation, and spacing are preserved in outbound HTML instead of flattening into one long line.
N60 - In automatic numbering mode, pressing Tab in ordinary non-outline node text inserts the five-space tab at the caret; it must not move the entire current text block unless the current line is actually a parsed outline/list item. Shift+Tab may still outdent leading indentation.
N61 - Full node-window close actions render through the unified node shell's red close chrome with a white X across Home, app/sidebar, Kanban/My Work, Updates, Project, and dock-restored node shell surfaces.
N62 - Attached-email reply body editors include a visual one-row bottom buffer through editor padding/scroll padding so the caret stays visible at the bottom; the buffer must not add fake blank lines to the sent email body.
N63 - Mango-authored outgoing email bodies are marked and displayed in Mango with preserved line breaks, spaces, and indentation in node-attached email detail views instead of being normalized into a flat sentence.
N64 - Node text-box formatting is driven by the shared editor toolbar and formatting controller: font-size minus/value/plus, Bold, Underline, Italic, Highlight with **No highlight**, left/center/right alignment, table insertion, and the outline-style dropdown must match Logic Gate, project, and mail editor surfaces in look and behavior wherever a full node editor is opened. Hover/focus/active styling applies only to the individual control.
N65 - Each node text box exposes an attachment-list control beside its attachment-upload control. Its count and rows include only active node `file_attachment` resource links whose `information_id` matches that text block.
N66 - The shared node workspace toolbar exposes one node-wide attachment counter and list. It aggregates all active `file_attachment` resource links for the node across its text boxes, labels each row with its text-box title when available, and excludes inline images, chat attachments, email attachments, and attached emails.
N67 - A node attachment row displays the original filename and byte size and exposes a download action on the right. Download requests the attachment's `original` variant through Mango's authenticated attachment-content API and preserves the original filename; the UI must not use a raw S3 URL, storage key, or legacy durable `dataURL` as the download source.
N68 - Node users with view access may see attachment counts/lists and download authorized files even when the node is read-only. Upload remains limited to users with edit access.
N69 - Node attachment counts and lists are rebuilt from the backend node resource-link list when the workspace loads. Projection attachment references may support editor persistence, but they are not the canonical source for list/download availability.
N70 - Per-text-box and node-wide attachment controls are part of the shared node workspace body, so every full node-window surface using that body receives the same attachment scope, count, list, permission, and download behavior.
N71 - Node permissions opened from any full node-window entry point use the shared permissions contract in `docs/tests/permissions.md`: editable views always display `Save`, successful Save persists the current selection without closing, and read-only, denied, or failed-load views remain dismissible without writing.
N72 - Node-attached email viewers use the shared email-thread contract: full-height body, expand-all, To/Cc/Bcc, exact-message Reply/Reply All, authenticated attachments and image actions, immediate reply focus, original-message context, calendar RSVP, and resize termination after pointer-up/cancel, lost capture, or window blur.
N73 - Editors can right-click an attached-email or attachment row and choose a red `Remove from node`; the action removes only that attached-email projection or node attachment relationship, while view-only users receive no destructive action.
N74 - Node chat detects safe `http://`, `https://`, `www.`, and bare-domain links, excludes trailing punctuation and email-address domains, renders links blue and underlined with opener isolation, and leaves unsafe/non-HTTP schemes as plain text.
N75 - A personal attached-email projection stores `account_email`; a Shared Triage conversion stores both `shared_inbox_id` and `account_email`. Thread, attachment, Reply/Reply All, draft, and calendar operations use those stored fields instead of falling back to another grant.
N76 - Normal browser node file bytes go directly to the private attachment S3 bucket through intent-owned presigned PUTs. Mango API authenticates/authorizes, chooses IDs and keys, enforces limits, completes/aborts/verifies storage, and writes metadata/node links, but it never receives the browser file body.
N77 - Node browser upload policy defaults to 1 GiB per file, single PUT through and including 64 MiB, and 16 MiB multipart parts above it. The direct path does not apply the old 12 MiB-per-text-box aggregate.
N78 - Node upload preparation computes raw SHA-256 incrementally with bounded memory. Multipart concurrency is capped, progress is byte-based, cancellation aborts active requests, retry refreshes expired URLs, and resume does not re-upload S3-confirmed parts.
N79 - Upload progress belongs to the node rather than the origin text box. It shows each selected filename/extension/size once with preparing, uploading, retrying, completing, complete, canceled, or failed state plus progress/cancel/retry; it does not block node editing or enter the normal completed list/count.
N80 - Deleting an origin text box while upload is active keeps node-level progress and permits completion when the node still exists and current node edit authorization passes. It must not recreate the deleted projection. Deleting the node or losing edit access rejects completion and cleans up the unfinalized S3 object.
N81 - One successful completion invalidates the shared node attachment metadata once. Part progress/retry does not repeatedly refetch the completed list, and one failed file does not discard completed siblings.
N82 - Node text boxes use `EditorDocumentSurface` as their rich editable host and the shared formatting controller for font size, bold, underline, italic, highlight color/No highlight, alignment, lists, links, tables, selection restoration, and pending-caret font/highlight typing styles; node wrappers must not render a second rich `contentEditable` host or construct a local formatting controller.
N83 - Node text-block save controllers are scoped by company and node. Closing a node or switching company/node drains every debounced changed block before clearing the old controller.
N84 - External node text-block hydration preserves the logical selection while the document or a shared toolbar control owns focus. Remote content received while the document itself is focused is deferred until blur; an untouched local DOM accepts it without flushing stale HTML, while a locally edited conflict keeps and saves the local version and shows a conflict notice.
N85 - Focusing a node-attached email reply immediately clears the surrounding text block as the outer formatting target. The outer node toolbar disables its formatting controls, the reply toolbar becomes the only formatting owner, and node navigation tabs remain usable.
N86 - Opening Relationships, Metadata, History, or Save Settings from the editor overflow hides or replaces the applicable node document workspace and prevents formatting against a hidden editor without unmounting or resetting its text-block layout. Only formatting controls are disabled; primary and overflow navigation actions remain operable.
N87 - Node saved-version history is not loaded during ordinary node open. It loads on Save Settings activation, preserves manual save/restore behavior, and is cleared/reloaded for the current company/node target rather than blocking initial editor content.
N88 - Node-open reference reads use StrictMode-safe shared ownership: node resource-attachment metadata is one node-scope cached request with explicit mutation invalidation, project relationships are singleflight/cached with invalidation before relationship refresh, and company accounts/users/group reference data is shared across editor instances with mutation/auth-scope invalidation.
N89 - `GET /v2/nodes/{node_id}/view` authorizes first, then reads dedicated shared and actor-specific node-view versions to calculate a salted ETag before building the consolidated payload. A matching request returns `304` without loading/serializing/hash-building the full view, without reading `event_rows`, and without writing seen state; ordinary `200` reads are also write-free.
N90 - Establishing the first-clean-view projection baseline is an explicit idempotent bulk node-changes command outside the canonical GET. It anchors only current text projections that have no unseen other-actor change, derives each baseline from the observed projection update timestamp rather than wall-clock time, uses one bulk repository operation, and never consumes genuinely unseen changes. Clean-anchor snapshot writes do not bump the actor node-view version because the response body is unchanged. The frontend tracks a bounded last-success ETag per cache key and retries failures with bounded same-generation backoff.
N91 - A node editor header keeps Editor, Permissions, the shared formatting toolbar, and Outline Styles/Automatic Numbering in its primary area. Relationships, Metadata, History, Save Settings, save-version/related-node commands, and supported opener-specific secondary actions remain available in one accessible **More editor actions** overflow menu with their existing permission and disabled state.
N92 - Node popups/panels, permissions and email dialogs, and image/attachment/email previews mount through the shared body-level overlay portal above Key Views, Explorer, Search Explorer, and feature-local stacking contexts. Blocking modal modes trap focus and restore prior focus on close; anchored Kanban/Project editor panels may remain modeless until fullscreen. Fullscreen toggling preserves the live node editor instance and opener state.

## Scenarios

### Scenario N-S1: Generated And Verified Single User Slots

Business logic covered:
- N1
- N2
- N3
- N4
- N8

Given:
- A node has editable GVIC fields.
- A company user is assigned to the node's generated or verified field.
- A second user is later selected for the same generated or verified field.

Expected:
- The generated or verified field accepts exactly one user.
- Group principals are not selectable or accepted for generated or verified.
- Selecting the second user replaces the first user for that role.
- The assigned chip displays the user's name.
- The assigned chip exposes a direct remove action instead of an assignment-list dropdown.

### Scenario N-S2: Consulted And Informed Users And Teams

Business logic covered:
- N1
- N5

Given:
- A node has consulted and informed GVIC fields.
- A company has users, user groups, and nested user groups.

Expected:
- Consulted and informed can include individual users.
- Consulted and informed can include user groups.
- Consulted and informed can hold multiple assignments.

### Scenario N-S3: Node GVIC Organization Tree Picker

Business logic covered:
- N6
- N7

Given:
- A company has top-level user groups, subgroups, and users inside those groups.
- A user opens a node GVIC assignment picker.

Expected:
- The picker opens with groups collapsed by default.
- Expanding a group reveals its subgroups and users.
- Top-level groups, subgroups, and users are indented by hierarchy depth so the organization structure is visible.
- Searching may reveal matching branches, but the row indentation still reflects the underlying hierarchy.

### Scenario N-S4: Node Soft Delete Permissions

Business logic covered:
- N9
- N10
- N11

Given:
- One user has view access to a node.
- Another user has edit access to the same node.

Expected:
- The view-only user's DELETE request is rejected.
- The edit user's DELETE request succeeds.
- The deleted node appears in the edit user's Recycle Bin with `deleted_by_user_id` set to that user.

### Scenario N-S5: Assign To Logic Gate Search Starts On Typing

Business logic covered:
- N12

Given:
- A user opens a node's Assign to Logic Gate picker.
- The company has visible Logic Gate folders, subfolders, Logic Gates, and unrelated nodes.

Expected:
- Opening the picker does not automatically query or display Logic Gates.
- Entering a non-blank search term queries the Company Explorer search path for folders, subfolders, and Logic Gates.
- Search results may show folder and subfolder rows as context.
- Only Logic Gate rows are selectable assignment targets.
- Node results are excluded from the picker search results.

### Scenario N-S6: Node Rich Text Editing Controls

Business logic covered:
- N13
- N14
- N15
- N16
- N17
- N18
- N32
- N64
- N60
- N82
- N91

Given:
- A user edits a node text body.
- The user pastes styled text copied from another application.
- The user changes font size, Bold, Underline, Italic, text highlight/No highlight, alignment, outline style, or inserts a table.

Expected:
- Pasted content renders in the node editor's normal font family.
- Pasted inline text does not gain empty rows above or below the copied text.
- New node editor text uses alphanumerical numbering by default, and alphanumerical numbering appears first in the outline dropdown.
- Changing font size while text is highlighted changes that selected text.
- Changing font size with only a caret sets the font size for the next typed characters.
- Bold, Underline, and Italic buttons reflect the caret or selected text state, can be active together, and affect selected text or subsequent collapsed-caret typing.
- Applying a highlight color changes selected text or the active collapsed-caret typing style. **No highlight** removes selected highlighting or clears the pending highlight typing style.
- Highlighting one line or list item does not partially highlight the following sibling; intentional multi-line highlighting remains supported.
- Left, center, and right alignment reflect and change the active paragraph/selected block or active-table context.
- The shared toolbar controls have the same visual styling and command behavior as Logic Gate, project, and mail editor surfaces, and hover/focus/active styling affects only the individual control.
- The node wrapper mounts the shared rich editor host and formatting controller rather than a separate rich editable DOM or local formatting-command implementation.
- Table insertion uses the current caret/selection position from the shared toolbar, with no duplicate text-box/header table button.
- Pressing Tab at the end of ordinary non-outline text inserts a five-space tab at the caret without shifting the whole text block; structural indent runs only for a parsed outline/list line.

### Scenario N-S7: Node Project Assignment And Chat Quote Cancel

Business logic covered:
- N19
- N20
- N21
- N54
- N55
- N56
- N22

Given:
- A user has edit access to a node.
- Projects and Logic Gates are available in the company.
- A selected node text snippet is loaded into chat as a quote/prefill.

Expected:
- The node header project button displays the current related project when one is known.
- The project button is content-sized: it is compact when the label is `Assign to Project`, grows for `Project: <project name>`, and ellipsizes long project names without taking over all spare toolbar width.
- Assigning a node to a project first asks for the project.
- The project assignment dropdown opens at a compact width instead of the old wide panel width.
- If the project assignment dropdown would extend beyond the right edge of the visible node workspace or viewport, it shifts left until the list fits while keeping the normal side padding.
- Confirming project-only assignment creates or updates the node/project relationship without requiring a Logic Gate or priority.
- Choosing an optional Logic Gate inside that project creates or updates the node/project relationship and assigns the node to the selected Logic Gate.
- Go to Project opens the related project directly.
- The selected-text chat quote includes a cancel action next to the quoted text.
- Canceling the quote clears the prefill and leaves the chat draft otherwise intact.

### Scenario N-S8: Node Editor Projection Saves And Saved Versions

Business logic covered:
- N23
- N24
- N25
- N26
- N27
- N28
- N29
- N30
- N31
- N83
- N84

Given:
- A user has edit access to a node.
- The user types in one or more node text boxes.
- The user opens Save Settings, changes the auto-save interval, manually saves, waits for an auto-save interval, deletes a text box while a save may still be in progress, or closes/switches nodes while debounced edits remain.
- A newer projection value may arrive while the document or a shared toolbar control has focus.

Expected:
- Regular typing updates `node_projection_table` for the current text box state instead of appending repeated full-document rows to `node_information`.
- Save Settings shows saved versions with save kind, saving user, timestamp, and text box count.
- Saved-version history is requested only after Save Settings is activated; opening the node document does not request it.
- Manual Save first flushes pending projection updates, then writes one saved-version batch to `node_information`.
- Automatic saved-version creation does not run in the background during the emergency slowness fix.
- Restoring a saved version asks for confirmation and replaces the current node editor projection with the selected saved content.
- When a user types a paragraph, the editor updates immediately and marks the affected text block as `has changed`.
- After the debounce delay, the editor starts at most one projection save for that node text block.
- If the user keeps typing while that save is in progress, the editor keeps the newest content in memory, marks `save needed after current save`, and does not start overlapping saves.
- When the in-progress save finishes, the editor marks the block `has not changed` only if the completed save version is still the latest local version.
- If newer edits arrived while the save was in progress, the editor sends exactly one follow-up projection save using the newest in-memory content.
- Forced flushes save only changed text blocks and complete without dropping characters typed during in-progress saves.
- If the user deletes a text block while a projection save for that block is in progress, the delete path waits for the in-progress save to finish or prevents its result from applying before issuing the projection DELETE.
- A late projection POST must not recreate a deleted text block after the DELETE succeeds.
- Closing the node or switching company/node drains every changed block from the old target-scoped controller before it is cleared.
- Hydration preserves the logical selection while a toolbar control owns focus. While the document itself is focused, untouched local content accepts a deferred remote value on blur without flushing stale HTML; a locally edited conflict keeps and saves the local value and reports the conflict.

### Scenario N-S9: Unified Node Shell And Editor Semantics

Business logic covered:
- N32
- N33
- N34
- N35
- N36
- N37
- N38
- N39
- N40
- N41
- N42
- N43
- N44
- N45
- N46
- N47
- N48
- N49
- N50
- N61
- N64
- N85
- N86
- N91
- N92

Given:
- A user opens the same node from Home, Updates, Company Explorer/sidebar, Kanban/My Work, dock restore, a Project critical-path row, and a Project Logic Gates / Nodes row.
- The node has text boxes, attached emails, and text-block chats.
- The user switches from the document to Metadata, History, or Save Settings and then returns.
- A future product change adds a new node-window action or changes rich editor indentation/paste/delete semantics.

Expected:
- Each full node window uses the unified node shell behavior for header, title, top-right actions, close/minimize/open/fullscreen/delete controls, sizing, and body layout where the capability is available.
- The unified node shell surface inventory is Home node popup, app/sidebar Company Explorer node popup, minimized/dock-restored node popup, Updates row detail node popup/panel, Kanban/My Work full node popup/overlay, Project critical-path inline node window, Project Logic Gates / Nodes embedded node panel, and any future full node editor/window surface without a documented exception.
- Adding or changing a top-right node-window action through the shared shell reaches every full node window surface that exposes that capability.
- Close buttons use the unified red close chrome with a white X on every full node shell surface that renders a close action.
- The Kanban/My Work full node overlay exposes the shared fullscreen control between minimize and close and restores its prior board-relative overlay size when fullscreen is turned off or the overlay closes.
- Activating that Kanban/My Work fullscreen control pins the node overlay to the browser viewport, not merely to the visible Kanban board bounds.
- The Project Logic Gates / Nodes node panel replaces only the right-hand Project relationship region. Its fullscreen control expands the same live editor to the browser viewport and restores it to that region without resetting Project grouping or node selection state.
- Node text boxes use the unified editor semantics on every node-window surface.
- Typing `@` or `!` in a node text box or its chat opens the people picker with each user represented by a stable profile color keyed by normalized user ID, then email, then display name. Rich-editor keyboard selection adds a translucent same-color row tint and active rail; chat retains its active-row treatment. Both keep the profile avatar opaque/full-color with tested white-text contrast instead of washing every user gray.
- The shared format toolbar controls the focused node text box through the shared formatting controller, so font size, inline formats, highlight, alignment, table, and outline-style behavior cannot diverge by node opener.
- Editor, Permissions, shared formatting, and Outline Styles/Automatic Numbering remain in the primary header; Relationships, Metadata, History, Save Settings, version/related-node commands, and supported secondary actions remain available in the keyboard-operable **More editor actions** menu.
- Relationships, Metadata, History, and Save Settings disable formatting only when their content hides/replaces the document; returning to the document preserves the text-block layout.
- Node windows, dialogs, and previews render in the shared body-level overlay layer above Key Views/Explorer/Search Explorer; blocking modes trap/restore focus, while anchored Kanban/Project panels remain modeless until fullscreen.
- Kanban and Project embedded node panels retain the same mounted editor while moving between their anchored geometry and fullscreen viewport geometry.
- Node text-box edits continue to save through node information/projection persistence.
- Text-block chats remain chat composers and do not receive rich editor toolbar or rich editor keyboard semantics.
- Opening the node email picker allows attaching existing email but does not expose compose, send, scheduled send, or draft-save controls.
- Replying to an attached email opens a complete bottom-docked composer immediately, keeps it visible while the email body scrolls above it, and lets the reply body expand upward as the reply grows.
- Small node card previews, list rows, tree rows, timeline bars, picker rows, and other non-editor node summaries do not need to mount the unified node shell.
- Home, app/sidebar, dock-restored, Updates, Kanban/My Work, Project inline node windows, and the Project Logic Gates / Nodes embedded node panel mount the `UnifiedNodeShell` adapter and expose only the actions enabled by that opener.

### Scenario N-S10: Node Attachments Do Not Bloat Projection Rows

Business logic covered:
- N23
- N28
- N30
- N36
- N51
- N52
- N53
- N57
- N58
- N59
- N62
- N63

Given:
- A user pastes screenshots into node text boxes.
- A user uploads files with the node attachment button.
- A user attaches images/files to text-block chat.
- A user attaches an email to the node.
- A user replies to an attached email with multiple lines and indentation.

Expected:
- Node text-box projection saves preserve the latest text content but store attachment references for inline files.
- Node attachment-button uploads create Mango attachment links instead of embedding bytes in node information/projection payloads.
- Browser file bodies go directly to private S3; Mango API sees JSON intent/part/complete requests only. Incremental hashing and multipart slices keep memory bounded, and no whole-file array buffer/base64/data URL is created.
- Exactly 1 GiB is accepted and one byte above is rejected before S3; 64 MiB uses single PUT and one byte above uses resumable 16 MiB multipart. The direct path has no 12 MiB text-box aggregate.
- Concurrent picker batches append successful uploads, deduplicated by durable attachment ID, to the current node state; a failed file does not erase successful files from the same or another batch.
- An upload intent belongs to the company/actor/node, while text-box ID remains origin context. Deleting the text block keeps progress at node level and can still complete without mutating or recreating the deleted projection; navigation may detach visible UI without changing durable intent authority. Permission loss or node deletion rejects completion and cleans up.
- Each text box can list its own attachments, and one node-wide counter/list can show the union across all text boxes from the same node-level metadata read.
- Attachment rows show an immediate type cue, visibility-gated image thumbnails through authenticated content reads, an always-visible extension badge (or `NO EXT`), and a right-side original-file download action. Only visible/near-visible image rows prefetch; closing the list aborts pending reads and releases object URLs.
- Chat messages store attachment references and remain outside rich-editor semantics.
- Attached-email projections store email metadata and attachment references only.
- The attached-email reply composer is visible without manual scrolling and stays docked to the bottom of the selected email detail.
- The attached-email reply body editor keeps a visual empty row beneath the last typed line so the caret remains visible at the bottom without sending extra blank lines.
- Outbound attached-email reply HTML preserves explicit line breaks, spacing, and indentation from the unified editor.
- Mango's node-attached email display preserves Mango-authored outbound line breaks, spaces, and indentation when the same message is viewed later inside Mango.
- Loading the node does not require reading multi-megabyte inline base64 strings from node projection rows.

### Scenario N-S11: Text-Box And Node-Wide Attachment Lists

Business logic covered:
- N51
- N65
- N66
- N67
- N68
- N69
- N70

Given:
- A node has two text boxes with explicit file attachments uploaded from each text box's attachment control.
- The same node may also contain inline images, chat attachments, attached emails, or email attachments.
- One user has edit access and another user has view-only access to the node.

Expected:
- Each text box shows a list/count control beside its upload control and includes only `file_attachment` links whose `information_id` is that text-box ID.
- The shared node toolbar shows one aggregate count/list containing explicit node `file_attachment` links from both text boxes and labels rows with their text-box title when available.
- Inline images, chat attachments, email attachments, and attached emails do not inflate either explicit-file count.
- Every row shows the original filename and byte size with a download action on its right edge.
- Download reads the authorized `original` S3-backed variant through Mango's attachment-content API and uses the original filename.
- The view-only user can open both lists and download attachments but cannot upload new attachments.
- Reloading the node reconstructs the same lists from active backend node resource links even if a projection attachment reference is stale or absent.

### Scenario N-S12: Node-Attached Email Thread Parity

Business logic covered:
- N53
- N57
- N58
- N59
- N62
- N63
- N72
- N75
- N85

Given:
- A text box or node has an attached multi-message email thread with To, Cc, Bcc, ordinary attachments, and CID screenshots.

Expected:
- The email-count viewer fills the available viewport and preserves one scroll surface for the conversation.
- Every message exposes its sender, To, Cc, and provider-supplied Bcc metadata plus Reply and Reply all actions.
- `Expand all threads` opens every collapsed attached-email thread group.
- Reply all deduplicates the visible reply-to/from, To, and Cc addresses and never invents hidden Bcc recipients.
- Personal attachments retain `account_email`, and shared conversions retain both `shared_inbox_id` and `account_email`, so Reply all excludes the active mailbox and all provider reads/mutations use the originating grant.
- Selecting an inline image exposes Download; double-clicking it opens a full-screen preview.
- Text selected in rich/image email bodies still exposes the existing chat/create-node actions.
- Non-inline attachments show filename/type/size, download, and full-screen image preview.
- Calendar invitations expose Accept, Tentative, and Decline when the viewer has edit access, prevent duplicate submission while pending, and show a selected response only after provider success.
- Opening a reply focuses the unified reply editor immediately while the original message remains visible.
- Reply focus synchronously clears the surrounding node text block as the outer formatting target, leaving the reply toolbar as the only formatting owner while the outer navigation tabs stay usable.
- Releasing a vertical resize, cancelling it, losing pointer capture, or blurring the window ends resizing; later pointer movement cannot continue changing the editor height.

### Scenario N-S13: Remove Attached Rows From Node

Business logic covered:
- N53
- N65
- N66
- N69
- N73

Given:
- An editor has edit access and opens an email-count or attachment-count list.

Expected:
- Right-clicking an email row or attachment row shows `Remove from node` in red.
- Removing an email deletes only its attached-email projection from the node.
- Removing an attachment unlinks the active node resource attachment and refreshes counts without deleting the stored attachment object.
- View-only users do not receive either removal action.

### Scenario N-S14: Node Chat Links

Business logic covered:
- N36
- N74

Given:
- A node chat message contains `https://`, `http://`, `www.`, or a bare web domain beside ordinary text, punctuation, an email address, or a mention.

Expected:
- Safe web URLs render blue, underlined, and open in a new tab with opener isolation.
- Sentence punctuation remains outside the clickable URL.
- Mention highlighting remains intact.
- Non-HTTP schemes such as `javascript:` remain plain text.

### Scenario N-S15: Node Permission Save

Business logic covered:
- N33
- N71

Given:
- A manager or administrator opens node permissions from more than one full node-window entry point.
- A second viewer can open the node but cannot edit its permission settings.

Expected:
- Every editable node permission view displays the shared `Save` button in a stable action area.
- Save commits the current selection, reports loading or failure state, leaves the view open on success, and follows the close behavior in `docs/tests/permissions.md`.
- The read-only, denied, or failed-load view remains dismissible and does not issue a permission write.

### Scenario N-S16: Direct Upload Progress, Resume, And Text-Box Deletion

Business logic covered:
- N51
- N65
- N66
- N69
- N76
- N77
- N78
- N79
- N80
- N81

Given:
- A user selects several node files, including one multipart file, and deletes the originating text box while uploads continue.
- A part URL expires, the page reloads, one file fails, and another completes.

Expected:
- Each file appears once in node-level progress with filename, visible extension, size, bytes transferred, state, cancel, and retry.
- S3 receives raw File/Blob bytes without Mango authorization; Mango API receives metadata/control JSON only.
- Retry refreshes only the necessary URL, resume reconciles accepted parts without uploading them twice, and node editing remains available throughout.
- The deleted text-box projection stays deleted. Its completed attachment remains node-owned, appears in the node-wide list with deleted-origin context, and is previewable/downloadable through the authenticated Mango content path.
- The failed sibling remains a retryable/failed progress item and does not remove the completed attachment.
- Normal counts change only after successful completion and the shared node metadata query refreshes once for that completion, not on each part.

### Scenario N-S17: Cheap Read-Only Node View And Shared Open Resources

Business logic covered:
- N51
- N65
- N66
- N69
- N81
- N87
- N88
- N89
- N90

Given:
- React StrictMode opens the same node in more than one editor instance.
- The client has a current node-view ETag and the node contains text boxes with and without unseen other-actor changes.

Expected:
- Initial document rendering does not wait for saved-version history, and Save Settings activation loads that history once for the active target.
- Attachment metadata, project relationships, company accounts, and company people/group references coalesce compatible in-flight reads and reuse authorized cached results.
- Attachment and relationship mutations invalidate their cache before emitting a refresh; account/user/group mutations invalidate shared reference data before their update event.
- The backend authorizes the conditional node view, reads one indexed shared/user version pair, and returns `304` before consolidated payload construction.
- Neither a node-view `200` nor `304` writes projection seen snapshots or reads editor/event-row sequence state.
- The separate clean-anchor command uses one bulk write, anchors clean text projections at their observed update timestamps, leaves unseen/later changes present, does not churn the view ETag for baseline-only writes, and is issued at most once for the successful view cache key/ETag with bounded retry after failure.
