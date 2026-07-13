Last updated: 2026-07-13

# Project Management Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (`tests/frontend/modules/project-management/projectRelationshipGrouping.test.ts` covers the Project Logic Gates / Nodes universal grouping model, including normalization, empty Logic Gates, flat rows, collapsed visible-node ordering, and the embedded node-panel opener; `tests/frontend/modules/project-management/projectManagementApi.test.ts` covers PM55 timeline/workspace/project-detail title reducers and current Critical Path picker labels; `tests/frontend/modules/editor/nodeTextBlockProjectionSaves.test.ts` covers serialized latest-content project text-block envelopes; `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts` covers the shared Project relationship node shell/fullscreen action, project attached-reply resource context, and formatting-owner invalidation; `tests/frontend/modules/grouping/universalStatusGrouping.test.ts` covers shared status precedence; `tests/frontend/app/deepLinkRoutes.test.ts` covers the Project return route and project-matched work-panel history state; `tests/frontend/hooks/keyboardShortcutRouting.test.ts` covers the Backspace editing boundary; other rule IDs are not fully mapped to automated tests yet)

## Business Logic

PM1 - Listing projects requires company access.
PM2 - Project lists only include projects the viewer can access with view permission or higher.
PM3 - Creating a project requires a company ID and nonblank project name.
PM4 - Project creation stores project status, health, account IDs, and team IDs when those values are provided.
PM5 - Reading a project requires view access to that project.
PM6 - Project detail responses include project metadata, information/projections, relationships, critical path, counts, and edit/admin capability flags.
PM7 - Updating project metadata requires edit access to the project.
PM8 - Deleting a project requires admin access to the project.
PM9 - Project deletion uses the Company Explorer target deletion path so tree placement and project data are removed consistently.
PM10 - Adding or changing project information/projection rows requires edit access to the project.
PM11 - Deleting project information/projection rows requires edit access to the project.
PM12 - Listing project relationships requires view access to the project.
PM13 - Project relationship lists filter related nodes and logic gates by the viewer's access to those related resources.
PM14 - Creating a project relationship requires edit access to the project.
PM15 - Deleting a project relationship requires edit access to the project.
PM16 - Project relationships can target nodes and logic gates.
PM17 - Reading a project's critical path requires view access to the project.
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
PM36 - The project detail work panel exposes Critical Path and Logic Gates / Nodes as distinct project relationship views. Critical Path is the default for a fresh entry or history state that does not carry a valid tab marker for that exact Project.
PM37 - Double-clicking a node in the Project Logic Gates / Nodes view replaces the right-hand Logic Gates / Nodes region with a Project-owned node-panel selection. It does not open the app/sidebar popup or replace the Project page.
PM38 - Opening a node from Project Management preserves node-level access, node information/projection persistence, unified node shell behavior, unified node text-box editor semantics, and separate chat-pane behavior; Project Management owns only the local panel selection and must not become the persistence owner for node edits.
PM39 - The node workspace project assignment control is a content-sized action, not a spacer. The unassigned `Assign to Project` button must remain compact, and the assigned `Project: <project name>` button may grow only until the node header project-control maximum before ellipsizing.
PM40 - The node workspace project assignment menu must use the compact project-picker width contract: nominal minimum 280px, desktop maximum 390px, compact-layout maximum 320px, and no wider than the browser viewport allows.
PM41 - The node workspace project assignment menu must avoid right-edge clipping by shifting left when there is not enough visible space to the right of the button; project rows and optional Logic Gate rows must remain readable without horizontal viewport overflow.
PM42 - Project permission controls use the canonical permissions contract in `docs/tests/permissions.md`: every editable dialog or embedded view exposes **Save**, saving persists the current selection without closing, and read-only/denied states never issue a write.
PM43 - Project Management attached-email views follow `docs/tests/projects.md` P32: personal picker attachments and personal email-drop conversions retain `account_email`, shared conversions retain both `shared_inbox_id` and `account_email`, and subsequent thread, attachment, reply, draft, and calendar operations use that stored mailbox scope.
PM44 - Project Logic Gates / Nodes uses the shared universal grouping engine to render recursive group headers and relationship rows instead of Logic Gate cards. Logic Gate ascending is the default, while an explicit empty grouping stack renders a flat list.
PM45 - Project relationship grouping supports Logic Gate, Type, Status, Date Added, and Email Origin with ordered levels and ascending/descending direction. Changing these settings changes presentation only and never mutates relationship data. The stack is a browser-local preference scoped to company/current user and shared across that user's projects, not an API-backed named My Work/Updates saved view.
PM46 - Empty visible Logic Gates remain in the grouped row tree. A node may group under a Logic Gate only when that Logic Gate relationship is itself visible; otherwise it appears under No logic gate.
PM47 - Logic Gate group/resource rows retain Logic Gate open, context-menu, create-node, node-move, and email-drop behavior; node rows retain selection, standard node opening, context menus, and status/critical/email-origin indicators.
PM48 - Collapsed grouping branches are excluded from the rendered node selection order, so Shift/Ctrl/Command selection operates on the exact currently visible node rows.
PM49 - The Project Logic Gates / Nodes node panel exposes the shared fullscreen action. Fullscreen expands the same live node editor across the browser viewport, and toggling it off restores the editor to the right-hand Project region without resetting grouping, collapse, or selected-node state.
PM50 - Opening a related Logic Gate from the Project detail work panel canonicalizes the current history entry to `/projects/{project_id}`, records the current Critical Path or Logic Gates / Nodes tab on that Project-matched entry, and then pushes `/logic-gates/{logic_gate_id}`. Changing the Project detail toggle updates that entry so later history returns restore the latest selection. Browser Back and unmodified Backspace outside editable content return to that exact Project with the recorded tab restored; fresh or mismatched Project entries retain the PM36 Critical Path default, and editable Backspace remains native.
PM51 - Status grouping uses one shared contract across Updates, My Work, and Project Logic Gates / Nodes. Ascending recognized order is In Progress, Review, Pending, Requested, Backlog, Done; Verify aliases join Review, Request/Requests join Requested, Backlogs/Back Logs/Backlogged join Backlog, and completed/closed/archived aliases join Done. Descending reverses recognized nonterminal groups while Done remains last. Unknown nonblank and No status groups have distinct identities and remain before Done.
PM52 - Project information text-block persistence uses the project-scoped latest-content save controller. Title, document, and attachment references are saved as one coherent envelope; saves do not overlap, later edits coalesce, deletion waits for an in-progress save, stale reloads cannot replace dirty local content, and project-scope teardown drains changed blocks.
PM53 - An attached-email reply opened from Project Management keeps project attachment ownership and the originating information ID for files and inline images, while mailbox provenance continues to determine the provider thread, reply, draft, and send scope.
PM54 - Node-open project-relationship reads use a company/resource-scoped shared singleflight/cache. Creating, updating, or deleting a project relationship invalidates that exact cache before any local refresh signal, so React StrictMode and multiple node windows do not duplicate the same canonical relationship request or restore a stale result.
PM55 - A successful same-window Node or Logic Gate rename patches matching Project Management timeline `display_title`, workspace Node/Logic Gate labels, Project detail relationship/critical-path `display_title`, and active selected/context entity labels from the concrete committed-title event. It does not create a Project Management realtime scope or canonical reload and must not replace generic multi-resource delete-confirmation labels.

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

