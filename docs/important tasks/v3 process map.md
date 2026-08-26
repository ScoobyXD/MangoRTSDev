# V3 Process Map — Continuous deck.gl Company Canvas

Date: August 25, 2026

Status: Approved implementation context for the complete V3 replacement.

## Purpose and Authority

This file is the complete context dump for replacing the current separate-layer Process Map with one continuous, manually authored company canvas rendered by deck.gl.

This is not a staged roadmap. The implementation must ship as one complete end-to-end replacement. It may be built and tested in a sensible internal order, but the finished worker branch must not leave a mixed React Flow/deck.gl renderer, two Process Map read models, incomplete zoom bands, compatibility fallbacks, or a half-cut API.

The numbered laws in these files remain the canonical business contract:

- [`docs/tests/process-map.md`](../tests/process-map.md)
- [`docs/tests/relationships.md`](../tests/relationships.md)
- [`docs/tests/permissions.md`](../tests/permissions.md)
- [`docs/tests/recycle-bin.md`](../tests/recycle-bin.md)
- [`docs/tests/REST API & WebSocket.md`](../tests/REST%20API%20&%20WebSocket.md)
- [`docs/tests/universal-picker.md`](../tests/universal-picker.md)

If this context file conflicts with a numbered law, the numbered law wins and this file must be corrected in the same change.

## Current Repository Baseline

The implementation starts from a working Process Map, not a blank canvas:

- The frontend currently renders the map with `@xyflow/react` in `frontend/src/modules/process-map/ProcessMapSurface.tsx`.
- `frontend/src/pages/process-map/ProcessMapPage.tsx` currently treats root and each mapped Folder as separate routes and renders breadcrumbs.
- `frontend/src/modules/process-map/processMapApi.ts` currently reads one exact root-or-Folder layer and already has useful abort, in-flight sharing, ETag, cloning, and stale-generation patterns to reuse.
- `frontend/src/modules/process-map/processMapGeometry.ts` currently mandates one seven-by-five footprint for both supported resource types.
- Existing placement storage already keeps `map_parent_folder_id`, `grid_x`, and `grid_y` independently from Company Explorer parentage, but it does not yet store width or height.
- Existing Company Explorer rows already emit one exact typed drag payload. Process Map must reuse it.
- Existing Process Map behavior already includes selection, drag rollback, all four Folder/Process operational endpoint combinations, trace routing and waypoint editing, the Process QDC hover and pinned card, and the shared full-page Logic Gate overlay opened from a Process.
- Existing HTTP and realtime behavior already uses committed mutation responses, request cancellation, viewer-safe conditional reads, compact company invalidations, and no polling. Those mechanisms are extended to scene and tile reads rather than replaced by another cache or event system.

The replacement keeps those product abilities and existing Mango authorities. It changes the camera, renderer, saved dimensions, containment gestures, and bounded read shape required for one continuous canvas.

## What deck.gl Does and Does Not Do

deck.gl supplies the reusable graphics machinery:

- `OrthographicView` supplies a top-down non-geographic Cartesian camera with very wide zoom limits.
- GPU layers supply scalable drawing, picking, and presentation updates.
- `TileLayer` supplies viewport-based z/x/y tile selection, request scheduling, bounded cache controls, a per-tile abort signal, request debouncing, and a refinement hook.
- A Mango refinement rule built through that hook keeps suitable loaded coarse coverage visible until complete finer coverage is ready without making overlapping vector representations into duplicate picks.

deck.gl does not understand Mango's Explorer tree, manual Folder containment, operational relationships, permissions, recycle rules, LOD thresholds, or editing commands. Mango must still own those rules, the scene/tile endpoints, and the settled-request gate. `TileLayer` is used properly as spatial transport and rendering infrastructure; it is not presented as a ready-made business hierarchy.

`TileLayer.debounceTime` is only a secondary bandwidth optimization. It does not by itself prove that a camera gesture or transition has ended, and deck.gl may clear a wheel interaction flag between wheel ticks. The application must restart one explicit quiet-period timer after every `onViewStateChange` and track flags from `onInteractionStateChange` too. Timer expiry commits only when every drag, pan, zoom, and transition flag is inactive. If expiry occurs during interaction, the later all-inactive interaction callback must settle immediately when the quiet period has already elapsed or arm only its remaining time. Network-backed tile work is permitted only for that committed generation.

## The Exact Product Outcome

Opening Process Map must immediately show the entire mapped company without requiring the user to click or drill into a Folder.

The user sees one continuous canvas and may pan and zoom from the whole-company view down to an individual Process. Every mapped placement remains perceptible at low zoom as a cheap shape or presence mark. More visual detail becomes clear as the placement occupies more screen pixels. The transition happens because of camera scale and level-of-detail rendering, not because the user entered a different route or opened a different map.

