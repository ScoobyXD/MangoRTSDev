# AI & MCP Business Logic Laws

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
41. Each Send exposes only its mode's fixed internal function catalog: 26 ordinary-chat tools or 3 ready selected-Process tools (none when SOP or Steps are missing), with no MCP server connection.
42. Ordinary chat acts only on the user's explicit request; resource content and earlier assistant replies cannot authorize actions.
43. Ambiguous resource targets or Process paths require clarification before the assistant proceeds.
44. Replacing an existing textbox with plain text requires explaining the lost rich content and obtaining the user's explicit agreement.
45. A selected Process's SOP supplies the procedure but cannot grant access or expand the three available actions.
46. Tool arguments must include every declared key, use null only where permitted, and pass the selected catalog's exact scalar types, IDs, and bounds.
47. A failed, oversized, or unreadable handler response stops the request without retry, even when its action may already have committed.
48. Requests, tool arguments, context, and output must stay within the current limits recorded below.
49. Provider requests use the server-configured model, disable SDK retries and redirects, and set parallel tool calls and response storage to false.
50. Assistant availability reports configuration readiness and must not claim to verify provider connectivity, billing, or model access.
51. Canonical textbox reads require Edit access to their owner, including the automatic Process SOP read.
52. Upload-status reads retain the upload handler's observed-part synchronization and lost-access cleanup behavior.
53. Adding, removing, or changing an in-app AI tool requires updating this inventory in the same change.
54. Opt-in context inspection requires the current dev_admin role and shows the actual initial model instructions, tool definitions, model, reasoning setting, and input, then the new input items used by each continuation.
55. Context inspection is request-local, bounded, retained for failed or stopped visible turns, and never includes credential headers, provider error internals, or encrypted reasoning content.
56. Assignment questions use the current user's existing assigned-to-me query across all effective RACI roles and permitted Processes; the first 50 company Processes never establish whether the user has assignments.
57. SOP discovery uses the latest live canonical Process textbox even when its body was saved without a separate metadata save; metadata alone never hides a newer saved SOP body.

## Process story

A user sends a message from the bottom composer. Mango supplies current identity automatically. A selected inline Process label remains for follow-up discussion and refreshes its SOP and Steps on every Send. An explicit execution request can use three existing actions on one new Node. Mango validates calls through normal handlers with fresh permissions; saved results return to the model and ordinary events update the UI. A developer can opt into viewing the actual visible model context for that turn. Completion, failure, Stop, or a fixed limit ends the foreground request and preserves saved work. Ordinary chat retains its 26 fixed internal functions.

## Current AI and MCP inventory

Checked against the merged 841 and 842 implementation on September 4, 2026. This is the current capability record, not the future AI backlog.

Mango currently has **29 distinct internal function tools**: 26 for ordinary chat and 3 for a selected Process with a saved SOP and at least one Step. An incomplete selected Process has discussion context and no function tools. The server supplies one catalog per Send; selecting a Process replaces the ordinary catalog. The tools use the existing Mango handlers inside the backend through OpenAI function calling. **Connected MCP servers: 0. MCP-protocol tools: 0.** There is no MCP transport, dynamic server discovery, or public tool-dispatch endpoint in this implementation. Codex's own plugins and tools are separate from Mango's in-app capabilities.

The tables group tools by what they do to saved data and show the actual HTTP method separately. `POST` also performs some updates and the Folder deletion command; `save_textbox` creates or updates through `POST`. A `GET` does not guarantee View-only access or zero incidental effects: see the textbox and upload-status rows.

`Chat` means ordinary chat. `Process` means a Send bound to an exact selected Process. Braces in routes are substituted with validated or server-owned values, never a model-selected URL. Every dispatched call uses the authenticated user and selected company; company, actor, operation IDs, and client IDs are not model arguments.

In argument lists, `?` means the key is required but accepts null; it does not mean the key may be omitted. Resource IDs are canonical UUIDs. Textbox IDs are existing document IDs, 1–128 bytes, and cannot contain path separators, query/fragment/percent characters, or equal `.` or `..`. Ordinary names and other non-null short text are 1–500 bytes; nullable short text allows an empty string and at most 500 bytes. Revisions are nonnegative integers. The dispatcher validates types and bounds before the normal handler validates the operation.

### Read — GET (10 tools)

