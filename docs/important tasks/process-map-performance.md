# Process Map performance priorities

## Purpose and scope

Make the existing Process Map feel fast when loading, panning, zooming, hovering, selecting, dragging, and receiving updates. Priorities below are impact buckets, not a numbered ranking of individual tasks. P1 means potentially large impact, P2 medium impact, and P3 narrower impact. Actual improvement must be measured; these are not promises of a particular percentage or frame rate.

The user authorized documenting every candidate here and implementing all three performance P1 items in the current worktree. The user subsequently authorized adding the code-organization concerns below and merging the completed work into local main. Performance P2/P3, code-organization follow-ups, and further backend profiling remain follow-up work. The separately approved backend tile-read consolidation is recorded below and remains in its worker branch pending review. A push or pull request requires a separate user request.

Investigation baseline: commit `c80d670b247d1220a626c89a5576082c601918a6`, branch `codex/investigate-process-map-performance0000844`. This document was written before implementation. Update the completion section after verification; keep the remaining candidates actionable for another agent.

## Existing architecture and required behavior

Read `AGENTS.md`, `docs/tests/process-map.md`, and `docs/tests/relationships.md` before changes. Those contracts govern behavior; this document records work to improve implementation efficiency.

- Keep one deck.gl canvas, one Cartesian OrthographicView, and the existing TileLayer scheduler. Installed dependencies already include deck.gl 9.3.10 and React 18. Do not add a second renderer or a new state/relationship framework.
- Keep the bounded six-request tile scheduler, 60 ms tile debounce, 32 MiB encoded tile-cache budget, cancellation, identical-read sharing, stale-response rejection, and projected-size level of detail (LOD).
- Keep tile drawing data stable during ordinary camera movement. The existing spatial-layer memoization and separate edit overlay already achieve much of this; do not claim that every pan currently rebuilds all tiles.
- Preserve exact Company Explorer Folder and Logic Gate identities. Explorer owns structural parentage, placements own geometry, operational relationships own flow, and traces own only saved routing. No surrogate IDs, copied business authorities, stored tile membership, or generic resource registry.
- Ordinary same-permission updates must preserve valid visible coverage, camera, selection, and pinned scorecards. Explicit permission/auth/company changes, realtime recovery, or unknown protection classification must clear protected data immediately and reject old responses.
- Preserve transparent Folder interiors, drawing and picking order, cross-tile clipping/deduplication, selected/edit object masks, complete replacement coverage, rollback, concurrent saves, and exact group move/resize behavior.
- A completed drag must never become a click, even if snapping leaves its final coordinates unchanged. Cache and render optimizations must not change this rule.
- Do not apply schema changes to live databases or use writer/admin credentials. Backend tests on Windows run through WSL2 Ubuntu and `/usr/local/go/bin/go` using the approved outside-sandbox path on the first attempt.

## Evidence and limits

The baseline investigation passed 57 existing frontend tests: geometry 14, interaction 6, surface 37. Current worktree sources were bundled using installed dependencies and existing DeckGL/realtime test stubs; no browser GPU was involved.

A synthetic build of the baseline layers while moving one Process visited every loaded placement twice: once for child label positions and once for anchor discovery. An empty settled overlay and one hovered or selected Process also performed these scans. With 20,000 resident placements this is 40,000 visits, although ordinary hover produces only two anchors and four grips.

| Loaded placements | Layer-build median | Layer-build 95th percentile |
| ---: | ---: | ---: |
| 2,000 | 0.567 ms | 0.934 ms |
| 10,000 | 2.855 ms | 4.064 ms |
| 20,000 | 5.951 ms | 7.804 ms |

These timings used ordinary Maps, 20 warmup calls, and 40 samples. They exclude React commits, tile sublayer generation, WebGL setup, GPU drawing, and network/database time. Twenty thousand simultaneously resident placements is a stress fixture, not an observed production workload. Operation counts are stronger evidence than timing on one machine.

The existing large-company fixture represents 20,000 company placements and passed with 12 viewport tile requests and about 8.81 MB of retained encoded tile payload. It does not demonstrate live browser frame rate. Browser FPS, actual map sizes, GPU cost, production network latency, and database query timing remain unmeasured.

## P1 — Potentially large impact (authorized implementation)

### Remove whole-map scans during hover and dragging

