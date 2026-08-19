# Email Draft Business Logic Laws

1. My Triage, Shared Triage, Node, and Project Reply use the same durable owner-only mailbox draft; no surface creates a Node-owned, Project-owned, shared, or collaborative email draft.
2. An authorized Node or Project user sees Reply only on an exact ingested message whose attached projection retains one exact source mailbox; those surfaces expose no Reply all, Forward, draft chooser, or scheduling control.
3. Opening, expanding, refreshing, or navigating Node or Project email creates no draft. Clicking Reply immediately ensures the current user's exact owner draft and opens it, while a message with that draft shows **My Draft** and exact-hydrates it only when clicked.
4. Node email views retain received-message bodies, received attachments, thread expansion, exact-message lazy loading, highlights, email-selection chats, and exact email-to-Node and email-to-text-box relationships.
5. Every Reply and Reply all requires an internal `email_message_id`; Node and Project likewise enable Reply only when the displayed source has that ingested identity and stored exact-mailbox provenance, and clicking Reply never imports a provider-only message.
6. One reply draft is identified by company, creator, exact personal-account or shared-inbox sending scope, and exact internal source message; kind is not a separate uniqueness dimension. `POST /v1/communications/drafts` with `kind=reply` validates the source and sender, assigns the draft ID on the server, and returns the existing matching draft unchanged when one already exists.
7. A Shared Triage draft remains owner-only even though its sending account belongs to a shared inbox; shared-inbox access never makes another user's draft collaborative.
8. Only the draft creator with current authorization for its exact personal account or Shared Inbox may list, open, edit, send, schedule, or discard that draft; Node or Project access and company manager/admin status are never substitutes.
9. New compose, Reply, Reply all, Forward, My Drafts listing/search/order, and scheduling retain their existing My Triage or Shared Triage behavior.
10. Every durable Reply composer retains From, To, Cc, Bcc, Subject, rich body, attachments, signature content, save status, and Send; Node and Project keep Reply-only action scope.
11. Reply targets the canonical reply address. Reply all de-duplicates recipients, excludes the sending account, and retains the original To and Cc recipients when replying to a sent message.
12. Signature content uses the existing mailbox-scoped signature loader, is applied at most once per compose session, and is saved in the same durable owner draft on every Reply surface.
13. Draft attachments use the existing `attachments` and `attachment_relationships` rows with resource type `email_draft` and the stable `draft_id`.
14. Attachment bytes and previews load only when the user explicitly opens or downloads that attachment.
15. Reply edits use the same 500-millisecond autosave of only the exact draft; typing never reloads email threads, other drafts, a Node or Project page, or attachment bytes. A normal Node or Project reply-pane unmount flushes and queues one final exact save, while a failed save in a still-mounted pane stays visible with an explicit **Retry save** action and never starts an automatic retry loop.
16. A visible message list may issue body-free Reply-draft indicator requests, each limited to at most 100 internal source-message IDs in one exact mailbox scope. Those requests return only the current user's matching draft metadata without bodies or attachment relationships; opening **My Draft** loads only that exact draft and its attachment relationships.
17. Closing a compose surface does not discard its draft. Discard is an explicit soft delete of the exact selected draft only.
18. Every reply draft keeps its immutable internal source-message identity. The server derives its sender and reply target from that ingested source, and save and send validate the exact stored source and sending scope instead of trusting a substituted client identity.
19. Missing sources, disconnected senders, denied mailbox access, and invalid fields return separate error codes.
20. Every outbound Triage, Project, or Node reply uses Mango's existing ten-second safe-send controller with the decreasing bar, **Send now**, and **Undo**.
21. A due My Triage or Shared Triage scheduled draft loads that one exact draft body, reply target, and attachments before it enters the existing send path.
22. A successful Reply send records the normalized sent message in the same stored thread, promotes the draft attachment relationships to that message, and deletes the draft. Node and Project close the reply only after that exact cleanup succeeds; an already-missing draft counts as cleaned up, while another cleanup failure leaves the mounted reply send-disabled with **Retry cleanup**. Normal wide Node/Project destination inheritance still applies; the open surface appends the returned sent message locally, and Node retains its existing exact thread-cache invalidation without adding a Project cache or query path.
23. A Node-wide email relationship cannot be removed while that Node and thread have a text-box relationship or email-selection chat; otherwise the relationship may be removed without deleting the stored message or thread.
24. Removing or deleting a Node or Project never deletes an owner-only mailbox draft merely because its source thread appeared there. Drafts use authenticated HTTP only: no draft relationship, collaboration participant, WebSocket scope, polling loop, send lease, or send-attempt state machine is added.

Last updated: 2026-08-18

# Process Story

The user opens an ingested message in Triage, Project, or a Node and chooses an action available on that surface
↓
Reply ensures or reopens the user's one exact mailbox-scoped owner draft on every surface
↓
The user edits the fields supported by that surface through the shared rich composer
↓
The exact draft autosaves after 500 milliseconds without reloading its thread, other drafts, or attachments
↓
Send enters the existing ten-second safe-send gate and records the reply in the stored thread

## Scenario 1: Provider-only message

- Alice sees a provider-only message in Triage.
- Reply and Reply all are unavailable because the message has no internal `email_message_id`.
- Viewing the message does not import it as a side effect.

## Scenario 2: Email opened inside a Node

- Bob opens the same stored thread from a Node.
- Bob may read its messages and received attachments and use its text-box, highlight, and chat relationships.
- Each exact ingested message offers **Reply**, or **My Draft** when Bob already owns its reply draft; clicking either opens the same rich owner-draft composer with read-only From and editable To, Cc, Bcc, Subject, body, and attachments.
- The Node exposes no Reply all, Forward, shared/collaborative draft, or scheduling action, and ordinary viewing performs only bounded exact-mailbox draft-indicator requests for the displayed ingested messages.

## Scenario 3: Removing an email with Node-local work

- A thread in Node A has a text-box link or email-selection chat.
- Removing that email relationship returns `email_removal_has_node_work` and changes nothing.
- A relationship with no Node-local text-box or chat work may be removed normally.
