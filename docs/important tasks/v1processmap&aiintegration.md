# V1 Process Map and AI Integration — Requirements and Step Mapping MVP

Updated: September 4, 2026

Status: The initial Step and AI increments were integrated into main. The current correction makes the company Process Map the starting point for Process and Step authoring, as Jonat clarified on September 4. Review this small flow before choosing another increment; live rollout remains separate.

## Purpose and precedence

This is the durable requirements record extracted from Jonat's full independent-copy specification and his September 4 decision to build in small, complete increments. The existing V2 Process Maps document remains separate and unchanged.

The full product destination is recorded below, but it is not one implementation task. The latest staging decision supersedes the original instructions to implement everything at once. Future requirements do not expand the first MVP or authorize starting later increments automatically.

This document describes desired behavior, not shipped behavior. Current behavior remains documented in `docs/tests/*.md`. When implementation intentionally changes a numbered law, update that law and its process story in the same change. Do not add compatibility layers or a second source of truth to avoid making the change explicitly.

## First delivery: Step mapping MVP

### Required behavior

1. Start on the company Process Map with its existing root Folders, top-right Create Folder / Create Process / Create Step buttons, and the same actions in the map's right-click menu.
2. Save the Process into the existing Company Explorer at that location, without an unexplained duplicate root entry. Expand, reveal, and select its location using the existing creation behavior.
3. Create Process opens its own full-canvas authoring workspace with an obvious Create Step button; the starting flow does not open the Board/SOP split.
4. Let the user create/name Steps, position and resize them, connect them, and arrange connection routes.
5. Persist Step positions, sizes, and routing on the server. The arrangement must survive save, reload, navigation away and back, and switching views.
6. Put a Board / Map toggle near the top-right of the existing Process board. Both modes use the same Process and exact Step records.
7. Board mode continues to show actual Nodes in the existing Step columns. Map mode edits the authored Step structure. Creating or arranging Steps never creates or duplicates runtime work.
8. Keep the existing sidebar, SOP editor, authorization, and working Process board. Add only what this small end-to-end feature needs.
9. The SOP describes the Process's Steps and briefly explains what happens in each one. The Step map makes those same Steps visible and editable as a structure; it does not need a separate per-Step instruction editor for the MVP. Step records still supply exact identities and board columns, while the SOP supplies the written operating instructions.
10. Above the draft canvas, show a selectable file-style destination path and Process name. Browse that path to choose an existing Folder, then explicitly save the complete Process and Steps there.
11. Keep the current Step-card styling for this correction; visual redesign is a separate increment.

### Working interpretation and small decisions

For this MVP, **Step map** means the internal map of one Process, authored directly from the company map and also accessible through its Board / Map toggle. **Company Process Map** means the existing whole-company Folder/Process canvas. The focused authoring workspace keeps the map shell and does not introduce a Workflow, another map record, or company-map placements for Steps.

Creation order: choose Create Process from the company canvas, name the draft and choose its destination path, author its Steps and arrangement, then Save the complete result atomically. Create Step on the company canvas starts a new Process draft containing its first Step. Every persisted Step still has one exact Process owner.

An empty Process is valid while being authored; one Step is valid. This resolves the original “one or more Steps” description against the requested empty creation flow and current zero-or-more-Step model.

Keep Board column order separate from Step x/y geometry unless Jonat explicitly requests that moving a Step on the map also reorders columns. Both still refer to the same Step. Connections use existing same-Process operational edges; route geometry is presentation for those edges, not a second relationship authority.

Implementation decisions:

- Choose an existing permitted Folder through a breadcrumb path with a small direct-child browser. Create Folder uses the existing Explorer command.
- Keep Process, Steps, connections, and geometry local until explicit Save commits them together with the Explorer placement and events.
- After initial Save, persist positions, sizes, and route points after each completed gesture and show saving, saved, and failure states.
- Reject stale layout revisions and reload the current layout so concurrent edits are not silently lost.
- Use snapped Step drag/resize and editable orthogonal route points, with keyboard controls.
- Start map creation in its focused canvas; the existing Board entry continues to start in Board mode. Zoom, scrolling, and view selection are local UI state.

