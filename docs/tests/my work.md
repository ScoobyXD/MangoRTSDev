# My Work Business Logic Laws

Last updated: 2026-08-30

MW1 - The page is named My Work and is the first built-in item beneath My Tower, immediately above Projects.

MW2 - My Work always uses the authenticated company member as its subject. Team, Company, and another-person subjects do not appear; Action Items instead expose the exact Mine and Delegated perspectives defined below.

MW3 - The My Work header shows the page title and has no grouping button.

MW4 - Beneath the header, My Work has three columns: an unnamed left column, Processes in the middle, and Projects on the right.

MW5 - The left column has no shared Work title or other unified section name. It contains an Action Items section followed by a Nodes section.

MW6 - Action Items and Nodes are permanent separate top-level sections. Grouping never mixes an Action Item with a Node or moves Nodes above Action Items.

MW7 - The Action Items section has one Mine or Delegated perspective. Mine is active by default, and the two perspectives never share or duplicate a self-assigned item.

MW8 - The Nodes section has its own R, A, C, I selector and defaults to Responsible. A Node qualifies only when the subject has the selected current effective winning role, whether it comes directly, through a group or nested group, or through RACI inheritance.

MW9 - Selecting a different Node role replaces only the Node rows. It preserves the Node grouping stack, clears stale rows and cursor state, and requests that exact role from the server.

MW10 - Mine requires exact canonical `person_in_charge` equal to the subject. Delegated requires exact canonical `assigned_by` equal to the subject and a nonnull `person_in_charge` for a different member; creator metadata, Source, and relationships are not assignment sources.

MW11 - The Action Items header places its Mine/Delegated control immediately to the right of the Action Items title. The control is larger than the former compact version, keeps the established elevated segmented-control keyboard/accessibility behavior, and gives the selected segment a light-blue gradient instead of a dark fill. The Nodes header orders its right-side controls as RACI, History, then grouping, so the unchanged established RACI selector sits immediately left of History. Each section owns an independent grouping stack, and both grouping buttons use the approved staggered three-line icon.

MW12 - No grouping control outside those two section headers changes either section's grouping stack.

MW13 - Mine starts with Color followed by Completion due date. Delegated automatically uses Color, Completion due date closest first, then Person in charge alphabetically; each level keeps its own Asc/Desc control, and switching perspectives restores that perspective's stack.

MW14 - The initial Action Item color order is Red, Yellow, then No color. An Action Item with no color remains visible.

MW15 - The first Node grouping stack is Priority followed by Due date. The first version adds no relative date buckets such as Overdue, Today, This week, or Later.

MW16 - A Node with no Priority or no Due date remains visible under its exact empty-value group.

MW17 - Every Node row starts with the Node icon and exact current Node name.

MW18 - When a Node has an associated Process, its row shows the Process icon and exact current Process name inline. When it has an associated Project, its row shows the Project icon and exact current Project name inline.

MW19 - Clicking a Node row opens that exact Node. Clicking an Action Item row opens that exact Action Item.

MW20 - Every Process and Project row is clickable and opens that exact Process or Project.

MW21 - An inline Process or Project reference inside another row is independently clickable and opens that exact resource without also opening the surrounding row.

MW22 - The middle column has its own R, A, C, I selector. It is independent from the Nodes selector, defaults to Responsible, and lists only Processes for which the subject has that current effective winning RACI role.

MW23 - The right column lists a Project when the subject is a direct member of any currently assigned same-company Team group or a member of any current descendant group beneath that Team. Membership only in an ancestor or unrelated group does not qualify.

MW24 - My Work reads canonical Nodes, Action Item person fields, RACI, Process relationships, Project relationships, Project Team assignments, and company membership when requested. There is no My Work projection table and no My Work relationship authority.

MW25 - My Work is a read surface. Opening, grouping, or viewing My Work never rewrites a Node, Action Item, RACI assignment, Process relationship, Project relationship, Project Team assignment, permission, or source record.

MW26 - The subject determines which resources qualify for My Work, while the authenticated viewer's current permissions determine which qualifying resources may be disclosed. The subject and viewer are the same authenticated company member in the first version.

