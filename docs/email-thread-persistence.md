# Durable Node email threads

Mango stores imported email content in its own database so opening a Node does not depend on provider latency or availability.

## Storage model

- `communications_email_threads` is the stable Mango thread record. Provider identifiers are deduplicated inside an immutable mailbox scope: company plus personal user/account, or company plus shared inbox.
- `communications_email_messages` stores one stable Mango message row per provider message, ordered deterministically by provider timestamp and provider message ID.
- `communications_node_email_threads` links the selected imported message and its durable thread to a Node and Attached email projection.
- `communications_email_collaborations.email_thread_id`, `communications_email_nodes.email_thread_id`, and `communications_email_node_attachments.email_thread_id` reconcile existing projections with the durable authority.

Message rows retain the envelope, recipients, reply-to, timestamp, rich HTML body, snippet/text fallback, folder/read/starred state, and attachment metadata. They do not retain attachment bytes, provider credentials, temporary object URLs, or presigned URLs. Rich HTML remains subject to the existing sandboxed/sanitized email rendering boundary in the frontend.

## Import and reads

An import into an existing Node commits the Attached email projection, durable thread/link, linked text box, and optional initial chat in one backend transaction. The selected message is persisted synchronously. Full provider-thread hydration is scheduled after the commit and updates `hydration_status`, `history_complete`, `fetched_at`, and `last_hydration_error`.

Node and collaboration thread reads use Mango's stored messages by default. Provider access is reserved for explicit refreshes and background hydration, so stored content remains visible during provider outages.

The ordinary Node toolbar plus button creates a normal empty text box. Only an explicit email action supplies `email_message_id` and `email_accent`.

## Rollout

Apply `backend/db/migrations/20260719_persist_node_email_threads.sql` through the normal human-reviewed database deployment process before deploying backend code that writes the new tables. Do not apply it from an agent session or directly to a live database. Existing Attached email rows can continue to render from their legacy snapshot; newly imported or explicitly refreshed threads populate the durable tables.
