# Email Draft and Node Reply Business Logic Laws

1. Mango stores personal and Node-shared drafts only in `email_drafts`, and `email_drafts.is_shared` explicitly states whether each draft is shared.
2. The only reply entry actions are **Reply** and **Reply all**.
3. Reply is available only when the exact source email already has an internal `email_message_id`; Mango does not import mail when Reply is clicked.
4. Opening the reply scope chooser creates no draft. Mango creates or reopens a draft only after the user chooses **My draft** or **Shared draft**.
5. A personal draft belongs to one exact creator, one exact sending-account scope, and one exact internal source message.
6. Only the personal draft creator may list, open, edit, send, or discard that personal draft.
7. A Node-shared draft belongs directly to one exact Node, one exact stored email thread, and one exact internal source message.
8. Current permission to view the exact Node permits viewing and editing that Node's shared draft; a collaboration ID is never required or accepted as draft authority.
9. The same source message in another Node has a separate shared draft.
10. Mango permits at most one active shared draft for one Node and source message. Concurrent create commands both return that one draft instead of returning an internal error.
11. Personal and shared drafts for the same source message may coexist and never copy, convert, merge, overwrite, or delete each other automatically.
12. A shared draft stores one scalar **From** account. Everyone who can edit the Node may edit the shared draft, but they do not collectively become the sender.
13. The shared draft's stored **From** account does not change after creation, and sending requires current authorization for that exact connected account.
14. The reply editor contains From, To, Cc, Bcc, Subject, body, attachments, signature content, save status, and Send.
15. Reply targets the canonical reply address. Reply all de-duplicates recipients, excludes the sending account, and handles sent messages by retaining the original To and Cc recipients.
16. Signature content uses the existing account-scoped signature loader, is applied at most once per reply session, and is saved in the draft body.
17. Draft attachments use the existing `attachments` and `attachment_relationships` rows with resource type `email_draft` and the stable `draft_id`.
18. Attachment bytes and previews load only when the user explicitly opens or downloads that attachment.
19. Draft edits are debounced for 500 ms and show Saving, Saved, or Save failed. Typing never reloads email messages, threads, other drafts, the Node page, or attachment bytes.
20. Opening a Node loads no shared-draft bodies or attachments. Opening the shared-draft list loads at most five summaries, and scrolling loads the next five.
21. Opening one draft loads only that exact draft's body and attachment relationships.
22. A collapsed email thread loads no message detail. Opening the thread loads lightweight headers and snippets, and opening one message loads only that exact message body and attachment metadata.
23. Live email updates refresh lightweight thread summaries and preserve message details already loaded by the user.
24. Shared-draft updates, sends, and discards compare the expected revision. A stale command cannot overwrite or send a newer revision.
25. Closing the reply surface does not discard a draft. Discard is an explicit soft delete of the exact selected draft only.
26. Every reply draft keeps the immutable internal `source_email_message_id`. Save and send validate that exact stored source, its exact stored thread, and its exact Node when shared.
27. Missing sources, Node mismatches, denied Node access, disconnected senders, stale revisions, and invalid fields return separate error codes.
28. Shared sends reuse the existing durable send claim and provider idempotency path. Draft content and attachments are frozen while the draft is sending.
29. Every outbound reply uses Mango's existing 10-second safe-send controller with the decreasing bar, **Send now**, and **Undo**.
30. A successful send records the exact normalized sent message in the same stored thread, promotes the draft attachment relationships to that message, and retires the draft.
31. Mango blocks removal of a Node email relationship when that Node and thread have a textbox link, email-selection chat, or active shared draft.
32. Mango permits removal only when the Node email relationship has no such Node-local work, and removal never deletes the stored message or thread.
33. Permanently deleting a Node cascades its Node-scoped shared drafts.
34. The schema cutover is forward-only and never guesses missing Node, source-message, owner, or sending-account identities.

Last updated: 2026-08-13

# Process Story

The user opens a stored email and chooses Reply or Reply all
↓
Mango shows the scope chooser without creating a draft
↓
The user chooses My draft or Shared draft
↓
Mango creates or reopens only that exact draft and loads only its required data
↓
Edits autosave without refreshing email or thread data
↓
Send enters the existing 10-second safe-send gate
↓
An authorized send records the reply in the existing stored thread

## Scenario 1: Mail not stored yet

- Alice sees a provider-only message in triage.
- Reply and Reply all are unavailable because it has no internal `email_message_id`.
- Viewing the message does not import it as a side effect.

## Scenario 2: Two users create one shared draft

- Alice and Bob choose Shared draft for the same Node and source message at the same time.
- The database creates one draft.
- Both commands return that same draft and neither user receives an internal error.

## Scenario 3: Removing an email with Node work

- A thread in Node A has a linked textbox, email-selection chat, or active shared draft.
- Removing that email relationship returns `email_removal_has_node_work` and changes nothing.
- A relationship with no Node-local work may be removed normally.
