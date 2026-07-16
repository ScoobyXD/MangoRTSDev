Last updated: 2026-07-15

# Projects Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial overall. Rich-HTML collaboration, realtime transport, disposable-PostgreSQL, and unified rich-editor suites cover exact Project document identities, bounded HTML patches, durable recovery, metadata/body separation, and mounted Project host wiring. `scripts/run_realtime_production_path_tests.mjs` proves real-browser Project-document isolation through the production HTTP/WebSocket/outbox path; project grouping, route, node-shell, attachment, and unrelated rich-editor behavior retain their focused coverage.

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
P11 - A fresh Project work-panel entry, or a history entry without a valid marker for that exact Project, opens with Critical Path selected before Logic Gates / Nodes.
P12 - Empty critical-path resource cells use an Add node action, not a drag/drop node-or-logic-gate prompt.
P13 - Add node opens a Company Explorer node search picker that uses Company Explorer search results and visibility rules.
P14 - Selecting a node search result creates or reuses the project node relationship and saves that relationship onto the critical-path step.
P15 - Project text boxes participate in the unified editor contract: changes to indent/outdent, paste cleanup, Delete/Backspace, copy/cut/paste, lists, checklist, hyperlink, font-size, bold, underline, italic, text highlight/No highlight, left/center/right alignment, and table semantics must apply to project text boxes.
P16 - Project text-box document bodies commit through their exact Project collaboration documents; title and attachment metadata remain Project-owned, and Node documents opened inside Projects remain Node-owned.
P17 - Project critical-path inline node windows use the unified node shell and unified node text-box editor semantics, while mutations inside that inline node window remain node editor mutations instead of project critical-path data mutations.
P18 - The project email picker is attach/select only and must not expose compose, send, scheduled send, or draft-save behavior.
P19 - Project critical-path inline node windows mount `UnifiedNodeShell`; the inline window may keep project row selection/close state in Project Management, but shell actions and body metadata come from the shared node-shell source.
P20 - Project text-box inline images and project text-block attachment arrays must follow `docs/tests/attachments.md`: durable project information/projection payloads store attachment references, not data URLs, base64 file bytes, or embedded file payloads.
P21 - Project chat attachments use Mango attachment references, and project critical-path inline node windows inherit node attachment behavior while preserving node-owned persistence for node edits.
P22 - In the Project Logic Gates / Nodes tab, double-clicking a node opens a Project-owned node-panel selection in the right-hand Logic Gates / Nodes region. The unified node editor replaces that region in place instead of opening the app/sidebar popup or replacing the Project page.
P23 - Nodes opened in the Project Logic Gates / Nodes panel use the unified node shell, unified node text-box editor semantics, node information/projection persistence, attached-email behavior, and separate chat-pane behavior of the standard node editor. Project state owns only which node panel is open; it does not own node content persistence.
P24 - Dropping a My Triage or mailbox-capable Shared Triage email onto a project relationship panel creates an email-derived standalone node relationship for that project.
P25 - Dropping a My Triage or mailbox-capable Shared Triage email onto a Logic Gate group inside a project creates an email-derived node/card in that Logic Gate and a node relationship in the project.
P26 - Project relationship node rows created from email expose `created_from_email = true` and show an email-origin icon.
P27 - Successful project email drops dispatch the same Home triage conversion reconciliation event as Kanban and Company Explorer drops, including `shared_inbox_id` and `unstarred_message_ids` when present.
P28 - Successful project email drops open the created node in the normal node popup.
P29 - Project text-box creation and formatting controls must match the shared node text-box editor pattern: users add a new text box from a compact plus control in the left timeline gutter, and the toolbar exposes shared font-size, Bold, Underline, Italic, Highlight, left/center/right alignment, table insertion, Automatic Numbering, bullet, checklist, and outline-style controls instead of project-only `Indent`, `A1`, text-labeled `New Text Box`, or per-text-box table controls.
P30 - Project text-box toolbar controls must use the shared compact editor toolbar inventory and formatting controller path. Font-size minus/value/plus, Bold, Underline, Italic, Highlight with **No highlight**, left/center/right alignment, table insertion, and the outline-style dropdown must match node, Logic Gate, and mail editor surfaces in selected-range and collapsed-caret behavior. Hover/focus/active styling applies only to the individual control.
P31 - A project permissions view opened from Project Management, Company Explorer, or another project entry point always displays an explicit `Save` button when permission settings are editable. Save commits the current permission selection without closing the view; denied states remain dismissible without attempting a write.
P32 - Project attached-email projections preserve mailbox provenance. Personal picker attachments and email-drop conversion requests carry the active normalized `account_email`; shared-inbox conversion requests carry `shared_inbox_id` and suppress personal identity while the projection retains both the shared inbox and canonical company account email. The project reader uses that exact scope for threads, recipients, attachments, drafts, replies, and the shared EMAIL103 calendar event card/details/RSVP operations.
P33 - The Project Logic Gates / Nodes tab renders visible Logic Gates and nodes as one recursive row list, not as a multi-column set of Logic Gate cards with embedded node lists.
P34 - The project relationship grouper supports Logic Gate, Type, Status, Date Added, and Email Origin levels. Levels can be added, removed, reordered, and sorted ascending or descending; an explicitly empty stack is valid and renders all visible relationships as flat rows. The compatibility default is Logic Gate ascending. Status grouping follows the shared universal order in P40. This project-local control stores one browser preference per company/current user and applies it across that user's projects; it is not a named My Work/Updates Key View.
P35 - Group headers and resource rows indent by grouping depth. Disclosure toggles expansion without opening a resource; a visible Logic Gate grouping header remains the Logic Gate open/context-menu/drop target, suppresses its duplicate Logic Gate leaf, and remains visible when the gate has no nodes.
P36 - Regrouping and collapsing are presentation-only: they do not mutate project relationships, every accessible node remains available when its branch is visible, and Shift/Ctrl/Command selection order follows the currently rendered visible node rows. A node whose Logic Gate relationship is not visible groups under No logic gate instead of exposing the hidden gate ID.
P37 - The grouped-row view preserves the local node-panel and Logic Gate openers, node selection and context menus, critical-step/status/email-origin indicators, root project drops, and Logic Gate-targeted node/email drops.
P38 - The Project Logic Gates / Nodes node panel exposes the shared fullscreen action. Turning fullscreen on expands the same live node editor across the browser viewport; turning it off restores that editor to the right-hand Logic Gates / Nodes region without resetting the Project grouping stack, collapse state, or selected node.
P39 - Opening a Logic Gate from the Project detail work panel records the exact canonical Project route, `/projects/{project_id}`, and the current Project work-panel tab on that return history entry before pushing `/logic-gates/{logic_gate_id}`. Changing the toggle updates that entry, so Browser Back and an unmodified Backspace pressed outside editable content return to that exact Project with its latest Critical Path or Logic Gates / Nodes selection. The marker is accepted only for its matching Project and does not change the fresh-entry default in P11; Backspace inside an input, textarea, select, or content-editable node retains native editing behavior.
P40 - Status grouping is shared by Updates, My Work, and Project Logic Gates / Nodes. Ascending recognized workflow order is In Progress, Review, Pending, Requested, Backlog, Done. `Verify`, `Verification`, and `Verified` normalize to Review; Request/Requests normalize to Requested; Backlogs/Back Logs/Backlogged normalize to Backlog; completed/closed/archived aliases normalize to Done. Descending reverses the nonterminal recognized groups, while Done remains the final group in both directions. Unknown nonblank statuses sort after recognized nonterminal statuses; No status has a collision-proof group identity, is trailing, and remains before Done.
P41 - Every Project text box has an independent exact collaboration scope, revision stream, snapshot, and durable operation queue. Normal document typing sends HTML-patch micro-batches only; title/attachment changes use the metadata PATCH and cannot overwrite the collaboration body.
P42 - Project reload/reconnect subscribes first, buffers committed events, validates the canonical snapshot/ETag, applies above-snapshot revisions in order, and reapplies durable pending operations. Tombstone is terminal and a late operation cannot recreate the text box.
P43 - Remote Project text-box operations apply live to the exact mounted document without echo-saving or a focus-time whole-document conflict. Selection is preserved by the shared hydration boundary; duplicates are ignored and gaps recover automatically through a full snapshot.
P44 - Replies to email attached to a project text block use the project as attachment resource owner, retain the originating project information ID, and identify the editor as `project-attached-email-reply`. Focusing that reply clears the outer project text-block formatting controller so only the reply toolbar can format text.
P45 - The Project editor header keeps Editor, Permissions, the shared formatting toolbar, and Outline Styles/Automatic Numbering in its primary area. Assignments, Open project in new tab, and Minimize project move into one keyboard-operable **More editor actions** menu when those actions are available, without changing their permission, disabled, or navigation behavior.
P46 - Project dialogs/previews and the Logic Gates / Nodes embedded node panel mount through the shared body-level overlay portal above Key Views, Explorer, Search Explorer, and feature-local stacking contexts. Blocking dialogs/previews trap and restore focus; the embedded panel remains modeless while anchored and becomes a focus-trapping modal in fullscreen. Moving it into or out of fullscreen preserves its live editor and Project grouping/selection state.

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

