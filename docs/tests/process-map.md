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
36. Every accessible Folder MUST be a fixed point-up hexagon occupying exactly five by five smallest grid squares.
37. Every accessible Process MUST be a fixed rectangle occupying exactly four by three smallest grid squares.
38. Folder and Process dimensions MUST NOT be user-adjustable or stored as placement data in the first version.
39. The first Process Map version MUST use neutral item styling and MUST NOT add semantic item colors.
40. A single click on an accessible map item MUST select that item.
41. A double click on an accessible Folder MUST navigate to that Folder's Process Map layer.
42. A Process MUST be a leaf on Process Map and MUST NOT open a Process Map Node layer in the first version.
43. Panning or zooming MUST change only the current map viewport and MUST NOT enter or leave a Folder or change saved placement coordinates.
44. The root layer and every Folder layer MUST have a stable and directly openable URL.
45. Every double-click drill-in MUST navigate to the destination Folder layer's URL and add that navigation to browser history.
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
59. `resource_operational_relationships` MUST replace the same Process-to-Process business meaning currently stored by `logic_gate_relationships` through one forward-only cutover with no dual writes, compatibility reads, fallback reads, or second live authority.
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
83. Removing a placement MUST remove traces on that placement's former layer that touch it and MUST preserve the underlying operational relationships.
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
98. Every large background grid square MUST be divided into four equal smallest squares in a two-by-two arrangement.
99. The background grid MUST use subtle light and shadow to feel like one gently elevated surface rather than a flat dark grid or separate raised tiles.
100. The background grid MUST move and scale with the map viewport while the user pans and zooms.
101. The first Process Map version MUST NOT include a minimap.
102. The first Process Map version MUST omit decorative infographic ribbons, ornamental paths, and visuals that do not represent map data.
103. The new Process Map MUST NOT restore, depend on, or add compatibility behavior for the removed Node Map or Logic Gate Map implementations.

Last updated: 2026-08-24
