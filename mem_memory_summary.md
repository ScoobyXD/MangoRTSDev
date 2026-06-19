v1

## User Profile

The user works repeatedly in `C:\Users\Jonat\MangoRTSDev` on Windows/PowerShell and uses Codex heavily for MangoRTSDev worker creation, worker-branch merges into local `main`, backend/schema reasoning, frontend behavior audits, and migration/refactor work. They want answers anchored in the actual repo state: current codepaths, schema/migrations, helper-script output, logs, exact error strings, and the live branch state before edits.

They have strong defaults for recurring repo workflows. For VS Code workers they want the repo helper script, strict IDE isolation, local-`main` provenance, and terse identifier-only closeouts. For merges they want immediate execution, no push, no branch-confirmation detours, and the merge helper's exact report fields. For investigations and design/schema discussions they often want read-only analysis first, then edits only after understanding is confirmed. For large migration cleanups they want staged implementation, no silent compatibility aliases, and a clear split between active-risk leftovers versus historical-only traces.

They correct jargon, invented terminology, and over-abstract explanations quickly. Good responses separate repo-canonical state from live DB/runtime drift, separate visible product behavior from backend/plumbing changes, and use plain English first unless they ask for file/function detail. In Home/My Work/Updates work they care about semantic boundaries: My Work as active GVIC work, Updates as an event/mention feed, shared UI infrastructure allowed but not shared meaning.

## User preferences

- For MangoRTS VS Code worker creation, default to `scripts\new_codex_vscode.ps1`; do not manually recreate the workflow unless the script fails.
- If the worker purpose is missing, ask for it; the purpose should become the slug base.
- Preserve the repo's VS Code isolation contract: separate `user-data-dir`, shared extensions dir, detached `Code.exe`, no foreground `code.cmd`, clear `ELECTRON_RUN_AS_NODE` / `VSCODE_*`, encoded inner PowerShell launch.
- Worker-creation closeouts should usually contain only `branch`, `worktree path`, `user-data dir`, and `Code.exe PID if available`.
- For `merge_worker_branch.ps1` tasks, run the merge immediately, do not push, do not ask to confirm the branch, and do not run `git worktree list` first.
- Merge closeouts should include worker path, resolved branch, worker SHA, merge SHA, tests/build result, final `git status --short --branch`, untouched files, backend-file note, and migration SQL only when relevant.
- For bug reports or schema/design discussions framed as questions, default to discussion/investigation first. Do not patch until the user asks for implementation.
- For large migrations/refactors, inspect current schema, migrations, store code, handlers, frontend callers, and `git status` before editing; do staged implementation and avoid compatibility aliases when the user wants bridge-burning cleanup.
- When the user asks what should be visible after a merge/migration, separate visible UI changes from plumbing/data-contract changes and call out DB migration/restart dependencies.
- For Home redesign work, keep `My Work` and `Updates` semantically separate even if they share grouping UI; preserve explicit urgent `!` mention semantics.

## General Tips

- Environment is Windows + PowerShell; broad traversal can hit `windows sandbox: spawn setup refresh`, so prefer explicit paths, PowerShell reads, and lightweight targeted checks.
- `rg.exe` may be unavailable here; fall back to `git grep`, `git ls-files`, and PowerShell `Select-String`.
- The two highest-leverage repo automations are `scripts\new_codex_vscode.ps1` and `scripts\merge_worker_branch.ps1`.
- `node scripts\run_all_tests.mjs` is the recurring repo-wide verification command; backend Go commands usually need to run from `backend` and frontend builds from `frontend`.
- For worker launches, helper output is usually enough; only add `Code.exe` command-line/process probing when the user explicitly wants stronger proof or the launch looks broken.
- For local-main freshness checks, `git merge-base --is-ancestor FETCH_HEAD main` proves fetched `origin/main` is already contained in local `main` without rebasing/resetting.
- For "already merged?" questions, use `git merge-base --is-ancestor <sha> HEAD` plus `git status --short --branch`.
- For Home/My Work/Updates or migration work, inspect current read/write paths first and classify old-term hits before editing; many scans mix active runtime, tests, and historical migrations.

## What's in Memory

### MangoRTSDev main repo

#### 2026-06-19

- VS Code worker creation and launcher verification: new_codex_vscode.ps1, group-permissions0000390, yolo-my-work-and-updates-view0000391, Base: local main
  - desc: Search first for isolated worker creation in `cwd=C:\Users\Jonat\MangoRTSDev`, especially helper-first launches from local `main`, purpose/slug handling, and terse branch/worktree/user-data/PID closeouts.
  - learnings: the latest helper runs again showed the output alone was usually enough: local-main verification, worktree path, user-data dir, and `Code PID` without extra probing.

