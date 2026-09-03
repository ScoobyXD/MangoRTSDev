# Process Step Business Logic Laws

1. A Process is the existing Logic Gate and keeps its exact `logic_gates.logic_gate_id`.
2. Each `process_steps` row belongs to exactly one same-company Process and keeps its own exact `process_step_id`.
3. A Process may have zero or more steps, and each step appears as one column in its Steps view.
4. Step display order is stored on the step and does not create or change an operational connection.
5. Step connections use only `resource_operational_relationships` with exact `process_step` endpoints belonging to the same Process.
6. A connection is directed, rejects a self-edge, and has one row per exact company and directed endpoint pair.
7. Add next step creates the new step and its explicitly requested incoming connection atomically.
8. One step may connect to several other steps, and several steps may connect to the same step.
9. A connection controls neither Node permissions nor Process membership and creates no Company Explorer or company-map placement.
10. A Node keeps its one existing Process assignment and may have one step assignment within that same Process.
11. `nodes.status` is the only saved Node status authority; a step name, column position, or Issue flag never replaces it.
12. Requested, Pending, Backlog, and Done are separate status lists within the Process and are never steps or stored board columns.
13. The Steps view shows In Progress and Review Nodes; the separate status lists show only Nodes with their matching status.
14. A Node appears in only one work view at a time, determined by its status.
15. An active Node without a step appears in No step assigned while keeping its Process membership and status.
16. Pending means accepted work waiting to start or resume and is independent of whether a step is already assigned.
17. Accepting a request changes its status to Pending; declining or cancelling follows the existing Backlog behavior and request authorization.
18. Starting work chooses one step and changes the Node to In Progress in one operation.
19. Moving a Node between steps preserves its status, Issue flag, Process membership, and unrelated content.
20. Changing status to Requested, Pending, Backlog, or Done preserves the Node's existing step assignment.
21. Reopening a Node reuses its surviving step; a Node whose step was deleted remains unassigned to a step.
22. A cross-Process transfer clears the previous step unless the command explicitly chooses a valid step in the destination Process.
23. Deleting a step removes its exact incoming and outgoing connections and clears only the affected Node step assignments.
24. Deleting a step preserves every Node, Node status, Process assignment, email, attachment, permission, RACI assignment, and unrelated relationship.
25. Deleting a step never invents replacement connections between surviving steps.
26. Deleting a Node never deletes its Process or step; Process and Node recycle/restore preserve the exact step relationships promised by their existing lifecycle.
27. Restoring a Node whose step has since been permanently deleted clears the unavailable step reference without inventing a replacement step.
28. Existing work is converted with the same Node IDs, Process membership, statuses, Issue flags, metadata, content, and completion timestamps, with no guessed step assignments.
29. Existing recycle snapshots are converted once to the new fields so runtime restore needs no legacy status-column fallback.
30. Work views, counts, and related readers derive from Nodes, Process assignments, and steps; `kanban_board_projection` and its synchronization paths do not exist.
31. Process work commands enforce current Process and Node access through existing authorization rules, and hidden Nodes contribute neither rows nor counts.
32. Committed work changes invalidate the existing Process work read through exact Process identity, and mounted views use one active refresh with at most one queued refresh.
33. The existing left sidebar and SOP editor remain in place, with RACI assignments above the editor toolbar; the Process work board occupies only the right-hand work area.
34. Step columns, controls, and Node cards reuse Mango's elevated surfaces and soft gradients; status is identified by both color and text.
35. The Issue flag decorates a Node's underlying status and never moves a Pending or Done Node into the active Steps view.
36. An assigned Node accepts only Requested, Pending, Backlogs, In Progress, Review, or Done through every status update path; Issue is never saved as its status.
37. A folder change refreshes Process work only when it affects that Process's inherited access; unrelated folders and shared inboxes do not invalidate its work.
38. Every effective Responsible user with Process access can accept or decline another user's request, including users reached through groups or inherited RACI.
39. RACI assignment constraints accept the same canonical resource types as RACI settings so Process requests can inherit Responsible users from folders.
40. Compact rectangular tabs at the top of the work area select Steps, Requested, Pending, Backlog, and Done.
41. Requested uses yellow, Pending gray, Backlog purple, and Done green while retaining readable labels.

## Process Story

A Node is requested into a Process. An authorized Responsible user accepts it into Pending. Starting work selects a step and sets In Progress; later step moves keep its status. Marking it Done removes it from active columns while keeping it openable in Done with the same Process and surviving step. Deleting a step clears only its step assignments and connections, so all affected Nodes remain available in the view determined by their unchanged status.

## Main Scenarios

1. **Existing work:** after conversion, a Review Node remains Review in the same Process and appears in No step assigned until a user chooses a step. A Done Node stays in Done with its original completion timestamp.
2. **Branching:** a step connects to two possible next steps through two exact directed relationships. Moving a Node to either step changes only its selected step; removing one connection preserves all three steps and their Nodes.
3. **Step deletion:** deleting a step used by active, Pending, and Done Nodes clears each step reference. Active Nodes appear in No step assigned, while Pending and Done Nodes remain in their lists. No Node or Process membership is deleted.

## Database Rollout

The repository migration is `backend/db/migrations/20260903_process_steps.sql`. A human operator must stop application writers, run this forward-only migration against PostgreSQL 17 or 18, and deploy the matching application before reopening writes. It also corrects the outdated RACI assignment constraint that blocked folder inheritance. It reports the connected version and stops on an unsupported version, incompatible starting schema, or unsupported existing status/resource type. Agents must not apply it to a live database. Disposable integration tests exercise the conversion and lifecycle without using live credentials.
