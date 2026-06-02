# Syncing Layer V1

## Purpose

MangoRTS needs a projection-first live-update architecture to stop GET storms, broad workspace snapshot refetches, and repetitive backend work after POST/PUT requests.

The target workflow is:

```text
POST/PUT writes one or more source-of-truth records ->
syncing/projection layer determines the affected projection rows ->
syncing layer applies precise upsert/delete/patch changes to projection tables ->
find active subscribers whose scope matches ->
permission-check those specific users->
committed projection deltas are streamed live to the frontend ->
UI updates in place without refresh
```

This is an eventual-consistency model. Stale projection reads are acceptable. The UI should become fresh through live projection deltas once projection syncing finishes.

## Hard Rules

- Hot, repeated, user-visible reads should come from projection tables.
- Rare admin/debug/deep-detail reads may join source tables if documented.
- GETs should read projection tables and may return stale data.
- Stale projection reads are acceptable.
- POST/PUT should write source-of-truth data and return fast.
- Do not make POST/PUT wait for projection freshness just to avoid stale GETs.
- Do not reread projection tables or large UI-shaped aggregates inside POST/PUT just to return fresh UI data.
- Frontend freshness comes from committed projection delta events, not broad refetches.
- Do not solve this with read-after-write consistency.
- Do not solve this with `event received -> refetch /v1/workspace/snapshot`.
- Refetch is only a fallback for sequence gaps, unknown delta types, corrupted local state, or explicit user refresh.
- Hot reads need sufficiently wide projection tables so they avoid repeated joins across source-of-truth tables.

## Delivery Decision

Do not implement a transactional outbox for V1.

Projection delta delivery is best-effort, not durable. If a committed projection change is missed because of process crash, deploy, stream disconnect, or network loss, recovery is targeted projection refetch or explicit user refresh.

Live deltas are a latency optimization over projection GETs. Projection tables remain the current UI read source.

## Sequencing

Use a cheap company-scoped projection sequence/cursor.

Do not use one global app-wide sequence.

Each projection delta or delta batch should include:

- `company_id`
- `projection_sequence`
- projection name
- operation: `upsert`, `delete`, or `patch`
- projection row key
- row payload for `upsert`/`patch`
- committed/projected timestamp

Clients should ignore stale/out-of-order deltas when their local row has a newer sequence.

If the client detects a sequence gap, it should targeted-refetch only the affected current projection surface, not `/v1/workspace/snapshot`.

## Security And Fanout

Projection deltas are user-visible data and must be permission-safe.

Never broadcast raw projection rows to every user in a company.

Live stream delivery must be scope-based and permission-filtered:

```text
projection delta happens ->
find matching active subscribers by company/projection/scope ->
permission-check those matched active users ->
send the delta only to authorized subscribers
```

Only currently connected browser tabs receive live deltas. Offline users do not need live deltas; when they open the page later, they GET from projection tables.

Each tab/subscriber should subscribe to a specific scope, for example:

- `company_id`
- projection name
- `logic_gate_id`, `node_id`, `board_id`, `user_id`, or another relevant scope key

If nobody is subscribed to the affected scope, do no fanout work.

Permission/source-of-truth changes must produce projection updates and live delete/patch deltas where needed. If a user loses access to a row currently visible in the UI, the UI must receive a delete/removal delta when that user is actively subscribed.

## Batching

Batch projection deltas per source command/projection sync whenever practical.

Do not create a new event storm while fixing GET storms.

Example: creating a RACI matrix item may affect logic gate, node, kanban, RACI, permissions, and status projections. Prefer one compact projection delta batch describing all affected projection row changes.

Keep command/business/audit events separate from projection/UI replication deltas:

- Command event: `node moved`, `assignment changed`, `logic gate created`
- Projection delta: `this exact projection row changed/deleted`

The frontend should mostly consume projection deltas. It should not need to understand backend business logic to update visible rows.

## Existing Projection Surfaces

Known projection tables/surfaces to account for:

- `racio_matrix_projection_table`
- `kanban_board_projection`
- `node_projection_table`
- `logic_gate_projection_table`
- workspace/company explorer projections or projection-like reads
- graph/map projections or projection-like reads
- notification/user-visible projections

Future Codex instances should inventory actual GET handlers and store methods before editing, because some current reads may still join source-of-truth tables.

## Phase Tracker

### Phase 1: RACI Matrix

Status: implemented and reviewed for the first RACI matrix vertical slice.

