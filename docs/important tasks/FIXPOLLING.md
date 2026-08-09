# Process Story: Mango reacts to events instead of continuously polling

A user pauses typing and Mango saves the committed editor change through authenticated HTTP

↓

PostgreSQL stores the durable business change and its small realtime outbox event

↓

Valkey immediately announces that committed event to every running API task

↓

Each API task sends the hint only to its own authorized browsers subscribed to that exact editor

↓

Separately, Nylas sends Mango a verified webhook when an exact connected mailbox changes

↓

Mango places one small exact-account job onto SQS and acknowledges Nylas only after SQS accepts it

↓

One worker downloads one bounded unit of email work and saves the durable result in PostgreSQL

↓

Success deletes the SQS message; temporary failure is delivered again by AWS at most twice; permanent account failure parks only that exact connection

↓

One rare bounded reconciliation signal repairs a missed webhook without restoring hot database or Nylas polling

Last updated: 2026-08-09

# Fix Polling

## Current status

- **DEV Valkey realtime replacement: complete, merged, deployed, and live-verified.**
- **The 75 ms PostgreSQL realtime polling loop is gone in DEV.**
- **The first SQS implementation attempt was rejected and abandoned.** It must not be merged, copied, or used as the starting point for the replacement.
- **The replacement SQS implementation must start from current `main` and follow the simpler design in this document.**
- **The fresh DEV implementation now exists on its review branch with worker/schedule flags off; offline verification and review must finish before any rollout or integration.**
- **The pre-rollout cleanup now has one archive SQS path, one ingestion API, event-driven archive/attached-email reads, and one realtime outbox/wake/spine path. It is still only a local worker-branch change until separately reviewed and integrated.**
- **Production is out of scope.** Nothing in this task authorizes production infrastructure, deployment, database, Nylas, or secret changes.

The abandoned SQS worktree was:

```text
Worktree: C:\Users\Jonat\.codex\worktrees\01ce\MangoRTSDev
Branch: codex/implementing-dev-sqs-email-worker0000726
Last committed candidate: 7737ed0f260028182b9abc98c8cd6c315fc7c761
Final state: dirty, incomplete, unverified, archived, and never merged or deployed
```

## Executive decision

Mango uses three services for three separate jobs:

| Need | Owner | Simple rule |
| --- | --- | --- |
| Durable product data and idempotency | PostgreSQL | Store committed truth and the latest attempt/result; do not act as a hot queue |
| Tell every API task about one committed realtime event | Valkey Pub/Sub | Broadcast a small hint; PostgreSQL remains authoritative |
| Give one email job to one worker | AWS SQS FIFO | SQS owns delivery, retries, visibility, and the dead-letter queue |

The email path is deliberately small:

```text
Nylas webhook
  -> Mango API verifies and resolves the exact permanent connection
  -> SQS FIFO job
  -> one private ECS email worker
  -> exact Nylas read or mutation
  -> PostgreSQL durable result
  -> durable realtime outbox row
  -> asynchronous Valkey mailbox hint when needed
```

Mango must not build a second queue inside PostgreSQL. It must not synchronize an SQS receipt with a database ownership lease. It must not extend SQS visibility with heartbeats. It must not invent its own retry scheduler.

The acknowledgement boundary is also fixed: if the durable email result or required realtime outbox row is missing, the worker does not delete the SQS message. Once both exist, Valkey is no longer part of the SQS acknowledgement. The existing realtime spine owns delayed Valkey publication and recovery, so a broker outage never repeats completed provider work.

## What caused the emergency

On 2026-08-08, the DEV Aurora PostgreSQL database was observed at approximately 100% CPU utilization per ACU while ACU utilization was also at 100%.

The primary measured cause was the realtime outbox loop:

- every backend process queried `realtime_outbox` every 75 ms;
- one loop produced approximately 13.33 queries per second;
- the observed table scan rate was approximately 40.15 sequential scans per second, consistent with three live backend processes;
- `realtime_outbox` contained approximately 114,600 rows;
- PostgreSQL statistics showed approximately 66.9 million sequential scans and approximately 4.19 trillion tuples read;
- the database was committing roughly 100 transactions per second during the saturated period.

