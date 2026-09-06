### Read — GET (11 tools)

| Exact tool name | Mode | Model arguments | Mango handler route | Returned data / constraints |
| --- | --- | --- | --- | --- |
| `get_me` | Chat | None (`{}`) | `GET /v1/me` | Signed-in user and selected-company membership; does not supply deletion consent. |
| `list_chat_users` | Both | `query?` | `GET /v1/companies/{company_id}/users?mentionable=true&q={query}` | Canonical mentionable user IDs, names, and emails, including eligible global developer administrators. Name/email filtering precedes the 50-result and response-size bounds; `has_more` requires narrowing the query. Ambiguous names require clarification. |
| `list_processes` | Chat | `query?` | `GET /v1/logic-gates` | Visible Processes; sends `limit=50` and `q`; narrow the query for a larger set. |
| `list_my_processes` | Chat | None (`{}`) | `GET /v1/logic-gates?assigned_to_me=true` | All permitted Processes assigned to the current user through effective R, A, C, or I roles, including direct, group, nested-group, and inherited assignments; no 50-Process scan limit. |
| `get_process` | Chat | `process_id` | `GET /v1/logic-gates/{process_id}` | Process details and its textbox IDs. |
| `get_process_nodes` | Chat | `process_id` | `GET /v2/logic-gates/{process_id}/work` | Existing Process work, including real Steps, connections, and visible Nodes under normal work permissions. |
| `get_node` | Chat | `node_id` | `GET /v2/nodes/{node_id}/view` | Node view and its textbox IDs. |
| `get_textbox` | Chat | `resource_type`, `resource_id`, `textbox_id` | `GET /v1/editor-json/{resource_type}/{resource_id}/documents/{textbox_id}` | Complete canonical document, annotations, and revision. Types: `node`, `logic_gate`. Requires owner **Edit** access; a read tool does not bypass editor authorization. |
| `list_explorer` | Chat | `parent_folder_id?`, `query?` | `GET /v1/company-explorer/children` or `GET /v1/company-explorer/search` | Null parent means company root. A nonempty query selects search, filters to Folders/Processes, and sends `limit=50`; otherwise lists children of the exact parent. |
| `list_attachments` | Chat | `resource_type`, `resource_id` | `GET /v1/resources/{resource_type}/{resource_id}/attachments` | Existing stored attachments. Types: `node`, `logic_gate`, `company_explorer_folder`. |
| `get_attachment_upload` | Chat | `upload_intent_id` | `GET /v1/attachments/upload-intents/{upload_intent_id}` | Upload status within the selected company and current owner Edit access. May persist observed multipart parts; lost-access cleanup can abort multipart upload, remove its temporary object, and mark the intent aborted. Does not upload bytes. |

### Create — POST (9 tools)

| Exact tool name | Mode | Model arguments | Mango handler route | Saved effect / constraints |
| --- | --- | --- | --- | --- |
| `create_process` | Chat | `name` | `POST /v1/logic-gates` | Creates a normal Process in its default Folder (`name` maps to `header`). This tool exposes no destination-Folder argument and does not call the Explorer's named-Process-in-Folder batch command. |
| `create_node` | Chat | `name` | `POST /v1/nodes` | Creates an unassigned Node; assigning it requires a separate move command. |
| `create_folder` | Chat | `name`, `parent_folder_id?` | `POST /v1/company-explorer/folders` | Creates an Explorer Folder and its normal company-map placement; null parent means root. |
| `create_attachment_upload` | Chat | `resource_type`, `resource_id`, `filename`, `size_bytes`, `sha256`, `content_type` | `POST /v1/attachments/upload-intents` | Creates/prepares the normal upload intent and descriptor, including a provider multipart session when needed. Attachment types match `list_attachments`; size is nonnegative and SHA-256 must be the real file's 64-character lowercase checksum. This does **not** upload bytes or establish completion. |
| `link_attachment` | Chat | `resource_type`, `resource_id`, `attachment_id` | `POST /v1/resources/{resource_type}/{resource_id}/attachments` | Adds the existing `file_attachment` relationship to a stored, readable attachment; does not create new file bytes. Attachment types match `list_attachments`. |
| `create_process_node` | Process | `name`, `process_step_id` | `POST /v2/logic-gates/{selected_process_id}/nodes` | Creates this Send's one Node and its starting Step assignment atomically, with `In Progress` status. Name: 1–240 bytes. Step must belong to the selected Process; Process/Node IDs are server-owned. |
| `write_process_node` | Process | `plain_text` | `POST /v1/editor-json/node/{tracked_node_id}/documents/{new_textbox_id}`, then GET of that document | Adds a fresh canonical textbox with 1–16,000 bytes of plain text and reads the saved document back. Uses a generated textbox ID, base revision 0, and the exact tracked Node precondition; never replaces an earlier textbox. |
| `send_node_chat` | Chat | `node_id`, `textbox_id`, `message`, `mentioned_user_ids`, `urgent_user_ids` | `POST /v1/nodes/{node_id}/information` | Creates one root chat in the exact existing textbox after an authorized canonical read. Body is 1–16,000 bytes; each required ID array contains at most 20 distinct user UUIDs, with no overlap. Mango constructs and verifies actual mention tokens through the existing notification parser. |
| `send_process_node_chat` | Process | `textbox_id`, `message`, `mentioned_user_ids`, `urgent_user_ids` | `POST /v1/nodes/{tracked_node_id}/information` | Same chat operation and mention rules, restricted to the server-tracked Node with its expected work state checked inside the chat transaction. |

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

### Supporting reads

| Exact tool name | Mode | Arguments | Actual behavior |
| --- | --- | --- | --- |
| bind_process | Chat | Exact process_id | Existing Process/SOP permission checks load a definition and bind it once. No public handler, mutation, new identity, or execution authorization. |
| read | Both | Exact approved path | Pi's native read operations return one complete immutable packaged instruction/skill/reference file. Other paths, offsets, limits, shell, and filesystem fallback are unavailable. |