| Exact tool name | Mode | Model arguments | Mango handler route | Returned data / constraints |
| --- | --- | --- | --- | --- |
| `get_me` | Chat | None (`{}`) | `GET /v1/me` | Signed-in user and selected-company membership; does not supply deletion consent. |
| `list_processes` | Chat | `query?` | `GET /v1/logic-gates` | Visible Processes; sends `limit=50` and `q`; narrow the query for a larger set. |
| `list_my_processes` | Chat | None (`{}`) | `GET /v1/logic-gates?assigned_to_me=true` | All permitted Processes assigned to the current user through effective R, A, C, or I roles, including direct, group, nested-group, and inherited assignments; no 50-Process scan limit. |
| `get_process` | Chat | `process_id` | `GET /v1/logic-gates/{process_id}` | Process details and its textbox IDs. |
| `get_process_nodes` | Chat | `process_id` | `GET /v2/logic-gates/{process_id}/work` | Existing Process work, including real Steps, connections, and visible Nodes under normal work permissions. |
| `get_node` | Chat | `node_id` | `GET /v2/nodes/{node_id}/view` | Node view and its textbox IDs. |
| `get_textbox` | Chat | `resource_type`, `resource_id`, `textbox_id` | `GET /v1/editor-json/{resource_type}/{resource_id}/documents/{textbox_id}` | Complete canonical document, annotations, and revision. Types: `node`, `logic_gate`. Requires owner **Edit** access; a read tool does not bypass editor authorization. |
| `list_explorer` | Chat | `parent_folder_id?`, `query?` | `GET /v1/company-explorer/children` or `GET /v1/company-explorer/search` | Null parent means company root. A nonempty query selects search, filters to Folders/Processes, and sends `limit=50`; otherwise lists children of the exact parent. |
| `list_attachments` | Chat | `resource_type`, `resource_id` | `GET /v1/resources/{resource_type}/{resource_id}/attachments` | Existing stored attachments. Types: `node`, `logic_gate`, `company_explorer_folder`. |
| `get_attachment_upload` | Chat | `upload_intent_id` | `GET /v1/attachments/upload-intents/{upload_intent_id}` | Upload status within the selected company and current owner Edit access. May persist observed multipart parts; lost-access cleanup can abort multipart upload, remove its temporary object, and mark the intent aborted. Does not upload bytes. |

### Create — POST (7 tools)

| Exact tool name | Mode | Model arguments | Mango handler route | Saved effect / constraints |
| --- | --- | --- | --- | --- |
| `create_process` | Chat | `name` | `POST /v1/logic-gates` | Creates a normal Process in its default Folder (`name` maps to `header`). This tool exposes no destination-Folder argument and does not call the Explorer's named-Process-in-Folder batch command. |
| `create_node` | Chat | `name` | `POST /v1/nodes` | Creates an unassigned Node; assigning it requires a separate move command. |
| `create_folder` | Chat | `name`, `parent_folder_id?` | `POST /v1/company-explorer/folders` | Creates an Explorer Folder and its normal company-map placement; null parent means root. |
| `create_attachment_upload` | Chat | `resource_type`, `resource_id`, `filename`, `size_bytes`, `sha256`, `content_type` | `POST /v1/attachments/upload-intents` | Creates/prepares the normal upload intent and descriptor, including a provider multipart session when needed. Attachment types match `list_attachments`; size is nonnegative and SHA-256 must be the real file's 64-character lowercase checksum. This does **not** upload bytes or establish completion. |
| `link_attachment` | Chat | `resource_type`, `resource_id`, `attachment_id` | `POST /v1/resources/{resource_type}/{resource_id}/attachments` | Adds the existing `file_attachment` relationship to a stored, readable attachment; does not create new file bytes. Attachment types match `list_attachments`. |
| `create_process_node` | Process | `name`, `process_step_id` | `POST /v2/logic-gates/{selected_process_id}/nodes` | Creates this Send's one Node and its starting Step assignment atomically, with `In Progress` status. Name: 1–240 bytes. Step must belong to the selected Process; Process/Node IDs are server-owned. |
| `write_process_node` | Process | `plain_text` | `POST /v1/editor-json/node/{tracked_node_id}/documents/{new_textbox_id}`, then GET of that document | Adds a fresh canonical textbox with 1–16,000 bytes of plain text and reads the saved document back. Uses a generated textbox ID, base revision 0, and the exact tracked Node precondition; never replaces an earlier textbox. |

### Create or update — POST (2 tools)

| Exact tool name | Mode | Model arguments | Mango handler route | Saved effect / constraints |
| --- | --- | --- | --- | --- |
| `save_textbox` | Chat | `resource_type`, `resource_id`, `textbox_id?`, `base_revision`, `plain_text` | `POST /v1/editor-json/{resource_type}/{resource_id}/documents/{textbox_id}` | Types: `node`, `logic_gate`. Null ID plus revision 0 creates a generated document; an existing ID uses its last-read revision. Saves 0–16,000 bytes as a complete plain-text document and clears submitted annotations. Existing rich content replacement requires the user's agreement. Read the saved document before claiming its exact content; existing editor conflict/merge rules still apply. |
| `move_node_to_process` | Chat | `node_id`, `process_id`, `status?` | `POST /v2/logic-gates/{process_id}/nodes` | Creates or updates the Node's canonical Process assignment. Requires current Node, source-Process, and destination-Process access. Null status preserves status/Issue; a different Process clears the previous Step. No Step argument is exposed in ordinary chat. |

