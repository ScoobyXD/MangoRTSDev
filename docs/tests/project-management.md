Last updated: 2026-08-17

# Project Management Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (`backend/internal/store/company_explorer_v2_test.go` covers project deletion preserving associated nodes and Logic Gates; `tests/frontend/modules/project-management/projectRelationshipGrouping.test.ts` covers the Project Logic Gates / Nodes universal grouping model and inline node expansion wiring; `tests/frontend/modules/project-management/projectManagementApi.test.ts` covers PM55 title reducers and picker labels; `tests/frontend/modules/project-management/projectListView.test.ts` covers Project list grouping and filter matching; `tests/frontend/modules/editor/nodeTextBlockProjectionSaves.test.ts` covers serialized latest-content project text-block envelopes; `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts` covers the shared Project relationship inline node shell, project attached-reply resource context, and formatting-owner invalidation; `tests/frontend/modules/grouping/universalStatusGrouping.test.ts` covers shared status precedence; `tests/frontend/app/deepLinkRoutes.test.ts` covers Project return/default-tab history state, browser-back detail clearing, and rename propagation; `tests/frontend/hooks/keyboardShortcutRouting.test.ts` covers the Backspace editing boundary; other rule IDs are not fully mapped to automated tests yet)

## Business Logic

PM1 - Listing projects requires company access.
PM2 - Project lists only include projects the viewer can access with edit permission or higher.
PM3 - Creating a project requires a company ID and nonblank project name.
PM4 - Project creation stores project status, health, account IDs, and team IDs when those values are provided.
PM5 - Reading a project requires edit access to that project.
PM6 - Project detail responses include project metadata, information/projections, relationships, critical path, counts, and the single `can_edit` capability flag.
PM7 - Updating project metadata requires edit access to the project.
PM8 - Deleting a project requires edit access to the project.
PM9 - Project deletion uses the Company Explorer target deletion path to remove the project, its placement, and project-owned associations/data consistently. Related nodes, Logic Gates, node-to-gate assignments, and Kanban boards are independent resources and must remain active.
PM10 - Adding or changing project information/projection rows requires edit access to the project.
PM11 - Deleting project information/projection rows requires edit access to the project.
PM12 - Listing project relationships requires edit access to the project.
PM13 - Project relationship lists filter related nodes and logic gates by the viewer's access to those related resources.
PM14 - Creating a project relationship requires edit access to the project.
PM15 - Deleting a project relationship requires edit access to the project.
PM16 - Project relationships can target nodes and logic gates.
PM17 - Reading a project's critical path requires edit access to the project.
PM18 - Critical path rows are filtered by the viewer's access to the underlying node or logic gate.
PM19 - Creating, updating, reordering, or deleting critical path rows requires edit access to the project.
PM20 - Critical path rows sort by position, then creation time, then ID.
PM21 - Creating a node from a project context requires edit access to the project and creates the project relationship.
PM22 - Creating a logic gate from a project context requires edit access to the project and creates the project relationship.
PM23 - Project-scoped creation can include initial information, account data, or assignment data and must keep those records tied to the created resource.
PM24 - Project Management timeline reads use the canonical work-item read model with company, authorized viewer, target user, bounded limit, and current rows; no realtime scope, projection sequence, or replay cursor is returned.
PM25 - Timeline items can target only node or logic gate entities.
PM26 - Creating a timeline item requires access to the target entity and a valid start date.
PM27 - Timeline item duration is normalized into the supported range.
PM28 - A user can create timeline items for themself when entity access allows it.
PM29 - Creating timeline items for another user requires company manager authorization.
PM30 - Updating or deleting a timeline item requires authorization for the timeline item's owner.
PM31 - Adding an existing node to a project from the node workspace requires selecting the project; selecting a Logic Gate that belongs to that project is optional.
PM32 - Confirming node-to-project assignment without a Logic Gate creates or updates the node/project relationship and does not change Logic Gate assignment.
PM33 - Opening a project from a node workspace Go to Project action navigates to the related project without changing the node/project relationship.
PM34 - Confirming a project Logic Gate assignment creates or updates the node/project relationship and assigns or moves the node to the selected project Logic Gate using the normal project and Logic Gate access rules.
PM35 - Project information/projection attachment payloads must follow `docs/tests/attachments.md`: durable project rows store Mango attachment references instead of data URLs, base64 file bytes, or embedded file payloads, and mutation/read access follows project permissions.
PM36 - The project detail work panel exposes Logic Gates / Nodes in the left toggle position and Critical Path in the right toggle position. Logic Gates / Nodes is the default for a fresh entry or history state that does not carry a valid tab marker for that exact Project.
PM37 - Clicking a node row in the Project Logic Gates / Nodes view expands a Project-owned unified node editor immediately below that row. Clicking the same row again collapses it; it does not open the app/sidebar popup or replace the Project page.
PM38 - Opening a node from Project Management preserves node-level access, node information/projection persistence, unified node shell behavior, unified node text-box editor semantics, and separate chat-pane behavior; Project Management owns only the local panel selection and must not become the persistence owner for node edits.
PM39 - The node workspace project assignment control is a content-sized action, not a spacer. The unassigned `Assign to Project` button must remain compact, and the assigned `Project: <project name>` button may grow only until the node header project-control maximum before ellipsizing.
PM40 - The node workspace project assignment menu must use the compact project-picker width contract: nominal minimum 280px, desktop maximum 390px, compact-layout maximum 320px, and no wider than the browser viewport allows.
PM41 - The node workspace project assignment menu must avoid right-edge clipping by shifting left when there is not enough visible space to the right of the button; project rows and optional Logic Gate rows must remain readable without horizontal viewport overflow.
PM42 - Project permission controls use the canonical permissions contract in `docs/tests/permissions.md`: every editable dialog or embedded view exposes **Save**, saving persists the current selection without closing, and denied states never issue a write.
PM43 - Project Management attached-email views follow `docs/tests/projects.md` P32: personal picker attachments and personal email-drop conversions retain `account_email`, shared conversions retain both `shared_inbox_id` and `account_email`, and subsequent thread, attachment, reply, draft, calendar event-detail/card, and RSVP operations use that stored mailbox scope.
PM44 - Project Logic Gates / Nodes uses the shared universal grouping engine to render recursive group headers and relationship rows instead of Logic Gate cards. Logic Gate ascending is the default, while an explicit empty grouping stack renders a flat list.
PM45 - Project relationship grouping supports Logic Gate, Type, Status, Date Added, and Email Origin with ordered levels and ascending/descending direction. Changing these settings changes presentation only and never mutates relationship data. The stack is a browser-local preference scoped to company/current user and shared across that user's projects, not an API-backed Updates saved view.
PM46 - Empty visible Logic Gates remain in the grouped row tree. A node may group under a Logic Gate only when that Logic Gate relationship is itself visible; otherwise it appears under No logic gate.
PM47 - Logic Gate group/resource rows retain Logic Gate open, context-menu, create-node, node-move, and email-drop behavior; node rows retain selection, standard node opening, context menus, and status/critical/email-origin indicators.
PM48 - Collapsed grouping branches are excluded from the rendered node selection order, so Shift/Ctrl/Command selection operates on the exact currently visible node rows.
PM49 - The Project Logic Gates / Nodes node editor normally remains inline in the relationship list and preserves grouping, collapse, and selected-node state. It exposes the standard node-window actions: close/collapse, fullscreen/restore, minimize to the app dock, open in a new browser tab, pin, and Move to Recycle Bin through the existing typed confirmation. Fullscreen temporarily uses the shared modal portal and returns to the same inline row when restored.
PM50 - Opening a related Logic Gate from the Project detail work panel canonicalizes the current history entry to `/projects/{project_id}`, records the current Critical Path or Logic Gates / Nodes tab on that Project-matched entry, and then pushes `/logic-gates/{logic_gate_id}`. Changing the Project detail toggle updates that entry so later history returns restore the latest selection. Browser Back and unmodified Backspace outside editable content return to that exact Project with the recorded tab restored; fresh or mismatched Project entries retain the PM36 Logic Gates / Nodes default, and editable Backspace remains native.
PM51 - Status grouping uses one shared contract across Updates and Project Logic Gates / Nodes. Ascending recognized order is In Progress, Review, Pending, Requested, Backlog, Done; Verify aliases join Review, Request/Requests join Requested, Backlogs/Back Logs/Backlogged join Backlog, and completed/closed/archived aliases join Done. Descending reverses recognized nonterminal groups while Done remains last. Unknown nonblank and No status groups have distinct identities and remain before Done.
PM52 - Project information text-block persistence uses the project-scoped latest-content save controller. Title, document, and attachment references are saved as one coherent envelope; saves do not overlap, later edits coalesce, deletion waits for an in-progress save, stale reloads cannot replace dirty local content, and project-scope teardown drains changed blocks.
PM53 - An attached-email reply opened from Project Management keeps project attachment ownership and the originating information ID for files and inline images, while mailbox provenance continues to determine the provider thread, reply, draft, and send scope.
PM54 - Node-open project-relationship reads use a company/resource-scoped shared singleflight/cache. Creating, updating, or deleting a project relationship invalidates that exact cache before any local refresh signal, so React StrictMode and multiple node windows do not duplicate the same canonical relationship request or restore a stale result.
PM55 - A successful same-window Node or Logic Gate rename patches matching Project Management timeline `display_title`, workspace Node/Logic Gate labels, Project detail relationship/critical-path `display_title`, and active selected/context entity labels from the concrete committed-title event. It does not create a Project Management realtime scope or canonical reload and must not replace generic multi-resource delete-confirmation labels.
PM56 - The Project editor header uses the shared primary order Editor, Permissions, formatting toolbar, and Outline Styles/Automatic Numbering. Assignments and available open/minimize commands remain in one accessible **More editor actions** menu. Project assignment/permission dialogs and previews use the shared body-level overlay layer above Key Views, Explorer, and Search Explorer and trap/restore focus when blocking; the Logic Gates / Nodes editor remains inline in document flow except while its explicit fullscreen action temporarily mounts it in that shared modal layer.
PM57 - A Node backed by an email collaboration uses normal project-relationship attach/upsert/delete behavior. Project projections preserve its `created_from_email` origin so the established email icon renders. Collaboration participant authorization and canonical source-email protection remain unchanged by project membership.
PM58 - A successful inline Project rename updates the parent Project Management list immediately. Browser Back from `/projects/{project_id}` to `/project-management` clears the detail target and shows the Project list with the committed name.
PM59 - Expanding a node in Project Logic Gates / Nodes renders the inline node editor at the full relationship-panel width. Group and row depth still indent the collapsed row labels, but must not add a left offset or reduce the width of the expanded editor.
PM60 - Project Logic Gates / Nodes exposes an Add control that opens an elevated Company Explorer search surface restricted to Nodes and Logic Gates. Choosing a result creates or reuses its project relationship; a selected Logic Gate follows the existing Logic Gate-add contract and includes its known child nodes. Existing relationships are visibly marked and cannot be added again.