The supported editing behavior remains deliberately small:

- drag authorized Company Explorer Folders and Processes onto the map;
- move and resize their manually authored placements;
- use a Folder placement as a colored perimeter fence;
- place other mapped resources inside a Folder fence;
- draw, select, reroute, and delete explicit operational traces;
- select a Process and use its existing hover or pinned QDC card;
- double-click a Process, or press Enter or Space while it is focused, to open its canonical Logic Gate editor and Kanban page in the existing blocking overlay;
- zoom very far out and very far in while staying on the same canvas.

Do not add textboxes, annotations, dashboards, ongoing or user-invoked automatic layout, inferred flow, operational summaries, minimaps, geographic imagery, terrain, streets, buildings, or another resource type as part of this replacement. The append-only one-time forward geometry compaction below is the only layout correction.

## Three Meanings That Must Never Be Blended

| Meaning | Canonical authority | What it does not mean |
|---|---|---|
| Company Explorer organization | Existing Company Explorer rows and edges | It does not determine Process Map containment, coordinates, or operational flow. |
| Process Map containment and geometry | `process_map_placements` | Being inside a Folder fence does not create operational flow or change Company Explorer. |
| Directed operational flow | `resource_operational_relationships` | It does not grant access, establish ownership, or change either hierarchy. |
| Saved trace routing | `process_map_traces` | It is dependent drawing geometry and is not another relationship authority. |

The literal Explorer Folder tree and the visual Process Map tree are intentionally allowed to disagree. A Process from one Explorer root may be placed beside a Folder from another Explorer root. Two resources from unrelated Explorer branches may be connected directly on Process Map. Dragging or reparenting an Explorer row never changes its Process Map position. Moving a placement never changes its Explorer parent.

## Manual Canvas Containment

`process_map_placements.map_parent_folder_id` remains the one authority for manually authored map containment.

- A null map parent means the placement is on the company canvas root.
- A non-null map parent names one exact mapped Company Explorer Folder used only as the visual container.
- Both Folders and Processes may be placed at the company canvas root.
- Only a Folder may parent another placement.
- Folder map parentage rejects self-parenting, descendant cycles, missing parents, unplaced parents, and cross-company parents.
- The candidate resource's Explorer parent is irrelevant to the selected map parent.
- Dropping or finishing a drag inside an eligible Folder fence highlights and chooses the deepest eligible visible fence under the placement.
- Dropping outside every Folder fence places the resource at root.
- Moving a placement across a fence updates only its map parent and geometry.
- Changing map parent, moving, or resizing a placement preserves every incident operational relationship and saved trace.
- Removing a placement may remove incident saved trace geometry because an endpoint is no longer on the map, but it preserves the operational relationship and endpoint resources.

Every placement uses signed integer company-world grid coordinates and positive integer grid dimensions:

```text
grid_x
grid_y
grid_width
grid_height
```

Coordinates and dimensions are canonical manual map facts. They are not pixels, CSS values, latitude/longitude, deck.gl state, or derived Explorer data.

Folders render as resizable transparent fences with a colored perimeter. Processes render as resizable neutral cards with the existing green Process outline. Initial drop sizes are defaults only; they are not permanent type-wide mandated dimensions. Restricted placements retain one uniform permission-safe placeholder size and never reveal their real type or dimensions.

Moving a Folder moves its recursively contained placements by the same company-world delta as one committed map operation. A saved trace whose two endpoints are both in that moved set translates every intermediate route point by the same delta exactly once; a trace with only one moved endpoint keeps its global intermediate route points and reconnects through the endpoint's newly derived anchor. Resizing a Folder does not automatically scale, rearrange, or relayout its contents and may not finish with a recursively contained placement outside the fence. No ongoing automatic layout or collision repair runs.

## One Continuous Camera

Process Map has one stable company route:

```text
/process-map
```

There are no Folder-layer Process Map routes. Zooming, panning, clicking, or crossing a detail threshold never changes the URL or browser history.

When the map first opens:

1. Read the authorized company scene metadata and current display bounds.
2. Center and fit the one camera around those bounds with reasonable padding.
3. Do not select a Folder or Process.
4. Do not refit when later tiles or detail arrive.

Wheel zoom targets the current camera center. This is not the deck.gl controller default: Mango must use controlled view state, a small custom OrthographicController, or its own wheel handler so wheel input changes scale while keeping the camera `target` fixed rather than anchoring to the pointer. Folder double-click may remain only as an optional camera convenience that fits that Folder fence; it must not navigate, load a different semantic map, or create a history entry.