The email system added separate unnecessary pressure:

- every API task scanned connected email accounts every 30 seconds;
- every API task asked PostgreSQL for ingestion jobs every 250 ms;
- the archive worker also asked PostgreSQL for work every 250 ms;
- adding API tasks multiplied those loops;
- two permanently broken Nylas connections remained marked `connected`, causing the same provider failures every 30 seconds.

Valkey removed the primary realtime load. SQS must remove the remaining email polling without introducing another ownership system.

## Valkey result: completed and verified

### Final design

- PostgreSQL remains the durable source of truth.
- The product transaction commits first and records a compact realtime outbox event.
- Request handling only durably enqueues/wakes publication; it does not wait several seconds for Valkey.
- A background publisher sends the compact event to the exact Valkey channel.
- Every API task subscribes and uses its existing local authorization and WebSocket registry.
- Recovery runs on startup, reconnect, or a detected gap through bounded indexed PostgreSQL reads.
- Idle API tasks do not poll PostgreSQL every 75 ms.
- If Valkey is unavailable, product saves remain durable and realtime hints recover later.

### DEV infrastructure

- private ElastiCache Serverless Valkey;
- private DEV VPC subnets;
- TLS and IAM authentication;
- security-group ingress only from the ECS API security group on TCP 6379-6380;
- exact channel authorization using `+@pubsub`, without `+@all` or unrestricted key commands;
- exact runtime `elasticache:Connect` permissions;
- connection, authorization-failure, capacity, and command monitoring;
- no production resources and no database-schema change.

### Live verification

The corrected Valkey deployment completed on DEV ECS task definition revision 181.

After the old 75 ms tasks drained:

- RDS CPU fell from approximately 100% to approximately 27%;
- ACU utilization fell from approximately 100% to approximately 75%;
- commit throughput fell from approximately 97-100 per second to approximately 25 per second;
- database connections stabilized around 8;
- the old realtime polling query disappeared from the latest Performance Insights window;
- Valkey Pub/Sub commands appeared normally;
- command authorization failures were zero for consecutive complete minutes;
- channel authorization failures remained zero;
- no subscriber reconnect storm, panic, or fatal log appeared from the corrected revision.

This proves that the 75 ms realtime polling loop was the main continuous RDS CPU driver. The remaining email scanner is smaller but still wasteful and incorrect.

### Valkey lessons retained

- The ALB distributes requests and WebSocket upgrades; it does not relay application events between ECS tasks.
- WebSockets remain attached to the task that accepted them.
- Valkey is a cross-task announcement system, not storage.
- A durable save must never wait on Valkey availability.
- Realtime admission must remain unavailable until recovery/subscription state is safe.
- Recovery queries must have deadlines, fixed limits, indexed ordering, and no cursor-zero history replay.
- Deployed DEV must fail closed when required PostgreSQL or Valkey configuration is absent.

## The email problem that remains

### Hot polling to remove

The replacement must remove, not preserve:

- the per-API 30-second connected-account Nylas scanner;
- the per-API 250 ms ingestion-job claim loop;
- the per-API 250 ms archive-job claim loop;
- wake channels used only to interrupt those loops;
- any fallback that restarts those polling loops when SQS is unavailable.

The safe failure mode is a visible SQS backlog and an alarm, not a provider or database retry storm.

### Known broken connections

The supplied repeating failures were:

```text
connection_id=6c54ac7d-6dc8-dbee-e614-a0e2d8c7cd8a
404 grant.not_found
```

```text
connection_id=0aae6e73-48bd-7022-1cfb-768e2246019d
400 Google Workspace/Gmail API precondition failure
```

Required behavior:

- `401`, `403`, or exact `404 grant.not_found`: set only that permanent connection to `reauth_required`, then acknowledge the SQS job;
- Google/Gmail configuration `400`: set only that permanent connection to `configuration_required`, then acknowledge the SQS job;
- if the status update fails, do not acknowledge the SQS job;
- a separate valid grant, including the reported `mangotestxd@gmail.com` grant, must remain untouched;
- parked connections are excluded from automatic reconciliation until explicitly repaired;
- reconnect updates the same permanent connection and may enqueue one bounded catch-up.

## Why the first SQS attempt was abandoned

The first implementation did not fail because SQS is inherently complicated. It failed because Mango kept PostgreSQL acting as a second queue owner.

The design accumulated:

- SQS receipt visibility;
- a separate PostgreSQL processing lease;
- recurring SQS visibility heartbeats;
- database lease timing that had to match visibility timing;
- a separate work deadline and settlement window;
- worker health tied to heartbeat activity;
- several FIFO lanes for one connection;
- batch claims that could leave unprocessed rows marked `processing`;
- six-attempt retry state split between SQS receive count and PostgreSQL attempt count;
- ten-minute repair logic capable of recreating exhausted work;
- a large destructive archive-identity migration unrelated to the minimum SQS cutover;
- several deployment modes needed mainly because that destructive migration made old and new API images incompatible.

Review correctly found repeated contradictions:

- SQS could redeliver while PostgreSQL still considered the old worker the owner;
- a canceled worker could lose the context needed to record failure;
- visibility-only receives could exhaust the SQS budget without performing real work;
- repair could recreate work after the dead-letter queue;
- the health check could kill a valid busy worker;
- one archive batch could leave many claimed items stuck;
- the proposed deployment workflow could start an incompatible API during migration.

The mistake was responding to those findings by adding more timing and recovery machinery. The correct response is to remove the duplicate database queue ownership.

Nothing from that abandoned implementation is an approved design precedent.

## Final simple SQS decisions

### AWS owns delivery

AWS SQS already provides:

- durable queue storage;
- delivery to one consumer;
- FIFO ordering by message group;
- duplicate reduction;
- visibility while one worker processes;
- automatic redelivery when a message is not deleted;
- a dead-letter queue after a fixed receive count;
- encryption and CloudWatch metrics.

Mango uses those features directly.

### Fixed visibility; no heartbeats

- The queue uses one fixed visibility timeout.
- The starting target is **10 minutes** and must be confirmed against measured worst-case bounded email work before deployment.
- One worker attempt has a fixed hard deadline of **8 minutes**.
- Ordinary database settlement calls remain short and must finish before SQS visibility expires.
- Mango never extends visibility with a heartbeat.
- Mango never shortens visibility to implement custom backoff.
- A crash may delay retry until the fixed visibility expires. That delay is accepted because it keeps correctness simple.
- Normal new email does not wait for the visibility timeout. Work begins immediately; the timeout matters only after a crash or temporary failure.

### No PostgreSQL delivery lease

PostgreSQL stores:

- the stable job/idempotency key;
- status such as accepted, processing, completed, parked, or exhausted;
- the number of provider-processing attempts that actually started;
- safe error category and timestamps;
- durable email, attachment, archive, and relationship results.

PostgreSQL does **not** store a timer that decides when another worker may receive the SQS message.

The producer creates the tiny stable marker before it sends the compact SQS message. `ingestion_job_id` is the permanent Mango work identity, not a delivery timer. `enqueue_source_id` is only the immutable fingerprint that proves an exact original producer request/delivery retry; it is never another job, lease, or delivery authority. That matching source may finish its own send before SQS acceptance is recorded. Generic/later reconciliation never lists old markers by age, sends another source's ingestion/archive marker, or creates a replacement identity.

When provider work actually begins, PostgreSQL atomically records a new attempt token. It refuses to start attempt 4. Completion or failure is conditional on the same token, so an old delayed worker cannot overwrite a newer attempt. This is ordinary idempotency, not a second queue lease.

### Three total SQS deliveries

SQS `maxReceiveCount` is **3** for each queued message:

1. first normal attempt;
2. first automatic retry;
3. final automatic retry;
4. then AWS moves the message to the dead-letter queue.

