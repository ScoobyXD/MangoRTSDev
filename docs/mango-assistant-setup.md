# Mango chat setup

The bottom composer, authenticated status/chat endpoints, streamed OpenAI Responses API calls, function-result continuation, and 25 internal Mango functions are implemented. The official Go SDK is pinned to `v3.30.0`, which supports Mango's existing Go version. No schema change is required.

An operator must supply both server runtime settings:

| Setting | Value |
| --- | --- |
| `OPENAI_API_KEY` | An OpenAI project API key, injected through the server's secret environment. |
| `MANGORTS_ASSISTANT_MODEL` | An enabled Responses API model ID supporting text output and strict function calling. |

For dev, store the raw OpenAI key only as the plaintext secret value in AWS Secrets Manager. Put only that secret's ARN in the GitHub Actions repository variable `TF_OPENAI_API_KEY_SECRET_ARN`; never put the raw key in GitHub. The repository variable `TF_ASSISTANT_MODEL` defaults to `gpt-5.6-luna`. Run the dev deployment after configuring these variables. ECS resolves the ARN and injects `OPENAI_API_KEY` and `MANGORTS_ASSISTANT_MODEL` into the backend task. Updating the secret value does not refresh a running task; deploy a new source revision or explicitly force a new ECS service deployment after rotating the key. No key retrieval, billing setup, AWS deployment, or paid call was performed for this implementation.

Chat uses Mango's existing signed-in user and `company_id` query scope. `GET /v1/assistant/status` returns `{ "available": false }` until both settings exist; availability means configured, not a provider billing/connectivity check. `POST /v1/assistant/chat` accepts `{ "request_id": "UUID", "messages": [{ "role": "user", "content": "Hello" }] }` and streams `text`, `tool`, `done`, or sanitized `error` events. Unauthenticated local mode cannot run assistant actions; use the existing authenticated app setup. There is no public tool-dispatch endpoint.

The provider receives conversation text and the Mango data returned by requested functions. Responses use `store: false`; conversation state stays in the current browser session. Server-only model configuration has no browser picker. These choices do not change the provider account's separate retention policies.

| Area | Internal functions |
| --- | --- |
| Current user | `get_me` |
| Processes | `list_processes`, `get_process`, `get_process_nodes`, `create_process`, `update_process`, `delete_process` |
| Nodes | `get_node`, `create_node`, `update_node`, `delete_node`, `move_node_to_process` |
| Textboxes | `get_textbox`, `save_textbox`, `delete_textbox` |
| Company Explorer | `list_explorer`, `create_folder`, `rename_folder`, `move_folder`, `delete_folder` |
| Attachments | `list_attachments`, `create_attachment_upload`, `get_attachment_upload`, `complete_attachment_upload`, `link_attachment` |

Process updates rename a Process. Node updates expose its name, status, due date, and priority; assignment uses the existing move command. Textbox tools support Nodes and Processes. Attachment tools support Nodes, Processes, and Company Explorer Folders. Reads are bounded; narrow a search when a result is too large.

Textbox save replaces the whole submitted document with plain text, removing rich formatting, inline references, and annotations. It uses existing editor revisions; PostgreSQL can merge concurrent blocks, so read the saved document before claiming exact final content. Deletion retains Mango's existing confirmation and recycle behavior.

There is no file picker or file-byte function in this chat. Upload preparation returns the existing upload descriptor; a client must perform Mango's normal byte upload and any multipart signing steps before calling completion. Completion verifies the stored object. Preparation alone never creates a completed attachment.

Each Send is limited to 90 seconds, eight function steps, nine model responses with at most 4,096 output tokens each, and 32,000 streamed text bytes. User messages are limited to 8,000 characters; history to 24 messages and 48,000 characters. Clear chat when history is full. Tool results are bounded to 64 KiB. No automatic retries or polling occur.

Duplicate-send protection is process-local and retains request IDs for fifteen minutes (at most 2,048 receipts). It is not a durable exactly-once guarantee across backend replicas or restarts. Do not retry a write after an interrupted/uncertain result without first checking Mango. Stop prevents subsequent work; ordinary synchronous repository operations already entered may still commit.

Protocol references: [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling) and [streaming Responses](https://developers.openai.com/api/docs/guides/streaming-responses). Behavior and local test coverage are specified in [Mango Assistant laws](tests/mango-assistant.md).