Viewport position, zoom, selection, hover, open QDC card, open Process overlay, loaded tiles, and deck.gl internal state remain browser runtime state and are not persisted as Process Map business facts.

Opening the Process overlay does not navigate or change browser history. Closing it by its red close action, Escape, or backdrop returns to the still-mounted company canvas with the same camera, placements, and traces.

## deck.gl Is a Flat Renderer, Not a Geographic Map

V3 uses one deck.gl instance with one `OrthographicView` over Mango's Cartesian grid.

The visible background remains a very white plain canvas with the existing subtle uniform grid if retained. There is no geographic basemap, Mapbox, MapLibre, OpenLayers, Google imagery, latitude/longitude projection, terrain, road layer, building layer, globe, pitch, rotation, or geographic attribution.

The deck.gl canvas owns the camera, drawing, picking, and pointer interaction. React Flow is removed from the Process Map renderer. Do not run React Flow and deck.gl together, because that would create two cameras, two hit-test systems, two selection models, and two coordinate conversions.

React remains responsible for ordinary application chrome and sparse rich DOM overlays such as the one transient or pinned QDC card and the existing full Process Logic Gate modal. A placement-attached card is positioned from deck.gl projection, while the full modal stays in the shared modal layer; neither is a second canvas or map authority.

## Required deck.gl Layer Stack

Keep the layer count small and stable:

1. A non-pickable plain background/grid presentation.
2. Folder fence geometry using transparent polygon outlines.
3. Static cyan-to-blue operational trace geometry using orthogonal path segments below placements.
4. Folder, Process, and restricted placement bodies using cheap GPU geometry or icons.
5. Labels using `TextLayer` only in detail bands that can display them legibly.
6. One small untiled edit overlay for the selected or actively dragged placement, anchors, resize handles, connection preview, selected trace, and route waypoints.

Every deck.gl `PathLayer` in this stack must explicitly declare two-coordinate Cartesian XY positions. Folder fences, Process and restricted outlines, saved and selected traces, connection previews, and selected Folder fences must never depend on deck.gl's default three-coordinate format or invent a business Z coordinate.

The selected or edited entity is hoisted into the untiled edit overlay and suppressed from ordinary tiled picking while the edit is active. This prevents duplicated tile fragments from creating duplicate drag, resize, selection, or save behavior.

All accessible placements remain GPU-pickable when their current detail band presents an interaction target. Restricted placeholders are never pickable or interactive.

## Spatial Tiles Are Invisible Transport Only

Use deck.gl `TileLayer` for the Google-Earth-style spatial selection, request scheduling, bounded caching, and parent-to-child refinement hook. Mango owns the authoritative settled generation and cancellation lifecycle; deck.gl's per-tile signal is one cancellation input, not the complete cancellation contract.

The tile pyramid is a derived spatial transport index over company-world coordinates. It is not stored Process Map hierarchy, not Folder containment, not Explorer hierarchy, not an operational relationship, and not a new business identity. Do not add a tile registry, copied resource record, translated resource identity, or tile-membership authority.

One tile request returns the permission-safe representation for its integer zoom level and x/y region. Because deck.gl keeps the same integer tile z across a range of fractional camera zooms, the response is a conservative presentation superset sufficient for every LOD that each returned object can reach anywhere inside that integer zoom interval. The client chooses the exact settled representation from projected screen pixels. Fractional zoom therefore does not create another request or cache key, and the tile does not fetch full business detail early. `renderSubLayers` creates the Folder, trace, placement, and text sublayers for that tile.

- Coarse tiles contain cheap Folder fences, simplified trace geometry, and one visible presence mark for every displayable placement represented by that tile.
- Middle-detail tiles add readable shapes and labels.
- Fine-detail tiles add the current full Process Map card presentation and editing targets.
- Tile representations always use the same canonical placement and relationship identities; a detail representation is not a copied business entity.
- Folder fences and traces intersecting tile boundaries are clipped into deterministic tile fragments or returned with stable identities and deterministic deduplication.
- Tile cache keys are viewer-, permission-, company-read-version-, and tile-coordinate-safe. Tile ETags additionally include the response-contract version. A code-only tile representation change must advance that response contract so an older cached body cannot be reused through `304`.

Use a transparent-vector-safe refinement function through deck.gl's supported refinement hook. When suitable coarse coverage is already loaded, keep the nearest loaded covering ancestor visible until every selected replacement needed for that covered region is ready. Then hide the ancestor and reveal the complete replacement coverage together. A parent and child representation of the same business identity must never both be pickable or produce duplicate edits. Initial loading may show the plain canvas until the first coarse response exists, but a transition between already loaded and requested levels must not flash blank. Failed finer requests keep valid coarse coverage visible and expose the existing bounded error/retry treatment without polling.

