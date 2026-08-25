# Current Huddle Node Business Logic Laws

1. A Huddle Node is stored in `huddle_nodes` with `company_id`, `huddle_node_id`, `huddle_logic_gate_id`, `name`, `created_timestamp`, and `updated_timestamp`.
2. A Huddle Node is a read-only relationship snapshot and has no `body_json`, TipTap editor document, or `huddle_node_textboxes` storage.
3. Every Huddle Node belongs to exactly one Huddle Logic Gate in the same company through the literal `huddle_logic_gate_id`.
4. A Huddle Node uses the exact resource type `huddle_node` and the exact `huddle_nodes.huddle_node_id` everywhere it is referenced.
5. A Huddle Node can be created only from the **Create Huddle Node** action in a Huddle Logic Gate's right column.
6. Clicking **Create Huddle Node** immediately creates one Huddle Node named **New Huddle Node** without asking for a name.
7. `huddle_node_logic_gate_relationships` stores the exact normal Logic Gates linked to the owning Huddle Logic Gate when the Huddle Node is created.
8. `huddle_node_kpi_relationships` stores the exact KPIs owned by those captured Logic Gates when the Huddle Node is created.
9. Huddle Node creation, its owning `huddle_logic_gate_id`, its direct policies, its Logic Gate relationship rows, and its KPI relationship rows commit or roll back in one transaction.
10. A Huddle Node's captured Logic Gate and KPI relationship sets are immutable after creation; later Huddle Logic Gate links and later KPIs do not enter an existing Huddle Node.
11. The snapshot stores no copied Logic Gate header, KPI name, KPI document, preview, or presentation JSON.
12. Opening or refreshing a Huddle Node joins its captured identities to the current Logic Gate and KPI rows, so edits to displayed source fields appear on the next read without a live stream.
13. Removing a live Huddle Logic Gate relationship does not alter an existing Huddle Node snapshot.
14. Recycling a captured Logic Gate or KPI removes its live snapshot edge through its typed foreign key, and restoring that source restores the exact captured edge from the Recycle Bin payload.
15. Permanently deleting a captured Logic Gate or KPI permanently removes its Huddle Node snapshot edge; no stale placeholder or copied label remains.
16. The owning Huddle Logic Gate's right column shows Huddle Nodes as a simple vertical list of cards.
17. Clicking a Huddle Node card once opens that exact Huddle Node in a Huddle Node popup.
18. The popup opens almost full screen by default while leaving the application's left sidebar visible.
19. The popup header shows the existing Huddle Node icon and a separate live-derived clickable Huddle hierarchy breadcrumb instead of a fixed **Huddle Node:** label. The current editable `huddle_nodes.name` stays separate from the breadcrumb and keeps its existing save behavior; the popup still reuses the normal Node and Logic Gate RACI role cards, people-and-group picker, Permissions tab, and compact top-right actions.
20. The popup has two horizontally resizable columns: the shared read-only Logic Gate and KPI card list on the left and an empty area reserved for a later chat feature on the right.
21. The Huddle Node left column uses the exact same two-section Logic Gate and KPI card component as the Huddle Logic Gate middle column.
22. Pin, fullscreen, delete, and close are compact icon actions in the top-right header instead of text buttons.
23. Huddle Nodes use the existing RACI and permission tables with direct typed ownership, but do not expose descendant policy actions.
24. Deleting a Huddle Node moves the Node, its snapshot relationships, and its restorable direct policies to the Recycle Bin; restoring it reuses the same UUID and owning Huddle Logic Gate and creates no Huddle Explorer placement.
25. A Huddle Node cannot exist without its owning Huddle Logic Gate.
26. The first version has no editable body, copied KPI data, frequency, period, timeline events, background synchronization, or chat behavior.
27. Realtime current-audience resolution recognizes `huddle_node` and resolves its users from that Huddle Node's direct typed permission policy.
28. Single-clicking the normal Logic Gate section of a left-column snapshot card closes the Huddle Node popup and opens that exact Logic Gate on its normal full-page route.
29. Single-clicking a KPI section of a left-column snapshot card opens that exact KPI in the shared KPI editor popup without changing the captured snapshot set.

Last updated: 2026-08-25

# Process Story: A Huddle Node freezes relationships but reads current source data

An editor creates a Huddle Node from one Huddle Logic Gate
↓
Mango atomically stores that Huddle Node, its policies, every current linked Logic Gate ID, and every current KPI ID under those Logic Gates
↓
The Huddle Node left column renders the same shared Logic Gate and KPI cards as the Huddle Logic Gate middle column
↓
Later membership additions stay out of the old Huddle Node, while later edits to already captured Logic Gates and KPIs appear on the next load
