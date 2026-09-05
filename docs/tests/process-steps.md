# Process Step Business Logic Laws

1. A Process is the existing Logic Gate and keeps its exact `logic_gates.logic_gate_id`.
2. Each `process_steps` row belongs to exactly one same-company Process and keeps its own exact `process_step_id`.
3. A Process may have zero or more steps, and each step appears as one column in its Steps view.
4. Step display order is stored on the step and does not create or change an operational connection.
5. Step connections use only `resource_operational_relationships` with exact `process_step` endpoints belonging to the same Process.
6. A connection is directed, rejects a self-edge, and has one row per exact company and directed endpoint pair.
7. Add next step stores and renders the new step immediately to the right of its exact source and creates that incoming connection atomically.
8. One step may connect to several other steps, and several steps may connect to the same step.
9. A connection controls neither Node permissions nor Process membership and creates no Company Explorer or company-map placement.
10. A Node keeps its one existing Process assignment and may have one step assignment within that same Process.
11. `nodes.status` is the only saved Node status authority; a step name, column position, or Issue flag never replaces it.
12. Requested, Pending, Backlog, and Done are separate status lists within the Process and are never steps or stored board columns.
13. The Steps view shows In Progress and Review Nodes; the separate status lists show only Nodes with their matching status.
14. A Node appears in only one work view at a time, determined by its status.
15. An active Node without a step appears in No step assigned while keeping its Process membership and status.
16. Pending means accepted work waiting to start or resume and is independent of whether a step is already assigned.
17. Accepting a request changes its status to Pending; declining or cancelling follows the existing Backlog behavior and request authorization.
18. Starting work chooses one step and changes the Node to In Progress in one operation.
19. Moving a Node between steps preserves its status, Issue flag, Process membership, and unrelated content.
20. Changing status to Requested, Pending, Backlog, or Done preserves the Node's existing step assignment.
21. Reopening a Node reuses its surviving step; a Node whose step was deleted remains unassigned to a step.
22. A cross-Process transfer clears the previous step unless the command explicitly chooses a valid step in the destination Process.
23. Deleting a step removes its exact incoming and outgoing connections and clears only the affected Node step assignments.
24. Deleting a step preserves every Node, Node status, Process assignment, email, attachment, permission, RACI assignment, and unrelated relationship.
25. Deleting a step never invents replacement connections between surviving steps.
26. Deleting a Node never deletes its Process or step; Process and Node recycle/restore preserve the exact step relationships promised by their existing lifecycle.
27. Restoring a Node whose step has since been permanently deleted clears the unavailable step reference without inventing a replacement step.
28. Existing work is converted with the same Node IDs, Process membership, statuses, Issue flags, metadata, content, and completion timestamps, with no guessed step assignments.
29. Existing recycle snapshots are converted once to the new fields so runtime restore needs no legacy status-column fallback.
30. Work views, counts, and related readers derive from Nodes, Process assignments, and steps; `kanban_board_projection` and its synchronization paths do not exist.
31. Process work commands enforce current Process and Node access through existing authorization rules, and hidden Nodes contribute neither rows nor counts.
32. Committed work changes invalidate the existing Process work read through exact Process identity, and mounted views use one active refresh with at most one queued refresh.
33. In the canonical Process editor, the existing left sidebar and SOP editor remain in place, including the RACI assignments and editor toolbar; the Process work board occupies only the right-hand work area.
34. Step columns, controls, and Node cards reuse Mango's elevated surfaces and soft gradients; status is identified by both color and text.
35. The Issue flag decorates a Node's underlying status and never moves a Pending or Done Node into the active Steps view.
36. An assigned Node accepts only Requested, Pending, Backlogs, In Progress, Review, or Done through every status update path; Issue is never saved as its status.
37. A folder change refreshes Process work only when it affects that Process's inherited access; unrelated folders and shared inboxes do not invalidate its work.
38. Every effective Responsible user with Process access can accept or decline another user's request, including users reached through groups or inherited RACI.
39. RACI assignment constraints accept the same canonical resource types as RACI settings so Process requests can inherit Responsible users from folders.
40. Compact rectangular tabs at the top of the work area select Steps, Requested, Pending, Backlog, and Done.
41. Requested uses yellow, Pending gray, Backlog purple, and Done green while retaining readable labels.
42. The top-right Board / Map toggle displays the same exact Process and Steps; opening its Board starts in Board mode, while company-map creation starts in its focused Step canvas.
43. Map creation, renaming, and connection commands use the existing Step records and same-Process operational relationships.
44. Step-map layout stores only positions, dimensions, and routes keyed by exact Step and relationship IDs within one Process.
45. Moving or resizing a Step or routing a connection never changes Board order, Node assignments, statuses, SOP content, or operational endpoints.
46. Completed layout gestures in a saved Process save on the server and report saving, success, or failure; gestures in an unsaved Process update only its local draft until Save Process.
47. A stale layout revision is rejected rather than overwriting a newer layout, and the client reloads the current arrangement before retrying.
48. Deleting a Step or connection removes its dependent layout entries and advances the layout revision; surviving resources and geometry remain unchanged.
49. Process recycle and restore preserve exact surviving Step geometry and routes, and permanent Process deletion removes its layout.
50. Layout reads and writes require current access to the exact owning Process and reject references to another Process.
51. SOP text provides written Step explanations; the map introduces no separate instruction fields or inferred Step identities.
52. Pan, zoom, Board scrolling, and the selected view are local presentation state and never write layout or resource records.
53. Create Process on the company map opens an empty local draft inside the shared map pane.
54. Save Process requires a nonblank name and an existing destination Folder selected through its breadcrumb path.
55. Initial Save stores the Process, Folder placement, zero to 200 Steps, up to 500 same-Process connections, layout, and committed events in one transaction.
56. Initial Step array order sets Board order independently of authored geometry.
57. A rejected save retains the local draft and commits no partial Process, relationship, placement, or event.
58. Repeated save attempts retain the same allocated UUIDs and cannot create duplicate Processes or overwrite an existing identity.
59. Save and controls that leave the Process stay disabled during a layout gesture or pending mutation.
60. Leaving an unsaved draft through its Company map action requires explicit discard; successful Save stays in the full Process canvas.
61. Sidebar navigation retains the current company's draft in memory; returning to Process Map restores that draft without a server write.
62. An uncertain Save offers an explicit saved-version recovery that freshly authorizes the exact Process and its Explorer location before leaving the draft.
63. Company browsing, Process drafts, and saved focused Processes use one edge-to-edge white map pane without a background grid, outer panels, or separate creation form.
64. The map retains one elevated translucent top-right card containing Create Folder, Create Process, Create Step, and Hover mode in that vertical order.
65. Create Step adds to the focused draft or saved Process, or starts a new Process draft containing its first Step when no Process is open.
66. The Folder and file breadcrumb stays inline at the top of the map, with a compact editable draft filename replacing the separate Process name field.
67. Folder selection and Folder creation appear on compact elevated surfaces inside the map.
68. Save Process and its save status stay inside the common top-right card.
69. Hover mode on the focused map previews the hovered Step's name and highlights its connections without changing selection or pending edits.
70. Focused Process drafts and saved maps omit Step and connection inspectors.
71. The focused Process outline uses unscaled work-area dimensions and pans and zooms with its Steps and routes.
72. The Process outline expands to contain authored Step and route geometry without changing that geometry or Board layout.
73. New Step-map boxes use dimensions of 112 by 56 canvas units.
74. Existing saved Step boxes retain their dimensions until explicitly resized.
75. In the focused map, dragging any Step card surface other than a resize handle or active title input moves that Step.
76. Hovering or selecting a Step in the focused map reveals eight resize handles, one at each side midpoint and corner.
77. Each resize handle moves only its corresponding edges.
78. Create Step in the focused map focuses its inline title with all text selected.
79. Double-clicking a Step card or its title in the focused map opens inline title editing with all text selected.
80. Enter or blur commits a changed, trimmed nonblank inline title through the existing Step rename command.
81. Escape cancels inline title changes and retains the last committed name.
82. A blank inline title leaves the last committed Step name unchanged.
83. Dragging blank space in the focused map pans its camera without moving authored geometry.
84. Wheel zoom in the focused map keeps the world point beneath the pointer fixed within a 50% to 800% range.
85. Focused maps omit zoom buttons and Fit.
86. Read-only access allows focused-map camera navigation.
87. A Step or route editing gesture holds the focused-map camera fixed until that gesture ends.
88. Create Folder and Create Process remain visible and disabled inside focused Process drafts and saved maps.
89. Inline Step titles have no visible input border.
90. The separate Board presentation retains its top toolbar, Step and connection inspectors, and zoom controls.

