# Retired Sidebar RACI Tabs Business Logic Laws

1. Tower contains no Responsible, Accountable, Consulted, or Informed navigation tree.
2. The sidebar-only RACI Tabs feature has no frontend module, HTTP API, repository method, realtime scope, projection, trigger, table, folder, item, copied title, or copied status-count authority.
3. The forward migration drops only obsolete `raci_tabs_items`, `raci_tabs_folders`, their indexes, triggers, and dedicated synchronization functions.
4. Historical RACI Tabs migrations remain unchanged historical records; runtime code and canonical schema contain no compatibility reader, fallback, dual write, or repair path.
5. Canonical RACI remains exclusively in `resource_gvic_settings` and `resource_gvic_assignments`, including direct and inherited user/group assignments and effective-role resolution.
6. Removing RACI Tabs changes no RACI editor, permission rule, group expansion, notification rule, Logic Gate work ownership, or My Work R/A/C/I selector and filtering behavior.
7. My Work remains the personal current-work surface for Responsible, Accountable, Consulted, and Informed views and derives its results from current canonical RACI at read time.
8. Removing the obsolete sidebar projection deletes no Logic Gate, Node, canonical RACI assignment, permission, Company Explorer placement, pin, or other business resource.

Last updated: 2026-08-31

# Process Story: Tower stops copying canonical RACI into sidebar trees

Mango removes the four dedicated Tower navigation trees and their personal copied organization storage
↓
The forward migration drops only the obsolete sidebar projection objects
↓
RACI editors continue to write exact canonical policies, effective-role readers continue to resolve users and groups, and My Work continues to provide R/A/C/I work filtering without a copied sidebar authority
