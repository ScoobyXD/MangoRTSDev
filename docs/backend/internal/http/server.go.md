# This is the main doc related to server.go
## Golden Rules:
Design the MangoRTS hot-path architecture for:
- 100000s of UI elements and simultaneous background operations per active workspace
- 100000s of companies
- 1000000s of users and ai agency
- strict latency culture with sub-100ms targets
- strict robustness and reliability
- ***THIS IS SUPER IMPORTANT:*** In the future we will have ai agents operate this app without a UI,
    so we need to make sure everything can be done by ai agents headless with just APIs.
    This will be the main way entities will interact with MangoRTS in the future.
    And of course, it needs to work well with millions of ai agents all using the apis at the same time.
- MangoRTS will use AWS as the cloud provider. Write code and design data access patterns efficiently to minimize cloud cost because the app and database will be hosted on cloud services.

These rules are from the latency-obsession-architecture.md file 


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

3. **Create-node flow still forced snapshot refetch on the hot path**
   - `createNode(...)` posted successfully and then immediately called `loadNodes()`.
   - `loadNodes()` always called `refreshNodeRelationshipGraphSnapshot(...)`.
   - In environments with extra subscribers/remount churn, this reintroduced repeated snapshot reads after node creation.

   Net result: click spam was fixed, but "create node" could still restart snapshot GET bursts.

## Why this violates latency architecture

Per `docs/latency-obsession-architecture.md` hot paths must:

- Avoid polling loops in favor of event-driven sync.
- Avoid broad rerender/state churn.
- Preserve cacheability and low-latency read behavior.

The loop above violated these rules by repeatedly issuing snapshot reads and re-fanning updates.

## Implemented fix

### Frontend (Node Map + NodeRelationshipGraph store)

- Removed network refresh from relationship derivation paths that run on node state changes.
- Relationship projection now reads from local snapshot cache in-memory.
- Added a guard in snapshot refresh to skip subscriber fan-out when ETag is unchanged.
- Removed the post-create `loadNodes()` snapshot refetch and replaced it with workspace-store optimistic node upsert plus SSE/store convergence so all subscribers update consistently.
- Added workspace-store local node removal helper so delete flows no longer force `loadNodes()` snapshot refresh on success.
- Added non-graph workspace event short-circuiting (`node_information_created`) so these events no longer trigger graph snapshot refresh fallback.
- Reduced preflight overhead by only setting `Content-Type: application/json` on requests that actually include a body.
- Reduced duplicate details GETs by skipping redundant details-panel reload when it targets the same node as the selected-node details load.

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
- Add a dedicated frontend test harness for NodeRelationshipGraph store subscription/refresh loops.
