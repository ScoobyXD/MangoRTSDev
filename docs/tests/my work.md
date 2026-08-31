# My Work Business Logic Laws

Last updated: 2026-08-30

MW1 - The page is named My Work and is the first built-in item beneath My Tower, immediately above Projects.

MW2 - My Work defaults to the signed-in company member as its subject. An optional canonical `subject_user_id` may select any current member of the same company; omitting it or choosing the signed-in member uses the existing self path, and a missing or cross-company subject is never accepted.

MW3 - The My Work header shows the page title and places the established people-icon button directly within its header search area. The button opens the company people picker, and the header has no grouping button.

MW4 - Beneath the header, My Work has three columns: Action Items on the left, one shared Processes or Nodes panel in the middle, and Projects on the right.

MW5 - The left column is one full-height Action Items section. It has no shared Work title, split, height divider, or separate Nodes panel.

MW6 - The middle header has a Processes and Nodes toggle at its top-left, using each resource's exact icon and label. Each option uses the same icon surface, label size, and icon-to-label spacing as a normal section title, and the complete toggle keeps one stable non-shrinking size when the selected view or its right-side controls change. Processes is selected by default, the selected option has a clear highlighted border, and the middle panel never shows both lists at once.

MW7 - The Action Items section has one Mine or Delegated perspective. Mine is active by default, and the two perspectives never share or duplicate a self-assigned item.

MW8 - The Nodes view has its own R, A, C, I selector and defaults to Responsible. A Node qualifies only when the subject has the selected current effective winning role, whether it comes directly, through a group or nested group, or through RACI inheritance.

MW9 - Selecting a different Node role replaces only the Node rows. It preserves the Node grouping stack, clears stale rows and cursor state, and requests that exact role from the server.

MW10 - Mine requires exact canonical `person_in_charge` equal to the subject. Delegated requires exact canonical `assigned_by` equal to the subject and a nonnull `person_in_charge` for a different member; creator metadata, Source, and relationships are not assignment sources.

MW11 - The Action Items header places its Mine/Delegated control immediately to the right of the Action Items title, keeps the established elevated segmented-control keyboard/accessibility behavior and soft white-to-light-blue selected gradient, and orders its right-side controls as History then one combined Group, order, and inline-fields button; there is no separate Settings gear. The History icon is one circular arrow whose arrowhead follows the circle. When Nodes is selected, the middle header orders its right-side controls as RACI, History, then grouping. Action Items and Nodes each own an independent grouping stack, and both grouping buttons use the official vertical double-ended arrow with a clear gap before the staggered horizontal lines; the Action Items button uses `#EA84E5`.

MW12 - Processes has no History or grouping control. No grouping control outside the Action Items header or active Nodes header changes either section's grouping stack.

MW13 - Mine starts with the visible hierarchy Color ascending then Huddle process ascending and separately orders leaf rows by Completion due date ascending. Delegated starts with Color ascending, Person in charge ascending, then Huddle process ascending and separately orders leaf rows by Completion due date ascending. Every selected grouping or ordering term has its own Asc/Desc direction, and switching perspectives restores that perspective's saved stacks.

MW14 - The initial Action Item color order is Red, Yellow, then No color. An Action Item with no color remains visible.

MW15 - The first Node grouping stack is Priority followed by Due date. The first version adds no relative date buckets such as Overdue, Today, This week, or Later.

MW16 - A Node with no Priority or no Due date remains visible under its exact empty-value group.

MW17 - Every Node row starts with the Node icon and exact current Node name.

MW18 - When a Node has an associated Process, its row shows the Process icon and exact current Process name inline. When it has an associated Project, its row shows the Project icon and exact current Project name inline.

MW19 - Clicking a Node row opens that exact Node. Clicking an Action Item row opens that exact Action Item.

MW20 - Every Process and Project row is clickable and opens that exact Process or Project.

MW21 - An inline Process or Project reference inside another row is independently clickable and opens that exact resource without also opening the surrounding row.

MW22 - When Processes is selected, the middle header shows only the Process R, A, C, I selector on its right side. It is independent from the Nodes selector, defaults to Responsible, and lists only Processes for which the subject has that current effective winning RACI role.

MW23 - The right column lists a Project when the subject is a direct member of any currently assigned same-company Team group or a member of any current descendant group beneath that Team. Membership only in an ancestor or unrelated group does not qualify.

