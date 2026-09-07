# Mango Tool Business Logic Laws

1. Mango tools must execute only for the authenticated gateway profile's exact company and user and its currently admitted running execution.
2. Tool arguments must never select the company, user, credentials or callback endpoint.
3. Resource discovery must reuse Company Explorer search and return only resources and location paths allowed by its existing visibility rules.
4. Process reads must return the existing Process work view, including its exact Steps and permitted Nodes.
5. Node reads and updates must use the existing Node permission checks, commands, projections and committed events.
6. Node creation must atomically create the Node and its exact Process and Step assignment through the existing work command.
7. Node moves must authorize the Node, destination Process and actual current source Process and retain the Node's status.
8. Clearing a Node's Step must retain its Process assignment and every independent relationship.
9. Editor reads and writes must use canonical Node, Process, Step or Project document identities and the existing editor access and JSON rules.
10. A Step editor must use its exact Step UUID as both resource and document ID and authorize through its current immutable Process owner.
11. Every committed AI mutation must store its result and action history with the business change in the same transaction using `ai_actions`.
12. Identical normalized mutation arguments within one run must return the saved result without repeating the business command.
13. A retry must never overwrite subsequent manual edits or recreate a removed resource.
14. Stop, lost membership or revoked resource access must reject new mutations while retaining committed receipts.
15. Tool discovery and execution must expose no delete command.
16. Creating a Node or Project editor textbox must allocate its exact new UUID on the server and atomically save its canonical document and AI receipt.
17. Retrying identical textbox creation in one run must return the original document ID and create no second textbox.
18. UUID letter casing must not create another native profile or credential for the same company and user pair.
19. Every action must load its current user record so canonical mailbox filtering and committed change metadata use that user's saved access and display name.
20. Typed or speech-transcribed partial names must be resolved through `mango_search`; the AI must retain returned canonical IDs internally and ask for names or locations only when the intended match remains ambiguous.
21. Search must preserve multiple matches, support canonical type filters and bounded limits, and create no second search index or identity mapping.
22. Creating a named Process must reuse the canonical workspace batch command, including default folder placement when no folder is supplied and current destination access when one is supplied.
23. Renaming a Process must update its existing header through the canonical command without replacing its identity, Steps, Nodes or editors.
24. Process folder placement must reuse the canonical Explorer command, recheck current Process and destination access, and retain its exact Process identity and synchronized map placement.
25. Creating a Step must reuse the canonical Step command; an `after_process_step_id` must belong to that Process and create the existing incoming connection atomically.
26. A Node chat must append an ordinary plain-text chat to an existing exact textbox owned by that Node, with the current acting user as author.
27. Node chat creation must create no email relationship, AI session, permission grant or second textbox.
28. A requested Step workflow may move a Node and create its textbox through separate existing commands, and must report failure for each command that did not commit.
29. Internal tools must not claim to install automatic actions for future Step entries; this tool set executes only during the current admitted user-requested run.

The tool transport reuses Mango's existing Explorer, Process work, Node, chat and editor commands. It creates no resource registry, new relationship authority or permission grant. `mango_search` accepts part of a name and optional resource types, including `folder`, `logic_gate` and `node`, and returns exact identities and visible paths. Its existing search limit is at most 100; a full result set requires narrowing the name or type, not assuming a unique match. `mango_get_process` supplies Step IDs; `mango_get_node` supplies the existing Node details and textbox IDs. A Process overview uses `logic-gate-overview`; a Step uses its exact ID; other textboxes keep their canonical document IDs.

For example, Hermes can find the Procurement folder, create a named Process there, create its first Step, create a Node in that Step, create a Node textbox, post a chat in that textbox and update the Process overview. It can move the Node to a discovered Step and add a textbox for that requested visit. Each mutation has its own atomic receipt; the whole conversation is not one transaction and it installs no recurring Step trigger. Existing dictation still fills the draft, and explicit Send starts execution.

Verification uses Go HTTP fixtures for callback execution and memory/disposable PostgreSQL repository tests for retry receipts, rollback, permissions, default placement and Stop. The pinned native Hermes smoke drives search, Process creation/rename/placement, Step, Node, textbox and chat creation through the authenticated Go API using a scripted provider and in-memory business storage. These checks do not exercise real-model name resolution, live speech transcription or live business data.
