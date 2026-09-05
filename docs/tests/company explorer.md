# Company Explorer Business Logic Laws

1. E1: Explorer V2 root and child reads require a company ID.
2. E2: Explorer V2 supports the all scope and rejects old Me/Team scope behavior.
3. E3: Root reads load the company root containers for the viewer.
4. E4: Child reads require a parent ID that is either the company root or a valid Explorer folder resource ID.
5. E5: Explorer reads return only resources where the viewer has effective edit access or higher.
6. E6: Explorer rows include effective access so the UI can decide available actions.
7. E7: Explorer rows include has-children information for folder rows so the UI can lazy-load folder branches.
8. E8: Explorer rows sort by position, then creation time, then name, then entity ID.
9. E9: The final Company Explorer tree contains folders, subfolders, Logic Gates, and projects. Nodes, including email-collaboration Nodes, are never Company Explorer rows.
10. E10: Project rows are standalone leaf rows; project relationships do not render nested Explorer child rows.
11. E11: Logic Gate rows are standalone leaf rows; node assignments do not render as nested Explorer child rows.
12. E12: Creating an Explorer folder requires company, actor, permission user, parent entity, and nonblank folder name.
13. E13: New root Explorer folders own complete customized RACI and permission policies; new subfolders start inherited with no copied policy edges and resolve their current parent live.
14. E14: Explorer folders can be created only under the company root or another folder.
15. E15: Creating a folder under a non-folder resource is rejected.
16. E16: Renaming an Explorer folder requires edit access to that folder.
17. E17: Moving or placing an Explorer item requires resolving both the parent container and the target entity.
18. E18: Moving an Explorer item changes its parent and position without duplicating the target resource and atomically synchronizes the matching Process Map placement when the target is a Logic Gate.
19. E19: Deleting a Logic Gate Explorer edge removes its automatic Process Map placement without deleting the underlying Logic Gate; deleting a Project edge changes no Process Map placement.
20. E20: Protected or system Explorer folders cannot be renamed or deleted.
21. E21: Explorer target deletion removes the underlying target only through the explicit target deletion path, not by deleting a placement edge.
22. E22: Explorer placement, update, and removal mutations preserve the affected parent entity ID in durable domain facts and committed responses and atomically advance the Process Map projection when a Folder or Logic Gate structure changes; they do not make Process Map another hierarchy authority.
23. E23: Company Explorer patches concrete mounted state from the initiating command response or the concrete same-window committed-title event; other changes reconcile when the relevant canonical branch is opened or explicitly refreshed.
24. E24: Company Explorer does not use event context or parent-entity fallback to drive background branch refreshes. Canonical branch identity and parent data are resolved by the explicit branch read.
25. E25: Every company has one default root folder named Unfiled.
26. E26: Unfiled has exactly two default child folders, in this order: Projects, Logic Gates.
27. E27: Bare projects and Logic Gates created outside Company Explorer route to Unfiled/Projects and Unfiled/Logic Gates respectively.
28. E28: Every Node creation path, including email collaboration and chat, creates no Company Explorer item and no default Nodes folder. Nodes remain queryable from authoritative Node storage.
29. E29: The `company_explorer_items.target_type` constraint allows only `project` and `logic_gate`. The forward cleanup migration deletes only historical Node placement rows and the now-empty deterministic Unfiled/Nodes folders, without deleting Nodes or any business relationship.
30. E30: Creating, dragging, batch-placing, deferred-projecting, or communications-converting a Node into Company Explorer is rejected. Historical Node placement rows are neither rendered nor followed by folder deletion; only the cleanup migration removes them.
31. E31: Company Explorer search queries matching source rows across the whole company, not only branches that the lazy UI has already opened, and narrows a bounded candidate batch before resolving permissions or location ancestry.
32. E32: Company Explorer search still returns node matches from the source of truth rather than from `company_explorer_items`.
33. E33: Node search derives location from a visible Logic Gate assignment first, otherwise a visible Project relationship, otherwise an empty path for an accessible standalone Node. A Node with organization links is excluded when every linked organizational path is hidden, so folder ancestry cannot leak.
34. E34: Company Explorer search orders result types as Logic Gates, nodes, projects, then folders.
35. E35: Company Explorer search results include resource_type, resource_id, display name, match reason, and Explorer location path.
36. E36: Search result display merges exact shared location-path prefixes into one nested Explorer branch with normal icons. A resource that is both a match and another match's path parent renders once as the matching resource with the shared descendants beneath it.
37. E37: Node search result rows are open-only: they can be opened, but cannot be expanded, renamed, deleted, pinned, dragged, dropped, or used as creation targets.
38. E38: The default Unfiled folder and its Projects and Logic Gates child folders cannot be renamed, moved, or deleted. Projects and Logic Gates inside their folders retain normal authorized move/delete actions.
39. E39: While the Explorer search box contains text, the left sidebar hides non-Explorer sections and uses the remaining column for Explorer search results; clearing the search restores the normal sidebar. Explorer/Search Explorer remains beneath the shared body-level blocking modal layer and cannot paint or receive interaction above a node/editor popup, dialog, preview, or expanded/fullscreen panel; closing that surface preserves the existing search query.
40. E40: Once a resource is visible anywhere in Company Explorer, no project relationship branch may create a second visible instance of that resource.
41. E41: Company Explorer has no cross-user realtime subscription. It patches the initiating browser from committed command results and otherwise reloads canonical branches on navigation or explicit refresh.
42. E42: Logic Gate assignments and Project relationships remain their own typed relationships and are never reused as Company Explorer placement edges.
43. E43: Placing or moving a project or Logic Gate into an Explorer folder advances both parent-link sequences. Inherited policy follows the target folder immediately, customized policy remains independent, and only a Logic Gate synchronizes a Process Map placement.
44. E44: Reordering or re-saving a project or Logic Gate under the same Explorer folder preserves the resource's own permissions and, for a Logic Gate, preserves its existing same-parent Process Map geometry.
45. E45: Moving a project or Logic Gate to the company root converts an inherited effective policy to a complete customized root policy and preserves an existing customized policy; a Logic Gate's automatic Process Map placement becomes root.
46. E46: Editing an Explorer folder changes inherited descendants live but does not cross active customized boundaries. Apply to non-customized descendants adds no descendant state; Apply to every descendant records one reset sequence without walking or rewriting descendants.
47. E47: Dropping a My Triage or Shared Triage email onto a Company Explorer Logic Gate row uses the communications conversion path to create a Pending direct email-created node/card in that Logic Gate's Kanban/work path, not a Company Explorer placement. The created node/card must not appear as a Company Explorer row and must not be inserted into `company_explorer_items`.
48. E48: A successful Company Explorer email-to-Logic-Gate drop updates Home triage state once from the committed conversion result, keeps the source row visible, and patches its Logic Gate icon without a broad conversion/workspace WebSocket event, broad cache invalidation, stale prefetched-page reuse, post-removal fill, message-length prefetch, list blanking, or repeated mail GETs. A later exact-mailbox provider update may independently cause one canonical active-list reconciliation.
49. E49: A successful Company Explorer email-to-Logic-Gate drop shows a temporary green success banner over the Company Explorer sidebar section.
50. E50: A successful Company Explorer email-to-Logic-Gate, pinned Logic Gate, or non-Explorer eligible node drop sets source emails to unstarred through the source mailbox scope, returns `unstarred_message_ids`, and reconciles Home locally without pulling replacement rows into Inbox, All, Starred, My Triage, or Shared Triage.
51. E51: Double-clicking a Company Explorer row label must not enter inline rename mode; renaming folders, projects, and Logic Gates requires an explicit rename action that is already authorized for the target.
52. E52: We want multi browser click-drag ability. So I can drag an email from My Triage or Shared Triage and click drag it to another browser window (but the same account) and drop it off on the company explorer logic gate and create a node within that logic gate's kanban board with an email icon (but obviously not create a node on the company explorer)
53. E53: Permissions opened from Company Explorer for folders, projects, or Logic Gates use the shared permission view and always expose a visible **Save** action when editable. Node search results remain open-only and do not gain Explorer permission actions.
54. E54: An email conversion through Company Explorer sends the exact source mailbox key and persists mailbox provenance in the created Node's attached-email projection: personal/My Triage drag and conversion requests carry normalized `account_email`; Shared Triage requests carry `shared_inbox_id` and suppress a personal-account query, while the canonical projection retains both the shared inbox and its company mailbox account email. Later thread reads, received-attachment reads, invitation responses, signature reads, and owner-draft Reply use that exact source scope.
55. E55: Every successful Node or Logic Gate rename entry point publishes the concrete committed-title event after commit. Company Explorer patches matching Logic Gate rows, Node search results, and mounted RACI-mode Node/Logic Gate names (including scoped per-user cached rows) immediately alongside the other applicable mounted surfaces; active title drafts/carets are deferred, failed renames publish no event, and another browser still uses canonical reads.
56. E56: Explicit default-folder repair is idempotent and creates or repairs only Unfiled, Projects, and Logic Gates. A healthy default row is not updated, and repair never recreates Unfiled/Nodes or backfills Nodes.
57. E57: A Triage-comment email Node receives its creator/participant Edit grants and creator Responsible RACI directly as an ordinary standalone Node; its privacy never depends on Company Explorer folder placement or visibility.
58. E58: Collaboration ownership, chat, participants, source-thread links, received attachments, and Node policies remain in their typed domain tables. Company Explorer has no collaboration Node projection or lifecycle edge.
59. E59: Concurrent collaboration retries and future provider messages reuse the same collaboration Node without creating a Company Explorer item or duplicate search result.
60. E60: Existing email-to-Logic-Gate conversion still creates Pending work under its established typed assignment path. Starting chat on an unconverted triage email creates a standalone creator-Responsible-RACI Node with no Company Explorer placement and no initial Logic Gate.
61. E61: Explorer policy reads explain inherited/customized mode, effective source, active reset, and inactive overwritten customization for folders, projects, and Logic Gates.
62. E62: Moving a subtree after an older force reset protects it through the new parent-link sequence; a later reset from its new ancestry may cross that link.
63. E63: Deleting an Explorer target removes both V2 settings rows and cascading policy edges; deleting only a Logic Gate Explorer edge preserves the target and removes its automatic Process Map placement, while Folder target deletion uses the canonical protected/subtree lifecycle.
64. E64: Company Explorer and Editor/Universal Picker entity ranking first read a bounded candidate batch directly from their requested source tables. Permission and location visibility checks run only for that batch, and later ranked batches are checked only when needed to fill the requested authorized result limit. Universal Picker keeps Node, Project, then Logic Gate ranking; Company Explorer keeps Logic Gate, Node, Project, then folder ranking.
65. E65: Company Explorer and Universal Picker location visibility use only each narrowed candidate's exact typed organization links and folder ancestors. Company Explorer placement tables provide those paths but store no permission or RACI assignment rows and are not source tables for entity names. A directly accessible candidate remains searchable when its location is restricted.
66. E66: A Company Explorer or Universal Picker search GET performs no default-folder creation, repair, transaction, upsert, or version-triggering write. Default-folder setup belongs to explicit initialization and repair paths.
67. E67: Within one narrowed permission batch, the actor's nested group ancestry is resolved once and reused across candidate resource, location-resource, and folder checks. Effective permission policy still follows each candidate's canonical immediate-parent chain.
68. E68: Company Explorer waits 120 milliseconds before issuing search, aborts the superseded request when the query changes or the search view closes, and never reports an intentional abort as a search failure.
69. E69: Direct Edit permission on a matching Project, Logic Gate, Node, or folder is sufficient to return that item. Company Explorer includes its organizational path only when the location resource and every folder ancestor are also accessible; if any part is `no_access`, the entire path is omitted and only the matched item appears at the search root. Universal Picker likewise returns the directly accessible item without exposing organizational ancestry.
70. E70: Explorer root and child GETs are read-only. They perform no default-folder creation, repair, transaction, upsert, placement backfill, RACI recalculation, or version-triggering write.
71. E71: Company creation initializes Unfiled, Projects, and Logic Gates. Project and Logic Gate creation places only that new resource and may initialize missing defaults; Folder structural writes and Logic Gate placement writes synchronize automatic Process Map placement, while ordinary reads never repair setup.
72. E72: Home, My Triage, RACI views, My Work, Project Management, and relationship graphs use their exact domain endpoints. They never preload a complete Explorer folder tree, call the retired Node-folder or Logic-Gate-folder categories, or fetch the retired full workspace browser snapshot.
73. E73: Simultaneous requests for the same Explorer root or exact parent share one in-flight HTTP request. Different parent IDs remain independent.
74. E74: Dropping an Explorer folder onto a Home or Project target loads only that selected folder branch through child reads. It never preloads the complete Explorer tree.
75. E75: Mango runs no workspace-derived projector, catch-up timer, request-event producer, or projection-checkpoint table. Historical projector request events are inert audit records and are never runtime work queues.
76. E76: A Node, Logic Gate, or Project title surface derives its breadcrumb from the current canonical Company Explorer hierarchy and typed organization links when read; no database column, copied full path, or client cache becomes path authority. A Logic Gate or Project uses its exact folder ancestry. A Node uses its visible Logic Gate path first, otherwise its visible Project path, otherwise the Workspace root.
77. E77: A Company breadcrumb shows the clickable Workspace root followed by every fully visible ancestor, excludes the current item's editable title, and omits the whole hierarchy path when any required ancestor is missing, hidden, recycled, cyclic, or too deep to resolve safely. Clicking a folder reveals that exact Company Explorer branch, clicking a resource opens that exact resource, and a committed same-window hierarchy change refreshes mounted breadcrumbs without adding cross-browser realtime behavior.
78. E78: Company Explorer is the sole structural hierarchy authority for Process Map.
79. E79: Every Explorer Folder and every Explorer Logic Gate item has exactly one automatic Process Map placement under the same exact direct Folder or root; Projects and Nodes have none.
80. E80: Process Map placement rows own only snapped geometry, positive dimensions, revision, and timestamps and cannot be manually added or removed independently.
81. E81: Crossing a Process Map Folder boundary atomically uses the canonical Explorer move; same-parent x/y movement and resizing stay Process Map-only.
82. E82: Removing a Process from Process Map deletes only its Explorer edge and matching placement, while deleting a Folder invokes the canonical protected/subtree Explorer deletion command.
83. E83: Automatic placement and Explorer synchronization never create, infer, change, or delete an operational relationship; they never infer a trace, and dependent trace cleanup follows the Process Map placement-removal laws.
84. E84: One forward migration non-destructively backfills missing Process Map placements for supported Explorer sources and synchronizes their Explorer parent projection while preserving existing geometry, traces, and operational relationships.
85. E85: Process Map exposes no placement tray, header placement picker, candidate browser, or manual placement drop path.
86. Creating a Process from Company Explorer requires a nonblank name and an existing permitted destination Folder.
87. Process creation, its single Explorer placement, and its automatic company-map placement commit in one transaction.
88. The creation transaction rechecks destination Folder Edit access before writing any Process.
89. Successful creation from Company Explorer reveals, selects, and opens the exact new Process; a failed creation keeps the dialog values and permits retry without a second placement request.
90. Clicking Process Map scrolls the sidebar to Explore beneath the visible sticky Search Explorer field, regardless of the tree's length.
91. The sidebar shows one Explore heading and one wide raised surface around its tree.
92. Hovering an Explorer row lifts it slightly without selecting it or replacing its selected and drag-target indicators; reduced motion disables the lift.
93. Choosing a Process destination reveals and expands that exact Folder and its permitted ancestor path in Company Explorer.
94. A committed Process Map creation expands its destination path and selects the exact new Process without opening its Board or SOP.
95. Process Map creation patches the initiating Explorer from its committed response and reads only the exact destination path; recovery after an uncertain response uses canonical reads of that same path and creates no second Process.

## Process Story

A user names a Process and chooses a permitted Folder. Mango reveals that destination and commits the Process and its one placement together. Company Explorer creation opens the new Process; Process Map creation selects its row while the map returns to the prior company view. Explorer remains the hierarchy authority for folders, Processes, and Projects; Nodes stay in their typed domain relationships. Reads and search return permitted source records without repairing data or exposing hidden ancestors.

## Main Scenarios

1. **Create or retry:** save a named Process in a selected Folder. Success reveals one selected placement, including in a previously empty or unopened Folder. Explorer creation opens it; map creation returns to the company map. A server failure leaves the entered values available; revoked Folder access creates nothing.
2. **Move and remove:** moving a permitted Process changes its single Explorer parent and matching company-map placement. Removing only its placement preserves the Process; deleting a protected Folder remains rejected.
3. **Search and work:** search returns directly accessible resources with only fully visible paths. An email dropped onto a Process creates work through the existing Node assignment flow and never creates a Node Explorer row.