- Shared-auth deep links and node-only tabs: localStorage, AuthGate.tsx, resourceLinks.ts, applayout.tsx, isNodeDeepLinkView
  - desc: Search first for same-browser auth sharing, canonical open-in-new-tab links, or `/nodes/:id` route behavior in `cwd=C:\Users\Jonat\MangoRTSDev`.
  - learnings: use `localStorage` for same-browser shared auth, reuse canonical resource route builders, and remove `activatePrimaryPage("map")` when a node-only tab should not render the canvas.
#### 2026-06-18

- Home RACI matrix explanation and read path: Home RACI, Others, racio_matrix_projection_table, /v1/work-items/racio-matrix-projection
  - desc: Use for read-only questions about how Responsible/Accountable/Consulted/Informed/Others display and how the projection data reaches the Home UI in `cwd=C:\Users\Jonat\MangoRTSDev`.
  - learnings: backend serves a user-scoped projection plus logic-gate payload; frontend performs the per-role bucketing locally, and `Others` is derived.

- Editor/node text-box wipe investigation: node_information, node_projection_table, NodeTextBlockEditor, stale in-flight request
  - desc: Search this first for "did text get wiped?" investigations on `main`, especially when the user wants diagnosis before edits.
  - learnings: visible loss can be stale projection state rather than true deletion; this family needs talk-first handling.

#### 2026-06-17

- Worker-branch merges on main: merge_worker_branch.ps1, MERGE WORKER BRANCH RESULT, MangoRTSDev-project-fix0000380, 20260612_z_drop_project_scalar_assignments.sql
  - desc: Search first for local worker merges in `cwd=C:\Users\Jonat\MangoRTSDev`, especially repeated reruns, noisy `WorkerPath` input, migration reporting, or "already merged?" follow-ups.
  - learnings: trust `-WorkerPath`; reruns can be new merges, smaller diffs, or no-ops; the helper's final result block is the source of truth.

- Backend schema explanations and dynamic group permissions: project_account_assignments, resource_raci_assignments, company_projection_sequences, plain english
  - desc: Use for project scalar-column cleanup, dynamic group-permission semantics, and plain-English table-purpose questions across `main` and `project-fix0000380`.
  - learnings: distinguish repo schema from live DB drift; assignment tables are canonical for projects; dynamic group permissions should preserve group assignments as source of truth.

### MangoRTSDev worker checkouts

#### 2026-06-19

- Home redesign: GVIC My Work matrix, Updates feed, urgent mentions: yolo-my-work-and-updates-view0000391, ListMyWorkMatrixRows, UpdatesView.tsx, mention_kind, notifications_role_chk
  - desc: Search first for the landed Home redesign in `cwd=C:\tmp\MangoRTSDev-workers\MangoRTSDev-yolo-my-work-and-updates-view0000391`, especially when the task mixes My Work semantics, Updates feed behavior, urgent mentions, notification-role migration, and verification.
  - learnings: keep My Work as backend-owned GVIC active work and Updates as a separate event feed; reuse grouping infrastructure, not data semantics; `20260619_notifications_gvic_roles.sql` is the forward fix for old notification roles.

- V2 node/GVIC cleanup and node-title migration: v2-node-change-cleaunup0000389, payload.gvic_assignments, name instead of title, 20260618_z_gvic_node_phase2_cleanup.sql
  - desc: Search first for bridge-burning GVIC/node cleanup in `cwd=C:\tmp\MangoRTSDev-workers\MangoRTSDev-v2-node-change-cleaunup0000389`, especially when removing runtime fallbacks, migrating active node records to `name`, or classifying leftover legacy terms.
  - learnings: remove active compatibility fallbacks early, use `npm.cmd run build` to catch stale node-shaped literals, and treat many remaining `title`/old-role hits as historical-only rather than runtime regressions.

- Scoped GVIC recompute for group membership: group-permissions0000390, SetCompanyUserGroupMembers, gvicAncestorGroupIDsForGroupsTx, company_projection_sequences
  - desc: Search first for group-membership-driven GVIC recompute work in `cwd=C:\tmp\MangoRTSDev-workers\MangoRTSDev-group-permissions0000390`, especially when ordinary writes should stop using a company-wide group-principal scan.
  - learnings: membership/hierarchy writes should recompute only affected resource keys, refresh effective rows and GVIC matrix rows together, and keep the broad helper only for repair/backfill flows.
#### 2026-06-18