PM61 - Project Status, Health, Account, and Team dropdowns are one-click commit controls. Selecting an option immediately persists that selected or toggled value and closes the menu, with no staged Apply or Cancel footer. Multi-value controls preserve every other selected ID, while Not set clears the complete assignment.
PM62 - Project metadata has no generic Field column, **Fields** control, field assignment, or entity-field assignment endpoint. Entities remain independent resources and may appear in Project editor content only as `#` references.
PM63 - Project Summary chat gives every current user's sent comment an author-only Edit action. A successful edit PATCHes the stable Project chat projection, preserves reply/source/attachment/creation metadata and ordering, updates the displayed text and mention IDs, and marks the comment Edited. Project Edit permission alone never permits editing or deleting another author's comment, and the generic Project information POST cannot overwrite an existing chat projection.
PM64 - The Projects view menu exposes Project name, Account, Team, Status, Health, Date created, and Date updated filters beneath the existing grouping controls.
PM65 - Project list filters use OR between selected values in one category and AND between categories. Date range endpoints are inclusive, and Account and Team each offer an Unassigned value.
PM66 - Project list filtering runs before grouping, group counts use only matching Projects, and the header reports the matching count when any filter is active.
PM67 - Project list filters change presentation only, remain session state, and never mutate Project data or issue a filtered Project API request.

