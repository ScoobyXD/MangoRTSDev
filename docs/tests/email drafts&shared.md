# Email Draft Business Logic Laws

1. Mango stores personal email drafts and Node-shared email drafts in the existing `email_drafts` table; it does not create a second draft table or use provider Drafts as application state.
2. Every draft is exactly one of two collaboration scopes: personal or Node-shared. `email_drafts.owner_user_id` is non-null only for a personal draft; `node_id` and `node_textbox_id` are non-null only for a Node-shared draft; a database check enforces exactly one shape.
3. A personal draft belongs to one exact user, one exact sending-account scope, and, for a reply, one exact internal source email message. The sending account may be the user's personal mailbox or a shared inbox, but the draft remains owner-only.
4. Only the personal draft owner may list, open, edit, send, or discard that draft. Opening the source email through a Node or shared mailbox does not share the personal draft.
5. `Reply` and `Reply All` always create or reopen the current user's personal draft for the exact source message and sending-account scope.
6. Partial unique indexes enforce at most one active personal reply draft for the same owner, source message, and exact personal-account or shared-inbox sending scope. Active means non-deleted with `send_state` equal to `draft` or `sending`.
7. `Create Shared Draft` is the only action that creates or reopens a Node-shared draft. Reply and Reply All never create a Node-shared draft implicitly.
8. A Node-shared draft belongs to one exact Node, one exact email thread, one exact source email message, and one dedicated Node text box through direct same-company foreign keys.
9. A partial unique index enforces at most one active Node-shared draft for the same exact Node and email thread. Sent and soft-deleted rows do not block a later deliberate draft.
10. The same email thread may have separate Node-shared drafts in separate Nodes. Content or activity in one Node's draft never appears in another Node's draft.
11. A personal draft and a Node-shared draft for the same source message may exist at the same time and never automatically copy, merge, overwrite, delete, or convert each other.
12. Creating a Node-shared draft outside a Node requires the user to choose one existing accessible Node that already contains the thread, then opens that Node's dedicated draft text box. Mango never guesses a Node, creates a thread-wide draft, or lists a Node-shared draft in a My Triage or Shared Triage Drafts tab.
13. The first Node-shared-draft command atomically creates the draft and its dedicated Node text box, or creates neither.
14. `email_drafts` is the authority for stable `draft_id`, owner-or-Node scope, `email_thread_id`, `source_email_message_id`, sending-account scope, recipients, subject, editor body, revision, send claim/idempotency state, `sent_email_message_id`, timestamps, and soft deletion.
15. The dedicated `node_textboxes` row is the authority for the Node-local panel, placement, title, color, and chat container. It does not store a second authoritative copy of email recipients, subject, or body.
16. A Node-shared draft uses direct `node_id` and `node_textbox_id` values from `nodes` and `node_textboxes`. The old presentation-only `origin_node_id` contract is removed rather than retained beside the authoritative Node identity. Mango does not create a generic relationship, surrogate resource ID, participant table, or copied permission grant.
17. Current access to the exact Node authorizes viewing its Node-shared drafts and editing or discarding only an active one under the existing Node permission rules. Losing Node access immediately removes shared-draft access.
18. Node access never grants mailbox credentials or send authority. Sending also requires current authorization for the exact selected sending account.
19. The selected **From** account must be connected, authorized for the sender, and valid for the draft's immutable source mailbox scope when send is claimed.
20. Every reply draft keeps the immutable internal `source_email_message_id`; sending loads the canonical source from `email_messages` and validates that it belongs to the stored thread.
21. Mango never sends from a duplicated reply-source JSON snapshot and never falls back to a guessed provider message, latest thread message, subject match, or body match.
22. Provider account, grant, thread, and message identifiers remain exact mailbox-scoped metadata and are never used as cross-mailbox resource identities.
23. Draft editing reuses Mango's existing TipTap editor and JSON conversion conventions, the existing draft revision field, and the existing realtime outbox, subscription, and live-update paths.
24. The implementation must not add another editor framework, websocket path, polling loop, lock service, operational-transform engine, merge engine, or collaboration state store for email drafts.
25. Every shared-draft update, send, and discard command compares the expected revision. A stale command fails with the canonical current revision and cannot overwrite newer content.
26. An open Node-shared editor applies canonical live updates through the existing subscription path. Unsaved local content must remain visible for deliberate review after a stale-write conflict.
27. Draft attachments use the existing `attachments` and `attachment_relationships` rows with the exact `email_draft` resource type and stable `draft_id`; file bytes never enter draft JSON.
28. A draft has only the existing `draft`, `sending`, and `sent` send states. While `sending`, body, recipient, account, and attachment mutations are frozen.
29. A successful send creates the exact sent `email_messages` row, records its ID on the draft, changes the draft to `sent`, and keeps that draft as a frozen readable record.
30. A sent draft cannot be edited, sent again, or discarded. The sent email follows the normal same-thread ingestion and Node-wide message relationship rules.
31. Discard uses the existing soft-deletion field and removes only the exact personal draft or exact Node-shared draft. It never deletes the Node, text box, chat, source email, sent email, thread, or the other draft scope.
32. Closing a personal composer or Node-shared-draft panel does not discard the draft.
33. Chat about a Node-shared draft belongs to its dedicated Node text box and uses the existing `node_textbox_chats` system, mentions, revisions, and realtime delivery.
34. A chat selection from draft text must identify the exact Node-shared draft directly, preserve the selected quote and offsets, and never pretend that unsent draft text is an `email_message`.
35. Removing one Node's email relationship does not delete that Node's existing shared draft, dedicated text box, or chat. It removes only the exact email relationship and its relationship-derived source-email access.
36. Recycling a Node preserves its Node-shared drafts with that Node. Permanently deleting the Node removes its Node-scoped drafts, dedicated text boxes, chats, and draft-only attachment relationships without deleting the normalized source thread, source messages, or sent messages.
37. The cutover is forward-only. An ordinary shared-inbox draft becomes owner-only only when its stored creator identifies one valid current owner. An active thread-wide shared draft may use only its one valid stored origin Node. Any ambiguous row stops migration for explicit human resolution; Mango never guesses an owner or Node, copies one draft to several Nodes, or keeps a legacy fallback.

