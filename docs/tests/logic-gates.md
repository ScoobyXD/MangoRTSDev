Last updated: 2026-07-10

# Logic Gates Tests

Detailed Logic Gate Kanban board behavior, including subgrouping, request card footers, and card placement provenance, is covered in `docs/tests/kanbanboard.md`.

Coverage Status:
- Shared `@`/`!` people-picker palette key, fallback, and contrast behavior is covered by `tests/frontend/modules/editor/editorMentions.test.ts`.
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (`tests/frontend/modules/editor/unifiedRichEditorContract.test.ts` covers the unified editor surface contract; shared editor attachment tests cover durable rich-editor image attachment references; Logic Gate-specific projection/persistence rule IDs are not fully mapped to automated tests yet)

## Business Logic

LG1 - Logic gates support generated, verified, consulted, and informed GVIC assignments.
LG2 - Logic gate generated and verified GVIC assignments are single-user slots.
LG3 - Logic gate generated and verified GVIC assignments must use a user principal, not a group principal.
LG4 - Replacing the generated or verified user on a logic gate removes the previous user for that role.
LG5 - Logic gate consulted and informed GVIC assignments may include users and user groups.
LG6 - Nodes dropped or created into a logic gate requested column store the requesting user.
LG7 - The generated user for the logic gate sees accept and deny actions for requested nodes sent by another user.
LG8 - Accepting a requested node moves it to pending and clears the request sender.
LG9 - Denying a requested node moves it to backlog and clears the request sender.
LG10 - The requesting user sees request-sent status on the requested card and can cancel the request back to backlog.
LG11 - Pasted rich text in Logic Gate editor surfaces must normalize to the app/editor font family instead of preserving source document fonts.
LG12 - Pasting selected inline text into a Logic Gate editor must not create extra blank rows above or below the pasted content from source boundary whitespace.
LG13 - New Logic Gate editor documents default to alphanumerical numbering, and the editor outline dropdown lists alphanumerical numbering before indent guides.
LG14 - The Logic Gate editor font-size control applies to highlighted text and, for a collapsed caret, becomes the sticky font size for subsequently typed characters until changed again.
LG15 - Logic Gate editor bold and underline controls must toggle the selected text or sticky caret formatting and must visually reflect the formatting at the current caret or selection.
LG16 - Inserting a table in a Logic Gate editor must insert the table at the current caret/selection location, not at the top-left or beginning of the editor.
LG17 - Live Logic Gate editor typing writes the current text state to the Logic Gate editor projection table and must not append a full rich-text document row to `logic_gate_information` on every keystroke autosave.
LG18 - Logic Gate Save Settings lists saved editor versions sorted by saved timestamp, including save kind, saving user, save time, and saved text box count; automatic saved-version creation is disabled during the emergency slowness fix.
LG19 - Clicking Save in the Logic Gate editor flushes pending projection saves first, then creates a manual saved editor version in `logic_gate_information`.
LG20 - Logic Gate automatic saved-version creation must not run in the background during the emergency slowness fix. If auto saved versions are re-enabled later, they must only consider active Logic Gates, must only save Logic Gates whose editor projection has changed, and must never scan or save every Logic Gate in the system.
LG21 - Restoring a Logic Gate saved version requires confirmation and overwrites the current Logic Gate editor projection row from that saved version without creating another saved-version row.
LG22 - Logic Gate editor projection saves must use one-save-at-a-time latest-content behavior: while a save is in progress, later edits update the latest in-memory content and mark that another save is needed, but they must not start overlapping `POST /v1/logic-gates/{logic_gate_id}/projection` requests for the same editor document.
LG23 - Logic Gate editor save state must use the vocabulary and behavior `has changed`, `has not changed`, `save in progress`, and `save needed after current save`. The editor is marked `has not changed` only when the completed request's version matches the latest local version.
LG24 - The Logic Gate editor exposes applying the current GVIC template to already assigned nodes as a one-shot action next to the GVIC role fields, not as a persistent checkbox or vertical control between the title and GVIC fields.
LG25 - Pressing the Logic Gate editor's apply-to-assigned-nodes action asks for confirmation; canceling makes no write, and confirming applies the current Logic Gate GVIC template to nodes currently assigned to that Logic Gate. Ordinary GVIC role edits remain template-only for existing assigned nodes.
LG26 - Logic Gate editor surfaces participate in the unified editor contract: changes to indent/outdent, paste cleanup, Delete/Backspace, copy/cut/paste, lists, checklist, hyperlink, font-size, bold, underline, table, and people-suggestion semantics must apply to Logic Gate editor text wherever it is opened. The `@`/`!` people picker uses stable, visible per-user profile colors rather than gray-only rows.
LG27 - Logic Gate editor inline images/files must follow `docs/tests/attachments.md`: rich-editor paste/drop uses the shared editor image path, and durable Logic Gate information/projection rows store attachment references instead of data URLs or base64 file bytes.
LG28 - The Logic Gate editor toolbar must use the shared rich-editor toolbar source and shared font-size helper/controller. Font-size minus/value/plus, bold, underline, and the outline-style dropdown must match node text boxes, project text boxes, and mail editor surfaces in look and selected-text/sticky-caret behavior.

## Scenarios

### Scenario LG-S1: Generated And Verified Single User Slots

Business logic covered:
- LG1
- LG2
- LG3
- LG4

