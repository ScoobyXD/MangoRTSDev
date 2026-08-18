# Process Story: A changed Project saves history when the Project is left

A user edits a Project textbox body, metadata, or textbox structure
↓
The ordinary current-textbox save continues writing the latest final Project rows
↓
The user closes or switches the Project, changes routes, uses Back/Forward, or triggers browser `pagehide`
↓
Mango flushes only that exact Project and creates one existing-format history batch if it changed since the last successful history save
↓
An unchanged close creates nothing, repeated close signals share one save, and refresh or tab close remains browser best effort

Last updated: 2026-08-06

# Process Story: An existing Logic Gate is linked to a Project from its editor

A user with Logic Gate edit access types `##` in that Logic Gate's editor and selects a Project they may edit
↓
The universal picker sends the exact existing Logic Gate ID and Project ID to the typed Project relationship command
↓
Mango creates or reuses the stable relationship for that exact Project and Logic Gate without creating, moving, or copying the Logic Gate
↓
The same Logic Gate may retain separate stable relationships with other Projects
↓
The editor inserts a durable Project reference chip after the relationship succeeds; removing the chip does not remove the Project relationship
↓
Project-scoped Logic Gate creation remains prohibited, and adding a Node to a Project continues to create or reuse its current Logic Gate relationship implicitly

Last updated: 2026-08-05

# Process Story: Project textboxes, chats, and attached emails use final storage

A user opens a Project
↓
The backend reads textbox bodies and Project-owned metadata from `project_textboxes`, rebuilds the existing textbox API payload, and reads textbox files through active `attachment_relationships`
↓
A user can create a textbox even when its metadata request reaches the backend before its first document-body request; the metadata transaction creates the empty final textbox row and the later body request reuses it
↓
The backend reads, creates, edits, replies to, and deletes textbox chats in `project_textbox_chats`; each chat keeps its stable former projection ID and belongs to one exact Project textbox
↓
Attaching an email creates Project-wide `email_relationships` rows for the stored thread; a highlighted exact message may later receive one relationship to one Project textbox
↓
Deleting one chat, email relationship, textbox, or Project removes only that owner's relationships; shared files and normalized email content survive under their other valid owners
↓
Project manual and changed-resource exit history continue in `project_textboxes_history`
↓
No Project request reads or writes `project_information` or `project_projection_table`; those tables remain unchanged only for the separately gated retirement decision
Last updated: 2026-08-14

# Projects Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial overall. Rich-HTML collaboration, realtime transport, disposable-PostgreSQL, and unified rich-editor suites cover exact Project document identities, bounded HTML patches, durable recovery, metadata/body separation, and mounted Project host wiring. Project relationship rule and HTTP tests cover one Logic Gate per node, one Project per node, implicit per-Project Logic Gate relationships, direct existing Logic Gate association and idempotency, and the same Logic Gate remaining related to multiple Projects. The dedicated production-path realtime runner and its real-browser Project workflow were removed from CI on 2026-07-28; focused frontend and backend suites remain, while visible Project workflow acceptance is manual until replacement automation is added; project grouping, route, node-shell, attachment, and unrelated rich-editor behavior retain their focused coverage.

## Business Logic

