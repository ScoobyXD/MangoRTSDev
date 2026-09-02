# Action Item Business Logic Laws

1. Every company has one required Action Item Entity Type and the seven required fields `person_in_charge`, `assigned_by`, `analysis_due_date`, `completion_due_date`, `status`, `color`, and `source`.
2. Person in charge and Assigned by are independent nullable `person` fields whose nonnull value is one exact current company user ID.
3. Assigned by is editable attribution, defaults to null, and is never inferred from creator audit metadata.
4. `entities.created_by_user_id` remains automatic nullable audit metadata even though the compact editor does not display Created by.
5. Direct Entities creation remains allowed and creates the required Source field with a null value.
6. Highlighted-text creation is supported in Node, Logic Gate, Project, Huddle Node, Huddle Board, and KPI editors and in Node, Project, and Huddle Node chats; it records the exact owning resource as immutable Source.
7. Source is the nullable protected `source` / `Source` / `resource` Entity Field and contains only one canonical same-company `{resource_type, resource_id}` pair.
8. The only Source resource types are `node`, `logic_gate`, `project`, `huddle_node`, `huddle_logic_gate`, and `kpi`.
9. Editor creation validates the exact source and current Edit access and commits the Action Item and all required fields atomically.
10. Source grants no access and resolves its current name and icon only for a currently authorized viewer; every unavailable case returns one neutral state without hidden identity.
11. Renaming a source changes its display without rewriting Source, and adding, removing, or moving an inline chip never changes Source.
12. Recycling preserves Source while making it unavailable, restore resolves it again, and permanent deletion atomically clears matching values.
13. Details is the full-width field at the top of the compact editor; the remaining existing editable and read-only fields retain their two-column layout and autosave behavior.
14. Created date and Source are read-only, both person fields use the current-company picker, and Status preserves the exact `in_progress`, `pending`, and `done` keys.
15. Analysis and Completion due dates are optional and may both be cleared; any supplied date must be valid.
16. My Work Mine contains only active Action Items assigned to the current subject; Delegated contains only active Action Items assigned by that subject to another person.
17. A self-assigned item appears only in Mine, an unassigned item appears in neither perspective, and done or completed items appear in neither active view.
18. My Work grouping and leaf ordering are separate server-owned stacks with the established defaults and user-owned singleton saved views.
19. My Work's Huddle Board grouping derives only from immutable Source: an exact `huddle_logic_gate` Source identifies itself and an exact `huddle_node` Source follows only its required owner.
20. My Work rows may expose only the compact approved inline fields; Details is never inline and unavailable Source or Huddle Board identity leaks no hidden data.
21. The Huddle Board Action Item view shows only incomplete items when Show completed is unchecked and only completed items when checked; other filters still apply.
22. A Huddle Node has two Action Item views: **Created in this Huddle Node** and **Due or Overdue**.
23. Created-in-this-Node reads immutable exact Huddle Node Source provenance, not live `entity_relationships`, and includes completed items.
24. Due-or-Overdue starts from the owning Board's current direct-plus-owned-Node rollup, deduplicates it, and excludes every ID already in the created section.
25. Due-or-Overdue includes only incomplete items with a nonempty Completion due date on or before its temporary viewing date; Analysis due date never qualifies.
26. Due-or-Overdue orders leaves by oldest Completion due date first inside each final group and globally with no grouping.
27. The temporary viewing date starts from persisted Huddle Node date on open, changes only the lower list, is not a historical snapshot, and is never persisted in the Node or `saved_views`.
28. The three Huddle Action Item surfaces are the Board singleton `huddle_logic_gate_action_items`, the Node-created singleton `huddle_node_created_action_items`, and the Node-due singleton `huddle_node_due_action_items`.
29. Each Huddle surface is one row per company and user across every resource of that surface and stores no Board or Node ID.
30. The obsolete `huddle_node_action_items` surface and its rows are deleted without compatibility fallback or guessed inheritance.
31. Huddle grouping terms are stored in `groupings`, while leaf `ordering` and ordered `displayed_fields` are stored in settings; duplicates and grouping/ordering overlap are rejected.
32. Every Huddle section independently owns loading, error, empty, grouping, ordering, displayed fields, and automatic canonical refresh state.
33. Huddle lists reconcile after relevant Source, relationship, title, Completion due date, status, listed-field, Node-date, sibling, Board, and realtime changes; ordinary typing does not reload them and stale reads cannot win.
34. Every selected grouping renders a visible hierarchy header, ordering affects only final leaves, and selected inline fields render in one saved nonwrapping rail.
35. Completed Action Item rows have a green background while their original red or yellow icon and Color field remain unchanged.
36. A company member may permanently delete an Action Item through the existing Entity delete command; its fields and exact relationships are removed, surviving resources remain, and Entity deletion has no Recycle Bin restore.
37. Converting highlighted text preserves the complete Details text; selections longer than the 200 Unicode-character title limit retain their source text with an appended reference, and Action Item chips wrap without an ellipsis.
38. Creating from a posted chat preserves that message and stages an Action Item reference in a reply; sending the reply saves the reference and includes it in the Huddle Board rollup where applicable.
39. Creation keeps the exact owner and selected text captured when the color is clicked; a changed owner or source text prevents insertion into the changed content after creation succeeds.
40. Yellow and red creation actions appear only for highlighted editor or chat text and create immediately without a due-date form.
41. The compact Action Item popup exposes deletion through a trash icon in its top-right header beside Close.
42. New items default to In progress with both people and dates unset; direct creation leaves Source and Color unset while selection creation records its exact Source and chosen color.

Last updated: 2026-09-01

## Process Story

An authorized user highlights editor or chat text and clicks yellow or red to create an Action Item immediately with its exact immutable Source. Dates can be added or cleared later in the compact popup, whose top-right trash icon deletes the item. The Board checkbox switches between incomplete work and completed work. A Huddle Node separately shows all items created from that Node and incomplete Board work due by its temporary viewing date.