### Explicitly deferred

- Workflows, Workflow Canvas, ownership/components, and nested Workflows.
- Process/Workflow duplication and recursive copying. Persistent source/copy tracking is prohibited entirely, not deferred.
- Explorer-to-Workflow Copy and Explorer-to-company-map Place, including their previews.
- New Explorer drag behavior; existing authorized Folder moves remain existing behavior.
- SOP, RACI, or permission copying; new policy levels or inheritance rules. Existing access checks and editing still apply.
- Starter department Folders, changing the app's initial page, and Me / Team / All filters.
- New undo infrastructure, advanced ports/conditional branching, and zoom summaries unless required by an existing interaction.
- Redesigning the company canvas or redefining Nodes and runtime statuses.

### MVP acceptance checks

1. Open company Process Map, see its root Folders and creation controls, then choose Create Process without entering the Board.
2. Select its destination breadcrumb and name; create Receive purchase order, Validate purchase order, Enter order, and Confirm order in the focused canvas before Save.
3. Save the Process once into the chosen Explorer Folder, then open its Board and switch between Board and Map through the top-right toggle.
4. Move/resize the Steps, connect them, and arrange their connection routes.
5. Save, reload, leave/reopen, and switch modes; layout and exact Step identities remain intact.
6. The board uses these same Steps, including Steps created on the map. Existing Nodes, statuses, assignments, and SOP content survive.
7. Preserve branching, endpoint validation, and existing deletion rules: deleting a Step clears its incident edges and Node Step references, without deleting Nodes or their Process membership.
8. Failed/unauthorized writes leave no orphan Step, broken edge, false saved state, or cross-Process/company change. Outdated responses must not replace newer local state.
9. Verify this increment with relevant backend/frontend/persistence/lifecycle tests and a short walkthrough. Future Workflow and copy scenarios are not MVP completion requirements.

## Full product destination — future requirements

The rest preserves the original specification. It is deferred except for requirements explicitly adopted by the MVP above.

### Product hierarchy and reuse

1. Mango maps the company's authored operating structure and opens the actual Process work experience from it; it must not become a disconnected diagramming app.
2. Folder → subfolders, Workflows, standalone Processes. Workflow → Processes and nested Workflows. Process → Steps. Runtime Nodes/tasks flow through those Steps.
3. Preserve existing domain meanings. Process is the existing Logic Gate identity, not a second stored `process` resource. Do not redefine Nodes, tasks, or runtime records.
4. Each Step has one exact Process owner and a stable ID. Preserve applicable name, description, configuration, ordering, assignments, and layout where supported. A Step is not a runtime Node.
5. A Process with one Step and a Workflow with one Process are valid; creation may start empty while authoring.
6. Reuse the current Explorer, board, editor, read/state handling, canvas/graph libraries, drag payloads, APIs, authorization, transactions, realtime events, and visual design. Check existing dependency APIs before adding packages; no large dependency without a demonstrated need.
7. Do not build a universal knowledge graph, resource registry, translated identity, reusable-reference graph, or automatic Process inference from Slack/email. Future AI context is background motivation, not this feature's scope.

### Independent copies, never reusable references

1. Dropping an existing Process or Workflow into a Workflow creates a complete independent authored copy with new domain identities. The source stays unchanged in its original location.
2. Later edits, names, assignments, permissions, and deletion of a source/copy never propagate to the other copies.
3. Store no `source_process_id`, `source_workflow_id`, `copied_from_id`, `origin_id`, or equivalent source relationship. Temporary old-to-new ID maps during a copy are allowed; persistent provenance mappings are not.
4. Do not add synchronization, source-version pinning, source assignment inheritance/overrides, usage counts, shared-edit warnings, reference/shortcut icons, shared badges, Reveal original, View usages, or canonical-versus-reference Explorer rows.
5. Existing general audit logging may record the operation, but the copied domain object must not depend on that event or the source.
6. Preserve the source name when allowed. Only if uniqueness requires it, use predictable Copy / Copy 2 suffixes. Allow immediate rename.

### Copy, Place, and Move

