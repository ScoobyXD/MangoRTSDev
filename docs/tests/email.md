# Current Email Business Logic Laws

1. Email exists to distribute messages into useful Nodes, discuss exact messages in Node text boxes, and prepare mailbox-scoped replies in Triage or the retained Project reply surface.
2. Selecting a Node in the email Universal Linker adds the email to that existing Node.
3. Selecting a Logic Gate immediately creates a new email Node in that Logic Gate with priority **Not Assigned**.
4. Selecting a Project requires one Project Logic Gate choice, then creates a new email Node there with priority **Not Assigned**.
5. One stored email thread may belong to multiple Nodes, and one Node may contain multiple stored email threads.
6. Every newly ingested message inherits every Node-wide destination already used by its thread.
7. New-message ingestion never creates or copies a text-box relationship, chat, or draft.
8. An email thread never links to a text box; only an exact email message may do so.
9. One exact email message may link to at most one text box per Node and may link to a different text box in another Node.
10. Every email chat belongs to one exact Node, one exact text box in that Node, and one exact linked email message.
11. Chats about the same message in different Nodes remain separate.
12. Highlighting email text shows only **Turn highlighted email text into a chat** and writes nothing until the user chooses the exact destination and sends.
13. The first email-selection chat atomically links the exact message to the chosen text box, creating that text box only when required, then creates the chat.
14. If a triage thread has no Node, the first sent chat creates a floating Node with priority **Not Assigned** and no popup. If it has several Nodes, the user chooses one.
15. Clearing the quote or closing its unsent rail creates or deletes no database row.
16. My Triage and Shared Triage show one scrollable chat rail grouped only by exact Node and text box.
17. Each triage chat group header shows a clickable Node icon and Node title.
18. The chat rail opens automatically when the selected thread already has accessible chats, and the thread header owns its one manual toggle.
19. The chat rail borders align with the displayed message card.
20. Dragging an exact email message onto a Node text box links that message; dragging a thread is rejected.
21. Email and thread views inside a Node are read-only and expose no Reply, Reply all, draft, composer, signature, outgoing attachment, scheduling, or send control.
22. Opening a Node never creates, lists, loads, saves, sends, or discards an email draft.
23. Node email views retain received-message bodies and attachments, thread expansion, exact-message lazy loading, highlights, selection chats, and email-to-text-box actions.
24. My Triage and Shared Triage retain New compose, Reply, Reply all, Forward, mailbox-scoped owner drafts, signatures, attachments, scheduling, and safe send.
25. Triage Reply and Reply all are available only for an exact message that already has an internal `email_message_id`; clicking Reply never imports a provider-only message.
26. A Triage draft belongs to one exact creator and mailbox scope; a Shared Triage draft remains owner-only and is not a Node collaboration object.
27. Project attached-email replies remain available through their existing owner draft and mailbox-send path.
28. Reply uses the canonical reply address. Reply all de-duplicates recipients, excludes the sender account, and retains the original To and Cc recipients when replying to a sent message.
29. A sent reply becomes a new stored message in the same thread and inherits every Node-wide destination already used by that thread.
30. Closing a Triage or Project reply surface does not delete its draft; only explicit discard soft-deletes the exact draft.
31. Opening, closing, or refreshing the triage chat rail does not restart or revoke an unchanged inline email image source.
32. A triage chat send reuses the exact mailbox-scoped stored message when present, otherwise fetches and stores only that exact provider message, and never queues remaining-thread ingestion.
33. A triage chat appears optimistically before its request; success keeps it, and failure removes it and restores the composer.
34. Once an exact email message already has a Node text box, each later chat uses only the normal Node text-box-chat create command.
35. A Node opens with attached-email threads collapsed. Opening one thread loads headers and snippets only; opening one message loads only that exact stored body and attachment metadata.
36. Email-thread live updates refresh only lightweight summaries and never reload all opened bodies, attachment data, or Node email threads because someone typed in an unrelated Triage or Project draft.
37. Every saved email-selection chat renders its exact stored quote and offsets as a lasting highlight in triage and Node email views.
38. A stored-thread reader carries the exact internal `email_thread_id`, renders every related stored message once in `message_order`, and loads a complete body only for an opened exact message.
39. A one-hash email reference stores the exact durable thread and message identities and opens the existing email renderer without creating a relationship or second email route.
40. A quoted copy of an earlier email inside a later body is content only and never counts as thread membership.
41. Opening a Triage draft list loads summaries rather than every draft body or attachment relationship; opening or sending one scheduled draft loads only that exact draft and its attachments.
42. Missing sources, denied mailbox access, disconnected senders, and invalid draft fields use separate error codes.
43. A Node email relationship cannot be removed while that Node and thread have a text-box relationship or email-selection chat.
44. A permitted Node email removal deletes only the exact relationship and never deletes the stored thread, message, Triage draft, received attachment, text box, or chat.
45. An outbound Triage or Project reply uses the existing ten-second safe-send bar with **Send now** and **Undo**, then records the sent message and retires the exact draft after success.
46. Node email viewing never enters the outbound safe-send path because Nodes contain no email reply or send action.

Last updated: 2026-08-16

# Process Story

A stored message may be placed in one or more Nodes
↓
Each Node keeps its own exact text-box, chat, highlight, and read-only email view
↓
Opening one Node thread or message loads only the data required for that visible item
↓
Reply and draft work remains in My Triage, Shared Triage, or the retained Project reply surface
↓
An authorized outbound send passes through the existing ten-second safe-send gate and records the reply in the stored thread

## Scenario 1: Provider-only message

- A message visible from Gmail or Microsoft has not been ingested.
- Reply and Reply all are unavailable in Triage until the exact message is ingested.
- Mango does not import the message merely because the user opened it or tried to reply.

## Scenario 2: Large read-only Node email view

- A Node has hundreds of stored email messages.
- Opening the Node loads no draft data and keeps every attached thread collapsed.
- Opening a thread loads summaries, and opening a message loads only that exact body and received-attachment metadata.

## Scenario 3: Protected Node email

- A Node email thread has a text-box link or email-selection chat.
- Removing its email relationship fails with `email_removal_has_node_work` and preserves all work.
- A mistaken attachment with no Node-local work may be removed.