P1 - A project critical-path row linked to a node can open an inline node window from that row.
P2 - The inline node window uses the same node editor projection model as the standalone node popup.
P3 - The inline node window shows node text boxes, attached emails, and text-block chats in the same three-column workspace used by the node editor.
P4 - Selecting a different node-backed critical-path row replaces the inline node window with the newly selected node.
P5 - Closing the inline node window returns the critical-path table to its normal row-only view without changing the critical-path data.
P6 - Logic-gate critical-path rows do not render the node editor window.
P7 - Project edit access alone does not reveal node editor content; the selected node must still pass node-level edit access.
P8 - Multiple node text boxes, emails, and chats remain scrollable inside the inline node window without changing critical-path row ordering.
P9 - Node editor mutations made inside the inline node window follow the existing node editor update, attachment, chat, highlight, and intent behavior.
P10 - Opening the selected node in the standalone node popup remains available from the inline node window.
P11 - A fresh Project work-panel entry, or a history entry without a valid marker for that exact Project, opens with Logic Gates / Nodes selected in the left toggle position; Critical Path is the right toggle.
P12 - Empty critical-path resource cells use an Add node action, not a drag/drop node-or-logic-gate prompt.
P13 - Add node opens a Company Explorer node search picker that uses Company Explorer search results and visibility rules.
P14 - Selecting a node search result creates or reuses the project node relationship and saves that relationship onto the critical-path step.
P15 - Project text boxes participate in the unified editor contract: changes to indent/outdent, paste cleanup, Delete/Backspace, copy/cut/paste, lists, checklist, hyperlink, font-size, bold, underline, italic, text highlight/No highlight, left/center/right alignment, and table semantics must apply to project text boxes.
P16 - Project text-box document bodies, title, email accent/reference metadata, display order, revisions, and timestamps live in `project_textboxes`. Attachment metadata is rebuilt from active final attachment relationships; Node documents opened inside Projects remain Node-owned.
P17 - Project critical-path inline node windows use the unified node shell and unified node text-box editor semantics, while mutations inside that inline node window remain node editor mutations instead of project critical-path data mutations.
P18 - The Project email count control expands or collapses the Project-wide email column. Email linking uses the shared Universal picker only; the Project timeline exposes no separate Attach email button or email-plus action and never exposes compose, send, draft-save, or mailbox-mutation behavior.
P19 - Project critical-path inline node windows mount `UnifiedNodeShell`; the inline window may keep project row selection/close state in Project Management, but shell actions and body metadata come from the shared node-shell source.
P20 - Project text-box inline images and files follow `docs/tests/attachments.md`: `attachments` plus `attachment_relationships` are the durable file authority, and the existing Project projection-shaped API response is rebuilt without storing file bytes or a legacy Project projection row.
P21 - Project chat attachments use Mango attachment references, and project critical-path inline node windows inherit node attachment behavior while preserving node-owned persistence for node edits.
P22 - In the Project Logic Gates / Nodes tab, clicking a node row expands that node's Project-owned unified node editor directly below the row. Clicking the same row again collapses it; the row does not open the app/sidebar popup or replace the Project page.
P23 - Nodes opened in the Project Logic Gates / Nodes panel use the unified node shell, unified node text-box editor semantics, node information/projection persistence, attached-email behavior, and separate chat-pane behavior of the standard node editor. Project state owns only which node panel is open; it does not own node content persistence.
P24 - A Node related to a Project may be floating with no Logic Gate. If it has a current Logic Gate, adding it to the Project also creates or reuses that Project/Logic-Gate relationship.
P25 - Dropping a My Triage or mailbox-capable Shared Triage email onto a Logic Gate group inside a project creates an email-derived node/card in that Logic Gate and a node relationship in the project.
P26 - Project relationship node rows created from email expose `created_from_email = true` and show an email-origin icon.
P27 - Successful project email drops dispatch the same Home triage conversion reconciliation event as Kanban and Company Explorer drops, including `shared_inbox_id` and `unstarred_message_ids` when present.
P28 - Successful project email drops open the created node in the normal node popup.
P29 - The Project timeline has one compact control row in this exact left-to-right order: new-textbox plus, permanent-document toggle, email count toggle, attachment count, and Universal picker. It has no Node-only Logic Gate control, email-plus control, text-labeled `New Text Box`, project-only `Indent` or `A1` action, or per-textbox table control.
P30 - Project text-box toolbar controls must use the shared compact editor toolbar inventory and formatting controller path. Font-size minus/value/plus, Bold, Underline, Italic, Highlight with **No highlight**, left/center/right alignment, table insertion, and the outline-style dropdown must match node, Logic Gate, and mail editor surfaces in selected-range and collapsed-caret behavior. Hover/focus/active styling applies only to the individual control.
P31 - A project permissions view opened from Project Management, Company Explorer, or another project entry point always displays an explicit `Save` button when permission settings are editable. Save commits the current permission selection without closing the view; denied states remain dismissible without attempting a write.
P32 - Project attached-email projections preserve mailbox provenance. Personal picker attachments and email-drop conversion requests carry the active normalized `account_email`; shared-inbox conversion requests carry `shared_inbox_id` and suppress personal identity while the projection retains both the shared inbox and canonical company account email. The project reader uses that exact scope for threads, recipients, attachments, drafts, replies, and the shared calendar event card/details/RSVP operations.
P33 - The Project Logic Gates / Nodes tab renders visible Logic Gates and nodes as one recursive row list, not as a multi-column set of Logic Gate cards with embedded node lists.
P34 - The project relationship grouper supports Logic Gate, Type, Status, Date Added, and Email Origin levels. Levels can be added, removed, reordered, and sorted ascending or descending; an explicitly empty stack is valid and renders all visible relationships as flat rows. The default is Logic Gate ascending. Status grouping follows the shared universal order in P40. This project-local control stores one browser preference per company/current user and applies it across that user's projects; it is not a named Updates Key View.
P35 - Group headers and resource rows indent by grouping depth. Disclosure toggles expansion without opening a resource; a visible Logic Gate grouping header remains the Logic Gate open/context-menu/drop target, suppresses its duplicate Logic Gate leaf, and remains visible when the gate has no nodes.
P36 - Regrouping and collapsing are presentation-only: they do not mutate project relationships, every accessible node remains available when its branch is visible, and Shift/Ctrl/Command selection order follows the currently rendered visible node rows. A node whose Logic Gate relationship is not visible groups under No logic gate instead of exposing the hidden gate ID.
P37 - The grouped-row view preserves the local node-panel and Logic Gate openers, node selection and context menus, critical-step/status/email-origin indicators, root project drops, and Logic Gate-targeted node/email drops.
P38 - The Project Logic Gates / Nodes node editor normally remains inline in the relationship list and preserves the Project grouping and collapse state. It exposes the standard node-window actions: close/collapse, fullscreen/restore, minimize to the app dock, open in a new browser tab, pin, and Move to Recycle Bin through the existing typed confirmation. Fullscreen temporarily uses the shared modal portal and returns to the same inline row when restored.
P39 - Opening a Logic Gate from the Project detail work panel records the exact canonical Project route, `/projects/{project_id}`, and the current Project work-panel tab on that return history entry before pushing `/logic-gates/{logic_gate_id}`. Changing the toggle updates that entry, so Browser Back and an unmodified Backspace pressed outside editable content return to that exact Project with its latest Critical Path or Logic Gates / Nodes selection. The marker is accepted only for its matching Project and does not change the fresh-entry default in P11; Backspace inside an input, textarea, select, or content-editable node retains native editing behavior.
P40 - Status grouping is shared by Updates and Project Logic Gates / Nodes. Ascending recognized workflow order is In Progress, Review, Pending, Requested, Backlog, Done. `Verify`, `Verification`, and `Verified` normalize to Review; Request/Requests normalize to Requested; Backlogs/Back Logs/Backlogged normalize to Backlog; completed/closed/archived aliases normalize to Done. Descending reverses the nonterminal recognized groups, while Done remains the final group in both directions. Unknown nonblank statuses sort after recognized nonterminal statuses; No status has a collision-proof group identity, is trailing, and remains before Done.
P41 - Every Project text box has an independent exact collaboration scope, revision stream, snapshot, and durable operation queue. Normal document typing sends HTML-patch micro-batches only; title/attachment changes use the metadata PATCH and cannot overwrite the collaboration body.
P42 - Project reload/reconnect subscribes first, buffers committed events, validates the canonical snapshot/ETag, applies above-snapshot revisions in order, and reapplies durable pending operations. Tombstone is terminal and a late operation cannot recreate the text box.
P43 - Remote Project text-box operations apply live to the exact mounted document without echo-saving or a focus-time whole-document conflict. Selection is preserved by the shared hydration boundary; duplicates are ignored and gaps recover automatically through a full snapshot.
P44 - Replies from the Project-wide email column use the Project as attachment resource owner and identify the editor as `project-attached-email-reply`. Focusing that reply clears the outer Project textbox formatting controller.
P45 - The Project editor header keeps Editor, Permissions, the shared formatting toolbar, and Outline Styles/Automatic Numbering in its primary area. Assignments, Open project in new tab, and Minimize project move into one keyboard-operable **More editor actions** menu when those actions are available, without changing their permission, disabled, or navigation behavior.
P46 - Project dialogs and previews mount through the shared body-level overlay portal above Key Views, Explorer, Search Explorer, and feature-local stacking contexts and trap/restore focus when blocking. The Logic Gates / Nodes editor remains in normal document flow beneath its selected row except while its explicit fullscreen action temporarily mounts it in that shared modal layer.
P47 - Expanding a node in Logic Gates / Nodes removes the row-depth indentation from the editor surface so the editor spans the full relationship-panel width while the collapsed relationship row keeps its normal grouping indentation.
P48 - Logic Gates / Nodes uses the exact shared My Triage launcher pair: the compact document-plus control creates a floating Node, and the adjacent `Ready! Open universal linker` control opens the Universal picker locked to `##` link mode with Nodes as its only enabled target. Linking or creating sends the exact Node ID to the typed Project relationship command and never creates a generic edge.