Last updated: 2026-08-11

# Process Story: Personal work stays personal and shared work stays inside one Node

A user chooses Reply or Reply All and resumes only that user's exact personal draft
↓
The user may instead choose Create Shared Draft and nominate one Node that already contains the thread
↓
Mango creates or reopens that Node's one shared draft and dedicated text box, where current Node users edit and chat through the existing revision and realtime paths
↓
Only a user authorized for the selected sending account may send; success freezes the sent draft and adds the sent message to the existing thread

## Scenario 1: Personal and Node-shared drafts coexist

- Alice chooses Reply in Node A, then chooses Create Shared Draft for the same message in Node A.
- Her personal draft remains visible only to Alice; the shared draft is visible to current users of Node A.
- Editing, sending, or discarding either draft does not mutate the other.

## Scenario 2: One thread exists in two Nodes

- The same stored thread is attached to Node A and Node B.
- Creating a shared draft in Node A creates or reopens only Node A's draft and dedicated text box.
- Node B shows no Node A draft. Creating a shared draft in Node B creates a separate draft with separate content, revision, attachments, chat, and send lifecycle.

## Scenario 3: Concurrent edit and send

- Alice and Bob open the same Node-shared draft through Node A and receive updates through the existing live subscription.
- Alice saves a newer revision; Bob's stale edit or send fails with the canonical revision and cannot overwrite or send Alice's version.
- An authorized current-revision send uses the existing safe-send claim and idempotency rules, then preserves the draft as frozen `sent` state.