## Scenarios

### Scenario PM-S1: Project Access, Create, Read, Update, Delete

Business logic covered:
- PM1
- PM2
- PM3
- PM4
- PM5
- PM6
- PM7
- PM8
- PM9
- PM64
- PM65
- PM66
- PM67

Given:
- A company has projects with different access grants for the viewer.
- A user can view one project, edit another project, and admin a third project.

Expected:
- The project list requires company access and returns only viewable projects.
- Creating a project fails without company ID or name.
- Creating a project stores provided status, health, accounts, and teams.
- Project detail requires edit access and returns metadata, projections, relationships, critical path, counts, and capability flags.
- Updating metadata requires edit access.
- Deleting a project requires edit access and removes it through the Company Explorer target deletion path.
- Deleting the project removes its project-owned associations/data but leaves related nodes, Logic Gates, node-to-gate assignments, and Kanban boards active.
- The Projects view menu filters the loaded list by Project name, Account, Team, Status, Health, and inclusive created or updated date ranges before grouping it.
- Choices within one filter category are alternatives, different filter categories must all match, and Account and Team can match Unassigned Projects.
- Clearing or reloading the session removes the presentation-only filters without changing any Project.

### Scenario PM-S2: Project Information, Relationships, And Critical Path

Business logic covered:
- PM10
- PM11
- PM12
- PM13
- PM14
- PM15
- PM16
- PM17
- PM18
- PM19
- PM20

