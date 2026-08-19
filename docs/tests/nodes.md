# Current Node Business Logic Laws

1. A new Node defaults to priority **Not Assigned**.
2. **Not Assigned** is stored as a null Node priority; numeric priorities remain limited to 1 through 5.
3. A Node may be assigned to a Logic Gate while its priority is **Not Assigned**.
4. An email thread may belong to multiple Nodes, and one Node may contain multiple email threads.
5. A newly ingested message inherits every Node-wide destination already used by its thread and no text-box destination.
6. Only an exact email message may link to a Node text box; a whole thread may not.
7. One exact email message may link to at most one text box per Node and may link to a different text box in another Node.
8. Every email chat in a Node belongs to one exact email message and that message's exact local text box.
9. Chats about the same email message in different Nodes remain separate.
10. A user sees Reply only with Node edit access plus exact personal-account ownership or current Shared Inbox Edit access, and only on an exact ingested message whose projection retains that source mailbox; Reply ensures the same owner-only mailbox draft used by Triage and Project, while Reply All, Forward, shared/collaborative drafts, and scheduling remain absent.
11. Node email views retain received-message bodies and attachments, collapsed-thread lazy loading, highlights, exact-message text-box links, and email-selection chats.
12. Opening, expanding, refreshing, or navigating Node email never creates, edits, or discards a draft and never loads a draft body or attachment relationship. Body-free indicator requests, each limited to at most 100 internal source-message IDs in one exact mailbox scope, may label an exact ingested message **My Draft**; only Reply or **My Draft** opens the exact durable owner draft.
13. Removing one Node-wide email relationship is blocked when that Node and thread have a text-box relationship or email-selection chat; a blocked request keeps the selected email and any open owner draft intact. Otherwise removal deletes only that Node's typed edge and leaves every other Node relationship, stored thread/message, owner-only mailbox draft, and surviving attachment relationship unchanged.
14. Deleting a Node text box removes its owned chats and textbox-specific email relationships while preserving its Node-wide email relationships and stored email truth.

Last updated: 2026-08-18

# Process Story: An email thread can appear in several Nodes while each Node keeps its own text box and chat

An email thread is attached to one or more Nodes whose priority may remain **Not Assigned** with or without a Logic Gate assignment
↓
Every stored and newly ingested message receives each Node-wide destination already used by the thread
↓
Inside each Node, an exact message may link to one local text box and every chat remains owned by that Node and text box
↓
When the local text box does not yet exist, the first send atomically creates the text box, exact email relationship, and chat
↓
Removing one Node-wide relationship removes only that Node's typed edge and leaves the other Nodes and stored email truth intact

Last updated: 2026-08-09
# Process Story: Node headers show assignments and linking controls clearly

A user opens a Node through Editor, Updates, or another supported Node surface
↓
Each direct RACI principal resolves to assignment metadata or the current company directory, so a sparse payload never displays an internal user/group ID as its name
↓
The four equal-width role cards remain on one line, pair two single-line names on complete rows, and give a single or final odd name the complete row width
↓
The Node header presents `##` as a light, readable button with an explicit universal-linker label and the established active border when its picker opens
↓
The display changes leave the exact RACI edges and typed Logic Gate, Project, and Email link commands unchanged

Last updated: 2026-08-07

# Process Story: A Node header stays compact while linking exact destinations

A user opens a Node from a sidebar pin at its normal saved window size
↓
The timeline plus sits over the left rail, while one mail icon/count toggles the elevated email column and its adjacent plus opens email attachment
↓
Current Logic Gate and Project chips open those exact resources, and the header's default `##` picker links through the existing typed commands
↓
Moving to another Logic Gate creates the existing transfer stamp; creating the first Project relationship creates one Project-assignment stamp in the same transaction
↓
Refreshing, relinking the same Project, opening the mail column, or clicking a current-resource chip does not resize the Node or duplicate relationship history

Last updated: 2026-08-07

# Process Story: A stored email reply appears in every existing Node destination

A qualifying post-activation Inbox message identifies an exact stored email thread
↓
Mango appends only missing/incomplete real provider messages and files
↓
For each newly completed message, Mango inserts only the missing Node-wide `email_relationships` destinations already used by that thread
↓
Opening the Node reads the same updated durable thread; no completed sibling is recopied and no textbox relationship is created in this phase

Last updated: 2026-08-06

# Process Story: A Node assigns live RACI responsibility

A user assigns people or groups to Responsible, Accountable, Consulted, or Informed on a Node
↓
Each direct person or group appears by name on its own single-line row in the matching role card, and the card grows to keep every direct assignment visible instead of becoming a count
↓
Every role accepts multiple direct people or groups, while one direct principal holds only one role on that Node
↓
Nested group membership expands live whenever effective RACI, notifications, or verification recipients are read
↓
RACI remains separate from Node permissions and grants no access by itself

Last updated: 2026-08-06

# Process Story: A changed Node saves history when the Node is left

A user edits a Node textbox, textbox metadata, or textbox structure
↓
The ordinary current-textbox save continues writing the latest final Node rows
↓
The user closes the Node or its preview, switches resources or routes, uses Back/Forward, or triggers browser `pagehide`
↓
Mango flushes only that exact Node and creates one existing-format history batch if it changed since the last successful history save
↓
An unchanged close creates nothing, repeated close signals share one save, and refresh or tab close remains browser best effort

Last updated: 2026-08-06

# Process Story: Node organization uses typed relationships, not Explorer placement

A user creates a Node from Editor, chat, email collaboration, Project, or Logic Gate work
↓
The Node is stored once in `nodes`, while Logic Gate assignments, Project relationships, email links, attachments, chat ownership, RACI, and permissions remain in their exact typed tables
↓
No Node creation or repair path inserts `target_type='node'` into `company_explorer_items`, and no Unfiled/Nodes folder is created
↓
Search reads the Node from its source table and derives a visible Logic Gate path first, then a visible Project path, or an empty standalone path

Last updated: 2026-08-06

# Process Story: Node edits retain dormant change anchors without unread highlights

A user creates or opens a Node from Home, Explorer, Kanban, Project, Updates, an entity link, or a direct route
↓
The canonical Node, relationships, final textbox data, and current inherited/customized RACI and permission policies load through their exact APIs and actor-safe caches
↓
Persisted Tiptap annotations whose kind is `change` load as dormant positional metadata: they do not render, count, navigate, activate, or call a seen API
↓
Normal edits map each dormant range with the document transaction, and autosave, recovery, Manual Save, History, and Restore retain it with the matching JSON revision
↓
Comments, chats, email selections, normal formatting highlights, attachments, exact email ownership, collaboration, deletion, recycle, and restore continue without an unread-change subsystem
# Process Story: Node content lives in final purpose-built storage

A user creates or edits a Node textbox, attaches an exact email, uploads a file, or creates a chat
↓
The backend stores TipTap JSON in `node_textboxes`, chat rows in `node_textbox_chats`, exact email placement in `email_relationships`, and file ownership in `attachment_relationships`
↓
The API keeps the stable public `information_id` by assembling projection-shaped responses from current textbox, chat, email, and attachment rows; dormant `change` annotations remain only inside textbox JSON
↓
Deleting a textbox removes its owned chats, retires those chats' file links, and removes only the textbox-specific email relationships naming it. Node-wide file and email relationships remain available from the Node header; deleting the final file owner follows pending-delete, S3-before-Postgres, retry-safe cleanup
↓
The removed unread-change API, cache, writers, viewer baselines, and database tables are not compatibility dependencies. Deploy the table-free runtime before a human runs the strict forward retirement migration.

The production Node path must never query or write `node_information`, `node_projection_table`, or `node_projection_seen_snapshots`. Textbox creation and editing use the JSON editor API; the old projection-shaped text writer is rejected rather than translated or dual-written.

Last updated: 2026-08-16

# Nodes Tests

Coverage Status:
- Node attachment presentation and visibility-gated thumbnail behavior are covered by `tests/frontend/modules/attachments/attachmentPresentation.test.ts`; upload concurrency, partial-success, byte-limit, scope/permission invalidation, and delete-while-uploading behavior are covered by `tests/frontend/modules/editor/nodeTextBlockAttachments.test.ts`; shared people-palette behavior is covered by `tests/frontend/modules/editor/editorMentions.test.ts`.
- Attached-email read-only disclosure, exact-message lazy loading, received attachments, resize cleanup, red removal actions, and permission Save visibility are covered by `tests/frontend/modules/editor/emailViewerContract.test.ts`; node chat URL detection is covered by `tests/frontend/modules/editor/nodeChatLinks.test.ts`.
- Shared conversion projection provenance is covered by `backend/internal/http/communications_triage_handlers_test.go` and `backend/internal/store/communications_email_conversion_test.go`.
- Browser-direct additions must prove the 1 GiB/64 MiB/16 MiB policy, node-level progress/cancel/retry/resume, completed-only counts, one completion refresh, and completion after origin text-box deletion without projection recreation.
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial overall. `backend/internal/store/editor_structured_collaboration_test.go`, `backend/internal/http/editor_collaboration_handlers_test.go`, `backend/internal/http/realtime_delivery_test.go`, and the disposable-PostgreSQL producer suite cover structured OT convergence, idempotency, snapshots/ETags, exact authorization, cross-instance delivery, unrelated-scope isolation, revocation, restore recovery, and saved-version materialization. Frontend unit suites cover bounded operations, rich structure/reference preservation, IndexedDB queue recovery, legacy cleanup, shared-socket refcount/health, and host wiring. The dedicated production-path realtime runner and its multi-user browser workflow were removed from CI on 2026-07-28. Focused frontend and backend suites remain, while visible Node collaboration acceptance is manual until replacement automation is added. Other Node shell, attachment, and editor behaviors retain their focused suites.

