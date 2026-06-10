# V1 Code Deletion Project

That's a fair concern. LLMs are much better at adding local fixes than doing disciplined subtraction unless the workflow is explicitly built around deletion, measurement, and behavior preservation.

The way to use me safely for this is not "go refactor this huge file." It should be:

## Audit First, No Edits

Identify dead code, duplicate flows, obsolete compatibility paths, unused props/state, over-broad abstractions, and files that are only large because unrelated concerns got packed together.

## Require a Deletion Hypothesis

Every proposed change should say:

- what code can disappear
- why it is redundant or unreachable
- what behavior must remain unchanged
- what test/build/screenshot proves that

## Prefer True Deletion Before Extraction

Splitting a 5,000-line file into six files may improve maintainability, but it does not reduce code. For this goal, extraction only counts if it lets us remove duplication or simplify logic.

## Work Bucket by Bucket

Don't attack 147k lines globally. Start with the biggest concentration:

- `backend/internal/store`
- `backend/internal/http`
- `frontend/src/modules/editor`
- `frontend/src/pages/home`
- `frontend/src/app`

## Track Net LOC

Every cleanup PR should report:

- lines removed
- lines added
- net change
- tests run
- any files still growing toward or beyond roughly 2,000 lines

Avoid hard file-size rules. The practical guideline is to try not to create or keep files over roughly 2,000 lines unless the file has a clear reason to be that large and no cleaner boundary exists.

For this repo, I'd start with an audit-only pass on the top frontend offenders, especially `HomeParts.tsx`, `NodeWorkspaceSurfaceParts.tsx`, `HomePage.tsx`, and `CompanyExplorerContent.tsx`. The goal would be a ranked list of deletion/consolidation candidates, not code changes yet. That gives you judgment before letting anyone touch behavior.

## Dead Code Candidates Checked 2026-06-10

Counting note: these are source-line counts from the current files, not `cloc` logical-line counts. They exclude generated `frontend/dist` output. Import cleanup may move each final PR total by a few lines.

Confidence scale:

- Very high: exact source search found only the definition or a dormant branch with no live caller.
- High: no live production caller, but tests or compatibility shape need a deliberate cleanup.
- Medium: likely obsolete, but product/client compatibility policy should be confirmed first.

### Delete Dead Code First

| Candidate | Location | Why it is dead | Confidence | Delete LOC |
| --- | --- | --- | --- | ---: |
| Legacy ACI inbox matrix component | `frontend/src/pages/home/HomeParts.tsx:4213-4525` | `AciInboxMatrix` only appears at its definition. `HomePage.tsx` renders `RaciRoleInboxMatrix` instead. | Very high | 313 |
| Legacy responsible inbox matrix component | `frontend/src/pages/home/HomeParts.tsx:4527-4841` | `ResponsibleInboxMatrix` only appears at its definition. Generic role inbox rendering replaced it. | Very high | 315 |
| Unused attached emails panel | `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx:2181-2203` | `AttachedEmailsPanel` only appears at its definition. Active email UI uses `EmailCountDropdown`, `AttachedEmailOrganizerPane`, and `EmailConversationPane`. | Very high | 23 |
| Unused email detail modal | `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx:4825-5265` | `EmailDetailModal` and its frame/resize/storage helpers only appear in their own block. Active email reading uses `EmailConversationPane`; keep shared `messageDocument` below the block. | Very high | 441 |
| Unused editor formatting toolbar file | `frontend/src/modules/editor/EditorFormattingToolbar.tsx` | `EditorFormattingToolbar` only appears in this file and is not imported anywhere. | Very high | 92 |
| Unused node-map panel drag/resize hook | `frontend/src/modules/node-map/NodeMapControls.ts:99-116` and `frontend/src/modules/node-map/NodeMapControls.ts:618-702` | `NodeMapPanelDragState`, `NodeMapPanelResizeState`, and `useNodeMapPanelControls` only appear in this file. | Very high | 103 |
| Small definition-only exports | `HeaderPersonIcon`, `preloadHotDashboardModules`, `bootstrapAuth`, `shortTimelineLabel`, `getFrameCreationCounter`, `snapshotEditorTextArea`, `DEFAULT_HOME_MAILBOX`, `NodeDocBox`, `Widget` | Exact source search found no callers outside each definition. Delete as a small sweep after build confirms no hidden import path. | Very high | 25 |
| Small unused home helpers | `nodeHasLogicGateRaciRole`, `responsibleStatusLetter`, `sharedInboxHasAnyRaciAssignments`, `filterSharedInboxesForUser` | Exact source search found no callers outside each definition. | Very high | 20 |

Verified dead-code first wave: about 1,332 source lines before import cleanup.

### Delete After The First Wave