Goal: make the RACI matrix path projection-first and live-update through scoped, permission-filtered projection deltas.

Primary focus:

- `racio_matrix_projection_table`
- RACI matrix create/move/update/delete flows
- matrix-related source-of-truth writes
- permission inheritance/revocation effects visible in the matrix
- frontend matrix state/cache delta application
- eliminating broad snapshot refetches and synchronous projection rereads in the matrix write path

Expected outputs:

- architecture doc updates if local details differ
- backend projection delta structs/types for RACI slice
- company-scoped projection sequence support
- best-effort post-commit live delta emission
- scoped stream subscription for active matrix viewers
- permission filtering before sending row data
- targeted matrix projection refetch fallback
- tests or focused verification around write timing and UI delta application

Completed in Phase 1:

- Added `company_projection_sequences` for company-scoped projection cursors.
- Added RACI projection delta structs and best-effort delta publishing for `racio_matrix_projection_table` changes.
- Removed synchronous `racio_projection_rows` response rereads from RACI matrix and assignment mutation response paths; command responses now return fast and omit fresh projection rows.
- Added a scoped projection SSE path on `/v1/workspace/stream?projection=racio_matrix`, keyed to active `user:<user_id>` matrix subscribers.
- Fanout considers only active company/projection/user-scope subscribers and checks effective access before sending row payloads.
- Added permission-change projection fanout for active RACI matrix subscribers by rereading only affected projection rows.
- Added targeted fallback GET `/v1/work-items/racio-matrix-projection` for the current/target matrix viewer.
- Added frontend subscription and handling for RACI projection `upsert`, `delete`, and `patch` envelopes.
- Added targeted frontend fallback refetch for sequence gaps, unknown/corrupt deltas, logic-gate role changes, and matrix view refresh.

Remaining or documented bottlenecks:

- Projection diff generation still uses targeted before/after projection-row reads around affected nodes or logic gates. This is much smaller than rereading full UI aggregates, but it remains synchronous projection work inside the write transaction.
- RACI projection rows do not carry full logic-gate RACI assignments, so frontend logic-gate role changes trigger targeted `racio-matrix-projection` plus `my-logic-gates` refetch instead of being fully patched from one row delta.
- Projection delta delivery is still best-effort and not durable by design; missed live deltas recover through targeted projection refetch.

Verification:

- `go test ./...`
- `npm.cmd run build` from `frontend/`
- `node scripts\run_all_tests.mjs`

Review notes after the local main merge:

- Backend tests, frontend production build, and the aggregate `node scripts\run_all_tests.mjs` verification passed after the merge.
- The Phase 1 schema addition is `company_projection_sequences`, added by `backend/db/migrations/20260602_racio_projection_sequences.sql`.
- RACI projection deltas are currently sequenced in the async publisher after the source/projection transaction has returned. This is acceptable for the first vertical slice, but it can misorder delayed older publishes behind newer writes. Before expanding the pattern broadly, prefer assigning projection ordering at projection-sync/commit time or adding row-level projection versions that the client can compare.
- RACI initial GET and projection SSE do not yet share a projection watermark. The existing stream cursor is still the workspace-domain-event `after_sequence`; the RACI projection sequence only appears inside projection event payloads. A missed final projection event can leave stale UI until targeted refetch or explicit refresh.
- Permission-change fanout exists, but Phase 2 should add or preserve an end-to-end test proving an actively subscribed user who loses access receives a delete/removal delta and no row payload leak.
- The current RACI GET and live delta auth use effective `edit` access for this work surface. If a future projection is merely visible/read-only, do not blindly reuse `edit`; choose the required access level for that surface.

### Phase 2: Kanban

Status: implemented for the Kanban board/card vertical slice.

Goal: apply the proven pattern to kanban board/card flows.

Primary focus:

- `kanban_board_projection`
- card move/create/update/delete
- logic-gate node assignment state changes
- issue toggles
- status/priority/assignee/due-date projection updates
- direct frontend card/column state replacement
- removing `/v1/workspace/snapshot` as the normal live-event reaction

Phase 2 must not broaden the implementation blindly. Start with one vertical path that includes the highest-value kanban actions:

- board read from `kanban_board_projection`
- card create/update/move/delete
- logic-gate node assignment state moves that affect kanban cards
- issue toggles
- status/priority/assignee/due-date changes shown on cards

Phase 2 should reuse shared RACI infrastructure only where it is sound:

