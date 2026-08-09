# Current Node Business Logic Laws

1. Every new Node starts with priority **Not Assigned** unless the user explicitly chooses another priority.
2. Creating or assigning a Node never requires the user to choose a priority.
3. One stored email thread may belong to only one Node.
4. Every stored message in an attached email thread belongs to that same Node.
5. A newly ingested message in an attached thread is automatically related to that thread's Node.
6. An email thread never links to a Node text box.
7. One exact email message may link to at most one text box inside its Node.
8. Every email chat belongs to one exact email message and that message's exact Node text box.
9. Opening an email-chat preview creates no Node, text box, email relationship, or chat row.
10. Sending the first chat from an unlinked message atomically creates the required Node when absent, exact text box, message-to-textbox relationship, and chat.
11. Cancelling an unsent email-chat preview leaves the database unchanged.
12. My Triage and Shared Triage show one chat rail for the thread and one visually separated chat group for each exact message.
13. Every triage chat group shows the Node icon and Node title.
14. A shared draft keeps the exact source message, sending email account, and Node work context.
15. Reply and Reply All from a Node create or reopen that Node's shared draft.
16. Node collaborators may edit a shared draft, but only a user authorized for its exact email account may send it.
17. A successfully sent Node reply becomes a new message in the same thread and Node.
18. A second Node relationship for an already attached email thread is rejected.

Last updated: 2026-08-09

# General Process Story

A user attaches an email thread to one Node
↓
Mango relates every stored message and each later ingested message to that same Node
↓
The user may link one exact message to one Node text box and discuss it there
↓
The same Node work context owns shared drafting and Node replies while the exact email account retains send authority

# Main Scenarios

## New message in an attached thread

A new message is stored once, related to the thread's existing Node, and left unlinked to every text box until a user deliberately starts a message-specific chat.

## First chat on an unlinked message

The user previews the quote without writes. The first sent chat creates the exact text box, message relationship, and chat together; cancelling creates nothing.

## Shared draft and reply from a Node

Node collaborators edit one shared draft for the exact source message. An authorized mailbox user sends it, and the sent message returns to the same thread and Node.
