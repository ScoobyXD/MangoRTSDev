# Mango Assistant Business Logic Laws

1. Chat requires a signed-in Mango user and a selected company with current access.
2. Every function rechecks the user's company role and uses only that company, the authenticated user, and fixed Mango handlers.
3. Function arguments must match their declared schema and must never select an actor, company, URL, executable code, or undeclared operation.
4. Process tools use exact `logic_gate` identities; Node, textbox, Folder, and attachment tools retain their existing canonical identities and relationships.
5. Tools use ordinary Mango permissions, validation, editor revisions, deletion rules, and events.
6. Deleting a Process, Node, or Folder requires its normal display-name confirmation and that name on its own line in the latest user message.
7. Saving a textbox submits all replacement plain text in one canonical editor operation and clears rich formatting, inline content, and annotations in the submitted document.
8. Existing editor conflict behavior remains authoritative, including PostgreSQL concurrent block merging; the assistant must read the saved textbox before claiming exact final content.
9. Preparing an attachment upload must not claim that file bytes were uploaded or that an attachment is complete.
10. Attachment completion must use Mango's existing stored-byte size and checksum verification before reporting success.
11. One Send starts one foreground request with at most eight sequential functions, nine model responses, 4,096 output tokens per response, 32,000 streamed text bytes, and a 90-second request deadline.
12. Partial, failed, incomplete, duplicated, or excessive model function calls must not be dispatched; a failed or uncertain Mango action stops the request without automatic retry.
13. Stop, disconnect, or scope change cancels provider work and prevents later functions; an action already entered may commit and must never be described as undone.
14. One user/company may have one active request per backend process; repeated request IDs are rejected for fifteen minutes by a bounded process-local receipt cache.
15. Changing account or company clears the visible session and aborts its request; chat has no saved history table or background job.
16. OpenAI credentials remain on the server, provider errors remain private, and missing key or model configuration produces an unavailable state.
17. Only completed nonempty replies enter later conversation history; interrupted or failed turns must not be silently resubmitted.
18. Moving a Node to a Process uses the canonical Process work command and checks current access to the Node, its stored source Process, and the destination Process.
19. A move with null status preserves the Node's current status and Issue flag; moving to another Process clears the previous step assignment.
20. Mango chat floats above the app canvas and must not reduce the canvas dimensions.
21. Expanded chat has one centered circular down-arrow control that collapses the entire chat surface to one centered circular up-arrow control; focus follows the replacement control, and expanding restores the same in-memory session.
22. Mango chat is centered on the browser viewport regardless of app sidebar or canvas dimensions.
23. When Secrets Manager configures local chat, the cloud-integrated launcher itself must write only the resolved assistant model and secret ARN into the caller's shell; it must never fetch, log, write, or leave the referenced OpenAI key there.
24. Each Send selects exactly one reasoning effort from low, medium, high, xhigh, or max; the backend rejects every other value and applies the selected effort to every provider step in that Send.
25. A new browser chat session starts collapsed; expanding it preserves the selected reasoning effort, which defaults to medium and remembers the last valid browser choice.
26. API startup must prefer a nonempty `OPENAI_API_KEY`; otherwise, when the model and `OPENAI_API_KEY_SECRET_ARN` exist, it must read one nonempty key from that secret into memory, and an explicit retrieval failure must stop startup.
27. Selecting a Process with the universal `#` reference picker inserts the existing atomic inline label; its exact identity remains selected across Sends until removed, replaced, or the session is cleared.
28. Every Send automatically loads the authenticated user's ID, name, email, company ID, and current company role; a selected Process additionally loads its current identity/name, real Steps/order/connections, and canonical SOP.
29. Process context uses the existing canonical SOP document and never adds a separate Step instruction field or interprets map coordinates as execution order.
30. Selecting a Process supplies discussion context and never means permission to execute; only an execution request may use its three actions to create one Node, add text, and move that Node between its Steps.
31. Process tools never accept a model-selected company, actor, Process, Node, or textbox identity; Step arguments must identify actual Steps of the selected Process.
32. Creating the request's Node uses the existing atomic Process assignment command with its starting Step and In Progress status.
33. Each Process text write creates a fresh canonical Node textbox and reads its saved document back; it never replaces existing content.
34. Process Step movement uses the existing Node state command and preserves Node status.
35. Before every Process action, Mango rechecks current access and the loaded logical definition, and stops if the SOP, Steps, connections, or tracked Node placement/status changed.
36. A Process with no Steps or saved SOP remains available for discussion with no execution tools; unavailable or excessive context stops before a model request, and execution commands reject missing prerequisites.
37. The created Node is linked in the chat turn even if later work stops or fails, and ordinary committed events update the existing Process Board.
38. Selecting a Process grants no external tool access, broad CRUD access, background execution, formal output verification, staging, rollback, or permission to change its authored definition.
39. Each Process write or move checks the expected Process, Step, Node status, and assignment version inside its existing storage transaction; a mismatch saves nothing and stops the request.
40. Repeating the same text at different Step placements is allowed; repeating an identical action at the same assignment version stops the request.
41. Opt-in context inspection requires the current dev_admin role and shows the actual initial model instructions, tool definitions, model, reasoning setting, and input, then the new input items used by each continuation.
42. Context inspection is request-local, bounded, retained for failed or stopped visible turns, and never includes credential headers, provider error internals, or encrypted reasoning content.
43. Assignment questions use the current user's existing assigned-to-me query across all effective RACI roles and permitted Processes; the first 50 company Processes never establish whether the user has assignments.
44. SOP discovery uses the latest live canonical Process textbox even when its body was saved without a separate metadata save; metadata alone never hides a newer saved SOP body.

## Process story

A user sends a message from the bottom composer. Mango supplies current identity automatically. A selected inline Process label remains for follow-up discussion and refreshes its SOP and Steps on every Send. An explicit execution request can use three existing actions on one new Node. Mango validates calls through normal handlers with fresh permissions; saved results return to the model and ordinary events update the UI. A developer can opt into viewing the actual visible model context for that turn. Completion, failure, Stop, or a fixed limit ends the foreground request and preserves saved work.

## Scenarios

1. **Discuss, then perform:** the user selects a Process with `#` and asks whether Mango can see it; Mango can discuss it without a SOP or creating a Node. After the user saves a SOP, a follow-up refreshes it automatically. An execution request can then create, write, and move one Node; later definition changes stop further actions.
2. **Lost acknowledgement:** a write commits but its response fails; the request ends with a message to check Mango, and neither the SDK nor the function loop repeats the action.
3. **Change company:** a user with access to two companies switches from A to B; the prior transcript disappears, its request is aborted, and attachment lookup cannot use A's membership during a B request.

Verification: `TestAssistant*` in the Go HTTP suite, `TestNodeWorkPrecondition*` in the memory store suite, `TestPostgresProcessMapNodeWorkPrecondition` in the disposable PostgreSQL harness, and the assistant/picker cases in the frontend relationship runner. Provider tests use a local HTTP stub; database tests use disposable local fixtures. They make no paid OpenAI calls or live-database writes.
