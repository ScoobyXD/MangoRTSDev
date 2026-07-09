Last updated: 2026-07-09

# Nodes Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial. Node soft-delete edit gating and recycle-bin owner stamping have backend coverage; Company Explorer search resource-type filtering has backend coverage; node editor projection-save helpers have frontend coverage; the unified editor contract, EmailPickerModal attach-only boundary, and unified node-shell contract/adapter mounting are covered by `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts`; GVIC picker rule IDs and the Assign to Logic Gate picker no-preload UI behavior are not mapped to automated tests yet.

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
N23 - Live node editor typing writes the current text-block state to the node editor projection table and must not append a full rich-text document row to `node_information` on every keystroke autosave.
N24 - Node Save Settings lists saved editor versions sorted by saved timestamp, including save kind, saving user, save time, and saved text box count; automatic saved-version creation is disabled during the emergency slowness fix.
N25 - Clicking Save in the node editor flushes pending projection saves first, then creates a manual saved editor version in `node_information`.
N26 - Node automatic saved-version creation must not run in the background during the emergency slowness fix. If auto saved versions are re-enabled later, they must only consider active nodes, must only save nodes whose editor projection has changed, and must never scan or save every node in the system.
N27 - Restoring a node saved version requires confirmation and overwrites the current node editor projection rows from that saved version without creating another saved-version row.
N28 - Node editor text-block projection saves must use one-save-at-a-time latest-content behavior per node text block: while a save is in progress, later edits update the latest in-memory content and mark that another save is needed, but they must not start overlapping `POST /v1/nodes/{node_id}/projection` requests for the same text block.
N29 - Node editor text-block save state must use the vocabulary and behavior `has changed`, `has not changed`, `save in progress`, and `save needed after current save`. A block is marked `has not changed` only when the completed request's version matches the latest local version.
N30 - Node editor forced projection flushes must save only blocks that have changed and must not `Promise.all` every text block in the node. The flush must preserve all user characters by waiting for in-progress saves and then saving the latest content if newer edits arrived.
N31 - Deleting a node text block must not race with an in-flight projection save. If a projection save is already in progress for that block, deletion must wait for that save to finish or otherwise cancel/ignore it before issuing the projection DELETE, so a late POST cannot recreate the deleted block.
N32 - Node text boxes participate in the unified editor contract: changes to indent/outdent, paste cleanup, Delete/Backspace, copy/cut/paste, lists, checklist, hyperlink, font-size, bold, underline, and table semantics must apply to node text boxes wherever a node editor is opened.
N33 - Full node editor windows participate in the unified node shell contract: header, title behavior, top-right actions, close/minimize/open/fullscreen/delete controls, sizing, and body layout must come from one shared user-facing shell behavior wherever practical.
N34 - Adding, removing, reordering, or restyling a top-right node-window action must happen through the unified node shell so Home, sidebar/app shell, Updates, Kanban/My Work, dock-restored, and Projects inline node windows stay aligned when the capability is available.
N35 - Unified node shell does not require one opener, route, page state, or backend path; a node may be opened from Home, Updates, Company Explorer/sidebar, Kanban/My Work, dock restore, or Projects while still sharing the same user-facing shell.
N36 - The node workspace body remains text boxes, attached emails, and text-block chats; chats are conversation UI and must not inherit unified rich-editor toolbar, indentation, paste, delete, list, or font-size semantics.
N37 - The node email picker is attach/select only and must not expose compose, send, scheduled send, or draft-save behavior.
N38 - Project critical-path inline node windows must use the unified node shell and unified node text-box editor semantics while preserving node information/projection persistence for node edits.
N39 - The V1 unified node shell source is `UnifiedNodeShell`; full node-window adapters may keep their own opener state, geometry, route handling, and permissions, but top-right node-window action ordering and shell/body data attributes must come from that shared source.
N40 - Node text-box inline images and node attachment-button uploads must follow `docs/tests/attachments.md`: durable node information/projection rows store attachment references, not data URLs, base64 file bytes, or embedded file payloads.
N41 - Node text-block chat attachments remain chat-specific UI, but submitted chat payloads must store Mango attachment references instead of durable `dataURL` values.
N42 - Attached emails on nodes may store message/thread/provider metadata and Mango attachment references, but must not store attachment bytes in node projection rows or communications email attachment JSON.

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

Given:
- A user has edit access to a node.
- The user types in one or more node text boxes.
- The user opens Save Settings, changes the auto-save interval, manually saves, waits for an auto-save interval, or deletes a text box while a save may still be in progress.

Expected:
- Regular typing updates `node_projection_table` for the current text box state instead of appending repeated full-document rows to `node_information`.
- Save Settings shows saved versions with save kind, saving user, timestamp, and text box count.
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

Given:
- A user opens the same node from Home, Updates, Company Explorer/sidebar, Kanban/My Work, dock restore, and a Project critical-path row.
- The node has text boxes, attached emails, and text-block chats.
- A future product change adds a new top-right node-window action or changes rich editor indentation/paste/delete semantics.

Expected:
- Each full node window uses the unified node shell behavior for header, title, top-right actions, close/minimize/open/fullscreen/delete controls, sizing, and body layout where the capability is available.
- Adding or changing a top-right node-window action through the shared shell reaches every full node window surface that exposes that capability.
- Node text boxes use the unified editor semantics on every node-window surface.
- Node text-box edits continue to save through node information/projection persistence.
- Text-block chats remain chat composers and do not receive rich editor toolbar or rich editor keyboard semantics.
- Opening the node email picker allows attaching existing email but does not expose compose, send, scheduled send, or draft-save controls.
- Home, app/sidebar, dock-restored, Updates, Kanban/My Work, and Project inline node windows mount the `UnifiedNodeShell` adapter and expose only the actions enabled by that opener.

### Scenario N-S10: Node Attachments Do Not Bloat Projection Rows

Business logic covered:
- N23
- N28
- N30
- N36
- N40
- N41
- N42

Given:
- A user pastes screenshots into node text boxes.
- A user uploads files with the node attachment button.
- A user attaches images/files to text-block chat.
- A user attaches an email to the node.

Expected:
- Node text-box projection saves preserve the latest text content but store attachment references for inline files.
- Node attachment-button uploads create Mango attachment links instead of embedding bytes in node information/projection payloads.
- Chat messages store attachment references and remain outside rich-editor semantics.
- Attached-email projections store email metadata and attachment references only.
- Loading the node does not require reading multi-megabyte inline base64 strings from node projection rows.
