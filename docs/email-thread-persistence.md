# Durable Node email threads

Mango stores imported email content in its own database so opening a Node does not depend on provider latency or availability.

## Storage model

- `email_threads` is the stable Mango thread record. Provider identifiers are deduplicated inside one exact personal email account or shared email account.
- `email_messages` stores one stable Mango message row per provider message inside that thread, ordered deterministically.
- `email_relationships` links an exact internal `email_message_id` to a Node, Project, Logic Gate, or exact textbox. A whole-resource link has a null `resource_textbox_id`.
- `email_thread_download_jobs` is the durable pending/processing/retry/completed/failed work record. Partial unique indexes allow one active full-thread job per thread and one active selected-message job per thread/message.
- Email files use `attachments` plus exact `attachment_relationships` owners such as `email_message`, `email_draft`, or `email_signature`.

Message rows retain the envelope, recipients, reply-to, timestamp, rich HTML body, snippet/text fallback, folder/read/starred state, download-complete state, and attachment metadata. Ordinary files, inline CID images, and signature assets are copied once into Mango's private attachment object storage and linked to each authorized Node; bytes, provider credentials, temporary object URLs, and presigned URLs are never copied into Node JSON or job errors. Rich HTML remains immutable email content behind the existing sandboxed/sanitized rendering boundary.

## Import, text boxes, and reads

The Node-wide email column is the only place that displays an imported email or complete thread. A text box never embeds or duplicates that viewer.

Creating a Node from an email follows the ordinary Node workflow and inserts an exact `email_relationships` row. It intentionally creates no special collaboration owner or participant subsystem.

An explicit message/selection import into an existing Node may atomically persist the exact message, relationship, one final `node_textboxes` row, and an optional `node_textbox_chats` row. The relationship and chat hold exact internal message identities; the textbox owns only TipTap JSON.

A Triage chat creates or reuses the exact final textbox before writing the final chat row. Every new chat and chat attachment points to the real `textbox_id` or `chat_id`; no legacy chat reader or write destination remains.

The selected message is persisted synchronously and returned for immediate Node rendering. The same transaction creates or reuses a database-backed job for downloading the rest of the email thread. Workers lease that job, retry transient failures, skip complete messages/attachments, and update `download_status`, `history_complete`, `fetched_at`, and `last_download_error`.

Attached-resource reads always use Mango's stored messages and attachments and normal resource permissions. Nylas is used only while handling an authorized explicit import or its durable rest-of-thread job, so stored content remains visible during provider outages or after the source mailbox is disconnected.

## Identity and later messages

- A message is identified by immutable mailbox scope plus Nylas message ID. A thread is identified by that same scope plus Nylas thread ID, falling back to the message ID only when Nylas supplies no thread ID.
- Repeated/concurrent imports reuse existing rows and active jobs. Completed messages and attachments are never downloaded twice. Subject, body, participants, and timestamp resemblance are never identity.
- A later message in a previously stored thread is added only when a user explicitly imports that exact Nylas message. Mango appends only that missing message/files to the existing durable thread and recomputes deterministic order.
- Nylas webhooks may invalidate a user's mailbox-list cache, but they never add messages to a Node thread or enqueue a Node download. This version has no periodic Node-thread reconciliation.
- `history_complete` means complete as observed by the user-initiated download job, not permanently synchronized with future provider mail.

## Current rollout status

The final email copy, backend cutover, smoke checks, and development retirement are complete. The ten retired `communications_email_*` tables must not be restored. New imports, reads, jobs, drafts, signatures, relationships, and attachment access use only the final tables above. Other environments must follow the operator-gated order recorded in `docs/important tasks/v3table changes.md`; agents do not apply live SQL.