MW24 - My Work reads canonical Nodes, Action Item fields and immutable Source, Huddle Node ownership, RACI, Process relationships, Project relationships, Project Team assignments, company membership, and the signed-in viewer's saved-view preferences when requested. There is no My Work projection table and no My Work relationship authority.

MW25 - My Work never rewrites a Node, Action Item, Source, Huddle ownership, RACI assignment, Process relationship, Project relationship, Project Team assignment, or permission. Changing grouping, ordering, or displayed fields writes only the signed-in viewer's My Work saved-view row and never the selected subject's row.

MW26 - The selected subject determines which resources qualify for My Work, while the signed-in viewer's current permissions determine which qualifying resources may be disclosed. Selecting another subject never changes the viewer, permission principal, or saved-view owner.

MW27 - A qualifying Node, Process, or Project is shown only when the authenticated viewer has current effective access to that exact resource. Action Item visibility follows the current company-scoped Entity access contract.

MW28 - Effective RACI and Project Team membership never grant resource access. They only make a resource a My Work candidate.

MW29 - Access to a Node does not grant access to its associated Process or Project. An inaccessible inline Process or Project is omitted completely, including its ID, name, hidden count, placeholder, and relationship details, while the accessible Node remains visible.

MW30 - The backend applies the selected subject, Node role, or Action Item perspective before the signed-in viewer's permission filter, grouping, leaf ordering, limits, pagination cursors, has-more decisions, or counts. Action Item cursors bind the perspective plus the complete grouping and ordering stacks; current Huddle process name and ID, Person in charge name and ID, and exact Entity ID provide stable keys only when selected. The frontend never filters or sorts My Work rows locally or receives hidden resources.

MW31 - Opening any My Work resource performs that destination's normal current permission check. A prior My Work response is never proof of continued access.

MW32 - A permission-resolution failure fails the My Work read closed. My Work never returns an unfiltered partial result after an authorization error.

MW33 - Mine and Delegated both exclude an Action Item whose current canonical Status is Done, Complete, or Completed; that item appears only in Action Items History while it still qualifies for the selected perspective and viewer.

MW34 - The normal Nodes list excludes a Node whose current status is Done, Complete, or Completed; that Node appears only in Nodes History while it still has the selected effective RACI role and remains permitted.

MW35 - An Action Item row always exposes its exact ID and title and may expose the compact Person in charge, Assigned by, Created timestamp, permission-safe Source, Color, Analysis due date, Completion due date, Status, and permission-safe Huddle process values. Details is never returned as an inline label. Mine initially displays only Completion due date; Delegated initially displays Person in charge then Completion due date. Each perspective renders only its saved displayed-field list in that saved left-to-right order in one nonwrapping horizontal rail against the row's right edge; a fitting label rail stays completely inside the row, an oversized rail starts with the first saved field and scrolls horizontally, labels never stack vertically, and the title truncates before the label rail is displaced.

MW36 - Action Items, Nodes, Processes, and Projects each append their own next bounded cursor page when that visible list nears its scroll boundary. Each Action Item or Node History request reads 12 records, including its first request. My Work shows no Previous, Next, or page-number controls, and loading one section never replaces or reloads another section. Switching Mine/Delegated clears only Action Items and loads the signed-in viewer's independent grouping, ordering, and displayed-field preferences; switching a Node or Process role clears only that view and preserves its applicable grouping state. Switching the middle view changes both its rows and controls without changing either view's selected role, the Node grouping stack, or Node History state. Processes and Nodes keep independent scroll positions while switching views, and both saved positions reset for a new company or subject.

MW37 - A section never requests the same next cursor concurrently, ignores canceled or stale responses, rejects a non-advancing cursor, and never appends the same resource twice. A response from an older company, subject, viewer, or auth session never replaces or extends the current view.

MW38 - My Work has independently adjustable widths between its three columns. Its two vertical dividers support pointer and keyboard adjustment, remain within usable bounds, and save the company-specific column layout locally; there is no section-height divider. Each compact vertical drag handle uses the established Huddle cyan-to-purple accent instead of a plain gray rectangle.

MW39 - My Work and Projects are full-size elevated sidebar tabs with their exact icons. Action Items and Projects show their exact icon beside the section title, while the middle toggle shows the exact Process and Node icons beside their labels. The Action Items section-header icon uses a cyan outer ring and indigo inner ring; Action Item row and editor-chip icons still use each item's saved semantic color.