- active subscriber fanout
- permission filtering before row payloads
- best-effort delivery
- company-scoped projection sequencing
- targeted refetch fallback

Phase 2 should also address or explicitly document the Phase 1 review risks:

- avoid assigning live-update ordering in a way that lets delayed older projection changes win over newer ones.
- decide whether kanban GET responses need a projection watermark for reliable initial GET plus stream handoff.
- add focused permission-revocation tests for live delete/removal deltas.
- keep access-level checks appropriate to kanban visibility and edit semantics.

Completed in Phase 2:

- Added Kanban projection delta support for `kanban_board`, reusing the shared projection delta envelope while keeping command/business events separate from UI replication deltas.
- Added targeted Kanban projection-row diff helpers that emit `upsert` and `delete` deltas from actual `kanban_board_projection` row changes.
- Extended `kanban_board_projection` hot card reads so rows/cards carry status/column, position, title, issue state, priority, assignee, due date, and projection timestamps without repeated source joins for the card list.
- Updated current Kanban card GETs to read projection cards directly and return a `projection_sequence` watermark for the Kanban GET plus stream handoff.
- Updated Kanban column/card handlers so normal card writes return mutation results without rereading large Logic Gate work/UI aggregates just to refresh the response.
- Emitted Kanban deltas for card create/update/move/delete, assignment state moves, issue toggles, and node-field changes that affect card title/status/priority/assignee/due-date display.
- Added a scoped `/v1/workspace/stream?projection=kanban_board&kanban_board_id=<board_id>` subscription keyed to active `board:<board_id>|user:<user_id>` subscribers.
- Scoped Kanban fanout to active subscribers for the affected board, not every company user.
- Permission-filtered Kanban row payloads with effective `view` access checks on both the logic gate and node. Unauthorized active subscribers receive delete deltas without row payloads.
- Added permission-change Kanban fanout so active users who lose access to a node or logic gate receive removal/delete deltas.
- Added frontend Kanban projection-delta application for `upsert`, `delete`, and `patch`, including local card replacement/removal and card metadata updates for status/person/priority/due-date grouping.
- Stopped normal Kanban workspace command events from driving active-board card refetch/replacement; projection deltas are now the normal freshness path.
- Added targeted Kanban board-content refetch fallback for projection sequence gaps, unknown/corrupt deltas, missing row keys, missing rows, missing local patch targets, or explicit refresh. This refetch uses Kanban board contents, not `/v1/workspace/snapshot`.
- Added row-version stale suppression on the frontend using row/patch `projection_updated_timestamp` first, with delta timestamps only as a fallback when no row version exists, so delayed older Kanban deltas cannot overwrite newer local card state even though shared projection sequences are still allocated in the async publisher.
- Added focused backend tests for active-board scoped fanout, permission filtering, and permission revocation delete deltas with no row payload leak.
- Added focused frontend tests for Kanban projection row-to-card conversion, upsert/delete/patch application, stale delta suppression, and targeted fallback behavior.

Remaining or documented bottlenecks:

- Shared projection sequence allocation still happens in the async publisher. Kanban mitigates stale overwrites with row-level projection timestamps on the client, but commit-time projection sequencing remains a better shared contract for later phases.
- Kanban card GETs now expose a projection watermark, and the active board cache carries it into the stream handoff. Legacy Logic Gate Arena reads can still prime card state without a Kanban projection watermark; explicit refresh or a targeted board-content refetch remains the recovery path there.
- Projection diff generation still uses targeted before/after projection-row reads around affected nodes or logic gates. This avoids large UI aggregate rereads but is still synchronous projection work near source writes.
- The frontend still marks old workspace snapshot scopes stale after some local Kanban commands for compatibility with existing caches. Normal live-update handling no longer calls `/v1/workspace/snapshot`, but the stale markers should be retired once remaining snapshot consumers move to projection reads.
- Some board/list and legacy arena surfaces remain outside the Phase 2 card-projection slice. Phase 3 should avoid treating those as solved by the Kanban card delta work.

Verification:

- `go test ./...` from `backend/`
- `node scripts\run_all_tests.mjs`
- `npm.cmd install` was needed first in `frontend/` because local frontend dependencies were absent.

### Phase 3: Editor And Explorer

Status: planned.

Goal: apply the pattern to editor content and explorer-visible surfaces.

Primary focus:

- `node_projection_table`
- `logic_gate_projection_table`
- editor text/block current-value projections
- company explorer folder/item visible projections
- graph/map projection-like reads if hot
- live delete/removal behavior for permission revocation

