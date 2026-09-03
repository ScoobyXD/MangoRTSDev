# Process Work Module

The Process work area replaces the status-column board only in the existing Process page's right-hand column. The left sidebar and SOP editor remain in place, including the RACI assignments and editor toolbar. Its business rules live in `docs/tests/process-steps.md` and `docs/tests/kanbanboard.md`; Process editor, RACI, QDC, and linker rules remain in `docs/tests/logic-gates.md`.

The header shows **Steps · Requested · Pending · Backlog · Done**. Steps displays active Nodes under their exact Process steps, including an unassigned area. The other views display status-filtered lists. Status labels and colors remain independent of step columns, and Issue is a separate marker. All surfaces reuse the application's elevated neumorphic treatment, soft shadows, and gradients.

The compact rectangular view tabs share a row with **Group**. Requested is yellow, Pending gray, Backlog purple, and Done green. The board has no work-search or account-filter controls; optional priority/date/person/account grouping and Date Added sorting remain available.

Step headers show the name without an ordinal badge. Their top-right plus button creates a Node, and the three-dot menu provides Rename, Move left, Move right, Add next step, and Delete column. Existing outgoing connection chips remain visible without a Connect to dropdown. There is no bottom New Node button.

Node cards use larger titles while retaining status, priority, due date, and placement metadata. Cards omit selection checkboxes and the Change footer. Click, Ctrl/Cmd-click, and Shift-click selection, bulk commands, shared Node editing, request actions, Start work, and exact-mailbox email drops remain available. These features read the same work snapshot and reuse the existing saved-view, Node, assignment, editor, and email commands.

## Canonical data

| Source | Responsibility |
| --- | --- |
| `logic_gates` | The exact owning Process and its access boundary. |
| `nodes` | Node contents, status, priority, and due date. |
| `node_logic_gate_assignments` | Node-to-Process membership, optional exact step, order, Issue flag, and request/placement provenance. |
| `process_steps` | Exact Process-owned step names and display positions. |
| `resource_operational_relationships` | Exact directed step-to-step edges within one Process. |
| `saved_views` | The user's existing `logic_gate_kanban` grouping and Date Added preference. |

There is no separate board/card identity, persisted status column, board projection, or synchronization layer. Work data is read directly from its sources. Step order controls presentation; explicit directed edges describe flow and can branch.

## Commands and reads

The shared Process work API uses the exact `logic_gate_id` in the route:

| Endpoint | Action |
| --- | --- |
| `GET /v2/logic-gates/:logic_gate_id/work` | Current Process, permissions, steps, step relationships, and minimal Nodes. |
| `POST /v2/logic-gates/:logic_gate_id/nodes` | Create or assign a Node with independent status and optional `process_step_id`. |
| `PUT /v2/logic-gates/:logic_gate_id/nodes/:node_id/state` | Change Node work state using exact Node/Process identities. |
| `POST /v2/logic-gates/:logic_gate_id/steps` | Create a named step, optionally after an exact existing step. |
| `PATCH /v2/logic-gates/:logic_gate_id/steps/:process_step_id` | Rename or reorder that exact step. |
| `DELETE /v2/logic-gates/:logic_gate_id/steps/:process_step_id` | Delete that step and its incident edges while preserving Nodes and Process membership. |
| `POST /v2/logic-gates/:logic_gate_id/step-relationships` | Create one directed edge from exact typed `source` and `target` objects. |
| `DELETE /v2/logic-gates/:logic_gate_id/step-relationships/:relationship_id` | Remove only the chosen step edge. |

Every request carries the current company and follows the existing authenticated transport. Moving between steps sends `process_step_id` and any changed position without changing status. Start work explicitly selects a step and sets In Progress. Status-list transitions retain the prior step for later reopening.

`POST /v1/communications/triage/convert` retains the existing exact-mailbox payload and adds independent `status` and nullable `process_step_id`; it returns Nodes and assignments rather than cards. Personal drops carry normalized `account_email`; shared drops carry `shared_inbox_id`. Conversion preserves stored mailbox provenance and uses the existing local Home conversion reconciliation event.

`POST /v1/communications/email-nodes/transfer` accepts `company_id`, `source_node_id`, and `target_node_id`. It uses the existing canonical email relationships and stored message data, preserves the destination Node, and removes the temporary source Node after a successful transfer.

## Loading and updates

`ProcessWorkStore.ts` owns the exact company/Process cache and shared in-flight read. It retains a stale complete snapshot during revalidation and rejects obsolete selection responses. When invalidation supersedes a shared response, active readers share at most one fresh read; cancellation, cache clearing, and network failures are never retried. The UI reconciles mutations through the same loader; it does not create another polling loop or rebuild copied work data.

Realtime uses `process.work.changed` on `process:{logic_gate_id}`. The hint names the exact Process and contains no Node payload or replay sequence. Subscription acceptance, reconnection, local command completion, and server hints coalesce canonical reads. The backend rechecks current access and uses an actor-safe work ETag before returning either data or 304.

Node deletion remains the existing confirmed typed-target recycle command. Deleting a step is a distinct action that clears only its Nodes' step assignment. Step deletion never deletes those Nodes or changes their status.
