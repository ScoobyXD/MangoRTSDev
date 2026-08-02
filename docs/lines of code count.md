# Lines of Code Count

## 2026-08-02 (do this exact same analysis for each new timestamp when you are tasked with doing another code audit on a new timestamp and we will grow a historical list)

The history table keeps the summary from each audit. The area, subcategory, and
large-file tables below show the latest snapshot only.

| Date | Logic lines without tests | Total logic lines | Counted files | Test logic lines | Test files |
|---|---:|---:|---:|---:|---:|
| 2026-06-10 | 147,604 | 179,408 | 579 | 31,804 | 127 |
| 2026-07-31 | 269,579 | 349,900 | 1,079 | 80,321 | 283 |
| 2026-08-02 | 262,974 | 341,639 | 1,075 | 78,665 | 279 |

## Change Since the Previous Count

| Metric | Change | Percent change |
|---|---:|---:|
| Logic lines without tests | -6,605 | -2.4% |
| Total logic lines | -8,261 | -2.4% |
| Counted files | -4 | -0.4% |
| Test logic lines | -1,656 | -2.1% |
| Test files | -4 | -1.4% |

Test code remains 23.0% of counted logic, the same percentage as in the
previous snapshot after rounding to one decimal place.

## Non-Test Logic Lines by Area

| Area | Files | Logic lines | Share |
|---|---:|---:|---:|
| Frontend | 292 | 129,121 | 49.1% |
| Backend | 436 | 126,073 | 47.9% |
| Infra | 39 | 3,605 | 1.4% |
| Scripts | 26 | 3,352 | 1.3% |
| CI | 3 | 823 | 0.3% |

## Non-Test Logic Lines by Subcategory

| Subcategory | Files | Logic lines | Share |
|---|---:|---:|---:|
| `backend/internal/store` | 162 | 65,221 | 24.8% |
| `frontend/src/modules/editor` | 66 | 35,128 | 13.4% |
| `backend/internal/http` | 74 | 30,501 | 11.6% |
| `frontend/src/pages/home` | 35 | 30,010 | 11.4% |
| `backend/db/migrations` | 181 | 19,869 | 7.6% |
| `frontend/src/app` | 35 | 10,164 | 3.9% |
| `frontend/src/modules/project-management` | 9 | 9,424 | 3.6% |
| `frontend/src/modules/company-explorer` | 23 | 8,023 | 3.1% |
| `frontend/src/modules/kanban` | 14 | 7,227 | 2.7% |
| `frontend/src/modules/node-map` | 22 | 6,050 | 2.3% |
| `backend/db/root` | 5 | 4,758 | 1.8% |
| `frontend/src/modules/logic-gate-map` | 12 | 3,827 | 1.5% |
| `frontend/src/modules/communications` | 8 | 3,459 | 1.3% |
| `scripts` | 26 | 3,352 | 1.3% |
| `frontend/src/auth` | 4 | 2,538 | 1.0% |
| `frontend/src/modules/attachments` | 5 | 1,802 | 0.7% |
| `infra/aws-prod` | 17 | 1,491 | 0.6% |
| `infra/modules` | 16 | 1,388 | 0.5% |
| `frontend/src/modules/accounts` | 3 | 1,276 | 0.5% |
| `frontend/src/root` | 5 | 1,226 | 0.5% |
| `frontend/src/modules/realtime` | 5 | 1,217 | 0.5% |
| `backend/internal/notifications` | 1 | 1,206 | 0.5% |
| `backend/internal/domain` | 1 | 1,174 | 0.4% |
| `frontend/scripts` | 3 | 1,163 | 0.4% |
| `frontend/src/modules/permissions` | 1 | 913 | 0.3% |
| `backend/internal/auth` | 3 | 874 | 0.3% |
| `.github/workflows` | 3 | 823 | 0.3% |
| `frontend/src/modules/grouping` | 3 | 802 | 0.3% |
| `infra/aws-dev` | 6 | 726 | 0.3% |
| `backend/cmd/mango-attachment-migrate` | 1 | 691 | 0.3% |
| `frontend/src/pages/recycle-bin` | 1 | 627 | 0.2% |
| `frontend/src/modules/notifications` | 5 | 622 | 0.2% |
| `frontend/src/modules/teams` | 1 | 543 | 0.2% |
| `backend/cmd/miraeopus-migrate` | 1 | 513 | 0.2% |
| `frontend/src/modules/perspectives` | 1 | 482 | 0.2% |
| `backend/internal/attachments` | 1 | 459 | 0.2% |
| `frontend/src/pages/logic-gate-arena` | 3 | 445 | 0.2% |
| `backend/cmd/miraeopus-api` | 1 | 365 | 0.1% |
| `frontend/src/modules/fields` | 2 | 337 | 0.1% |
| `frontend/src/modules/api` | 2 | 330 | 0.1% |
| `backend/cmd/mango-attachment-variants` | 1 | 303 | 0.1% |
| `frontend/src/modules/workspace` | 2 | 217 | 0.1% |
| `frontend/src/modules/map` | 3 | 186 | 0.1% |
| `frontend/src/modules/folders` | 1 | 145 | 0.1% |
| `frontend/src/modules/linkingGraph.ts` | 1 | 140 | 0.1% |
| `frontend/src/modules/selectionCoordinator.ts` | 1 | 126 | 0.0% |
| `frontend/config-root` | 4 | 121 | 0.0% |
| `frontend/src/modules/work-items` | 1 | 120 | 0.0% |
| `frontend/src/hooks` | 2 | 109 | 0.0% |
| `frontend/src/modules/index.ts` | 1 | 86 | 0.0% |
| `backend/internal/modules` | 1 | 79 | 0.0% |
| `frontend/src/pages/lazyPages.ts` | 1 | 55 | 0.0% |
| `backend/root` | 2 | 42 | 0.0% |
| `frontend/src/pages/project-management` | 1 | 42 | 0.0% |
| `frontend/src/modules/recycle-bin` | 1 | 41 | 0.0% |
| `frontend/src/modules/contextSyncContract.ts` | 1 | 37 | 0.0% |
| `frontend/src/modules/entityLabels.ts` | 1 | 23 | 0.0% |
| `frontend/src/pages/teams` | 1 | 19 | 0.0% |
| `backend/cmd/compact-node-information-from-projections` | 1 | 18 | 0.0% |
| `frontend/src/pages/account-manager` | 1 | 15 | 0.0% |
| `frontend/src/pages/fields` | 1 | 4 | 0.0% |