| Destination | Meaning | Result |
|---|---|---|
| Explorer → Workflow Canvas | Copy | Create a deep independent Process/Workflow child at the drop point; preserve source. |
| Explorer → whole-company Process Map | Place | Save presentation for the same Folder, Workflow, or standalone Process; create no definition copy. |
| Explorer → another Explorer Folder | Move | Change the existing object's structural location; duplicate only through a separate explicit Duplicate action. |

Show the operation before dropping: Copy/plus, Place, or Move. Use a polished ghost/blueprint with approximate shape and size where practical; simplify very large Workflow previews. Use user-facing labels such as Copy Process, Copy Workflow, Duplicate, Place on map, and Move to Folder, never source/reference terminology.

### One Company Explorer

1. Reuse the existing left Explorer as structural navigator and drag source. Do not add a competing Explorer, asset panel, Process library, or Workflow library.
2. Keep it visible or readily available in company map, Workflow Canvas, and Process editing where appropriate.
3. Support root/nested Folders, Workflows/nested Workflows, standalone/contained Processes, expand/collapse, selection, rename, supported reorder, Folder moves, and the destination-specific drags above.
4. New/copied objects appear as ordinary independent children. Expand the destination, highlight/select the new child, and preserve the source location.
5. Dragging a Process row already inside another Workflow copies that actual Process's data, never a reference.
6. Give each copied child one clear location beneath its destination Workflow. If storage still requires a Folder association, use the destination's Folder without rendering the child twice.
7. Selecting an Explorer object locates/selects its map placement where applicable; selecting a map object reveals its Explorer location. Renaming updates every view of the same object, not its independent copies.

### Creation and navigation

1. Create Workflow chooses or creates a Folder, creates the Workflow, reveals it in Explorer, and opens an empty Workflow Canvas with the existing Explorer available.
2. Offer Create Process below Create Workflow when both exist. Standalone creation likewise chooses/creates a Folder, reveals the Process, and opens Step authoring.
3. Creating a Process inside a Workflow creates a real child, shows its Canvas block and Explorer row, starts an empty board, and allows Steps, RACI, and permissions.
4. Create Step always targets a Process. A Workflow context action must require a selected Process, ask for one, or open one first. No orphan Workflow-level Steps.
5. Opening/double-clicking a Process reaches the existing SOP/editor and board with real Nodes in the same authored Steps.
6. Nested Workflow blocks look distinct from Processes, using a container, collapsed block, or similar Mango design. Opening/double-clicking enters that copied Workflow. No source paths or reference decorations.

### Process deep-copy contract

Copy every applicable authored record needed to reconstruct the Process:

- Process record, name, description, Process configuration, and explicitly included static child configuration.
- Current SOP/editor content, with a new document identity wherever documents have separate identities.
- Steps, ordering, supported Step configuration and Step-level assignments.
- Internal traces, edges, and relationships, with new edge identities and remapped endpoints.
- Step positions/sizes, routing/handles, Process/Step layout, and other supported presentation metadata.
- Independent copy-owned RACI and explicit permission configuration.

Allocate new Process, document, Step, edge, and independently identified child IDs. For composite-key tables, new copy-owned rows use the new owner ID; do not invent surrogate assignment/permission/layout IDs just to satisfy the original “new IDs” wording.

Remap every internal foreign key and typed reference: edges to copied Steps, layout/policies to copied owners, documents to the copied Process, and child configuration to its new owner. Preserve internal Step layout while the outer Process block uses the destination drop position.

Exclude existing Nodes/tasks, Node-to-Process/Step runtime assignments, Process-run records, execution/current work state, task/run history, runtime activity/comments/assignees/timelines, existing task attachments, and all other operational records. Do not copy partial runtime state. The copied board begins empty.

### Recursive Workflow deep-copy contract

