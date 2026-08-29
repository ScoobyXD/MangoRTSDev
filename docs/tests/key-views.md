# Key Views

Last updated: 2026-08-28

Business Logic Covered By Automated Tests: Updates saved grouping views are covered by frontend grouping tests and backend saved-view tests. This file records the sidebar placement and ownership contract.

KV1 - The Key Views sidebar owns saved grouping view rows for Updates.

KV2 - The app shell Key Views column is the only sidebar surface that may render Updates saved grouping rows. The retired HomeParts-local Home sidebar and any hidden sidebar slot or portal target must not own or shadow these controls.

KV3 - Updates saved grouping controls must not occupy the top-right tab header area. That header remains available for Updates notification filters.

KV4 - Under the Updates sidebar entry, saved grouping rows behave like child rows in a tree-like list. Clicking a row activates Updates with that row's saved grouping stack selected.

KV5 - + Add new creates a new Updates saved grouping row, selects it, opens the floating grouping editor, and persists the row through the saved-views API without navigating the main content area.

KV6 - A saved grouping row can be edited, renamed, deleted, or reordered from the sidebar. Updates may have zero saved grouping rows.

KV7 - The floating grouping editor can add, remove, reorder, and change grouping levels and directions. Removing every grouping level is valid and leaves the saved view ungrouped.

KV8 - Reloading the app or returning to Updates restores the user's last selected saved grouping row for the current company and user.

KV9 - Updates consumes the selected saved grouping row and refreshes when the Key Views sidebar changes it, but does not render its own saved-view management panel.

KV10 - Status uses the canonical order In Progress, Review, Pending, Requested, Backlog, Done in ascending direction, with Done last in either direction. Verify joins Review, Request/Requests join Requested, and Backlogs/Back Logs/Backlogged join Backlog.

KV11 - Key Views and its floating editor remain app/sidebar chrome beneath the shared body-level blocking modal layer. Closing an overlay leaves the saved-view selection and grouping draft unchanged.

KV12 - The Tower sidebar section remains visible and shows My Work as its first built-in view immediately above Projects. My Work owns no saved-view controls in its first version.

KV13 - The browser document links the orange Mango favicon on every app route and never falls back to the browser's generic globe.

KV14 - The shared realtime health indicator appears immediately before the trash control and exposes accessible color plus text for Connected, Reconnecting, Attempting to reconnect, and Disconnected states.