Given:
- A project has information rows, node relationships, logic gate relationships, and critical path rows.
- The viewer can view the project but cannot view every related node or logic gate.

Expected:
- Information/projection mutations require edit access.
- Relationship listing requires project edit access and hides related resources the viewer cannot view.
- Relationship create/delete requires project edit access.
- Relationships accept node and logic gate targets.
- Critical path listing requires project edit access and hides inaccessible underlying resources.
- Critical path mutations require project edit access.
- Critical path ordering is deterministic by position, creation time, and ID.

### Scenario PM-S3: Project-Scoped Work Creation

Business logic covered:
- PM21
- PM22
- PM23

Given:
- A user creates a node or logic gate from inside a project.
- The request may include initial information, account data, or assignment data.

Expected:
- Creation requires project edit access.
- Created nodes and logic gates are related to the project.
- Initial information, account data, and assignment data are attached to the created resource and do not drift to another resource.

### Scenario PM-S3B: Project Information Attachments Use Mango Attachments

Business logic covered:
- PM6
- PM10
- PM11
- PM35
- PM52

Given:
- A user adds pasted images or files to a project information/projection text block.
- The user has project edit access.
- The user changes the block title, document, or attachment list while a save is already in progress, or deletes/switches projects while changed content remains.

Expected:
- The project information/projection mutation stores attachment references, not inline file bytes.
- Project detail reads return metadata/content references small enough for normal project load paths.
- Reads and writes require project edit access; no access hides the project.
- Deleting the project information/projection row does not require deleting the underlying S3 object while other resource links may still reference it.
- Project text-block saves do not overlap. Later edits coalesce into one follow-up containing the latest title, document, and attachment references, and an older completion cannot mark newer content saved.
- A stale project reload cannot replace dirty local text-block content; deletion waits for the in-progress save, and leaving the project drains changed blocks from that project scope.