Problem: `editPlacementLayers` in `frontend/src/modules/process-map/ProcessMapSurface.tsx` computes child label positions over all presentation placements, even when no edited Folder needs them, then scans all placements to find anchors for only the selected/hovered identities. Drag updates also allocate state when snapped geometry is unchanged. `processMapDeepestContainingFolder` in `processMapGeometry.ts` repeatedly builds a Folder index, walks ancestors, and sorts candidates during dragging.

Approach: use the existing keyed placement Map for selected/hovered lookups; enumerate all eligible anchors only during connection mode. Reuse child/Folder information until the relevant geometry changes. Precompute the stable Folder ancestry/ordering needed by one gesture, retaining existing depth/area/ID tie-breaks and cycle protection. Skip visual updates for unchanged snapped deltas/waypoints while preserving gesture completion and saving the final valid position. Add animation-frame batching only if remaining measurements justify it.

Acceptance: unrelated placement count must not determine ordinary hover or single-Process overlay preparation. Connection discovery and intentional Folder-subtree transforms may still visit their actual affected objects. Existing controls, labels, destination highlighting, nested group transforms, rollback, and click suppression must remain correct. Add operation-count regressions rather than machine-sensitive timing assertions.

### Stop selection from rebuilding unrelated tiles

Problem: the global `renderSubLayers` update trigger includes selection and edit masks. deck.gl invalidates every cached tile's layers when these props change. `renderTileSubLayers` rebuilds the geometry/text arrays and layer stack even for unaffected cached tiles.

Approach: keep the existing selected/edit overlay and exact masks; retain derived data/sublayers for tiles whose local selected/edited identities did not change. Use the existing protected TileLayer and its documented/pinned lifecycle. Do not merely remove mask triggers, because that creates duplicated geometry, stale picks, or incorrect Folder drawing order. LOD, changed tile payloads, business date, and protected scope still invalidate the affected content correctly.

Acceptance: selecting A then B rebuilds only tiles actually affected by those masks; unrelated tile geometry/data references stay reusable and selection issues no tile HTTP requests. Stale masks, cross-tile traces, selected Folder backdrops, permission purges, and ordinary replacement coverage remain correct.

### Stop small saves and realtime updates from refreshing the entire loaded map area

Problem: `committedMutation` in `processMapApi.ts` clears company scene/tile caches. `refreshAfterMutation` in `ProcessMapSurface.tsx` advances the company read version and reloads the scene. The TileLayer uses that global version as its data identity. Ordinary remote events likewise lead to scene/tile replacement. Small geometry, trace, or presentation updates therefore repeat unrelated reads and drawing work.

Approach: reuse canonical mutation envelopes and existing typed event/read paths to identify affected ordinary content and reconcile it without invalidating unrelated loaded tiles. Design frontend, API, and realtime version handling together; do not simply stop advancing versions or ignore events. Account for old and new locations, incident connectors, deleted objects, offscreen updates, multiple clients, in-flight reads, and concurrency. Bounds may be retained only when unchanged bounds can be established. Unknown/protected changes still require full protected invalidation; that is correct access handling, not a compatibility path.

Acceptance: a small same-permission edit or equivalent remote update must not refetch/rebuild unaffected loaded tiles. Moving between tiles updates both old/new coverage and affected trace fragments. Ordinary updates retain camera/selection/pins without stale resurrection; protection changes clear protected content synchronously. Recovery and stale/out-of-order reads converge to canonical current state. Use meaningful request-count and mounted-behavior tests for local and remote paths. Update `docs/tests/process-map.md` wherever the read/update contract changes.

## P2 — Medium potential impact (follow-up)

### Batch tile arrivals before rebuilding combined presentation

Problem: `handleTileLoad` commits a new loaded-tile Map, and `mergeTilePresentation` scans all retained tiles to rebuild and deduplicate placements/traces. Separate completions can repeatedly process unchanged tile content.

Approach: first consider committing arrivals together once per frame while preserving prompt first coverage. Reuse the existing state and merge rules; do not introduce a second graph store or an elaborate incremental index before measuring. Preserve trace-fragment deduplication, revision/presentation precedence, cancellation, unloads, selection coverage, and protected generation guards.

Acceptance: a burst of tile completions causes bounded presentation rebuilds without delaying or losing coverage. Measure CPU allocations and retained-memory behavior on a representative pan/load sequence.

### Reduce unnecessary copies of cached placements and connectors

Problem: `cloneTile`, shared-request delivery, and cache-hit delivery in `processMapApi.ts` deep-copy placements, traces, route points, and path fragments. Normalization also reserializes/encodes payloads to measure cache bytes. API and deck caches retain objects beyond the nominal encoded-byte budget.