## Detail Is Chosen by Screen Size

LOD is based on projected screen pixels, not Explorer depth, map-parent depth, a selected Folder, or a hard-coded semantic level.

The same placement may use a different representation from another placement at the same camera zoom when their world dimensions project to different screen sizes.

The required settled bands are:

- Whole-company detail: every displayable Process contributes a stable green-cued cheap mark, every displayable Folder keeps a perceptible orange fence, and static operational traces remain perceptible. The initial fit has no selection, QDC card, anchors, resize grips, waypoints, or editing controls; retained pinned-card behavior remains governed by its existing law after user interaction.
- Normal map detail: full neutral Process shapes with green outlines, transparent orange Folder fences, readable names, and static traces appear.
- Editing detail: the same shapes remain visible and the selected placement adds its distinct input/output anchors or resize grips, trace route points, hover behavior, pinned QDC card behavior, Process modal launch behavior, and current editing affordances.

Do not invent extra operational summary data merely to fill a zoom band. Current source names and existing UI facts are enough until a separate product requirement adds another canonical fact.

Several placements occupying the exact same screen pixel cannot be individually distinguished by any renderer. They must still contribute to the rendered result and become individually distinguishable after zooming; do not silently discard one placement through collision filtering.

## Camera Settlement Is a Hard Loading Boundary

The live camera may transform already loaded GPU buffers on every animation frame, but Mango must not evaluate a new business detail band or begin a new viewport/tile data load for every wheel event.

Use deck.gl view and interaction callbacks plus an application-owned quiet-period timer so new LOD and data work begins only after dragging, panning, zooming, and camera transition have all ended. Every view change restarts the timer. The interaction callback must also drive completion because pointer release may change interaction state without another view change. Timer expiry commits one settled generation only when all interaction flags remain inactive; otherwise the later all-inactive callback settles after any remaining quiet time. Wheel ticks therefore cannot each become a settled load, and a drag release cannot leave the final view permanently unsettled.

The camera may continuously update deck.gl's internal viewport and candidate bookkeeping. That internal graphics work is not permissioned business loading. Mango-owned detail-band changes and HTTP scene/tile reads remain behind the committed settled generation. Interim tile candidates are discarded or held without starting network reads, and `debounceTime` is not the authority for declaring settlement.

On settlement:

1. Capture the final view state.
2. Determine the final visible tile set and screen-space detail needs.
3. Abort obsolete requests that no longer have a consumer through Mango's generation AbortController and the tile's deck.gl signal.
4. Reuse valid cached tiles and in-flight identical reads.
5. Request only missing final tiles.
6. Keep valid covering coarse tiles visible through the transparent-vector-safe refinement rule until complete replacements arrive.
7. Ignore stale completions from an older settled viewport.

No polling is permitted.

## Backend Read Contract

Replace the old exact root-or-Folder layer read with a company scene plus spatial tile contract. Do not keep both read models alive.

```http
GET /v1/process-map/scene?company_id={company_id}
GET /v1/process-map/tiles/{z}/{x}/{y}?company_id={company_id}
```

The scene response contains only permission-safe camera and tile metadata required to initialize the canvas, including the current display bounds and tile/read version. It is not a whole-company business graph or copied Explorer tree.

The tile response contains only the placements, clipped trace geometry, labels, and presentation fields needed for that tile's LOD. It must never return full Process documents, Node data, QDC history, email data, tasks, attachments, the complete Company Explorer tree, or generic relationship graphs.

Existing exact mutation meanings remain:

```http
PUT    /v1/process-map/placements/{resource_type}/{resource_id}
DELETE /v1/process-map/placements/{resource_type}/{resource_id}
POST   /v1/process-map/operational-relationships
PUT    /v1/process-map/operational-relationships/{relationship_id}/trace
DELETE /v1/process-map/operational-relationships/{relationship_id}
GET    /v1/process-map/operational-relationships
```

Placement writes include map parent, global integer position, and integer dimensions. Folder group moves commit the Folder and every recursively contained placement translation atomically, including the same translation for route points whose two endpoints are both in the moved set. A trace route continues to be saved as one bounded ordered JSON array of intermediate company-world grid points.

Every changed placement and translated trace advances its own revision and update timestamp exactly once. The one committed group-move response returns the complete changed placement and trace rows plus the new company Process Map read version. The initiating client patches those committed rows into the edit overlay and invalidates affected tile coverage; it does not guess the committed group result or wait for its own realtime echo.

