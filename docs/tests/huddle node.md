# Current Huddle Node Business Logic Laws

1. A Huddle Node is stored in `huddle_nodes` with its exact company, ID, owning Huddle Logic Gate ID, name, and timestamps.
2. Every Huddle Node belongs to exactly one same-company Huddle Logic Gate through `huddle_nodes.huddle_logic_gate_id` and uses the exact resource type `huddle_node` everywhere.
3. A Huddle Node is created only from its Huddle Logic Gate and starts with the name **New Huddle Node**.
4. Creation atomically stores the Huddle Node, one canonical empty text box at display order zero, its direct policies, its current normal Logic Gate IDs, and the current KPI IDs under those Logic Gates.
5. `huddle_node_logic_gate_relationships` and `huddle_node_kpi_relationships` are immutable creation-time snapshots.
6. Snapshot reads join the captured IDs to current Logic Gate and KPI rows and never copy labels, editor documents, KPI documents, previews, or presentation JSON.
7. Later Huddle membership or KPI ownership changes do not rewrite an existing Huddle Node snapshot, while later edits to already captured source rows appear on the next read.
8. Recycling or permanently deleting a captured Logic Gate or KPI removes its live typed snapshot edge; restore recreates only an edge captured in the Recycle Bin payload.
9. A Huddle Node has its own editable rich-text workspace in `huddle_node_textboxes`; the `huddle_nodes` row itself does not duplicate a body document.
10. The workspace may contain several ordered text boxes. Each text box must use the normal Node's visible-container viewport-height rule, safety minimum, and next-row circle, header, and editor preview. It also uses the same timeline, add, save, revision, conflict, toolbar, delete, and header-control behavior.
11. The Huddle Node left column always shows its editable text boxes, while the right column toggles between Action Items and the captured Process and KPI snapshot and defaults to Action Items.
12. Huddle Node text boxes support the Universal Linker, formatting toolbar, inline Entity references, attachments, selection comments, ordinary chats, and the existing Permissions tab.
13. A Huddle Node has no attached-email column, email owner, due date, status, account, pass-to-Logic-Gate control, timeline events, frequency, or period.
14. Huddle Node attachments use `attachment_relationships` with `resource_type='huddle_node'`, the exact Huddle Node ID, and the text box ID only as `information_id` origin metadata.
15. Huddle Node text-box chats belong to one exact Huddle Node and text box, never create an email relationship, store the unambiguous mentioned user IDs derived from the current message on create and edit, and allow only one in-flight submit per text box.
16. Reading or changing the Huddle Node workspace, attachments, chats, captured cards, or Action Items requires Edit access to that exact Huddle Node; there is no separate read-only Huddle Node permission.
17. The popup opens almost full screen while leaving the application sidebar visible and provides compact pin, fullscreen, delete, and close actions.
18. The popup header keeps the Huddle Node icon, live Huddle breadcrumb, editable Huddle Node name, RACI cards, and Permissions controls.
19. Clicking a captured normal Logic Gate opens that Logic Gate, and clicking a captured KPI opens the shared KPI editor without changing the snapshot.
20. The right column uses the same shared Action Item rollup panel as the Huddle Process view. Its invocation carries the exact `huddle_node` type and this Huddle Node's literal ID, reads the owning Huddle Logic Gate's current live rollup, and refreshes only when saved Action Item references change, a canonical remote reference set changes, or a listed Action Item is edited; ordinary typing never reloads the rollup or editor, and an older overlapping response never replaces a newer one.
21. Each Huddle Node editor save atomically derives `entity_relationships` from all live text boxes and stores one exact same-company Action Item Entity to Huddle Node edge for each Action Item that the Node currently references.
22. Several inline references to the same Action Item in one Huddle Node share one relationship row.
23. Removing one of several references keeps the row, while removing the final reference removes only that Node edge and preserves the company-wide Action Item Entity.
24. The Process rollup unions the owning Huddle Logic Gate's direct `entity_relationships` with every edge from its Huddle Nodes and deduplicates each Action Item once.
25. A surviving direct Huddle Logic Gate reference or sibling Huddle Node reference keeps the Action Item in the rollup, and the same Action Item may appear in several Huddle Processes.
26. Creating a new Huddle Node immediately shows the current parent rollup; no Action Item IDs are copied into the immutable Process or KPI snapshot tables.
27. Highlighting text in a supported editor may create a yellow or red Action Item, seed its Details from that text, and replace the selection with one inline Entity label for the exact created Entity.
28. A yellow inline Action Item label pulses once every two seconds and a red label once every second; reduced-motion preference disables that animation.
29. Clicking an inline or listed Action Item opens the shared compact editor inside that activation point's Huddle modal layer, with one autosaving title, plain Details text, read-only creator metadata, a lower-left searchable current-company Person in charge picker, shared Node text-and-calendar controls for both dates, color options with a square swatch and label, status, a red close X that flushes pending work, and no Save button.
30. Each user and company owns one Huddle Node Action Item saved view, independent of that user's Huddle Process Action Item saved view. Visible grouping terms are stored in `groupings`, while leaf `ordering` and ordered `displayed_fields` are stored in settings; browser-only compatibility preferences are not used.
31. The Huddle Node saved view defaults to visible Color then Person in charge groups, separately orders leaf rows by Completion due date, and initially shows Person in charge then Completion due date. Huddle process is neither a grouping nor an inline label because this view is already scoped to one exact Process. Dates display as month/day/year, missing people and dates sort last, and clicking a listed Action Item opens that exact editable Entity.
32. Huddle Node deletion moves the Node, its text boxes, chats, snapshot edges, Entity relationships, attachments, and restorable direct policies to the Recycle Bin; restore reuses the same IDs and creates no Huddle Explorer placement.
33. A Huddle Node cannot exist without its owning Huddle Logic Gate and never receives a Company Explorer or Huddle Explorer placement row.
34. Realtime audience resolution recognizes `huddle_node` and follows only that Huddle Node's existing exact permission policy.
35. Every listed Action Item keeps the shared Action Item icon and the Action Item's semantic red or yellow row color treatment, with black label text and no visible color-name suffix.
36. The Action Item editor is clamped to the visible viewport and opens to the left when the right side lacks room.
37. Every selected grouping term renders a visible hierarchy header. The final selected grouping level places its heading and member rows inside an elevated surface. An ordering term changes only leaf-row order inside that final group and never creates a header; with no ordering term, rows keep the stable backend order.
38. Selected inline fields render in saved left-to-right order on one nonwrapping rail against the row's right edge. Complete pills remain inside the row when they fit; only a genuinely oversized selected set scrolls horizontally from its first saved field, and the title yields before the rail is displaced.
39. A Source inline label names the exact current endpoint only when the viewer has current access; otherwise it shows the same neutral no-source value as My Work without exposing a hidden type, ID, or name. Saving grouping, ordering, or displayed fields changes only the user-owned saved view and never creates, copies, or rewrites an `entity_relationships` edge.

Last updated: 2026-08-30

# Process Story: A Huddle Node edits current meeting work while fixed Process cards and live Action Items remain separate

An editor creates a Huddle Node from one Huddle Logic Gate
↓
Mango atomically stores the Huddle Node, one canonical empty text box, direct policy, current linked Logic Gate IDs, and current KPI IDs
↓
The left column provides normal rich-text text boxes, attachments, chats, linker, toolbar, permissions, and the retained Process/KPI cards without email or pass-to-Process controls
↓
Inline Action Item references create exact Entity-to-Huddle-Node edges, and removing the final reference removes only that Node edge
↓
The right column uses the shared exact-node-scope rollup panel and the user's independent Huddle Node saved view to present the owning Huddle Logic Gate's current deduplicated Action Items, while the Process and KPI snapshot stays fixed