MW27 - A qualifying Node, Process, or Project is shown only when the authenticated viewer has current effective access to that exact resource. Action Item visibility follows the current company-scoped Entity access contract.

MW28 - Effective RACI and Project Team membership never grant resource access. They only make a resource a My Work candidate.

MW29 - Access to a Node does not grant access to its associated Process or Project. An inaccessible inline Process or Project is omitted completely, including its ID, name, hidden count, placeholder, and relationship details, while the accessible Node remains visible.

MW30 - The backend applies the selected Node role or Action Item perspective before permission filtering, sorting, grouping, limits, pagination cursors, has-more decisions, or counts. When Delegated groups by Person in charge, it orders the current authoritative member display name with exact Person in charge and Entity IDs as stable tie-breakers, and binds the role or perspective and grouping stack to that section's cursor; the frontend never filters or sorts a limited page locally or receives hidden resources.

MW31 - Opening any My Work resource performs that destination's normal current permission check. A prior My Work response is never proof of continued access.

MW32 - A permission-resolution failure fails the My Work read closed. My Work never returns an unfiltered partial result after an authorization error.

MW33 - Mine and Delegated both exclude an Action Item whose current canonical Status is Done, Complete, or Completed; that item appears only in Action Items History while it still qualifies for the selected perspective and viewer.

MW34 - The normal Nodes list excludes a Node whose current status is Done, Complete, or Completed; that Node appears only in Nodes History while it still has the selected effective RACI role and remains permitted.

MW35 - An Action Item row exposes only the summary needed to display and open that exact Entity. A Delegated row shows the current Person in charge name in a compact inline label with a person icon, immediately left of the due-date label; Mine shows no person label, and neither perspective derives Process, Project, or other resource context.

MW36 - Action Items, Nodes, Processes, and Projects each append their own next bounded cursor page when that section nears its scroll boundary. Each Action Item or Node History request reads 12 records, including its first request. My Work shows no Previous, Next, or page-number controls, and loading one section never replaces or reloads another section. Switching Mine/Delegated clears only Action Items and loads that perspective's independent grouping stack; switching a Node or Process role clears only that section and preserves its grouping stack.

MW37 - A section never requests the same next cursor concurrently, ignores canceled or stale responses, rejects a non-advancing cursor, and never appends the same resource twice.

MW38 - My Work has independently adjustable widths between its three columns and an independently adjustable height between Action Items and Nodes. Every divider supports pointer and keyboard adjustment, remains within usable bounds, and saves the company-specific layout locally.

MW39 - My Work and Projects are full-size elevated sidebar tabs with their exact icons. Action Items, Nodes, Processes, and Projects each show their exact icon beside the section title. Only the Action Items section-header icon combines the established Action Item colors: its outer ring is Yellow and its inner ring is Red; Action Item row and editor-chip icons still use each item's saved color.

MW40 - Red Action Item icons and names use the established Huddle red treatment and pulse once per second. Yellow Action Item icons and names use the established Huddle yellow treatment and pulse once every two seconds.

MW41 - Completion due date and Due date remain ordering levels but render no date-group header. Delegated Person in charge is also an ordering level with no group header; its current name appears only inline on each row. Color and priority groups keep their established colors.

MW42 - The Node and Process role selectors reuse the same established accessible selector and colors: Responsible is orange, Accountable is green, Consulted is blue, and Informed is purple.

MW43 - Each major My Work section is an elevated surface. Every resource row lifts on hover or keyboard focus, and inline Node Process and Project references are independent elevated click targets.

MW44 - Action Item, Node, Process, and Project row names use the readable My Work row type scale. Delegated Action Item rows remain at one flat, unindented depth even when Color headers are visible; other visible nested group levels and their rows remain indented without continuous vertical guide lines.

MW45 - A colored Action Item keeps its established raised pulsing icon, while its title is plain highlighted text with the same red one-second or yellow two-second pulse and no separate raised chip surface.

MW46 - Every universal grouping dialog opens as a fixed elevated overlay anchored to its grouping button. It never becomes a clipped section descendant, changes a section's scroll position, or moves the underlying My Work layout.

MW47 - Opening an Action Item from My Work anchors the existing exact Action Item editor to the activation point above the current page. The editor and its field cards use the elevated My Work surface treatment and never become a right-side layout column.

