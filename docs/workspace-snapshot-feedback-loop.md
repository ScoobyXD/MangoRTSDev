# Workspace Snapshot GET Spam: Root Cause + Fix

Last updated: 2026-04-24

## Symptom

When Node Map became active, backend logs showed sustained high-frequency requests to:

- `GET /v1/workspace/snapshot`

This presented as near-continuous calls with no user mutation action.

## Root cause summary

This issue was caused by two hot-path behaviors reinforcing each other:

1. **Frontend feedback loop in Node Map**
   - Node changes triggered relationship loading.
   - Relationship loading refreshed workspace snapshot.
   - Snapshot refresh notified subscribers.
   - Subscriber callback set nodes again.
   - Node changes retriggered relationship loading.

   Net result: a repeating client-side read loop.

2. **Unstable snapshot ETag due `generated_at: now`**
   - Snapshot endpoint included a per-request current timestamp.
   - ETag is computed from full JSON payload.
   - Payload changed every request even when data was identical.
   - Conditional GET could not return `304 Not Modified`.

   Net result: full payload work on every loop iteration.

## Why this violates latency architecture

Per `docs/latency-obsession-architecture.md` hot paths must:

- Avoid polling loops in favor of event-driven sync.
- Avoid broad rerender/state churn.
- Preserve cacheability and low-latency read behavior.

The loop above violated these rules by repeatedly issuing snapshot reads and re-fanning updates.

## Implemented fix

### Frontend (Node Map + workspace store)

- Removed network refresh from relationship derivation paths that run on node state changes.
- Relationship projection now reads from local snapshot cache in-memory.
- Added a guard in snapshot refresh to skip subscriber fan-out when ETag is unchanged.

### Backend (snapshot endpoint)

- Removed per-request `generated_at: time.Now()` from workspace snapshot response payload.
- Kept payload deterministic so ETag can remain stable for unchanged data.

## Expected behavior after fix

- Opening/interacting with Node Map should not trigger sustained snapshot GET loops.
- Snapshot fetch frequency should align with:
  - initial hydration
  - explicit fallback refreshes
  - real mutation reconciliation paths
- Repeated unchanged snapshot requests should return `304 Not Modified` when `If-None-Match` is supplied.

## Regression protection added

- Added backend test that verifies unchanged snapshot data returns `304 Not Modified` when ETag is echoed back in `If-None-Match`.

## Operational follow-up recommendations

- Add dashboard panels for `/v1/workspace/snapshot` request rate and 2xx/304 breakdown.
- Alert when per-session snapshot GET rate exceeds expected thresholds on Node Map hot path.
- Add a dedicated frontend test harness for workspace store subscription/refresh loops.
