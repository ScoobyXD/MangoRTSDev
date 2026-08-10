# Current Node Business Logic Laws

1. Every new Node starts with priority **Not Assigned** unless the user explicitly chooses another priority.
2. Creating or assigning a Node never requires the user to choose a priority.
3. An email thread belongs to a Node when that Node has a text box linked to any message in the thread.
4. One stored email thread may belong to multiple Nodes, and one Node may contain multiple stored email threads.
5. Attaching one message to a Node creates or reuses one exact text box for that message.
6. A newly ingested message gets one exact linked text box in every Node that already contains its thread.
7. New-message ingestion never copies a chat.
8. An email thread never links to a Node text box; only an exact email message may do so.
9. One exact email message may link to at most one text box in each Node.
10. The same exact email message may link to different text boxes in different Nodes.
11. Every email chat belongs to one exact Node text box, and that text box links to one exact email message.
12. Chats about the same email message in different Nodes remain separate.
13. Highlighting email text and opening its chat preview creates no Node, text box, email relationship, or chat row.
14. Clicking the highlight chat action opens the chat rail, places the quote in the composer, and focuses the composer without writing to the database.
15. Sending the first chat from an unlinked message atomically creates the exact Node-local text box, message-to-textbox relationship, and chat.
16. If a triage thread has no Node, its first sent chat atomically creates a floating Node with priority **Not Assigned**; if it has several Nodes, the user chooses the destination Node before send.
17. Cancelling an unsent email-chat preview leaves the database unchanged.
18. Dragging one exact email message onto a Node text box links that message; dragging a whole thread onto a text box is rejected.
19. My Triage and Shared Triage show one thread chat rail divided into groups by exact Node and text box.
20. A horizontal line separates groups, and every group header shows a clickable Node icon and Node title.
21. One active shared draft is universal to its exact email thread and keeps its exact reply-source message when one exists.
22. A shared draft is never owned by or related to a Node text box; its Node text-box appearance is UI only.
23. Creating a shared draft from a Node records that Node as the origin, shows a clickable origin-Node link, and opens the draft panel there by default.
24. Creating a shared draft from My Triage or Shared Triage does not invent an origin Node or auto-open the draft in any Node.
25. Every Node containing the thread shows the active shared-draft count, but only the origin Node opens the draft panel automatically.
26. In any other Node, clicking the shared-draft count opens the universal draft in a text-box-shaped panel; clicking again closes only that local panel.
27. Shared draft body, recipients, attachments, revision, and editable **From** account are one universal state seen from triage and every related Node.
28. A user may select only an authorized connected sending account in **From**, and send authorization is checked against that exact account.
29. Reply and Reply All from any Node create or reopen the same universal thread draft instead of a Node-specific copy.
30. A successfully sent reply becomes a new message in the same thread and gets one exact linked text box in every Node that already contains that thread.
31. Closing a local draft panel never deletes the universal draft; discarding the draft removes it for every surface.
32. An ordinary Node text box stores no color and uses the normal thin neutral frame; only a text box with an exact email relationship stores an approved non-red RGB `color`, and the interface uses that literal value without hashing an email ID. Red is reserved for a failed save.
33. A consolidated Node view carries text-box metadata but not a duplicate canonical editor document body; each mounted editor reads its exact canonical document once.
34. Concurrent identical shared-draft and stored-thread reads share one request, while a committed realtime change forces a fresh canonical read.
35. Every attached-email thread starts collapsed when a Node opens and performs no thread-body or shared-draft read until the user opens that exact thread.
36. Sending a chat authored by the current user moves the shared chat view to the new message at the bottom.

Last updated: 2026-08-10

# General Process Story

A user attaches one exact email message to one or more Nodes
↓
Each exact message is stored in one exact text box in each chosen Node, which makes the thread belong to those Nodes
↓
Each later ingested message gets one exact text box in every Node that already contains the thread, without copying chat
↓
One thread-global shared draft appears on demand in each related Node while its exact **From** account retains send authority

# Main Scenarios

## One thread in two Nodes

The same stored thread appears in both Nodes because each has at least one exact message text box. A new message gets one new linked text box in both Nodes, but no chat is copied.

## First chat on an unlinked message

The user previews the quote without writes. The first sent chat creates the exact Node-local text box, message relationship, and chat together; cancelling creates nothing. Another Node may link the same message to a different text box and keep a separate chat.

## Shared draft and reply from a Node

Node collaborators and triage users edit one universal draft for the thread. Its origin Node opens it automatically; other related Nodes expose only the count until clicked. An authorized **From** account sends it, and the sent message returns to the same thread in every related Node.