P49 - Project Field, Status, Health, Account, and Team dropdowns commit and close on the selected option. They do not display Apply or Cancel actions; multi-value controls toggle the clicked assignment without discarding other selected IDs, and Not set clears the control.
P50 - When the generic Field list column is enabled for the active company, Project Summary shows a matching **Fields** dropdown immediately left of Status and reads/writes the same project field assignments.
P51 - Every Project chat comment authored by the current user exposes the shared inline Edit action after send. Saving uses the stable `project_textbox_chats.chat_id`, replaces only trimmed text and resolved mention IDs, records an edit timestamp, and preserves author, original creation time, attachments, reply/source-selection context, text-box ownership, and thread order. Project Edit access never permits editing or deleting another author's comment, and generic information POST requests cannot overwrite an existing chat when they disguise the replacement as another information type.
P52 - A Node may have at most one active Logic Gate assignment, but no Logic Gate assignment is required for Project membership.
P53 - A Node may be related to at most one Project. Re-adding it to that same Project reuses its relationship, but attempting to add it to another Project is rejected without changing any existing relationship. The UI explains: **This Node is already in another Project. A Node can belong to only one Project. Remove it from its current Project before adding it here.**
P54 - Adding a Node with a current Logic Gate to a Project implicitly creates or reuses that Project/Logic-Gate relationship; adding a floating Node creates no Logic Gate relationship.
P55 - A Logic Gate may be related to any number of Projects. Relating it to a new Project must never move, overwrite, or delete its relationships with other Projects.
P56 - Each Project/Logic Gate pair has its own stable relationship row and relationship ID. Re-adding another Node from that Logic Gate to the same Project reuses the existing Project/Logic Gate row instead of creating a duplicate.
P57 - Removing a Node relationship does not silently remove the Logic Gate's relationship from that Project. Logic Gate relationships are persistent Project associations, including when no related Node is currently visible in that Project. A rejected cross-Project Node addition changes neither the Node relationship nor either Project's Logic Gate relationships.
P58 - A user may directly associate an existing Logic Gate with a Project only through `##` link mode in that Logic Gate's editor. This creates or reuses a `project_relationships` row for the exact existing Gate/Project pair. It does not create a Logic Gate inside a Project; Project-scoped Logic Gate creation remains prohibited. Adding a Node remains a separate command and brings its current Logic Gate into the Project only when that assignment exists.
P59 - Node-based Project context in Updates and other derived views comes only from that Node's direct Project relationship. A Logic Gate's membership in multiple Projects must never make all Nodes in that Logic Gate appear in every one of those Projects.
P68 - Direct existing Logic Gate association requires Edit access to the source Logic Gate editor, Edit access to the target Project, and current visibility of the exact Logic Gate target in the Project relationship command. Failure creates no relationship or reference chip.
P69 - Re-adding the same existing Logic Gate to the same Project is idempotent and retains the stable relationship ID. Direct association returns no implicit Node relationship and never moves, copies, renames, or changes the Logic Gate's other Project relationships.
P60 - Production PostgreSQL realtime audience resolution treats a Project as a supported exact editor resource. Each Project editor publication resolves only current effective Edit recipients for that Project, so authorized remote text-box changes stream promptly without refresh and revoked, missing, or cross-company targets receive nothing.

