# Current KPI Business Logic Laws

1. A KPI is stored in `kpis` with `company_id`, `kpi_id`, `logic_gate_id`, `name`, `body_json`, `created_timestamp`, and `updated_timestamp`.
2. Every KPI belongs to exactly one normal Logic Gate in the same company through the literal `logic_gate_id`.
3. KPIs are tailored to their owning Logic Gate and are not reusable generic KPI definitions.
4. One normal Logic Gate may own any number of KPIs.
5. A KPI name must be nonblank.
6. `body_json` stores one document through the existing Mango TipTap JSON editor contract.
7. A normal Logic Gate shows a thin **KPI** section directly below its RACI cards.
8. Clicking the KPI section's square plus button immediately creates one KPI named **New KPI** for the exact open Logic Gate and adds its card without opening the KPI popup.
9. The new card immediately enters inline name editing, focuses its name, and selects the complete **New KPI** text so typing replaces it and one Backspace clears it.
10. Enter or blur saves a nonblank inline name through the normal KPI update command; a blank inline name is never sent and leaves the saved **New KPI** name unchanged.
11. A KPI card shows the KPI name and a short gray preview derived from the body document.
12. Only double-clicking a KPI card opens a small KPI popup containing only the editable name, the body editor, and a top-right close button.
13. Right-clicking a KPI card exposes a delete action for that exact KPI.
14. KPI reads, edits, and deletion are authorized through the owning normal Logic Gate; a KPI has no independent RACI or permission rows.
15. Deleting a KPI moves it to the Recycle Bin, and restoring it reuses the same KPI ID and owning Logic Gate.
16. A normal Logic Gate with one or more KPIs cannot be converted into a Huddle Logic Gate.
17. A Huddle Logic Gate reaches a KPI only through a live `huddle_logic_gate_relationships` row for that KPI's owning normal Logic Gate.
18. A Huddle Node captures one `huddle_node_kpi_relationships` row for each current KPI under each captured Logic Gate when that Huddle Node is created.
19. A KPI created after a Huddle Node is not added to that existing Huddle Node; a KPI already captured keeps showing its current displayed fields on later reads.
20. Recycling or permanently deleting a KPI removes its live Huddle Node KPI relationship through the typed foreign key; restore recreates the exact relationship only when the Recycle Bin payload contains it.
21. The first version has no KPI type, target, measurement, unit, formula, reusable definition, chart model, graph model, date model, copied Huddle payload, or aggregate calculation.
22. Realtime current-audience resolution maps `kpi` to the exact owning Logic Gate and uses that Logic Gate's current audience. A missing KPI resolves to no audience instead of retrying delivery as a storage failure.

Last updated: 2026-08-11
