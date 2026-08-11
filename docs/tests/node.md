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
14. Clicking the highlight chat action opens the chat rail, places the quote in the composer, and focuses the composer without writing to the database.
15. Sending the first chat from an unlinked message atomically creates the exact Node-local text box, message-to-textbox relationship, and chat.
16. If a triage thread has no Node, its first sent chat atomically creates a floating Node with priority **Not Assigned**; if it has several Nodes, the user chooses the destination Node before send.
17. Cancelling an unsent email-chat preview leaves the database unchanged.
18. Dragging one exact email message onto a Node text box links that message; dragging a whole thread onto a text box is rejected.
19. My Triage and Shared Triage show one thread chat rail divided into groups by exact Node, message, and text box.
20. Every triage chat group header shows a clickable Node icon and Node title.
21. Reply and Reply All create or reopen only the current user's owner-only personal draft for the exact source message and sending account.
22. Create Shared Draft creates or reopens one shared draft for this exact Node and thread, with one dedicated text box in this Node.
23. One Node may have at most one active shared draft for the same thread.
24. A thread in another Node may have a separate shared draft with separate content, revision, attachments, chat, and send lifecycle.
25. No Node shows, counts, opens, edits, or discards another Node's shared draft merely because both Nodes contain the same thread.
26. A triage Create Shared Draft action must nominate an accessible Node that already contains the thread, then open that Node's dedicated draft text box.
27. Shared draft body, recipients, attachments, revision, and editable **From** account are shared only with current users of this exact Node.
28. A user may select only an authorized connected sending account in **From**, and send authorization is checked against that exact account.
29. Reply and Reply All from a Node remain personal; only Create Shared Draft starts Node-shared editing.
30. A successfully sent reply becomes a new message in the same thread and inherits every Node-wide destination for that thread.
31. Closing the shared-draft text box never deletes the draft; discarding removes only this exact Node's draft.
32. An ordinary Node text box stores no color and uses the normal thin neutral frame; only a text box with an exact email relationship stores an approved non-red RGB `color`, and the interface uses that literal value without hashing an email ID. Red is reserved for a failed save.
33. A consolidated Node view carries text-box metadata but not a duplicate canonical editor document body; each mounted editor reads its exact canonical document once.
34. Concurrent identical shared-draft and stored-thread reads share one request, while a committed realtime change forces a fresh canonical read.
35. Every attached-email thread starts collapsed when a Node opens and performs no thread-body or this Node's shared-draft read until the user opens that exact thread.
36. Sending a chat authored by the current user moves the shared chat view to the new message at the bottom.

Last updated: 2026-08-11

# General Process Story

A user attaches one email thread to one or more Nodes
↓
Mango relates every stored message and each later ingested message to every Node-wide destination for that thread
↓
Each Node may link one exact message to its own local text box and keep its own local chat
↓
Each Node may create its own one shared draft and dedicated text box while the exact **From** account separately retains send authority

# Main Scenarios

## One thread in two Nodes

The same stored thread appears in both Nodes. A new message receives both Node-wide destinations, but no text-box link or chat is copied.

## First chat on an unlinked message

The user previews the quote without writes. The first sent chat creates the exact Node-local text box, message relationship, and chat together; cancelling creates nothing. Another Node may link the same message to a different text box and keep a separate chat.

## Shared draft and reply from a Node

Reply and Reply All remain personal to their user. Create Shared Draft creates or opens only this Node's draft and dedicated text box; another Node containing the thread has no access to it and may create its own separate draft. An authorized **From** account sends it, freezes the sent draft, and adds the sent message to the same thread under normal Node-wide propagation.
