Last updated: 2026-07-21

# Entity Fields Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Core store, HTTP, schema, project grouping preference, route preload, and production build behavior are covered. Browser interaction remains a manual smoke test.

## Business Logic

F1 - Fields is a first-class page under the Entities navigation section and is directly reachable at `/fields`.
F2 - A field belongs to one company and has a nonblank, case-insensitively unique name of at most 64 characters.
F3 - Every field has a validated six-digit hexadecimal color, a stable position, timestamps, and an assignment count.
F4 - Company members may list, create, rename, recolor, and delete fields only inside a company they can access.
F5 - Deleting a field removes its assignments from Projects, Nodes, and Logic Gates without deleting those entities.
F6 - An assignment identifies exactly one Project, Node, or Logic Gate and references a field from the same company.
F7 - Updating assignments replaces the complete field set for that entity and requires edit access to the target entity.
F8 - Project list responses include assigned field definitions in stable field position order.
F9 - The Projects list places custom field columns immediately left of Status and exposes a plus control for adding a column from the company field library.
F10 - A visible custom field cell can add or remove that field for one project without changing its other fields.
F11 - Visible custom field columns are a browser-local preference scoped by company; hiding a column does not remove assignments.
F12 - Project grouping offers every current field as a grouping axis. Assigned projects group under the field name and unassigned projects group under `No <field name>`.
F13 - Saved dynamic grouping values use the stable field ID, not the editable display name.
F14 - The Fields page and Project field controls use the established elevated surface, color highlight, keyboard, focus, label, and narrow-layout patterns.

## Scenarios

### Scenario F-S1: Create And Reuse A Field

Given:
- A user can access a company.
- No field named FX exists.

Expected:
- Fields appears under Entities.
- The user creates FX with a selected color.
- A case-only duplicate such as `fx` is rejected.
- FX appears in the field library, in the Projects add-column picker, and in Project grouping choices.

### Scenario F-S2: Add A Project Column And Assign A Field

Given:
- FX exists.
- Two editable projects are visible.

Expected:
- The user chooses FX from the plus control immediately left of Status.
- An FX column appears without changing Status, Health, Account, or Team.
- Assigning FX to one project updates that project and preserves its other fields.
- Reloading the Projects page restores the visible FX column for the same company.

### Scenario F-S3: Group Projects By A Field

Given:
- FX is assigned to one project and not assigned to another.

Expected:
- Choosing `Field: FX` from the Projects view menu creates an FX group and a No FX group.
- Changing the FX display name updates the grouping label because the grouping preference stores the field ID.
- Grouping changes presentation only and does not mutate field assignments.

### Scenario F-S4: Delete A Field

Given:
- FX is assigned to Projects, Nodes, or Logic Gates.

Expected:
- The Fields page requires an explicit delete confirmation.
- Deleting FX removes every FX assignment.
- Projects, Nodes, and Logic Gates remain intact.
- Project reads no longer return FX and the deleted field is no longer offered as a column or grouping choice.

## Automated Coverage

- `backend/internal/store/entity_fields_test.go` covers validation, case-insensitive uniqueness, ordering, assignment replacement, project read models, assignment counts, deletion cleanup, and schema/migration markers.
- `backend/internal/http/entity_field_handlers_test.go` covers create, list, Project assignment, and target edit-access enforcement.
- `tests/frontend/modules/project-management/projectListView.test.ts` covers dynamic field grouping values, labels, deduplication, and persistence normalization.
- `tests/frontend/app/preloadDashboardPlan.test.ts` covers isolated Fields route preloading.
- `npm run build` type-checks the Fields surface, routing, navigation, Project column controls, assignment API, and grouping integration.