## Acceptance Criteria

- POST/PUT writes source-of-truth records without depending on fresh projections.
- POST/PUT does not synchronously reread large projection/UI aggregates just to return fresh UI state.
- Projection sync updates only the affected projection rows.
- Projection row changes create best-effort committed projection deltas with company-scoped sequencing.
- Live stream sends deltas only to matching active subscribers after permission checks.
- Unauthorized users never receive projection row data.
- Permission revocation can remove visible rows through delete/removal deltas.
- UI applies deltas without page refresh and without broad GET storms.
- Sequence gaps trigger targeted projection refetch, not `/v1/workspace/snapshot`.
- Hot GETs primarily read projection tables, not large source-of-truth joins.
- Request timing logs show reduced duplicate rereads and reduced synchronous projection work in POST/PUT paths.

## First Codex Prompt: Phase 1 RACI Matrix

```text
We are implementing Phase 1 of Syncing Layer V1 for MangoRTS. Read `docs/important tasks/syncing-layer-v1.md` first and follow it as the source of truth.

Goal:
Implement the first vertical slice of the projection-first live-update architecture for the RACI matrix path.

Hard workflow:

POST/PUT writes one or more source-of-truth records ->
syncing/projection layer determines the affected projection rows ->
syncing layer applies precise upsert/delete/patch changes to projection tables ->
committed projection deltas are streamed live to the frontend ->
UI updates in place without refresh

Important decisions:

- Do not implement a transactional outbox.
- Projection delta delivery is best-effort.
- Keep company-scoped projection sequencing.
- POST/PUT should return fast and should not synchronously reread large projection/UI aggregates just to return fresh UI state.
- Stale projection GETs are acceptable.
- Frontend freshness should come from live projection deltas.
- Do not use broad `/v1/workspace/snapshot` refetch as the normal live-update mechanism.
- Live delta delivery must be scope-based and permission-filtered.
- Only active subscribers for the affected company/projection/scope should be considered.
- Permission-check matched active users before sending projection row data.

Phase 1 scope:

- Focus on `racio_matrix_projection_table`.
- Audit RACI/matrix create, move, update, delete, and permission-related paths.
- Identify where matrix writes do repeated source/projection work or reread UI aggregates.
- Emit best-effort RACI projection deltas when RACI projection rows actually change.
- Add or reuse company-scoped projection sequence support.
- Stream RACI projection deltas to actively subscribed, authorized matrix viewers.
- Add frontend handling so matrix rows update via `upsert`, `delete`, or `patch` deltas.
- Add targeted matrix projection refetch fallback for sequence gaps, unknown delta types, corrupted local state, or explicit refresh.

Implementation guidance:

1. Inventory current backend RACI matrix handlers, store methods, projection sync functions, and frontend consumers before editing.
2. Prefer reusing the existing workspace SSE infrastructure if it is a good fit.
3. Keep command/business/audit events separate from projection/UI replication deltas.
4. Batch projection deltas per source command/projection sync when practical.
5. Do not attempt Phase 2 Kanban or Phase 3 Editor/Explorer in this pass unless a tiny shared helper is clearly necessary.
6. Add focused tests or verification proving:
   - POST/PUT does not depend on fresh projected UI state.
   - affected `racio_matrix_projection_table` rows sync correctly.
   - emitted deltas are company-scoped, sequenced, and permission-safe.
   - frontend applies deltas without broad workspace snapshot refetch.
   - sequence gap fallback does targeted matrix refetch only.

Acceptance criteria:

- RACI matrix visible state can update live from projection deltas without page refresh.
- Unauthorized subscribers do not receive RACI projection row data.
- Active subscriber fanout is scoped; the backend does not check every company user.
- RACI write path timing shows reduced duplicate rereads or a clear documented list of remaining bottlenecks.
- `docs/important tasks/syncing-layer-v1.md` Phase 1 status is updated with what was completed and what remains.
```

## Second Codex Prompt: Phase 2 Kanban

