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
12. If the thread is in several Nodes and no destination is active, Mango requires the user to choose a grouping, a new grouping in one Node, or a new Node; Mango never guesses.
13. If a highlighted-email chat's exact message is already linked to the selected grouping's text box, sending uses only the normal Node text-box-chat create command and creates no email, Node, text-box, participant, or relationship row.
14. If a highlighted-email chat's exact message is not linked to any text box in the selected Node, choosing an existing grouping atomically links that message to the grouping's existing text box and creates the chat without creating another text box.
15. If a highlighted-email chat's exact message is already linked to a different text box in the selected Node, Mango must use that existing grouping or require an explicit move; it must not silently duplicate or replace the relationship.
16. Choosing a new grouping in an existing Node atomically creates one new text box, the exact message link, and the first chat without creating another Node relationship.
17. Choosing a new Node atomically creates the Node, normal Node relationship, text box, exact message link, and first chat without changing another Node's copy of the thread.
18. Replying to an existing chat inherits that chat's exact Node and text-box grouping, writes only the reply chat with its parent chat ID, and does not require an email-selection anchor.
19. Every existing grouping has one top-right **New chat** button that selects that exact Node and text box as the composer destination.
20. The selected grouping remains visibly selected, and the composer visibly identifies that a new chat will be sent to that grouping until the user selects another destination or cancels.
21. Pressing Enter for an ordinary **New chat** sends one relationship-neutral root chat to the selected grouping through the normal Node text-box-chat insert without a separate destination dropdown.
22. Chats inside one grouping display their real reply tree, with root chats ordered oldest-to-newest and each parent's direct replies ordered oldest-to-newest.
23. Groupings remain intact and are ordered by each grouping's latest activity, defined as the later of its newest linked email-message timestamp and newest chat timestamp.
24. Groupings are ordered by that latest-activity value from oldest at the top to newest at the bottom, with a stable Node-and-text-box identity tie-breaker.
25. My Triage and Shared Triage read all accessible chat groupings for the selected stored thread in one request and apply the same destination and ordering rules.
26. Only text boxes that contain chats appear as persisted chat groupings; an unsent composer selection is temporary presentation state.
27. The rail opens automatically when the selected thread already has at least one accessible chat.
28. A failed atomic first-chat command creates none of its Node, relationship, text-box, or chat writes and preserves the complete composer for retry.
29. Removing one Node's relationship, text box, or chat does not remove another Node's copy of that work.
30. A saved highlighted-email chat keeps its exact quoted range visibly highlighted in My Triage, Shared Triage, and the Node email view until the last chat using that range is removed.
31. When a highlighted-email action has existing triage groupings, Mango waits for the user to click the exact grouping before assigning the composer destination.
32. In a Node, a highlighted-email action waits for the user to click the exact text-box chat column; the first send atomically links the exact message to that existing text box when allowed and creates the chat, or creates neither.

Last updated: 2026-08-11

# General Process Story

A user opens an email and Mango reads every accessible Node-and-text-box chat grouping for its stored thread. Choosing **New chat** on an existing grouping creates a relationship-neutral root chat in that exact text box, while replies remain nested beneath their parent chats. A highlighted-email chat or a chat that creates a new grouping uses the exact active message and atomically creates only the missing exact-message relationship, text box, Node, and first chat required by that destination.
