# Email Draft Business Logic Laws

1. My Triage and Shared Triage keep their existing personal drafts, while Node and Project use one shared frontend/backend path for **My Draft** and one resource-shared **Shared Draft** Reply on an exact attached message.
2. Node and Project shared drafts are Reply-only. They add no Reply all, Forward, scheduling, realtime co-editing, presence, CRDT, background worker, polling, lease, or durable send-attempt state machine.
3. Opening, expanding, refreshing, or navigating Node or Project email creates no draft and loads no draft body or attachment relationship. Only **My Draft**, **Shared Draft**, or its matching create action opens a composer.
4. Node and Project email views retain received bodies and attachments, thread expansion, exact-message lazy loading, highlights, chats, navigation, and exact email-to-resource and email-to-text-box relationships.
5. Every Reply requires an internal `email_message_id` and stored exact-mailbox provenance. A provider-only message cannot create a Node or Project draft as a viewing side effect.
6. A personal Reply draft keeps its existing identity: company, creator, exact personal-account or shared-inbox sending scope, and exact internal source message. It remains owner-only.
7. A resource-shared Reply draft is identified only by company, exact owning Node or Project, and exact internal source message. Its creator is audit metadata, and the personal and resource-shared drafts may coexist.
8. Effective Edit access to the exact owning Node or Project is required to list, summarize, open, create, edit, attach to, or discard its resource-shared draft. Every server command rechecks that access.
9. Shared-draft editing does not grant sending authority. Send is available only when the actor also currently owns the exact personal mailbox or currently has exact Shared Inbox send/Edit authority, and the server rechecks that authority at send time.
10. New compose, personal Reply, Reply all, Forward, My Drafts pagination/search/order, scheduling, and ordinary personal sends keep their existing Triage behavior.
11. Personal and resource-shared Reply use the existing rich composer with From, To, Cc, Bcc, Subject, rich HTML body, attachments, signature content, save status, and Send.
12. Reply targets the canonical reply address. Reply all remains a personal Triage action that de-duplicates recipients and excludes the sending account.
13. Signature content uses the existing mailbox-scoped signature loader, is applied at most once per compose session, and is saved in the exact opened draft.
14. Every draft attachment uses the existing `attachments` and `attachment_relationships` rows with resource type `email_draft` and the stable `draft_id`; attachment bytes load only on explicit open or download.
15. One autosave controller owns each mounted composer path. A text autosave sends only the exact draft's changed text fields and expected revision, performs one bounded authorize/update, and never rehydrates attachment relationships.
16. Every resource-shared text edit and attachment mutation uses optimistic revision checking. A stale revision returns one clear HTTP 409 conflict and never starts an automatic reload or retry loop.
17. Normal composer unmount flushes the latest unsaved edit once so acknowledged navigation cannot lose typing. A still-mounted failed save remains visible with an explicit retry action.
18. Each Node or Project message header keeps two compact vertical stacks: **Create New** above **Go to the associated text box** when one exists on the left, and **My Draft** above **Shared Draft** on the right. A separate **1** appears only beside the exact draft that exists.
19. Thread headers show separate personal and shared draft totals. One bounded body-free grouped read supplies all visible exact-message indicators and thread totals; it never requests one draft per message and never polls.
20. The lower action row in My Emails and Shared Emails contains four equal controls: **Compose**, **My Drafts**, **Shared Drafts**, and **Archive & next**. **Shared Drafts** lists body-free summaries for accessible Node and Project shared drafts in the selected exact mailbox.
21. Opening a draft from a message, thread, or summary loads only that exact draft and its attachment relationships. Closing preserves it; discard explicitly soft-deletes only that exact draft.
22. Every Reply draft keeps its immutable source-message identity. The server derives sender and reply target from the ingested source and never trusts browser-supplied resource or mailbox authority.
23. Missing sources, disconnected senders, denied resource or mailbox access, stale revisions, and invalid fields return distinct errors.
24. Every outbound Triage, Project, or Node reply uses Mango's existing ten-second safe-send controller with the decreasing bar, **Send now**, and **Undo**. Personal scheduled sends remain unchanged; shared drafts cannot be scheduled.
25. A successful send uses the existing provider and persistence tail, records the normalized sent message in the same thread, promotes draft attachment relationships to that message, and deletes the draft before closing the composer.
26. Removing an allowed Node-wide or Project-wide email relationship, or deleting its owning resource, retires that exact resource-shared draft and its draft attachment links. Personal drafts, stored messages, other resource drafts, and attachments with another live owner survive; existing textbox/chat dependency guards still apply.

Last updated: 2026-08-19

# Process Story

The user opens an exact ingested message in a Node or Project
↓
**My Draft** opens the user's personal Reply, while **Shared Draft** opens the one Reply owned by that exact resource and message
↓
The shared rich composer saves the exact draft through one autosave controller and checks the shared revision
↓
Send rechecks the actor's exact mailbox authority and enters the existing ten-second safe-send gate
↓
Success records the reply in the stored thread, promotes attachment links, and removes the sent draft

## Scenario 1: Provider-only message

- Alice sees a provider-only message in Triage.
- Reply and Reply all are unavailable because the message has no internal `email_message_id`.
- Viewing the message does not import it as a side effect.

## Scenario 2: Two editors share one Node Reply

- Alice and Bob both have effective Edit access to the Node.
- Alice creates its exact **Shared Draft**; Bob opens and edits the same draft because the creator is not its identity.
- Bob has no authority for the source mailbox, so he may edit but cannot send; Alice may send after the server rechecks her sender authority.
- Alice's separate personal **My Draft** may coexist, and the message and thread show separate personal and shared indicators.

## Scenario 3: Removing an email with Node-local work

- A thread in Node A has a text-box link or email-selection chat.
- Removing that email relationship returns `email_removal_has_node_work` and changes nothing.
- A relationship with no Node-local text-box or chat work may be removed normally; its exact resource-shared draft and draft attachment links are retired, while every personal draft and independently owned attachment survives.
