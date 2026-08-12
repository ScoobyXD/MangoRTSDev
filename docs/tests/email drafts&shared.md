# Email Draft and Node Reply Business Logic Laws

1. Mango stores both personal drafts and Node-shared drafts in the existing `email_drafts` table. Provider Drafts are not application state, and there is no second Mango draft store.
2. The only reply entry actions are **Reply** and **Reply all**. From the Node email column, either action opens the exact source message in its existing linked text box or creates that one text box first when it does not exist.
3. Opening the reply scope chooser creates no email draft. A draft is created or reopened only after the user explicitly chooses **My draft** or **Shared draft**.
4. A linked text box is identified by the exact internal `email_message_id`. Mango reuses that existing message-to-text-box placement instead of creating a second composer, relationship registry, or draft panel.
5. A personal draft belongs to one exact creator, one exact sending-account scope, and one exact internal source message. A shared-inbox sending account does not make a personal draft visible to other shared-inbox members.
6. Only the personal draft creator may list, open, edit, send, or discard that draft. Node access and shared-inbox access do not weaken personal ownership.
7. A Node-shared draft belongs to one exact Node, one exact stored email thread, and one exact internal source message. The same source message in another Node is a separate shared draft.
8. One partial unique index permits at most one active shared draft for the same Node and source message. Separate partial unique indexes permit at most one active personal reply draft for the same creator, source message, and exact personal-account or shared-inbox scope.
9. Personal and Node-shared drafts for the same message may coexist. Mango never automatically copies, converts, merges, overwrites, or deletes one scope because the other scope exists.
10. Current access to the exact Node grants access to that Node's shared draft under Mango's existing Node permission model. Losing Node access immediately removes shared-draft access.
11. A shared draft stores one scalar **From** account selected when the draft is created. That sending identity is immutable for the life of the shared draft; collaborators do not collectively become the sender.
12. Node access grants draft collaboration only. It never grants mailbox credentials or send authority. Sending still requires current authorization for the draft's exact stored From account.
13. The inline reply UI uses Mango's existing elevated neuomorphic surface, colors, focus highlights, transitions, TipTap editor, and formatting controls. It contains From, To, Cc, Bcc, Subject, body, attachments, signature content, save status, and Send.
14. From is displayed inline as the one exact sending account. To, Cc, Bcc, Subject, body, and attachments are editable after the user chooses a draft scope.
15. Reply uses the canonical reply target. Reply all uses the existing recipient de-duplication rules and excludes the sending account.
16. Signature content uses the existing account-scoped signature loader and is applied at most once per reply session. It is saved as part of the draft body; no second signature state is added.
17. Draft attachments use the existing `attachments` and `attachment_relationships` rows with resource type `email_draft` and the stable `draft_id`. File bytes never enter draft JSON. Removing an attachment removes the exact draft attachment relationship.
18. Draft edits are debounced for 500 ms and show Saving, Saved, or Save failed. Typing does not reload the email message, the thread, other Node email threads, the Node page, or attachment bytes.
19. A collapsed email card loads no thread detail. Expanding one card loads only that card's thread. A linked text box resolves its one exact message directly and does not fan out across every email or thread attached to the Node.
20. Attachment bytes and previews are loaded only when the user explicitly opens or downloads that attachment. Thread expansion does not eagerly download every attachment body.
21. Mango adds no polling loop, alternate websocket, merge engine, lock service, duplicate editor, or duplicate collaboration state store for email drafts.
22. Shared-draft updates, sends, and discards compare the expected revision. A stale command cannot overwrite or send a newer revision; the local editor content remains visible with a failure state for deliberate recovery.
23. Closing the text box or reply surface does not discard either draft. Discard is an explicit soft delete of the exact selected draft only.
24. Every reply draft keeps the immutable internal `source_email_message_id`. Send loads the canonical stored source and validates its exact stored thread; it never guesses by subject, body, latest thread message, or provider ID alone.
25. Shared sends reuse the existing durable send claim and provider idempotency path. Body, recipient, account, and attachment mutations are frozen while the draft is in `sending` state.
26. Every outbound reply uses Mango's existing 10-second safe-send controller. The UI shows the decreasing progress bar, **Send now**, and **Undo**; all three actions control the same pending send.
27. A successful send creates or updates the exact normalized sent `email_messages` record, promotes the draft's attachment relationships to that message, and retires the active draft. It never deletes the source message or thread.
28. Permanently deleting a Node cascades its Node-scoped shared drafts. Deleting or losing one email relationship does not invent a new Node or copy the draft elsewhere.
29. The cutover is forward-only. Existing personal-account drafts may use their exact stored creator as owner. The migration retires attachment links and deletes only obsolete draft rows that lack an exact owner or an exact Node and source message; Mango never guesses, copies, or exposes those rows in a new scope.

Last updated: 2026-08-12

# Process Story

The user clicks Reply or Reply all on one exact email message
↓
Mango opens or creates that message's linked Node text box without creating a draft
↓
The user chooses My draft or Shared draft
↓
Mango creates or reopens only that exact scope and shows the full inline reply editor
↓
Edits autosave after 500 ms without refreshing message or thread data
↓
Send enters the existing 10-second safe-send gate with Send now and Undo
↓
An authorized send records the sent message in the existing normalized thread

## Scenario 1: Scope chooser creates nothing

- Alice clicks Reply on a message in Node A.
- Mango opens that message's linked text box and shows My draft and Shared draft.
- Until Alice chooses one, `email_drafts` is unchanged and the fields remain non-editable.

## Scenario 2: Personal and shared drafts coexist

- Alice chooses My draft and writes private notes.
- Later she opens the same reply and deliberately chooses Shared draft.
- Mango opens Node A's separate shared draft; it does not copy Alice's personal body into it.
- Other Node A users can edit the shared draft but cannot see Alice's personal draft.

## Scenario 3: One thread in two Nodes

- The same stored source message is linked in Node A and Node B.
- A shared draft created in Node A is visible only through Node A.
- Node B may create its own independent shared draft for the same source message.