## Process Story

A user chooses Create Process, chooses a Folder, and edits the filename in the inline path. Create Step adds a compact card with its borderless title selected for typing; the other creation actions stay visible and disabled. The user arranges Steps inside the outline, pans blank space, and zooms with the wheel while the controls stay fixed. Save commits the draft to Company Explorer. The separate Board presentation retains its editing controls and uses those exact Steps as columns. Written explanations remain in the SOP; deleting a Step preserves every Node and status.

## Main Scenarios

1. **Existing work:** after conversion, a Review Node remains Review in the same Process and appears in No step assigned until a user chooses a step. A Done Node stays in Done with its original completion timestamp.
2. **Branching:** a step connects to two possible next steps through two exact directed relationships. Moving a Node to either step changes only its selected step; removing one connection preserves all three steps and their Nodes.
3. **Step deletion:** deleting a step used by active, Pending, and Done Nodes clears each step reference. Active Nodes appear in No step assigned, while Pending and Done Nodes remain in their lists. No Node or Process membership is deleted.

## Database Rollout

The repository migration is `backend/db/migrations/20260903_process_steps.sql`. A human operator must stop application writers, run this forward-only migration against PostgreSQL 17 or 18, and deploy the matching application before reopening writes. It also corrects the outdated RACI assignment constraint that blocked folder inheritance. It reports the connected version and stops on an unsupported version, incompatible starting schema, or unsupported existing status/resource type. Agents must not apply it to a live database. Disposable integration tests exercise the conversion and lifecycle without using live credentials.

The Step-map addition is `backend/db/migrations/20260904_process_step_map_layouts.sql`, applied after the Step migration by a human operator before deploying this feature. It adds Process-owned layout storage and dependent cleanup; existing Steps need no geometry backfill. No live database is modified by this task.
