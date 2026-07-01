Last updated: 2026-07-01

# Projects Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: 0% (rule IDs are not mapped to automated tests yet)

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

Given:
- A project critical path contains two rows linked to nodes the viewer can view.
- Each node has text boxes, attached emails, and text-block chats.

Expected:
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

Given:
- A node selected from the project critical path has editor content, email attachments, highlighted email references, chat messages, checkboxes, bullets, and intents.

Expected:
- The inline node window uses the same editor projections as the standalone node popup.
- Email attachment, email highlight, chat creation, text editing, checkbox, bullet, and intent updates follow the existing node editor rules.
- Updates made in the inline node window persist as node editor updates, not project critical-path updates.
