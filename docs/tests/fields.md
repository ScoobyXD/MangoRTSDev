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
F9 - The Projects list places one optional generic `Field` column immediately left of Status. The plus control enables it without choosing a field definition in the header.
F10 - Each visible Field cell selects the reusable field labels assigned to that project while preserving the other project metadata controls.
F11 - Field-column visibility is a browser-local preference scoped by company; hiding the column does not remove assignments. Older per-field column preferences migrate to the single generic column.
F12 - Project grouping offers one generic `Group by Fields` choice with no field-definition sub-selector. Projects group beneath each assigned field label, while projects without fields group beneath `Unassigned`.
F13 - Older saved field-specific grouping values migrate to the generic Fields axis without mutating assignments.
F14 - The Fields page, Projects list, timeline, Project Summary, Logic Gates / Nodes, and Critical Path surfaces use the established elevated surfaces, color highlights, keyboard labels, and narrow-layout patterns.

## Scenarios

### Scenario F-S1: Create And Reuse A Field

Given:
- A user can access a company.
- No field named FX exists.

Expected:
- Fields appears under Entities.
- The user creates FX with a selected color.
- A case-only duplicate such as `fx` is rejected.
- FX appears in the field library and in each Project row's Field selector.

### Scenario F-S2: Add A Project Column And Assign A Field

Given:
- FX exists.
- Two editable projects are visible.

Expected:
- The user selects the plus control immediately left of Status to enable a generic Field column.
- The resulting column header reads `Field` without another configuration step.
- The user chooses FX from a project row's Field dropdown.
- Assigning FX updates that project without changing Status, Health, Account, or Team.
- Reloading the Projects page restores the generic Field column for the same company.

### Scenario F-S3: Group Projects By A Field

Given:
- FX is assigned to one project and not assigned to another.

Expected:
- Choosing `Group by Fields` in the Projects view menu immediately groups projects by their assigned reusable labels.
- The grouped view includes an FX group and an `Unassigned` group, with no specific-field selector.
- Grouping changes presentation only and does not mutate field assignments.

### Scenario F-S4: Delete A Field

Given:
- FX is assigned to Projects, Nodes, or Logic Gates.

Expected:
- The Fields page requires an explicit delete confirmation.
- Deleting FX removes every FX assignment.
- Projects, Nodes, and Logic Gates remain intact.
- Project reads no longer return FX, the deleted field leaves row selectors, and it no longer appears as a grouped label.

## Automated Coverage

- `backend/internal/store/entity_fields_test.go` covers validation, case-insensitive uniqueness, ordering, assignment replacement, project read models, assignment counts, deletion cleanup, and schema/migration markers.
- `backend/internal/http/entity_field_handlers_test.go` covers create, list, Project assignment, and target edit-access enforcement.
- `tests/frontend/modules/project-management/projectListView.test.ts` covers the generic Field column, per-row field selection, generic Fields grouping, legacy preference normalization, and elevated responsive surface hooks.
- `tests/frontend/app/preloadDashboardPlan.test.ts` covers isolated Fields route preloading.
- `npm run build` type-checks the Fields surface, routing, navigation, Project column controls, assignment API, and grouping integration.
