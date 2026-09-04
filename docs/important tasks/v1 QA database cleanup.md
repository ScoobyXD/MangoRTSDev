# V1 QA Database Cleanup and Login Recovery

Date: September 3, 2026

Status: Ranked remediation plan. The first implementation phase is limited to Items 1-3.

## Current Incident Summary

QA authentication succeeds in Cognito, but the browser remains on `Loading` because `GET /v1/me` does not finish. The evidence does not support a simple hardware-capacity failure:

- Cognito returns `200 OK` before the application stalls.
- QA database connections jump from 1 to exactly 20, which is the backend connection-pool limit.
- The QA ECS backend remains at low CPU because requests are waiting on database connections or locks rather than performing CPU-heavy work.
- The QA RDS instance has held an abnormal idle baseline near 52% CPU since the failed September 1 database copy. One-minute metrics reached approximately 99% during the login incident even though the wider console graph averages those spikes down.
- Disk queue depth and EBS credit metrics do not indicate a storage bottleneck.
- The frontend has no timeout for `/v1/me`, so this backend failure appears to users as an endless loading screen.

## Phase 1 Boundary

The first implementation worktree must address only the following critical items, in this order:

1. Fix the authentication request stampede.
2. Diagnose the abnormal QA database load and prepare the safe corrective action.
3. Add backend request cancellation and database timeouts.

Items 4-10 remain recorded and ranked, but they are outside the first worktree's implementation scope. The worktree may note interactions with those items without implementing them.

Live QA database inspection must remain read-only. The implementation may produce reviewed operator instructions or scripts for a confirmed corrective action, but it must not write to a live database, restart RDS, or modify live AWS resources without separate explicit approval.

## Ranked Remediation Plan

### 1. Fix the authentication request stampede

Priority: Critical. This is the strongest explanation for the immediate outage and the exact jump to 20 database connections.

Current behavior:

- Every protected request passes through the authentication membership path.
- Membership cache entries last only five seconds.
- Concurrent cache misses for the same user are not combined into one in-flight lookup.
- Each miss can call `UpsertAuthUser`, begin a transaction, take a database connection, and wait on the same per-user PostgreSQL advisory lock.
- A page load starts many API requests and realtime connections together. Those requests can occupy the entire pool while waiting on the same user operation.
- The observed incident included hundreds of requests per minute, 29 realtime opens, and a database connection jump from 1 to the configured maximum of 20.

Required outcome:

- A burst of protected requests for one authenticated user performs at most one in-flight membership/bootstrap operation for that user.
- Normal protected requests do not perform an unnecessary user write transaction.
- Waiting for an authentication result does not consume the entire database pool.
- Authentication behavior remains correct when user claims or memberships genuinely change.
- Concurrency tests prove that simultaneous `/v1/me` and protected requests cannot exhaust the pool.

Primary source areas:

- `backend/internal/http/auth_membership_cache.go`
- `backend/internal/http/auth_middleware.go`
- `backend/internal/store/postgres_auth.go`

### 2. Diagnose and clear the abnormal QA database load

Priority: Critical. QA already has reduced database headroom before normal application traffic begins.

Current evidence:

- Before the failed September 1 copy, QA RDS CPU was generally around 3-6%.
- During that copy, large delete and update operations ran and the task did not record successful completion.
- CPU then rose to approximately 52% and remained there.
- The elevated CPU continued during periods with zero reported application database connections.
- On a two-vCPU instance, one PostgreSQL process fully occupying one CPU can appear as approximately 50% total utilization.

Most likely explanation:

- PostgreSQL internal work triggered by the failed copy, such as autovacuum, auto-analyze, or another maintenance/background worker.
- This is not yet proven. The exact process must be identified from live PostgreSQL state rather than guessed from the CPU graph.

Required read-only inspection:

- Capture `pg_stat_activity`, including backend type, state, wait event, query start, transaction start, and query text.
- Capture `pg_locks` and identify blockers and waiters.
- Inspect `pg_stat_progress_vacuum`, `pg_stat_progress_analyze`, and other applicable progress views.
- Inspect table dead tuples, recent vacuum/analyze timestamps, database sizes, and transaction age.
- Correlate the database process with CloudWatch metrics and the failed-copy timeline.

Required outcome:

- Name the exact process, query, lock, or maintenance activity consuming the baseline CPU.
- Explain why it started and whether it is progressing, stuck, or recurring.
- Produce the smallest safe corrective action and rollback considerations.
- Obtain separate approval before executing any live write, cancellation, restart, vacuum command, or AWS modification.
- After an approved correction, verify idle CPU, connection count, lock waits, and `/v1/me` latency return to acceptable levels.

### 3. Add backend request cancellation and database timeouts

