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
17. The page title starts with **Huddle Logic Gate:** and keeps the editable Huddle header beside that fixed label.
18. The page reuses the normal Node and Logic Gate RACI role cards, people-and-group picker, Editor tab, Permissions tab, and shared Mango editor toolbar in its top header area.
19. The shared editor toolbar includes the existing font size, bold, underline, italic, strikethrough, highlight, alignment, alphabetical list, numerical list, dense bullet list, checklist, and table controls.
20. Pin, fullscreen, delete, and close are compact icon actions in the top-right header instead of text buttons.
21. The page has three horizontally resizable columns: the TipTap editor on the left, an empty middle column, and the Huddle Node list on the right.
22. The right column contains a **Create Huddle Node** action that immediately creates **New Huddle Node** without a prompt, and one single-click card for each Huddle Node owned by this Huddle Logic Gate.
23. Huddle Logic Gates use the existing RACI and permission tables with direct typed ownership, but do not expose **Apply to descendants** or **Apply to descendants including customized** actions.
24. Deleting a Huddle Logic Gate is blocked while it owns any Huddle Nodes.
25. Deleting an empty Huddle Logic Gate moves it and its restorable direct policies and Huddle Explorer placement to the Recycle Bin; restoring it reuses the same UUID.
26. The first version has no Huddle settings, frequency, regular Logic Gate membership, KPI aggregation, snapshots, timeline, chat, or automatic Huddle Node creation.

Last updated: 2026-08-11