MW40 - Red Action Item icons and names use the established Huddle red treatment and pulse once per second. Yellow Action Item icons and names use the established Huddle yellow treatment and pulse once every two seconds.

MW41 - Every Action Item Group by term renders a visible hierarchy header, including Huddle process and Completion due date when selected. An Order items by term changes only row order inside the final group and never creates a header. A Huddle process group uses the normal app font, shows the canonical Huddle Process icon immediately before the process name, and places that heading plus all of its member rows inside one elevated surface. Several processes render as separately spaced elevated surfaces. A permitted process heading opens that exact process; the neutral no-process heading is not clickable and owns its own neutral elevated surface.

MW42 - The Node and Process role selectors reuse the same established accessible selector and colors: Responsible is orange, Accountable is green, Consulted is blue, and Informed is purple.

MW43 - Each visible My Work column is one elevated surface. Every resource row lifts on hover or keyboard focus, and inline Node Process and Project references are independent elevated click targets.

MW44 - Action Item, Node, Process, and Project row names use the readable My Work row type scale. Action Item rows follow the perspective's selected visible grouping hierarchy without continuous vertical guide lines; ordering fields never add indentation.

MW45 - A colored Action Item keeps its established raised pulsing icon, while its title is plain highlighted text with the same red one-second or yellow two-second pulse and no separate raised chip surface.

MW46 - The Action Items combined dialog opens as a fixed elevated overlay anchored to its grouping button and uses four adjacent quadrants: Group by at top-left, Order items by at bottom-left, Mine inline fields at top-right, and Delegated inline fields at bottom-right. The two left quadrants edit the currently selected Mine or Delegated perspective, while both right quadrants remain visible. `#EA84E5` is used as a restrained accent for the grouping icon, selected or focused controls, drag affordances, and supporting borders without replacing semantic Action Item colors. The dialog never becomes a clipped section descendant, changes a section's scroll position, or moves the underlying My Work layout.

MW47 - Opening an Action Item from My Work anchors the existing exact Action Item editor to the activation point above the current page. The editor and its field cards use the elevated My Work surface treatment and never become a right-side layout column.

MW48 - The Action Item Person in charge search opens a viewport-clamped elevated result overlay wide enough for full identity context, shows four result rows before scrolling, and is never clipped by the Action Item card.

MW49 - Action Item date fields use the shared elevated calendar with a light-blue trigger. The calendar opens above the current layout, supports direct date selection, and does not close the Action Item editor when used.

MW50 - Every universal grouping dialog uses raised grouping rows, raised level tags and buttons, and recessed field selectors within its elevated overlay.

MW51 - A successful login with no explicit supported return destination opens My Work as the active page. A fresh authenticated load with no valid saved active tab also selects My Work, while explicit supported return destinations and valid saved tabs on ordinary authenticated reloads remain authoritative.

MW52 - Action Items always has its independent History toggle, while Nodes shows its independent History toggle only when the Nodes middle view is selected. Each button shows the History icon to the left of the word History, exposes its pressed state, and pressing it again returns that list to normal in the same space without a popup.

MW53 - Each History list contains only completed work that still qualifies for that subject and viewer. It is ordered by completion status-change time from newest to oldest, uses exact resource ID as the stable tie-breaker, and keeps cursor pagination bound to History mode.

MW54 - An Action Item History timestamp is its canonical Status field update timestamp. A Node's canonical `completion_transition_timestamp` is updated atomically from each newly inserted immutable full Node snapshot: entering Done, Complete, or Completed sets that snapshot's timestamp, remaining complete preserves it, and reopening clears it so a later re-completion records the newer transition. Existing rows are backfilled once from immutable snapshots, a completed Node with no recorded transition falls back to its immutable Node creation timestamp, and History reads this persisted value without scanning snapshot history.

MW55 - Every Action Item and Node row shows its current due date or empty state as its inline clickable calendar label. The calendar icon is immediately left of the date text with one compact gap and no empty spacer. A date on the current `America/Los_Angeles` business day reads `Due Today`, and the next three dates read `Due Tomorrow`, `Due in two days`, and `Due in three days`; every later or earlier date keeps `Due Date:` plus its normal date. The complete label treatment, including text and calendar icon, is Red for Due Today and Due Tomorrow, Yellow for Due in two or three days, and the established Purple for every ordinary date or empty-date form. Process and Project chips follow the date label.