Approach: audit mutating consumers and existing isolation tests before sharing immutable read data; clone only objects entering an editable path. Keep viewer/company/auth scoping, bounded caches, ETags, and abort ownership. Do not remove defensive copying without enforcing immutability at the receiving boundary.

Acceptance: cache consumers cannot mutate another reader's data, permission changes cannot expose old cached content, cache bounds remain enforced, and heap/garbage-collection measurements show a worthwhile reduction.

## P3 — Lower, narrower potential impact (follow-up)

### Keep pinned scorecard contents from rerendering with camera movement

Problem: `ProcessMapQDCard` is an ordinary React function under `ProcessMapSurface`; camera state and inline close/enter/leave callbacks cause its contents, including three 31-day trackers, to render again. This coupling is confirmed by source inspection but has not been profiled.

Approach: stabilize card callbacks and memoize its data-driven contents; update only the positioned wrapper when the camera or placement moves. Reuse `LogicGateQDTracker` and its existing shared monthly cache. Do not replace the complete trackers with a reduced UI, add hover delay contrary to the immediate-card rule, or create another scorecard/RACI authority.

Acceptance: camera-only updates move the pinned card without rerendering unchanged tracker contents; ratings, RACI names, editing access, business-day rollover, hover behavior, and realtime updates still refresh correctly.

## Backend tile-read consolidation — 2026-09-05

Baseline: `890649a8ed50318870bfff2431ae7ddff6606e69`. The existing tile API now obtains fresh company authorization, actor role, map and permission-group versions, the Los Angeles business date, placements, and traces in one read-only SQL statement. The 200 ETag uses metadata from that complete read. Spatial candidates include real and restricted footprints before materialized permission evaluation; the prior RACI detail gate and Go trace clipping remain. No frontend scheduling or schema changes were made.

For an already resolved actor, a fresh tile changes from six SELECTs plus BEGIN/COMMIT to one SELECT. A valid conditional request uses one lightweight authorized metadata SELECT; a stale conditional request uses that check followed by the complete SELECT. HTTP repository-call tests and pgx query tracing verified these paths, including revoked access before 304. These are SQL statement counts, not protocol-packet counts: connection checks and statement preparation can add exchanges.

A temporary comparison used the baseline implementation and new implementation against the same disposable PostgreSQL 18.4 company: 845 synthetic Process placements plus three automatically created Folders, an ordinary company user, and no traces. Processes formed 29 columns spaced 64 units apart with 32-by-24 dimensions. The connection used WSL-to-Windows networking, pgx simple protocol, one warmed connection, and a read-only session after fixture setup. Each operation had two warmups and 12 samples with rotated execution order. The old full path included membership and version preflight reads. Public tile JSON matched exactly in all three cases.

| Tile z/x/y | Returned placements | Old median / p95 | New median / p95 |
| --- | ---: | ---: | ---: |
| 22/0/0 | 16 | 68.390 / 87.974 ms | 29.623 / 48.790 ms |
| 22/7/7 | 1 | 1103.108 / 1533.695 ms | 11.287 / 16.758 ms |
| 18/0/0 | 845 | 1818.302 / 2500.103 ms | 605.616 / 944.619 ms |

In the broad-tile sample, the lightweight conditional check changed from 2.364 ms median / 4.363 ms p95 to 1.391 ms / 2.609 ms. With only 12 samples, the reported nearest-rank p95 is the largest sample. These measurements combine database execution, database exchange, and Go projection time; they do not separate those costs. They exclude HTTP, authentication resolution, browser scheduling, rendering, and time until all visible tiles load. They are synthetic results, not a running-app speedup or a promise of immediate map loading. The broad tile still took about 606 ms locally. No live database was accessed and no running backend was replaced. Temporary comparison code was removed after measurement.

Verification passed for the affected memory/HTTP/source-contract tests and the PostgreSQL Process Map cases. Tile regressions covered statement counts under a read-only session, role changes and revocation, concurrent metadata/payload changes, tiny restricted footprints, inherited permissions and hidden parents, scorecards, preserved RACI gating, independent/crossing traces, and cancellation. One new fixture initially deleted its test user with its last membership; preserving another company membership fixed that fixture, and the affected tile cases passed on rerun. PostgreSQL 17 was not available locally; no PostgreSQL 18-only SQL or schema change was introduced.

## Further backend profiling