Given:
- A company has projects with different access grants for the viewer.
- A user can view one project, edit another project, and admin a third project.

Expected:
- The project list requires company access and returns only viewable projects.
- Creating a project fails without company ID or name.
- Creating a project stores provided status, health, accounts, and teams.
- Project detail requires view access and returns metadata, projections, relationships, critical path, counts, and capability flags.
- Updating metadata requires edit access.
- Deleting a project requires admin access and removes it through the Company Explorer target deletion path.

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
- Relationship listing requires project view access and hides related resources the viewer cannot view.
- Relationship create/delete requires project edit access.
- Relationships accept node and logic gate targets.
- Critical path listing requires project view access and hides inaccessible underlying resources.
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
- Reads and writes follow project view/edit permissions.
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

Given:
- A project has related Logic Gates and nodes.
- Its nodes include recognized workflow statuses and may include legacy Verify or Backlogged spellings.
- The viewer can access the project and at least one related node.

Expected:
- The project detail work panel shows Critical Path before Logic Gates / Nodes and opens on Critical Path by default.
- Switching to Logic Gates / Nodes shows project relationships without changing the project relationship data.
- Double-clicking a node in Logic Gates / Nodes replaces that right-hand region with the node editor while keeping the Project page open.
- The embedded node panel applies node access and saves node edits through node information/projection persistence.
- Project Management owns only the panel selection; it does not own node text-box edits, attached-email edits, or node chat messages.
- Node text boxes use the unified editor semantics, and node chats remain separate chat panes.
- Fullscreen expands the same node editor across the browser viewport, and toggling fullscreen off restores it to the right-hand region with grouping and selection state intact.
- Logic Gates and nodes render as recursive indented rows rather than Logic Gate cards, with Logic Gate ascending as the default grouping.
- The grouping stack can be reordered, changed, or emptied without changing the underlying relationships; empty Logic Gates and nodes without a visible gate remain visible in the appropriate row path.
- Collapse state controls the visible node ordering used by multi-selection, while group/resource rows preserve their existing open, context-menu, and drop behavior.
- Status ascending is In Progress, Review, Pending, Requested, Backlog, Done; legacy aliases join their canonical group and Done remains last in descending order.
- Double-clicking a Logic Gate pushes its Logic Gate route over a canonical Project return entry that records the current work-panel tab, so browser Back or safe unmodified Backspace returns to the exact Project and restores Logic Gates / Nodes when that is where the user came from. Later toggle changes update that same entry.
- A fresh Project entry or history marker for a different Project still defaults to Critical Path.

### Scenario PM-S7: Project Permission Controls

Business logic covered:
- PM42

Given:
- A user opens project permissions from Project Management or another project entry point.

Expected:
- The view follows the shared permission component and authorization rules documented in `docs/tests/permissions.md`.
- An editable view always shows **Save**, persists the selected permissions on save, and remains open after success.
- A read-only or denied view stays dismissible and does not submit a permission mutation.

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
