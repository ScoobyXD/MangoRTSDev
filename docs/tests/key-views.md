# Key Views

Business Logic Covered By Automated Tests: My Work and Updates saved grouping views are represented in their own surface-specific docs. This file records the shared Key Views placement and ownership contract.

KV1 - The Key Views sidebar owns saved grouping view rows for My Work and Updates.

KV2 - The app shell Key Views column is the only sidebar surface that may render My Work and Updates saved grouping rows. The retired HomeParts-local Home sidebar and any hidden sidebar slot or portal target must not own or shadow these controls.

KV3 - My Work and Updates saved grouping controls must not occupy the top-right tab header area. That header area remains available for surface controls such as My Work Me, My Team, and All scope tabs and Updates notification filters.

KV4 - Under the My Work sidebar entry, saved grouping rows behave like child rows in a tree-like list. Clicking a row activates My Work with that row's saved grouping stack selected.

KV5 - Under the Updates sidebar entry, saved grouping rows behave like child rows in a tree-like list. Clicking a row activates Updates with that row's saved grouping stack selected.

KV6 - Add new + under either surface creates a new saved grouping row, selects it, opens the floating grouping editor, and persists the row through the saved-views API.

KV7 - A saved grouping row can be renamed, reordered, edited, or deleted from its sidebar row context menu. At least one row must remain.

KV8 - The floating grouping editor controls the grouping stack for the selected row. Users can add grouping levels, remove grouping levels, change a grouping field, toggle Asc/Desc direction, and move grouping levels up or down.

KV9 - Reloading the app or returning to a surface restores the user's last selected saved grouping row for the current company and current user.

KV10 - My Work and Updates consume the selected saved grouping row and refresh when the Key Views sidebar changes it, but they do not render their own saved-view management panels.