`backend/internal/store/postgres_process_map.go` computes permission-safe whole-company scene bounds before tile loading can start. Its trace query joins endpoints and expands `jsonb_array_elements(trace.route_points)` to calculate route bounds for each tile; clipping then happens in Go. This can be expensive with many connectors, but no live query timings were collected.

Measure the actual production-shaped scene and tile queries with a designated read-only credential and representative authorized data. A bare spatial predicate test that disables sequential scans does not prove the full permission/enrichment query is fast. Use full-query `EXPLAIN (ANALYZE, BUFFERS)` only in the permitted read-only workflow. Preserve source identities and geometry authority if indexes/query changes become justified; PostgreSQL development compatibility is 17.x. Do not apply migrations as an agent.

## Code organization priorities (follow-up)

These buckets describe the severity of maintenance concerns, independently of the performance-impact buckets above: P1 means a really bad problem, P2 a medium concern, and P3 a lower concern. This review found a coherent working update flow and a large concentration of responsibilities in `ProcessMapSurface.tsx`; it did not establish a broken architecture or justify replacing the current update system. At review time, the Surface module had 2,451 lines, 24 React state hooks, and 22 refs. Those counts describe its size, not proof that its behavior is wrong.

### P1 — No confirmed items

No confirmed concern from this organization review warrants the "really bad" bucket. Do not confuse this with the three implemented performance P1 items above.

### P2 — Extract the map-data hook

Move the existing scene loading, refresh queue, successful/failed save handling, reconciliation, temporary saved results, and protected-scope resets into a dedicated hook in the Process Map module, for example `useProcessMapData.ts`. Preserve the existing implementation and data contract while giving these related decisions one clear home. Keep `ProcessMapSurface.tsx` focused on connecting the canvas, interactions, and controls.

Relevant starting points are `loadScene`, `requestCanonicalRefresh`, the realtime subscription, `refreshAfterMutation`, `applyEnvelope`, placement/trace/relationship save completion, `handleViewportLoad`, and `purgeProtectedScene`. The API module should continue to own requests and its bounded cache; the existing TileLayer adapter should continue to own renderer-specific tile scheduling, content, and sublayers. The hook coordinates accepted versions and results across those existing boundaries. Do not introduce a second refresh controller, generic state framework, copied business authority, or a wrapper that leaves the same coordination duplicated in Surface.

Acceptance: Surface no longer owns the map-data lifecycle; local saves and remote changes still share one refresh queue; stale responses, overlapping saves, rollback, current tile coverage, permission resets, selection, camera, and pinned cards retain their existing behavior. The extraction must preserve the P1 operation-count and tile-reuse improvements.

### P2 — Extract drawing builders

Move ordinary tile drawing and selected/edit overlay construction into a separate module, for example `processMapLayers.ts`. Move their drawing-only types, constants, and helpers with them when that produces a clear boundary. Keep the existing `processMapGeometry.ts`, `processMapInteraction.ts`, `processMapTileLayer.ts`, and `ProcessMapQDCard.tsx` responsibilities intact. Avoid circular dependencies back into Surface.

Relevant starting points are `renderTileSubLayers`, `editPlacementLayers`, `editTraceLayers`, `buildProcessMapSpatialLayers`, `composeProcessMapLayers`, and `buildProcessMapLayers`. Ordinary and selected objects intentionally have different controls, highlighting, masking, and drawing order; preserve those differences.

Acceptance: Surface connects the existing canvas and controls while the drawing module builds layers from explicit inputs. Picking, LOD, Folder label clearance, cross-tile fragments, selected-object overlays, layer/data reference reuse, and ordinary/protected replacement behavior remain unchanged.

### P3 — Small cleanup alongside extraction

- Remove helpers confirmed to have no remaining production purpose after checking all callers. Review candidates include `snapProcessMapDimensions`, the now test-only `processMapDeepestContainingFolder`, and `postgresRequireMappedProcessMapParentTx`; recheck usage before deleting anything. Backend cleanup is a separate follow-up from the frontend extraction.
- Share identical body/label/shape helpers where that reduces real duplication, while preserving intentional differences between ordinary and selected drawing. Do not force both paths into a configurable rendering framework.
- Adjust tests that unnecessarily depend on a helper's exact filename, local name, or source position. Preserve business, security, and performance coverage; use the existing behavior tests to verify the extracted modules.

### Existing update rules to preserve

These are explanations of the current behavior, not proposed business-rule changes. The numbered laws in `docs/tests/process-map.md` remain authoritative.