All HTTP and store calls must propagate the request context so abandoned tile and scene reads cancel through PostgreSQL. Mango combines its settled-generation cancellation with deck.gl's per-tile signal for browser fetches, rejects stale completions, and does not assume TileLayer will abort every obsolete visible request. Do not use `context.Background()` for request-owned reads.

## Permission Boundary

Every scene read, tile read, pick result, and mutation uses the current Mango permission system.

An accessible placement may expose its exact typed canonical identity, current source name, presentation geometry, and edit capability.

An inaccessible mapped placement may expose only one uniform restricted `?` placeholder with permission-safe position. It exposes no canonical ID, type, real dimensions, name, contents, metadata, anchors, direction, route, neighboring endpoint, tile-stable identity, or interaction target.

An inaccessible Folder fence is sealed for Process Map presentation: its actual perimeter and descendant map structure are not returned. Its placeholder does not grant access to or describe descendants. Incident operational relationships and traces are omitted whenever either endpoint is inaccessible.

Moving a Folder is one group geometry mutation. It requires Edit access to the Folder and every recursively map-contained placement that would move. The server locks and revalidates the complete set and permission fence, then commits every translation exactly once or changes nothing. If a hidden or revoked descendant prevents the command, the rejection must not identify that descendant.

Removing a mapped Folder placement is also a group containment mutation when it has direct map children. A user-initiated placement removal requires Edit access to the Folder, every direct child whose map parent will change, and the destination Folder when the children will be reparented to one. The server locks and revalidates the whole affected set and changes nothing on denial. Permanent source-Folder deletion is the narrow lifecycle exception: after the canonical delete command is authorized, system cleanup may reparent surviving map children without granting the actor new access and without disclosing hidden identities.

Tile boundaries, cache reuse, parent refinement, stable feature handling, and realtime invalidation must never allow one viewer's accessible representation to satisfy another viewer's restricted request. Permission, membership, actor, or permission-generation invalidation must synchronously remove the affected protected geometry from the rendered layer set and dispose the old permission-scoped scene/tile cache before any replacement read. Visual continuity may retain coarse tiles across an ordinary same-permission content refresh, but it must never retain newly forbidden geometry.

## Placement and Editing Behavior

Reuse the existing exact-resource Company Explorer drag payload. Do not create another resource identity or drag format.

The fixed left placement tray locates authorized Folders and Processes, while the one Process Map header's shared Universal picker remains locked to authorized Processes. Expanded, the tray shows `Root Folders` or the current Folder, a simple back treatment, `Drag to place`, one internally scrolling Explorer-style list, warm orange Folder cards, and green Process cards using the existing Explorer icons. A Folder card is one unified row: dragging emits the exact existing Explorer payload, while clicking browses that authorized branch without placing it. A Process card uses the existing Logic Gate identity under the product name Process and has no second category. The expanded control points left; the collapsed tray is one genuinely narrow tab whose control points right. The browser-local collapsed preference remains local, and a collapsed tray performs no candidate reads.

Explorer branch membership is only candidate organization. It never chooses the map parent. Branch browsing must reuse existing bounded permission-safe root-or-child reads, clear stale rows while the next branch loads, and must not download the entire Explorer tree or add a candidate API.

On drop or drag stop:

1. Convert the pointer through the one deck.gl OrthographicView into company-world grid coordinates.
2. Snap position and dimensions to the smallest grid.
3. Identify and visibly highlight the deepest eligible mapped Folder fence under the final placement.
4. Reject self-parenting and Folder cycles.
5. Save the chosen map parent and geometry once, at gesture completion.
6. Apply the committed response to the edit overlay and affected tiles.

Do not save on every pointer move. Failed writes restore the last committed geometry. A delayed response from an older drag, resize, trace edit, tile read, permission state, or realtime generation must never overwrite newer canonical state.

## Operational Traces

Operational traces may connect any two accessible mapped Folders or Processes in the same company, regardless of Explorer parent or Process Map parent.

The existing four endpoint combinations remain valid:

- Folder to Folder;
- Folder to Process;
- Process to Folder;
- Process to Process.

Every accessible placement has exactly one presentation-defined input anchor and output anchor derived from its current global bounds. Anchor locations are not saved columns.

Selecting an accessible placement at editing detail reveals only its left input and right output. Starting at the output keeps that source output visible, reveals and clearly highlights only distinct eligible target inputs, and draws one static orthogonal cyan-to-blue preview. Dropping on or reasonably near a valid target input creates or selects the canonical directed operational relationship and trace. Completion, invalid drop, Escape, camera change, and permission change clear the connection gesture, temporary anchors, target highlights, and source selection.

The trace route stores only ordered intermediate global integer grid points. Endpoint coordinates remain derived. Trace tiles clip the canonical route for rendering without rewriting it.

