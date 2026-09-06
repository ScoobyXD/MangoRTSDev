# AI Prompt Source Business Logic Laws

1. Every admitted ordinary-chat or Process Send must capture the actual inputs and ordered events through the existing assistant inspection mechanism.
2. Every provider invocation must retain its complete sanitized request body before dispatch and separately record whether dispatch occurred.
3. Input source descriptions must identify the repository file and symbol, packaged file path and content hash, request field, or known database table, columns, and canonical keys that supplied the content.
4. A derived value must identify its derivation and must not invent an exact database row that was not captured.
5. Initial skill discovery must identify the advertised name, description, and file location separately from the full instructions loaded by a later native read.
6. A successful Process binding must replace the advertised tool sources before the next provider invocation while preserving the sources of earlier tool outputs retained in history.
7. Tool output sources must record the actual resolved handler route and returned canonical identities without maintaining another tool-route registry.
8. Source descriptions must remain inspection metadata and must never be added to the model's prompt, tool arguments, or tool outputs.
9. Conversation history must come only from the browser's current completed turns and the current Pi interaction; inspection archives must never supply model memory.
10. Inspect must allow every currently authorized user to inspect only their own conversations in the selected company, including ordinary conversations and Process runs.
11. Every admitted Send must attempt to archive its sanitized source descriptions, actual inputs, and ordered events once in the existing `public.ai_runs.inspection_json` array when foreground work ends.
12. Inspection must never expose credentials, authorization headers, secret URLs, opaque provider continuation data, or private model reasoning.
13. Captured repository paths must refer to the recorded deployed revision, and packaged runtime paths and hashes must identify the files actually loaded.
14. Archive destinations must not be presented as proof of a successful archive write, and inspection limits must stop further work instead of silently dropping events.

## Process story

The browser posts its current messages, selected Process ID, company ID, and reasoning choice to `/v1/assistant/chat`. Go authenticates the user, obtains current company access, reads any selected Process, and sends a private JSON start message to the Node runtime. Pi assembles the app instructions, skill descriptions, tool schemas, server context, and browser history. Before each model request, Mango retains the actual serialized request and its source descriptions, then records dispatch separately. A native skill read or Mango tool result adds new content to that interaction; binding also replaces its tool catalog. Inspect shows input/source, model-request, and event views. When foreground work ends, the existing final archive attempt saves that same ordered event array. No archive is read back into the model.

## Exact source map

Repository paths below are relative to the checkout root. On Jonat's canonical checkout that root is `C:/Users/Jonat/MangoRTSDev`; implementation worktrees have their own root. Inspect records the deployed revision so a source path can be matched to the code that produced the run. Backend Go source is compiled into `/miraeopus-api` in the deployed container; its repository paths are source-code locations, not claims that those `.go` files exist in the container. The packaged AI files are under `/app/ai`; each event records their actual runtime paths and hashes.