MW56 - The Action Item row's official due date is always its canonical Completion due date field. Inline Action Item due-date edits update that exact existing Entity field, while inline Node due-date edits update the exact Node. Rapid date commits are serialized per row so the user's latest calendar or typed choice is always the final saved value.

MW57 - After a same-page Action Item editor successfully renames an item or changes one of its fields, My Work immediately reloads that Action Item section. A renamed row shows its current name, and an item newly marked complete leaves the normal list without a page reload.

MW58 - Only the My Work page content uses the uniform 90-percent visual density shown by browser zoom at 90 percent. Its compensated page bounds still fill the available workspace, while the shared left sidebar keeps its normal size and interaction behavior.

MW59 - Every Process row always shows the same four right-aligned Request, Pending, In Progress, and Review squares. Counts use only canonical Logic Gate Nodes the signed-in viewer may currently access, so a hidden Node never affects a disclosed count. The squares keep the established Pinned colors and order; Backlog and Done are excluded, and an empty status shows `0` in its fixed square instead of disappearing or shifting another status.

MW60 - Mine and Delegated each persist one signed-in-viewer-and-company-owned saved-view row. The row stores visible grouping terms in `groupings` and stores leaf `ordering` plus ordered `displayed_fields` in settings; selecting another subject never reads or writes that subject's private preference row, and no group principal, board row, local compatibility preference, or second preference table is allowed.

MW61 - The combined Action Items dialog's top-right Mine quadrant and bottom-right Delegated quadrant each contain one ordered shown-on-row tray above one field bank. Pointer click-drag is the only move or reorder command. Dropping between shown fields inserts at that exact position and shifts neighboring fields; dragging back to the bank hides the field, and an empty tray shows no inline labels.

MW62 - The inline-field bank contains Person in charge, Assigned by, Created timestamp, Source, Color, Analysis due date, Completion due date, Status, and Huddle process. The title is always visible outside the bank, Details is never offered, and no editor-field checkmark changes row visibility.

MW63 - The people picker lists only current company members under the existing current Team and group hierarchy. A member in multiple groups appears under each directly assigned group, and a member with no group appears once under No team.

MW64 - People search matches current member names and email addresses while preserving their Team and group headings. It filters only the directory and never filters loaded My Work rows.

MW65 - Selecting a directory member changes only the My Work subject. The picker always provides one clear signed-in-member choice that returns to My Work from the viewer's own perspective.

MW66 - The people button, search, grouped results, and selection reuse the established popover, avatar, focus, keyboard, and navigation behavior. Opening focuses the search, arrow keys navigate visible members, Enter selects, and Escape closes and returns focus to the people button.

MW67 - Each My Work cursor binds the company, selected subject, signed-in viewer, section, role or perspective, History mode, grouping, and ordering that produced it. A cursor from any different scope is rejected without returning rows or reference metadata.

MW68 - Changing the selected subject clears every prior subject row, cursor, and saved scroll position; resets transient role, perspective, History, and Node grouping controls to their established defaults; and reloads every section for the new subject. It reapplies only the signed-in viewer's saved Action Item grouping, ordering, and displayed fields and never reads or preserves the selected subject's preferences.

MW69 - Changing the company or auth session cancels or invalidates outstanding My Work and directory reads, clears prior member and work data, and prevents a late response from rendering or repopulating a current-session cache.

MW70 - The three elevated My Work columns keep visible top, bottom, left, and right insets inside the page. Horizontal overflow includes a real trailing inset after Projects so its rounded edge and shadow are never cut off.

## Process Story: A viewer securely sees another member's work

A company member opens My Work beneath My Tower and sees their own perspective by default

↓

The viewer may open the people control, search the current company directory under its existing Team and group hierarchy, and select another current member or return to their own perspective

↓

Mango qualifies Action Items, Nodes, Processes, and Projects from the selected subject, applies the signed-in viewer's current permissions before grouping, ordering, counting, or cursor pagination, and reads only the viewer's saved presentation preferences

↓

The four sections keep their established perspective, role, History, grouping, ordering, inline-label, pagination, refresh, and realtime behavior while inaccessible rows, headings, counts, cursors, and references remain absent

↓

Changing the subject starts fresh section reads and prevents an older subject or auth-session response from appearing

↓

Every displayed resource still performs its normal current permission check when opened