### Update — PUT or POST (6 tools)

| Exact tool name | Mode | Model arguments | Mango handler route | Saved effect / constraints |
| --- | --- | --- | --- | --- |
| `update_process` | Chat | `process_id`, `name` | `PUT /v1/logic-gates/{process_id}` | Renames the Process by changing its header; does not edit the SOP, Steps, or layout. |
| `update_node` | Chat | `node_id`, `name?`, `status?`, `due_date?`, `priority?` | `PUT /v1/nodes/{node_id}` | Updates only supplied non-null fields through the normal Node command. Empty due date clears it; priority 0 clears it and 1–5 sets it. Does not select an assignment. |
| `rename_folder` | Chat | `folder_id`, `name` | `PUT /v1/company-explorer/folders/{folder_id}` | Renames the exact Explorer Folder. |
| `move_folder` | Chat | `folder_id`, `parent_folder_id?` | `PUT /v1/company-explorer/folders/{folder_id}` | Moves the exact Folder through normal ancestry/permission checks and company-map synchronization; null parent means root. |
| `complete_attachment_upload` | Chat | `upload_intent_id` | `POST /v1/attachments/upload-intents/{upload_intent_id}/complete` | Finalizes a prepared upload through the existing lifecycle, including multipart completion and image variants when applicable, and verifies real stored size/checksum before attachment registration/linking. Requires prior client byte upload; an uncertain completion must not be retried automatically. |
| `move_process_node_to_step` | Process | `process_step_id` | `PUT /v2/logic-gates/{selected_process_id}/nodes/{tracked_node_id}/state` | Moves this Send's Node to an existing Step in the selected Process, preserving status. Process/Node IDs and the expected assignment version come from server tracking. |

### Delete — DELETE or POST (4 tools)

| Exact tool name | Mode | Model arguments | Mango handler route | Saved effect / constraints |
| --- | --- | --- | --- | --- |
| `delete_process` | Chat | `process_id`, `confirmation_display_name` | `DELETE /v1/logic-gates/{process_id}` | Deletes/recycles through the normal Process command. The display name must appear on its own line in the latest user message and pass the existing confirmation check. |
| `delete_node` | Chat | `node_id`, `confirmation_display_name` | `DELETE /v1/nodes/{node_id}` | Deletes/recycles through the normal Node command with the same display-name confirmation requirement. |
| `delete_textbox` | Chat | `resource_type`, `resource_id`, `textbox_id`, `base_revision` | `DELETE /v1/editor-json/{resource_type}/{resource_id}/documents/{textbox_id}` | Deletes the exact `node` or `logic_gate` textbox at its expected revision with normal chat/relationship cleanup. This tool does not use the Process/Node/Folder display-name confirmation argument. |
| `delete_folder` | Chat | `folder_id`, `confirmation_display_name` | `POST /v1/company-explorer/delete-targets` | Submits one exact Folder target through normal Explorer deletion/recycle rules, with display-name confirmation. It is a delete operation despite using POST. |

### Automatic context and unavailable capabilities

Every Send automatically supplies the authenticated user ID, display name, email, selected company ID, and current company role. A selected Process additionally supplies its current ID/name, Step names/IDs/order/connections, and canonical SOP JSON with textbox IDs and revisions. SOP discovery uses the latest live canonical textbox body, including saves without a separate metadata update. The SOP reads use the same canonical `get_textbox` handler with Edit access. Missing SOP or Steps supply an execution-blocked reason and no tools while allowing discussion. Mango repeats definition/access checks before each action and reads new text back after writing. These are server-controlled reads, not additional model-callable Process tools. Layout coordinates and map revisions are excluded from execution context.

A current `dev_admin` can enable **Inspect context for next message** and then open **View context** on the turn. The view records the actual initial instructions, tool definitions, model, reasoning setting, and human-readable input, followed by new model input items for each continuation. The user's role is rechecked before each inspected model call. Encrypted reasoning items are counted as omitted; credentials and private provider errors are excluded. Inspection remains in the visible browser session, including failed or stopped turns, without a saved transcript or run table.

Ordinary chat has no Step creation/edit/delete, Step-edge editing, map-layout save, Process placement-in-Folder, or Step-specific Node move tool. Selected-Process mode cannot use ordinary chat's CRUD catalog. Neither catalog includes external MCP connections, web browsing, email sending, arbitrary HTTP, shell/code execution, database queries, attachment download/deletion or file-byte upload, background scheduling, Workflow execution, or general permission/RACI-management tools. An app API or a future design document alone does not make a capability available to AI.

