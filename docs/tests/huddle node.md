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
10. The workspace may contain several ordered text boxes, and each text box uses the normal Node's left timeline circle and line, left plus control, row spacing, canonical editor JSON save, revision, conflict, toolbar, and delete behavior. Its header shows live Saved state and Last Updated/Created timestamps at the far left, keeps attachment and row actions next, and places Editor immediately left of Chat at the far right.
11. The Huddle Node left column always shows its editable text boxes, while the right column toggles between Action Items and the captured Process and KPI snapshot and defaults to Action Items.
12. Huddle Node text boxes support the Universal Linker, formatting toolbar, inline Entity references, attachments, selection comments, ordinary chats, and the existing Permissions tab.
13. A Huddle Node has no attached-email column, email owner, due date, status, account, pass-to-Logic-Gate control, timeline events, frequency, or period.
14. Huddle Node attachments use `attachment_relationships` with `resource_type='huddle_node'`, the exact Huddle Node ID, and the text box ID only as `information_id` origin metadata.
15. Huddle Node text-box chats belong to one exact Huddle Node and text box, never create an email relationship, store the unambiguous mentioned user IDs derived from the current message on create and edit, and allow only one in-flight submit per text box.
16. Reading or changing the Huddle Node workspace, attachments, chats, captured cards, or Action Items requires Edit access to that exact Huddle Node; there is no separate read-only Huddle Node permission.
17. The popup opens almost full screen while leaving the application sidebar visible and provides compact pin, fullscreen, delete, and close actions.
18. The popup header keeps the Huddle Node icon, live Huddle breadcrumb, editable Huddle Node name, RACI cards, and Permissions controls.
19. Clicking a captured normal Logic Gate opens that Logic Gate, and clicking a captured KPI opens the shared KPI editor without changing the snapshot.
20. The right column shows the owning Huddle Logic Gate's current live Action Item rollup and refreshes only when saved Action Item references change, a canonical remote reference set changes, or a listed Action Item is edited; ordinary typing never reloads the rollup or editor, and an older overlapping response never replaces a newer one.
21. Each Huddle Node editor save atomically derives `entity_relationships` from all live text boxes and stores one exact same-company Action Item Entity to Huddle Node edge for each Action Item that the Node currently references.
22. Several inline references to the same Action Item in one Huddle Node share one relationship row.
23. Removing one of several references keeps the row, while removing the final reference removes only that Node edge and preserves the company-wide Action Item Entity.
24. The Process rollup unions the owning Huddle Logic Gate's direct `entity_relationships` with every edge from its Huddle Nodes and deduplicates each Action Item once.
25. A surviving direct Huddle Logic Gate reference or sibling Huddle Node reference keeps the Action Item in the rollup, and the same Action Item may appear in several Huddle Processes.
26. Creating a new Huddle Node immediately shows the current parent rollup; no Action Item IDs are copied into the immutable Process or KPI snapshot tables.
27. Highlighting text in a supported editor may create a yellow or red Action Item, seed its Details from that text, and replace the selection with one inline Entity label for the exact created Entity.
28. A yellow inline Action Item label pulses once every two seconds and a red label once every second; reduced-motion preference disables that animation.
29. Clicking an inline or listed Action Item opens the shared compact editor inside that activation point's Huddle modal layer, with one autosaving title, plain Details text, read-only creator metadata, a lower-left searchable current-company Person in charge picker, shared Node text-and-calendar controls for both dates, color options with a square swatch and label, status, a red close X that flushes pending work, and no Save button.
30. Action Item grouping settings are personal browser state. The default grouping is Person in charge and then Completion Due Date.
31. Action Item dates display as month/day/year, missing people and dates sort last, and clicking a listed Action Item opens that exact editable Entity.
32. Huddle Node deletion moves the Node, its text boxes, chats, snapshot edges, Entity relationships, attachments, and restorable direct policies to the Recycle Bin; restore reuses the same IDs and creates no Huddle Explorer placement.
33. A Huddle Node cannot exist without its owning Huddle Logic Gate and never receives a Company Explorer or Huddle Explorer placement row.
34. Realtime audience resolution recognizes `huddle_node` and follows only that Huddle Node's existing exact permission policy.
35. Every Action Item row and inline label uses the shared target-and-arrow icon, black label text, and a fully filled yellow or red surface without a visible color-name suffix.
36. The Action Item editor is clamped to the visible viewport and opens to the left when the right side lacks room.

Last updated: 2026-08-29

# Process Story: A Huddle Node edits current meeting work while fixed Process cards and live Action Items remain separate

An editor creates a Huddle Node from one Huddle Logic Gate
↓
Mango atomically stores the Huddle Node, one canonical empty text box, direct policy, current linked Logic Gate IDs, and current KPI IDs
↓
The left column provides normal rich-text text boxes, attachments, chats, linker, toolbar, permissions, and the retained Process/KPI cards without email or pass-to-Process controls
↓
Inline Action Item references create exact Entity-to-Huddle-Node edges, and removing the final reference removes only that Node edge
↓
The right column derives the owning Huddle Logic Gate's current deduplicated Action Items from direct Gate edges and every live child-Node edge, while the Process and KPI snapshot stays fixed