- V2 node/GVIC migration and rerunnable SQL: 20260618_gvic_node_phase1.sql, resource_gvic_assignments, Review instead of Verify, Person In Charge
  - desc: Search first for Phase 1 GVIC/node migration work in `cwd=C:\tmp\MangoRTSDev-workers\MangoRTSDev-v2-node-changes-phase-10000386`, including rerunnable migration fixes, visible-vs-plumbing explanation, and the Phase 2 handoff prompt.
  - learnings: Phase 1 is mostly contract/plumbing cleanup; visible effects depend on DB migration + restart; legacy-table updates need existence guards for reruns.

#### 2026-06-17

- Company Explorer V2 migration and backfill: company_explorer_entities, company_explorer_edges, company_explorer_v2_backfill_verification, ON CONFLICT DO UPDATE command cannot affect row a second time
  - desc: Use for Phase 1 V2 Company Explorer migration/backfill work in `cwd=C:\tmp\MangoRTSDev-workers\MangoRTSDev-v2-company-explorer-refactor0000382`.
  - learnings: Phase 1 stays additive; duplicate scoped roots need deduped conflict sources; zero rows from `where not ok` is the fastest post-migration proof.

- Company Explorer behavior, lazy loading, permissions, and scoping: /v1/company-explorer/roots, USE_SYNTHETIC_COMPANY_EXPLORER_SCOPE_ROWS, company_explorer_folder_permissions_updated, scope_id text
  - desc: Search first for current Company Explorer architecture, lazy roots/children fetches, folder visibility bugs, or permission-refresh gaps in `cwd=C:\tmp\MangoRTSDev-workers\MangoRTSDev-company-explorer-*`.
  - learnings: active UI depends on backend lazy scope payloads; folder visibility bugs often split into access-model correctness and refresh propagation.

- My Work implementation and lifecycle discussion: MyWorkView.tsx, myWorkGrouping.ts, mangorts.saved_grouping_settings.v1, only fetch active
  - desc: Use for pre-redesign "how does My Work work today?" and active-vs-history lifecycle questions across `universal-view0000374` and `new-key-views0000379`.
  - learnings: pre-redesign My Work was frontend-driven/localStorage-backed; compare this topic against the 2026-06-19 Home redesign before assuming current behavior.

- Email attachment UX and raw-MIME downloads: HomeParts.tsx, EmailAttachmentTile, raw-mime-1, downloadCommunicationsAttachment
  - desc: Search first for compose/received attachment UI work and raw-MIME attachment download failures in `cwd=C:\tmp\MangoRTSDev-workers\MangoRTSDev-emails0000377`.
  - learnings: visual tiles improve discoverability; raw-MIME attachment ids need inline-content fallback instead of provider lookup.

#### 2026-06-16

- Shared inbox visibility SQL fix and split-model routing: /v1/communications/shared-inboxes, SQLSTATE 42883, where item.company_id=$1::text, postgres_shared_inbox_folders.go
  - desc: Use first for shared triage tree/list 500s in `cwd=C:\tmp\MangoRTSDev-workers\MangoRTSDev-emails-changes0000372`, and for current shared-inbox visibility architecture.
  - learnings: diagnose from logs first; the visible-list CTE uses text `company_id`, so UUID/text mismatches are a real failure mode.

### Older Memory Topics

#### MangoRTSDev main repo

- UI icon concept previews: Projects primitive, preview-only, 2 or 3 different ideas, #2F6FED
  - desc: Preview-only icon/color exploration in `cwd=C:\Users\Jonat\MangoRTSDev`; use when the user wants experimentation without code changes.

- Login/startup request burst analysis: React.StrictMode, AppLiveFreshnessBridge, mangorts_realtime_ticket, websocket 401
  - desc: Use for "why does first login do a whole bunch of random shit?" investigations in `cwd=C:\Users\Jonat\MangoRTSDev`.
- Cognito password policy ownership: infra/aws-dev/cognito.tf, PasswordPolicyType, AuthGate.tsx, minimum_length
  - desc: Routing topic for auth-rule ownership and feasibility questions in `cwd=C:\Users\Jonat\MangoRTSDev`.

- Backend projection maintenance: work_item_inbox_entries, CreateWorkspaceEntityBatch, racio_matrix_projection_table, resource_permissions
  - desc: Use for write-path, projection rebuild, CRUD/read-model, or migration/backfill questions across `main` and related worker checkouts.

- Communications provider replacement and Nylas fit: NylasClient, Aurinko, Unipile, EmailEngine, self-hosted
  - desc: Use for "alternatives to Nylas" questions grounded in MangoRTS's actual communications stack and tradeoffs.

#### MangoRTSDev worker checkouts

- Nylas receipts, attachments, and rate limiting: message.opened, tracking_options.opens, sendMessageMultipart, invalid_company_id_paylo