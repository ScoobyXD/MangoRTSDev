# Current KPI Business Logic Laws

1. A KPI is stored in `kpis` with `company_id`, `kpi_id`, `logic_gate_id`, `name`, `body_json`, `created_timestamp`, and `updated_timestamp`.
2. Every KPI belongs to exactly one normal Logic Gate in the same company through the literal `logic_gate_id`.
3. KPIs are tailored to their owning Logic Gate and are not reusable generic KPI definitions.
4. One normal Logic Gate may own any number of KPIs.
5. A KPI name must be nonblank.
6. `body_json` stores one document through the existing Mango TipTap JSON editor contract.
7. A normal Logic Gate shows a thin **KPI** section directly below its RACI cards.
8. The KPI section contains a square plus button that opens a minimal **Create KPI** popup with only the KPI name and body editor.
9. Creating a KPI writes one `kpis` row for the exact open Logic Gate and immediately adds its card to that Logic Gate's KPI section.
10. A KPI card shows the KPI name and a short gray preview derived from the body document.
11. Double-clicking a KPI card opens a small KPI popup containing only the editable name, the body editor, and a top-right close button.
12. Right-clicking a KPI card exposes a delete action for that exact KPI.
13. KPI reads, edits, and deletion are authorized through the owning normal Logic Gate; a KPI has no independent RACI or permission rows.
14. Deleting a KPI moves it to the Recycle Bin, and restoring it reuses the same KPI ID and owning Logic Gate.
15. A normal Logic Gate with one or more KPIs cannot be converted into a Huddle Logic Gate.
16. The first version has no KPI type, target, measurement, unit, formula, reusable definition, chart model, graph model, date model, history, or Huddle aggregation.

Last updated: 2026-08-10
