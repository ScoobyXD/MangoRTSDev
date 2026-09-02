# Current Huddle Node Business Logic Laws

1. A Huddle Node is stored in `huddle_nodes` with its exact company, ID, owning Huddle Logic Gate ID, required `huddle_date`, name, and timestamps.
2. `huddle_date` is a plain calendar `DATE`, is separate from creation time and Action Item due dates, and is not unique.
3. Every Huddle Node belongs to exactly one same-company Huddle Board through `huddle_nodes.huddle_logic_gate_id` and uses the exact internal resource type `huddle_node` everywhere.
4. A new Huddle Node starts with the name **New Huddle Node** and the current Mango business date under the established America/Los_Angeles date behavior.
5. The date migration assigns every existing Huddle Node the America/Los_Angeles calendar date of its creation timestamp.
6. Creation atomically stores the Huddle Node, one canonical empty text box at display order zero, its direct policies, its current normal Logic Gate IDs, and the current KPI IDs under those Logic Gates.
7. `huddle_node_logic_gate_relationships` and `huddle_node_kpi_relationships` are immutable creation-time snapshots.
8. Snapshot reads join captured IDs to current Logic Gate and KPI rows and never copy labels, editor documents, previews, or presentation JSON.
9. Later Huddle Board membership or KPI ownership changes do not rewrite a Huddle Node snapshot, while edits to captured source rows appear on the next read.
10. Recycling or permanently deleting a captured Logic Gate or KPI removes its live typed snapshot edge; restore recreates only an edge captured in the Recycle Bin payload.
11. A Huddle Node has its own editable rich-text workspace in `huddle_node_textboxes`; the `huddle_nodes` row does not duplicate a body document.
12. New text boxes receive increasing stored `display_order`, while every memory and PostgreSQL read orders live boxes by `display_order` descending and then textbox ID descending so newest is always first.
13. Each text box uses the normal Node viewport-height, safety minimum, next-row control, header, editor preview, timeline, add, save, conflict, toolbar, delete, and header-control behavior.
14. The Huddle Node left column always shows its editable text boxes, while the right column toggles between Action Items and the captured Logic Gate/KPI snapshot and defaults to Action Items.
15. Huddle Node text boxes support the Universal Linker, formatting toolbar, inline Entity references, attachments, selection comments, ordinary chats, and the existing Permissions tab.
16. A Huddle Node has no attached-email column, email owner, status, account, pass-to-Logic-Gate control, timeline events, frequency, or period; its Huddle date is its one meeting date.
17. Huddle Node attachments use `attachment_relationships` with `resource_type='huddle_node'`, the exact Huddle Node ID, and the text box ID only as `information_id` origin metadata.
18. Huddle Node text-box chats belong to one exact Huddle Node and text box, never create an email relationship, store exact mentioned user IDs, and allow only one in-flight submit per text box.
19. Reading or changing the workspace, attachments, chats, captured cards, date, or Action Items requires Edit access to that exact Huddle Node.
20. The popup opens almost full screen while leaving the application sidebar visible and provides compact pin, fullscreen, delete, and close actions.
21. The popup header keeps the Huddle Node icon, live Huddle breadcrumb, editable name, RACI cards, and Permissions controls.
22. Clicking a captured normal Logic Gate opens that Logic Gate, and clicking a captured KPI opens the shared KPI editor without changing the snapshot.
23. The required Huddle date control sits immediately to the right of the Add-textbox text box and plus button and commits a selected day immediately.
24. Both Huddle calendars reuse `EditorCalendarDateInput` and its quick calendar mechanics with one shared purple-pink palette centered on `#EA84E5`; no second calendar implementation or hard-coded blue Huddle palette exists.
25. The Action Items column contains two stacked sections named **Created in this Huddle Node** and **Due or Overdue**.
26. **Created in this Huddle Node** contains exactly Action Items whose immutable Source is `resource_type='huddle_node'` and this exact Huddle Node ID.
27. Source provenance, not `entity_relationships`, controls the created section; removing the final inline chip never removes the item from this section.
28. The created section includes completed Action Items because it records what this Huddle Node created.
29. **Due or Overdue** starts from the owning Huddle Board's current canonical rollup: direct Board Action Item edges plus all owned Huddle Node Action Item edges, deduplicated.
30. The due section includes only current incomplete Action Items with a nonempty Completion due date on or before the active viewing date.
31. Analysis due date, missing Completion due date, future Completion due date, and done or completed status never qualify for the due section.
32. An Action Item already shown in the created section is excluded from the due section.
33. The due section orders leaf rows by oldest Completion due date first inside every final selected group and globally when grouping is empty.
34. The viewing-date filter always evaluates the current Board rollup and current statuses; it is not a historical snapshot.
35. The due section header has its own compact calendar control beside its grouping controls.
36. Opening a Huddle Node initializes the temporary viewing date from persisted `huddle_date`; a choice survives while that Node remains open and resets from `huddle_date` when the Node is reopened.
37. Selecting a viewing date immediately changes only the due section and never updates `huddle_date` or a saved view.
38. The viewing-date popup provides no reset-to-Huddle-date command.
39. The active viewing day uses the normal filled selection and `aria-pressed`; the persisted Huddle date independently keeps a thin non-focus-conflicting outer ring and accessible **Huddle Node date** text.
40. When both dates match, the day shows both the filled selection and the separate outer ring, while Today keeps its own established accessible meaning.
41. The Board, created, and due Action Item sections each own independent grouping, leaf-ordering, displayed-field settings, grouping icon, loading, error, empty, and refresh state.
42. `saved_views.surface='huddle_logic_gate_action_items'` remains one user/company singleton for all Huddle Boards and is displayed as **Huddle Board Action Items**.
43. The two Huddle Node singleton surfaces are `huddle_node_created_action_items` and `huddle_node_due_action_items`; no resource ID is stored in either preference row.
44. The obsolete `huddle_node_action_items` surface and its rows are removed without a compatibility reader or inferred migration to either new meaning.
45. Groupings stay in `groupings`; leaf `ordering` and ordered `displayed_fields` stay in settings, with duplicate terms and grouping/ordering overlap rejected.
46. Each section automatically reconciles after Action Item creation, canonical inline-reference changes, listed-field changes, Huddle Node date changes, Board or sibling membership changes, and established realtime invalidation.
47. Ordinary rich-text typing does not reload either list, and request generations prevent an older overlapping read from replacing a newer result.
48. Huddle Node editor and chat saves or deletions atomically derive exact `entity_relationships` from all live text boxes and saved chats; repeated references share one row and removing the last reference removes only that edge.
49. The Board rollup remains the union of direct Board edges and all owned Huddle Node edges; no Action Item ID is copied into snapshot tables or another relationship authority.
50. Highlighted text may create a yellow or red Action Item, seed Details, preserve the exact Huddle Node Source, and replace the selection with one inline Entity label.
51. Clicking an inline or listed Action Item opens the shared compact autosaving editor with existing fields, accessible controls, viewport clamping, and no Save button.
52. Completed rows are green while retaining their original red or yellow Action Item icon, permission-safe Source label, selected grouping hierarchy, and ordered nonwrapping inline fields.
53. Huddle Node deletion moves the Node, date, text boxes, chats, snapshot edges, Entity relationships, attachments, and restorable direct policies to the Recycle Bin; restore reuses the same IDs and date and creates no Huddle Explorer placement.
54. A Huddle Node cannot exist without its owning Huddle Board and never receives a Company Explorer or Huddle Explorer placement row.
55. An open Huddle Node subscribes only to `huddle-action-items:{huddle_node_id}`; admission and delivery require current Edit access to that exact Node, and a matching compact invalidation triggers a canonical reread rather than carrying list data.
56. Deleting an Action Item permanently removes its Entity fields and relationships through existing company authorization, refreshes affected lists, and leaves its Huddle resources intact.
57. Restoring a Huddle Node restores captured relationships only for Action Items that still exist and never recreates a deleted Action Item or stale edge.

Last updated: 2026-09-01

# Process Story: One dated Huddle Node records created work and current due work separately

An editor creates a Huddle Node from one Huddle Board
↓
Mango atomically stores the Node with today's business date, one canonical text box, direct policy, and immutable Logic Gate/KPI relationship snapshots
↓
The left column edits newest-first text boxes and the required Huddle date through the shared purple-pink calendar
↓
The top Action Item section reads immutable exact-Node Source provenance, while the lower section filters the Board's current deduplicated live rollup by incomplete Completion due date and a temporary viewing date
↓
Independent user-owned saved views control each section's grouping, ordering, and displayed fields without storing a Huddle Node ID or changing relationship truth
↓
Committed local and realtime changes reconcile the relevant lists, stale reads lose, and ordinary rich-text typing leaves the lists alone