Priority: Critical. Missing cancellation turns a temporary slowdown into persistent connection-pool exhaustion.

Current behavior:

- Authentication database operations use `context.Background()` in request-driven paths.
- Browser or load-balancer cancellation therefore does not reliably stop the related database transaction or lock wait.
- Important database operations have no bounded query, transaction, or lock-wait deadline.
- The HTTP server does not provide a complete handler/response timeout boundary for this failure mode.
- PostgreSQL statement and transaction timeout protection is not currently providing the required application boundary.

Required outcome:

- Request-driven database operations use the originating request context.
- Cancellation propagates through authentication, store calls, transactions, and lock acquisition.
- Query, lock-wait, transaction, and HTTP response deadlines are explicit and tested.
- Transactions always roll back and release their connection after timeout or cancellation.
- Timeouts return a controlled API error and do not leak goroutines or database connections.
- Tests cover client cancellation, lock contention, slow database operations, and pool recovery.

Primary source areas:

- `backend/internal/http/auth_middleware.go`
- `backend/internal/store/postgres_auth.go`
- Backend HTTP server and database configuration

### 4. Repair QA data after the Dev copy

Priority: High. Copied or partially processed data can continue creating work after the immediate outage is fixed.

Inspect the incomplete copy history, attachment storage references, pending cleanup records, notification backlog, realtime outbox, expired uploads, and transaction state. Prepare narrow, reviewable operator actions for confirmed bad QA data. Do not treat broad deletion or a fresh copy as the default solution.

### 5. Fix attachment cleanup

Priority: High. The current recurring cleanup can create unnecessary database traffic indefinitely.

The deletion cleanup runs every minute, performs global candidate searches, can hold one query open while requesting another pool connection, performs additional queries per attachment and object, and lacks complete deadlines. Copied Dev bucket values may not match the QA bucket, causing the same invalid candidates to fail validation and be selected again. Replace endless polling/retry behavior with bounded, indexed, observable work that does not retain nested pool connections.

### 6. Fix other background jobs

Priority: High. These jobs are unlikely to create all 20 connections independently, but they can reduce headroom and amplify an incident.

Bound notification cleanup, expired-upload cleanup, and realtime recovery. Add cancellation and deadlines, prevent overlapping runs, limit backlog draining per pass, and make successful work observable. Inspect inherited QA backlogs before deciding whether code or data correction is required.

### 7. Fix frontend login loading

Priority: Medium. This does not remove the backend failure, but it prevents an endless and unexplained user experience.

Give `/v1/me` a finite timeout through the shared request behavior. When bootstrap fails, leave the loading screen and show a clear error with safe Retry and Sign Out actions. Do not create an automatic retry loop that recreates the authentication stampede.

Primary source areas:

- `frontend/src/auth/cognitoAuth.ts`
- `frontend/src/auth/AuthGate.tsx`
- `frontend/src/modules/api/requestJSON.ts`

### 8. Improve health checks and monitoring

Priority: Medium. Current health reporting can stay green while every database-backed route is unusable.

Add a database-aware readiness signal without turning the lightweight liveness endpoint into expensive application work. Enable the minimum useful RDS/PostgreSQL observability and alert on pool exhaustion, long transactions, lock waits, abnormal idle CPU, and repeated cleanup failures.

### 9. Validate Dev and QA consistently

Priority: Required release gate. This verifies the fixes but is not itself the root cause.

Test the changes in Dev, build one immutable artifact, and deploy that same artifact to QA. Load-test simultaneous login, `/v1/me`, protected-route, and realtime startup traffic. Verify request latency, database connections, cancellation, and recovery after induced contention. Do not maintain separate manual code fixes for Dev and QA.

### 10. Review QA capacity after fixing the software

Priority: Last. Capacity can provide headroom, but it must not hide unresolved concurrency, locking, or timeout defects.

After Items 1-9 are validated, compare QA's workload and database behavior with Dev. Resize QA only if measured healthy software still lacks sufficient CPU, memory, connections, or burst capacity. Record any intentional Dev/QA infrastructure difference explicitly.

## Phase 1 Completion Gate

Items 1-3 are complete only when all of the following are true:

1. Concurrent authentication requests for one user are combined and cannot consume the full connection pool.
2. The abnormal QA database process is identified from read-only evidence, with a precise separately approved corrective action when live intervention is needed.
3. Request cancellation and bounded database deadlines release transactions and connections reliably.
4. Automated tests cover authentication concurrency, database lock contention, cancellation, timeout behavior, and pool recovery.
5. Relevant numbered business-logic laws in `docs/tests` are updated if implementation changes application behavior.
6. The worker commits all intended source, test, and documentation changes on its worktree branch but does not merge, push, deploy, or modify live QA resources.
