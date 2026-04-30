# Test Strategy and Canonical Test Inventory

## 🚨 MANDATORY TEST POLICY FOR ALL FUTURE CHANGES (HUMANS + LLM AGENTS)

This repository follows a strict rule:

1. **Every behavior change must ship with tests, or an explicit written reason why tests are temporarily blocked.**
2. **Every new test must be added to this document's inventory sections.**
3. **Every code change touching runtime behavior must update this file in the same commit/PR.**
4. **Future LLM instances must automatically create/update tests and automatically update this file.**

If you changed behavior and did not add/update tests + update this doc, the change is incomplete.

---

## Why this file exists

- We need one canonical place that lists **every test suite and test type** in the repo.
- We need one command that can be run manually before merge/deploy to show pass/fail across the app.
- We need platform-safe test execution (Windows/macOS/Linux) wherever possible.

---

## Current test architecture

### 1) Frontend module-level relationship semantics tests

Purpose:
- Validate node-relationship role mapping and anchor semantics.
- Prevent regressions on `a_position` / `b_position` interpretation and selected-role coloring.

Primary source files:
- `frontend/src/modules/node-map/relationshipProjection.ts`
- `frontend/src/modules/node-map/relationshipProjection.test.ts`

Run command:
- From `frontend/`: `npm run test:node-relationships`

Notes:
- Uses Node's built-in test runner after TypeScript compile for a focused test target.
- Command is implemented through a Node script for cross-platform behavior.
- Output is grouped by **frontend feature sections** so relationship/linking/multi-select failures are easier to scan.

### 2) Frontend build/type safety gate

Purpose:
- Catch TypeScript and bundling regressions in production build path.

Run command:
- From `frontend/`: `npm run build`

### 3) Backend Go tests

Purpose:
- Validate backend packages and API/store behaviors covered by Go tests.

Run command:
- From `backend/`: `go test ./...`

---

## Canonical "run all tests" command

From repo root:

```bash
node scripts/run_all_tests.mjs
```

This currently runs, in order:
1. Frontend relationship semantics tests
2. Frontend production build
3. Backend Go tests

---

## Platform compatibility guidance

### Preferred (cross-platform):
- Use Node-based orchestration scripts (`.mjs`) for multi-step test flows.
- Avoid shell-only text-processing dependencies (`sed`, `awk`, etc.) in npm scripts.

### When shell scripts are needed:
- Provide both `.sh` and `.ps1` variants.
- Document both in this file.

---

## Test inventory (must stay complete)

Use this checklist format and keep it complete.

### Unit tests
- [x] `frontend/src/modules/node-map/relationshipProjection.test.ts`
  - side -> role mapping
  - `+` linked top/bottom semantics
  - peer semantics for left/right
  - existing-node payload mapping
  - illegal relationship side-pair enforcement (peer-only, top->bottom, bottom->top)
  - selected-node opposite-side role resolution
  - parent/child anchor inference
  - projected visual relationship line metadata output
- [x] `frontend/src/modules/node-map/relationshipSelection.test.ts`
  - line-segment vs multi-select box rectangle intersection detection
  - polyline relationship-path vs multi-select box rectangle intersection detection
  - rectangle-boundary overlap detection for relationship-line hit-testing
  - non-overlap guard for fully out-of-bounds relationship-line paths
  - geometry helpers now source from `frontend/src/modules/node-map/NodeMapControls.ts`
- [x] `frontend/src/modules/node-map/NodeMapControls.test.ts`
  - selects node cards + relationship lines that intersect the multi-select box rectangle
  - additive merge keeps previous selection batch for shift/ctrl multi-select
  - additive behavior is pointer-session driven (does not depend on modifier state at pointer-up)
- [x] `frontend/src/modules/node-map/relationshipDeleteSummary.test.ts`
  - success/failure summarization for batched relationship-line delete requests
  - preserves per-relationship failure reason reporting for visibility
