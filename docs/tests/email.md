# Current Email Business Logic Laws

1. Email exists to distribute messages into useful Nodes, discuss exact messages in Node text boxes, and prepare personal or Node-shared replies.
2. Selecting a Node in the email Universal Linker adds the email to that existing Node.
3. Selecting a Logic Gate immediately creates a new email Node in that Logic Gate with priority **Not Assigned**.
4. Selecting a Project requires one Project Logic Gate choice, then creates a new email Node there with priority **Not Assigned**.
5. One stored email thread may belong to multiple Nodes, and one Node may contain multiple stored email threads.
6. Every newly ingested message inherits every Node-wide destination already used by its thread.
7. New-message ingestion never creates or copies a text-box relationship, chat, or shared draft.
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
21. Reply and Reply all are available only for an exact message that already has an internal `email_message_id`; clicking Reply never imports a provider-only message.
22. Opening the reply scope chooser creates no draft. Choosing **My draft** creates or reopens the current user's exact personal draft, and choosing **Shared draft** creates or reopens the exact Node draft.
23. A Node-shared draft belongs directly to one exact Node, stored thread, and source message, and `email_drafts.is_shared` explicitly distinguishes it from a personal draft.
24. A shared draft uses current Node access directly and never uses a collaboration ID as draft identity or authority.
25. A thread present in several Nodes may have a separate shared draft in each Node, and one personal and one shared draft for the same source may coexist.
26. Everyone who can view the exact Node may view and edit its shared draft, but the shared draft stores one scalar From account rather than a group sender.
27. Sending requires current authorization for the draft's exact stored connected From account.
28. Reply uses the canonical reply address. Reply all de-duplicates recipients, excludes the sender account, and retains the original To and Cc recipients when replying to a sent message.
29. A sent reply becomes a new stored message in the same thread and inherits every Node-wide destination already used by that thread.
30. Closing a reply surface does not delete its draft; only explicit discard soft-deletes the exact draft.
31. Opening, closing, or refreshing the triage chat rail does not restart or revoke an unchanged inline email image source.
32. A triage chat send reuses the exact mailbox-scoped stored message when present, otherwise fetches and stores only that exact provider message, and never queues remaining-thread ingestion.
33. A triage chat appears optimistically before its request; success keeps it, and failure removes it and restores the composer.
34. Once an exact email message already has a Node text box, each later chat uses only the normal Node text-box-chat create command.
35. A Node opens with attached-email threads collapsed. Opening one thread loads headers and snippets only; opening one message loads only that exact stored body and attachment metadata.
36. Email-thread live updates refresh only lightweight summaries and never reload all opened bodies, attachment data, drafts, or Node email threads because someone typed in a draft.
37. Every saved email-selection chat renders its exact stored quote and offsets as a lasting highlight in triage and Node email views.
38. A stored-thread reader carries the exact internal `email_thread_id`, renders every related stored message once in `message_order`, and loads a complete body only for an opened exact message.
39. A one-hash email reference stores the exact durable thread and message identities and opens the existing email renderer without creating a relationship or second email route.
40. A quoted copy of an earlier email inside a later body is content only and never counts as thread membership.
41. Opening the shared-draft list loads no bodies or attachments and returns at most five summaries; scrolling requests the next five.
42. Saving or opening one draft loads only that exact draft and its attachment relationships.
43. Concurrent shared-draft creation converges on the one permitted draft and returns it to both callers.
44. Missing sources, Node mismatches, denied Node access, disconnected senders, stale revisions, and invalid fields use separate error codes.
45. A Node email relationship cannot be removed while that Node and thread have a textbox relationship, email-selection chat, or active shared draft.
46. An outbound reply uses the existing 10-second safe-send bar with **Send now** and **Undo**, then records the sent message and retires the exact draft after success.

Last updated: 2026-08-13

# Process Story

A stored message may be placed in one or more Nodes
↓
Each Node keeps its own exact textbox, chat, and shared-draft work
↓
Opening email and draft surfaces loads only the summaries or exact item the user can see
↓
Reply or Reply all opens a chooser without writing a draft
↓
The selected personal or shared draft autosaves independently
↓
An authorized send passes through the existing 10-second safe-send gate and records the reply in the stored thread

## Scenario 1: Provider-only message

- A message visible from Gmail or Microsoft has not been ingested.
- Reply and Reply all are unavailable.
- Mango does not import the message merely because the user opened it or tried to reply.

## Scenario 2: Large Node

- A Node has hundreds of stored messages and shared drafts.
- Opening the Node loads neither draft bodies nor message bodies.
- The shared-draft menu loads five summaries at a time, and opening one item loads only that exact item.

## Scenario 3: Protected Node email

- A Node email thread has a textbox link, email-selection chat, or active shared draft.
- Removing its email relationship fails with `email_removal_has_node_work` and preserves all work.
- A mistaken attachment with no Node-local work may be removed.
