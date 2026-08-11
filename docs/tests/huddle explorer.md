# Current Huddle Explorer Business Logic Laws

1. The left sidebar contains one expandable and collapsible **Huddles** section between Tower and Entities.
2. Huddle Explorer is separate from Company Explorer and uses `huddle_explorer_folders` and `huddle_explorer_items` as its only placement authorities.
3. `huddle_explorer_folders` contains `company_id`, `folder_id`, `parent_folder_id`, `name`, `created_date`, and `updated_date`.
4. A Huddle Explorer folder may have a null parent for a root folder or the exact `folder_id` of another folder in the same company.
5. Huddle Explorer folder nesting rejects self-parenting, cross-company parents, and cycles.
6. `huddle_explorer_items` contains `company_id`, `huddle_explorer_item_id`, `resource_huddle_resource_id`, `huddle_type`, `parent_folder_id`, `created_date`, and `updated_date`.
7. `resource_huddle_resource_id` is the literal `huddle_logic_gate_id` or `huddle_node_id`; no translated or registry ID is allowed.
8. `huddle_type` is required and is exactly `huddle_logic_gate` or `huddle_node`.
9. One Huddle resource may have at most one live Huddle Explorer item in a company.
10. A Huddle Explorer item may have a null parent for root placement or the exact `folder_id` of a Huddle Explorer folder in the same company.
11. Converting a normal Logic Gate creates one root Huddle Explorer item for the new Huddle Logic Gate in the same transaction.
12. Creating a Huddle Node creates one root Huddle Explorer item for the new Huddle Node in the same transaction.
13. Huddle Explorer supports creating, renaming, nesting, moving, and deleting folders, and moving Huddle items between its folders and root.
14. Double-clicking a Huddle Logic Gate item opens that exact Huddle Logic Gate; double-clicking a Huddle Node item opens that exact Huddle Node popup.
15. Search Explorer can return Huddle Logic Gates and Huddle Nodes using their exact Huddle types and IDs.
16. Huddle Logic Gates and Huddle Nodes never receive Company Explorer item rows.
17. Deleting only a Huddle Explorer item recycles only that placement and does not delete or recycle the underlying Huddle Logic Gate or Huddle Node.
18. Deleting a Huddle resource removes its live Huddle Explorer item as part of the resource's Recycle Bin payload; restore recreates the exact typed placement.
19. A Huddle Explorer folder must be empty before it can be deleted; an empty deleted folder goes to the Recycle Bin and restores with the same folder ID and parent.
20. Huddle Explorer placement and folder nesting do not grant access and do not create RACI or permission parentage in the first version.
21. Huddle Explorer ordering uses existing row dates and names; the first version has no custom position or ordering model.

Last updated: 2026-08-10