AWS's SQS receive count is the delivery and dead-letter authority. PostgreSQL's counter records only provider-processing attempts that actually started. They are intentionally not claimed to be equal: a worker can crash after SQS delivers a message but before PostgreSQL records an attempt.

- Success deletes the SQS message.
- An already-completed duplicate deletes the SQS message without repeating provider work.
- A temporary failure records the safe failure and does not delete the message. SQS redelivers it after the fixed visibility timeout until AWS reaches its receive limit.
- A third provider-processing attempt records `exhausted`. Atomic attempt start refuses attempt 4 even if a duplicate queue message exists.
- AWS can move a message to the dead-letter queue with fewer than three recorded database attempts when the worker crashes before attempt start. The stable job row still prevents automatic recreation.
- If the worker cannot record the final result, it does not delete the SQS message. AWS moves the message to the dead-letter queue, the alarm fires, and deliberate operator review is required.
- Permanent connection/configuration failures park the exact connection and delete the message.
- Reconciliation sends only a newly created stable ingestion job for genuinely missing provider work. An existing accepted, processing, completed, parked, exhausted, archive, or DLQed identity causes zero sends.
- Manual replay from the dead-letter queue is a deliberate operator action after the underlying problem is understood.

There is no custom exponential backoff scheduler. The fixed SQS visibility interval is the retry delay.

### One bounded unit per message

One SQS delivery performs one bounded unit:

- one exact provider message/thread ingestion job;
- one exact archive item;
- one exact connection reconciliation page;
- or one small reconciliation control page.

The worker never pre-claims a large archive batch. A continuation is another small SQS message.

Provider calls occur outside long PostgreSQL transactions. Email bodies, attachment bytes, OAuth tokens, and provider secrets never enter SQS.

### One FIFO group per permanent connection

- Every provider/account work message uses the permanent `email_connection_id` as its message group ID.
- Different connections can run concurrently.
- One connection remains ordered.
- Reconciliation is bounded so it cannot place an unbounded backlog ahead of live work.
- Do not create foreground/background/mutation ownership lanes for the same connection in the first implementation.
- The global reconciliation trigger uses one fixed control-only group ID, `reconciliation-control`. It does not perform provider/account work and is not a second ownership lane for any mailbox.

### Minimal message payload

The SQS message contains only safe identifiers and routing facts:

- schema version;
- job kind;
- company ID;
- permanent email connection ID;
- stable event or job ID;
- provider message/thread ID when required;
- safe timestamps or checkpoint token when required.

It does not contain bodies, subjects, recipients, attachments, credentials, provider tokens, secrets, or presigned URLs.

### API acknowledgement rule

For a valid Nylas webhook:

1. verify the signature;
2. resolve the exact permanent connection;
3. durably create or find the tiny stable job identity before enqueueing;
4. send the message to SQS using a short request-derived deadline;
5. return success only after SQS accepts it.

If SQS send fails, return a retryable response so Nylas can retry the same stable identity. The FIFO deduplication ID is that stable identity. A duplicate webhook must independently wait for successful SQS acceptance; one request's failed send must not be hidden by another in-flight receipt cache entry.

The API does not download provider email inside the webhook request.

## Rare reconciliation

Webhooks are the normal path. Reconciliation is only insurance for a notification that never reached SQS.

EventBridge Scheduler sends one control message approximately every 10 minutes. It uses the fixed `reconciliation-control` message group ID. The FIFO work queue has content-based deduplication enabled because Scheduler requires it for a FIFO SQS target.

Scheduler delivery is deliberately bounded to **2 retries** and a **5-minute maximum event age**. Its own delivery dead-letter queue is a separate encrypted **Standard** SQS queue, because EventBridge Scheduler does not support a FIFO dead-letter queue.

That control message:

1. runs one indexed query for a small page of due `connected` connections;
2. enqueues at most one bounded reconcile message per exact connection;
3. continues with another control message only when another page exists;
4. never scans every account concurrently;
5. excludes disconnected, parked, `reauth_required`, and `configuration_required` connections;
6. creates and sends one stable ingestion job only when a discovered provider message has no existing job identity;
7. lets only a redelivery with the exact same reconciliation fingerprint finish its own accepted job while acceptance is unrecorded; a later schedule and every accepted-recorded, processing, completed, parked, exhausted, archive, or DLQed identity cause zero sends;
8. processes one provider page per SQS delivery;
9. advances the checkpoint only after the page is durably represented by new acceptance or an already-existing stable identity;
10. never polls PostgreSQL every few milliseconds and never runs a per-API scheduler.

The 10-minute schedule is not a 10-minute delay for normal email. Normal email arrives through the webhook immediately.

## Worker health and scaling

- The worker is a private ECS service outside the ALB.
- DEV deliberately uses one worker task with small bounded concurrency. This correctness cleanup adds no production autoscaling.
- ReceiveMessage uses 20-second SQS long polling, so an idle worker does not create another hot polling loop.
- Time waiting in the queue does not start the 10-minute visibility period or 8-minute worker deadline; both begin only when a worker receives the item. The current DEV queue retains waiting items for 14 days.
- Before the first receive, the worker exits if PostgreSQL final-schema readiness, SQS, Nylas, or external Valkey is unavailable or incomplete. It never substitutes process-local realtime.
- A persistent SQS Receive error also exits the run so ECS restart backoff owns recovery; an ordinary message failure remains undeleted for native SQS redelivery.
- ECS replaces an exited essential container.
- Health is not based on the age of the last completed job or a visibility heartbeat.
- CloudWatch alarms cover running task count, queue age, visible backlog, and dead-letter count.
- Queue age is the primary signal for a live-but-stuck worker.
- Scale only after measured queue age or throughput shows one worker is insufficient.

## Minimal database and schema rule

The fresh implementation starts by auditing the current `main` schema and reuses existing durable ingestion/archive job identities where they already satisfy exact typed relationship rules.

It must not copy the abandoned destructive archive-identity migration merely because it already exists in another worktree.

Rules:

- prefer no schema change;
- if `configuration_required` needs a database check-constraint change, use one small PostgreSQL 17-compatible additive migration and update the canonical schema/UI/Process Stories together;
- do not add processing-lease, visibility-heartbeat, retry-scheduler, or compatibility columns;
- do not combine unrelated archive identity cleanup with the SQS cutover;
- the one legacy cutover may collapse redundant `email_ingestion_jobs` metadata only after aggregate preflight and a locked transactional recheck prove every duplicate row is completed/failed, populated Mango/provider thread identities agree, and no foreign key references ingestion jobs. Retention is deterministic: genuine completion, then failure, then synthetic `superseded_by_email_ingestion_cutover` completion; within a class prefer rows carrying the agreed thread metadata, then earliest creation time and ascending UUID. Delete no email, thread, attachment, relationship, or archive data;
- every operator migration requires a read-only preflight and one human-run transaction;
- agents do not write to a live database.

## DEV-only implementation and rollout

The fresh work starts from the new current `main` after this decision record is merged.

### Stage 1: implementation and offline verification

- implement the smallest end-to-end webhook -> SQS -> worker -> PostgreSQL path;
- add the DEV queue, FIFO dead-letter queue, encryption, least-privilege IAM, alarms, and private worker service;
- keep worker and reconciliation disabled by default;
- preserve the deployed Valkey resources and exact channel ACL;
- remove hot email polling instead of retaining it as fallback;
- run unit, disposable PostgreSQL, Terraform, and complete repository tests;
- obtain two independent reviews of backend correctness and DEV infrastructure.

### Stage 2: first reviewed DEV deployment with features off

