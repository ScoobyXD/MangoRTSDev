# Current Huddle Explorer Business Logic Laws

1. The left sidebar contains one **Huddles** section between Tower and Entities with a Huddle people icon in its heading.
2. Huddle Explorer is separate from Company Explorer and uses `huddle_explorer_folders` and `huddle_explorer_items` as its only Huddle Logic Gate placement authorities.
3. `huddle_explorer_folders` contains `company_id`, `folder_id`, `parent_folder_id`, `name`, `created_date`, and `updated_date`.
4. A Huddle Explorer folder may have a null parent for a root folder or the exact `folder_id` of another folder in the same company.
5. Huddle Explorer folder nesting rejects self-parenting, cross-company parents, and cycles.
6. `huddle_explorer_items` contains `company_id`, `huddle_explorer_item_id`, `resource_huddle_resource_id`, `huddle_type`, `parent_folder_id`, `created_date`, and `updated_date`.
7. `resource_huddle_resource_id` is the literal `huddle_logic_gate_id`; no translated or registry ID is allowed.
8. The `huddle_type` column remains required for future Huddle resource types and currently accepts only `huddle_logic_gate`.
9. One Huddle Logic Gate may have at most one live Huddle Explorer item in a company, and a Huddle Node may have none.
10. A Huddle Explorer item may have a null parent for root placement or the exact `folder_id` of a Huddle Explorer folder in the same company.
11. Directly creating a Huddle Logic Gate or converting a normal Logic Gate creates one root Huddle Explorer item for that exact Huddle Logic Gate in the same transaction.
12. Creating, updating, deleting, or restoring a Huddle Node never creates or restores a Huddle Explorer item.
13. Huddle Explorer supports creating, renaming, nesting, moving, and deleting folders, and moving Huddle Logic Gate items between its folders and root.
14. The left-sidebar Huddles section displays every Huddle Explorer item, and one click on a row opens that exact Huddle Logic Gate route.
15. Search Explorer can return Huddle Logic Gates and Huddle Nodes using their exact Huddle types and IDs.
16. Huddle Logic Gates and Huddle Nodes never receive Company Explorer item rows.
17. Deleting only a Huddle Explorer item recycles only that placement and does not delete or recycle the underlying Huddle Logic Gate.
18. Deleting a Huddle Logic Gate removes its live Huddle Explorer item as part of the resource's Recycle Bin payload, and restore recreates that exact typed placement; Huddle Node recycle payloads contain no Explorer item.
19. A Huddle Explorer folder must be empty before it can be deleted; an empty deleted folder goes to the Recycle Bin and restores with the same folder ID and parent.
20. Huddle Explorer placement and folder nesting do not grant access and do not create RACI or permission parentage in the first version.
21. Huddle Explorer ordering uses existing row dates and names; the first version has no custom position or ordering model.
22. Huddle rows match the Pinned section's text scale, color, spacing, raised hover treatment, and elevated section surface.
23. A visible Huddle Logic Gate row combines the normal Logic Gate icon with a Huddle people icon instead of using a separate replacement resource icon.
24. A Huddle Logic Gate or Huddle Node title surface derives its breadcrumb from the current canonical Huddle Explorer placement and exact Huddle ownership when read; no database column, copied full path, or client cache becomes path authority. A Huddle Node follows its owning Huddle Logic Gate's visible placement and adds that Gate as its final ancestor.
25. A Huddle breadcrumb shows the clickable Huddles root followed by every fully visible ancestor, excludes the current item's editable title, and omits the whole hierarchy path when any required ancestor is missing, hidden, recycled, cyclic, or too deep to resolve safely. Clicking a folder reveals that exact Huddle Explorer branch, clicking a Huddle Logic Gate opens that exact Gate, and a committed same-window hierarchy change refreshes mounted breadcrumbs.
26. The Huddles section provides separate direct actions for creating a root Huddle Logic Gate and creating a folder; successful Huddle Logic Gate creation opens that exact new resource.

Last updated: 2026-08-28