```text
We are implementing Phase 2 of Syncing Layer V1 for MangoRTS. Read `docs/important tasks/syncing-layer-v1.md` first and follow it as the source of truth.

Goal:
Apply the projection-first live-update pattern to the Kanban vertical slice without reintroducing GET storms or broad workspace snapshot refetches.

Hard workflow:

POST/PUT writes one or more source-of-truth records ->
syncing/projection layer determines the affected kanban projection rows ->
syncing layer applies precise upsert/delete/patch changes to kanban projection tables ->
matching active subscribers are found by company/projection/scope ->
matched users are permission-checked before row data is sent ->
committed projection deltas are streamed live to the frontend ->
Kanban UI updates in place without refresh

Important decisions:

- Do not implement a transactional outbox for V1.
- Projection delta delivery is best-effort.
- Keep company-scoped projection sequencing, but do not let delayed older publishes win over newer projection state. If the existing async sequence stamping is unsafe for Kanban, fix the shared sequencing/row-version contract before expanding it.
- POST/PUT should return fast and should not synchronously reread large projection/UI aggregates just to return fresh UI state.
- Stale projection GETs are acceptable.
- Frontend freshness should come from live projection deltas.
- Do not use broad `/v1/workspace/snapshot` refetch as the normal live-update mechanism.
- Live delta delivery must be scope-based and permission-filtered.
- Only active subscribers for the affected company/projection/scope should be considered.
- Permission-check matched active users before sending projection row data.

Phase 2 scope:

- Focus on `kanban_board_projection` and the current Kanban GET/write paths.
- Inventory Kanban backend handlers, store methods, projection sync functions, SSE consumers, and frontend caches before editing.
- Cover the highest-value Kanban actions first:
  - board read from projection
  - card create/update/move/delete
  - logic-gate node assignment state moves that affect kanban cards
  - issue toggles
  - status, priority, assignee, and due-date changes shown on cards
- Emit best-effort Kanban projection deltas when Kanban projection rows actually change.
- Stream Kanban projection deltas only to actively subscribed, authorized Kanban viewers.
- Add frontend handling so Kanban board/card state updates through `upsert`, `delete`, or `patch` deltas.
- Add targeted Kanban projection refetch fallback for sequence gaps, unknown delta types, corrupted local state, permission uncertainty, or explicit refresh.
- Do not attempt Phase 3 Editor/Explorer in this pass unless a tiny shared helper is clearly necessary.

Carry-forward Phase 1 review risks to handle or explicitly document:

1. Projection sequence ordering:
   RACI currently allocates projection sequence inside async publish. For Kanban, make sure stale delayed deltas cannot overwrite newer UI state. Prefer commit-time ordering or row-level projection versions if needed.
2. Initial GET plus stream handoff:
   Decide whether Kanban projection GET responses need a projection watermark. If not implemented, document the exact best-effort behavior and fallback.
3. Permission revocation:
   Add focused tests proving an actively subscribed user who loses Kanban access receives a delete/removal delta and no row payload leak.
4. Access level:
   Use the correct effective access level for Kanban visibility. Do not blindly copy RACI's `edit` access if Kanban read visibility should be `view`.

Implementation guidance:

1. Start by mapping current Kanban GETs and mutation paths. Identify any `/v1/workspace/snapshot` fallback or broad refetch behavior triggered by Kanban events.
2. Reuse the existing workspace SSE infrastructure only if it remains scoped and does not create duplicate streams or tab-hidden GET spam.
3. Keep command/business/audit events separate from projection/UI replication deltas.
4. Batch Kanban projection deltas per source command/projection sync when practical.
5. Keep the projection rows sufficiently wide for hot Kanban reads so the board does not repeatedly join source tables.
6. Add focused tests proving:
   - POST/PUT does not depend on fresh projected UI state.
   - affected Kanban projection rows sync correctly.
   - emitted deltas are company-scoped, sequenced, and permission-safe.
   - permission revocation sends delete/removal deltas to active authorized scopes.
   - frontend applies Kanban deltas without broad workspace snapshot refetch.
   - sequence gap fallback does targeted Kanban projection refetch only.

Acceptance criteria:

- Kanban visible state can update live from projection deltas without page refresh.
- Unauthorized subscribers do not receive Kanban projection row data.
- Active subscriber fanout is scoped; the backend does not check every company user.
- Kanban write paths avoid synchronous large projection/UI aggregate rereads.
- Normal Kanban live-update handling does not call `/v1/workspace/snapshot`.
- Targeted fallback refetch is limited to the affected Kanban projection surface.
- Request timing logs show reduced duplicate rereads and reduced synchronous projection work in Kanban POST/PUT paths, or the remaining bottlenecks are documented in this file.
- `docs/important tasks/syncing-layer-v1.md` Phase 2 status is updated with what was completed and what remains.
```
