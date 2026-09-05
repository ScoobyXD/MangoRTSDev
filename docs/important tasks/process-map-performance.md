# Process Map performance fixes — 2026-09-05

The follow-up audit covered 23 items after the earlier tile-query consolidation. This change addresses the demonstrated defects and waste in the existing React/deck.gl map and canonical Go/PostgreSQL API. Required camera state, individual Process visibility, and permission rules remain. No framework or dependency was added.

Baseline: `368f8d102a584abd6f88d56beca87d76fc79bd2a`. This implementation is a separate worktree change; it has not been merged or pushed.

## Complete audit disposition

| ID | Item | Result |
| --- | --- | --- |
| 1 | Reloads inflated deck.gl cache bytes | Correct resident-byte accounting in the existing tile adapter, including replacements, errors, cancellation, eviction, and late responses. |
| 2 | Unlimited small/empty tile retention | Configure the existing 32 MiB budgets with a 256-tile count limit. Deck may retain additional currently required coverage; failed empty-header eviction now also removes Surface's retained payload. |
| 3 | Eleven layers even for empty tiles | Construct only nonempty tile sublayers, preserving their IDs, drawing order, and picking. |
| 4 | Offscreen layer traversal and GPU allocations | Release offscreen GPU layers while keeping bounded downloaded payloads. Rebuild correct detail and masks when visible again. |
| 5 | Refinement work after coverage is complete | Return immediately after confirming selected coverage. |
| 6 | Repeated ancestor searches during loading | Use deck's existing parent links; preserve exclusive ancestor/child coverage for translucent content and failed loads. |
| 7 | Full presentation rebuilding for each arrival | Publish nearby tile arrivals once per animation frame. Keep accepted refs current immediately; flush before retiring mutation masks and cancel pending publication on protected purge. Skip redundant presentation Map copies without overlays. |
| 8 | Trace copies immediately discarded | Share immutable tile fragments and remove discarded copies during presentation merges and affected trace transforms. |
| 9 | Repeated serialization of resident fragments | Retain deduplication keys by immutable fragment identity using a WeakMap; keys disappear with the fragments. |
| 10 | Serialize/encode a parsed payload just to count bytes | Measure the actual response ArrayBuffer using the existing request helper. |
| 11 | Separate payload graph per cache/subscriber | Normalize and freeze one graph; share it across API cache, concurrent readers, and rendering. Editing still owns its mutable copies. |
| 12 | Added 60 ms request debounce | Remove the delay while retaining deck's six-request scheduler and cancellation. This was a loading issue, not the explanation for warm pan lag. |
| 13 | Column-by-column request order | Schedule nearest the viewport center first through the existing tileset. |
| 14 | Large Surface/camera React state | Measured rather than replaced: stable geometry memos already avoid whole-map camera rebuilds. Keep necessary live camera state; remove actual rendering work through items 3–4 and memoize card contents. |
| 15 | Pinned card contents rerender during panning | Memoize the existing card, stabilize callbacks, and memoize its geometry while its wrapper follows the camera. |
| 16 | Dense views and translucent Folder surfaces | Preserve required visibility, outlines, and picking for every object. Reduce layer traversal, allocations, and path conversion rather than hiding or aggregating business objects. GPU saturation on the user's live map was not established. |
| 17 | Slow broad database tiles | Deduplicate permissions within the authorized statement, restore the existing spatial index prefilter, and correct the measured permission-resolver plan. |
| 18 | Slow initial scene | Return authorized bounds and metadata in one statement; evaluate each placement permission once. Use that same authorized scene in changes validation, deleting redundant membership/version reads. |
| 19 | Repeated route JSON expansion | First test endpoint bounds; decode saved route coordinates once only when needed to decide spatial candidacy. Exact canonical routing, clipping, and endpoint access remain. |
| 20 | Repeated and expensive authorization | Resolve each exact typed resource once per tile statement. Correct one-row function estimates and use the existing unique typed index for each inherited parent instead of repeatedly scanning company policy rows. |
| 21 | First 512 cached tiles displaced visible validation | Bound ordinary retention and prioritize current visible tile detail, other visible coverage, then nearby history when validation candidates exceed 512. |
| 22 | Redundant path conversion and unused tile fields | Store flat XY paths once and reuse them in accessors. Remove unused tile-cache ETag storage and tile-only timestamps across both API implementations and frontend types. Preserve stored and committed timestamps; advance the tile ETag format version. |
| 23 | Rebuilding offscreen geometry after settled zoom | Build only visible coverage at the current detail. Initial tiles wait for the fitted camera and use its detail immediately. Fit waits for deck's reported dimensions to match the actual pane, avoiding its observed temporary 300-by-150 startup canvas, wrong-camera requests, and transient editing layers. |

