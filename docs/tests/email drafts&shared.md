# Email Draft Business Logic Laws

1. Mango creates, opens, edits, sends, and discards durable email drafts only from My Triage, Shared Triage, and the retained Project attached-email reply surface.
2. A user with Node edit access sees Reply only on an exact ingested message whose attached projection retains one exact source mailbox; the Node exposes no Reply all, Forward, draft chooser, durable or shared draft, scheduling control, or outgoing attachment control.
3. Opening, expanding, refreshing, or navigating Node email performs no draft operation; clicking Reply creates only an in-memory composer for that exact message and never saves or autosaves a draft.
4. Node email views retain received-message bodies, received attachments, thread expansion, exact-message lazy loading, highlights, email-selection chats, and exact email-to-Node and email-to-text-box relationships.
5. Triage Reply and Reply all require an internal `email_message_id`; the Node UI likewise enables Reply only when the displayed source has an internal `email_message_id` and stored exact-mailbox provenance, and clicking Reply never imports a provider-only message.
6. A reply draft belongs to one exact creator, one exact sending-account scope, and one exact internal source message.
7. A Shared Triage draft remains owner-only even though its sending account belongs to a shared inbox; shared-inbox access never makes another user's draft collaborative.
8. Only the draft creator may list, open, edit, send, schedule, or discard that draft.
9. New compose, Reply, Reply all, and Forward retain their existing My Triage or Shared Triage mailbox scope.
10. The Triage composer retains From, To, Cc, Bcc, Subject, body, attachments, signature content, save status, scheduling, and Send.
11. Reply targets the canonical reply address. Reply all de-duplicates recipients, excludes the sending account, and retains the original To and Cc recipients when replying to a sent message.
12. Signature content uses the existing mailbox-scoped signature loader, is applied at most once per compose session, and is saved in the body on draft-backed surfaces. Node Reply keeps the signed body only in memory until send and hydrates existing signature images read-only without gaining attachment-write context.
13. Draft attachments use the existing `attachments` and `attachment_relationships` rows with resource type `email_draft` and the stable `draft_id`.
14. Attachment bytes and previews load only when the user explicitly opens or downloads that attachment.
15. Durable draft edits use the established Triage autosave path; Node Reply has no save or autosave path, and typing in either surface never reloads email threads, other drafts, a Node page, or attachment bytes.
16. Opening a draft list returns summaries without eagerly loading every draft body or attachment relationship; opening one draft loads only that exact draft and its attachment relationships.
17. Closing a compose surface does not discard its draft. Discard is an explicit soft delete of the exact selected draft only.
18. Every reply draft keeps its immutable internal source-message identity, and save and send validate that exact stored source and sending scope.
19. Missing sources, disconnected senders, denied mailbox access, and invalid fields return separate error codes.
20. Every outbound Triage, Project, or Node reply uses Mango's existing ten-second safe-send controller with the decreasing bar, **Send now**, and **Undo**.
21. A due My Triage or Shared Triage scheduled draft loads that one exact draft body, reply target, and attachments before it enters the existing send path.
22. A successful durable-draft send records the normalized sent message in the same stored thread, promotes the draft attachment relationships to that message, and retires the draft. A successful draftless Node Reply persists and appends the returned sent message without draft cleanup; normal wide Node/Project destination inheritance still applies, and the client invalidates only that exact Node/thread summary and full-read cache.
23. A Node-wide email relationship cannot be removed while that Node and thread have a text-box relationship or email-selection chat; otherwise the relationship may be removed without deleting the stored message or thread.
24. Removing or deleting a Node never deletes an owner-only My Triage, Shared Triage, or Project reply draft merely because its source thread appeared in that Node.

Last updated: 2026-08-17

# Process Story

The user opens an ingested message in Triage, Project, or a Node and chooses an action available on that surface
↓
Triage and Project create or reopen the user's exact mailbox-scoped draft, while Node Reply creates only an in-memory exact-message composer
↓
The user edits the fields supported by that surface through the shared rich composer
↓
Only durable Triage or Project drafts autosave, and each autosave changes only that exact draft
↓
Send enters the existing ten-second safe-send gate and records the reply in the stored thread

## Scenario 1: Provider-only message

- Alice sees a provider-only message in Triage.
- Reply and Reply all are unavailable because the message has no internal `email_message_id`.
- Viewing the message does not import it as a side effect.

## Scenario 2: Email opened inside a Node

- Bob opens the same stored thread from a Node.
- Bob may read its messages and received attachments and use its text-box, highlight, and chat relationships.
- Each exact ingested message offers Reply, which opens an in-memory rich composer with read-only From and editable To, Cc, Bcc, Subject, and body.
- The Node exposes no Reply all, Forward, durable/shared draft, scheduling, or outgoing attachment action, and ordinary viewing performs no draft request.

## Scenario 3: Removing an email with Node-local work

- A thread in Node A has a text-box link or email-selection chat.
- Removing that email relationship returns `email_removal_has_node_work` and changes nothing.
- A relationship with no Node-local text-box or chat work may be removed normally.