- [x] `frontend/src/app/frameLinking.test.ts`
  - context-menu link label fallback (`No other module selected`) when only one module is in active pool
  - graph-based pairwise link-plan generation for multi-module selection pools
  - legacy editor/explorer -> Node Map compatibility derivation through indirect link graph paths
  - context-frame pool fallback when no explicit selection set exists
  - delink behavior removes all graph edges touching selected/context modules
- [x] `frontend/src/app/frameDeleteConfirmation.test.ts`
  - frame-delete confirmation payload preserves explicit frame titles
  - blank/whitespace-only frame titles are normalized to `Untitled frame` for consistent confirmation copy
- [x] `frontend/src/modules/linkingGraph.test.ts`
  - frame-link edge sanitization canonicalizes and deduplicates undirected graph edges
  - linked target resolution by kind supports traversal through intermediary graph hops
  - direct-neighbor resolution returns adjacency-only targets for explorer fanout
- [x] `backend/internal/http/server_test.go`
  - relationship position-pair legality helper (Parent/Child, Child/Parent, Peer/Peer only)
  - workspace snapshot conditional GET contract (`If-None-Match` => `304 Not Modified` when data is unchanged)
  - node creation contract uses canonical `title` payload semantics only (legacy `header` fallback removed)
  - node rename contract via `PUT /v1/nodes/{node_id}` persists updated title

### Integration tests
- [ ] None committed yet (to be added)
- [ ] Node Map title-only node-card surface + card resize affordance integration test (temporarily blocked: no browser harness in repo that can assert rendered node-card text content and interactive resize behavior)
- [ ] Node relationship graph create-node anti-refetch loop integration test (temporarily blocked: no existing browser/session harness to simulate EventSource + component lifecycle churn deterministically)
- [ ] Node Map + Editor duplicate-details-request suppression integration test (runtime now uses single-flight NodeRecordStore reads; automated browser-level request-count assertion still temporarily blocked: no browser harness asserting per-action network request counts)
- [ ] Editor text-box blur-save stale-state regression integration test (temporarily blocked: no browser harness asserting typed-value persistence across linked-node switches)
- [ ] Editor blank-title keyboard routing regression test (temporarily blocked: no browser harness in repo to assert contentEditable key events do not trigger canvas `onKeyDown` textbox creation paths)
- [ ] Cross-origin preflight minimization test for GET helpers (temporarily blocked: no automated CORS/request-capture harness in repo)
- [ ] Frame header-plate visual regression test (temporarily blocked: no committed browser visual-diff harness for asserting edge-flush tag geometry and icon scale)

- [ ] Company Explorer -> Editor detail/historical context handoff integration test (temporarily blocked: no browser harness asserting cross-module context visibility transfer after selection)
- [ ] Stats module generic linked-context sync integration test (temporarily blocked: no browser harness for asserting multi-source context adapters + rendered stat card values)

### End-to-end tests
- [ ] None committed yet (to be added)

### Performance/latency tests
- [ ] None committed yet (to be added)

### Contract/API tests
- [ ] None committed yet (to be added)

---

## Future testing roadmap (to be filled in as we implement)

### Test matrix by scope

We will eventually run different suites by trigger:

- **Fast local pre-commit checks**: focused unit tests + build/type checks
- **Pre-merge checks**: all unit + integration + key E2E smoke paths
- **Release checks**: full regression + latency/performance checks

(Exact matrix is pending final team decision and CI workflow policy.)

### Near-term priorities

1. Add backend integration tests for workspace snapshot and relationship APIs.
2. Add E2E test for node canvas relationship creation and color semantics.
3. Add test data fixtures for canonical parent/child/peer graph arrangements.
4. Add latency-focused checks for hot-path node canvas operations.

---

## PR checklist item (required)

Every PR that changes behavior should answer:

- What tests were added/updated?
- Which commands were run?
- Did this file (`docs/tests.md`) get updated?

If any answer is "no", include a concrete follow-up issue with owner/date.
