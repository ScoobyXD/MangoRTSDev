# Mango Tool Business Logic Laws

1. Mango tools must execute only for the authenticated gateway profile's exact company and user and its currently admitted running execution.
2. Tool arguments must never select the company, user, credentials or callback endpoint.
3. Process and Node discovery must return only resources allowed by the existing canonical visibility rules.
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

The tool transport reuses Mango's existing Process work, Node and editor commands. It creates no resource registry, new relationship authority, ownership link or permission grant. `mango_get_process` supplies Step IDs; `mango_get_node` supplies the existing Node details. A Process overview uses `logic-gate-overview`; a Step uses its exact ID; other textboxes keep their canonical document IDs.

Verification uses Go HTTP fixtures for end-to-end callback execution and repository tests for concurrent retries, rollback, permission checks and Stop. Live business data is never written by those tests.