1. Copy Workflow name/description, supported SOP/documentation, configuration, RACI, and explicit permissions.
2. Copy its actual containment/component records, every Process through the Process-copy contract, and every nested Workflow recursively.
3. Preserve complete composition: ordering, traces/edges/relationships, entry/exit information, positions/sizes, internal layout/routing, supported ports/handles, branch/condition metadata, and other authored configuration. A Workflow is not merely a list of child IDs.
4. Allocate new identities throughout the tree. Remap internal relationships, component endpoints, layout, documents, policies, and configuration to copied records.
5. Preserve internal relative layout; use the destination drop point only for the outer Workflow block.
6. Attach the copied Workflow as a real nested child with one Explorer location. Preserve the source tree and its runtime work.
7. Exclude Nodes, runtime assignments, execution state, histories, and operational records at every depth.
8. Reject direct self-copy with a clear “Cannot copy a Workflow directly into itself” error. Defend traversal against malformed recursion with a visited/path mechanism and any established nesting limit. Fail atomically, without looping or leaving a partial tree.
9. Do not build a reusable-Workflow DAG or generalized reference-cycle system; validate actual containment only.

### RACI and permission copying

1. Copy Responsible, Accountable, Consulted, and Informed configuration at every supported Workflow, Process, and Step level into independent copy-owned records.
2. Keep the same existing users and Teams/groups initially. Do not duplicate people, groups, companies, or organization roles, or expand group assignments into copied per-user rows.
3. Preserve existing validation/cardinality. Mango currently permits multiple Accountable principals; the original illustrative wording does not require a single Accountable party.
4. Changing/removing an assignment on a source or copy changes only that object's configuration. Group membership remains normal shared principal data, not source-copy synchronization.
5. Copy explicit permission settings and grants: visibility/default access, user/group/role entries, and administrative or publication configuration where supported. Do not invent permission categories absent from Mango.
6. Recalculate destination inheritance under the approved parent rules. Copying must not bypass company restrictions or the intended destination access restriction.
7. Authorize source access and creation inside the destination. Decide whether copying permission grants requires elevated authority under existing Mango rules.
8. No policy inheritance exists from the source merely because of copying. Distinguish source independence from normal inheritance from the copy's own destination parent.
9. Resolve how initial RACI is preserved when the source inherits instead of storing direct assignments. Copying only empty direct rows would lose its displayed assignments.

### SOP and authored-content boundaries

1. Copy the current authoritative document into an independent document owner/identity using existing storage. Do not share an editable document between source/copy or restore obsolete editor storage.
2. Current Process SOP content is Tiptap JSON in `logic_gate_textboxes.body_json`; recheck before implementation. The original mentions of Yjs/snapshots are conditional examples, not requirements to add them.
3. Remap document references into the copied definition tree. Decide treatment of external resource links, runtime Node/email chips, block identities, annotations, and authored attachment links. Blind JSON duplication is insufficient.
4. A retained SOP file needs a valid copy-owned attachment relationship so deleting the source cannot break it. Existing file bytes may be reused under normal attachment ownership/access rules. Runtime task attachments remain excluded.
5. Define inclusion of KPI definitions, other static configuration, and external operational/Project/Huddle/Account relationships. Do not accidentally copy historical scorecards, document history, or activity under “all authored data.”

### Whole-company map placement

1. Preserve existing Process Map terminology and the existing Explorer. Explorer is structural; the map is spatial.
2. Place existing Workflows, Folders, or standalone Processes without cloning definitions. Avoid duplicate placements of one object on one map unless deliberately supported.
3. Preserve a Workflow's internal layout and save its outer company-map position separately. Moving the outer block must not rewrite internal layout; internal edits must not unexpectedly move the outer placement.
4. Folder placement may show a region with subfolders, Workflows, standalone Processes, summary counts, and progressive detail by zoom. It represents existing contents without copying them.
5. Removing an object from the future company map removes only presentation placement, preserving the object and its Explorer location. This differs from current automatic placement and requires a deliberate law change later.
6. Spatial moves change layout; Explorer Folder moves change structural location. The interface must distinguish them.

### Layout and personal view state

| Layout level | Shared authored state |
|---|---|
| Steps inside a Process | Positions, sizes, visual ordering, supported handles, edge routing, z-order, and other presentation metadata. |
| Processes/nested Workflows inside a Workflow | Positions, sizes, ordering, traces/connections, routes, z-order, supported shared collapsed/expanded state, and composition presentation. |
| Whole-company map | Company/map scope, exact entity type/ID, outer x/y/width/height, supported z-order/visual region, and other map presentation. |