| Information | Exact source | How it reaches the model |
| --- | --- | --- |
| App instructions | `ai/AGENTS.md`; loaded by `ai/runtime/runtime.mjs: resources` | Full content becomes Pi's system prompt. |
| Skill descriptions | YAML `name` and `description` in `ai/skills/mango-process/SKILL.md` and `ai/skills/mango-node-chat/SKILL.md`; `SKILL_PATHS` in `ai/runtime/runtime.mjs` supplies locations | Pi appends metadata to the system prompt. Full skill instructions enter only after an approved `read`. |
| Ordinary tool definitions | `backend/internal/http/assistant_tools.go: assistantTools` | Go sends the active definitions to Node; Pi converts their descriptions and argument schemas into provider function tools. |
| Binding tool | `backend/internal/http/assistant_binding.go: assistantBindingTools` | Available in ordinary chat; successful binding replaces the active catalog. |
| Process execution tools | `backend/internal/http/assistant_process.go: assistantProcessTools` | Available only for a bound, executable Process. |
| Chat/mention tool definitions | `backend/internal/http/assistant_node_chat.go: assistantChatUsersTool, assistantNodeChatTool` | Added to the appropriate ordinary or Process tool catalog. |
| Native read tool | `ai/runtime/runtime.mjs: readDefinition, ASSETS` | Registered directly with Pi; only the explicit file allowlist can be read. |
| User identity | `public.users(user_id, display_name, email)` through `backend/internal/store/postgres_auth.go` and `backend/internal/http/assistant_context.go: assistantUserContext` | Go adds the authenticated actor's fields under `context.identity`; an existing auth cache may serve those fields. Local in-memory mode uses the repository contract without a PostgreSQL read. |
| Effective company role | `public.company_memberships(user_id, company_id, role)` through `backend/internal/http/auth_middleware.go: currentActorRoleForCompanyContext` | Current effective role enters `context.identity.company_role`. Global developer access can derive from membership in another company; the capture states that derivation rather than inventing one source membership row. |
| Selected company | Query parameter `company_id` sent by `frontend/src/modules/assistant/assistantApi.ts: streamAssistantChat` | Existing authorization validates the scope before Go adds it to identity and uses it for reads/tools. |
| Current message and previous turns | `frontend/src/app/AppAssistant.tsx: AssistantSession` state, `history`, and `send`; serialized by `streamAssistantChat` | `messages` contains completed nonempty prior user/assistant pairs and the latest user message. It is not loaded from a chat, memory, or run table. |
| Process identity/name | `public.logic_gates(company_id, logic_gate_id, header)` through `backend/internal/store/postgres_logic_gate_work.go: GetLogicGateWork` | Selected Process context, or a `bind_process` result. |
| Process default access | `public.resource_permission_settings.default_access`, resolved by `mangorts_v2_resolve_permission_policy` inside `GetLogicGateWork` | A derived Process field; the capture identifies the resolver and does not claim an uncaptured policy-owner row. |
| Step metadata | `public.process_steps(company_id, process_step_id, logic_gate_id, name, position)` through `GetLogicGateWork` | Canonical Step IDs, names, and order in Process context. The current AI projection does not include Step body/revision or map geometry. |
| Directed Step connections | `public.resource_operational_relationships`, identified by `company_id` and `resource_operational_relationship_id`, through `GetLogicGateWork` | Canonical source/target types and IDs in Process context. |
| Process SOP documents | `public.logic_gate_textboxes`, keyed by `company_id`, `logic_gate_id`, `textbox_id`; `body_json` and `revision` through `backend/internal/store/postgres_editor_textboxes.go: getPostgresEditorTextboxSnapshot` | `backend/internal/http/assistant_process.go: readAssistantProcess` supplies current canonical documents and revisions. |
| Tool outputs and further reads | Actual method/route selected by `backend/internal/http/assistant_tools.go: dispatchAssistantOperation`; exact arguments/results and IDs captured in the event | The tool result enters Pi history. Canonical editor results additionally identify `public.node_textboxes` or `public.logic_gate_textboxes` and the actual document key/revision. Other routes identify the true handler boundary without claiming exhaustive database-row lineage. |
| Model selection | `MANGORTS_ASSISTANT_MODEL` read by `backend/cmd/miraeopus-api/assistant_config.go: buildAssistantConfigFromEnvironment` | Server configuration supplies `model`; runtime and each provider request capture the effective value. Credentials are excluded. |
| Reasoning choice | Browser `localStorage` key `mangorts.assistant.reasoningEffort.v1`, otherwise `ASSISTANT_DEFAULT_REASONING_EFFORT` in `assistantApi.ts`; `AppAssistant.tsx: loadReasoningEffort, saveReasoningEffort` | The browser sends `reasoning_effort`; runtime records both requested and effective settings. |
| Limits and provider options | `backend/internal/http/assistant.go` constants and `ai/runtime/runtime.mjs: LIMITS, settingsManager, streamFunction, onPayload` | Code controls execution and provider configuration; each request records the actual provider fields. |
| Pi prompt/provider assembly | Loaded `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` implementation files identified in runtime sources | Pi formats skills, messages, and tools. Actual resolved package paths and hashes identify the installed implementation. |
| Within-interaction memory | `ai/runtime/runtime.mjs: SessionManager.inMemory, session.agent.state.messages, session.prompt` | Initial context/history, model responses, skill reads, and tool results remain in this interaction's memory for subsequent invocations. |

`ai/mcps/` and `ai/mcps/mcp-master-list.md` are not automatically injected or readable. The runtime does not load arbitrary folder contents, a memory file, a previous Pi session, or connected MCP servers. Source annotations describe provenance; the captured `provider_request.data.body` remains the authority for what was actually submitted after security omissions.

## Run storage and inspection

The exact database destination is `public.ai_runs.inspection_json`, selected by the three columns `company_id`, `user_id`, and `ai_runs_id`. These are the authenticated company, authenticated user, and current Send request UUID shown by Inspect. `start_time` and `finish_time` describe admission and foreground completion.

`backend/internal/http/assistant_context.go: finishAssistantCapture` serializes the original event array after the terminal outcome. `backend/internal/store/postgres_ai_runs.go: SaveAIRunContext` performs the existing single insert. The source annotations live in individual events' `data.sources`; full provider inputs live in `provider_request` events' `data.body`. No schema change is needed. A failed final insert or process crash can prevent archival; this view does not browse historical database runs or claim that the insert succeeded.

The browser shows its own captured turns through `frontend/src/modules/assistant/AssistantInspection.tsx`. Its existing recovery route is `GET /v1/assistant/trace?company_id=...&request_id=...`, backed by bounded process memory rather than an archive query. Clear/reload/scope changes clear browser history; source capture does not change retention or access rules. See [AI & MCP laws](AI%26MCP.md) for the existing execution, privacy, recovery, and archive boundaries.