P61 - The Project view and projection-list API keep their current public payload shape, but every textbox row is synthesized from `project_textboxes`, every chat row from `project_textbox_chats`, and every attached-email row from exact `email_relationships` joined to `email_messages` and `email_threads`.
P62 - A Project owns its Project-wide email relationships; a Project textbox owns only its exact-message textbox relationship and chats. Deleting a textbox removes those textbox-owned rows without removing the Project-wide thread or normalized email content.
P63 - New Project attached-email writes require the exact internal `email_message_id` and current mailbox access. A blank textbox ID with thread scope links every stored message in that thread to the Project; a textbox ID links only the exact message.
P71 - One exact email message may link to at most one textbox in a Project. A highlighted unlinked message defaults to Create New Textbox; clicking an existing Project textbox highlights its frame, changes the destination to Existing Project · Existing Text Box, and the first send atomically creates the exact textbox relationship and chat.
P72 - Every floating Node row and every Node row with a visible current Logic Gate in Logic Gates / Nodes is draggable. Dropping it on another visible Logic Gate in that Project assigns the floating Node or moves the assigned Node through the canonical Logic Gate assignment command; a Node whose current Logic Gate is hidden is not draggable, and no move changes the Node's Project, email, attachment, or other relationships.
P64 - Project textbox titles and supported email display metadata are copied once into `project_textboxes` before backend deployment. Attachment arrays are not copied into another metadata column; they are rebuilt from active final relationships.
P65 - Project resource and chat deletion use the shared attachment unlink and last-owner cleanup lifecycle. A shared file survives while another active relationship exists.
P66 - The deployment must refuse readiness when `project_textbox_chats` or the final Project textbox metadata columns are missing. No request performs DDL and no compatibility reader falls back to the legacy Project tables.
P67 - The first Project textbox metadata save must idempotently create its empty `project_textboxes` row when the document-body request has not created it yet. A later document ensure/save reuses that same stable row and preserves its metadata; this ordering rule never recreates a deleted textbox or writes a legacy Project table.
P70 - Project exit history is action-triggered, not timer-triggered. After a history-visible textbox body, title, attachment, creation, deletion, or restore change, closing or switching the Project, changing routes, using Back/Forward, or browser `pagehide` flushes that exact Project's bodies and metadata and requests the same final history batch as manual Save. An unchanged Project creates no exit batch, repeated close signals share one in-flight save, no Project scan runs, and refresh/external navigation/tab close remain best effort.
P73 - Each Project has one permanent rich-text document whose exact `project_textboxes.textbox_id` equals that Project's canonical `project_id`. First opening lazily creates or reuses that row through the existing Project editor metadata and document paths; the row is excluded from the timeline and uses the shared Project editor, formatting toolbar, history, attachment, recycle, and permission lifecycle without another storage or compatibility path.
P74 - The permanent Project document may appear inline or in the shared fullscreen overlay, but presentation changes never create a second document or editor. Exactly one editor instance owns the current document, selection, formatting controller, save state, and recovery state, and restoring inline returns that same instance to the Project pane.
P75 - Saved-version restore never deletes or remaps the permanent Project document. A snapshot without the document clears its body in place, a snapshot with the document restores its saved title and body to `textbox_id = project_id`, and a deleted canonical row fails restore instead of creating a replacement timeline textbox. Current attachment relationships remain independent of this document-body restore.

