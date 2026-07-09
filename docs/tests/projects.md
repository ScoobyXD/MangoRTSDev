Last updated: 2026-07-09

# Projects Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (`tests/frontend/modules/editor/unifiedRichEditorContract.test.ts` covers the unified editor surface contract, EmailPickerModal attach-only boundary, and Project critical-path inline node shell adapter mounting; project-specific persistence rule IDs are not fully mapped to automated tests yet)

## Business Logic

P1 - A project critical-path row linked to a node can open an inline node window from that row.
P2 - The inline node window uses the same node editor projection model as the standalone node popup.
P3 - The inline node window shows node text boxes, attached emails, and text-block chats in the same three-column workspace used by the node editor.
P4 - Selecting a different node-backed critical-path row replaces the inline node window with the newly selected node.
P5 - Closing the inline node window returns the critical-path table to its normal row-only view without changing the critical-path data.
P6 - Logic-gate critical-path rows do not render the node editor window.
P7 - Project view access alone does not reveal node editor content; the selected node must still pass node-level view access.
P8 - Multiple node text boxes, emails, and chats remain scrollable inside the inline node window without changing critical-path row ordering.
P9 - Node editor mutations made inside the inline node window follow the existing node editor update, attachment, chat, highlight, and intent behavior.
P10 - Opening the selected node in the standalone node popup remains available from the inline node window.
P11 - The project work panel opens with Critical Path selected before Logic Gates / Nodes.
P12 - Empty critical-path resource cells use an Add node action, not a drag/drop node-or-logic-gate prompt.
P13 - Add node opens a Company Explorer node search picker that uses Company Explorer search results and visibility rules.
P14 - Selecting a node search result creates or reuses the project node relationship and saves that relationship onto the critical-path step.
P15 - Project text boxes participate in the unified editor contract: changes to indent/outdent, paste cleanup, Delete/Backspace, copy/cut/paste, lists, checklist, hyperlink, font-size, bold, underline, and table semantics must apply to project text boxes.
P16 - Project text-box persistence remains project-owned: project text boxes save to project information/projection state, not node information/projection state.
P17 - Project critical-path inline node windows use the unified node shell and unified node text-box editor semantics, while mutations inside that inline node window remain node editor mutations instead of project critical-path data mutations.
P18 - The project email picker is attach/select only and must not expose compose, send, scheduled send, or draft-save behavior.
P19 - Project critical-path inline node windows mount `UnifiedNodeShell`; the inline window may keep project row selection/close state in Project Management, but shell actions and body metadata come from the shared node-shell source.
P20 - Project text-box inline images and project text-block attachment arrays must follow `docs/tests/attachments.md`: durable project information/projection payloads store attachment references, not data URLs, base64 file bytes, or embedded file payloads.
P21 - Project chat attachments use Mango attachment references, and project critical-path inline node windows inherit node attachment behavior while preserving node-owned persistence for node edits.
P22 - In the Project Logic Gates / Nodes tab, double-clicking a node opens the standard full node editor window for that node instead of a project-specific editor surface.
P23 - Nodes opened from the Project Logic Gates / Nodes tab use the unified node shell, unified node text-box editor semantics, node information/projection persistence, attached-email behavior, and separate chat-pane behavior of the standard node editor.
P24 - Dropping a My Triage or mailbox-capable Shared Triage email onto a project relationship panel creates an email-derived standalone node relationship for that project.
P25 - Dropping a My Triage or mailbox-capable Shared Triage email onto a Logic Gate group inside a project creates an email-derived node/card in that Logic Gate and a node relationship in the project.
P26 - Project relationship node rows created from email expose `created_from_email = true` and show an email-origin icon.
P27 - Successful project email drops dispatch the same Home triage conversion reconciliation event as Kanban and Company Explorer drops, including `shared_inbox_id` and `unstarred_message_ids` when present.
P28 - Successful project email drops open the created node in the normal node popup.

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

Given:
- A user edits a project text box.
- The user opens the project email picker.

Expected:
- The project text box uses the same unified editor semantics as node, Logic Gate, and email compose/reply rich editor surfaces.
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

Given:
- A project has at least one related Logic Gate and at least one related node visible in the Logic Gates / Nodes tab.
- The viewer can open the node.

Expected:
- Double-clicking the node row opens the standard full node editor window for that node.
- The opened node window uses the shared node shell actions and shared node workspace body instead of a project-specific node shell.
- Text boxes inside that window use the unified node editor semantics.
- Node edits save through node information/projection persistence, not project information/projection or project relationship persistence.
- Chat panes inside the opened node window remain chat surfaces and do not inherit unified rich-editor toolbar or keyboard semantics.

### Scenario P-S8: Email Drop Creates Project Node

Business logic covered:
- P24
- P25
- P26
- P27
- P28

Given:
- A user has an email row from My Triage or a mailbox-capable Shared Triage inbox.
- A project detail surface is open in another Chrome window or tab for the same account.
- The project may have zero or more related Logic Gates.

Expected:
- Dropping the email on the project relationship panel creates a node relationship in the project without requiring a Logic Gate.
- Dropping the email on a Logic Gate group inside the project creates the node/card in that Logic Gate and relates the created node to the project.
- Created project relationship rows for email-derived nodes expose `created_from_email = true` and show the email-origin icon.
- The source Home mail row is reconciled through the local conversion event, including shared inbox scope and unstarred IDs when present.
- The created node opens in the standard node popup after the drop succeeds.