1. Keep operational relationships separate from visual geometry. Layout may point to exact resource IDs without becoming the forbidden reusable-reference system.
2. Save internal layout independently from outer placement; drop coordinates affect only the latter.
3. Restore layout after save, reload, navigation, reasonable viewport changes, and server synchronization. React state or browser-local storage alone is insufficient.
4. Pan, zoom, selection, open Explorer Folders, and temporary panel widths are personal preferences where supported; separate them from shared authored layout.
5. Debounce high-frequency persistence and save the final drag/resize/route result. Do not write every pointer movement to the database.
6. Prevent outdated responses or saves from incorrectly overwriting newer work. Define concurrency explicitly: current company-map writes use last-committed-save-wins, which differs from rejecting stale client writes.

### First-user experience and filters

1. Fresh companies should eventually receive editable starter root Folders such as Sales, Operations, Finance, and HR. Authorized users may rename, reorder, safely delete, and add root/nested Folders. These are editable examples, not permanent hard-coded categories.
2. Entering mapping should eventually open the company map with the existing Explorer, starter structure, and obvious Create Workflow action. No second library/sidebar.
3. Me, Team, and All filter the same company model; they are not separate storage, maps, Folders, visibility settings, or copy modes.
4. Filters use the copied object's own RACI. Its assignment changes affect its Me/Team appearance without altering the source. All includes only authorized content.
5. Same-object names, selection, creation, and layout reconcile across Explorer, company map, Workflow Canvas, Process map, editor, and board. Independent copies receive no source changes.

### Transactions, errors, and lifecycle

1. Use one backend definition-copy operation with reusable transaction-level helpers, not copy loops scattered across controllers and UI.
2. Validate exact same-company source/destination identities, allowed types, access, and endpoint scope; recheck under the command's transaction/locking rules where needed.
3. In one transaction, allocate new owners/documents/children, build temporary ID maps, copy allowed authored data, remap edges and policies, attach the child, save its drop position, and publish normal committed events.
4. Recursive copying participates in that same outer transaction. A sequence of independently committing CRUD calls is not atomic copying.
5. Commit all required data or roll back everything. Failure leaves no orphan Step, broken trace, dangling grant, half-copied Process, or empty nested Workflow shell.
6. Return the copied object/tree or minimum normalized committed response needed to insert/select it and update existing views immediately.
7. Show useful frontend errors, support normal undo where it already exists, preserve keyboard accessibility, and use Mango's visual patterns.
8. Removing a copied child deletes or detaches it according to an explicit ownership decision. Preserve the source and other copies either way.
9. Permanent deletion and recycle/restore cover exact typed definitions, documents, layout, policies, and promised relationships without deleting unrelated endpoints or leaving orphan records.
10. Preserve valid existing data through forward migrations; avoid destructive replacement and compatibility paths. Support PostgreSQL 17 under repository rules. Agents may edit migrations but must not apply them to live databases.

## Future acceptance coverage

These checks preserve the substance of the original 40-test list and primary acceptance checklist. Add them with the increment implementing the behavior; do not mark deferred checks complete during the MVP.

| Area | Required verification |
|---|---|
| Creation | Workflow in selected Folder; Process in Folder/Workflow; Steps only in their Process; empty authoring and one-child definitions; one correct Explorer location with reveal, selection, and navigation. |
| Persistence | Step geometry/routes, Workflow internal layout, and company placement survive reload/navigation; copy preserves internal layout and uses outer drop point; viewport changes and outdated writes/responses do not corrupt layout. |
| Drag operations | Workflow drop is Copy; company-map drop is Place; Folder drop is Move; indicators/previews communicate before dropping; placement never duplicates definitions. |
| Process copying | New Process/Step/document/edge/child identities; all internal references remapped; independent SOP/layout/RACI/permissions; same users/groups without duplication; no source linkage or runtime Nodes/history/attachments/partial state. |
| Workflow copying | Recursive Processes/nested Workflows; new component/edge/policy/layout identities or owners; all internal references remapped; complete authored composition preserved; outer drop position; runtime exclusion at every depth. |
| Independence | Edit source, first copy, and second copy separately: names, SOP, Steps, layout, traces, RACI, and permissions do not propagate. Deleting a copy preserves source/siblings; deleting source preserves copies and retained authored attachments. |
| Failure and access | Whole-tree rollback on required failure; self-copy/malformed recursion rejected; cross-company/invalid/hidden endpoints and unauthorized creation/grant changes rejected; no destination permission bypass. |
| Explorer and map | One existing sidebar, ordinary independent children, no reference/shared UI, source preserved, destination expanded/highlighted, same-object views reconcile, map-only removal preserves object/Explorer location. |
| Onboarding and filters | Editable starter Folders, mapping entry, Workflow/Process creation, same Step board, supported RACI/permission controls, Me/Team/All based on independent assignments and current access. |

