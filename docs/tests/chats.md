# Current Email Chat Business Logic Laws

1. A normal email-to-Node relationship does not require a text box.
2. One normal relationship from any stored message makes its whole stored thread part of that Node.
3. The same stored thread may be part of several Nodes.
4. A Node text box is linked to an email only when that text box is actually used for email work, such as a chat.
5. A text box may link to one or more exact stored messages; Mango does not split it into empty text boxes.
6. A new provider message receives the missing normal Node relationships for every Node already containing its thread, but no text box or chat.
7. The first chat for a message in a chosen Node creates the missing text box, exact message link, and chat together.
8. Reading an email or opening its chat rail creates nothing.
9. My Triage and Shared Triage read all accessible chats for the selected stored thread in one request.
10. Only text boxes that contain chats appear as chat sections.
11. The rail groups chats by Node and text box. Messages sharing one text box remain in one section.
12. Each section has a horizontal separator and a clickable Node icon and Node name.
13. The chat rail opens automatically when the selected thread already has at least one accessible chat.
14. A new chat is written only to the Node and text box chosen by the user; Mango never guesses between Nodes.
15. Removing one Node's relationship, text box, or chat does not remove another Node's copy of that work.

Last updated: 2026-08-10

# General Process Story

A user opens an email. Mango finds the stored thread, reads every accessible Node text box in that thread that already has chats, and shows one section per Node and text box. A new provider reply is related to the Nodes already containing the thread, but it gets no text box. Mango creates a new text box for that reply only when the user sends its first chat in a chosen Node.
