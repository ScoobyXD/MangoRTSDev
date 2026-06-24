Last updated: 2026-06-24

# Pin Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (backend lifecycle and permission-edge coverage exists; frontend menu and drag behavior still needs mapped automation)

## Business Logic

PIN1 - Pins are stored in the database, scoped by company and user, not browser cache.
PIN2 - A pin row has a single primary key pin ID plus company ID, user ID, resource type, resource ID, name, position, and created timestamp.
PIN3 - Supported pinned resource types are node, logic gate, and project.
PIN4 - Creating a pin requires company access and current view access to the target resource.
PIN5 - The pin name is a snapshot resolved from the server resource name or title at pin time.
PIN6 - A user can only have one pin for the same company, resource type, and resource ID.
PIN7 - Listing pins reads the user's company pins directly from the pins table and does not join to live resource tables.
PIN8 - Listing pins does not hide stale, deleted, renamed, or no-longer-permitted resources.
PIN9 - Opening a pin uses the normal resource route, so missing permission is handled by the destination view with a permission denial.
PIN10 - Unpin deletes only the current user's pin in the current company.
PIN11 - Pin order is persisted in the database and can be changed by dragging pins within the pin section.
PIN12 - Resource right-click menus put Open in new browser tab first and Pin second for pinnable resources.
PIN13 - Pinned-resource right-click menus put Open in new browser tab first and Unpin second.

## Scenarios

### Scenario PIN-S1: Create And List Pins

Business logic covered:
- PIN1
- PIN2
- PIN3
- PIN4
- PIN5
- PIN6
- PIN7

Given:
- A user has company access.
- The user can view a node, a logic gate, and a project.

Expected:
- The user can pin each supported resource type.
- Each created pin stores company ID, user ID, resource type, resource ID, name, position, and created timestamp.
- Pinning the same resource again does not create a duplicate pin.
- Loading the sidebar pin section reads those pins from the pin table.

### Scenario PIN-S2: Permission Changes After Pinning

Business logic covered:
- PIN4
- PIN8
- PIN9

Given:
- A user pins a resource while they have view access.
- The user's view access is later removed.

Expected:
- The pin remains visible in the sidebar pin section.
- Selecting or opening the pin uses the normal resource view.
- The destination view denies access with the normal permission message.
- The user cannot create a new pin for a resource they cannot currently view.

### Scenario PIN-S3: Reorder And Unpin

Business logic covered:
- PIN10
- PIN11

Given:
- A user has multiple pins in the same company.

Expected:
- Dragging pins within the pin section saves the new order in the database.
- Reloading the page preserves the saved order.
- Unpin removes only that pin for the current user and company.

### Scenario PIN-S4: Context Menu Actions

Business logic covered:
- PIN12
- PIN13

Given:
- A user right-clicks a pinnable node, logic gate, or project from Company Explorer, a node surface, board cards, Updates, or My Work.
- A user right-clicks an item in the pin section.

Expected:
- Resource menus show Open in new browser tab as the first action.
- Resource menus show Pin as the second action.
- Pin-section menus show Open in new browser tab as the first action.
- Pin-section menus show Unpin as the second action.

### Scenario PIN-S5: User And Company Isolation

Business logic covered:
- PIN1
- PIN6
- PIN10

Given:
- Two users belong to the same company.
- One user belongs to two companies.

Expected:
- Each user sees only their own pins.
- The same resource can be pinned independently by different users.
- A user's pins in one company do not appear in another company.
