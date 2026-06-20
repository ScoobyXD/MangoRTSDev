Last updated: 2026-06-20

# Accounts Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: 0% (rule IDs are not mapped to automated tests yet)

## Business Logic

ACC1 - Account and account-folder APIs require company access.
ACC2 - Creating an account requires company ID and nonblank account name.
ACC3 - Accounts can store optional client ID, folder ID, and position.
ACC4 - Account lists sort by position, then case-insensitive name, then account ID.
ACC5 - Creating an account folder requires company ID and nonblank folder name.
ACC6 - Account folders can store optional parent folder and position.
ACC7 - Account folder lists sort by position, then case-insensitive name, then folder ID.
ACC8 - An account folder parent must exist in the same company.
ACC9 - An account folder cannot be parented to itself or one of its descendants.
ACC10 - Deleting an account folder detaches child folders and accounts instead of deleting those child records.
ACC11 - Updating an account supports partial changes to name, folder, and position and requires company context.
ACC12 - Deleting an account recomputes account-dependent node projection data for assigned nodes.
ACC13 - Reading node account assignments requires view access to the node.
ACC14 - Replacing node account assignments requires edit access to the node.
ACC15 - Replacing node account assignments cleans blank IDs, dedupes repeated account IDs, sorts them, and validates that every account exists in the company.
ACC16 - Updating node account assignments recomputes node projection dependencies.
ACC17 - Updating node account assignments appends account-change event rows.
ACC18 - Updating node account assignments emits a workspace node-updated event marked as accounts changed.

## Scenarios

### Scenario ACC-S1: Account CRUD And Sorting

Business logic covered:
- ACC1
- ACC2
- ACC3
- ACC4
- ACC11
- ACC12

Given:
- A company user manages accounts in a company.
- Accounts have names, optional client IDs, optional folders, and positions.

Expected:
- Account APIs require company access.
- Creating an account requires company ID and name.
- Optional client ID, folder ID, and position are stored when provided.
- Lists sort by position, case-insensitive name, and account ID.
- Updating an account can change only the provided fields.
- Deleting an account recomputes account-dependent node projection data.

### Scenario ACC-S2: Account Folder Tree Rules

Business logic covered:
- ACC5
- ACC6
- ACC7
- ACC8
- ACC9
- ACC10

Given:
- A company has account folders and accounts assigned to folders.
- A user attempts valid and invalid folder moves.

Expected:
- Creating a folder requires company ID and folder name.
- Folder parent and position are optional.
- Folder lists sort by position, case-insensitive name, and folder ID.
- Parent folders must exist in the same company.
- A folder cannot become its own parent or descendant.
- Deleting a folder detaches child folders and accounts instead of deleting them.

### Scenario ACC-S3: Node Account Assignments

Business logic covered:
- ACC13
- ACC14
- ACC15
- ACC16
- ACC17
- ACC18

Given:
- A node has existing account assignments.
- A user has either view or edit access to the node.
- A replacement request includes blanks, duplicates, valid accounts, and an invalid account ID.

Expected:
- View access can read node account assignments.
- Edit access is required to replace node account assignments.
- Replacement cleans blanks, dedupes IDs, sorts IDs, and rejects invalid accounts.
- Successful replacement recomputes node projection dependencies.
- Successful replacement appends account-change event rows.
- Successful replacement emits a workspace node-updated event with accounts-changed metadata.