Given:
- A logic gate has editable GVIC fields.
- A company user is assigned to the logic gate's generated or verified field.
- A second user is later selected for the same generated or verified field.

Expected:
- The generated or verified field accepts exactly one user.
- Group principals are not selectable or accepted for generated or verified.
- Selecting the second user replaces the first user for that role.

### Scenario LG-S2: Consulted And Informed Users And Teams

Business logic covered:
- LG1
- LG5

Given:
- A logic gate has consulted and informed GVIC fields.
- A company has users, user groups, and nested user groups.

Expected:
- Consulted and informed can include individual users.
- Consulted and informed can include user groups.
- Consulted and informed can hold multiple assignments.

### Scenario LG-S3: Requested Node Ownership

Business logic covered:
- LG6
- LG7
- LG8
- LG9
- LG10

Given:
- A logic gate has a generated user.
- Another user drops or creates a node into the requested column.

Expected:
- The requested card records the requesting user.
- The generated user sees accept and deny actions on the requested card.
- Accept moves the card to pending.
- Deny moves the card to backlog.
- The requesting user sees request-sent status and can cancel the request to backlog.

### Scenario LG-S4: Logic Gate Rich Text Editing Controls

Business logic covered:
- LG11
- LG12
- LG13
- LG14
- LG15
- LG16
- LG26
- LG28

Given:
- A user edits a Logic Gate text body.
- The user pastes styled text copied from another application.
- The user changes font size, bold, underline, outline style, or inserts a table.

Expected:
- Pasted content renders in the Logic Gate editor's normal font family.
- Pasted inline text does not gain empty rows above or below the copied text.
- New Logic Gate editor text uses alphanumerical numbering by default, and alphanumerical numbering appears first in the outline dropdown.
- Changing font size while text is highlighted changes that selected text.
- Changing font size with only a caret sets the font size for the next typed characters.
- Bold and underline buttons reflect the caret or selected text state and can be active at the same time.
- Toggling bold or underline affects the selection or the next typed characters when the selection is collapsed.
- The toolbar uses the shared font-size, bold, underline, and outline-style controls rather than a Logic Gate-only implementation.
- Table insertion uses the current caret/selection position.
- The same rich editing semantics come from the unified editor behavior used by node, project, and email compose/reply editor surfaces.
- Typing `@` or `!` opens the shared people picker with a stable color keyed by normalized user ID, then email, then display name. Keyboard-active treatment adds a translucent same-color tint and the existing active rail while preserving the opaque profile avatar and tested readable contrast.

### Scenario LG-S5: Logic Gate Editor Projection Saves And Saved Versions

Business logic covered:
- LG17
- LG18
- LG19
- LG20
- LG21
- LG22
- LG23

Given:
- A user has edit access to a Logic Gate.
- The user types in the Logic Gate editor.
- The user opens Save Settings, changes the auto-save interval, manually saves, or waits for an auto-save interval.

Expected:
- Regular typing updates `logic_gate_projection_table` for the current editor state instead of appending repeated full-document rows to `logic_gate_information`.
- Save Settings shows saved versions with save kind, saving user, timestamp, and text box count.
- Manual Save first flushes pending projection updates, then writes one saved-version batch to `logic_gate_information`.
- Automatic saved-version creation does not run in the background during the emergency slowness fix.
- Restoring a saved version asks for confirmation and replaces the current Logic Gate editor projection with the selected saved content.
- When a user types a paragraph, the editor updates immediately and marks the editor projection as `has changed`.
- After the debounce delay, the editor starts at most one projection save for that Logic Gate editor document.
- If the user keeps typing while that save is in progress, the editor keeps the newest content in memory, marks `save needed after current save`, and does not start overlapping saves.
- When the in-progress save finishes, the editor marks the projection `has not changed` only if the completed save version is still the latest local version.
- If newer edits arrived while the save was in progress, the editor sends exactly one follow-up projection save using the newest in-memory content.

### Scenario LG-S6: Logic Gate GVIC Apply To Assigned Nodes Action

Business logic covered:
- LG24
- LG25

Given:
- A user is editing a Logic Gate that has generated, verified, consulted, and informed GVIC fields.
- The Logic Gate has nodes already assigned to it.
- The user changes the Logic Gate's GVIC template.
- The user presses the apply-to-assigned-nodes action.

Expected:
- The apply-to-assigned-nodes control is displayed as an action beside the GVIC role fields, not as a checkbox or separate row above them.
- Pressing the action opens a confirmation prompt before any bulk node GVIC update is sent.
- Canceling the confirmation leaves the current Logic Gate GVIC template saved but does not update existing assigned node snapshots.
- Confirming applies the current Logic Gate GVIC template to nodes currently assigned to that Logic Gate.
- Changing Generated, Verified, Consulted, or Informed directly does not implicitly apply that change to existing assigned nodes.

### Scenario LG-S7: Logic Gate Editor Images Use Mango Attachments

Business logic covered:
- LG17
- LG22
- LG26
- LG27

Given:
- A user pastes or drops screenshots into a Logic Gate editor body.
- The editor saves the latest Logic Gate projection.

Expected:
- The image upload/reference behavior comes from the unified rich-editor image path, not a Logic Gate-only implementation.
- The saved Logic Gate projection stores attachment references.
- Logic Gate information/projection rows do not store durable data URLs or base64 file bytes.
- Fullscreen image preview still opens the original or highest-quality available file.
