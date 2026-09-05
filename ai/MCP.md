# Mango tools and MCP

Connected in-app MCP servers: **0**. MCP-protocol tools: **0**. Mango calls internal Go function tools through Pi; there is no MCP transport, gateway, or external connection. Codex's development plugins are separate from Mango's customer runtime.

The exact active schemas and options are captured in Inspect for each provider request. Current permissions and live server results are authoritative. This file does not establish a company's access or connection status.

Ordinary chat has the existing 26 tools plus the read-only `bind_process` operation:

- Identity and discovery: `get_me`, `list_processes`, `list_my_processes`, `get_process`, `get_process_nodes`, `get_node`, `get_textbox`, `list_explorer`.
- Process and Node commands: `create_process`, `update_process`, `delete_process`, `create_node`, `update_node`, `delete_node`, `move_node_to_process`.
- Canonical editor commands: `save_textbox`, `delete_textbox`.
- Folder commands: `create_folder`, `rename_folder`, `move_folder`, `delete_folder`.
- Attachment lifecycle: `list_attachments`, `create_attachment_upload`, `get_attachment_upload`, `complete_attachment_upload`, `link_attachment`. These preserve the existing upload lifecycle and do not supply file bytes.
- `bind_process` checks the exact visible Process and loads its live SOP, Steps, connections, and execution eligibility. It creates nothing and does not authorize execution.

Once a Process is bound, its ready execution catalog replaces ordinary chat tools:

- `create_process_node` creates this interaction's single Node and starting Step assignment atomically.
- `write_process_node` appends one fresh canonical textbox and returns the saved document.
- `move_process_node_to_step` moves the tracked Node to a supplied Step while preserving status.

A bound Process missing SOP or Steps has no mutation tools. All tools use authenticated Go handlers, existing permissions, fixed routes, canonical typed identities, concurrency checks, and ordinary realtime events. No model-selected actor, company, URL, or arbitrary operation is accepted.

The supporting native Pi tool `read` is present in both modes. It serves only immutable packaged `AGENTS.md`, `MCP.md`, `SKILLS.md`, and `skills/mango-process/SKILL.md`. It has no general filesystem or shell fallback. Native skill discovery and every full read are visible in Inspect.

No email sending, web browsing, arbitrary HTTP, shell/code execution, database queries, external MCP actions, background scheduling, Workflow execution, or permission-management tools are connected. Full schema/route details remain in `docs/tests/AI&MCP.md`; the runtime catalog is built from existing Go declarations.