### Scenario PM-S4: Project Management Timeline

Business logic covered:
- PM24
- PM25
- PM26
- PM27
- PM28
- PM29
- PM30
- PM55

Given:
- A user views Project Management timeline data for themself or another user.
- Timeline items target nodes or logic gates, and the same entities are visible in Project Management workspace/project-detail caches when a rename commits elsewhere in the window.

Expected:
- Timeline reads use the canonical work-item read model with company, authorized viewer, target user, bounded limit, and current rows only.
- Timeline items reject entity types other than node and logic gate.
- Creating a timeline item requires entity access and a valid start date.
- Duration is normalized into the supported range.
- A user can create timeline items for themself when access allows.
- Creating for another user requires company manager authorization.
- Updating or deleting a timeline item requires authorization for the item owner's timeline.
- The committed-title event patches all matching timeline/workspace/project-detail entity labels locally without a reload, while generic delete-confirmation noun/count labels remain unchanged.

### Scenario PM-S5: Assign Existing Node From Node Workspace

Business logic covered:
- PM31
- PM32
- PM33
- PM34
- PM39
- PM40
- PM41
- PM57

Given:
- A user edits an existing node.
- The company has at least one project, and one project may have related Logic Gates.
- The user opens the node workspace project assignment control.

Expected:
- The closed project assignment control is compact when no project is assigned and grows only as needed for the assigned project label.
- The first assignment step lists accessible projects.
- The project picker opens at the compact menu width and shifts left when necessary to keep the list inside the visible node workspace or browser viewport.
- After a project is selected, the user can assign the node directly to the project without choosing a Logic Gate.
- The optional second step lists Logic Gates related to that project.
- Confirming project-only assignment creates or updates the node/project relationship and does not require node priority.
- Confirming a Logic Gate creates or updates the node/project relationship and assigns or moves the node to the selected Logic Gate.
- Go to Project opens the related project directly and does not mutate project relationships.
- Confirming assignment for an email Node uses the same project-only or project-plus-Logic-Gate flow as an ordinary Node, preserves `created_from_email` for its icon, and does not change collaboration participants or provider recipients.

### Scenario PM-S6: Project Relationship Node Openers

Business logic covered:
- PM36
- PM37
- PM38
- PM44
- PM45
- PM46
- PM47
- PM48
- PM49
- PM50
- PM51
- PM56
- PM58
- PM59
- PM60

Given:
- A project has related Logic Gates and nodes.
- Its nodes include recognized workflow statuses and may include legacy Verify or Backlogged spellings.
- The viewer can access the project and at least one related node.

