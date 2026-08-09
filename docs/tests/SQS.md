# Process Story: New email moves through SQS without database polling

Nylas tells Mango that a new email exists
↓
The Mango API verifies the notification, finds the exact connected account, and creates or finds one permanent small job identity
↓
The Mango API sends that identity to SQS, records the acceptance, and acknowledges Nylas only after both steps succeed
↓
One private worker receives one bounded job and downloads the required provider data
↓
PostgreSQL commits the email, its exact typed relationships, the permanent job result, and the small realtime notice
↓
The worker deletes the SQS message only after that durable commit succeeds
↓
Valkey notifies the exact open mailbox, and the browser reloads PostgreSQL truth

Last updated: 2026-08-09

## The simple route

`Nylas → Mango API → SQS → private worker → PostgreSQL → Valkey notifications`

SQS owns delivery and retries. PostgreSQL stores results and prevents duplicate work.

## Normal delivery rules

1. Nylas webhooks are the normal and immediate way new email enters Mango. Mango does not check every account every 30 seconds.
2. The API verifies the webhook signature and resolves the exact permanent personal or shared email connection.
3. One provider message has one permanent job identity: company + email connection + provider message.
4. The API stores or finds that identity before sending it to SQS. Duplicate webhooks reuse the same identity.
5. The API reports success to Nylas only after SQS accepts the compact message and PostgreSQL records `sqs_accepted_timestamp`. If SQS rejects it, Mango returns a retryable failure so Nylas can send it again.
6. Cancellation or an ambiguous failure after marker creation leaves that same stable marker eligible for a resend. A request retry or rare reconciliation resends the same identity; it never creates a replacement marker.
7. An SQS message contains identifiers only. It never contains an email body, attachment bytes, provider token, credential, secret, or presigned URL.
8. DEV runs one private worker task outside the load balancer. Its default limit is three messages being processed at the same time.
9. One SQS delivery processes one bounded unit. It never claims a large database batch.
10. The worker stores the provider result and exact typed relationships in PostgreSQL before acknowledging SQS.
11. The required `realtime_outbox` notice must also be durable before SQS acknowledgement. Valkey publication itself happens afterward and does not repeat provider work.
12. A repeated delivery sees the same permanent job identity and does not repeat completed provider work.

## Retry timing

The current queue permits **three total deliveries**, not three retries after the first delivery. That means:

- delivery 1: the first attempt;
- delivery 2: the first retry;
- delivery 3: the final retry;
- after that: AWS moves the message to the dead-letter queue.

The timing is deliberately fixed and simple:

1. SQS hides a received message for 10 minutes. This is the visibility window.
2. Mango gives the worker at most 8 minutes to do the work.
3. If work fails quickly, the message becomes available again about 10 minutes after it was received.
4. If work uses the full 8 minutes, about 2 minutes remain before SQS can deliver it again.
5. Mango never extends the 10-minute window. There is no visibility heartbeat.
6. PostgreSQL records an attempt only when provider work actually starts and refuses a fourth provider-processing start.
7. A crash before provider work starts can consume an SQS delivery without increasing the PostgreSQL attempt count. SQS receive count still controls the three-delivery limit.
8. After the last failed delivery, the message stays in the dead-letter queue until a person investigates it. Mango never automatically replays dead-letter work.

## Permanent account failures

Some failures should not use all three deliveries:

- Nylas `401` or `403` parks only that connection as `reauth_required`.
- Exact Nylas `404 grant.not_found` also parks only that connection as `reauth_required`.
- The known Google/Gmail setup `400` parks only that connection as `configuration_required`.
- If Mango cannot save that status change, it does not acknowledge SQS. The failure remains retryable instead of pretending the account was parked.
- A valid unrelated Nylas grant is never changed because another account failed.

Parked connections stop automatic provider work until a person fixes and reconnects them.

## Rare 10-minute reconciliation

Webhooks can occasionally be lost. Reconciliation is only the safety net:

1. EventBridge sends one control message about every 10 minutes.
2. If EventBridge cannot place that control message into SQS, it may retry that send twice within 5 minutes. This is separate from a worker job's three-delivery limit.
3. One control message reads at most 10 due connected accounts at a time.
4. One connection message reads at most one provider page of 200 messages at a time.
5. Reconciliation uses a 5-minute overlap around its saved checkpoint so a boundary event is not missed.
6. It skips disconnected, parked, `reauth_required`, and `configuration_required` connections.
7. Before the provider page, it performs one bounded read for markers at least 10 minutes old. It may resend an `accepted` ingestion identity only when `sqs_accepted_timestamp` is still null, and an archive item only while it is still `pending` with zero provider starts. Both reuse the existing identity.
8. It never resends ingestion whose SQS acceptance is recorded, or any work that has started processing, completed, parked, exhausted, or reached the dead-letter queue.
9. It never scans all accounts concurrently and never asks PostgreSQL for work every few milliseconds.

## Things this design intentionally does not have

- no 30-second Nylas account scanner;
- no 250-millisecond PostgreSQL ingestion worker;
- no 250-millisecond PostgreSQL archive worker;
- no SQS visibility heartbeat;
- no PostgreSQL delivery lease or reclaim timer;
- no custom retry scheduler;
- no automatic dead-letter replay;
- no process-local email worker fallback;
- no email bodies, attachments, or secrets inside SQS messages.

## Final cleanup shape before DEV rollout

- Every archive provider mutation is one compact SQS item. The single-message API archive route, non-background batch mode, API goroutine, and background switch are removed.
- Archive creation returns one durable job identity. After storing it, the browser performs one canonical status read to close a fast-completion race. If it is still active, a compact post-commit mailbox hint or subscription reacceptance triggers the next canonical read; no archive timer or full job payload enters Valkey.
- Attached-email thread completion uses that same mailbox hint and one canonical HTTP read, with no one-second timer.
- One ingestion-job API and one ingestion worker naming layer remain. Old download-job wrappers, claimant files, reconciliation enqueue residue, and delivery-era lease/scheduler columns are gone.
- `sqs_accepted_timestamp` distinguishes accepted ingestion from a marker that must be safely resent after cancellation or an ambiguous failure. Archive recovery is limited to an existing `pending` item with zero provider starts.
- The worker and reconciliation schedule remain disabled by default until the human migration and staged DEV rollout.

## Required regression checks

- A valid signed webhook creates one stable job and one compact FIFO message.
- A duplicate webhook does not create duplicate provider work.
- SQS send failure does not return false success to Nylas.
- Success commits PostgreSQL and the realtime notice before deleting the SQS message.
- Temporary failure remains undeleted and receives at most three total deliveries.
- A fourth provider-processing attempt is impossible.
- A completed redelivery performs no second provider operation.
- Permanent `401`, `403`, exact `404 grant.not_found`, and known Gmail `400` failures park the exact connection and stop.
- Reconciliation finds a missed webhook but cannot recreate an existing or exhausted job.
- Idle email infrastructure performs no continuous PostgreSQL polling.
- The old 30-second and 250-millisecond loop functions and configuration do not exist.
- Every provider archive write goes through SQS; no public API path runs archive provider work in-process.
- Archive completion has one canonical read endpoint used by the browser.
- No attached-email browser state polls once per second for ingestion completion.
- Request cancellation reaches the PostgreSQL job creation and SQS send path without stranding a permanent marker.
- Rare reconciliation reuses old never-accepted ingestion IDs and old never-started archive item IDs, but cannot recreate started or terminal work.
- Old ingestion wrappers, dead enqueue helpers, obsolete delivery columns, and stale scanner documentation are removed.