## Scenarios

### Scenario P-S1: Inline Critical-Path Node Window

Business logic covered:
- P1
- P2
- P3
- P4
- P5
- P8
- P10
- P11

Given:
- A project critical path contains two rows linked to nodes the viewer can view.
- Each node has text boxes, attached emails, and text-block chats.

Expected:
- The project work panel defaults to the Critical Path tab and shows that tab before Logic Gates / Nodes.
- Clicking the first node-backed critical-path row reveals an inline node window from that row.
- The inline node window renders the node's text boxes, attached emails, and chats through the shared node editor workspace.
- The user can scroll through multiple text boxes, emails, and chats inside that window.
- Clicking the second node-backed row replaces the first node window with the second node window.
- Closing the window does not mutate the critical-path row.
- The user can still open the selected node in the standalone node popup.

### Scenario P-S2: Critical-Path Node Access Boundaries

Business logic covered:
- P6
- P7

Given:
- A project critical path contains a node-backed row, a logic-gate-backed row, and a node that the viewer cannot view.
- The viewer can view the project.

Expected:
- The logic-gate-backed row keeps logic-gate behavior and does not render the inline node editor window.
- Inaccessible nodes are not exposed through the inline window.
- If node access is lost after selection, the inline node window closes or shows the existing node editor access-denied state.

### Scenario P-S3: Shared Node Editor Behavior

Business logic covered:
- P2
- P3
- P8
- P9
- P17
- P19

Given:
- A node selected from the project critical path has editor content, email attachments, highlighted email references, chat messages, checkboxes, bullets, and intents.

Expected:
- The inline node window uses the same editor projections as the standalone node popup.
- The inline node window uses the unified node shell and unified node text-box editor semantics.
- Email attachment, email highlight, chat creation, text editing, checkbox, bullet, and intent updates follow the existing node editor rules.
- Updates made in the inline node window persist as node editor updates, not project critical-path updates.
- The inline node window exposes shared shell close/open actions without changing the critical-path row data.

### Scenario P-S4: Add Node From Critical Path

Business logic covered:
- P12
- P13
- P14

Given:
- A project critical-path row does not have a linked node.
- The viewer can edit the project and can view nodes returned by Company Explorer search.

Expected:
- The empty node cell shows Add node.
- Clicking Add node opens a node picker with the shared Company Explorer search input.
- Search results are limited to visible node results from the Company Explorer search path.
- Selecting a result creates or reuses the project relationship for that node and saves the relationship on the critical-path step.
- The empty cell no longer advertises dropping a node or logic gate.

### Scenario P-S5: Project Editors And Email Picker Boundary

Business logic covered:
- P15
- P16
- P18
- P29
- P30
- P45
- P73
- P74
- P75

Given:
- A user edits a project text box.
- The user opens the header Universal picker from the compact Project timeline control row.
- The user opens the permanent Project document and switches it to full screen.