| Candidate | Location | Why it is probably removable | Confidence | Delete LOC |
| --- | --- | --- | --- | ---: |
| ACI/responsible inbox helper cleanup | `frontend/src/pages/home/homeUtils.ts`, `frontend/src/pages/home/homeConstants.ts`, related test assertions | Once the old `AciInboxMatrix` and `ResponsibleInboxMatrix` components are gone, `buildAciInboxGroupsByCell`, `buildResponsibleInboxGroupsByCell`, `aciCellKey`, `responsibleCellKey`, `ACI_COLUMNS`, and old ACI/responsible-specific assertions are obsolete. Keep `RACI_STATUS_COLUMNS` and generic `buildRaciRoleInboxGroupsByCell`. | High | about 60 production, about 20 test |
| Hard-disabled legacy app header | `frontend/src/app/applayout.tsx:68`, `frontend/src/app/applayout.tsx:1492-1572`, related tab menu/helper code | `SHOW_LEGACY_HEADER` is hardcoded `false`; its render branch, tab context menu, header menu, drag effect, rename state, and tab-helper callbacks are unreachable. Do this in its own PR because it touches app-shell state and persisted settings cleanup can be separated. | High | about 240-255 |
| Work-item read repository no-context wrappers | `backend/internal/store/repository.go`, `memory_work_item_reads.go`, `postgres_work_item_reads.go` | HTTP handlers call the context-aware methods. The no-context wrappers are only retained by tests/fakes, so tests should move to the context methods first. | High | about 40-60 |
| Workspace snapshot legacy payload query flags | `backend/internal/http/workspace_handlers.go` | Frontend does not reference `include_legacy_map`, `include_map_payloads`, `include_legacy_kanban`, or `include_kanban_payloads`. Treat as compatibility cleanup, not first-wave dead-code deletion. | Medium | about 60-120 including tests |

### Do Not Delete In The Dead-Code Wave

- `/v1/map-layout` and `/v1/kanban/*` routes are still called from frontend source.
- `compatibility_board_id` and `compatibility_card_id` are still active in kanban/work-item projection flows.
- Shared inbox RACI dual-write/read paths still need migration proof before deletion.
- `CompanyExplorerContent.tsx` is over-broad, but the audited sections are active behavior, not dead code.

## Focused Large-File Audit 2026-06-10

Guideline: avoid creating or keeping files over roughly 2,000 lines when a clear domain boundary exists. This is not a hard rule. The first priority is deleting code that is truly dead; the second priority is consolidating duplicates; splitting active code only helps maintainability unless it also removes logic.

### `frontend/src/pages/home/HomeParts.tsx`

What it is: a home-page UI parts bucket. It is imported by `HomePage.tsx` and `HomeMailWorkspace.tsx`.

Why it is large:

- Home bulk-edit context menu: about 230 lines.
- Node editor popup wrapper and popup geometry: about 150 lines.
- Home sidebar plus shared inbox tree/create/rename/move UI: about 580 lines.
- Shared inbox RACI settings modal: about 300 lines.
- Logic gate and node rails, tiles, rail resizing: about 650 lines.
- RACI matrix viewer selector and its local styles: about 1,000 lines.
- Active generic RACI inbox matrix: about 400 lines.
- Dead legacy ACI/responsible inbox matrices: about 628 lines.
- Logic-gate group cards, inbox node rows, mail detail/compose/delete UI: about 600 lines.

Dead-code conclusion:

- `AciInboxMatrix` and `ResponsibleInboxMatrix` are the highest-confidence delete here. They are not imported or rendered; `HomePage.tsx` uses `RaciRoleInboxMatrix`.
- After those are removed, the old ACI/responsible-specific helpers in `homeUtils.ts` and tests can be trimmed.
- The rest of the file is mostly active UI, not dead code.

Follow-up after deletion:

- Split by domain if needed: `HomeSidebarParts`, `HomeRaciInboxMatrix`, `RacioMatrixViewerSelector`, `HomeEntityRails`, and `HomeMailParts`.
- This split alone will not reduce LOC much. The value is making future deletion safer.

### `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx`

What it is: editor UI parts shared by `NodeWorkspaceSurface.tsx` and `ProjectSummaryContent.tsx`.

Why it is large:

- `NodeTextBlockEditor`: about 730 lines.
- Chat pane and chat thread/attachment UI: about 900 lines.
- Dead `AttachedEmailsPanel`: about 23 lines.
- Email and attachment count dropdowns: about 260 lines.
- Attached email organizer with local folder layout: about 950 lines.
- Email conversation pane and email selection/highlight/reply helpers: about 960 lines.
- Email picker modal: about 440 lines.
- Dead `EmailDetailModal`: about 441 lines.

Dead-code conclusion:

