# Process Map Business Logic Laws

1. Process Map MUST reference the exact canonical Company Explorer Folder and Process identities and MUST NOT create copied Folder or Process entities.
2. Process is the product name for the existing Logic Gate resource and MUST reuse the exact existing Logic Gate identity and records.
3. The first Process Map version MUST support only Company Explorer Folders and Processes and MUST NOT support Nodes, Projects, or other resource types.
4. Folder names and facts MUST come from `company_explorer_folders`, and Process names and facts MUST come from the canonical Logic Gate records.
5. Current source names and permissions MUST be joined when Process Map is read and MUST NOT be copied into Process Map storage.
6. `process_map_placements` MUST be the authority for Process Map inclusion, independent map parentage, and manually saved position.
7. `resource_operational_relationships` MUST be the authority for operational flow between supported resources.
8. `process_map_traces` MUST be the authority only for the saved visual routing of an operational relationship.
9. Manually authored Process Map placement and trace facts MUST be treated as canonical map facts and MUST NOT be treated as disposable projections.
10. Process Map MUST NOT introduce a resource registry, surrogate resource identity, translated identity, copied resource payload, or compatibility identity layer.
11. The first Process Map version MUST have one shared Process Map per company and MUST NOT add separate map records.
12. Process Map generic resource references MUST use the exact canonical stored types `company_explorer_folder` and `logic_gate`; the Process display name MUST NOT create a parallel stored `process` identity.
13. One `process_map_placements` row MUST mean that its exact typed resource is explicitly mapped.
14. One exact typed resource MUST have at most one Process Map placement in its company.
15. Process Map parentage MUST remain independent from Company Explorer parentage and placement.
16. A root placement MUST have no map parent and MUST reference a Folder.
17. A non-root placement MUST name one exact same-company Company Explorer Folder as its map parent.
18. A Process MUST NOT parent another Process Map placement.
19. Process Map Folder parentage MUST reject self-parenting, descendant cycles, missing Folders, and cross-company Folders.
20. A Folder's map layer MUST be identified by that Folder's exact canonical ID.
21. Removing a Folder's placement from its parent layer MUST preserve the saved placements and traces inside that Folder's own map layer.
22. A user with access to an unplaced Folder's exact layer URL MUST still be able to open that preserved Folder layer.
23. Creating, moving, or reordering an item in Company Explorer MUST NOT automatically add, move, position, arrange, or rearrange a Process Map placement.
24. Renaming a mapped Folder or Process at its source MUST be reflected on the next Process Map read without rewriting its placement.
25. Adding, moving, reparenting, or removing a Process Map placement MUST NOT add, move, rename, delete, or otherwise mutate its source resource or Company Explorer placement.
26. Mango MUST NOT automatically create a Process Map placement for an existing or newly created Folder or Process.
27. Permanently deleting a Folder or Process MUST remove every Process Map placement, operational relationship, and trace that references its exact typed identity without affecting unrelated resources.
28. Recycling a Folder or Process MUST capture every placement, operational relationship, and trace promised for restoration before live cleanup occurs.
29. Restoring a recycled Folder or Process MUST restore its promised exact Process Map state after its source resources and operational relationships exist again.
30. A saved Process Map position MUST use signed integer coordinates measured in the smallest grid squares and MUST NOT use pixels or floating-point coordinates.
31. Every manually moved placement and every manually routed point MUST snap to the smallest grid squares before it is saved.
32. Process Map placements and traces MUST be shared company state rather than personal browser state.
33. Every successful placement save MUST increment that placement's revision.
34. Placement saves MUST use last-committed-save-wins behavior and MUST NOT reject a save merely because the client read an older revision.
35. Every placement MUST record database-generated creation and update timestamps.
36. Every accessible Folder MUST be a fixed rounded rectangle occupying exactly seven by five smallest grid squares.
37. Every accessible Process MUST be a fixed rectangle occupying exactly seven by five smallest grid squares.
38. Folder and Process dimensions MUST NOT be user-adjustable or stored as placement data in the first version.
39. Every accessible Folder and Process MUST keep a neutral elevated surface with one thin type outline matching Company Explorer: orange for a Folder and green for a Process; selection MUST preserve that type outline, and the first version MUST NOT add filled semantic item colors.
40. A single click on an accessible Folder MUST select that Folder; a single click on an accessible Process MUST select that Process and pin its Process data card immediately to its right; completing a placement drag or connection gesture MUST perform only that gesture and MUST NOT be treated as a click or open, close, pin, or unpin a data card.
41. A double click on an accessible Folder MUST navigate to that Folder's Process Map layer.
42. A Process MUST remain a leaf on Process Map and MUST NOT open a Process Map child layer; double-clicking an accessible Process MUST instead open that exact Process's canonical Logic Gate page in a blocking overlay.
43. Panning or zooming MUST change only the current map viewport and MUST NOT enter or leave a Folder or change saved placement coordinates.
44. The root layer and every Folder layer MUST have a stable and directly openable URL.
45. Every Folder double-click drill-in MUST navigate to the destination Folder layer's URL and add that navigation to browser history; opening a Process Logic Gate overlay MUST NOT change the Process Map URL or browser history.
46. Copying and opening a Process Map URL MUST restore the same identified layer for an authorized recipient.
47. Browser Back MUST return to the previously visited Process Map layer.
48. The root route MUST load only placements whose saved map parent is root and the traces required for that root layer.
49. A Folder route MUST load only placements whose saved map parent is that exact Folder and the traces required for that Folder layer.
50. Process Map MUST NOT preload deeper descendants, hidden layer contents, the complete Company Explorer tree, or the complete company relationship graph.
51. Structural map parentage, operational relationships, and trace geometry MUST remain three separate meanings.
52. Company Explorer hierarchy and Process Map parentage MUST describe organization only and MUST NOT create or imply operational flow.
53. Map position, visual proximity, shared route geometry, and Company Explorer ordering MUST NOT create or imply an operational relationship.
54. `resource_operational_relationships` MUST store the exact typed source and exact typed target of every operational relationship.
55. The first version MUST allow Folder-to-Folder, Folder-to-Process, Process-to-Folder, and Process-to-Process operational relationships.
56. Every operational relationship MUST be directed, same-company, and non-self-referential.
57. Repeating creation for the same exact typed source and target MUST return or reuse the one existing operational relationship and MUST NOT create a duplicate row.
58. An operational relationship MUST NOT grant access, RACI, ownership, Company Explorer parentage, or Process Map parentage to either endpoint.
59. `resource_operational_relationships` MUST replace the same Process-to-Process business meaning formerly stored by `logic_gate_relationships` through one forward-only cutover with no dual writes, compatibility reads, fallback reads, or second live authority.
60. The source and target of an existing operational relationship MUST be immutable, and changing either endpoint or reversing direction MUST delete the old relationship and trace before creating a new relationship and trace.
61. A visible Process Map trace MUST represent one explicit `resource_operational_relationships` row and MUST NOT be decorative or inferred.
62. Finishing a newly drawn trace MUST atomically create or reuse its operational relationship and save its trace, or save neither.
63. An operational relationship MAY exist without a Process Map trace, and an absent trace MUST remain absent from the map.
64. One exact operational relationship MUST have at most one saved `process_map_traces` row in the company map.
65. Every Folder and Process MUST expose exactly one fixed input anchor and exactly one fixed output anchor, and those anchor locations MUST be type-wide presentation rules rather than saved trace data.
66. Every trace MUST leave its source through the source resource's one output anchor and enter its target through the target resource's one input anchor, with no alternate sides or per-trace anchor selection.
67. Trace route geometry MUST be one ordered JSONB array of intermediate points expressed as snapped integer grid coordinates.
68. Trace JSONB MUST NOT copy endpoint resource IDs, resource types, names, permissions, operational direction, or other source payload.
69. Trace endpoint coordinates MUST be derived from current placements and the fixed input and output anchors and MUST NOT be duplicated in the route-point array.
70. A trace route MUST be read and replaced as one small atomic value, and the first version MUST NOT add bend, segment, junction, net, or route-node tables.
71. One-to-many flow MUST use several pairwise operational relationships whose traces MAY share the same route prefix.
72. Many-to-one flow MUST use several pairwise operational relationships whose traces MAY share the same route suffix.
73. An intentional visual junction MUST use the same explicit snapped grid point in every participating trace route.
74. A geometric crossing without a shared explicit route point MUST NOT be treated as a junction or operational relationship.
75. A visual junction or shared trunk MUST NOT become a Folder, Process, generic business resource, or operational relationship endpoint.
76. Rerouting the intermediate route points of a trace without changing its operational endpoints MUST preserve the operational relationship and increment the trace revision.
77. Trace saves MUST use last-committed-save-wins behavior and MUST NOT reject a save merely because the client read an older revision.
78. Every trace MUST record database-generated `created_timestamp` and `updated_timestamp` values.
79. Trace creation MUST set both trace timestamps, and a successful trace edit MUST preserve `created_timestamp` and advance `updated_timestamp`.
80. A failed trace write MUST change neither its route, revision, nor timestamps.
81. Deleting a selected trace in the Process Map UI MUST atomically delete its operational relationship and dependent saved trace while preserving both endpoint resources and their placements.
82. The first version MUST NOT expose a user command that deletes only saved trace geometry while preserving that trace's operational relationship.
83. Removing a placement or changing its map parent MUST remove every incident trace that is no longer valid on the former layer and MUST preserve the underlying operational relationships.
84. A trace MUST render only when both exact endpoints have placements on the current layer and both endpoints are visible to the current user.
85. Every Process Map read, direct layer navigation, and mutation MUST enforce the normal Mango permission system.
86. Adding, moving, or removing a placement MUST require Edit access to the placed resource.
87. Changing a placement's map parent MUST also require Edit access to the destination Folder.
88. Creating, rerouting, removing, or deleting an operational relationship or trace MUST require Edit access to both exact endpoints.
89. As an explicit Process Map permission exception, a mapped item the current user cannot access MUST remain visible at its saved position as a rectangle containing only `?`.
90. Every restricted `?` placeholder MUST use one uniform rectangle footprint that does not vary with the hidden resource type.
91. A restricted `?` placeholder intentionally discloses only that one mapped item exists at that saved position.
92. A restricted `?` placeholder MUST display no name, resource type, type-specific dimensions, icon, canonical ID, contents, metadata, anchors, route points, direction, or neighboring endpoint information.
93. A restricted `?` placeholder MUST be noninteractive and MUST NOT allow selection, opening, editing, movement, trace creation, or drill-in navigation.
94. Mango MUST omit every operational relationship and trace touching an endpoint the current user cannot access.
95. Directly opening a Folder layer the current user cannot access MUST follow the normal inaccessible-resource response and MUST NOT return that layer's placements or traces.
96. Traces MUST render below map items so that items remain the top interactive layer.
97. The Process Map background MUST be very white.
98. The background MUST use one uniform smallest-square grid whose lines have one color and weight, with no emphasized large-square or two-by-two grouping.
99. Every accessible Folder and Process card MUST render as a neutral elevated surface above the grid.
100. The background grid MUST move and scale with the map viewport while the user pans and zooms.
101. The first Process Map version MUST NOT include a minimap.
102. The first Process Map version MUST omit decorative infographic ribbons, ornamental paths, and visuals that do not represent map data.
103. The new Process Map MUST NOT restore, depend on, or add compatibility behavior for the removed Node Map or Logic Gate Map implementations.
104. One trace route-point array MUST contain at most 256 points, and every point MUST be an object with exactly the signed integer fields `x` and `y`.
105. Repeating a trace save with the same exact ordered route points MUST return the existing trace without advancing its revision or timestamps.
106. The first Process Map version MAY allow placement cards to overlap and MUST NOT add automatic collision repair or automatic layout.
107. Every Process Map manual-add entry point MUST use the existing exact-resource Company Explorer drag payload, whether the drag starts in Company Explorer, the current-layer placement tray, or the Folder-header Universal picker, and MUST NOT add a separate placement or candidate-search API; releasing a drag over any fixed Process Map UI instead of the map canvas MUST NOT create a placement.
108. The Process Map editor SHOULD use orthogonal circuit-style trace routing where practical while preserving the one bounded integer route-point array as the only saved geometry.
109. Every restricted placeholder MUST occupy one fixed four-by-three smallest-grid-square rectangle regardless of its hidden resource type.
110. The fixed input anchor MUST touch the physical center of the accessible card's left side and the fixed output anchor MUST touch the physical center of its right side, with no visible gap before a trace.
111. The Process Map frontend MAY use `@xyflow/react` for interaction and rendering, but Mango-owned placements, relationships, and traces MUST remain the only persisted map state; React Flow's graph JSON and viewport MUST NOT be persisted.
112. Every visible trace MUST render below cards as an orthogonal cyan-to-blue surface exactly one smallest grid square thick, using the same gradient stops as the Node icon.
113. A successful placement, relationship, or trace mutation MUST update the initiating mounted map from its committed response and MUST NOT echo a redundant realtime reload to that exact originating connection; every other current company connection MUST receive one compact invalidation, source and visibility changes MUST invalidate every affected viewer, and Process Map MUST NOT poll.
114. Every Folder layer MUST display its complete visible Process Map path from the root-most mapped ancestor through the current Folder, and every visible ancestor name MUST navigate directly to that Folder layer.
115. Folder path ancestry MUST follow only saved Process Map parentage, MUST NOT use Company Explorer parentage or load the full tree, and MUST omit the entire ancestor list when any ancestor is missing or inaccessible.
116. The root placement tray MUST list only authorized immediate Company Explorer root Folders, and a Folder-layer tray MUST list only authorized immediate child Folders and Processes from that exact Folder branch; neither tray may include descendants, Projects, Nodes, or other resource types, and an expanded tray MUST reconcile its exact branch on accepted Process Map realtime invalidations.
117. A placement tray item already present as an accessible placement on the current map layer MUST be omitted; a dragged item MUST remain in the tray until its placement save commits, then disappear locally, and MUST become available again when that current-layer placement is removed.
118. The placement tray MUST reuse the existing bounded Company Explorer root or exact-parent child read and existing drag/drop placement path; it MUST NOT load the complete Explorer tree, search for candidates, poll, automatically place items, or automatically lay them out.
119. The placement tray MUST remain fixed to the left side of the Process Map UI while the map pans or zooms; its whole header MUST be the one toggle, its disclosure MUST stay at the header's top-right and point right while collapsed and left while expanded, and its browser-local collapsed preference MUST default to expanded when unset, persist across Process Map layer navigation, and prevent hidden Explorer branch reads while collapsed.
120. Every visible saved or pending trace MUST show one soft moving center pattern over its canonical source-to-target trace with the same direction and cadence; reduced-motion preference MUST stop the animation without hiding or changing the underlying trace or saved map state.
121. A Folder-layer Process Map header MUST expose the shared Universal picker locked to authorized Processes only; its rows MUST be drag-only, MUST emit the existing exact Logic Gate Explorer payload, MUST let that active drag reach only the existing map canvas drop path, and MUST NOT create a placement, reference, or operational relationship from click, Enter, or Tab. The root layer MUST NOT expose this Process-only launcher.
122. Accessible placement anchors MUST be invisible and noninteractive by default; selecting one placement MUST reveal only that placement's input and output anchors, starting a connection gesture MUST reveal every accessible placement anchor, and finishing or canceling the gesture MUST hide every anchor and clear the source placement selection.
123. The Process Map header MUST expose one **Hover mode** checkbox that controls only transient Process data cards; changing it MUST NOT change selection, a pinned card, placement, operational relationships, traces, or saved Process Map state.
124. When Hover mode is checked, hovering an accessible Process MUST show its transient data card immediately to the Process's right and leaving both the Process and card MUST remove it; unchecked hover MUST show no data card.
125. A transient hover data card MUST be read-only; clicking an accessible Process MUST pin its data card regardless of Hover mode, and the pinned card MUST remain visible after the pointer leaves the Process.
126. Every transient or pinned Process data card MUST stay immediately to the right of its Process without covering or disabling the Process's fixed output anchor or its connection hit area, and moving the placement or viewport MUST keep a pinned card attached to that Process.
127. Once a pointer gesture crosses the placement-drag activation threshold or starts a connection gesture, releasing the pointer MUST NOT fire Process click or pin behavior even when snapping or pointer movement leaves the final X-Y position unchanged; only a press and release that remains a click gesture may select the Process and pin its data card.
128. Every transient or pinned Process data card MUST reuse the same complete 31-slice Quality tracker and 31-slice Delivery tracker used by that exact Process's editor; each card letter grid MUST use seven responsive equal-square tracks capped at 154 pixels with one pixel between slices, preserve the same day order and canonical Q/D values, and MUST NOT make Process Map placement rows, React Flow node/rendering state, or browser state another Q/D authority.
129. Only the slices matching the current `America/Los_Angeles` business date MAY be changed from a pinned Process data card by a user with Edit access to that Process; every other slice and every slice in a transient hover card MUST remain visible and read-only.
130. Every Process data card MUST show the canonical Q/D row's final-editor display-name snapshot when present and MUST NOT expose the stored user ID.
131. The bottom of every Process data card MUST show the same resolved Responsible and Accountable user or group labels presented by that exact Process's current canonical RACI view, using the established role colors; it MUST NOT expose internal principal IDs, copy or rewrite an assignment, grant access, or become another RACI authority.
132. At most one Process data card may be pinned; clicking another accessible Process MUST replace the pin, its explicit close action MUST be red, that close action or a click on empty map canvas MUST dismiss it, and a placement drag, connection gesture, viewport change, or Hover mode change MUST NOT dismiss or replace it.
133. Double-clicking an accessible Process, or pressing Enter or Space while that Process is focused, MUST dismiss any pinned or transient data card and open only that exact Process's canonical Logic Gate editor and Kanban page through the shared modal layer; its accessible top-right close action MUST be red, and closing by that action, Escape, or the backdrop MUST preserve the underlying Process Map layer, URL, viewport, placements, and traces.

Last updated: 2026-08-25

# Process Story: A mapped Process reveals its shared daily Q/D card

A user optionally enables Hover mode and receives a transient read-only card while pointing at an accessible Process
↓
A single click that never becomes a placement drag or connection gesture pins the card to the Process's right, while those gestures leave pin state unchanged
↓
The pinned card reads the Process's shared 31-slice Quality and Delivery values, shows the final editor's display name, and permits only the current `America/Los_Angeles` business-day slices when the user has Edit access
↓
Responsible and Accountable appear at the bottom through the Process's current canonical RACI presentation, and no Process Map record becomes another Q/D or RACI authority
↓
A double click closes the data card and opens that Process's canonical Logic Gate page over the still-mounted map, and the red close action returns to the unchanged map
