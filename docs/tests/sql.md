# Process Story: An idle email worker waits in SQS without polling PostgreSQL

The private email worker has an available processing slot
↓
The worker sends one ordinary HTTPS `ReceiveMessage` request to SQS
↓
AWS holds that request for up to 20 seconds and returns immediately if work arrives
↓
An empty response causes the worker to start the next long poll without running an email-job query in PostgreSQL
↓
When work arrives, the worker receives one compact job identity, starts the fixed visibility and work deadlines, and uses PostgreSQL only for that real job
↓
When all three processing slots are occupied, the worker asks SQS for nothing more until a slot becomes free

Last updated: 2026-08-09

## What the 20-second long poll is

The email worker uses an ordinary outbound HTTPS request to AWS SQS. It is not a WebSocket, a PostgreSQL scanner, a browser timer, or a Nylas request.

While the worker has free processing capacity:

1. The worker calls SQS `ReceiveMessage` for at most one message.
2. If the queue is empty, AWS keeps that request open for up to 20 seconds.
3. If a message arrives during that time, AWS returns it immediately. The worker does not wait for the full 20 seconds.
4. If no message arrives, AWS returns an empty response after about 20 seconds and the worker immediately starts another long poll.
5. The AWS client will normally reuse its underlying HTTPS connection. Each `ReceiveMessage` call is still a separate request; no WebSocket exists.
6. An empty response does not read or write an email ingestion job, email body, thread, attachment, or relationship in PostgreSQL.
7. When the worker is shutting down, cancellation closes the outstanding request and stops the loop.

The long poll is therefore a quiet wait inside AWS. It replaces rapid repeated empty checks; it does not move that checking into PostgreSQL.

## What happens when 100 messages are already waiting

DEV deliberately runs one private email worker task with three processing slots and no automatic scaling.

1. Because work is already available, SQS returns the first one-message receive immediately.
2. The worker starts that job and immediately receives another message while another slot is free.
3. The worker fills at most three processing slots.
4. Once all three slots are occupied, the receive loop waits for a slot instead of pulling more messages out of SQS.
5. When one job finishes, the worker immediately asks for one next message. A non-empty queue responds immediately, so the 20-second empty wait does not slow backlog processing.
6. Approximately three messages are in flight and the remainder stay safely visible in SQS. Exact counts are approximate because SQS metrics are distributed operational counters.
7. PostgreSQL is not scanned to find those remaining messages. SQS owns the backlog.

The rough best-case drain time for work spread across several email connections is:

`ceiling(number of jobs / 3) × average job duration`

This is only a capacity estimate. Provider latency, retries, and FIFO ordering can make individual jobs take longer.

## FIFO ordering by permanent email connection

The FIFO message group is the permanent `email_connection_id`.

1. Jobs for one email connection remain ordered and normally run one at a time.
2. Jobs for different email connections may use the three processing slots concurrently.
3. One hundred jobs for one connection are therefore mostly serialized.
4. One hundred jobs spread across at least three connections can use all three slots.
5. A failed message blocks later messages for its own connection while it is in flight, but unrelated connections can continue.

This prevents simultaneous provider mutations from racing within one mailbox without reducing safe concurrency across unrelated mailboxes.

## When the SQL job state changes

PostgreSQL is the permanent job truth, while SQS owns temporary delivery state.

1. `accepted` with a null `sqs_accepted_timestamp` means the durable Mango marker exists but SQS acceptance has not been confirmed.
2. `accepted` with a non-null `sqs_accepted_timestamp` means SQS accepted the stable job identity and the worker has not yet durably settled it.
3. `processing` means the worker received the SQS item and began the fenced provider attempt.
4. `completed`, `parked`, and `exhausted` are terminal database results.
5. The worker deletes the SQS message only after PostgreSQL commits the result and required realtime outbox event.
6. After deletion, the message is no longer inspectable in SQS; the PostgreSQL row remains the audit record.
7. An already-open DBeaver result grid is not live. Rerun or refresh the query before treating a displayed state as current.

An operator checking active work should include `sqs_accepted_timestamp`, `provider_attempt_count`, `last_error`, and timestamps instead of interpreting `status = 'accepted'` by itself.

## Visibility, deadline, retry, and DLQ rules

1. Time waiting visibly in SQS does not consume the visibility window or worker deadline.
2. Receipt starts the fixed 10-minute SQS visibility window.
3. Receipt also starts Mango's shorter 8-minute work deadline.
4. Mango never calls `ChangeMessageVisibility` and has no visibility heartbeat.
5. Success commits PostgreSQL first and then deletes the SQS message.
6. A retryable failure leaves the message undeleted. SQS can deliver it again after the visibility window.
7. SQS permits three total deliveries, not one delivery plus three more retries.
8. PostgreSQL refuses a fourth real provider-processing start.
9. After the third failed SQS delivery, AWS moves the message to the DLQ for deliberate human review. Mango does not replay it automatically.

## SQL and SQS regression laws

1. An empty 20-second SQS long poll must perform no email-job PostgreSQL read or write.
2. The SQS receiver must request one message with a 20-second long-poll wait.
3. The DEV worker must process at most three messages concurrently unless an intentional reviewed configuration change says otherwise.
4. The worker must stop receiving while all processing slots are occupied.
5. Backlogged messages must stay in SQS; they must not be claimed into a PostgreSQL delivery queue or lease table.
6. FIFO grouping must continue to use the permanent email connection identity.
7. Queue waiting time must not start the 10-minute visibility or 8-minute work deadline.
8. The browser must not replace post-commit realtime hints with one-second SQL or HTTP polling.
9. SQS messages and Valkey hints must contain compact safe identities only, never email bodies, attachments, tokens, credentials, secrets, or presigned URLs.
10. PostgreSQL must remain the durable result and idempotency truth, while SQS remains the delivery and backlog authority.
