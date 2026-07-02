Last updated: 2026-07-02

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
