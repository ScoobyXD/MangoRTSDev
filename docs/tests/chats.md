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
20. Hovering a Node parent or text-box grouping elevates its whole surface without recoloring it; choosing either level briefly flashes its perimeter and then leaves only a soft neutral selected frame that can be dismissed.
21. Pressing Enter for an ordinary **New chat** sends one relationship-neutral root chat to the selected grouping through the normal Node text-box-chat insert without a separate destination dropdown.
22. Chats inside one grouping display their real reply tree, with root chats ordered oldest-to-newest and each parent's direct replies ordered oldest-to-newest.
23. Node parent groupings use a stable case-insensitive Node-name order with Node ID as the tie-breaker; email or chat activity never moves a Node grouping.
24. Inside each Node parent grouping, text-box chat groupings use the Node text boxes' stored `display_order` from top to bottom with text-box ID as the tie-breaker; sending or receiving a chat never moves a grouping.
25. My Triage and Shared Triage read all accessible chat groupings for the selected stored thread in one request and apply the same destination and ordering rules.
26. Only text boxes that contain chats appear as persisted chat groupings; an unsent composer selection is temporary presentation state.
27. The rail opens automatically when the selected thread already has at least one accessible chat.
28. A failed atomic first-chat command creates none of its Node, relationship, text-box, or chat writes and preserves the complete composer for retry.
29. Deleting one Node text box removes its own chats and textbox-specific email relationships but preserves that Node's wide email relationship and every other Node's copy of the work.
30. A saved highlighted-email chat keeps its exact quoted range visibly highlighted in My Triage, Shared Triage, and the Node or Project email view until the last chat using that range is removed.
31. My Triage and Shared Triage enforce one exact pending destination for a highlighted-email chat: an exact existing text-box link is selected automatically when unambiguous, one existing Node with no exact link defaults to a new text box in that Node, no existing Node defaults to a new Node and new text box, and every ambiguous multi-Node case waits for an explicit choice.
32. The Node email view applies the same exact-message rules: an existing exact-message textbox link opens and flashes that chat automatically and remains the only Node-local destination. An unlinked exact message defaults to one staged new textbox at the newest/top timeline position, and the first successful Send keeps it in that same position; until Send, each eligible textbox-header click moves the same pending composer and draft, highlights that frame, replaces the destination with Existing Node · Existing Text Box, and performs no write.
33. Only a highlighted-text-to-chat composer shows the routing template, with the exact highlighted quote in the top field and the pending destination in the field directly below it.
34. A triage or Node highlighted-email destination has exactly one of three labels: **New Node · New Text Box**, **Existing Node · New Text Box**, or **Existing Node · Existing Text Box**. A Project destination is **Existing Project · New Text Box** or **Existing Project · Existing Text Box**.
35. An existing-Node destination shows the Node icon followed by the real Node name in Mango's rectangular entity chip; a text box has no displayed or invented name in the destination field.
36. Clicking an existing text-box grouping selects **Existing Node · Existing Text Box**, clicking a Node parent selects **Existing Node · New Text Box** unless that exact message already has a text-box link there, and clicking the Node-plus action selects **New Node · New Text Box**.
37. If the exact message already has a text-box link in the chosen Node, Mango resolves every Node-local choice to **Existing Node · Existing Text Box** and never moves, replaces, or duplicates that link.
38. A highlighted-email chat cannot send without both its highlighted quote and one pending destination; an attempted send with no destination gives the destination field a red outline and the exact message **Please select a destination.**
39. The destination X and a click outside every destination grouping and the composer clear only My Triage or Shared Triage's temporary destination selection, keep the highlighted quote and draft, remove the soft selected frame, and perform no database write.
40. Clicking inside the composer, its highlighted-text field, its destination field, or a destination grouping does not accidentally clear the pending destination.
41. Reply and grouping-header **New chat** commands inherit their exact existing text-box destination and do not show or require the highlighted-text routing template.
42. The Node-plus action, grouping clicks, textbox-header destination clicks, default destination, destination X, outside-click dismissal, soft frame, and validation error are presentation state only; the first successful Send remains the only command in that highlighted-chat flow that may create the allowed Node, text box, email relationship, and chat together.
43. The Project-wide email column uses the same highlighted-email destination contract. An unlinked exact message defaults to Existing Project · New Text Box; clicking an existing Project textbox highlights its frame and changes the destination to Existing Project · Existing Text Box, and the first send atomically creates the exact Project textbox relationship and chat.
44. A separate Node message-header drop may create an exact message-to-textbox relationship without creating a chat, and it does not change any highlighted-chat destination or composer state.
45. The X beside one exact message in Show email may remove that message-to-textbox relationship only when no chat in the textbox is anchored to the message; rejection leaves the relationship, chats, and composer state unchanged.

Last updated: 2026-08-17

# General Process Story

A user opens an email and Mango reads every accessible Node-and-text-box chat grouping for its stored thread, keeps Nodes stable, and shows each Node's chat groupings in text-box order. A highlighted-text chat shows its quote above one explicit destination, defaults only when the message state is unambiguous, and lets the user choose, change, or dismiss a softly framed Node or text-box grouping without writing anything. **New chat** and replies already know their text box. Only Send atomically creates the exact missing Node, text box, email relationship, and chat allowed by the selected chat route; a separate exact-message header drop may create its typed textbox edge, while the Show email X may remove that edge under the guarded relationship rules.
