Last updated: 2026-07-07

# Logic Gates Tests

Detailed Logic Gate Kanban board behavior, including subgrouping, request card footers, and card placement provenance, is covered in `docs/tests/kanbanboard.md`.

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: 0% (rule IDs are not mapped to automated tests yet)

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
LG18 - Logic Gate Save Settings exposes a mandatory auto-save interval setting and lists saved editor versions sorted by saved timestamp, including manual/auto save kind, saving user, save time, and saved text box count.
LG19 - Clicking Save in the Logic Gate editor flushes pending projection saves first, then creates a manual saved editor version in `logic_gate_information`.
LG20 - Logic Gate auto-save versions use the selected interval and create auto saved editor versions in `logic_gate_information` only when the current editor projection changed since the last saved version.
LG21 - Restoring a Logic Gate saved version requires confirmation and overwrites the current Logic Gate editor projection row from that saved version without creating another saved-version row.

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
- Table insertion uses the current caret/selection position.

### Scenario LG-S5: Logic Gate Editor Projection Saves And Saved Versions

Business logic covered:
- LG17
- LG18
- LG19
- LG20
- LG21

Given:
- A user has edit access to a Logic Gate.
- The user types in the Logic Gate editor.
- The user opens Save Settings, changes the auto-save interval, manually saves, or waits for an auto-save interval.

Expected:
- Regular typing updates `logic_gate_projection_table` for the current editor state instead of appending repeated full-document rows to `logic_gate_information`.
- Save Settings shows manual and auto saved versions with save kind, saving user, timestamp, and text box count.
- Manual Save first flushes pending projection updates, then writes one saved-version batch to `logic_gate_information`.
- Auto save writes a saved-version batch only when the current projection differs from the last saved version.
- Restoring a saved version asks for confirmation and replaces the current Logic Gate editor projection with the selected saved content.
