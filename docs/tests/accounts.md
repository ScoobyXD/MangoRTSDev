Last updated: 2026-07-12

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
ACC17 - Updating node account assignments does not append `event_rows`; the assignment mutation updates canonical projection dependencies and read versions synchronously.
ACC18 - Updating node account assignments appends the independently required durable `node_updated` domain fact marked as accounts changed. That fact may produce a compact hint for each affected mounted `board:{board_id}`, but it does not publish a generic workspace browser event.
ACC19 - Company account reference reads use one company-scoped shared singleflight/cache across editor and project consumers. Every account or folder create/update/delete invalidates that cache before emitting `mangorts:accounts-updated`, so an older in-flight result cannot repopulate stale account labels after a mutation.

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
- Successful replacement appends no `event_rows`; canonical projection dependencies and read versions are current when the response commits.
- Successful replacement appends the durable `node_updated` domain fact with accounts-changed metadata and can notify only affected mounted board scopes, never a generic workspace browser scope.

### Scenario ACC-S4: Shared Account Reference Cache

Business logic covered:
- ACC1
- ACC4
- ACC19

Given:
- Multiple mounted editor/project surfaces request the same company's accounts under React StrictMode.
- An account or account folder is then created, updated, or deleted.

Expected:
- Compatible reads share one in-flight request and reuse the company-scoped result.
- The mutation invalidates cached and older in-flight account data before the account-updated event asks consumers to reload.
- The next read returns the post-mutation sorted account list, and another auth/company scope cannot reuse it.