Expected:
- The project text box uses the same unified editor semantics as node, Logic Gate, and email compose/reply rich editor surfaces.
- The project text-box toolbar exposes shared font-size, Bold, Underline, Italic, Highlight/**No highlight**, left/center/right alignment, table insertion, Automatic Numbering, bullet, checklist, and outline-style controls.
- Those toolbar controls come from the shared compact editor toolbar inventory and route through the shared formatting controller for selected text and collapsed-caret typing; hover/focus/active styling applies only to the individual control.
- Applying a highlight color changes selected text or the active collapsed-caret typing style. **No highlight** removes selected highlighting or clears the pending highlight typing style.
- Highlighting one line/list item does not mark the following sibling, while intentional multi-line selections remain supported.
- Alignment operates on the active paragraph/selected block or active-table context, and table insertion uses the preserved caret/selection.
- Creating a project text box uses the compact plus control in the top timeline control row; project-only `Indent`, `A1`, text-labeled `New Text Box`, and duplicate text-box table controls are not part of the target UI.
- The primary header keeps Editor, Permissions, the shared formatting toolbar, and Outline Styles/Automatic Numbering visible; Assignments and available open/minimize actions remain in **More editor actions**.
- Project text-box and permanent-document edits save through the Project editor path to `project_textboxes`; Project projections are rebuilt from that final storage.
- Project text-box and permanent-document edits never write Node-owned editor storage.
- The Universal picker Emails category allows attaching an exact existing personal-mailbox message where permitted.
- The Emails category does not expose compose, reply, send, scheduled send, draft-save, or mailbox-mutation controls.
- The permanent Project document stays outside the timeline and keeps the same editor instance when it enters or exits full screen.
- Saved-version restore clears or updates the permanent document title/body at `textbox_id = project_id`, preserves its current final attachment relationships, and never deletes or remaps it.
- Focusing the permanent Project document routes the shared Project formatting toolbar to that document.

### Scenario P-S6: Project Attachments Use Global Attachment Storage

Business logic covered:
- P3
- P9
- P16
- P17
- P20
- P21

Given:
- A user pastes or drops images into a project text box.
- A user attaches files to a project text block or project chat.
- A user opens a project critical-path inline node window and adds node text-box images or node attachments.

Expected:
- Project text-box and project text-block attachment data stores Mango attachment references.
- Project information/projection payloads do not store durable data URLs or base64 file bytes.
- Project chats store attachment references while remaining chat UI.
- The inline node window uses node attachment behavior and node-owned persistence, not project-owned attachment logic for node edits.

### Scenario P-S7: Logic Gates / Nodes Node Opener

Business logic covered:
- P22
- P23
- P38
- P46
- P47
- P48

Given:
- A project has at least one related Logic Gate and at least one related node visible in the Logic Gates / Nodes tab.
- The viewer can open the node.

Expected:
- Clicking the node row expands that node's editor immediately below the row and leaves the Project page in place; clicking the row again collapses it.
- The expanded node editor fills the relationship-panel width without inheriting the collapsed row's group-depth indentation.
- **Add** opens an elevated Company Explorer search limited to Nodes and Logic Gates. Selecting an available result attaches it to the Project, selecting a Logic Gate includes its known child nodes, and an already-related result remains marked and disabled.
- The embedded node panel uses the shared node shell actions and shared node workspace body instead of a project-specific node shell.
- Text boxes inside that window use the unified node editor semantics.
- Node edits save through node information/projection persistence, not project information/projection or project relationship persistence.
- Chat panes inside the opened node window remain chat surfaces and do not inherit unified rich-editor toolbar or keyboard semantics.
- The inline editor remains in the relationship list flow, keeps grouping and selection state intact, and does not mount a fullscreen overlay.

### Scenario P-S8: Email Drop Creates Project Node

Business logic covered:
- P24
- P25
- P26
- P27
- P28
- P32

Given:
- A user has an email row from My Triage or a mailbox-capable Shared Triage inbox.
- A project detail surface is open in another Chrome window or tab for the same account.
- The project may have zero or more related Logic Gates.

Expected:
- Dropping the email on the project relationship panel requires the user to resolve a destination Logic Gate; it never creates a standalone Project Node.
- Dropping the email on a Logic Gate group inside the project creates the node/card in that Logic Gate, relates the created Node to the Project, and creates or reuses that Project's relationship with the Logic Gate.
- Created project relationship rows for email-derived nodes expose `created_from_email = true` and show the email-origin icon.
- A personal email drop stores `account_email` in the created attached-email projection; a Shared Triage drop stores both `shared_inbox_id` and `account_email`.
- The source Home mail row is reconciled through the local conversion event, including shared inbox scope and unstarred IDs when present.
- The created node opens in the standard node popup after the drop succeeds.

### Scenario P-S9: Project Permissions Save

Business logic covered:
- P31

Given:
- A manager or administrator opens permissions for the same project from Project Management and from Company Explorer.
- A second viewer can open the project but cannot edit its permission settings.

Expected:
- Every editable project permissions view displays an explicit `Save` button.
- Choosing users, groups, default access, or descendant behavior does not remove or hide the Save action.
- Clicking Save commits the current selection, reports completion through the shared permissions dialog behavior, and leaves the view open.
- The no-access or denied state remains dismissible and does not issue a permission update.

### Scenario P-S10: Project Attached-Email Scope And Viewer

Business logic covered:
- P18
- P23
- P27
- P32
- P44

Given:
- A personal mailbox message is attached through the Project Universal picker Emails category.
- A shared-inbox message is converted into project work and later reopened from its attached-email row.
- The user focuses the attached-email reply editor and adds a file or inline image.

Expected:
- The personal attachment records the active account email and the shared conversion records both shared-inbox ID and account email.
- Reopening either message uses the same stored-thread disclosure, recipient, received-attachment, and invitation-response contract as My Triage, Shared Triage, and Nodes. The retained Project surface may expose Reply, Reply All, and owner drafts; the Node surface exposes draftless Reply only.
- Shared attachment reads and actions retain shared-inbox authorization and do not silently fall back to a personal grant.
- The reply links files and inline images to the project resource with the originating project text-block information ID and the `project-attached-email-reply` editor surface.
- Focusing the reply immediately clears the outer project text-block formatting controller, leaving the reply toolbar as the only formatting owner.

### Scenario P-S11: Universal Grouped Project Relationships

Business logic covered:
- P33
- P34
- P35
- P36
- P37
- P40

Given:
- A project has related Logic Gates, including an empty Logic Gate, assigned nodes with different statuses and origins, and a standalone node.
- The viewer can access those relationships.

Expected:
- Logic Gates and nodes render in an indented row tree rather than Logic Gate cards.
- The default Logic Gate grouping shows each visible Logic Gate once as a group/resource row, retains the empty Logic Gate, and places the standalone node under No logic gate.
- Reordering or changing grouping levels changes only the nesting and row order; removing every level produces a flat relationship list.
- Collapsing a group hides only its descendants and updates Shift-selection order to the remaining visible node rows.
- Node row click-to-expand/collapse, context-menu, root-drop, and Logic Gate-drop behavior remains available on the corresponding rows.
- Status ascending renders In Progress, Review, Pending, Requested, Backlog, then Done; legacy Verify and Backlogged values join Review and Backlog rather than creating duplicate groups.
- Status descending reverses the nonterminal recognized statuses but keeps Done at the bottom.

### Scenario P-S12: Logic Gate History Returns To Project

Business logic covered:
- P39

Given:
- A user is viewing a specific Project and double-clicks one of its related Logic Gates.
- The user later uses browser Back or presses unmodified Backspace outside editable content.

Expected:
- Opening the Logic Gate first canonicalizes the return entry to `/projects/{project_id}`, then pushes `/logic-gates/{logic_gate_id}`.
- The canonical return entry records the exact Project and the Project work-panel tab from which the Logic Gate was opened.
- Browser Back returns to the exact Project and restores Logic Gates / Nodes when that was the originating tab, instead of resetting to Critical Path.
- Changing the toggle after returning updates that Project history entry, so a later history return does not restore a stale earlier selection.
- A fresh Project entry or a marker belonging to another Project opens on Logic Gates / Nodes.
- Unmodified Backspace outside editable content performs the same history-back action.
- Backspace inside editable content edits text and never triggers Project navigation.

### Scenario P-S13: Project Text-Block Collaboration And Recovery

Business logic covered:
- P16
- P41
- P42
- P43
- P60

Given:
- Two authorized users or tabs edit one exact Project text box while another Project text box and unrelated scopes are mounted.
- One browser disconnects with a durable local operation, then reconnects while remote operations have committed.
- The user also changes title/attachment metadata and later deletes the text box.

Expected:
- Each real document mutation becomes a bounded HTML patch; title/attachment metadata uses a separate body-free PATCH and cannot overwrite document content.
- Both exact subscribers converge through server-ordered revisions without refresh or echo-saving, while the other text box and unrelated scopes receive nothing.
- PostgreSQL resolves the Project as the exact publication resource and rechecks each candidate's current effective Edit access instead of rejecting or retrying the event as an unsupported resource type.
- Reconnect subscribes first, loads the full canonical snapshot/ETag, orders buffered events, reapplies/resubmits stable pending operations, and returns green only after acknowledgement.
- Duplicate operation/event delivery is harmless; a gap requests a full snapshot rather than showing a merge conflict.
- Delete commits an exact tombstone after the intended local flush, unsubscribes the terminal document, and a late operation cannot recreate it.

### Scenario P-S14: Immediate Metadata Dropdowns And Fields Header

Business logic covered:
- P49
- P50

Given:
- The active company has enabled the generic Field column.
- A user opens a project row metadata dropdown or the matching Project Summary header control.

Expected:
- Clicking a Field, Status, Health, Account, or Team option immediately saves and closes the dropdown.
- Multi-value controls preserve existing choices except for the one assignment being toggled.
- Choosing Not set clears that control, with no Apply or Cancel footer.
- Project Summary shows **Fields** immediately left of Status and reflects the same assignments shown in the list row.

### Scenario P-S15: Author-Only Project Comment Editing

Business logic covered:
- P51

Given:
- Project chat contains comments sent by the current user and another user who also has Project Edit access.

When:
- The current user edits their own comment and attempts to edit, delete, or POST-overwrite the other comment.

Expected:
- Edit appears only on comments authored by the current user.
- A successful PATCH keeps the stable comment envelope and thread position, updates text/mentions, and shows Edited.
- Cross-author edit/delete attempts are forbidden, and a disguised legacy POST overwrite returns conflict.
- A failed save restores the canonical row while retaining the inline draft for retry.

Focused coverage lives in `backend/internal/http/chat_comment_edit_test.go` and `tests/frontend/modules/editor/editorTextBlockChatNavigation.test.tsx`.

### Scenario P-S16: Node And Logic Gate Project Cardinality

Business logic covered:
- P52
- P53
- P54
- P55
- P56
- P57
- P68
- P69
- P58
- P59

Given:
- One Logic Gate contains Node A and Node B.
- Project Alpha receives Node A and Project Bravo receives Node B.
- The user directly associates the existing Logic Gate with Project Alpha from the Logic Gate editor, then repeats the same command.

When:
- A user attempts to add Node A to Project Bravo while it still belongs to Project Alpha.
- Either Node is re-added to its current Project.

Expected:
- Node A and Node B each retain exactly one active Logic Gate assignment.
- Project Alpha and Project Bravo have distinct persistent relationship rows for the same Logic Gate.
- Adding the Logic Gate to Project Bravo never moves or deletes its Project Alpha relationship.
- The attempt to add Node A to Project Bravo is rejected with a clear one-Project-per-Node message and no relationship is moved, added, or deleted.
- Node A and its stable relationship remain in Project Alpha; Project Bravo still contains only Node B and its relationship to the shared Logic Gate.
- Re-adding a Node to its current Project reuses the existing Node and Logic Gate relationship rows and creates no duplicates.
- Updates keeps Node A only under Project Alpha; it does not infer a Bravo Node relationship merely because the shared Logic Gate is also in Project Bravo.
- Direct existing Logic Gate association succeeds, and repeating it reuses Alpha's stable Gate relationship without adding a Node or changing Bravo.
- Project-scoped Logic Gate creation remains rejected; a Project-scoped floating Node is allowed and creates no Logic Gate assignment.

Focused coverage lives in `backend/internal/store/project_relationship_rules_test.go`, `backend/internal/http/project_handlers_test.go`, `backend/internal/store/project_relationship_schema_test.go`, `backend/internal/store/project_relationship_postgres_integration_test.go`, `backend/internal/store/work_item_reads_test.go`, and `backend/internal/http/notification_handlers_test.go`.
### Scenario P-S17: Final Project Storage Cutover

Business logic covered:
- P16
- P20
- P51
- P61
- P62
- P63
- P64
- P65
- P66
- P67

Given:
- The audited Project chat copy has 16 final chats, the exact six Project email relationships exist, and all 25 active Project textboxes have matching final rows.
- The additive schema migration and guarded textbox-metadata copy have completed while Project writers are paused.

When:
- A user reloads the Project, creates a textbox whose metadata request arrives before its first document-body request, edits its title/body, creates and edits a chat, attaches and removes an email, deletes a textbox, and later deletes a Project that shares one file with another valid owner.

Expected:
- The existing frontend receives the same textbox/chat/email projection-shaped payload and stable IDs.
- All Project runtime SQL uses only `project_textboxes`, `project_textbox_chats`, final email tables, and final attachment tables.
- The metadata-first request creates one empty final textbox row, and the later body request reuses that row without losing its stable ID or title.
- The chat remains bound to its exact textbox; the email relationship uses the exact internal email message identity.
- Textbox deletion removes its chats, textbox-scoped email relationships, and attachment owner links while normalized email content survives.
- Project deletion keeps a shared file under its remaining owner and marks a file for cleanup only after its final relationship disappears.
- Startup refuses an incomplete schema instead of issuing request-time DDL or reading a legacy table.
- A production-source audit finds no Project database reader or writer for `project_information` or `project_projection_table`.
