# Current Node Business Logic Laws

1. Every new Node starts with priority **Not Assigned** unless the user explicitly chooses another priority.
2. Creating or assigning a Node never requires the user to choose a priority.
3. One stored email thread may belong to multiple Nodes.
4. One Node may contain multiple stored email threads.
5. Attaching a thread to a Node creates the missing Node-wide relationship for each stored message in that thread.
6. A newly ingested message inherits every Node-wide destination already used by its thread.
7. New-message ingestion never creates a text-box relationship or copies a chat.
8. An email thread never links to a Node text box; only an exact email message may do so.
9. One exact email message may link to at most one text box in each Node.
10. The same exact email message may link to different text boxes in different Nodes.
11. Every email chat belongs to one exact Node, one exact text box in that Node, and one exact email message linked to that text box.
12. Chats about the same email message in different Nodes remain separate.
13. Highlighting email text and opening its chat preview creates no Node, text box, email relationship, or chat row.
14. Clicking the highlight chat action keeps the exact quote visibly highlighted and waits for the user to click the destination text-box chat column without writing to the database.
15. Sending the first chat from an unlinked message atomically links the chosen existing text box or creates the first text box, then creates the exact chat; failure creates neither relationship nor chat.
16. If a triage thread has no Node, its first sent chat atomically creates a floating Node with priority **Not Assigned**; if it has several Nodes, the user chooses the destination Node before send.
17. Cancelling an unsent email-chat preview leaves the database unchanged.
18. Dragging one exact email message onto a Node text box links that message; dragging a whole thread onto a text box is rejected.
19. My Triage and Shared Triage show one thread chat rail divided into groups by exact Node, message, and text box.
20. Every triage chat group header shows a clickable Node icon and Node title.
21. The Node UI shows Reply to a user with Node edit access only on an exact ingested message whose attached projection retains one exact source mailbox. The composer opens only after resolving its displayed sender; send separately rechecks the authoritative mailbox and returns `email_sender_account_changed` before attachment or provider work if that actual sender no longer matches the displayed **From**.
22. Node Reply is an in-memory rich composer with read-only From and editable To, Cc, Bcc, Subject, and body; it exposes no Reply All, Forward, durable or shared draft, scheduling, or outgoing attachment control.
23. Opening, expanding, refreshing, or navigating Node email performs no outbound work; only clicking Reply opens the in-memory composer, and it never creates, lists, loads, saves, autosaves, or discards a draft.
24. A Node continues to show received-message bodies, received attachments, participants, and stored thread history.
25. Every attached-email thread starts collapsed; opening one thread loads summaries, and opening one exact message loads only that message's body and received-attachment metadata.
26. Node-wide email relationships and exact email-to-text-box relationships remain unchanged.
27. Highlighted-email chats and exact-message text-box creation remain available and keep their existing atomic relationship rules.
28. Saved chat quotes and offsets continue to render as lasting highlights in the Node email view.
29. Removing a Node email relationship remains blocked when that Node and thread have a text-box relationship or email-selection chat.
30. A newly ingested or sent provider message still inherits every Node-wide destination already used by its thread.
31. My Triage and Shared Triage retain compose, owner drafts, attachments, signatures, scheduling, and sending. Project attached-email replies retain their existing owner-draft, attachment, signature, and send behavior without adding scheduling. Node Reply reuses only the existing signature and ten-second send path without a draft or user-added outgoing attachment.
32. An ordinary Node text box stores no color and uses the normal thin neutral frame; only a text box with an exact email relationship stores an approved non-red RGB `color`, and the interface uses that literal value without hashing an email ID. Red is reserved for a failed save.
33. A consolidated Node view carries text-box metadata but not a duplicate canonical editor document body; each mounted editor reads its exact canonical document once.
34. Concurrent identical stored-thread reads share one request, while a committed relevant realtime change forces a fresh canonical read.
35. A Node performs no email draft request during initial load, thread expansion, exact-message expansion, Reply, realtime refresh, or text-box navigation.
36. Sending a chat authored by the current user moves the shared chat view to the new message at the bottom.
37. Every saved email-selection chat renders its exact stored quote and offsets as a lasting email highlight; cancelling an unsent selection removes only its temporary highlight.

Last updated: 2026-08-17

# General Process Story

A user attaches one email thread to one or more Nodes
↓
Mango relates every stored message and each later ingested message to every Node-wide destination for that thread
↓
Each Node may link one exact message to its own local text box and keep its own local chat
↓
Each Node reads its related email and received attachments and may open one draftless exact-message Reply composer without creating a draft lifecycle

# Main Scenarios

## One thread in two Nodes

The same stored thread appears in both Nodes. A new message receives both Node-wide destinations, but no text-box link or chat is copied.

## First chat on an unlinked message

The user previews the quote without writes. The first sent chat creates the exact Node-local text box, message relationship, and chat together; cancelling creates nothing. Another Node may link the same message to a different text box and keep a separate chat.

## Draftless Reply inside a Node

Opening a related thread reveals stored message summaries and then exact message bodies on demand. The user may download received attachments, highlight text, create or open the permitted exact-message text box, chat, or click Reply on an exact ingested message. Reply opens an in-memory rich composer and the existing ten-second send gate, while Reply All, Forward, drafts, outgoing attachments, and scheduling remain absent.