Changing a placement's map parent, position, or dimensions preserves the operational relationship and its saved trace. Moving endpoints changes their derived anchor positions. Removing a placement may remove its saved incident trace geometry while preserving the underlying operational relationship. Permanently deleting an endpoint removes its placement, incident operational relationships, and dependent traces through the existing exact-identity lifecycle.

The current trace creation, pairwise fan-out/fan-in, shared explicit route points, selection, waypoint editing, idempotence, revision, timestamp, and relationship-delete behavior remain in force. Saved traces and pending previews are static cyan-to-blue paths. The standalone moving flow markers, animation timer, and phase state are deleted and are not replaced by another animation.

## Realtime, Cache, and Mutation Reconciliation

Continue using the one company `process-map:company` realtime doorbell and the one shared outbox/backplane system.

A successful mutation updates the initiating edit overlay from its committed HTTP response and does not echo a redundant reload to that exact originating connection. Every other current company connection receives one compact permission-safe `process_map.changed` invalidation.

The invalidation contains no placement, identity, endpoint, relationship, trace, route, tile, or geometry payload. This scope-only doorbell exception does not weaken durable relationship events, which retain the exact typed source and target identities required for audit and projection consumers. The client advances its company scene/tile generation, invalidates affected cached reads, and performs one coalesced read for the currently settled viewport. It does not reload an obsolete Folder layer and does not poll.

Source-name, Explorer organization, permission, group, membership, recycle, restore, and permanent-delete changes continue to invalidate every affected viewer through the current validation fence and viewer-safe ETag rules.

## Deletion, Recycle, and Restore

Recycle payloads for Process Map placements must preserve map parent, global position, dimensions, revision, and timestamps. Trace payloads preserve global route points and the exact operational relationship identity.

Restore order remains:

```text
source resources
operational relationships
placements
traces
```

Restoring an older payload never overwrites a newer live placement or trace. Restoring a placement whose map parent is absent skips it until a later independent restore provides the exact mapped Folder dependency. Tile membership is always derived after restore and is never stored in recycle payloads.

Deleting a mapped Folder may leave its direct map children alive after cleanup reparents them. The recycle payload records each such child's pre-delete parent plus the exact revision produced by cleanup. Restore may put that live child back under the restored Folder only with a compare-and-swap proving that its placement still has the cleanup-produced revision and geometry. That conditional reparent advances the child revision. Any intervening user move, resize, reparent, removal, or recreation makes the comparison fail, so newer live state wins without being overwritten.

## One-Time Forward Geometry Migration

The forward geometry work has two ordered append-only data steps. The existing V3 migration converts separate-layer coordinates into one global coordinate system. The approved correction then compacts the complete shared geometry so the initial company fit is not dominated by huge empty gaps, oversized migrated regions, or distant outliers. Neither step is a runtime compatibility reader, an ongoing layout feature, or a user command.

Use only existing Process Map parentage. Do not consult Company Explorer hierarchy.

1. Give every legacy Process a starting size of seven by five grid squares. Give every empty legacy Folder the same minimum starting size. These are migration defaults and remain manually resizable afterward.
2. Compute Folder subtree bounds bottom-up. Each nonempty Folder gets exactly one grid square of interior padding on every side and a size of `max(7, child_span_width + 2)` by `max(5, child_span_height + 2)`, using each immediate child's migrated bounds at its legacy local coordinates.
3. Use every root placement's legacy `grid_x` and `grid_y` only as the intermediate global top-left anchor for flattening. A widely spaced legacy root anchor is not protected final geometry.
4. For a Folder layer whose immediate child bounds begin at legacy local `min_x, min_y`, map each child to `folder_global_x + 1 + child_legacy_x - min_x` and `folder_global_y + 1 + child_legacy_y - min_y`. Apply this recursively. This preserves the relative layout inside every old layer while fitting it inside the new Folder fence.
5. Translate every legacy trace route point by the same layer-to-global offset as its endpoints' old layer. Root trace points keep their existing coordinates.
6. Preserve canonical resource, placement, relationship, and trace IDs and creation timestamps. Advance every transformed placement or trace revision and update timestamp exactly once, then advance the company Process Map read version.
7. Allow resulting sibling Folder fences and cards to overlap. The flattening step does not invent collision repair.

The migration preflight must reject cycles, missing or cross-company map parents, a trace whose endpoints do not share its legacy layer, coordinate overflow, or any other row that cannot be converted deterministically. It must not partially convert a company. After success, the legacy exact-layer interpretation and read route are deleted; there is no fallback.

The append-only compaction applies one small deterministic transform per company after flattening:

1. Build separate X and Y coordinate sets from every live placement edge, every saved trace route point, and the equivalent placement, trace, and cleanup-comparison geometry in that company's recycle payloads.
2. Sort each unique coordinate set. Map its first coordinate to zero, then map every next coordinate by adding `min(old_gap, 12)`. The resulting mapping is strictly increasing and independent of row order.
3. Apply that one company-axis mapping to both edges of every placement and derive its new positive position, width, and height. Apply it to every trace route point and equivalent recycle geometry. This preserves ordering, valid Folder containment, orthogonal route topology, shared route junctions, exact identities, map parentage, and company isolation while reconnecting routes to the moved endpoint bounds.
4. Keep recycle cleanup compare-and-swap protection exact: transform a cleanup claim to the new expected revision and geometry only when the matching live cleanup-produced state is still exact; otherwise leave the claim stale so it cannot overwrite newer work.
5. Preflight the complete company, including payload shape and numeric safety, then apply that company's live and recycled geometry atomically. Advance each transformed canonical placement or trace revision and update timestamp once and advance the company Process Map read version once. A failure changes nothing for that company.

After this migration, new placements remain manually positioned and no layout engine, cleanup/reset UI, compatibility path, or reusable compaction command remains.

## Complete Replacement Requirements

The implementation branch must deliver all of the following together:

- canonical schema plus the deterministic one-time forward flattening and append-only geometry compaction for global dimensions, coordinates, traces, recycle payloads, and any required spatial indexes;
- memory and PostgreSQL repository parity;
- company scene and permission-safe tile reads;
- deletion of the obsolete exact-layer read and Folder Process Map routes;
- one deck.gl OrthographicView and TileLayer renderer;
- plain white non-geographic background;
- initial whole-company camera fit;
- settled-only LOD and data loading;
- transparent-vector-safe coarse-to-fine refinement without transition blank flashes or duplicate picks;
- Folder fences, Processes, restricted placeholders, traces, labels, and edit overlay;
- placement drag, group move, resize, reparent, remove, and rollback;
- cross-Folder operational trace creation and route editing;
- existing QDC hover and pinned card behavior plus the existing shared Process Logic Gate modal behavior;
- permission, recycle, restore, realtime, ETag, and request cancellation correctness;
- removal of unused React Flow Process Map code and dependency when nothing else uses it;
- updated numbered laws and focused tests;
- full repository verification.

There is no compatibility read, dual renderer, legacy Folder layer, temporary second authority, feature-flagged half-product, or follow-up implementation bucket.

## Required Tests

Backend and database coverage must prove:

- placement global position and dimensions round-trip and validate;
- legacy layers, nested relative layout, Folder fence bounds, and trace routes convert deterministically to global geometry, then strict coordinate-gap compaction produces the same compact result independent of row order while invalid input fails without partial conversion;
- compaction preserves exact placement, parent, relationship, trace, and company identities, valid containment, orthogonal route topology, revision/read-version rules, and recycle cleanup compare-and-swap safety;
- root accepts both supported resource types;
- map parent uses only mapped Folders and remains independent from Explorer;
- cycles, missing parents, and cross-company parents fail atomically;
- Folder group movement translates every recursive placement and every wholly internal trace route exactly once while leaving one-ended external route points fixed;
- moving or reparenting preserves relationships and traces;
- cross-map-parent traces save and load;
- scene bounds are viewer-safe;
- tile membership, clipping, stable identity, integer-z conservative LOD payload, fractional-zoom client selection, ETag, and permission projection are deterministic;
- restricted Folder descendants and incident traces do not leak;
- request cancellation reaches the database;
- realtime invalidation and recycle/restore remain complete.

Frontend coverage must prove:

- the initial route opens one company canvas, fits all authorized map bounds once, and starts without selection, QDC cards, anchors, resize grips, waypoints, or editing controls;
- the renderer uses OrthographicView with no geographic map or second camera;
- zoom targets camera center and never navigates;
- LOD and data work do not run on individual wheel updates and run once after settlement;
- coarse geometry remains until detailed tiles are ready;
- every displayable Process keeps a green cue, every displayable Folder keeps an orange fence, and static traces remain visible at whole-company detail;
- every Process Map `PathLayer` explicitly declares XY positions and supplies valid two-coordinate paths for Folder fences, Process and restricted outlines, saved and selected traces, connection previews, and selected Folder fences;
- Folder fences are transparent, colored, resizable, and valid drop targets;
- candidate Explorer hierarchy does not choose map containment;
- drag, move, group move, resize, reparent, selection, distinct anchors and resize grips, static traces, waypoints, QDC cards, Process modal open/close, and failure rollback work;
- the expanded and collapsed Explorer-style tray, collapsed-read suppression, Folder browse-versus-drag behavior, exact Explorer payload, and internal scrolling work;
- connection previews and eligible target inputs remain visible, near-target drops commit the canonical relationship and trace, and completion, invalid drop, cancellation, camera change, and permission change clear every temporary connection control;
- every group-move response contains all committed placement and trace revisions required for immediate reconciliation;
- restricted placeholders leak nothing and are noninteractive;
- Folder removal authorizes every user-mutated child while lifecycle cleanup remains permission-safe, and recycle restore reclaims only cleanup-unchanged children;
- stale tile, mutation, permission, realtime, and gesture results cannot replace newer state;
- moving trace markers, animation phase state, and trace animation timers are absent;
- the old React Flow renderer, Folder routes, breadcrumbs, and exact-layer requests are absent.