## Business Logic

### 2026-07-10 Text-Box Deletion Retention And Node-Level Viewers

- Deleting a node text box removes that `node_textboxes` row, its local UI, and every textbox-specific `email_relationships` row naming it. Node-level `attachment_relationships`, Node-wide `email_relationships`, and normalized email truth remain associated with the Node.
- The node header attachment counter/list remains available independently of text boxes and includes files uploaded from deleted text boxes. A missing `information_id` target is displayed with an explicit deleted-text-box origin label instead of hiding the file or assigning it to another box.
- The node header attached-email counter/list also remains available independently of text boxes. Opening it uses a standalone node-level attached-email organizer modal with its folders/list and selected conversation, not an automatically created or arbitrarily selected text box.
- A retained attached email must be viewable from the global node header when the node has no text boxes and when the user has no access. Existing per-text-box email conversation panes remain available for live text boxes and are not the required host for the global viewer.
- Clicking a file row opens an authenticated in-app preview without starting a download. Images, PDF, text/code/CSV/JSON/XML, audio, and video are previewable when browser-supported; text preview decodes only the first 256 KiB and renders at most 200,000 decoded characters. Larger text is shown as a bounded/truncated preview with `Preview limited to 256 KiB / 200,000 characters.`, while Office/archive/unknown binary files show preview-unavailable state and retain their explicit download control.
- Browser node attachments default to a backend-authoritative 1 GiB per-file limit with no 12 MiB text-box aggregate. Files through 64 MiB use one presigned S3 PUT; larger files use resumable 16 MiB multipart parts. Pending work is node-level upload-progress state and never inflates the completed node attachment count.

Required regression scenario:
- Attach files and emails from multiple text boxes, select an attached email, delete one originating text box, and then delete all remaining text boxes.
- Confirm the node-level file and email counters do not decrease because of text-box deletion, deleted-origin files remain labeled and usable, and the global email list opens the retained conversation in the standalone node-level organizer with zero live text boxes.
- Confirm an edit-authorized user can list, preview, download, and upload retained files and open retained attached emails, while a no-access user receives neither list.