### Three end-to-end scenarios for later increments

1. **First company:** create editable department Folders; create Costco Order Workflow in Operations; create Receive Costco Order inside it; author Receive purchase order, Validate purchase order, Enter order, and Confirm order; arrange/connect them; verify matching board columns; configure supported RACI/permissions; Place the Workflow on the company map and reload both internal/outer layouts.
2. **Independent Process copies:** create standalone Validate Purchase Order in Operations with SOP, several Steps, edges, layout, RACI, permissions, and source runtime Nodes. Copy it into Costco Order Workflow and Sam's Club Order Workflow. Verify fresh identities, remapping, empty copied boards, unchanged principals, no source links, independent edits in all three objects, and safe copy deletion.
3. **Independent Workflow copies:** create Order Fulfillment Workflow with multiple Processes, nested structure, edges/layout, assignments/permissions, and source runtime Nodes. Copy it into both destination Workflows. Verify complete independent trees, recursive runtime exclusion, and independent edits. Delete the source and verify both copies remain usable.

## Investigation findings and decisions by phase

These findings are from inspected commit `a30cd0157f51389827924724fa7ad3aa1fef589b`; recheck them before implementation.

| Current finding | Consequence |
|---|---|
| Process is `logic_gate`; Steps and Nodes are separate; Steps currently store name/order, not arbitrary geometry. | Reuse identities and board behavior. MVP adds only needed Step presentation and controls. |
| No Workflow entity, containment, Canvas, or definition-copy service was found. | Workflow is a later capability, not a renamed Folder/Project or reusable Process reference. |
| Explorer uses Folder parents and Process/Project leaves. | Future Workflow children require explicit containment, Explorer projection, authorization, deletion, and restore rules. |
| Company map inclusion/parentage automatically mirror Explorer; dropping from Explorer is explicitly absent. | Leave this alone in MVP. Optional Place/map-only removal needs later law/test changes. |
| Customized child permissions can exceed a parent's permissions. | Resolve the future destination permission ceiling before copying grants. Cloning alone cannot enforce it. |
| Inherited policies have no direct rows; equal-to-parent saves may restore inheritance. | Decide initial RACI snapshots and destination inheritance separately from source independence. |
| Policies use composite identities; Steps/Workflows are not independent policy resource types today. | New owner IDs suffice for copied rows. Extend policy support explicitly, without invented identities. |
| Defaults are protected Unfiled / Projects / Logic Gates; fresh views open My Work; Explorer scope switching is disabled. | Department starters, mapping entry, and Me/Team/All are later work. |
| SOP JSON contains links/attachments; Processes have KPIs and relationships beyond their Steps. | Define authored inclusion, remapping, external references, and exclusions before copying. |
| Current map saves intentionally use last-committed-save-wins. | Decide Step-layout concurrency without silently changing the whole-company map. |

The MVP decisions above are resolved. Resolve Workflow ownership/deletion, inherited-copy policies, content-copy boundaries, and optional company-map placement before their respective later increments.

## Coordination with the AI MVP

Agreed September 4, 2026 through direct Codex task messages. Jonat subsequently authorized both tasks to begin implementation. Integration, pushing, and changes to `main` still require a separate request.

