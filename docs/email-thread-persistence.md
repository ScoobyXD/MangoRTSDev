# Durable Node email threads

Mango stores imported email content in its own database so opening a Node does not depend on provider latency or availability.

## Storage model

- `email_threads` is the stable Mango thread record. Provider identifiers are deduplicated inside one exact personal email account or shared email account.
- `email_messages` stores one stable Mango message row per provider message inside that thread, ordered deterministically.
- `email_relationships` links an exact internal `email_message_id` to a Node, Project, Logic Gate, or exact textbox. A whole-resource link has a null `resource_textbox_id`.
- `email_ingestion_jobs` is the permanent company/connection/provider-message identity and provider-attempt result. SQS owns delivery, fixed visibility, redelivery, receive count, and DLQ movement.
- Email files use `attachments` plus exact `attachment_relationships` owners such as `email_message`, `email_draft`, or `email_signature`.

Message rows retain the envelope, recipients, reply-to, timestamp, rich HTML body, snippet/text fallback, folder/read/starred state, download-complete state, and attachment metadata. Ordinary files, inline CID images, and signature assets are copied once into Mango's private attachment object storage and linked to each authorized Node; bytes, provider credentials, temporary object URLs, and presigned URLs are never copied into Node JSON or job errors. Rich HTML remains immutable email content behind the existing sandboxed/sanitized rendering boundary.

## Import, text boxes, and reads

The Node-wide email column is the only place that displays an imported email or complete thread. A text box never embeds or duplicates that viewer.

Creating a Node from an email follows the ordinary Node workflow and inserts an exact `email_relationships` row. It intentionally creates no special collaboration owner or participant subsystem.

An explicit message/selection import into an existing Node may atomically persist the exact message, relationship, one final `node_textboxes` row, and an optional `node_textbox_chats` row. The relationship and chat hold exact internal message identities; the textbox owns only TipTap JSON.

A Triage chat creates or reuses the exact final textbox before writing the final chat row. Every new chat and chat attachment points to the real `textbox_id` or `chat_id`; no legacy chat reader or write destination remains.

The selected message is persisted synchronously and returned for immediate Node rendering. The same transaction creates or reuses the canonical ingestion identity, and the API sends that compact identity to SQS. The private worker processes one bounded item, skips complete messages/attachments, fences provider settlement with the exact attempt token, and updates `download_status`, `history_complete`, `fetched_at`, and `last_download_error`. There is no PostgreSQL claimant, lease, availability timer, or retry scheduler.

Attached-resource reads always use Mango's stored messages and attachments and normal resource permissions. While ingestion is incomplete, the browser waits for the compact post-commit mailbox hint and performs one canonical HTTP read; it never polls once per second. Nylas is used only by an authorized explicit import or the private SQS worker, so stored content remains visible during provider outages or after the source mailbox is disconnected.

## Identity and later messages

- A message is identified by immutable mailbox scope plus Nylas message ID. A thread is identified by that same scope plus Nylas thread ID, falling back to the message ID only when Nylas supplies no thread ID.
- Repeated webhooks, reconciliation, explicit imports, and SQS deliveries reuse existing rows and the same permanent ingestion identity. Completed messages and attachments are never downloaded twice. Subject, body, participants, and timestamp resemblance are never identity.
- A qualifying later provider message may arrive through a signed webhook or rare bounded reconciliation. Mango appends only missing message/files to the exact existing durable thread and recomputes deterministic order.
- A raw webhook creates no pre-ingestion mailbox hint. The worker publishes the compact hint only after durable provider truth and required typed relationships commit.
- `history_complete` means complete as observed by the canonical ingestion job, not permanently synchronized with future provider mail.

## Current rollout status

The V3 email copy and table retirement are complete. The pending DEV SQS migration still requires a human PostgreSQL 17 preflight and DBeaver apply before the disabled-by-default worker and reconciliation schedule can be staged. The ten retired `communications_email_*` tables must not be restored. Agents do not apply live SQL.
