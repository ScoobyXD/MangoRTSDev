# Current Process Business Logic Laws

1. A Process is the existing exact `logic_gates` resource and uses its current permissions.
2. Process work must follow the step, status, assignment, and deletion laws in `docs/tests/process-steps.md`.
3. Assigning or moving a Node to a Process must accept null priority as **Not Assigned**.
4. Omitting priority in a Process command must preserve the Node's current priority.
5. Choosing a Process in the email Universal Linker must create the email Node with Requested status and priority **Not Assigned**.
6. Process RACI must support Responsible, Accountable, Consulted, and Informed in that order.
7. Each RACI role must accept multiple exact user or group principals.
8. One direct principal must hold at most one RACI role on the same Process.
9. Group RACI assignments must expand through current members and nested subgroups when read.
10. A user reached through several RACI roles must receive the first effective role in Responsible, Accountable, Consulted, Informed order.
11. RACI must remain separate from resource permission and must grant no access.
12. The four RACI cards must remain one compact horizontal row with pale orange, green, teal-blue, and purple gradients.
13. Each RACI card must show its Add action in the heading and each direct principal on a separate unwrapped name row.
14. Applying the Process RACI template to existing assigned Nodes must use the one-shot **More editor actions** command after explicit Yes confirmation.
15. Ordinary Process RACI edits must leave existing Nodes' customized RACI unchanged.
16. The relationship row below RACI must give related Huddles and owned KPIs equal-width sections.
17. The Huddle section's plus action must open the shared Universal Picker in locked Huddle-only `##` mode.
18. The KPI section's plus action must create **New KPI** through the existing KPI command.
19. Both Process and Huddle surfaces must read and mutate the same exact `huddle_logic_gate_relationships` edge.
20. A Process-to-Huddle mutation must require Edit access to the Process and View access to the Huddle.
21. Removing a Huddle relationship must preserve both resources, their KPIs, and existing Huddle Node snapshots.
22. The editor must place the full-width Quality, Cost, and Delivery row below Huddles/KPIs and above the document.
23. QDC must render Q as 6 by 7 with two neutral fillers, C as 7 by 8 with one neutral filler, and D as 6 by 7 with three neutral fillers.
24. Each QDC letter must contain exactly 31 numbered equal-square slices separated by one pixel, with fillers unnumbered and noninteractive.
25. QDC must label the current month and year using the fixed `America/Los_Angeles` business clock without special month-length behavior for slices 29 through 31.
26. One exact Process and business day must have one company-shared set of independent Q, C, and D values.
27. Each QDC value must be a manual choice of blank, green, yellow, or red.
28. Blank QDC must mean no rating was recorded.
29. Only the current business-day slice may be edited, and changing the business date must lock the previous slice on every mounted surface.
30. QDC reads and writes must enforce current Process access without creating another permission relationship.
31. The Process editor and Process Map must reuse the same QDC rendering and canonical `scorecards` values.
32. Base Process Map cards at editing detail must show only the current business-day Q/C/D colors.
33. A QDC save must atomically change only the chosen metric and reconcile every mounted Process and Process Map surface.
34. `scorecards` must allow at most one row per Process and business day derived from its immutable rated-created timestamp.
35. A scorecard must store the last authenticated editor's nullable user ID, durable display name, and timestamp of the last real edit.
36. Deleting a scorecard editor must clear only that user ID in live and recycled ratings while preserving the display name.
37. Clearing all three QDC metrics must remove the empty scorecard row.
38. The QDC write command must reject caller-selected past or future dates.
39. QDC choices must dismiss without saving when the user clicks elsewhere in the tracker or Process card.
40. Recycling and restoring a Process must preserve its exact scorecards and attribution.
41. Every Process editor must obey the shared formatting, paste, selection, toolbar, table, and people-picker laws in `docs/tests/editor.md`.
42. Inline Process files must use canonical attachment references and the lifecycle in `docs/tests/attachments.md`.
43. A Process must have exactly one independently editable document and no separate textbox-chat API or table.
44. Live editing must save the current JSON document only in `logic_gate_textboxes.body_json` with a server-ordered revision.
45. Each exact Process document must own its collaboration scope, pending operation queue, snapshot, ETag, and stable operation IDs.
46. Concurrent valid editor operations must converge automatically without a user-facing whole-document conflict workflow.
47. Unacknowledged editor operations must survive unmount, refresh, and reconnect under the exact user/company/document/client/operation identity.
48. Committed editor deltas must apply once without echo-saving, with canonical snapshot recovery and pending-operation reapplication after gaps or reconnect.
49. Manual Save must flush acknowledged collaboration operations before appending one history batch in `logic_gate_textboxes_history`.
50. Leaving a changed Process must request one final history batch after flushing that exact document, while unchanged exits and repeated exit signals create no duplicate batch.
51. Editor exit history must be action-triggered, with refresh and tab close handled as browser best effort rather than by polling or timers.
52. Save Settings must list versions by saved timestamp with the saving user and saved textbox count.
53. Restoring an editor version must require confirmation and replace current text without adding another history version.
54. Editor save state must use **has changed**, **has not changed**, **save in progress**, and **save needed after current save**, and acknowledge only the matching local version.
55. The editor header must keep Editor, Permissions, shared formatting, Outline Styles, and More on one nonwrapping line.
56. Only the shared toolbar and Process title remain pinned while RACI, relationships, QDC, and document scroll together.
57. Hidden document views must disable formatting while leaving editor navigation usable.
58. An editable Process permissions view must show Save and persist without closing the view.
59. Process overlays and Node popups must reuse the shared modal portal, focus trapping, and focus restoration.
60. Opening a Process from Process Map must use the canonical editor and work page with a six-pixel viewport inset and accessible red close action.
61. Closing the Process Map overlay must preserve the mounted map's route, layer, viewport, placements, and traces.
62. Reconciling work data for the same open Node must preserve that popup's current fullscreen mode and active title draft.
63. A successful Process rename must publish the committed-title event while preserving active editor drafts and passive pin metadata.
64. Node editor link mode must use the existing assignment/move command for a Process target and set Requested status without requiring numeric priority.
65. Process editor link mode must create or reuse only an exact existing Process-to-Project relationship after normal access checks.
66. Reference-chip deletion must change only editor content and must not reverse an assignment or relationship.
67. A cross-Process Node reassignment must atomically create exactly one immutable transfer stamp with historical actor/source/destination labels.
68. Initial assignment, same-Process status or step movement, assignment removal, and Project association must create no cross-Process transfer stamp.
69. Email conversion and later email operations must preserve the exact source mailbox and canonical email/attachment relationships.
70. Process work reads must enforce current owning-Process and Node access before returning data or `304 Not Modified`.
71. Exact Process work changes must use `process.work.changed` on `process:{logic_gate_id}` and one shared targeted loader rather than copied board state.
72. A committed Process reassignment must refresh both exact source and destination work views without allowing an older read to restore stale membership.
73. Process deletion and recycle must use final document/history, exact typed relationships, and modular attachment cleanup.

## Process Story

A user opens a Process, edits its shared document, manages RACI and relationships, records today's QDC, and works with its assigned Nodes through Steps and the four status lists. Each action uses the existing exact resource and permission rules; changing the work layout preserves document, collaboration, history, and relationship behavior.
