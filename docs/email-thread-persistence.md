# Durable Node email threads

Mango stores imported email content in its own database so opening a Node does not depend on provider latency or availability.

## Storage model

- `communications_email_threads` is the stable Mango thread record. Provider identifiers are deduplicated inside an immutable mailbox scope: company plus personal user/account, or company plus shared inbox.
- `communications_email_messages` stores one stable Mango message row per provider message, ordered deterministically by provider timestamp and provider message ID.
- `communications_node_email_threads` links the selected imported message and its durable thread to a Node and its Node-wide Attached email projection.
- `communications_email_collaborations.email_thread_id`, `communications_email_nodes.email_thread_id`, and `communications_email_node_attachments.email_thread_id` reconcile existing projections with the durable authority.

Message rows retain the envelope, recipients, reply-to, timestamp, rich HTML body, snippet/text fallback, folder/read/starred state, and attachment metadata. They do not retain attachment bytes, provider credentials, temporary object URLs, or presigned URLs. Rich HTML remains subject to the existing sandboxed/sanitized email rendering boundary in the frontend.

## Import, text boxes, and reads

The Node-wide email column is the only place that displays an imported email or complete thread. A text box never embeds or duplicates that viewer.

Creating a collaboration Node from an email commits the canonical Attached email projection plus its durable thread/link. It intentionally creates no text box. The frontend also suppresses its ordinary automatic blank-text-box behavior for an email-only Node.

An explicit message/selection import into an existing Node may atomically commit the Attached email projection, durable thread/link, one linked text box, and an optional initial chat. The linked text box persists the exact `email_message_id` and `email_accent`; the optional chat points to that text-box ID. The ordinary Node toolbar plus button still creates a normal unlinked empty text box.

A Triage chat creates or reuses the text box linked to the exact discussed message before writing chat. Every new chat and chat attachment points to the real text-box information ID. Older chats stored against an Attached-email information ID remain readable for compatibility but are never a new write destination.

The selected message is persisted synchronously. Full provider-thread hydration is scheduled after commit and updates `hydration_status`, `history_complete`, `fetched_at`, and `last_hydration_error`.

Node and collaboration thread reads use Mango's stored messages by default. Provider access is reserved for explicit refreshes and background hydration, so stored content remains visible during provider outages.

## Rollout

Apply `backend/db/migrations/20260719_persist_node_email_threads.sql` through the normal human-reviewed database deployment process before deploying backend code that writes the durable-thread tables. Do not apply it from an agent session or directly to a live database. Existing Attached email rows can continue to render from their legacy snapshot; newly imported or explicitly refreshed threads populate the durable tables.

This workspace-composition correction adds no migration. It changes which existing projection types are created and how chat `block_id` is assigned.