1. The backend owns confirmed saved geometry and relationships.
2. An active drag displays a temporary preview immediately; a save response provides confirmed geometry.
3. An older response must not overwrite a newer edit, and a failed operation must not clear another operation's preview.
4. Successful saves and ordinary remote changes enter the same coalesced refresh path; an older successful save still requests validation when its overlay is superseded.
5. Only server-certified unchanged tiles may advance to a newer read version without refetching; authorized previous coverage may remain visible while changed tiles load.
6. Confirmed temporary results and deletion masks remain until current-version viewport coverage can replace them; later pans must not resurrect stale moved/deleted objects.
7. Permission, actor, company, or protected-scope changes clear old protected data, cancel obsolete requests, and reject stale completions before replacement content is accepted.

For example, dragging a Process from A to B shows B while the old downloaded tile still contains A. After the server confirms B, the temporary confirmed result keeps B visible and suppresses A until fresh tiles arrive. If the user starts a second move to C, the first save's late response must preserve that newer preview. These are temporary representations of one saved object, not separate business records. The current merge order already expresses downloaded content, then confirmed results awaiting fresh tiles, then active previews, with deletion masks suppressing stale content.

### Clarifications and scope

Automatic placement and manual placement intentionally differ. Frontend drag previews and backend saved geometry are both necessary and must agree on shared geometry rules. Selected and ordinary objects intentionally expose different controls. None of those differences alone is a cleanup defect.

The Explorer observation was specific to the in-memory backend: `syncMemoryProcessMapParentToExplorerLocked` updates Folder/item records and `companyExplorerV2Edges`. That shows two representations being synchronized, but this review did not establish that either is obsolete or that production PostgreSQL has the same duplicate graph. Do not expand the module extraction into an Explorer relationship/schema redesign or a Memory/PostgreSQL rewrite without a separate investigation and task.

Status: documented follow-up only. The current documentation-and-merge request does not implement these extractions. Implement them in working, behavior-preserving steps when requested, run the affected Process Map behavior/performance tests and frontend build, and keep the existing API/geometry/security contracts intact.

## Verification and future measurement

- Run affected geometry, interaction, API, realtime, and mounted Surface tests. Test invalidation and concurrent replacement behavior, not implementation text alone.
- Build/typecheck the frontend. Run affected backend tests through WSL when backend/API changes are made; use disposable data only for write-capable integration tests.
- Repeat the synthetic operation-count experiment against the changed code. Keep wall-clock timings informational.
- Add or run a production-build browser benchmark with a representative fixture: initial load, warm pan/zoom, selection, single-Process drag, deep Folder drag/resize, pinned card movement, local save, remote update, and permission invalidation. Target smooth 60 FPS interaction, and record frame times, React commits, tile request counts, and allocations. Report exactly which measurements include real WebGL.
- Native `useDevicePixels` is enabled. Compare DPR 1 and native resolution only if GPU profiling points to fill-rate pressure; do not reduce text clarity speculatively.
- Keep the final diff focused, update current behavior laws directly, commit locally, and leave P2/P3 items documented for subsequent work.

## Completion

All three P1 implementations are present. Final verification results are recorded below. P2, P3, and live backend profiling remain follow-up work.

### Interaction and tile rendering

`ProcessMapSurface.tsx` uses keyed selected/hovered placement lookups. A memoized two-child index provides Folder label clearance: supported gestures transform either every child of a Folder or one root among stationary siblings. The stable Folder candidate order is prepared before pointer updates; containment checks retain depth, area, identity tie-breaks, and cycle handling. Unchanged snapped pointer movement preserves state. Full connection target discovery and actual affected subtree transforms still enumerate their relevant objects.

`processMapTileLayer.ts` contains the existing protected TileLayer subclass. It preserves unrelated sublayer references across selection/edit changes, including certified unchanged tiles across read versions. Dirty tiles continue through deck.gl's existing scheduler, cancellation, and refinement. Cancellation still aborts obsolete network work; an exact tile's already loaded snapshot may remain visible in the same protected generation and business day while its replacement starts. Stale network results are rejected. A completed viewport version prevents later pans from rendering older cached moved/deleted objects. Protected invalidation still finalizes the old tileset. This code depends on deck.gl 9.3.10 lifecycle behavior; run the dedicated real TileLayer/TileHeader tests when updating deck.gl.

### Canonical selective validation

