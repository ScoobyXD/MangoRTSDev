# Current Huddle Node Business Logic Laws

1. A Huddle Node is stored in `huddle_nodes` with `company_id`, `huddle_node_id`, `huddle_logic_gate_id`, `name`, `body_json`, `created_timestamp`, and `updated_timestamp`.
2. `body_json` stores one document through the existing Mango TipTap JSON editor contract.
3. Every Huddle Node belongs to exactly one Huddle Logic Gate in the same company through the literal `huddle_logic_gate_id`.
4. A Huddle Node uses the exact resource type `huddle_node` and the exact `huddle_nodes.huddle_node_id` everywhere it is referenced.
5. A Huddle Node can be created only from the **Create Huddle Node** action in a Huddle Logic Gate's right column.
6. Creation requires only a nonblank name; all other Huddle Node content starts empty.
7. Creating a Huddle Node and its root `huddle_explorer_items` placement commits or rolls back as one transaction.
8. The owning Huddle Logic Gate's right column shows Huddle Nodes as a simple vertical list of cards.
9. Double-clicking a Huddle Node card opens that exact Huddle Node in a Huddle Node popup.
10. The popup opens almost full screen by default while leaving the application's left sidebar visible.
11. The Huddle Node surface keeps its header, direct RACI cards, Editor tab, Permissions tab, shared editor toolbar, pin-to-tab action, fullscreen action, delete action, and close action.
12. The shared editor toolbar includes the existing font size, bold, underline, italic, strikethrough, highlight, alignment, alphabetical list, numerical list, dense bullet list, and checklist controls.
13. The popup has two columns: the TipTap editor on the left and an empty area reserved for a later chat feature on the right.
14. Huddle Nodes use the existing RACI and permission tables with direct typed ownership, but do not expose **Apply to descendants** or **Apply to descendants including customized** actions.
15. Deleting a Huddle Node moves the Node, its restorable direct policies, and its Huddle Explorer placement to the Recycle Bin; restoring it reuses the same UUID and owning Huddle Logic Gate.
16. A Huddle Node cannot exist without its owning Huddle Logic Gate.
17. The first version has no KPI copies, KPI snapshots, frequency, period, timeline events, or chat behavior.

Last updated: 2026-08-10
