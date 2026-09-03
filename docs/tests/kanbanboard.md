# Current Process Work Board Business Logic Laws

1. The Process work board must follow the canonical step, status, ownership, and deletion rules in `docs/tests/process-steps.md`.
2. The work area must show **Steps**, **Requested**, **Pending**, **Backlog**, and **Done** as compact rectangular tabs for separate views of the same assigned Nodes.
3. Raised surfaces, soft shadows, rounded controls, and gradient accents must match the application's neumorphic appearance in both themes.
4. A Node's status color and readable status label must come from `nodes.status` rather than its step.
5. The Issue marker must remain independent of status and must not pull Pending or Done work into Steps.
6. Work reads and realtime hints must require current access to the exact owning Process and must omit inaccessible Nodes.
7. The board must preserve the same underlying assignments and order for every authorized viewer.
8. Personal grouping and Date Added sorting must use the existing single user-owned `saved_views` row for `logic_gate_kanban` across all Processes in that company.
9. The Group button must share the tab row and open settings for optional nested priority, due date, by-person, and account groups.
10. Each optional grouping field must appear at most once and support ascending or descending order.
11. Grouping must render within each step or status list and must not change assignment, status, or step identity.
12. The work board must not display work-search or account-filter controls.
13. Account grouping must show an assigned Node in each matching account group and use **No account** when none is assigned.
14. Priority grouping must use values 1 through 5 and display null as **Not Assigned**.
15. Due-date grouping must place missing values under **No due date**.
16. By-person grouping must use placement provenance and show **No person** when that provenance is absent.
17. Date Added must remain a separate optional sort control with ascending and descending direction.
18. Changing grouping or sorting must immediately save only that user's preference row.
19. A user without saved settings must start with Priority ascending grouping and Date Added descending enabled.
20. Date Added sorting must suppress manual vertical-position writes while keeping step movement available.
21. With Date Added sorting disabled, drag reorder must preserve sparse assignment positions and write only affected Nodes.
22. A supported priority-group drop must change only numeric priority 1 through 5 and the explicit target step.
23. A drop onto **Not Assigned**, person, date, or account headings must not silently change those fields.
24. Click, Ctrl/Cmd-click, and Shift-click must support Node selection and continuous visible-order range selection.
25. Bulk Node commands must deduplicate exact Node IDs even when account grouping displays a Node more than once.
26. Confirmed Node deletion must use the existing atomic typed-target recycle command and current Node Edit access.
27. Deleting a Node must remove its assignment and Node policy rows while preserving its Process and every step.
28. A failed Node mutation must preserve or restore the prior visible data and reconcile through the canonical Process work read.
29. Older in-flight reads must not reinsert Nodes after a committed deletion or reassignment.
30. Node creation, rename, priority, due-date, Issue, and status actions must reuse existing Node and assignment commands.
31. First Process assignment must record the placing actor while movement within that Process preserves that provenance.
32. Cross-Process assignment must record the transferring actor as the new placement actor.
33. Email conversion must record the converting actor as the placement actor.
34. Placement footers must use `from: `, the person's current display name when available, and assignment month/day and local time without a year.
35. Requested Nodes must preserve separate requesting-user and placing-user metadata.
36. Every effective Responsible user must see Accept and Decline for another user's Requested work.
37. Accept must set Pending and clear the request sender.
38. Decline and request cancellation must set Backlogs and clear the request sender.
39. The requester must see the request-sent state and may cancel their own request.
40. Direct email-created Nodes must retain their email-origin icon through later status, step, and Process moves.
41. Attaching email to a normal Node must not turn it into a direct email-created Node.
42. Email drops must use the existing exact-mailbox triage conversion payload with an explicit target Process, status, and optional step.
43. Personal email drops must preserve normalized account email, while shared drops must preserve the exact Shared Inbox and its mailbox provenance.
44. A successful direct email drop must open the created Node in the shared Node editor and reconcile only the originating mailbox's conversion state.
45. Initial email conversion must return its unstarred message IDs for local mailbox reconciliation.
46. A single direct email-created Node dropped onto another Node's email-transfer target must transfer the stored email relationship and remove the temporary source Node atomically.
47. Email transfer must use exact source and target Node IDs and must not require a connected personal mailbox or perform another star mutation.
48. Email transfer must preserve stored messages, target Node contents, and shared attachments under `docs/tests/attachments.md`.
49. Multi-Node, non-email-origin, and same-Node drops must not invoke email transfer.
50. Node popups must reuse the shared modal/editor shell with fullscreen, pin, and open-tab actions.
51. Popup refresh must preserve the same Node's fullscreen state, active editor contents, and title draft.
52. Route-controlled popup opening and closing must remain one continuous transition without reopening the prior route.
53. Committed titles must update matching mounted labels without changing dirty editor text or passive pin recency.
54. A complete cached Process snapshot must render immediately while one targeted refresh handles stale data.
55. Concurrent reads for one company/Process must share one in-flight request and reject obsolete selection responses.
56. Subscription acceptance and `process.work.changed` hints on `process:{logic_gate_id}` must coalesce through that same loader.
57. The work response must contain only current Process metadata, permissions, steps, exact step relationships, and minimal Node data.
58. Authorization must run before an ETag can produce `304 Not Modified`.
59. Work version changes must cover every source field that changes visible work data without rebuilding a board projection.
60. A Process deletion must capture its current authorized audience before deletion and send its committed deletion hint to that audience.
61. The board must occupy only the right-hand work area while preserving the left sidebar and SOP editor with RACI assignments above its toolbar.
62. Requested tabs must use yellow, Pending gray, Backlog purple, and Done green.
63. Step headers must display their names without ordinal-number badges.
64. Each column must create a Node through its top-right plus button instead of a bottom New Node button.
65. A step's three-dot menu must retain Rename, Move left, Move right, Add next step, and Delete column actions.
66. Existing outgoing connection chips must remain visible without a Connect to dropdown.
67. Node titles must be larger than their status and metadata text.
68. Node cards must retain readable status, priority, due date, and placement metadata.
69. Node selection must work without a card checkbox.
70. Node cards must omit the Change footer while existing Node editing, bulk commands, request actions, and Start work remain available.

## Process Story

A user opens a Process beside its SOP editor, groups its work, and moves active Nodes between its steps. Requested, waiting, deferred, and completed work remain available through compact status tabs. Existing Node editing, request handling, email conversion, and recycle actions use the same exact Nodes while authorized viewers refresh the changed Process.