N1 - Nodes support Responsible, Accountable, Consulted, and Informed RACI assignments in that order.
N2 - Every Node RACI role accepts multiple direct user or group principals.
N3 - A direct principal can hold only one RACI role on the same Node.
N4 - Group assignments remain typed group edges and expand through current members and nested subgroups whenever effective RACI is read.
N5 - When one user reaches several roles through direct or group sources, the effective order is Responsible, Accountable, Consulted, then Informed.
N6 - Node RACI assignment pickers should display the company user-group tree as a collapsed hierarchy.
N7 - Node RACI picker subgroups and users should be visually indented according to their hierarchy depth.
N8 - Every Node RACI card resolves each direct user/group label from assignment metadata and then the current company directory, never presents the principal ID as the visible name, and provides per-assignment removal in its assignment list. The four role cards have equal width and remain in one horizontal row. Complete pairs share a row equally, while one assignment or the final odd assignment spans both columns so it receives the full card width; the list is never reduced to a numeric summary.
N9 - DELETE `/v1/nodes/{node_id}` requires current effective Edit access, moves the Node and related placements to the deleting actor's Recycle Bin, and removes the Node's two V2 settings rows and cascading policy edges.
N10 - Node soft delete requires edit access to the node; no access is denied.
N11 - Successful node soft delete stamps `deleted_by_user_id` with the deleting actor.
N12 - The node Assign to Logic Gate picker should not preload or display Logic Gates when opened; it should search only after the user enters text, using the Company Explorer search contract for visible folders, subfolders, and Logic Gates.
N13 - Pasted rich text in node editor surfaces must normalize to the app/editor font family instead of preserving source document fonts.
N14 - Pasting selected inline text into a node editor must not create extra blank rows above or below the pasted content from source boundary whitespace.
N15 - New node editor documents default to alphanumerical numbering, and the editor outline dropdown lists alphanumerical numbering before indent guides.
N16 - The node editor font-size control applies to selected text and, for a collapsed caret, becomes the sticky font size for subsequently typed characters until changed again. Toolbar focus and repeated plus/minus clicks keep increasing/decreasing the same selected range or preserve the saved caret and update the visible pending size/typing height rather than discarding it; the literal numeric readout remains compact.
N17 - Node editor Bold, Underline, Italic, and Strikethrough controls must toggle selected text or collapsed-caret typing semantics and must visually reflect the active or pending formatting at the current caret or selection. Italic selected with a collapsed caret remains pending after toolbar focus and applies to subsequently typed text.
N18 - Inserting a table from the shared node editor toolbar must insert it at the current caret/selection location, not at the top-left or beginning of the editor. A node text-box/header must not render a duplicate table-insertion button, and a table must not inject cell-level alignment-icon controls because alignment remains in the shared header toolbar.
N19 - A node header can show and edit the node's project placement: the project button displays the current project when one is known and otherwise offers project assignment.
N20 - Assigning a node to a project from the node header supports project-only assignment; selecting a Logic Gate within that project is optional and moves or assigns the node to that Logic Gate only when chosen.
N21 - A node with a known project relationship exposes a Go to Project action that opens the related project directly.
N22 - When selected Node text is sent to chat as a quote/prefill, canceling with the quote X or closing that pending chat completely cancels the action: it clears the quote/prefill, removes the temporary source annotation, and collapses the editor/browser selection without sending a message. An unrelated chat draft remains intact.
N23 - Live Node editor typing writes current TipTap JSON only to `node_textboxes`. It must not write a projection or information row.
N24 - Node Save Settings lists saved editor versions sorted by saved timestamp, including saving user, save time, and saved text box count. The manual history button remains available.
N25 - Clicking Save flushes the current JSON document and creates one manual batch in `node_textboxes_history`.
N26 - Node exit history is action-triggered, not background work. After a history-visible local change, closing any full Node, popup, Updates preview, or Project preview; switching resources or routes; using Back/Forward; or browser `pagehide` requests the same final history batch as manual Save after flushing that exact Node. An unchanged Node creates no exit batch, repeated close signals share one in-flight save, and no timer or Node scan is allowed. Browser refresh/external navigation/tab close remain best effort.
N27 - Restoring a node saved version requires confirmation and overwrites the current node editor projection rows from that saved version without creating another saved-version row.
N28 - Node text-box typing is converted to ordered 160 ms micro-batched HTML patches. One acknowledged operation is in flight per exact document/client queue; later edits remain durable pending operations and never trigger overlapping whole-document projection writes.
N29 - Node editor text-block save state must use the vocabulary and behavior `has changed`, `has not changed`, `save in progress`, and `save needed after current save`. A block is marked `has not changed` only when the completed request's version matches the latest local version.
N30 - Node editor forced projection flushes must save only blocks that have changed and must not `Promise.all` every text block in the node. The flush must preserve all user characters by waiting for in-progress saves and then saving the latest content if newer edits arrived.
N31 - Deleting a node text box uses an exact collaboration tombstone after any intended local flush. A late operation cannot recreate a terminal document, and attachment/email resources retain their separate node-owned lifecycle.
N32 - Node text boxes participate in the unified editor contract: changes to indent/outdent, paste cleanup, Delete/Backspace, copy/cut/paste, lists, checklist, hyperlink, font-size, bold, underline, italic, strikethrough, text highlight color/No highlight, left/center/right alignment, entity-boundary behavior, and table semantics must apply to node text boxes wherever a node editor is opened.
N33 - Full node editor windows participate in the unified node shell contract: header, title behavior, top-right actions, close/minimize/open/fullscreen/delete controls, sizing, and body layout must come from one shared user-facing shell behavior wherever practical.
N34 - Adding, removing, reordering, or restyling a top-right node-window action must happen through the unified node shell so Home, sidebar/app shell, Updates, Kanban, dock-restored, Project critical-path inline node windows, and Project Logic Gates / Nodes embedded node panels stay aligned when the capability is available.
N35 - Unified node shell does not require one opener, route, page state, or backend path; a node may be opened from Home, Updates, Company Explorer/sidebar, Kanban, dock restore, a Project critical-path row, or the Project Logic Gates / Nodes tab while still sharing the same user-facing shell.
N36 - The node workspace body remains text boxes, attached emails, and text-block chats; chats are conversation UI and must not inherit unified rich-editor toolbar, indentation, paste, delete, list, or font-size semantics. The shared `@`/`!` people picker is available in node rich text and chat composers; plain Tab accepts the highlighted user as the existing mention principal/entity, and chat paints accepted normal/urgent mentions as visible chips rather than plain characters. The painted chat chip must not change the textarea text width or glyph metrics: the native caret stays collapsed immediately after the accepted mention, and later typing appears at that caret.
N37 - Node Attach email opens the shared Universal picker directly in `##` link mode with Emails selected. It may search the connected personal mailbox and attach the exact existing message, but it must not expose compose, reply, send, scheduled send, draft-save, or mailbox-mutation behavior.
N38 - Project critical-path inline node windows must use the unified node shell and unified node text-box editor semantics while preserving node information/projection persistence for node edits.
N39 - The V1 unified node shell source is `UnifiedNodeShell`; full node-window adapters may keep their own opener state, geometry, route handling, and permissions, but top-right node-window action ordering and shell/body data attributes must come from that shared source.
N40 - Kanban node overlays expose the same shared fullscreen shell action as Home node popups when a full node editor overlay is opened; activating fullscreen is a temporary viewport-fixed exception to Kanban board-relative bounds, while Kanban keeps the previous board-relative overlay ratio only for restoring when fullscreen is turned off.
N41 - Clicking a node row in the Project Logic Gates / Nodes tab expands a full node editor directly below the row, not the app/sidebar popup and not a project text-box editor. The inline editor must use `UnifiedNodeShell`, the shared node workspace body, unified node text-box editor semantics, node information/projection persistence, and separate chat-pane behavior. Clicking the same row again collapses it.
N42 - The Home node popup is a unified node shell surface.
N43 - The app/sidebar Company Explorer node popup is a unified node shell surface.
N44 - A minimized or dock-restored node popup is a unified node shell surface.
N45 - The Updates row detail node popup or node panel is a unified node shell surface.
N46 - Kanban full node popup or overlay surfaces are unified node shell surfaces.
N47 - The Project critical-path inline node window is a unified node shell surface.
N48 - The Project Logic Gates / Nodes click-to-expand inline node editor is a unified node shell surface owned as local Project opener state. It exposes close/collapse, open-in-new-tab, and pin actions through the shared shell contract.
N49 - Any future project or page surface that opens a full node editor/window must use the unified node shell unless a new documented exception is added with an explicit business rule and test.
N50 - Small node card previews, list rows, tree rows, timeline bars, picker rows, and other non-editor node summaries are not unified node shell surfaces unless they open into a full node editor/window.
N51 - Node text-box inline images, node attachment-button uploads, and node attachment lists must follow `docs/tests/attachments.md`: durable node information/projection rows store attachment references, not data URLs, base64 file bytes, or embedded file payloads; per-text-box and node-wide lists load metadata once at node scope and fetch attachment bytes only for authenticated thumbnails or explicit downloads.
N52 - Node text-block chat attachments remain chat-specific UI, but submitted chat payloads must store Mango attachment references instead of durable `dataURL` values. A posted image attachment exposes its own right-side download action and opens the shared fullscreen editor-image viewer on double-click; selected inline-image actions use their current enclosing app overlay layer so neither the editor modal nor the adjacent Chat pane can cover or clip them. Choosing Comment on image opens the associated chat and places keyboard focus and the text caret in its composer, including when that pane was already open.
N53 - Attached emails on nodes may store message/thread/provider metadata and Mango attachment references, but must not store attachment bytes in node projection rows or communications email attachment JSON.
N54 - The node header Assign to Project button must size to its icon and current label instead of flex-growing into all remaining toolbar space. In the unassigned state it should remain compact for the `Assign to Project` label; after assignment it may grow for `Project: <project name>` up to the node header's project-control maximum and must ellipsize overflow text instead of pushing adjacent header actions away.
N55 - The node header project assignment dropdown must use a compact horizontal width. Its nominal width is clamped to a minimum of 280px, a desktop maximum of 390px, and a compact-layout maximum of 320px, with the browser viewport maximum still allowed to reduce the rendered width when the viewport is narrower.
N56 - Opening the node header project assignment dropdown near the right edge of the visible node workspace must shift the dropdown left just enough to keep the full list visible inside the node workspace or browser viewport. The dropdown must not remain right-anchored when that would clip project names or list content, and the left shift must preserve the normal node workspace side padding.
N57 - The Node UI shows Reply only when the user has Node Edit plus exact personal-account ownership or current Shared Inbox Edit, and the attached email is an exact ingested source with stored mailbox provenance. Reply ensures or reuses the current user's owner-only mailbox draft, then provides the server-resolved read-only From, editable To/Cc/Bcc/Subject, rich HTML, existing signature, `email_draft` attachment add/remove, and Send without Reply All, Forward, a draft scope chooser, or scheduling.
N58 - The attached-email detail uses its available height for stored conversation content and received attachments; the exact durable Reply composer occupies space only after the user clicks Reply or **My Draft**.
N59 - My Triage, Shared Triage, Project, and Node Reply use the same owner-mailbox draft, safe rich-editor serialization, and 500-millisecond exact-draft autosave without reloading the thread, other drafts, or attachment content.
N60 - In automatic numbering mode, pressing Tab in ordinary non-outline node text inserts the five-space tab at the caret; it must not move the entire current text block unless the current line is actually a parsed outline/list item. Shift+Tab may still outdent leading indentation.
N61 - Full node-window close actions render through the unified node shell's red close chrome with a white X across Home, app/sidebar, Kanban, Updates, Project, and dock-restored node shell surfaces.
N62 - A Node attached-email view mounts reply-body editor space only after an explicit Reply or **My Draft** click; closing first flushes the exact durable draft and then restores the unchanged received-message layout without discarding it.
N63 - Mango-authored outgoing email bodies are marked and displayed in Mango with preserved line breaks, spaces, and indentation in node-attached email detail views instead of being normalized into a flat sentence.
N64 - Node text-box formatting is driven by the shared editor toolbar and formatting controller: font-size minus/value/plus, Bold, Underline, Italic, Strikethrough, the Highlight split button with **No highlight**, left/center/right alignment, table insertion, and the outline-style dropdown must match Logic Gate, project, and mail editor surfaces in look and behavior wherever a full node editor is opened. The highlight main hitbox applies the chosen color without opening the picker, while the arrow only opens the picker. Vibrant active styling applies only to the individual hitbox and remains distinct from hover, focus, and disabled state.
N65 - Each node text box exposes an attachment-list control beside its attachment-upload control. Its count and rows include only active node `file_attachment` resource links whose `information_id` matches that text block.
N66 - The shared node workspace toolbar exposes one node-wide attachment counter and list. It aggregates all active `file_attachment` resource links for the node across its text boxes, labels each row with its text-box title when available, and excludes inline images, chat attachments, email attachments, and attached emails.
N67 - A node attachment row displays the original filename and byte size and exposes a download action on the right. Download requests the attachment's `original` variant through Mango's authenticated attachment-content API and preserves the original filename; the UI must not use a raw S3 URL, storage key, or legacy durable `dataURL` as the download source.
N68 - Node users with edit access may see attachment counts/lists and download authorized files even when the node is read-only. Upload remains limited to users with edit access.
N69 - Node attachment counts and lists are rebuilt from the backend node resource-link list when the workspace loads. Projection attachment references may support editor persistence, but they are not the canonical source for list/download availability.
N70 - Per-text-box and node-wide attachment controls are part of the shared node workspace body, so every full node-window surface using that body receives the same attachment scope, count, list, permission, and download behavior.
N71 - Node permissions opened from any full node-window entry point use the shared permissions contract in `docs/tests/permissions.md`: editable views always display `Save`, successful Save persists the current selection without closing, and read-only, denied, or failed-load views remain dismissible without writing.
N72 - Node-attached email viewers use the shared email-thread contract: a subject-only conversation header; accessible per-message disclosure whose collapsed row shows sender/date/snippet and hides From/To/Cc/Bcc; expanded-only labeled participant details, full body, received attachments, full-height viewing, authenticated image actions, and the N57 Reply/**My Draft** rule. Calendar invitation viewing creates no email draft, while only explicit Reply ensures one.
N73 - Editors can right-click an attached-email or attachment row and choose a red `Remove from node`; the action removes only that attached-email projection or node attachment relationship, but email removal is rejected while that Node and thread have a textbox-specific relationship or email-selection chat, and no-access users receive no destructive action.
N74 - Node chat detects safe `http://`, `https://`, `www.`, and bare-domain links, excludes trailing punctuation and email-address domains, renders links blue and underlined with opener isolation, and leaves unsafe/non-HTTP schemes as plain text.
N75 - A personal attached-email projection stores `account_email`; a Shared Triage conversion stores both `shared_inbox_id` and `account_email`. Thread, received-attachment, calendar, signature, draft, and Reply send operations use that exact source mailbox instead of falling back to another grant. The server derives the draft sender and reply target from the ingested source; send still verifies the displayed `expected_sender_account_email` and returns HTTP 409 `email_sender_account_changed` before attachment or provider work if authoritative mailbox resolution differs, preserving the owner draft for review.
N76 - Normal browser node file bytes go directly to the private attachment S3 bucket through intent-owned presigned PUTs. Mango API authenticates/authorizes, chooses IDs and keys, enforces limits, completes/aborts/verifies storage, and writes metadata/node links, but it never receives the browser file body.
N77 - Node browser upload policy defaults to 1 GiB per file, single PUT through and including 64 MiB, and 16 MiB multipart parts above it. The direct path does not apply the old 12 MiB-per-text-box aggregate.
N78 - Node upload preparation computes raw SHA-256 incrementally with bounded memory. Multipart concurrency is capped, progress is byte-based, cancellation aborts active requests, retry refreshes expired URLs, and resume does not re-upload S3-confirmed parts.
N79 - Upload progress belongs to the node rather than the origin text box. It shows each selected filename/extension/size once with preparing, uploading, retrying, completing, complete, canceled, or failed state plus progress/cancel/retry; it does not block node editing or enter the normal completed list/count.
N80 - Deleting an origin text box while upload is active keeps node-level progress and permits completion when the node still exists and current node edit authorization passes. It must not recreate the deleted projection. Deleting the node or losing edit access rejects completion and cleans up the unfinalized S3 object.
N81 - One successful completion invalidates the shared node attachment metadata once. Part progress/retry does not repeatedly refetch the completed list, and one failed file does not discard completed siblings.
N82 - Node text boxes use `EditorDocumentSurface` as their rich editable host and the shared formatting controller for font size, bold, underline, italic, strikethrough, highlight color/No highlight, alignment, lists, links, tables, selection restoration, and pending-caret font/italic/strikethrough/highlight typing styles; node wrappers must not render a second rich `contentEditable` host or construct a local formatting controller.
N83 - Each Node text box owns one exact collaboration document identity and pending-operation queue. Duplicate mounted local consumers share one network subscription; the last unmount or tombstone removes it. Title and attachment metadata may retain a serialized metadata queue, but document typing never enters that whole-envelope controller.
N84 - Committed remote Node text-box operations apply promptly through the exact editor scope without echo-saving. Remote application preserves the logical selection through the shared editor hydration boundary; revision gaps, reconnect, and canonical replacement trigger automatic full-snapshot recovery and pending-operation reapplication.
N85 - Ordinary Node-attached email viewing never becomes a formatting target. Focusing an explicit Reply uses the shared reply toolbar without applying formatting to or replacing the surrounding text block's document state.
N86 - Opening Relationships, Metadata, History, or Save Settings from the editor overflow hides or replaces the applicable node document workspace and prevents formatting against a hidden editor without unmounting or resetting its text-block layout. Only formatting controls are disabled; primary and overflow navigation actions remain operable.
N87 - Node saved-version history is not loaded during ordinary node open. It loads on Save Settings activation, preserves manual save/restore behavior, and is cleared/reloaded for the current company/node target rather than blocking initial editor content.
N88 - Node-open reference reads use StrictMode-safe shared ownership: node resource-attachment metadata is one node-scope cached request with explicit mutation invalidation, project relationships are singleflight/cached with invalidation before relationship refresh, and company accounts/users/group reference data is shared across editor instances with mutation/auth-scope invalidation.
N89 - `GET /v2/nodes/{node_id}/view` authorizes first, then reads dedicated shared and actor-specific node-view versions to calculate a salted ETag before building the consolidated payload. A matching request returns `304` without loading/serializing/hash-building the full view, without reading `event_rows`, and without writing seen state; ordinary `200` reads are also write-free.
N90 - A persisted Tiptap annotation with `kind: "change"` is dormant positional metadata. The editor maps it through document transactions and retains it through autosave, IndexedDB recovery, canonical recovery, Manual Save, History, Restore, and reload even when no feature owner supplies it. It must not render a decoration, count as unread, become a navigation target, activate a callback, call a seen API, or change a Node-view ETag.
N91 - Every successful Node rename entry point covered by RW15 publishes the concrete committed-title event after the HTTP command succeeds, and applicable same-window Node labels converge under RW15 without server fan-out. An actively edited Editor title defers the event without changing its draft/caret; passive dock/pin updates do not change recency or write pin rows.
N92 - Mounted Node chat performs one single-flight canonical durable-chat refresh on first subscription acceptance and every reconnect acceptance, with at most one queued final read and no overlap/invalidation. A later local handler joining the already accepted Node scope receives immediate acceptance. This closes each mount's load-to-subscribe race without replay/generalized history or dirty editor-text replacement.
N93 - A node editor header keeps Editor, Permissions, the shared formatting toolbar, Outline Styles/Automatic Numbering, and the immediately adjacent More control on one nonwrapping line. Relationships, Metadata, History, Save Settings, save-version/related-node commands, and supported opener-specific secondary actions remain available in the accessible **More editor actions** overflow menu with their existing permission and disabled state.
N94 - Node popups/panels, permissions and email dialogs, and image/attachment/email previews mount through the shared body-level overlay portal above Key Views, Explorer, Search Explorer, and feature-local stacking contexts. Blocking modal modes trap focus and restore prior focus on close; anchored Kanban editor panels may remain modeless until fullscreen. The Project Logic Gates / Nodes inline editor remains in document flow and does not use the overlay portal.
N95 - The Responsible, Accountable, Consulted, and Informed cards remain in one compact four-column horizontal row with Kanban-strength layered gradients in their established role colors. Narrowing may clip that row beneath an adjacent pane, but must not wrap it vertically. Add occupies each card's top-right heading row; the full-width assignment surface displays `No assignments` once or one unwrapped row for every direct person and group, growing vertically to keep all assignments visible.
N96 - The lazy email-derived Node trigger creates one Node after provider validation with no Company Explorer placement. It directly customizes creator Responsible RACI and Edit permission, and retry or later replies for the same exact mailbox/thread identity reuse that Node.
N97 - The email Node contains one protected canonical source-scoped `Attached email` projection with `created_from_email=true` plus shared `Text block chat` rows. Generic writes may add ordinary text boxes and other normal Node information but cannot overwrite/delete the canonical email projection. Saved-version, Project, Logic Gate/Kanban, RACI, and account behavior follows normal Node contracts; whole-Node delete and generic permission replacement remain protected while collaboration source/participant records exist.
N98 - My/Shared Triage and the email Node mount the same shared ChatPane over the same canonical chat block ID and information rows. Message IDs, parent IDs, ordering, indentation, deletion ownership, mentions, attachments, composer state, and `chat:node:{node_id}` refresh are shared data, never copied histories. The Node header shows compact durable chat-author/mention context.
N99 - An email-selection chat persists `selection_source=email`, the exact internal `email_message_id`, trimmed quote, and valid offsets. A text-box selection in the node-wide email chat additionally persists `selection_block_id`, so chat navigation can focus the originating editor while provider IDs remain display context only.
N100 - The email Node keeps the effective default and complete rules copied from its final source, while the creator and accepted mention participants receive permanent direct Edit access. The permissions surface cannot add/remove/replace those system-managed grants. Mention access is Node-chat access only: it grants authorized reads of the Mango-stored email snapshot attached to that Node, without requiring the viewer to own or access the source Nylas mailbox, and never changes provider recipients, delivery, CC/BCC, or subscription.
N101 - A Triage-comment email Node receives no Company Explorer item and no initial Logic Gate assignment. Normal email conversions retain their established typed assignment behavior, and every primary-email-origin Node shares the email layout/icon contract even when created by drag.
N102 - A qualifying post-activation Inbox message that arrives after a Node thread download is appended automatically by the durable webhook/checkpoint ingestion path. Mango imports only missing or incomplete real provider messages, then gives each newly completed message the thread's existing Node-wide destinations without duplicating old messages or Node sources. Opening a Node remains provider-read-free, and a genuinely different mailbox/thread attached later becomes another left-pane browser tab.
N103 - Clicking a persisted editor annotation highlight with no active text selection opens the owning text block's chat, expands the required thread, scrolls the exact stable comment ID into view, and moves accessible focus to that comment with a visible focus state. Multiple annotations resolve independently; normal selection, editing, keyboard behavior, and chat-to-text highlighting remain unchanged.
N104 - Attached-email message cards list every attachment not actually referenced by the message body's normalized CID set. Both conversion-to-Node and attach-to-existing-Node retain immutable source mailbox/message/thread identity, while imported bodies, inline images, signatures, and ordinary attachment bytes are stored in Mango-owned email/attachment storage. Node collaborators read those stored copies through Node authorization; provider bytes are never embedded in the editable Node JSON projection.
N105 - An attached-email Node viewer loads no mailbox signature during ordinary viewing. Explicit Reply loads the exact source-mailbox signature once into the owner draft, hydrates its images through the authenticated `email_draft` attachment context with the same add/remove authority as Triage and Project, and uses the same send fence.
N106 - Transient Node popup view mode is owned by the active popup instance, not canonical Node/board projections. Same-Node refresh or title reconciliation preserves fullscreen; only explicit user exit/close or opening a different Node may restore the normal saved non-fullscreen ratio.
N107 - Every Node rich-text body is an exact collaboration document with a server-ordered revision and ETag. Normal typing commits structured insert/delete operations plus the next revision and outbox event atomically; the projection row is a derived compatibility snapshot, not the mutation authority.
N108 - Concurrent valid Node operations integrate automatically in deterministic collaboration order even when based on an older valid state. Stable operation IDs make lost-ack retries idempotent; ordinary users never receive a whole-document merge choice or `projection_revision_conflict` workflow.
N109 - Node saved state advances only after the backend acknowledges the committed stable operation. Local rendering remains immediate, remote events apply once without echo writes, duplicate revisions are ignored, and a revision gap forces canonical snapshot recovery.
N110 - Every unacknowledged Node operation is durably retained before loss under authenticated user, company, exact resource/document, browser client, and stable operation ID. It survives unmount, tab/browser refresh, and disconnect; only commit acknowledgement/deduplication removes it.
N111 - Orange connection health permits Node typing into the durable operation queue while risky mutations are gated. Blinking red uses the app-global blocking portal; solid red requests browser refresh. Recovery restores the exact subscription and full snapshot, reapplies pending operations automatically, waits for acknowledgements, and never restores the deleted draft/conflict modal.
N107 - Full node shells use a shared responsive vertical viewport inset of 8px per browser edge where they are viewport-positioned. Home, app/sidebar, dock-restored, and Kanban non-fullscreen node windows default to the taller available height; Project critical-path and Logic Gates / Nodes inline surfaces use the same maximum available-height rule inside their opener constraints. Explicit fullscreen surfaces retain the existing 8px inset and live-editor behavior.
N108 - Ordinary Node attached-email viewing never enters the centralized ten-second pre-dispatch gate. Explicit Reply enters that existing gate; Send now or expiry begins at most one HTTP dispatch for that pending browser attempt, Undo begins none, and this is not a provider-level exactly-once guarantee. Success appends the returned message locally and invalidates only the exact company/Node/thread summary and full-read cache. My Triage, Shared Triage, and Project behavior remains unchanged.

## Scenarios

### Scenario N-S1: Every RACI Role Accepts People And Groups

Business logic covered:
- N1
- N2
- N3
- N4
- N8

Given:
- A node has editable RACI fields.
- A company has users, groups, and nested subgroups.
- Several direct principals are assigned to each Node RACI role.

Expected:
- Responsible, Accountable, Consulted, and Informed each accept multiple users or groups.
- One direct principal cannot occupy two roles on the same Node.
- Each role card keeps Add at the top and uses the stronger layered role-color gradient.
- `No assignments` stays on one line, and five direct people or groups render as five visible single-line name rows.
- Direct names are never replaced by `People (n)` or a comma-truncated summary.
- Opening a card's assignment list exposes a remove action for each direct assignment.
- Current nested group membership expands live for effective RACI.

### Scenario N-S2: Live RACI Users And Teams

Business logic covered:
- N1
- N2
- N4
- N5

Given:
- A node has Responsible, Accountable, Consulted, and Informed RACI fields.
- A company has users, user groups, and nested user groups.

Expected:
- Every role can include individual users.
- Every role can include user groups and current nested subgroup members.
- Every role can hold multiple assignments.

### Scenario N-S3: Node RACI Organization Tree Picker

Business logic covered:
- N6
- N7

Given:
- A company has top-level user groups, subgroups, and users inside those groups.
- A user opens a node RACI assignment picker.

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
- One user has edit access to a node.
- Another user has edit access to the same node.

Expected:
- The no-access user's DELETE request is rejected.
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
- N93

Given:
- A user edits a node text body.
- The user pastes styled text copied from another application.
- The user changes font size, Bold, Underline, Italic, Strikethrough, text highlight/No highlight, alignment, outline style, or inserts a table.

Expected:
- Pasted content renders in the node editor's normal font family.
- Pasted inline text does not gain empty rows above or below the copied text.
- New node editor text uses alphanumerical numbering by default, and alphanumerical numbering appears first in the outline dropdown.
- Changing font size while text is highlighted changes that selected text.
- Changing font size with only a caret sets the font size for the next typed characters; repeated plus/minus clicks keep that caret and pending size across toolbar focus and update the returned caret/typing height.
- Bold, Underline, Italic, and Strikethrough buttons reflect the caret or selected text state, can be active together, and affect selected text or subsequent collapsed-caret typing; Italic is not lost when toolbar focus returns to the editor.
- The highlight main hitbox immediately applies/toggles the selected color without opening the picker, and the arrow opens the palette without applying. **No highlight** removes selected highlighting or clears the pending highlight typing style.
- Highlighting one line or list item does not partially highlight the following sibling; intentional multi-line highlighting remains supported.
- Left, center, and right alignment reflect and change the active paragraph/selected block or active-table context.
- The shared toolbar controls have the same visual styling and command behavior as Logic Gate, project, and mail editor surfaces; vibrant active styling affects only the individual hitbox and remains distinct from hover/focus/disabled state.
- The node wrapper mounts the shared rich editor host and formatting controller rather than a separate rich editable DOM or local formatting-command implementation.
- Table insertion uses the current caret/selection position from the shared toolbar, with no duplicate text-box/header table button and no cell-level alignment-icon overlay.
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
- Clicking the quote X clears the prefill, removes the temporary source highlight, and leaves the chat draft otherwise intact.
- Closing the chat pane while that selected-text action is still pending performs the same complete cancellation.

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
- N107
- N108
- N109
- N110
- N111
- N83
- N84

Given:
- A user has edit access to a node.
- The user types in one or more node text boxes.
- The user opens Save Settings, manually saves, deletes a text box while a save may still be in progress, or closes/switches changed Nodes while debounced edits remain.
- A newer projection value may arrive while the document or a shared toolbar control has focus.

Expected:
- Regular typing commits the final `node_textboxes` JSON row; explicit saved versions use `node_textboxes_history`. Projection-shaped API rows are assembled at read time and are not stored in a compatibility table.
- Save Settings shows saved versions with saving user, timestamp, and text box count.
- Saved-version history is requested only after Save Settings activation; initial open uses the exact collaboration snapshot/ETag.
- Manual Save flushes and acknowledges pending operations, materializes the canonical collaboration head, then writes one saved-version batch.
- Leaving a changed Node invokes that same history path once after the exact Node's pending body and metadata saves flush; leaving an unchanged Node does not.
- Ordinary typing renders locally, becomes a durable HTML patch, micro-batches briefly, and marks Saved only after commit acknowledgement.
- Two tabs/users editing the same exact text box both converge automatically through server-ordered revisions; neither receives a whole-document conflict or blocks behind a local-draft modal.
- Another Node text box and unrelated Node/company scopes receive no event. Duplicate mounted local consumers share one network subscription, and last unmount unsubscribes.
- Disconnect/reconnect retrieves a full snapshot, applies buffered above-snapshot events, reapplies stable pending operations, and returns green only after acknowledgements.
- Delete commits an exact tombstone, terminates the scope, preserves independently owned attachments/email associations, and prevents late operation recreation.

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
- N107
- N61
- N64
- N85
- N86
- N93
- N94
- N95
- N116

Given:
- A user opens the same node from Home, Updates, Company Explorer/sidebar, Kanban, dock restore, a Project critical-path row, and a Project Logic Gates / Nodes row.
- The node has text boxes, attached emails, and text-block chats.
- The user switches from the document to Metadata, History, or Save Settings and then returns.
- A future product change adds a new node-window action or changes rich editor indentation/paste/delete semantics.

Expected:
- Each full node window uses the unified node shell behavior for header, title, top-right actions, close/minimize/open/fullscreen/delete controls, sizing, and body layout where the capability is available.
- The unified node shell surface inventory is Home node popup, app/sidebar Company Explorer node popup, minimized/dock-restored node popup, Updates row detail node popup/panel, Kanban full node popup/overlay, Project critical-path inline node window, Project Logic Gates / Nodes embedded node panel, and any future full node editor/window surface without a documented exception.
- Adding or changing a top-right node-window action through the shared shell reaches every full node window surface that exposes that capability.
- Close buttons use the unified red close chrome with a white X on every full node shell surface that renders a close action.
- The Kanban full node overlay exposes the shared fullscreen control between minimize and close and restores its prior board-relative overlay size when fullscreen is turned off or the overlay closes.
- Activating that Kanban fullscreen control pins the node overlay to the browser viewport, not merely to the visible Kanban board bounds.
- The Updates Node detail panel exposes the shared fullscreen/restore control, enters the blocking body-level overlay with standard viewport insets, and returns to the saved Updates split ratio without changing the selected update or Node context.
- Clicking a Project Logic Gates / Nodes node row expands its editor directly beneath that row; clicking it again collapses the editor without resetting Project grouping or node selection state.
- Node text boxes use the unified editor semantics on every node-window surface.
- Typing `@` or `!` in a node text box or its chat opens the people picker with each user represented by a stable profile color keyed by normalized user ID, then email, then display name. Rich-editor keyboard selection adds a translucent same-color row tint and active rail; chat retains its active-row treatment. Both keep the profile avatar opaque/full-color with tested white-text contrast instead of washing every user gray.
- The shared format toolbar controls the focused node text box through the shared formatting controller, so font size, inline formats, highlight, alignment, table, and outline-style behavior cannot diverge by node opener.
- Editor, Permissions, shared formatting, Outline Styles/Automatic Numbering, and the immediately adjacent More control remain on one nonwrapping primary-header line; Relationships, Metadata, History, Save Settings, version/related-node commands, and supported secondary actions remain available in the keyboard-operable **More editor actions** menu.
- The four RACI cards remain equal-width in one horizontal row and widen together. Complete name pairs share a row equally, while a single or final odd principal spans the complete row. A narrow adjacent pane may require horizontal overflow instead of wrapping the role cards into taller header content.
- Relationships, Metadata, History, and Save Settings disable formatting only when their content hides/replaces the document; returning to the document preserves the text-block layout.
- Node windows, dialogs, and previews render in the shared body-level overlay layer above Key Views/Explorer/Search Explorer; blocking modes trap/restore focus, while anchored Kanban panels remain modeless until fullscreen.
- Project Logic Gates / Nodes inline node editors remain in document flow; Kanban panels retain the same mounted editor while moving between anchored and fullscreen geometry.
- Node text-box edits continue to save through node information/projection persistence.
- Text-block chats remain chat composers and do not receive rich editor toolbar or rich editor keyboard semantics.
- Opening Node Attach email uses the Universal picker Emails category to attach an exact existing personal-mailbox message and does not expose compose, reply, send, scheduled send, draft-save, or mailbox-mutation controls.
- Opening an attached email shows only stored conversation content and received attachments; it never mounts a composer below the thread.
- Small node card previews, list rows, tree rows, timeline bars, picker rows, and other non-editor node summaries do not need to mount the unified node shell.
- Home, app/sidebar, dock-restored, Updates, Kanban, Project inline node windows, and the Project Logic Gates / Nodes embedded node panel mount the `UnifiedNodeShell` adapter and expose only the actions enabled by that opener.
- Viewport-positioned node shells leave only an 8px top and bottom gap by default, while constrained inline surfaces grow to the same responsive available-height ceiling.

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
- A user opens an attached email whose stored body contains multiple lines and indentation.

Expected:
- Node text-box collaboration operations preserve rich text and durable attachment references; realtime payload validation rejects inline file bytes, data URLs, presigned URLs, and credentials.
- Node attachment-button uploads create Mango attachment links instead of embedding bytes in node information/projection payloads.
- Browser file bodies go directly to private S3; Mango API sees JSON intent/part/complete requests only. Incremental hashing and multipart slices keep memory bounded, and no whole-file array buffer/base64/data URL is created.
- Exactly 1 GiB is accepted and one byte above is rejected before S3; 64 MiB uses single PUT and one byte above uses resumable 16 MiB multipart. The direct path has no 12 MiB text-box aggregate.
- Concurrent picker batches append successful uploads, deduplicated by durable attachment ID, to the current node state; a failed file does not erase successful files from the same or another batch.
- An upload intent belongs to the company/actor/node, while text-box ID remains origin context. Deleting the text block keeps progress at node level and can still complete without mutating or recreating the deleted projection; navigation may detach visible UI without changing durable intent authority. Permission loss or node deletion rejects completion and cleans up.
- Each text box can list its own attachments, and one node-wide counter/list can show the union across all text boxes from the same node-level metadata read.
- Attachment rows show an immediate type cue, visibility-gated image thumbnails through authenticated content reads, an always-visible extension badge (or `NO EXT`), and a right-side original-file download action. Only visible/near-visible image rows prefetch; closing the list aborts pending reads and releases object URLs.
- Chat messages store attachment references and remain outside rich-editor semantics.
- Attached-email projections store email metadata and attachment references only.
- The attached-email view reserves no bottom space for an outbound editor.
- Stored message bodies preserve their line breaks, spacing, and indentation when displayed inside the Node.
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
- One user has edit access and another user has no access to the node.

Expected:
- Each text box shows a list/count control beside its upload control and includes only `file_attachment` links whose `information_id` is that text-box ID.
- The shared node toolbar shows one aggregate count/list containing explicit node `file_attachment` links from both text boxes and labels rows with their text-box title when available.
- Inline images, chat attachments, email attachments, and attached emails do not inflate either explicit-file count.
- Every row shows the original filename and byte size with a download action on its right edge.
- Download reads the authorized `original` S3-backed variant through Mango's attachment-content API and uses the original filename.
- The edit-authorized user can open both lists, download, and upload; the no-access user receives neither list.
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
- A Node has an attached multi-message email thread with To, Cc, Bcc, ordinary attachments, and CID screenshots; zero or more exact messages may independently link to text boxes.

Expected:
- The email-count viewer fills the available viewport and preserves one scroll surface for the conversation.
- Every stored message renders once in timestamp order when its neutral thread container is opened, and each individual message exposes its own disclosure control.
- Every expanded exact ingested message exposes its sender and stored To, Cc, and provider-supplied Bcc metadata plus Reply or **My Draft**, while Reply All, Forward, a draft scope chooser, and scheduling remain absent.
- `Expand all threads` opens every collapsed attached-email thread group.
- `Collapse all threads` closes every attached-email thread group, and each thread header independently exposes the same expand/collapse state.
- Personal attachments retain `account_email`, and shared conversions retain both `shared_inbox_id` and `account_email`, so every thread, received-attachment, and calendar read uses the originating grant.
- Selecting an inline image exposes Download; double-clicking it opens a full-screen preview.
- Text selected in rich/image email bodies still exposes the existing chat/create-node actions.
- Non-inline attachments show filename/type/size, download, and full-screen image preview.
- Calendar invitations render the shared event card with available title, local time plus provider timezone, organizer, guests, location, current response, Join meeting, Copy link, and Open calendar; edit-authorized Accept, Tentative, and Decline prevent duplicate submission while pending and show saved state only after provider success.
- Opening an email never changes the surrounding Node text block's formatting target and never installs an email editor toolbar.
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
- Removing an email with no Node-local textbox or chat work deletes only its attached-email projection from the node; Node-local work rejects removal and changes nothing.
- Removing an attachment unlinks the active node resource attachment and refreshes counts without deleting the stored attachment object.
- No-access users do not receive either removal action.

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
- The client has a current node-view ETag and a textbox may contain a persisted dormant `change` annotation.

Expected:
- Initial document rendering does not wait for saved-version history, and Save Settings activation loads that history once for the active target.
- Attachment metadata, project relationships, company accounts, and company people/group references coalesce compatible in-flight reads and reuse authorized cached results.
- Attachment and relationship mutations invalidate their cache before emitting a refresh; account/user/group mutations invalidate shared reference data before their update event.
- The backend authorizes the conditional node view, reads one indexed shared/user version pair, and returns `304` before consolidated payload construction.
- Neither a node-view `200` nor `304` writes seen/anchor state or reads editor/event-row sequence state.
- The client makes no Node changes or anchor-clean request. Dormant change annotations remain in the canonical textbox JSON and do not affect view revalidation.

### Scenario N-S18: Same-Window Rename And Chat Acceptance Reconciliation

Business logic covered:
- N91
- N92

Given:
- The same Node is visible in multiple applicable RW15 consumers, and an Editor title is actively edited.
- The Node is renamed successfully from each supported rename entry point.
- Mounted Node chat has completed its initial load and then receives first subscription acceptance or reconnect acceptance while a read is slow; another local handler may join the accepted scope.

Expected:
- Each successful rename publishes one concrete committed-title event after commit.
- Every non-edited mounted label converges immediately in the same browser window without a broad cross-user realtime scope or full reload; the active title keeps its DOM draft/caret and applies the deferred label after editing ends.
- Failed renames publish no committed-title event.
- First/reconnect/late-handler acceptance and hints run one canonical durable-chat read at a time with at most one queued final read.
- No replay log, gap protocol, recovery worker, or dirty editor-text replacement is introduced.

### Scenario N-S19: Email Collaboration Node Has One Shared Chat

Business logic covered:
- N96
- N97
- N98
- N99
- N100
- N101
- N102

Given:
- An email with no existing collaboration is opened and highlighted without submitting a chat.
- A user later submits an anchored chat and mentions another user.
- Both participants open the resulting Node from Mango-stored email data. A qualifying post-activation Inbox message later joins the same provider thread.

Expected:
- Highlight/read alone creates no Node; the first nonempty chat submit ensures exactly one standalone private Node outside every Logic Gate/project/work-assignment path, and retry reuses it if the following chat write fails.
- The Node has no placeholder text box, status, priority, RACI, card, or inherited work policy.
- Its canonical attached-email projection preserves source mailbox/thread provenance, and the collaboration Node creates no Company Explorer item or default Nodes folder.
- The email and Node mounts show the same durable chat IDs and shared ChatPane behavior, including parent indentation, anchor navigation, mentions, attachments, deletion ownership, and Node chat reconciliation.
- The creator and mentioned participant keep direct edit access while nonparticipants are denied.
- The verified webhook or rare bounded checkpoint reconciliation enqueues the future provider message without downloading inside the request or requiring either participant to open Mango.
- The background worker reuses the mailbox-scoped durable thread, appends each missing real provider message once, copies only its missing Node-wide destination, and does not create a second Node source or projection.

### Scenario N-S20: Annotation Navigation And Read-Only Attached Files

Business logic covered:
- N72
- N75
- N103
- N104
- N105

Given:
- One Node text block has multiple highlighted annotations mapped to different stable chat comment IDs, including a comment inside a collapsed thread.
- The Node has one converted email and one directly attached email with body CID images and ordinary files.
- The attached email may have received attachments under either a personal or shared mailbox identity.

Expected:
- Clicking each highlight without selecting text reveals the chat panel, expands only the needed thread, scrolls to the exact comment, and exposes a visible accessible focus target without the composer stealing focus.
- Drag-selection and normal editor input do not trigger chat navigation, and existing chat-to-highlight behavior still works.
- Both email paths display unreferenced files with metadata and authorized actions under the originating mailbox identity.
- The Node exposes the same owner-only Reply draft, exact source-mailbox signature, `email_draft` attachment controls, and safe send as the other mail surfaces, while Reply All, Forward, a draft scope chooser, and scheduling remain absent.

### Scenario N-S21: Same-Node Reconciliation Does Not Collapse Fullscreen

Business logic covered:
- N94
- N106

Given:
- A Logic Gate Node popup is fullscreen and background canonical work/view reconciliation updates the same Node's card or title.

Expected:
- The live Node editor and fresh canonical data remain visible.
- The reconciliation does not reset local fullscreen or the saved restore ratio.
- The popup returns to normal only through explicit user action, close, or a different-Node open.
### Scenario N-S22: Attached Email Disclosure And Owner Reply Draft

Business logic covered:
- N57
- N58
- N59
- N72
- N108

Given:
- A Node-attached multi-message email has different From/To/Cc/Bcc participants, files, and inline images per message, and the user opens one message.

Expected:
- The Node conversation header shows only the subject; collapsed rows show sender/date/snippet without recipient noise, and accessible expansion reveals only the chosen message's labeled participants, body, attachments, and actions.
- Stored participants, mailbox identity, received attachments, inline images, and allowed calendar actions remain intact.
- Reply ensures or reuses the owner-only mailbox draft after resolving the source scope's current sender, then shows that exact read-only From with editable To/Cc/Bcc/Subject, rich body, one exact signature, and `email_draft` attachment add/remove. Send rechecks the authoritative mailbox sender, while Reply All, Forward, a draft scope chooser, and scheduling remain absent.
- Send uses the existing Undo/Send now countdown, while ordinary viewing starts no provider-send request.

N112 - Every Node has one optional, independently resizable, full-height email column to the left of its multi-text-box list. Importing one message stores one Node-wide attached-email source and displays every thread as a collapsed neutral card; the same thread may independently be attached to another Node. The exact `/v1/nodes/{node_id}/email-threads/{email_thread_id}` read starts only when that exact card is opened, routes through the Node's authorized durable link, and returns Mango-stored history rather than `not_found`. Expanding an email consumes the column's available viewport instead of retaining the old 620-pixel/72vh ceiling. Once an attachment exists, the Node Email toggle retains one three-track workspace shell: closing animates email width to zero plus a short fade/left transform and makes the pane inert, accessibility-hidden, and pointer-disabled; opening reverses the transition to the saved width. Each text box owns its editor, zero or more exact linked email messages, and optional message-linked chats. One exact message may link to at most one textbox in this Node, several exact messages may share one textbox, and another Node may link that message to its own textbox. Each linked message card uses the permanent color of its exact textbox; a thread container never receives that color. Email-created Nodes bind their initial editor to the selected source message, while the entire thread remains attached Node-wide.

N113 - A new Node text box starts with Editor open and Chat closed unless that exact box already owns durable chat. Legacy email-origin chat resolves to a stable linked/declared/oldest host and never follows list position. Email, Editor, and Chat labels share one horizontal row; their opened panes and linked-email expansion use the shared short, reduced-motion-aware entrance transition without changing persisted open/closed state. The Email control opens every exact message linked to that textbox in backend projection order, oldest-to-newest by stored message timestamp, without scanning attached threads to infer or reorder membership. Each listed message has an explicit remove control governed by its exact relationship and anchored-chat guard. The list shares the left content column vertically with Editor when both are open. Chat always owns a separate right column at full row-body height and is never shortened by the email list. Text-box actions expose a visible fixed-position Delete menu. Optional attachment-list network failures stay local to their retryable menu.
N114 - Mentions, urgent mentions, ordinary chat, and work-field updates created from a Node editor always route and label recipients through that exact Node's current effective RACI resolver. The resolver may use its active Node customization or inherited Logic Gate source; callers never substitute a parent lookup. Assignment notifications go only to newly effective or effective-role-changed users, not unchanged, removed, unrelated, or actor users.
N115 - An authenticated user with Node Edit access may edit or delete only a Node chat comment whose stored `author_id` is that user. Comment edits use the exact projection ID through PATCH, preserve the original comment envelope and attachment/source relationships, refresh direct mention notifications and collaboration participants, and publish one compact `chat.message.updated` hint on the existing exact Node chat scope. Generic information/projection POST routes must reject attempts to overwrite an existing chat comment so the author check cannot be bypassed.
N116 - The Updates row-detail Node panel exposes the shared fullscreen/restore shell action. Fullscreen uses the body-level blocking overlay, shared viewport insets, focus/Escape handling, and app-chrome suppression; restore returns to the existing Updates split ratio without changing the selected update or Node context.
N117 - Moving an assigned Node from one Logic Gate ID to another commits a durable compact timeline event with timestamp, actor-name snapshot, source Logic Gate ID/name snapshot, and destination Logic Gate ID/name snapshot. Initial assignment, removal, and same-Logic-Gate status movement do not create that event.
N118 - A Node timeline transfer event is immutable and read-only. Later actor or Logic Gate rename/removal does not rewrite historical display copy, and the assignment move and timeline insert succeed or roll back together.
N119 - The Node timeline plus button opens a keyboard-labelled menu with New text box and Verify stamp choices. New text box preserves existing behavior; the plus itself no longer creates a text box immediately.
N120 - A verification stamp snapshots every current effective Node Accountable user once, requires at least one recipient, preserves that snapshot across later RACI changes, and renders one individually actionable check beside each name. PostgreSQL derives recipients from canonical V2 settings/assignments, current hierarchy, reset boundaries, and live groups during the request, persists each recipient, reads canonical `nodes.name`, and carries that Node name into the notification domain event.
N121 - Only a snapshotted recipient can complete their own verification. Completion is one-way, stores the first server timestamp, is idempotent under retry/concurrency, and cannot complete another recipient.
N122 - Transfer, Project-assignment, and verification stamps stack as content-height cards on the exact shared text-box line-and-circle timeline, stop well before the right edge, remain accessible in narrow layouts, and do not change text-box virtualization or editing. Spare workspace height stays below the rows and cannot stretch a card or create internal bottom whitespace. The timestamp and clock lead the card; relationship headings and stored destination snapshots use the matching Logic Gate or Project icon. Stored Logic Gate and Project chips are keyboard-accessible exact-resource links that push browser history so Back restores the Node route and workspace state.
N123 - Updates deep links use the verification stamp event ID, and the Node editor scrolls that exact `data-node-timeline-event-id` row into view without opening or editing an unrelated text box.

N124 - Hashtag destination submission and first email-chat creation share the established import transaction. The selected Nylas message is fetched, identity-validated, stored completely, attached to the Node, and returned for immediate rendering before the request succeeds. The rest of the current provider thread is downloaded only by a durable retryable background job created atomically with the import.
N125 - A Node email source is deduplicated by company plus immutable personal/shared mailbox scope plus Nylas thread ID, falling back to the exact Nylas message ID only when no thread ID exists. Messages are deduplicated inside that scope by Nylas message ID. Repeated and concurrent imports reuse the same durable thread/message/Node link/job; subject, sender, recipients, timestamps, and body similarity never establish identity.
N126 - A qualifying later Inbox message from an already stored thread automatically appends only missing/incomplete real provider messages and files to the existing durable thread and preserves stable IDs/order for old messages. Every newly completed message receives only missing Node-wide destinations already present on that thread. It does not redownload completed messages, duplicate the Node-wide source, create a textbox relationship, or create any Node relationship when the thread is unplaced.
N127 - `ingestion_job_id` is the one durable ingestion identity for the exact company/connection/provider message. PostgreSQL stores accepted, processing, completed, parked, or exhausted result state, provider-attempt count, exact attempt-token fence, optional thread ID, SQS acceptance observation, and a safe error. SQS alone owns delivery, ten-minute visibility, redelivery, receive count, and DLQ movement; the worker owns an eight-minute attempt deadline and refuses provider start 4. There is no database lease, next-attempt field, claimant, heartbeat, or automatic DLQ replay. Reconciliation creates and sends only genuinely missing stable jobs and sends nothing for any existing job. A failed attachment does not hide the trigger message or completed sibling messages/files.
N128 - The durable email tables store immutable HTML/body and message envelope metadata; private Mango attachment storage stores ordinary files, inline CID images, and signature assets. The editable Node JSON stores only stable email/thread/message/Mango-attachment references. Node rendering sanitizes stored HTML, orders message cards by timestamp and Nylas message ID, and never needs the viewing collaborator's Nylas account.
N129 - The Node email column renders the selected stored message immediately with an explicit thread-download status. While the durable job runs, successfully downloaded messages/files may appear without blanking the conversation. Partial/retry/failed states remain readable and expose a retryable status; successful completion means complete as of that user-initiated download, not permanently synchronized with the provider.
N130 - Every stored-email and attachment read authorizes the company, Node, and exact Node/thread or Node/attachment link before returning data. Removing/revoking the source mailbox does not erase the imported snapshot. Provider grants, raw errors, signed object URLs, bodies, recipient data, attachment bytes, and secrets must not be logged or copied into editable Node JSON, realtime hints, or job errors.

N131 - `node_textbox_chats` is the authority for current Node textbox comments after cutover. Deleting a textbox deletes all chats and textbox-specific email relationships owned by it and tombstones the chats' attachment links; Node-wide email relationships, normalized email message/thread data, and email attachments remain. Legacy `Text block chat` rows remain rollback evidence but are excluded from runtime reads and receive no new writes.

N132 - After the table-free application is deployed, the operator-controlled Node unread-highlight retirement must strictly remove only the three retired feature tables and their dedicated indexes, triggers, foreign key, and functions. It must refuse unsupported PostgreSQL versions, shape drift, or unexpected dependencies; it must not use `CASCADE`, alter current/history textbox JSON, or add a fallback reader, writer, API, or replacement table.

N133 - A Node assigned to a Logic Gate uses that Logic Gate as its immediate policy parent. Inherited Nodes change with the current active parent policy; customized Nodes remain independent.

N134 - Assigning or moving a Node to a Logic Gate advances both parent-link sequences. A move newer than an ancestor reset prevents that older reset from crossing the new relationship.

N135 - Detaching an inherited Node atomically copies its current effective RACI and permission policies into complete customized Node policies before removing the parent. A customized Node keeps its own policies.

N136 - Node RACI and permission modes are separate. Changing one never changes the other's mode, edges, sequences, authorization, or notification meaning.

N137 - Node reads and ETags include V2 source/reset/parent-link and live-group fingerprints, and authorization is checked before a conditional 304 response.

N138 - Opening a pinned Node creates a fresh popup instance that fills the viewport to the right of the primary sidebar and resize handle while leaving that sidebar visible and interactive. It starts outside full-screen mode; entering full screen keeps the same Node mounted and visible across the full viewport instead of exposing the underlying page, and leaving full screen restores the right-of-sidebar layout. Other Node launch sources retain their established layout.

N139 - The Node header timeline plus is centered over the left timeline rail. The old labelled Email, Attach email, assignment, and Go to buttons are removed. One mail icon/count toggles the Node email column, its divided adjacent plus opens email attachment, and current Logic Gate/Project icon-label chips open those exact resources.

N140 - The Node header linker is a light, readable button visibly initialized to purple `##` with the explicit `Ready! Open universal linker` label and an elevated active border while open. It permits Logic Gate, Project, and Email targets. A Logic Gate choice uses the established assignment/move command and priority rule, a Project choice uses the established exact `project_relationships` command, and an Email choice attaches the exact stored message through the existing Node email command. The picker and header chips add no new relationship authority.

N141 - Creating a Node's first exact Project relationship atomically creates one immutable `project_assignment` timeline stamp with actor, Project ID, and Project-name snapshots. Re-adding the same relationship is idempotent and creates no duplicate. The Project relationship, its implicit Logic Gate relationship, dependent projections, and stamp succeed or roll back together. The Node email column reserves a visible bottom gutter and keeps a rounded border/shadow so it reads as a separate elevated surface.

N142 - A stored email thread may have Node-wide `email_relationships` in more than one Node. A textbox-specific email relationship names one exact message, Node, and textbox; the same message is limited to one textbox in a Node, several messages may share one textbox, and another Node may use a different textbox for that message. Repeating the exact Node/message/textbox command converges to its existing edge, while a different textbox in that Node is rejected. Removing one textbox edge is rejected while that exact message anchors a chat in that textbox and otherwise leaves the Node-wide edge, every other Node edge, textbox, stored email truth, and surviving attachment relationship unchanged; the textbox keeps its color while another exact message remains and returns to neutral after its last edge is removed.

N143 - An ordinary Node text box has `color = null` and uses the normal thin neutral frame. Only a text box with an exact email relationship stores an approved non-red RGB `color`; every exact message card linked to that textbox uses the same literal color, while the parent thread container stays neutral. The interface never hashes an email ID or restores per-message color ownership. Red is reserved for a failed-save state.

N144 - A consolidated Node view returns text-box identity, order, metadata, typed links, attachments, chats, and revision without duplicating the canonical editor document body. The exact editor document endpoint remains the document-body authority.

N145 - One consolidated Node read supplies its initial timeline events, and PostgreSQL loads all verification recipients for those events in one set-based query. The Node surface does not issue a second initial timeline request.

N146 - Every attached-email thread starts collapsed when a Node opens. A collapsed card performs no thread-body or draft-body read, and only opening that exact card loads its message. Visible messages may make body-free owner-draft indicator requests in exact-mailbox batches of at most 100 internal source-message IDs; only Reply or **My Draft** exact-hydrates a draft.

N147 - A newly added current-user chat moves the shared ChatPane to its bottom; messages added by other users do not force the reader away from the current position.
N148 - Only the noninteractive header of one exact Node email message is draggable into a textbox; message bodies, selected text, buttons, links, and inputs never start the drag. Dropping the header onto a textbox creates only that exact relationship without a chat. Every stored-thread message header in the Node email column always shows a horizontal textbox-plus control that creates or reuses that exact message's textbox; only a linked message shows an adjacent textbox-navigation control, and message disclosure never navigates to a textbox. Each exact message in Show email has an explicit remove control that removes only that textbox edge when no chat in the textbox is anchored to the message. Highlighting an unlinked exact message defaults to a staged new textbox; until the first successful Send, each eligible textbox-header click moves the same pending composer and draft and replaces its destination without writing, while an authoritative existing link remains the only allowed Node-local destination.

### Scenario N-S23: Email, Editor, And Chat Column Correction

Business logic covered:
- N57
- N58
- N59
- N72
- N112
- N113

Given:
- A Node has one attached email source, an older legacy email-origin chat, an existing linked text box, and the user creates a newer ordinary or email-linked text box.
- The Node is opened before its final element measurement is available, the user toggles Editor/Chat, expands the linked email, opens the three-dot menu, and the optional attachment-list request returns a browser network error.

Expected:
- The left column reaches at least the full text-box-row height immediately and then the remaining Node viewport; it has one Email header and no redundant `Attached emails` group when no folders exist.
- The new box opens with Editor only and contains no old chat. The older legacy chat remains on the stable associated/original box before and after the new box is prepended.
- Editor and Chat labels appear in the one shared row header. Opening Chat does not add a second Chat header inside the pane, and editor-only/chat-only/editor-plus-chat modes keep their existing independent toggles and horizontal resizing.
- The text box header, border, and every exact linked email card share the color stored on that text box, while the outer thread card remains neutral. **Email** opens every message linked to that textbox oldest-to-newest inside the row's left content column; when Editor is also open they divide that column vertically, while the separate Chat column retains full body height. **Hide email** removes the list without changing durable text, email, or chat projections. The Node-level Email toggle animates the left Node-wide thread column open and closed without unmounting its transition shell.
- Clicking the three dots displays a viewport-fixed menu with **Delete**. Choosing it opens confirmation; confirming deletes the box and only chat projections directly owned by that box, while canceling changes nothing.
- A raw `Failed to fetch` from the optional node attachment listing does not appear in the global bottom-left error surface. The attachment menu shows an actionable retry message, while editing, email, and chat remain usable.

Automated coverage:
- `tests/frontend/modules/editor/nodeTextBlockCreation.test.ts` covers editor-only defaults and stable legacy chat hosting.
- `tests/frontend/modules/editor/nodeTextBlockAttachments.test.ts` covers actionable attachment-list network error formatting.
- `tests/frontend/modules/editor/editorRowVirtualizationReact.test.tsx` covers the actual Node host: full-height email column, single headers, inline linked-email expansion, chat-header removal, and visible Delete menu.
- `tests/frontend/modules/editor/emailViewerContract.test.ts` locks the Node/email composition contract and no-folder direct thread list.

### Scenario N-S24: Author-Only Node Comment Editing

Business logic covered:
- N115

Given:
- Two users with Node Edit access have sent comments on the same Node.

When:
- Each user views the chat and one user edits their own comment.
- That user attempts to PATCH or delete the other user's projection or overwrite it through the legacy POST path.

Expected:
- Each user sees Edit only for comments they authored.
- The authorized PATCH preserves the stable projection envelope, records the edit time, and wakes mounted exact-Node chat viewers for canonical refresh.
- Editing or deleting the other author's comment returns forbidden.
- POST overwrite returns conflict and cannot bypass exact authorship.

Automated coverage:
- `backend/internal/http/chat_comment_edit_test.go`
- `backend/internal/http/realtime_websocket_test.go`
- `tests/frontend/modules/realtime/realtimeWebSocket.test.ts`

### Scenario N-S25: Automatic Later Email Reconciliation

Business logic covered:
- N124 through N130

Given:
- Bob imported a complete thread snapshot into a shared Node yesterday, and Joe can open the Node without access to Bob's mailbox.
- A new Nylas message joins the provider thread today.

When:
- A verified webhook or rare bounded checkpoint reconciliation enqueues today's message while Joe and Bob may both be logged out.

Expected:
- Joe initially sees yesterday's complete Mango-stored snapshot; opening the Node does not call Nylas or discover today's message itself.
- Background ingestion matches company, exact connection, Nylas thread ID, and Nylas message ID; it appends the new message once and reuses the existing Node-wide source.
- Only the new message's missing content/files run through durable retryable work. Old messages and attachments are not downloaded again.
- After commit, Joe sees the new Mango-stored card and attachments through Node authorization without obtaining Bob's provider access.

### Scenario N-S26: Deleting a Textbox Removes Its Chats and Textbox Email Edges

Business logic covered:
- N131

Given:
- A Node textbox has an ordinary chat, an email-selection chat, a chat attachment, and an exact textbox-specific email relationship; the selected email also has a Node-wide relationship and normalized stored truth.

When:
- An authorized user deletes that textbox.

Expected:
- Both chats and any reply descendants are removed from `node_textbox_chats`.
- Their active `node_chat_message` attachment links are tombstoned without deleting the underlying attachment content.
- The textbox-specific email relationship is removed, while the Node-wide relationship, normalized email message, thread, and email attachments remain; the deleted textbox's chats no longer appear in Node reads.

### Scenario N-S27: Dormant Change Anchors Survive Unread-Highlight Retirement

Business logic covered:
- N132

Given:
- Current and history Node textbox JSON contain valid dormant `change` annotations.
- The old unread-highlight tables still exist, and the deployed application no longer reads or writes them.

When:
- A human compares the read-only aggregate counts and JSON checksums, runs the strict forward retirement migration, and runs the read-only verification SQL.

Expected:
- Current and history textbox row counts and JSON checksums are unchanged, including all nested dormant annotations.
- The retired tables, indexes, triggers, and dedicated functions are absent; no unrelated Node view-version function is dropped.
- Node open/edit/save/reload/recovery/history continue to retain mapped dormant ranges without rendering or issuing any changes/seen request.
- Recycle and restore use only surviving owner-specific rows and ignore obsolete top-level keys in older payloads.

Automated coverage:
- `backend/internal/store/node_final_storage_contract_test.go`
- `backend/internal/store/postgres_node_retirement_integration_test.go`
