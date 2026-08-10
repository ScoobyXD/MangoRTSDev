# Current Email Chat Business Logic Laws

1. Every email chat belongs to one exact Node text box.
2. An email text box links to exactly one stored email message.
3. One Node cannot link the same email message to more than one text box.
4. An email thread belongs to a Node when that Node has a text box linked to any message in the thread.
5. The same email thread may belong to several Nodes at the same time.
6. When a new message arrives in a known thread, every Node that already contains the thread shows the updated thread without creating a new text box.
7. New-message ingestion creates no Node text box, email relationship, or chat for that message.
8. My Triage and Shared Triage load all accessible chat groups for the selected message's thread in one direct read.
9. The chat rail opens automatically when any chat already exists in the selected thread. Manually closing it keeps it closed until the selected conversation changes.
10. The rail shows one section per Node text box. A horizontal line separates sections, and every section has a clickable Node icon and Node name.
11. Chats from the same Node text box stay together. Chats from different text boxes never merge into one section.
12. Reading or opening the rail creates no Node, text box, email relationship, permission, participant, or chat.
13. A new chat is written only to its chosen exact Node text box. When several Nodes contain the thread, Mango never guesses the destination.
14. If the chosen Node does not yet have a text box for the selected message, the first send creates that exact text box, message relationship, and chat together.
15. Removing one Node's email relationship or chat never removes another Node's text box, chat, relationship, or stored email.

Last updated: 2026-08-10

# General Process Story

A user opens an email conversation in My Triage or Shared Triage. Mango identifies its exact mailbox-scoped thread, finds every accessible Node text box linked to any message in that thread, and reads their chats. If any chat exists, the right rail opens and shows the chats in separate text-box sections with clickable Node names. When a new provider message later arrives, the stored thread updates in every Node that already contains it. No new text box is created until a user sends a chat about that exact message.
