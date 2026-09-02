# Current Huddle Boards Explorer Business Logic Laws

1. The application sidebar order is Pinned, Huddle Boards, Tower, then Organization.
2. The **Huddle Boards** heading and every Huddle Board row use the shared Board/columns icon; Huddle Nodes retain the existing Node icon.
3. Huddle Explorer is separate from Company Explorer and uses `huddle_explorer_folders` and `huddle_explorer_items` as its only Huddle Board placement authorities.
4. `huddle_explorer_folders` contains exact company, folder, optional parent-folder, name, and timestamp values.
5. A folder may be at root or under one exact same-company Huddle folder and must reject self-parenting, cross-company parents, and cycles.
6. `huddle_explorer_items.resource_huddle_resource_id` is the literal `huddle_logic_gates.huddle_logic_gate_id`; no translated or registry identity is allowed.
7. The retained `huddle_type` is exactly `huddle_logic_gate` for every live item, and a Huddle Node has no Huddle Explorer item.
8. One Huddle Board has at most one live Huddle Explorer placement, at root or under one exact same-company folder.
9. Directly creating or converting a Huddle Board creates its same-ID root placement in the same transaction.
10. Creating, updating, deleting, or restoring a Huddle Node never creates or restores a Huddle Explorer item.
11. The Huddle Boards section header exposes exactly two direct actions labeled **+ Board** and **+ Folder**.
12. Successful Board creation opens that exact new Huddle Board.
13. The section shell, text scale, spacing, row hover, and elevation follow the Pinned section.
14. Folder rows follow Company Explorer presentation: plain disclosure chevron, folder icon, title, normal indentation, and no boxy fieldset or corner container.
15. No Huddle folder or Board row shows a Root selector, plus button, pencil button, or X button.
16. Dragging a folder or Huddle Board onto a folder row moves it into that exact folder through the canonical Explorer move command.
17. Drag-and-drop preserves the existing deterministic date-and-name ordering and adds no custom position schema.
18. Folder drop validation preserves same-company ownership and cycle protections and performs no partial invalid move.
19. A Huddle Board context menu contains exactly **Open in new browser tab**, **Rename**, and **Remove from Huddle Boards**.
20. Open in new browser tab uses the existing deep-link route and applies only to Board rows; folders receive no invented route.
21. Rename updates only the exact selected Board or folder through its established command.
22. Remove from Huddle Boards recycles only the canonical Explorer placement, matching the former placement X behavior, and never deletes the Board or any Huddle Node.
23. Actual **Delete Huddle Board** remains available only inside the Huddle Board resource surface.
24. A folder context menu contains exactly **Create folder inside**, **Rename**, and **Delete empty folder**.
25. Folder deletion is allowed only when the folder is empty, recycles only that folder, and never recursively removes a subtree or contained resource.
26. Recycle and restore preserve the exact promised Board placement or empty folder identity and parent without creating a second authority.
27. Huddle placement and folder nesting grant no permission, RACI role, or policy parentage.
28. Clicking a Board row opens the exact Board; search can return Huddle Boards and Huddle Nodes using their canonical internal types and IDs.
29. Breadcrumbs derive from current placement and exact Huddle Node ownership, hide an unsafe or inaccessible path, and preserve established reveal and hierarchy-change refresh behavior.
30. Huddle Boards and Huddle Nodes never receive Company Explorer item rows.
31. A successful Board move reloads its saved placement and expands the destination's folder ancestry; a failed move shows the error and keeps the current placement.
32. Dragging a folder or Board onto the existing **Huddle Boards** heading moves it to the top level without adding a temporary drop row.
33. Dragging uses Company Explorer's native row behavior, dimmed source, and highlighted destination; a drag never opens the Board.
34. Cancelling a drag, dropping into the current parent, or using an invalid destination makes no move request.

Last updated: 2026-09-01

# Process Story: Huddle Boards use one simple draggable sidebar tree

An editor creates a Huddle Board or folder from the Huddle Boards header
↓
Mango stores one exact Huddle Explorer placement or folder relationship and renders it with the shared Board or folder icon
↓
The user drags a row onto a folder to move it inside, or onto the Huddle Boards heading to move it back to the top level; the row-specific context menu keeps rename, placement-only removal, new-tab opening, and empty-folder actions
↓
Every action keeps Huddle resource identity, Huddle Node ownership, permissions, RACI, breadcrumbs, recycle, and deterministic ordering under their existing canonical authorities