## Evidence

The browser fixture uses the actual production-compiled Surface, React bridge, and WebGL/deck renderer with deterministic synthetic data and a fixed 20 ms fake tile response delay. The canvas is 1280 × 800 CSS pixels with a 1920 × 1200 drawing buffer. It drives camera callbacks; it does not measure physical mouse latency, real HTTP, or the user's database.

| Fixture / measurement | Baseline | Changed |
| --- | ---: | ---: |
| 845 Processes, no traces: p95 warm-pan frame interval | 28.7 ms | 19.7 ms |
| Same fixture: frames over 25 ms, 179 intervals | 13 | 1 |
| Same fixture: retained deck layers | 185 | 53 |
| Same fixture: tracked GPU allocations | 74.8 MB | 6.6 MB |
| 845 Processes + 768 traces: p95 warm-pan frame interval | 30.2 ms | 20.1 ms |
| Same trace fixture: frames over 25 ms, 179 intervals | 48 | 2 |
| Same trace fixture: retained deck layers | 185 | 65 |
| Same trace fixture: tracked GPU allocations | 74.9 MB | 6.8 MB |

Both warm-pan comparisons made zero new tile requests. Panning far away and returning restored all visible geometry; zoom restored labels, outlines, and traces. Measurements vary with this shared machine. GPU timer data was unavailable; allocation counts are deck's tracked allocations, not total GPU memory. A 20,000-Process browser run showed approximately one-second animation-frame intervals despite roughly 7–20 ms reported CPU drawing work and visible-page state; that inconsistent run is not used to claim dense-map FPS or identify a GPU bottleneck. Existing deterministic 20,000-Process interaction regressions pass.

The API allocation fixture delivered six read/cache results from one shared frozen graph instead of six copies. Its retained heap delta fell from about 14.0 MB to 2.1 MB; median processing fell from 26.8 ms to 18.1 ms. Removing tile timestamps reduced the large-company fixture's encoded retained payload from 8.81 MB to 6.83 MB. These are isolated measurements, not live application latency.

Final PostgreSQL 18.4 measurements used disposable data, an ordinary viewer, one read-only connection, two warmups, and ten alternating samples per case. They exclude HTTP and browser time. Projected results matched after the intentional timestamp removal.

| Database read, median | Baseline | Changed |
| --- | ---: | ---: |
| Broad tile, 849 placements, no traces | 682.2 ms | 139.3 ms |
| Broad tile, 849 placements + 768 traces | 1487.4 ms | 229.2 ms |
| Small tile with 554 crossing traces | 878.5 ms | 190.4 ms |
| Empty tile in the 768-trace company | 792.2 ms | 39.3 ms |
| Authorized scene | 828.3 ms | 116.4 ms |
| Same 849-resource authorization query | 398.2 ms | 114.7 ms |

## Validation and rollout

139 relevant frontend test executions passed, including real pinned Tileset lifecycle cases, protected purge and stale callbacks, editing/saving/selection, trace clipping and Folder transforms, immutable sharing, visible validation priority, geometry, card behavior, and API contracts. The final immutable certification assertion also passed its mounted regression. The production TypeScript/Vite build passed; its existing large-chunk advisory remains. Backend checks passed 15 HTTP and 51 store top-level tests plus 19 focused PostgreSQL/policy/migration tests and a separate waypoint-detour regression. These include executing the forward migration and comparing function definitions, identity, and ACLs; inherited/customized/reset/detached policies; admin and denied access; direct/group winners; snapshots, index use, cancellation, wire privacy, and trace clipping. Database execution used disposable PostgreSQL 18.4; the migration uses PostgreSQL 17-compatible SQL.

Backend changes: yes — scene/tile/changes queries and tile response projection. Database/schema changes: yes — canonical permission function planning and the forward migration `backend/db/migrations/20260905_process_map_permission_query_plans.sql`. A human must apply this PostgreSQL 17/18-compatible migration to obtain the resolver improvement in an existing database. The migration changes function planning, not tables, stored data, resource identity, or permission rules. No live database was modified. Frontend and backend should be deployed together for the slimmer tile contract.