- review the complete Terraform plan before apply;
- `email_sqs_enabled` may remain DEV-default `true` to bootstrap queues/IAM, but the worker and reconciliation flags default off;
- the new API image is **not** compatible with the legacy email schema and must not be launched before the migration;
- the normal DEV workflow accepts an explicit API desired count, including `0` for migration maintenance. Queue/IAM bootstrap may leave the old API active only when its current image and desired count are preserved; otherwise the reviewed maintenance plan scales the old API to zero and does not launch the new image;
- plan and apply are separate environment-scoped manual operations restricted to `main`. Review Terraform's redacted plan output in the plan-run log. The runner bundles the exact binary plan, redacted rendering, checksum, and rollout identity, encrypts that bundle with `age`, deletes the plaintext bundle, and uploads only ciphertext. Apply downloads that exact ciphertext, decrypts it only inside the `development` job with its dedicated environment secret, verifies recipient, checksum, source SHA, stage, schema confirmation, worker/schedule flags, and API count, then applies that exact binary plan. This is exact-plan self-review, not independent approval: the current private-repository plan cannot enforce environment reviewers or branch protection, and a repository writer could modify the workflow. Keep the required age values unconfigured until a human chooses a GitHub plan/permissions change, an external gate, or explicitly accepts that limitation;
- do not modify production;
- verify queue attributes, redrive policy with `maxReceiveCount=3`, encryption, IAM, and alarms.

### Stage 3: atomic human schema cutover

- stop and drain every old API/email writer before preflight and keep it stopped through the transaction;
- run the exact read-only PostgreSQL 17 preflight. It accepts only coherent unordered exact states: all three tables at legacy (`email_connections` unchanged 13, ingestion 16, archive items 12) or all three at final (`email_connections` unchanged 13, ingestion 16 after replacing the three delivery-era fields with `provider_attempt_count`, `attempt_token`, and `sqs_accepted_timestamp`, archive items 11 after replacing its three delivery-era fields with `provider_attempt_count` and `attempt_token`). Any cross-table mixed state is STOP before a write;
- stop if that preflight finds any legacy database-delivered ingestion or archive item still pending, processing, or retrying; let the old deployment finish it or perform deliberate operator review before cutover;
- review the aggregate duplicate report without mailbox/provider identifiers. It must show stable-identity group count, exact redundant-row count, rows outside completed/failed, synthetic cutover-completed rows, conflicting non-null Mango thread groups, conflicting nonblank provider thread groups, and foreign-key references. READY requires zero unsafe/conflicting/reference counts in a coherent legacy state; final-schema duplicates are STOP;
- take a verified DEV recovery point;
- a human applies the one small plain-SQL transaction in DBeaver. It locks and rechecks before writing, collapses only the reported safe redundant ingestion metadata with the canonical ranking, asserts the exact deleted count and zero remaining duplicates, and does not delete email/thread/attachment truth;
- verify the final schema and keep worker/schedule off before deploying code that requires it.

### Stage 4: new API, then one worker, then reconciliation

- provide at least one reviewed alarm action ARN, then review and apply the infrastructure/API stage with the migrated-schema confirmation, explicit nonzero API desired count, and worker/schedule still disabled. Terraform itself rejects every nonzero SQS-enabled API plan without both migration confirmation and an alarm action, including plans created outside the workflow;
- verify the new API: health, OAuth, Nylas signature handling, SQS send failure, and Valkey realtime;
- review the worker-only plan that changes only the worker flag to one task and apply that exact encrypted saved plan;
- verify one real personal and one real shared connection job;
- review the schedule-only plan that changes only the schedule flag, then apply that exact saved plan only after direct jobs work;
- verify known 404/400 accounts park once and stop;
- verify no message receives more than three automatic SQS deliveries, dead-letter work stays parked, and reconciliation never recreates its stable identity.

### Rollback

- disable the worker and schedule;
- before migration, the old API may resume only against the unchanged legacy schema;
- after migration, do **not** run the old API against the new schema. Keep worker/schedule disabled and roll the new code/schema forward, or restore the verified recovery point before restoring the old API;
- keep the queue, dead-letter queue, and durable jobs for diagnosis when rolling forward;
- do not restore hot polling;
- do not replay dead-letter work until the failure is understood;
- never attempt an ad hoc reverse migration.

