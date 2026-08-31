# Current Huddle Board Business Logic Laws

1. A Huddle Board is stored canonically in `huddle_logic_gates` with exact company, Huddle Logic Gate ID, header, body JSON, and timestamps.
2. `body_json` stores one document through the existing Mango TipTap JSON editor contract.
3. Internal references keep the exact `huddle_logic_gate` type and `huddle_logic_gates.huddle_logic_gate_id`; the product displays **Huddle Board** and **Huddle Boards**.
4. Every visible Huddle Board surface uses one shared Board/columns icon; no people-plus-Logic-Gate composite remains.
5. A Huddle Board may be created directly from the Huddle Boards sidebar or by converting an eligible normal Logic Gate.
6. The normal Logic Gate action menu contains **Turn into Huddle Board** for an actor allowed to edit that Logic Gate.
7. Conversion is allowed only when the editor document is empty, the Kanban board has no Node cards or assignments, and the Logic Gate owns no KPIs.
8. Default empty Kanban columns do not block conversion, and a failure lists every current editor, board, or KPI blocker.
9. The conversion command rechecks every blocker inside one database transaction.
10. Conversion inserts one `huddle_logic_gates` row with the same UUID and header and starts its body as the standard empty TipTap document.
11. Conversion preserves exact direct RACI assignments and permission settings by changing only their typed owner to `huddle_logic_gate`.
12. Conversion removes the old Company Explorer placement, creates one same-ID root Huddle Explorer item, and permanently removes obsolete normal-Logic-Gate-only storage.
13. Conversion creates no Recycle Bin item and is irreversible.
14. A Huddle Board opens on `/huddle-logic-gates/{huddle_logic_gate_id}` while the application sidebar remains visible.
15. The page header shows the shared Board icon, a live clickable Huddle hierarchy breadcrumb, the editable Board title, RACI cards, permissions, and compact pin, fullscreen, delete, and close actions.
16. The page reuses the shared RACI picker, Editor and Permissions tabs, Mango editor toolbar, and Saved, Pending, and Failed state.
17. The page has three horizontally resizable columns: its editor, a middle Action Items or related-Logic-Gates view, and Huddle Nodes.
18. `huddle_logic_gate_relationships` is the only live authority linking a Huddle Board to normal Logic Gates and stores literal same-company IDs.
19. A Huddle Board may link to many normal Logic Gates, one normal Logic Gate may link to many Boards, and one exact pair has one idempotent row.
20. Adding or removing a relationship changes only that edge and never copies, deletes, or grants access to an endpoint or KPI.
21. The related-Logic-Gates view shows each current Logic Gate with its current KPI cards and stores no copied display payload.
22. Its plus action uses the Universal Picker in locked `##` Logic Gate mode and creates only the exact typed relationship.
23. Removing a related Logic Gate never rewrites a previously created Huddle Node snapshot.
24. The Huddle Nodes column contains **Create Huddle Node**, immediately creates **New Huddle Node**, and lists every exact owned Huddle Node.
25. A Huddle Board and each Huddle Node use direct typed RACI and permission policies and expose no descendant-application actions.
26. Deleting a Huddle Board is blocked while it owns any Huddle Nodes.
27. Deleting an empty Huddle Board recycles its resource, live Logic Gate relationships, direct Entity relationships, direct policies, attachments, and Explorer placement for exact-ID restore.
28. An open Huddle Board subscribes only to `huddle-board-action-items:{huddle_logic_gate_id}`; admission and delivery require current Edit access to that exact Board, and a matching compact invalidation triggers a canonical reread rather than carrying list data.
29. Clicking a related Logic Gate or KPI opens that exact canonical resource without changing any Huddle relationship or snapshot.
30. A normal Logic Gate reads its related Huddle Boards through the same relationship rows and uses the shared Board icon and current Board title.
31. Direct Board creation atomically inserts the standard empty document, direct policy settings, and same-ID root Huddle Explorer placement.
32. The Board editor uses canonical 500 ms autosave, Universal Picker references, selection Action Item creation, and typed S3 inline-image attachments.
33. A Board attachment uses `resource_type='huddle_logic_gate'` and the exact Board ID; no compatibility owner is substituted.
34. The Board Action Items view unions direct Board Action Item relationships with all owned Huddle Node relationships and deduplicates each exact item once.
35. The Board Action Items view keeps its existing cumulative behavior and never filters by Huddle Node date.
36. Every company/user has at most one `saved_views.surface='huddle_logic_gate_action_items'` row, displayed as **Huddle Board Action Items**, and that preference applies across all Boards.
37. Board grouping terms stay in `groupings`; leaf `ordering` and ordered `displayed_fields` stay in settings, with no browser-only preference authority.
38. Board Action Items default to visible Color then Person in charge groups, Completion due date leaf ordering, and Person in charge then Completion due date inline fields.
39. Grouping creates visible hierarchy, ordering affects only final leaves, and inline fields keep saved left-to-right order in one nonwrapping rail.
40. Every listed item keeps the shared Action Item icon, semantic red/yellow treatment, exact Entity identity, and permission-safe Source presentation.
41. Board Action Items automatically reconcile after relevant local canonical commits and established realtime invalidation while older overlapping reads cannot replace newer results.
42. Each committed Board editor save atomically replaces that exact Board's Action Item `entity_relationships` set from saved inline references.
43. Removing the final saved reference removes only the exact Board edge and preserves the Action Item Entity and immutable Source.

Last updated: 2026-08-31

# Process Story: Create a Huddle Board and manage its live work

An editor creates a Huddle Board from the sidebar or converts an eligible Logic Gate
↓
Mango atomically stores the exact canonical Huddle Logic Gate identity, direct policy, and Huddle Explorer placement
↓
The shared editor autosaves text, references, and typed attachments while the Action Items view reads the exact current Board rollup with the user's Board-wide presentation preference
↓
The Board may link normal Logic Gates, every Huddle Node keeps its fixed creation-time Logic Gate/KPI snapshot, and no presentation control changes relationship truth