| Task | Responsibility |
|---|---|
| Investigate workflow copying specification — branch suffix `0000841`, task `01a06dee-677c-7b00-a9fd-13d66f8ac65a` | Process creation/Folder selection; Step authoring/connections/layout persistence; Board / Map toggle. |
| Discuss Mango AI design — branch suffix `0000842`, task `01a06def-bd41-7353-bffb-63cf15bfd15e` | Chat and `#` Process selection; user/Process/Steps/SOP context; one model connection; create one Node, write into it, and move it between Steps using existing commands. |

1. Use direct Codex task messages for questions, blockers, proposed shared changes, and handoffs. The receiving task replies once; avoid automatic reciprocal messages or idle polling loops.
2. This Process Map task maintains this short decision record. Both tasks read the same physical file at `C:\Users\Jonat\.codex\worktrees\4ce3\MangoRTSDev\docs\important tasks\v1processmap&aiintegration.md`; their separate worktree copies do not synchronize automatically. A Markdown edit alone does not notify or wake a task.
3. Keep implementation in the separate worktrees. Before changing a shared Process/Step API, schema, type, ordering/deletion rule, or Board update path, agree on the change and assign one task to own that shared edit. Identify the affected files and exact branch/commit or current diff for review; do not independently implement the same shared behavior.
4. Keep company-scoped `logic_gate_id` and `process_step_id` identities and existing same-Process operational edges. Map coordinates and routing are presentation; AI must not infer execution order from screen position.
5. AI reuses existing Node creation, editor, and movement commands and the current SOP storage. Jonat confirmed that the SOP lists and explains the Steps; the map provides their visuals. AI reads those written instructions together with the actual Step records. Preserve the distinction between Step placement and Node status. New per-Step instruction fields are not required for either skeleton.
6. The AI task reuses the floating Mango chat and existing OpenAI function loop. Its selected-Process actions use the existing Node creation, Node state, and canonical editor-save commands. It reads actual Step names, order, connections, and SOP storage; never map geometry. Ambiguous routing stops for clarification. The backend rejects missing or changed referenced Steps and a Node moved away during a request. Full definition snapshots are deferred. No shared Process/Step schema or public Board API change is needed from the AI task. The AI task owns an internal ExpectedNodeWork precondition in the existing assignment-move and editor-save transactions, using exact Process/Step/status and assignment version. This map task owns only its new layout methods and route dispatch; both additive edits must be preserved when these branches are later integrated.
7. Keep updates short: decision, owner, affected contract/files, and next action. Escalate product scope or conflicting requirements to Jonat; handle ordinary coordination between tasks. The existing separate approval requirement for integration into `main` still applies.

AI task completion: branch `codex/discuss-mango-ai-design0000842`, commit `c905913d` (September 4, 2026). Its owner reports passing backend, disposable PostgreSQL, frontend, and production build checks, with no live model calls, migration, integration, or push. Preserve its independent additions to `repository.go`, `logic_gate_work_handlers.go`, and `relationships.md` when integration is separately requested.

## Delivery order and progress

- [x] Investigate existing implementation without changing it.
- [x] Record full requirements and separate the first MVP.
- [x] Set MVP interpretation and save interaction; Jonat authorized both implementation tasks.
- [x] Implement/verify only Process creation/location, Step mapping/persistence, and Board / Map toggle.
- [ ] Review the working MVP with Jonat before expanding scope.
- [ ] Select the next small increment: candidates include basic Workflow creation/containment/layout, Process copy, nested Workflow copy, optional map placement, and onboarding/filters. Ordering remains a later decision.

For each delivered increment, report changes and reasons, relevant frontend/backend files, schema/migrations and human rollout actions, test commands/results, a short manual walkthrough, assumptions, remaining limitations, and any repository constraint preventing the requirement. Once copying is delivered, explain Copy/Place/Move, recursive behavior, ID remapping, SOP/policies, runtime exclusion, Explorer ownership, separate map placement, and the three applicable acceptance walkthroughs. Do not claim future flows passed before they exist.

## Implemented MVP boundaries

