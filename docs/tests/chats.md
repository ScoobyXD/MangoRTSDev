# Current Email Chat Business Logic Laws

1. A highlighted-email chat and any chat that creates a new email grouping target one exact stored email message; an ordinary root chat or reply in an existing grouping targets that grouping's exact Node and text box only.
2. A normal email-to-Node relationship does not require a text box or chat.
3. One normal relationship from any stored message makes its whole stored thread part of that Node, and the same stored thread may be part of several Nodes.
4. A new provider message inherits the missing normal Node relationships for every Node already containing its thread, but it inherits no text box or chat.
5. One chat grouping is one exact Node plus one exact Node text box, together with every exact email message linked to that text box and every chat stored in that text box.
6. A text box may link to one or more exact stored messages, but one exact message may link to at most one text box inside one Node.
7. Mango never splits one grouping by email message or interleaves one grouping's chats into another grouping.
8. Reading an email, opening its chat rail, highlighting text, hovering a grouping, or selecting a grouping creates nothing.
9. An ordinary **New chat** send to an existing grouping creates a relationship-neutral root chat in that text box, while a highlighted-text chat additionally stores the exact message, quote, and offsets and obeys exact-message destination rules.
10. If a chat that creates a new grouping targets an exact message with no Node, the first send atomically creates the floating Node, normal Node relationship, text box, exact message link, and first chat.
11. If a chat that creates a new grouping targets a thread already in one Node but the exact message has no text box there, the first send reuses that Node and atomically creates only the missing text box, exact message link, and chat.
12. If the thread is in several Nodes and no destination is active, Mango requires the user to choose a Node parent grouping, an existing text-box grouping, or a new Node; Mango never guesses across Nodes.
13. If a highlighted-email chat's exact message is already linked to the selected grouping's text box, sending uses only the normal Node text-box-chat create command and creates no email, Node, text-box, participant, or relationship row.
14. If a highlighted-email chat's exact message is not linked to any text box in the selected Node, choosing an existing grouping atomically links that message to the grouping's existing text box and creates the chat without creating another text box.
15. If a highlighted-email chat's exact message is already linked to any text box in the selected Node, that existing text box is the only allowed destination in that Node; Mango automatically resolves the selection to it and must not create, duplicate, move, or replace the link.
16. Choosing the Node parent grouping may create a new text box only when the highlighted email's exact message has no text-box link in that Node; the first send atomically creates that text box, the exact message link, and the chat without creating another Node relationship.
17. Choosing a new Node atomically creates the Node, normal Node relationship, text box, exact message link, and first chat without changing another Node's copy of the thread.
18. Replying to an existing chat inherits that chat's exact Node and text-box grouping, writes only the reply chat with its parent chat ID, and does not require an email-selection anchor.
19. The chat rail groups text-box chat groupings beneath one parent surface per Node, and every existing text-box grouping has one top-right **New chat** button that selects that exact Node and text box as the composer destination.
20. Hovering a Node parent or text-box grouping elevates its whole surface; choosing either level flashes its blue-purple perimeter for one second, leaves the resolved Node parent or text-box grouping visibly selected, and identifies that destination in the composer until the user selects another destination or cancels.
21. Pressing Enter for an ordinary **New chat** sends one relationship-neutral root chat to the selected grouping through the normal Node text-box-chat insert without a separate destination dropdown.
22. Chats inside one grouping display their real reply tree, with root chats ordered oldest-to-newest and each parent's direct replies ordered oldest-to-newest.
23. Node parent groupings use a stable case-insensitive Node-name order with Node ID as the tie-breaker; email or chat activity never moves a Node grouping.
24. Inside each Node parent grouping, text-box chat groupings use the Node text boxes' stored `display_order` from top to bottom with text-box ID as the tie-breaker; sending or receiving a chat never moves a grouping.
25. My Triage and Shared Triage read all accessible chat groupings for the selected stored thread in one request and apply the same destination and ordering rules.
26. Only text boxes that contain chats appear as persisted chat groupings; an unsent composer selection is temporary presentation state.
27. The rail opens automatically when the selected thread already has at least one accessible chat.
28. A failed atomic first-chat command creates none of its Node, relationship, text-box, or chat writes and preserves the complete composer for retry.
29. Removing one Node's relationship, text box, or chat does not remove another Node's copy of that work.
30. A saved highlighted-email chat keeps its exact quoted range visibly highlighted in My Triage, Shared Triage, and the Node email view until the last chat using that range is removed.
31. My Triage and Shared Triage wait for the user to choose a Node parent or text-box grouping; within that Node, an existing exact-message text-box link is enforced automatically, while an unlinked exact message may use the chosen existing text box or the Node parent as an explicit new-grouping destination.
32. The Node email view applies the same exact-message rules: an existing exact-message text-box link opens and flashes that text-box chat automatically, while an unlinked exact message may use any elevated text-box surface or the elevated Node parent for an explicit new grouping, and the first send creates the allowed link and chat atomically or creates neither.

Last updated: 2026-08-11

# General Process Story

A user opens an email and Mango reads every accessible Node-and-text-box chat grouping for its stored thread, keeps Nodes stable, and shows each Node's chat groupings in the same order as its text boxes. Choosing **New chat** on an existing grouping creates a relationship-neutral root chat in that exact text box, while replies remain nested beneath their parent chats. A highlighted-email chat uses an existing exact-message text-box link when one exists in the chosen Node; otherwise the user's chosen text-box or Node-parent destination atomically creates only the missing exact-message link, text box, Node, and first chat required by that destination.
