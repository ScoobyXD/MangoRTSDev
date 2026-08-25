# Current Huddle Logic Gate Business Logic Laws

1. A Huddle Logic Gate is stored in `huddle_logic_gates` with `company_id`, `huddle_logic_gate_id`, `header`, `body_json`, `created_timestamp`, and `updated_timestamp`.
2. `body_json` stores one document through the existing Mango TipTap JSON editor contract.
3. A Huddle Logic Gate uses the exact resource type `huddle_logic_gate` and the exact `huddle_logic_gates.huddle_logic_gate_id` everywhere it is referenced.
4. A Huddle Logic Gate cannot be created directly; it is created only by converting an existing normal Logic Gate.
5. The normal Logic Gate **More editor actions** menu contains **Turn into Huddle Logic Gate** for an actor allowed to edit that Logic Gate.
6. Conversion is allowed only when the current Logic Gate editor document is empty, the Kanban board has no Node cards or assignments, and the Logic Gate owns zero KPIs.
7. Default empty Kanban columns do not block conversion; only actual Node work on the board blocks conversion.
8. A failed conversion response lists every blocker that is currently nonempty: the editor, the Kanban board, and/or the KPIs.
9. The conversion command rechecks all three blockers on the backend inside one database transaction.
10. A successful conversion inserts one `huddle_logic_gates` row with the same UUID as the old `logic_gates.logic_gate_id`, copies the old Logic Gate header, and starts `body_json` as the standard empty TipTap document.
11. A successful conversion preserves the exact direct RACI assignments and permission settings by changing their typed owner from `logic_gate` to `huddle_logic_gate` without changing the UUID or principals.
12. A successful conversion removes the old Company Explorer placement and creates one root Huddle Explorer item with `huddle_type='huddle_logic_gate'` and the same exact UUID.
13. A successful conversion permanently removes the old normal Logic Gate row and all old Logic Gate-only storage, including current editor rows, editor history, email links, attachments, input/output links, Kanban storage, and other old relationships.
14. Conversion does not call the normal Logic Gate deletion command and does not create a Recycle Bin item.
15. Conversion is irreversible; the product provides no command to turn a Huddle Logic Gate back into a normal Logic Gate.
16. A Huddle Logic Gate opens on its own `/huddle-logic-gates/{huddle_logic_gate_id}` page while the application left sidebar remains visible.
17. The page header shows the existing Huddle Logic Gate icon and a separate live-derived clickable Huddle hierarchy breadcrumb instead of a fixed **Huddle Logic Gate:** label. The current editable `huddle_logic_gates.header` stays separate from the breadcrumb and keeps its existing save behavior.
18. The page reuses the normal Node and Logic Gate RACI role cards, people-and-group picker, Editor tab, Permissions tab, and shared Mango editor toolbar in its top header area.
19. The shared editor toolbar includes the existing font size, bold, underline, italic, strikethrough, highlight, alignment, alphabetical list, numerical list, dense bullet list, checklist, and table controls.
20. Pin, fullscreen, delete, and close are compact icon actions in the top-right header instead of text buttons.
21. The page has three horizontally resizable columns: the TipTap editor on the left, related normal Logic Gates in the middle, and Huddle Nodes on the right.
22. `huddle_logic_gate_relationships` is the only live authority that links a Huddle Logic Gate to a normal Logic Gate, and each row stores the literal `company_id`, `huddle_logic_gate_id`, and `logic_gate_id`.
23. A Huddle Logic Gate may link to many normal Logic Gates, and the same normal Logic Gate may link to many Huddle Logic Gates.
24. One exact Huddle Logic Gate and normal Logic Gate pair has at most one row, and repeating the link command is idempotent.
25. Adding or removing a Logic Gate relationship changes only that relationship and does not create, delete, copy, or grant access to either endpoint or any KPI.
26. The middle column uses one two-section card for every currently linked Logic Gate: the top shows the Logic Gate and the bottom shows small cards for that Logic Gate's current KPIs.
27. The middle-column plus button opens the existing Universal Picker in locked `##` link mode with the Logic Gate tab active; the Node, Project, and Email tabs remain visible but disabled.
28. Choosing a Logic Gate in that picker creates only the exact `huddle_logic_gate_relationships` row and inserts no editor text or generic relationship.
29. Removing a Logic Gate card deletes only the exact relationship and does not rewrite any previously created Huddle Node snapshot.
30. The middle column reads the current Logic Gate header and current KPI set when it loads; it uses no background stream and no copied display payload.
31. The right column contains a **Create Huddle Node** action that immediately creates **New Huddle Node** without a prompt, and one single-click card for each Huddle Node owned by this Huddle Logic Gate.
32. Huddle Logic Gates use the existing RACI and permission tables with direct typed ownership, but do not expose **Apply to descendants** or **Apply to descendants including customized** actions.
33. Deleting a Huddle Logic Gate is blocked while it owns any Huddle Nodes.
34. Deleting an empty Huddle Logic Gate moves it, its live Logic Gate relationships, its restorable direct policies, and its Huddle Explorer placement to the Recycle Bin; restoring it reuses the same UUID and exact relationships.
35. Realtime current-audience resolution recognizes `huddle_logic_gate` and resolves its users from that Huddle Logic Gate's direct typed permission policy.
36. Single-clicking the normal Logic Gate section of a middle-column card opens that exact Logic Gate on its normal full-page route.
37. Single-clicking a KPI section of a middle-column card opens that exact KPI in the shared KPI editor popup.
38. A normal Logic Gate shows its currently related Huddle Logic Gates by reading the same live relationship rows in the reverse direction.
39. The normal Logic Gate's Huddle plus button opens the shared Universal Picker in locked `##` mode with only Huddle Logic Gates enabled, and choosing one creates the same exact idempotent relationship edge.
40. Every Huddle Logic Gate card on a normal Logic Gate shows the shared Huddle Logic Gate icon and current header, and opening or removing that card never copies or deletes either endpoint.
41. KPI cards shown inside Huddle Logic Gate and Huddle Node cards use the shared orange, red, and yellow KPI chart icon.

Last updated: 2026-08-25

# Process Story: Link current Logic Gates and capture a Huddle Node

An editor uses the middle-column plus button and chooses one normal Logic Gate through the locked `##` Universal Picker
↓
Mango creates one typed `huddle_logic_gate_relationships` row and shows the shared Logic Gate card with its current KPI cards
↓
Creating a Huddle Node atomically records the current Logic Gate and KPI identities for that new Huddle Node
↓
The Huddle Logic Gate stays live, while the Huddle Node keeps that creation-time relationship set and reads current displayed Logic Gate and KPI fields when opened