- `AttachedEmailsPanel` is definition-only and safe to delete.
- `EmailDetailModal` plus its frame/resize/storage helpers are definition-only and safe to delete.
- Keep `NodeTextBlockEditor`; it is used by both the editor and project summary.
- Keep `EmailConversationPane`, `EmailPickerModal`, `EmailCountDropdown`, `AttachmentCountDropdown`, and `AttachedEmailOrganizerPane`; all have live callers.

Follow-up after deletion:

- Split active email features into dedicated files: email organizer, email conversation, email picker, and count dropdowns.
- Split `NodeTextBlockEditor` from chat/email UI. That will make this file stop being a catch-all editor surface file.

### `frontend/src/pages/home/HomePage.tsx`

What it is: the controller/orchestrator for the Home surface. It is lazy-loaded as the full Home page and also exported as `HomeFrameContent` for dashboard modules.

Why it is large:

- It owns mailbox status, folders, messages, selection, pagination, prefetching, archive queues, starred state, compose/reply, deletes, search, and scroll-anchor behavior.
- It owns shared inbox folders, shared inbox email assignment, permissions/RACI modals, and shared inbox CRUD.
- It owns node/logic-gate data loading, local tree rows, shortcuts, bulk edit, deletes, node editor overlay, and logic-gate arena launch.
- It owns RACI matrix projection loading, realtime projection deltas, account filtering, and matrix rendering handoff.
- It owns the final layout choice between custom matrix, RACI inbox matrix, and mail workspace.

Dead-code conclusion:

- I did not find a high-confidence dead block inside `HomePage.tsx` itself.
- The local Nylas shared-inbox connection helpers duplicate similar helpers in `AppSidebarChrome.tsx`; that is a consolidation candidate, not dead-code deletion.
- `HomeFrameContent` looks definition-only inside this file, but it is imported by the module registry and should stay.

Follow-up after dead-code deletion elsewhere:

- Extract controller hooks by workflow: `useHomeMailController`, `useSharedInboxController`, `useHomeWorkItemsController`, `useHomeRacioProjection`, and `useHomeEntityActions`.
- The goal should be to make `HomePage.tsx` mostly layout and wiring. This may not reduce total LOC unless duplicate flows are removed, but it should keep the file from continuing past 3,700 lines.

### `frontend/src/modules/company-explorer/CompanyExplorerContent.tsx`

What it is: the active Company Explorer orchestrator. It is loaded as a dashboard module and as the app-sidebar explorer.

Why it is large:

- Pre-component helper section is about 1,170 lines. Most of that is RACI/scope-specific row materialization:
  - user/team/company scope filtering
  - synthetic RACI folder IDs
  - RACI projection materialization
  - `buildRaciCompanyExplorerRows`
  - team/company RACI row builders
  - protected/default/system folder helpers
- The component body is about 2,190 lines. It owns:
  - workspace snapshot and realtime subscription
  - kanban board refresh integration
  - scope controls and current-user/group loading
  - RACI projection fetching and caching
  - tree row selection, expansion, scroll persistence, and search
  - auto-creation of RACI visual root folders and scoped root folders
  - folder/node/logic-gate creation
  - folder item assignment
  - delete/rename/move
  - drag/drop planning and mutation execution
  - map find, sidebar pinning, folder sharing, delete confirmation, and final render

Dead-code conclusion:

- I did not find high-confidence dead code in this file.
- The RACI visual root logic is suspicious because it is complicated and creates hidden root folders from the frontend, but it is active. Do not delete it without a backend/system-folder migration plan.
- The file is too large mostly because it still combines pure row-building logic, data sync, mutation commands, selection bridging, and UI composition.

Follow-up after dead-code deletion elsewhere:

- Move RACI/scope row materialization out first, likely into `companyExplorerRaciRows.ts` or `companyExplorerScopeRows.ts`. That could move roughly 700-1,100 active lines out of the content component.
- Move folder/node/logic-gate mutation callbacks into a hook such as `useCompanyExplorerMutations`.
- Move drag/drop mutation execution into a hook or command module. `treePresentation.ts` already does some planning; `CompanyExplorerContent.tsx` still executes too much of the workflow inline.
- Consider moving RACI/system root folder creation to backend-owned system-folder setup later. Until then, it is active compatibility/product behavior, not dead code.

## First Deletion Wave Execution Notes

Use this section when handing the cleanup to a fresh Codex instance. The goal of the first wave is not to refactor, split files, rename things, or make architecture nicer. The goal is to delete code that has been verified as dead.

### Rules For The First Wave

- Re-run the reference searches before deleting anything. If a candidate has gained a live caller, skip it.
- Delete only candidates in the "Delete Dead Code First" table unless explicitly told otherwise.
- Do not delete active compatibility code, even if it looks ugly.
- Do not split active files in this pass. Extraction is a later maintainability pass.
- Keep behavior unchanged. If the build or tests fail because a candidate was not actually dead, revert that candidate only.
- Keep commits/PRs small enough that one failure can be traced to one deletion bucket.

