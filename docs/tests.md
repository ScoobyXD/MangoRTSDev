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
  - line-segment vs marquee rectangle intersection detection
  - polyline relationship-path vs marquee rectangle intersection detection
  - rectangle-boundary overlap detection for relationship-line hit-testing
  - non-overlap guard for fully out-of-bounds relationship-line paths
- [x] `frontend/src/modules/node-map/relationshipDeleteSummary.test.ts`
  - success/failure summarization for batched relationship-line delete requests
  - preserves per-relationship failure reason reporting for visibility
- [x] `backend/internal/http/server_test.go`
  - relationship position-pair legality helper (Parent/Child, Child/Parent, Peer/Peer only)
  - workspace snapshot conditional GET contract (`If-None-Match` => `304 Not Modified` when data is unchanged)

### Integration tests
- [ ] None committed yet (to be added)
- [ ] Workspace store create-node anti-refetch loop integration test (temporarily blocked: no existing browser/session harness to simulate EventSource + component lifecycle churn deterministically)

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