MW48 - The Action Item Person in charge search opens a viewport-clamped elevated result overlay wide enough for full identity context, shows four result rows before scrolling, and is never clipped by the Action Item card.

MW49 - Action Item date fields use the shared elevated calendar with a light-blue trigger. The calendar opens above the current layout, supports direct date selection, and does not close the Action Item editor when used.

MW50 - Every universal grouping dialog uses raised grouping rows, raised level tags and buttons, and recessed field selectors within its elevated overlay.

MW51 - A successful login with no explicit supported return destination opens My Work as the active page. A fresh authenticated load with no valid saved active tab also selects My Work, while explicit supported return destinations and valid saved tabs on ordinary authenticated reloads remain authoritative.

MW52 - Action Items and Nodes each have an independent History toggle in their section header. The button shows the History icon to the left of the word History, exposes its pressed state, and pressing it again returns that section to its normal list in the same space without a popup.

MW53 - Each History list contains only completed work that still qualifies for that subject and viewer. It is ordered by completion status-change time from newest to oldest, uses exact resource ID as the stable tie-breaker, and keeps cursor pagination bound to History mode.

MW54 - An Action Item History timestamp is its canonical Status field update timestamp. A Node's canonical `completion_transition_timestamp` is updated atomically from each newly inserted immutable full Node snapshot: entering Done, Complete, or Completed sets that snapshot's timestamp, remaining complete preserves it, and reopening clears it so a later re-completion records the newer transition. Existing rows are backfilled once from immutable snapshots, a completed Node with no recorded transition falls back to its immutable Node creation timestamp, and History reads this persisted value without scanning snapshot history.

MW55 - Every Action Item and Node row shows its current due date or empty state as its inline clickable calendar label. The calendar icon is immediately left of the date text with one compact gap and no empty spacer. A date on the current `America/Los_Angeles` business day reads `Due Today`, and the next three dates read `Due Tomorrow`, `Due in two days`, and `Due in three days`; every later or earlier date keeps `Due Date:` plus its normal date. The complete label treatment, including text and calendar icon, is Red for Due Today and Due Tomorrow, Yellow for Due in two or three days, and the established Purple for every ordinary date or empty-date form. Process and Project chips follow the date label.

MW56 - The Action Item row's official due date is always its canonical Completion due date field. Inline Action Item due-date edits update that exact existing Entity field, while inline Node due-date edits update the exact Node. Rapid date commits are serialized per row so the user's latest calendar or typed choice is always the final saved value.

MW57 - After a same-page Action Item editor successfully renames an item or changes one of its fields, My Work immediately reloads that Action Item section. A renamed row shows its current name, and an item newly marked complete leaves the normal list without a page reload.

MW58 - Only the My Work page content uses the uniform 90-percent visual density shown by browser zoom at 90 percent. Its compensated page bounds still fill the available workspace, while the shared left sidebar keeps its normal size and interaction behavior.

MW59 - Every Process row always shows the same four right-aligned Request, Pending, In Progress, and Review squares. Counts use the canonical Logic Gate work-status source and the established Pinned colors and order; Backlog and Done are excluded, and an empty status shows `0` in its fixed square instead of disappearing or shifting another status.

## Process Story: One person sees assigned work and current company context

A company member logs in without an explicit return destination or opens My Work beneath My Tower

↓

Mango reads that member's Action Items for the selected Mine or Delegated perspective and Nodes for the independently selected effective RACI role, applies current permissions, and selects either active work or completed History before any result is grouped or cursor-bounded

↓

The unnamed left column keeps Action Items above Nodes, shows editable inline due dates, and applies Mine's two-level or Delegated's three-level server-owned ordering while Delegated rows stay flat and show Person in charge inline; all four sections append more permitted rows within their own scroll areas, and either left section may replace its own rows with newest-first History and return in place

↓

The Nodes and Processes selectors both default to Responsible and change independently; each Process row shows four aligned always-visible canonical active-work counts including zeros, while the right column lists Projects whose assigned Team includes that member directly or through a current descendant group

↓

Every displayed Node, Process, Project, and permitted inline reference opens its exact canonical resource, while each Action Item opens only its exact Entity without derived resource context or source-data changes
