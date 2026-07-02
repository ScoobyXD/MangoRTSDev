Last updated: 2026-07-02

# Nodes Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Node soft-delete edit gating and recycle-bin owner stamping have backend coverage; Company Explorer search resource-type filtering has backend coverage; GVIC picker rule IDs and the Assign to Logic Gate picker no-preload UI behavior are not mapped to automated tests yet.

## Business Logic

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
N16 - The node editor font-size control applies to highlighted text and, for a collapsed caret, becomes the sticky font size for subsequently typed characters until changed again.
N17 - Node editor bold and underline controls must toggle the selected text or sticky caret formatting and must visually reflect the formatting at the current caret or selection.
N18 - Inserting a table in a node editor must insert the table at the current caret/selection location, not at the top-left or beginning of the editor.
N19 - A node header can show and edit the node's project placement: the project button displays the current project when one is known and otherwise offers project assignment.
N20 - Assigning a node to a project from the node header requires selecting a project and then selecting a Logic Gate within that project; the assignment creates the node/project relationship and moves or assigns the node to the chosen Logic Gate.
N21 - A node with a known project relationship exposes a Go to Project action that opens the related project directly.
N22 - When selected node text is sent to chat as a quote/prefill, the quote preview must expose a cancel action that clears the selected-text prefill without sending a message.

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

Given:
- A user edits a node text body.
- The user pastes styled text copied from another application.
- The user changes font size, bold, underline, outline style, or inserts a table.

Expected:
- Pasted content renders in the node editor's normal font family.
- Pasted inline text does not gain empty rows above or below the copied text.
- New node editor text uses alphanumerical numbering by default, and alphanumerical numbering appears first in the outline dropdown.
- Changing font size while text is highlighted changes that selected text.
- Changing font size with only a caret sets the font size for the next typed characters.
- Bold and underline buttons reflect the caret or selected text state and can be active at the same time.
- Toggling bold or underline affects the selection or the next typed characters when the selection is collapsed.
- Table insertion uses the current caret/selection position.

### Scenario N-S7: Node Project Assignment And Chat Quote Cancel

Business logic covered:
- N19
- N20
- N21
- N22

Given:
- A user has edit access to a node.
- Projects and Logic Gates are available in the company.
- A selected node text snippet is loaded into chat as a quote/prefill.

Expected:
- The node header project button displays the current related project when one is known.
- Assigning a node to a project first asks for the project, then asks for a Logic Gate inside that project.
- Confirming the Logic Gate creates or updates the node/project relationship and assigns the node to the selected Logic Gate.
- Go to Project opens the related project directly.
- The selected-text chat quote includes a cancel action next to the quoted text.
- Canceling the quote clears the prefill and leaves the chat draft otherwise intact.