- Process creation uses one existing workspace entity-batch command with a name and permitted existing Folder. The backend rechecks destination access in that transaction.
- The top-right Board / Map toggle mounts the internal Step map beside the existing SOP. Step and connection commands reuse the existing Process work APIs.
- `GET` and `PUT /v2/logic-gates/{id}/step-map` read and save geometry. A PUT sends `company_id`, `base_revision`, `steps`, and `routes`; a stale revision returns HTTP 409.
- `process_step_map_layouts` stores only exact Process/Step/edge geometry. A fresh revision is allocated for committed saves, dependent deletion cleanup, and restored layouts.
- Step creation/naming, snapped drag and resize, orthogonal route points, keyboard movement, zoom, Fit, and saving/error feedback are included. Board order and Node status remain independent.
- Layout deletion and recycle use the existing Process lifecycle. The matching human-run migration is `backend/db/migrations/20260904_process_step_map_layouts.sql`; live application use requires that rollout first.
- Implementation stays on branch `codex/investigate-workflow-copy-specification0000841` in `C:\Users\Jonat\.codex\worktrees\4ce3\MangoRTSDev`. The AI task stays on its separate `0000842` branch. No integration or push is implied.

## MVP verification results — September 4, 2026

- Frontend regression suite and production build passed. The final eight map interaction checks also passed after the keyboard-focus correction.
- Browser review used the actual Board and Step-map components with isolated sample data: create/name, drag, routes, repeated keyboard movement, light/dark themes, view switching, and reload were checked. No live data was used for the browser fixture.
- All backend packages passed through WSL: `go test ./...`.
- The complete disposable PostgreSQL Process Map gate passed on PostgreSQL 18.4, including the new migration, competing-save rejection, event rollback, deletion cleanup, and exact Folder/policy/Step/layout restoration. The SQL uses PostgreSQL 17-compatible features and requires a human-run migration for live use.
- The remaining full-runner stages passed: Windows launcher, email SQS, Node-email relationships, email draft scope, Huddle Explorer, 36 schema-tool checks, and 42 infrastructure checks.
- The initial full runner exposed a preexisting restore-order defect. Explorer placement now restores before dependent policy settings. The corrected database gate and remaining suites were rerun separately; no claim is made that the earlier failed runner exited successfully.
- The existing Process-in-Folder HTTP test now supplies an authenticated editor. A new regression verifies that unauthenticated or revoked-access creation commits nothing.
- The V2 Process Maps document is unchanged. No live database, cloud resource, or external model call was used; no merge or push was performed.

Review path after the human migration and matching app rollout: create a Process from Company Explorer, enter its name and Folder, open Map at the top right, create/name/connect/arrange Steps, and switch to Board to see those same Steps as columns. Written explanations remain in the existing SOP.

## Implementation references

Read [AGENTS.md](../../AGENTS.md) and applicable current laws before changing behavior:

- [Process Steps](../tests/process-steps.md), [Process Map](../tests/process-map.md), and [relationships](../tests/relationships.md).
- [Company Explorer](../tests/company%20explorer.md), [Logic Gates](../tests/logic-gates.md), and [editor](../tests/editor.md).
- [RACI](../tests/gvic.md), [permissions](../tests/permissions.md), [attachments](../tests/attachments.md), [recycle bin](../tests/recycle-bin.md), and [API/realtime](../tests/REST%20API%20%26%20WebSocket.md).

Existing starting points:

- `frontend/src/modules/company-explorer/CompanyExplorerContent.tsx`: Process creation, Folder selection, Explorer updates.
- `frontend/src/pages/logic-gate-arena/LogicGateArenaPage.tsx`: existing Process editor/board surface.
- `frontend/src/modules/kanban/KanbanContent.tsx` and `processWork.ts`: Step columns and runtime work model.
- `frontend/src/modules/process-map/ProcessMapSurface.tsx`: deck.gl canvas/geometry patterns; it must not become a second Step authority.
- `backend/internal/store/postgres_process_steps.go` and `backend/internal/http/process_step_handlers.go`: Step commands, connections, and authorization.
- `backend/internal/store/postgres_editor_textboxes.go` and `postgres_policy_v2_tx.go`: later SOP/policy copy building blocks.
- `backend/db/schema.sql` and `backend/db/migrations/`: canonical storage and forward migrations; no agent applies them to live databases.
