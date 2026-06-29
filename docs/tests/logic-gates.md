Last updated: 2026-06-29

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