Performance verification must use representative large company fixtures and record initial scene bytes, tile bytes, request count, request cancellation, settled-load count, GPU frame behavior during pan/zoom, label cost, picking cost, cache size, and memory. Correctness cannot be traded away to hit a synthetic frame number.

LOD pixel thresholds, initial drop sizes, tile size, tile cache byte limit, maximum concurrent reads, settlement delay, and safe company-world coordinate bounds are implementation constants, not product phases or new business authorities. The worker must choose one tested set from representative fixtures, keep the constants together near the Process Map implementation, and document why the chosen bounds cover whole-company fit through editing detail. The old static `0.2` to `2.5` camera range must not survive merely because it exists today.

## Rejected Directions

- Do not use OpenLayers, a basemap, or a globe. They do not supply Mango's business hierarchy, and geographic presentation is not wanted.
- Do not retain React Flow under or beside deck.gl. The explicit V3 decision is one deck.gl camera and renderer.
- Do not turn Company Explorer hierarchy into the tile pyramid or viewing hierarchy.
- Do not force the company canvas into a semantic quadtree. The quadtree is only an invisible spatial transport index.
- Do not route into a Folder or make selection trigger loading. Camera settlement and visible spatial detail trigger loading.
- Do not add operational summaries, textboxes, annotations, ongoing or user-invoked automatic layout, a minimap, or speculative generic canvas infrastructure.

There are no unresolved product choices blocking the implementation. Sensible numeric thresholds are benchmarked implementation details; changing the authorities or behaviors in this document requires a new explicit product decision and matching law updates.

## Definition of Done

V3 is done only when one local branch contains the complete continuous deck.gl Process Map; every numbered law agrees with it; the old layer renderer and read path are deleted; all existing editing and lifecycle behavior still works; the full repository verification gate passes; and the worktree is ready for explicit human-reviewed integration.

## Primary Implementation Files

Existing feature boundaries expected to change:

```text
backend/db/schema.sql
backend/db/migrations/*process_map*.sql
backend/internal/domain/process_map.go
backend/internal/store/process_map.go
backend/internal/store/postgres_process_map.go
backend/internal/store/memory_process_map.go
backend/internal/http/process_map_handlers.go
frontend/package.json
frontend/package-lock.json
frontend/src/pages/process-map/ProcessMapPage.tsx
frontend/src/modules/process-map/ProcessMapSurface.tsx
frontend/src/modules/process-map/processMapApi.ts
frontend/src/modules/process-map/processMapGeometry.ts
frontend/src/modules/process-map/processMapInteraction.ts
frontend/src/modules/process-map/processMap.css
tests/frontend/modules/process-map/*
backend/internal/http/process_map_handlers_test.go
backend/internal/store/*process_map*_test.go
```

Touch shared routing, realtime, permission, recycle, Explorer drag, or test-runner files only where the complete replacement requires it. Do not create a generic Mango canvas framework, generic resource registry, generic tile registry, or a second graph service.

## Primary External References

- [deck.gl OrthographicView](https://deck.gl/docs/api-reference/core/orthographic-view)
- [deck.gl TileLayer](https://deck.gl/docs/api-reference/geo-layers/tile-layer)
- [deck.gl Deck interaction callbacks](https://deck.gl/docs/api-reference/core/deck)
- [deck.gl interactivity](https://deck.gl/docs/developer-guide/interactivity)
- [deck.gl PolygonLayer](https://deck.gl/docs/api-reference/layers/polygon-layer)
- [deck.gl PathLayer](https://deck.gl/docs/api-reference/layers/path-layer)
- [deck.gl TextLayer](https://deck.gl/docs/api-reference/layers/text-layer)
- [deck.gl performance guidance](https://deck.gl/docs/developer-guide/performance)
- [Google KML Regions and screen-space LOD](https://developers.google.com/kml/documentation/regions)

Last updated: August 26, 2026