## Required tests

### Webhook and exact identity

- valid `message.created` sends one compact FIFO job and returns promptly;
- invalid signature sends nothing;
- SQS send failure returns a retryable response;
- concurrent duplicate webhooks each require successful SQS acceptance;
- personal and shared connections resolve by exact permanent typed identity;
- no shared-account email-address fallback is allowed;
- a valid unrelated grant remains unchanged when another grant fails.

### Worker and idempotency

- one delivery that reaches provider processing starts exactly one durable attempt; a worker may crash after SQS delivery but before attempt start;
- one message performs one bounded unit;
- success commits before SQS delete;
- crash before delete redelivers safely;
- completed redelivery performs no second provider operation;
- old attempt completion cannot overwrite a newer attempt;
- archive processing handles one exact item only;
- provider calls use cancellable contexts and no long database transaction;
- request cancellation reaches PostgreSQL;
- no `context.Background()` escapes from request-owned or worker-owned database work.

### Retry and dead-letter behavior

- the queue has fixed visibility and no heartbeat/change-visibility loop;
- SQS receive count, not the PostgreSQL attempt number, controls redelivery and dead-letter movement;
- PostgreSQL increments only when provider work actually starts and refuses attempt 4;
- AWS may move a message to the dead-letter queue with fewer than three recorded attempts if the worker crashed before attempt start;
- reconciliation sends only newly created stable jobs for genuinely missing provider work and sends zero for every existing ingestion/archive identity, including exhausted and DLQed work;
- a third-attempt settlement failure is not acknowledged; the dead-letter alarm requires deliberate operator review;
- permanent `401`, `403`, exact `404 grant.not_found`, and Gmail configuration `400` do not consume all three attempts;
- a status-write failure remains retryable and is not falsely acknowledged.

### Reconciliation and polling removal

- no API task lists connected accounts every 30 seconds;
- no API task or worker asks PostgreSQL for jobs every 250 ms;
- EventBridge produces one rare control message;
- one control message reads one bounded keyset page;
- one connection message handles one provider page;
- a missed webhook converges on one stable idempotency identity, and duplicate deliveries perform no duplicate provider work;
- accepted, processing, completed, parked, exhausted, archive, and DLQed work is never resent by reconciliation;
- adding API tasks does not multiply reconciliation.

### Infrastructure and operations

- `email_sqs_enabled` may default true for DEV queue bootstrap; worker and reconciliation schedule flags default off;
- worker is private and outside the ALB;
- queue and dead-letter queue are FIFO and encrypted;
- the FIFO work queue has content-based deduplication enabled;
- redrive `maxReceiveCount` is exactly 3;
- visibility is fixed and no heartbeat permission/path exists;
- worker receives use 20-second long polling;
- persistent Receive failure exits the worker for ECS restart backoff, while ordinary message failure stays with SQS redelivery;
- worker IAM contains only required queue, attachment, Valkey-wake, and secret access;
- worker startup requires final-schema confirmation, PostgreSQL readiness, complete Nylas/SQS/external-Valkey configuration, and actionable alarm ARNs before the first receive;
- Scheduler trust uses the exact schedule-group ARN and source account;
- Scheduler uses the stable `reconciliation-control` group ID, 2 retries, and a 5-minute maximum event age;
- Scheduler's delivery DLQ is a separate encrypted Standard queue;
- queue age, worker running count, and both DLQs have actionable alarms; a nonzero SQS-enabled API is forbidden until an alarm action ARN is configured, so queue alarms are actionable before the API can enqueue;
- Valkey `+@pubsub`, exact channel restriction, and authorization alarm remain unchanged;
- no production file or resource changes.

## Acceptance measurements

The SQS work is complete only when DEV shows:

- no 30-second Nylas account scanner;
- no 250 ms ingestion or archive database claimant;
- idle email infrastructure produces no continuous PostgreSQL work;
- normal webhook email begins immediately;
- queue age remains low during ordinary operation;
- one simulated temporary failure retries no more than three total deliveries;
- dead-letter work stays dead until deliberate operator replay;
- known permanent 400/404 accounts stop calling Nylas automatically;
- valid accounts continue working;
- RDS CPU, ACU, sessions, commits, and top SQL remain stable;
- Valkey realtime behavior remains healthy during the separate email rollout.

## Security and relationship requirements

- Follow `docs/security/database-agent-access-contract.md`.
- Read and follow `docs/tests/relationships.md` before changing email, attachment, Node, or permission relationships.
- Use only designated database-enforced read-only credentials for live inspection.
- Agents never receive, print, copy, or store writer/admin passwords, OAuth tokens, Nylas keys, webhook secrets, AWS session tokens, or unrelated secrets.
- Agents never write to a live database.
- Use AWS SSO profiles and keep DEV and production separate.
- SQS messages, DLQs, Valkey payloads, metrics, and logs contain identifiers and safe categories only.
- Preserve exact company scope and permanent email connection identity.
- No central registry, untyped generic relationship, surrogate identity, or account-email fallback.

## Explicit non-goals

- No PostgreSQL job polling loop.
- No SQS visibility heartbeat.
- No PostgreSQL delivery lease.
- No custom retry scheduler or exponential backoff engine.
- No more than three total automatic attempts.
- No automatic dead-letter replay.
- No large archive batch claim.
- No separate foreground/background/mutation ownership lanes in the first version.
- No Kafka, custom broker, leader election, or Valkey Streams.
- No email bodies, attachment bytes, or secrets in SQS.
- No unrelated destructive email-schema cleanup.
- No production implementation or deployment in this task.
- No reuse of the abandoned SQS worktree.

## Completion checklist

### Valkey

- [x] Capture the realtime polling baseline and root cause.
- [x] Add private DEV ElastiCache Serverless Valkey, IAM, security groups, and alarms.
- [x] Add cross-task publish/subscribe and bounded durable recovery.
- [x] Remove the 75 ms idle PostgreSQL ticker.
- [x] Merge and push reviewed Valkey changes to `main`.
- [x] Deploy corrected `+@pubsub` ACL to DEV.
- [x] Verify Pub/Sub commands, zero authorization failures, stable ECS tasks, and major RDS load reduction.

### Fresh SQS implementation

- [x] Start a completely new worktree from the post-documentation `main`.
- [x] Audit the current schema and implement the smallest exact job model.
- [x] Add DEV FIFO queue, FIFO DLQ, IAM, encryption, alarms, and disabled schedule.
- [x] Set fixed visibility, no heartbeat, and `maxReceiveCount=3`.
- [x] Add the private worker with at most three provider-processing starts per stable job and no database lease.
- [x] Route verified Nylas events and archive items to one bounded SQS unit.
- [x] Add exact 400/404 parking and status-write failure handling.
- [x] Add one bounded 10-minute reconciliation control path.
- [x] Remove 30-second and 250 ms polling loops without fallback.
- [x] Update all affected Process Stories and numbered laws.
- [x] Pass focused, disposable PostgreSQL, Terraform, infrastructure, and complete repository tests.
- [ ] Obtain independent backend and infrastructure approval.
- [ ] Merge and push only the reviewed fresh branch.
- [ ] Roll out and test DEV in separate guarded stages.

## Primary references

- AWS SQS FIFO queues: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-fifo-queues.html>
- AWS SQS visibility timeout: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html>
- AWS SQS dead-letter queues: <https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html>
- AWS EventBridge Scheduler to SQS: <https://docs.aws.amazon.com/scheduler/latest/UserGuide/getting-started.html>
- AWS ECS with Application Load Balancers: <https://docs.aws.amazon.com/AmazonECS/latest/developerguide/alb.html>
- AWS ElastiCache IAM authentication: <https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/auth-iam.html>
- Valkey Pub/Sub: <https://valkey.io/topics/pubsub/>
- Nylas webhook notifications: <https://developer.nylas.com/docs/v3/notifications/?redirect=webhooks>