### Scenario P-S5: Project Text Boxes And Email Picker Boundary

Business logic covered:
- P15
- P16
- P18
- P29
- P30
- P45

Given:
- A user edits a project text box.
- The user opens the project email picker.

Expected:
- The project text box uses the same unified editor semantics as node, Logic Gate, and email compose/reply rich editor surfaces.
- The project text-box toolbar exposes shared font-size, Bold, Underline, Italic, Highlight/**No highlight**, left/center/right alignment, table insertion, Automatic Numbering, bullet, checklist, and outline-style controls.
- Those toolbar controls come from the shared compact editor toolbar inventory and route through the shared formatting controller for selected text and collapsed-caret typing; hover/focus/active styling applies only to the individual control.
- Applying a highlight color changes selected text or the active collapsed-caret typing style. **No highlight** removes selected highlighting or clears the pending highlight typing style.
- Highlighting one line/list item does not mark the following sibling, while intentional multi-line selections remain supported.
- Alignment operates on the active paragraph/selected block or active-table context, and table insertion uses the preserved caret/selection.
- Creating a project text box uses the compact plus control in the left timeline gutter; project-only `Indent`, `A1`, text-labeled `New Text Box`, and duplicate text-box table controls are not part of the target UI.
- The primary header keeps Editor, Permissions, the shared formatting toolbar, and Outline Styles/Automatic Numbering visible; Assignments and available open/minimize actions remain in **More editor actions**.
- Project text-box edits save to project information/projection state.
- Project text-box edits do not write node information/projection state.
- The project email picker allows attaching existing email where permitted.
- The project email picker does not expose compose, send, scheduled send, or draft-save controls.

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

Given:
- A project has at least one related Logic Gate and at least one related node visible in the Logic Gates / Nodes tab.
- The viewer can open the node.

Expected:
- Double-clicking the node row replaces the right-hand Logic Gates / Nodes region with that node's editor and leaves the Project page in place.
- The embedded node panel uses the shared node shell actions and shared node workspace body instead of a project-specific node shell.
- Text boxes inside that window use the unified node editor semantics.
- Node edits save through node information/projection persistence, not project information/projection or project relationship persistence.
- Chat panes inside the opened node window remain chat surfaces and do not inherit unified rich-editor toolbar or keyboard semantics.
- The panel mounts in the shared body-level modal layer above Key Views/Explorer/Search Explorer. Activating fullscreen changes that same live panel to viewport geometry; activating it again restores the panel to the right-hand Project region without remounting the editor or resetting grouping/selection state.

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
- Dropping the email on the project relationship panel creates a node relationship in the project without requiring a Logic Gate.
- Dropping the email on a Logic Gate group inside the project creates the node/card in that Logic Gate and relates the created node to the project.
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
- A personal mailbox message is attached through the project picker.
- A shared-inbox message is converted into project work and later reopened from its attached-email row.
- The user focuses the attached-email reply editor and adds a file or inline image.

Expected:
- The personal attachment records the active account email and the shared conversion records both shared-inbox ID and account email.
- Reopening either message uses the same thread viewer contract as My Triage, Shared Triage, and nodes, including recipients, attachments, Reply/Reply All, drafts, and invitation responses.
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
- Double-click, context-menu, root-drop, and Logic Gate-drop behavior remains available on the corresponding rows.
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
- A fresh Project entry or a marker belonging to another Project still opens on Critical Path.
- Unmodified Backspace outside editable content performs the same history-back action.
- Backspace inside editable content edits text and never triggers Project navigation.

### Scenario P-S13: Project Text-Block Collaboration And Recovery

Business logic covered:
- P16
- P41
- P42
- P43

Given:
- Two authorized users or tabs edit one exact Project text box while another Project text box and unrelated scopes are mounted.
- One browser disconnects with a durable local operation, then reconnects while remote operations have committed.
- The user also changes title/attachment metadata and later deletes the text box.

Expected:
- Each real document mutation becomes a bounded HTML patch; title/attachment metadata uses a separate body-free PATCH and cannot overwrite document content.
- Both exact subscribers converge through server-ordered revisions without refresh or echo-saving, while the other text box and unrelated scopes receive nothing.
- Reconnect subscribes first, loads the full canonical snapshot/ETag, orders buffered events, reapplies/resubmits stable pending operations, and returns green only after acknowledgement.
- Duplicate operation/event delivery is harmless; a gap requests a full snapshot rather than showing a merge conflict.
- Delete commits an exact tombstone after the intended local flush, unsubscribes the terminal document, and a late operation cannot recreate it.