The frontend sends a read-only `POST /v1/process-map/changes` with `{company_id, since_version, tiles:[{z,x,y,process_map_read_version}]}`. The request carries at most 512 distinct tile coordinates and never sends placement/trace data. The response contains current scene metadata, `validated_tiles`, and `protected_geometry_changed`. Every certification echoes the **old submitted version**, certifying unchanged content at the response's new version. It is not itself a new tile payload. The client checks the exact submitted tuple and same protected scope before promoting the tile wrapper while retaining its arrays. Already-current/newer cached data remains valid. Uncertified older tiles reload.

The backend reuses the existing workspace `domain_events` sequence and stores private `process_map_damage` bounds and exact typed resource references in affected events. Both old/new placement geometry and incident connector paths are captured in the mutation transaction, including external connectors whose saved route points stay fixed. Placement moves/resizes, Folder transforms, trace creation/rerouting/deletion, Process placement removal, and ordinary QDC/name/RACI presentation changes can validate unrelated tiles. Structural commands without complete damage information safely reload older content broadly.

PostgreSQL reads scene metadata, event history, and access checks in one read-only repeatable-read transaction. Replay checks every workspace sequence from the oldest submitted tile/scene version, up to 2,048 events. A protected event, sequence gap, or truncated history returns a protected reset with no certifications. Known ordinary events without enough damage information invalidate older tiles broadly. Private damage is never sent in mutation responses or realtime messages, and selective patterns require current Edit access to every affected resource and connector endpoint. No schema, migration, event authority, resource identity, or realtime message format changed.

Local save acknowledgements and ordinary remote events share one coalesced refresh path. A successful older operation still requests canonical validation when its overlay is rejected because a newer operation began. A minimum acknowledged version prevents early mask retirement. React StrictMode effect replay recreates the refresh queue correctly. Selection, pinned cards, and camera survive ordinary updates; protected/auth/company/recovery/business-date changes retain their purge behavior.

### Measured result and remaining limits

The 20,000-placement regression now observes zero whole-map iteration and at most two placement lookups for ordinary hover, selection, and a single-Process move. Connection controls still enumerate eligible targets by design.

| Loaded placements | Changed layer-build median | Changed 95th percentile |
| ---: | ---: | ---: |
| 2,000 | 0.061 ms | 0.099 ms |
| 10,000 | 0.059 ms | 0.150 ms |
| 20,000 | 0.038 ms | 0.054 ms |

The repeat uses the same 20 warmups and 40 samples. The child index is prepared once, matching the component's memoization. Sub-millisecond timings vary; the elimination of whole-map visits is the reliable comparison. These remain CPU layer-construction measurements without React, WebGL, GPU, tile sublayer construction, network, or database time. No live browser FPS improvement is claimed. Scene bounds still inspect company geometry, and the bounded event replay adds server work; measure those on representative data before prioritizing further backend optimization.

Verification on 2026-09-04:

- Frontend node runner coverage: 1,086 feature tests across 135 registered files, plus its runner-contract test, all passed with no skips. Coverage was completed in segments after updating obsolete source assertions and making the held-fetch test stub honor browser cancellation. The 112 Process Map tests include geometry 14, API 10, interaction 6, contract 17, Surface/TileLayer 55, performance 4, and changes/cache 6.
- Frontend production build: TypeScript and Vite passed. Vite retains its large-chunk advisory; bundle splitting was not part of these P1 changes.
- All backend packages through WSL `go test ./...`: 1,455 passing tests/subtests, 132 skips, zero failures. Skips cover separate opt-in database/cloud fixtures, the WSL Git source-case audit, and a query-plan test requiring unavailable WSL PostgreSQL server tools.
- The complete `node scripts/test_process_map_postgres.mjs` disposable gate passed migration and store suites on PostgreSQL 18.4, including the new selective-replay query; automatic fixture cleanup completed. This was an isolated test database, not the live development or production database.
- Backend targeted cases cover old/new tile and connector damage, Folder move/resize, presentation updates, missed/out-of-order changes, protected/history resets, request limits, and wire privacy. Mounted frontend regressions cover overlapping save success/failure, same-cell drag updates, unrelated tile certification, StrictMode, and aborted old coverage before a replacement loader starts.
- `git diff --check` passed. Dependencies and lockfile are unchanged. No live database writes, schema changes, merge, push, or pull request were performed.

To repeat the checked suites, run `npm run test:node-relationships` and `npm run build` from `frontend/`; run `node scripts/test_process_map_postgres.mjs` from the repository root; run backend `go test ./...` using the required Windows/WSL execution path in `AGENTS.md`.
