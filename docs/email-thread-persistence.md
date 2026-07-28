# Durable Node email threads

Mango stores imported email content in its own database so opening a Node does not depend on provider latency or availability.

## Storage model

- `communications_email_threads` is the stable Mango thread record. Provider identifiers are deduplicated inside an immutable mailbox scope: company plus personal user/account, or company plus shared inbox.
- `communications_email_messages` stores one stable Mango message row per provider message, ordered deterministically by provider timestamp and provider message ID.
- `communications_node_email_threads` links the selected imported message and its durable thread to a Node and its Node-wide Attached email projection.
- `communications_email_collaborations.email_thread_id`, `communications_email_nodes.email_thread_id`, and `communications_email_node_attachments.email_thread_id` reconcile existing projections with the durable authority.
- `communications_email_thread_download_jobs` is the durable pending/processing/retry/completed/failed work record. Partial unique indexes allow one active full-thread job per thread and one active selected-message job per thread/message.

Message rows retain the envelope, recipients, reply-to, timestamp, rich HTML body, snippet/text fallback, folder/read/starred state, download-complete state, and attachment metadata. Ordinary files, inline CID images, and signature assets are copied once into Mango's private attachment object storage and linked to each authorized Node; bytes, provider credentials, temporary object URLs, and presigned URLs are never copied into Node JSON or job errors. Rich HTML remains immutable email content behind the existing sandboxed/sanitized rendering boundary.

## Import, text boxes, and reads

The Node-wide email column is the only place that displays an imported email or complete thread. A text box never embeds or duplicates that viewer.

Creating a collaboration Node from an email commits the canonical Attached email projection plus its durable thread/link. It intentionally creates no text box. The frontend also suppresses its ordinary automatic blank-text-box behavior for an email-only Node.

An explicit message/selection import into an existing Node may atomically commit the Attached email projection, durable thread/link, one linked text box, and an optional initial chat. The linked text box persists the exact `email_message_id` and `email_accent`; the optional chat points to that text-box ID. The ordinary Node toolbar plus button still creates a normal unlinked empty text box.

A Triage chat creates or reuses the text box linked to the exact discussed message before writing chat. Every new chat and chat attachment points to the real text-box information ID. Older chats stored against an Attached-email information ID remain readable for compatibility but are never a new write destination.

The selected message is persisted synchronously and returned for immediate Node rendering. The same transaction creates or reuses a database-backed job for downloading the rest of the email thread. Workers lease that job, retry transient failures, skip complete messages/attachments, and update `download_status`, `history_complete`, `fetched_at`, and `last_download_error`.

Node and collaboration thread reads always use Mango's stored messages and attachments. A collaborator read never calls Nylas. Nylas is used only while handling an authorized explicit import or its durable rest-of-thread job, so stored content remains visible during provider outages or after the source mailbox is disconnected.

## Identity and later messages

- A message is identified by immutable mailbox scope plus Nylas message ID. A thread is identified by that same scope plus Nylas thread ID, falling back to the message ID only when Nylas supplies no thread ID.
- Repeated/concurrent imports reuse existing rows and active jobs. Completed messages and attachments are never downloaded twice. Subject, body, participants, and timestamp resemblance are never identity.
- A later message in a previously stored thread is added only when a user explicitly imports that exact Nylas message. Mango appends only that missing message/files to the existing durable thread and recomputes deterministic order.
- Nylas webhooks may invalidate a user's mailbox-list cache, but they never add messages to a Node thread or enqueue a Node download. This version has no periodic Node-thread reconciliation.
- `history_complete` means complete as observed by the user-initiated download job, not permanently synchronized with future provider mail.

## Rollout

Apply `backend/db/migrations/20260719_persist_node_email_threads.sql` and the later durable-download-job migration through the normal human-reviewed database deployment process before deploying backend code that writes these tables. Do not apply either migration from an agent session or directly to a live database. Existing Attached email rows can continue to render from their legacy snapshot; new explicit imports populate and extend the durable tables.

The worker rollout must start only after the schema migration is applied. During a rolling deploy, enqueue remains safe and duplicate-proof; workers may claim only rows in the migrated durable job table.