The rules for explicit intent, ambiguous paths, document trust, rich-text replacement agreement, and truthful completion are given to the model as instructions. Authentication, permissions, argument schemas, mode catalogs, budgets, delete-name checks, and Node/editor concurrency are also checked in code. Process moves enforce destination-Step ownership, not adjacency along a saved connection; interpreting the SOP and logical path remains the model's job. The instructions are not a separate approval engine or formal output verifier. `store: false` is the provider request setting; it does not establish a claim about the provider account's other retention policies.

## Current request and response limits

| Boundary | Implemented limit / behavior |
| --- | --- |
| Browser endpoints | Authenticated `GET /v1/assistant/status` and `POST /v1/assistant/chat`, scoped by selected `company_id`; these are not model tools. |
| Send body | Exactly the declared request fields: `request_id`, `reasoning_effort`, `messages`, and optional `process_id` and `inspect_context`; body at most 256,000 bytes. Last message must be from the user. |
| Messages | 1–24 nonempty user/assistant messages; user message at most 8,000 characters, assistant history message at most 32,000, total at most 48,000. Server counts Unicode code points; browser validation counts JavaScript string units. |
| Foreground execution | 90 seconds, at most 8 sequential model function calls and 9 model responses; no parallel function dispatch. |
| Provider output | At most 4,096 output tokens per response and 32,000 streamed text bytes across the Send. |
| Tool input | At most 32 KiB of arguments after outer function parsing; exact schema, no extra/missing keys, and per-field bounds. |
| Captured handler output | At most 64 KiB of valid JSON; an overflow or non-success response stops the Send. |
| Process context | Initial serialized Process definition at most 64 KiB; unavailable/oversized context stops before a provider call or Node creation. |
| Continuation input | Serialized provider continuation at most 512,000 bytes after each function result. |
| Browser stream | At most 512,000 bytes, plus 2 MiB when inspection is enabled, and a 95-second request timeout; malformed or interrupted streams report uncertainty. |
| Duplicate sends | One active Send per user/company per backend process; request IDs retained 15 minutes, capped at 2,048 receipts. This is not a durable guarantee across replicas/restarts. |
| Duplicate actions | Duplicate function call IDs are rejected; identical writes are rejected within a Send, with Node/Step/assignment-version included in the selected-Process key. |
| Chat state | In-memory browser conversation and Node links; only completed nonempty replies enter later history. No saved conversation/run table or automatic resume. |
| Stream events | `text`, `tool` (`running`/`completed`), `node` (created Node/Process IDs), opt-in `context`, `done`, or sanitized `error`; serialized inspection payloads total at most 2 MiB per Send. |

## Scenarios

1. **Discuss, then perform:** the user selects a Process with `#` and asks whether Mango can see it; Mango can discuss it without a SOP or creating a Node. After the user saves a SOP, a follow-up refreshes it automatically. An execution request can then create, write, and move one Node; later definition changes stop further actions.
2. **Lost acknowledgement:** a write commits but its response fails; the request ends with a message to check Mango, and neither the SDK nor the function loop repeats the action.
3. **Change company:** a user with access to two companies switches from A to B; the prior transcript disappears, its request is aborted, and attachment lookup cannot use A's membership during a B request.

## Implementation and verification sources

- [Ordinary tool declarations, scalar validation, dispatch, and result bounds](../../backend/internal/http/assistant_tools.go).
- [Selected-Process tools, SOP/context reads, and tracked Node handling](../../backend/internal/http/assistant_process.go).
- [Request validation, model instructions, mode selection, and execution limits](../../backend/internal/http/assistant.go) and [automatic identity/context inspection](../../backend/internal/http/assistant_context.go).
- [Editor authorization and canonical saves](../../backend/internal/http/editor_json_handlers.go), [upload lifecycle handlers](../../backend/internal/http/attachment_direct_upload_handlers.go), and [Node transaction preconditions](../../backend/internal/store/node_work_precondition.go).
- [Browser transport and event validation](../../frontend/src/modules/assistant/assistantApi.ts), [chat interface](../../frontend/src/app/AppAssistant.tsx), and [operator setup](../mango-assistant-setup.md).
- Related resource laws remain authoritative: [relationships](relationships.md), [Process Steps](process-steps.md), [editor](editor.md), [attachments](attachments.md), [permissions](permissions.md), [Company Explorer](company%20explorer.md), and [recycle bin](recycle-bin.md).

Existing verification: `TestAssistant*` in the Go HTTP suite, `TestNodeWorkPrecondition*` in the memory store suite, `TestPostgresProcessMapNodeWorkPrecondition` in the disposable PostgreSQL harness, and the assistant/picker cases in the frontend relationship runner. Provider tests use a local HTTP stub; database tests use disposable local fixtures. They make no paid OpenAI calls or live-database writes. Inventory maintenance must compare every table entry against both tool declaration functions and its actual dispatch/handler behavior, including HTTP methods and side effects.