Expected:
- The project detail work panel shows Logic Gates / Nodes before Critical Path and opens on Logic Gates / Nodes by default.
- Switching between the two views does not change project relationship data.
- Clicking a node row in Logic Gates / Nodes expands its node editor immediately below the row while keeping the Project page open; clicking the row again collapses it.
- The expanded node editor fills the relationship-panel width without inheriting the collapsed row's group-depth indentation.
- **Add** opens an elevated Company Explorer search limited to Nodes and Logic Gates. Selecting an available result attaches it to the Project, selecting a Logic Gate includes its known child nodes, and an already-related result remains marked and disabled.
- The embedded node panel applies node access and saves node edits through node information/projection persistence.
- Project Management owns only the panel selection; it does not own node text-box edits, attached-email edits, or node chat messages.
- Node text boxes use the unified editor semantics, and node chats remain separate chat panes.
- The Project editor header keeps Editor, Permissions, the shared formatting toolbar, and Outline Styles/Automatic Numbering in its primary area; Assignments and available open/minimize commands remain in **More editor actions**.
- The node editor stays in the relationship list flow with grouping and selection state intact by default. Its standard controls can open a new browser tab, pin it, minimize it to the app dock, temporarily enter/exit fullscreen, collapse it, or move the node to Recycle Bin through typed confirmation.
- Logic Gates and nodes render as recursive indented rows rather than Logic Gate cards, with Logic Gate ascending as the default grouping.
- The grouping stack can be reordered, changed, or emptied without changing the underlying relationships; empty Logic Gates and nodes without a visible gate remain visible in the appropriate row path.
- Collapse state controls the visible node ordering used by multi-selection, while group/resource rows preserve their existing open, context-menu, and drop behavior.
- Status ascending is In Progress, Review, Pending, Requested, Backlog, Done; legacy aliases join their canonical group and Done remains last in descending order.
- Double-clicking a Logic Gate pushes its Logic Gate route over a canonical Project return entry that records the current work-panel tab, so browser Back or safe unmodified Backspace returns to the exact Project and restores Logic Gates / Nodes when that is where the user came from. Later toggle changes update that same entry.
- A fresh Project entry or history marker for a different Project defaults to Logic Gates / Nodes.
- Renaming the current Project updates the parent Project list immediately.
- Browser Back to `/project-management` clears the detail target and shows that list with the committed Project name.

### Scenario PM-S7: Project Permission Controls

Business logic covered:
- PM42

Given:
- A user opens project permissions from Project Management or another project entry point.

Expected:
- The view follows the shared permission component and authorization rules documented in `docs/tests/permissions.md`.
- An editable view always shows **Save**, persists the selected permissions on save, and remains open after success.
- A denied view stays dismissible and does not submit a permission mutation.

### Scenario PM-S8: Project Attached-Email Provenance

Business logic covered:
- PM6
- PM43
- PM53

Given:
- Project Management opens one personal attached email and one email derived from a Shared Triage conversion.
- The user replies from an email attached to a project text block and adds a file or inline image.

Expected:
- The personal projection retains the active account email and the shared projection retains both shared-inbox ID and account email.
- Reopening the message uses the stored mailbox scope for thread hydration, recipients, attachments, Reply/Reply All, draft resume, and calendar invitation response.
- A shared message never silently falls back to a personal grant.
- Reply files and inline images remain linked to the project and originating project information ID, while the stored personal/shared mailbox scope continues to authorize provider reads, drafts, replies, and sends.

### Scenario PM-S9: Immediate Project Metadata Selection

Business logic covered:
- PM61
- PM62

Given:
- A project has editable Status, Health, Account, and Team metadata.

Expected:
- Selecting any option immediately saves that option and closes its dropdown.
- Account and Team clicks toggle only the clicked assignment while preserving the other selected assignments.
- Choosing Not set clears the complete value for that multi-value control.
- No Project metadata dropdown displays Apply or Cancel buttons.
- Project Summary exposes no generic Field column, **Fields** control, field assignment, or entity-field assignment endpoint.
- An Entity may appear in Project editor content only as a `#` reference and never becomes Project metadata.

### Scenario PM-S10: Edit A Project Comment

Business logic covered:
- PM63

Given:
- Project Summary chat contains comments from the current user and another Project editor.

When:
- The current user edits their own comment and attempts to edit or delete the other comment.

Expected:
- The inline edit saves the current user's changed text and mentions on the stable Project projection and shows Edited.
- Reply/source context, attachments, author, creation time, and ordering remain unchanged.
- The other comment has no Edit action, and direct edit/delete requests for it are forbidden.
- A failed save restores the canonical row and keeps the edit draft available.

Focused backend coverage lives in `backend/internal/http/chat_comment_edit_test.go`; the shared mounted UI behavior is covered by `tests/frontend/modules/editor/editorTextBlockChatNavigation.test.tsx`.