### Start With These Exact Buckets

1. Home legacy inbox matrix deletion:
   - Delete `AciInboxMatrix` from `frontend/src/pages/home/HomeParts.tsx`.
   - Delete `ResponsibleInboxMatrix` from `frontend/src/pages/home/HomeParts.tsx`.
   - Remove now-unused imports from `HomeParts.tsx`.
   - Then remove ACI/responsible-only helpers from `homeUtils.ts` only if the reference check proves they have no production caller.
   - Expected removal: about 628 source lines from `HomeParts.tsx`, plus about 60 production helper lines and about 20 test assertion/import lines if the helper cleanup is included.

2. Editor email dead UI deletion:
   - Delete `AttachedEmailsPanel` from `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx`.
   - Delete `EmailDetailModal` and its modal-only frame/resize/storage helpers from `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx`.
   - Keep `EmailConversationPane`, `EmailPickerModal`, `AttachedEmailOrganizerPane`, `EmailCountDropdown`, `AttachmentCountDropdown`, and `messageDocument`.
   - Expected removal: about 464 source lines.

3. Small definition-only frontend sweep:
   - Delete or inline only if exact source search still shows no callers:
     - `EditorFormattingToolbar`
     - `useNodeMapPanelControls`, `NodeMapPanelDragState`, `NodeMapPanelResizeState`
     - `HeaderPersonIcon`
     - `preloadHotDashboardModules`
     - `bootstrapAuth`
     - `shortTimelineLabel`
     - `getFrameCreationCounter`
     - `snapshotEditorTextArea`
     - `DEFAULT_HOME_MAILBOX`
     - `NodeDocBox`
     - `Widget`
     - `nodeHasLogicGateRaciRole`
     - `responsibleStatusLetter`
     - `sharedInboxHasAnyRaciAssignments`
     - `filterSharedInboxesForUser`
   - Expected removal: about 240 source lines, depending import cleanup.

### Suggested Reference Checks

Run these before editing, and again after editing:

```powershell
rg -n "AciInboxMatrix|ResponsibleInboxMatrix|buildAciInboxGroupsByCell|buildResponsibleInboxGroupsByCell|aciCellKey|responsibleCellKey" frontend/src tests --glob "!frontend/dist/**"
rg -n "AttachedEmailsPanel|EmailDetailModal|EmailDetailModalProps|EmailDetailModalFrame|EMAIL_DETAIL_MODAL_|EmailDetailResizeEdges|readStoredEmailDetailModalSize|storeEmailDetailModalSize|clampEmailDetailModalFrame|createInitialEmailDetailModalFrame" frontend/src tests --glob "!frontend/dist/**"
rg -n "EditorFormattingToolbar|useNodeMapPanelControls|NodeMapPanelDragState|NodeMapPanelResizeState|HeaderPersonIcon|preloadHotDashboardModules|bootstrapAuth|shortTimelineLabel|getFrameCreationCounter|snapshotEditorTextArea|DEFAULT_HOME_MAILBOX|NodeDocBox|Widget|nodeHasLogicGateRaciRole|responsibleStatusLetter|sharedInboxHasAnyRaciAssignments|filterSharedInboxesForUser" frontend/src tests --glob "!frontend/dist/**"
```

Expected result before deletion: candidates should appear only at their definition, their obsolete tests, or inside code already being deleted.

Expected result after deletion: no references should remain, except active generic RACI helpers such as `RACI_STATUS_COLUMNS`, `buildRaciRoleInboxGroupsByCell`, and `raciRoleCellKey`.

### Required Verification

After each small bucket or at least before final handoff:

```powershell
npm.cmd run build
node scripts\run_all_tests.mjs
go test ./...
```

If time is tight, run `npm.cmd run build` first because this pass is mostly frontend dead-code deletion. Still report any tests not run.

### Do Not Touch In The First Wave

- `HomePage.tsx` orchestration logic. It is large, but the focused audit did not find a high-confidence dead block.
- `CompanyExplorerContent.tsx` RACI/scope logic. It is suspicious and over-broad, but active.
- `/v1/map-layout` or `/v1/kanban/*` frontend/backend paths.
- `compatibility_board_id` / `compatibility_card_id` flows.
- Shared inbox RACI backend dual-write/read behavior.
- The hard-disabled `SHOW_LEGACY_HEADER` app-layout cleanup unless the first-wave deletion is already clean and the user explicitly approves a second bucket.

### Final Report Template

When the first deletion wave is done, report:

- files changed
- candidates deleted
- source lines removed
- source lines added
- net line change
- validation commands run
- any skipped candidates and why