## Files Over 1,500 Logic Lines

This table is for awareness, not a hard rule. The softer guideline is to avoid
growing files past roughly 2,000 lines unless there is a clear reason and a
better module boundary does not exist yet.

There are 25 non-test files over 1,500 logic lines. Nineteen of them are over
2,000 logic lines.

| Logic lines | File | Test file |
|---:|---|---|
| 6,807 | `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx` | No |
| 6,348 | `frontend/src/pages/home/HomePage.tsx` | No |
| 6,309 | `frontend/src/pages/home/HomeParts.tsx` | No |
| 5,742 | `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts` | No |
| 5,408 | `backend/internal/http/communications_handlers_test.go` | Yes |
| 5,166 | `frontend/src/modules/project-management/ProjectSummaryContent.tsx` | No |
| 4,121 | `backend/db/schema.sql` | No |
| 4,029 | `frontend/src/modules/editor/NodeWorkspaceSurface.tsx` | No |
| 3,579 | `frontend/src/modules/company-explorer/CompanyExplorerContent.tsx` | No |
| 3,044 | `frontend/src/app/AppSidebarChrome.tsx` | No |
| 2,917 | `frontend/src/modules/kanban/KanbanContent.tsx` | No |
| 2,829 | `frontend/src/modules/editor/EditorContent.tsx` | No |
| 2,816 | `backend/internal/http/server_test.go` | Yes |
| 2,714 | `frontend/src/modules/project-management/ProjectManagementContent.tsx` | No |
| 2,672 | `frontend/src/modules/communications/communicationsApi.ts` | No |
| 2,553 | `backend/internal/http/communications_handlers.go` | No |
| 2,465 | `backend/internal/store/repository.go` | No |
| 2,441 | `frontend/src/pages/home/UpdatesView.tsx` | No |
| 2,381 | `frontend/src/pages/home/MyWorkView.tsx` | No |
| 2,181 | `frontend/src/pages/home/homeStyles.ts` | No |
| 2,164 | `frontend/src/app/applayout.tsx` | No |
| 1,917 | `backend/internal/http/server_company_explorer_test.go` | Yes |
| 1,876 | `frontend/src/auth/AuthGate.tsx` | No |
| 1,820 | `backend/internal/store/postgres_company_explorer.go` | No |
| 1,776 | `tests/frontend/modules/communications/communicationsApi.test.ts` | Yes |
| 1,743 | `backend/internal/store/memory_test.go` | Yes |
| 1,622 | `frontend/src/modules/node-map/NodeMapContent.tsx` | No |
| 1,615 | `backend/internal/http/notification_handlers_test.go` | Yes |
| 1,578 | `backend/db/migrations/20260802_zz_v3_database_table_cutover.sql` | No |
| 1,551 | `frontend/src/modules/logic-gate-map/LogicGateMapContent.tsx` | No |
| 1,505 | `backend/internal/store/memory_kanban.go` | No |

## Audit Observations

- Total counted logic is 2.4% lower than the previous snapshot.
- Backend and frontend logic remain nearly even at 47.9% and 49.1%.
- `backend/internal/store`, `frontend/src/modules/editor`,
  `backend/internal/http`, and `frontend/src/pages/home` contain 61.2% of all
  non-test logic.
- The largest non-test file is
  `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx` at 6,807 logic
  lines.
- This is a size and concentration audit. It does not by itself measure defects,
  security, performance, or code quality.

## Counting Notes

Logic lines are nonblank, non-comment lines from tracked source and
configuration files. Comment markers are applied by file type, so SQL, Go,
TypeScript, PowerShell, Terraform, HTML, CSS, shell, and YAML comments are
handled separately.

The counted file types match the 2026-06-10 snapshot so the history remains
comparable: `.go`, `.ts`, `.tsx`, `.sql`, `.ps1`, `.tf`, `.sh`, `.html`,
`.css`, `.hcl`, `.yaml`, `.yml`, and `.json`, plus `Dockerfile` and `go.mod`.
Python and MJS support utilities are outside this legacy metric.

Excluded from the count: docs, logs, lockfiles, env files, dependency folders,
temporary files, and generated/build output.

The without-tests total excludes files under `test/` or `tests/`, Go files
ending in `_test.go`, and frontend files ending in `.test.ts`, `.test.tsx`,
`.spec.ts`, or `.spec.tsx`.

Run `node scripts/count_logic_lines.mjs` from the repository root to regenerate
the detailed tables. Add `--json` for machine-readable output.
