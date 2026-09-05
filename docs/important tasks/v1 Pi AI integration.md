# V1 Pi AI Integration

Updated: September 5, 2026

Status: Requirements and investigation record. Jonat authorized this document to be merged into local main, followed by one new Codex worktree task implementing only the first MVP defined here. The document does not claim that Pi is already integrated.

## 1. Purpose, authority, and scope

Mango will use Pi as its AI execution foundation. The first implementation must be the smallest useful skeleton: a user sends a message, Mango supplies the correct live context, Pi discovers and understands an existing Process, and the model chooses how to use existing Mango tools to create one Node, write work into its editor, and move it through that Process's Steps. Full visibility into model input and harness activity is part of this first delivery.

This document records the investigation and the later discussion that narrowed the work. Section 4 is the implementation scope. Sections 8 and 9 describe future product requirements and do not authorize implementing them in the MVP. Do not turn the earlier large specification into one giant implementation task.

The existing [V2 AI Integration](v2%20AI%20integration.md) document retains the earlier full product specification and previous implementation history. This document takes precedence for the new Pi implementation scope. The [Process Map and AI record](v1processmap%26aiintegration.md) remains separate. Current shipped behavior belongs in [AI and MCP laws](../tests/AI%26MCP.md) and the other relevant `docs/tests/*.md` files; this task document is not a replacement for those laws.

The user explicitly authorized documentation, local integration of that documentation, then a separate implementation worktree. The implementation worker must commit its own work locally and stop there. Its implementation must not be merged into main, pushed, deployed, or opened as a PR without another explicit request. The launcher must stop after confirming creation of the worker.

## 2. Decisions from the discussion

1. Use Pi; do not add a second agent framework around it.
2. Correct context comes before autonomous execution. The first proof is that the model can accurately explain a real saved Process from the context Mango supplied.
3. Extend the AI capability already present in Mango. Do not rebuild Process, Step, SOP, Node, editor, permission, assignment, or Board models.
4. Let the model choose its tools and work from the actual user request, SOP, Steps, and connections. Do not encode a demonstration Process, sample Step names, canned output, or a predetermined sequence of business actions in application code.
5. Tools still have real implementations, declared arguments, validation, and backend permission checks. Those are necessary software behavior; they do not prescribe a Process's procedure to the model.
6. Context consists of the request, relevant conversation, authenticated identity/company, selected or discovered resources, and current authorized data.
7. A skill gives reusable guidance about how to work with Mango. The Process SOP describes the particular business procedure. Do not copy each Process's SOP into another skill or create a second instruction authority.
8. A tool performs a concrete read or change. The harness coordinates model calls, tool calls/results, context, and skill loading. MCP is an optional protocol for connecting tools; tool calling does not require an MCP server.
9. The model needs descriptions of the available tools and skills before it can choose them. Full skill content may load when relevant; every such load must be visible in inspection.
10. A root `ai/` folder will contain the application's AI instructions, English tool/MCP reference, skill index, and actual skills. It may contain the small Pi runtime implementation where that is the clearest location.
11. Exact model requests and observable harness activity are mandatory MVP features, including failed and stopped interactions. A vague context summary is insufficient.
12. One working provider/model connection is enough initially. Pi supplies the provider abstraction; Mango does not need to implement a provider adapter collection, model-selection product, or fallback system now.
13. Work not on the critical path to that skeleton is deferred. Full Jobs, schedules, durable Runs, approvals, verification, staging, and external integrations are future work.

## 3. Verified starting point

The initial source investigation used Mango commit `8cc096bbb0fb1b15223317a3c4bba059e4f03c51`. Local main was later inspected at `b5f9290b6a1ecf2f9f8b7ef97d2c8950d1d4bf51`; the intervening changes were in Process Map presentation and related tests/docs. The implementation worker must inspect its actual starting commit and current source rather than assume this inventory can never change. No live database or provider credentials were inspected for the investigation.

| Area | Current capability and relevant source | Implication |
| --- | --- | --- |
| AI chat | `backend/internal/http/assistant.go` uses one configured OpenAI Responses model and foreground SSE. | Replace the provider-specific execution loop with Pi on the supported chat path; do not retain two permanent implementations of the same loop. Preserve existing chat behavior. |
| Internal tools | `assistant_tools.go` defines 26 ordinary tools; `assistant_process.go` defines three protected selected-Process actions. | Reuse their underlying handlers/commands, schemas, authorization, and saved results. Do not expose the broad ordinary mutation catalog to a Process execution merely to simplify dispatch. |
| Context | `readAssistantProcess` reads the exact Process, Steps, directed connections, and canonical SOP JSON with textbox revisions. User/company identity is supplied automatically. | Extend this loader and share it with Pi. Browser previews, map coordinates, and unsaved editor text are not authoritative context. |
| Discovery | Ordinary chat can search visible Processes, inspect work/Steps, and read SOP textboxes. Protected Process tools currently require the frontend to bind a Process before Send. | Connect discovery and server-confirmed binding inside one interaction; no keyword router or duplicate resource system is needed. |
| Process identity | Process is `logic_gates`; Steps are `process_steps`; edges are typed `resource_operational_relationships`. | Preserve exact canonical identities. There is no separate Process model to create. |
| Node placement | One active Process assignment and an optional same-Process Step. `nodes.status` is separate from Step location. | Use canonical work commands and keep Run-like display state separate from Node status. |
| Guarded changes | `backend/internal/store/node_work_precondition.go` checks Process, Step, status, and assignment version while locking the mutation's rows. | Preserve these transaction checks so a concurrent human move prevents stale AI writes or movement. |
| Editor | Canonical Tiptap JSON/textboxes and revisions already exist. Selected-Process AI appends fresh textboxes and reads them back. Ordinary stale document writes can merge blocks. | Reuse these paths. The first version appends work to its own Node rather than replacing unrelated rich content. |
| Board/realtime | Existing Process work reads, transactional events/outbox, Valkey, and WebSockets refresh the real Board. | Saved Node movements already have a delivery path; no separate AI Board/socket is needed. |
| Inspection | `assistant_context.go`, `frontend/src/modules/assistant/assistantApi.ts`, and `frontend/src/app/AppAssistant.tsx` provide a developer-only, opt-in, in-memory context modal. | Extend it. It currently shows selected initial fields and continuation additions, not the complete final provider request or every harness event. |
| Limits | Current chat has an eight-function/nine-model-response bound, a 90-second deadline, output/stream limits, cancellation, and process-local request receipts. | Keep execution bounded. Search + bind + create + three writes + two moves already consumes eight calls; any small adjustment must be explicit and tested. No durable-run guarantee exists. |
| Integrations | Nylas email infrastructure exists. The in-app assistant has zero connected MCP servers and zero MCP-protocol tools. | Document the distinction. No external MCP/Airtable/Linear integration is necessary for the first demo. |
| Scheduling | Specialized email SQS workers and one fixed EventBridge reconciliation schedule exist. | These are useful future patterns, not a generic AI Job scheduler already implemented. |
| Workflow | No coherent executable Workflow model/runtime was found. | Workflow execution remains out of the MVP and must not be faked with a Process Node or Folder. |

Existing laws to read include `docs/tests/AI&MCP.md`, `relationships.md`, `process-steps.md`, `nodes.md`, `editor.md`, `permissions.md`, and `REST API & WebSocket.md`. Read relevant email/attachment laws before touching those operations. Business logic changes must update the appropriate current numbered laws directly in the same implementation commit; preserve a short process story instead of appending historical clutter.

## 4. First MVP: Pi, live context, internal Process work, complete inspection

### 4.1 Visible user flow

1. The user opens the existing Mango chat and sends a message.
2. Every Send includes current authenticated user/company identity and relevant conversation. Only authorized, relevant business data is included.
3. An explicit Process reference from the existing picker binds the exact Process. A natural-language reference can be resolved by the model through existing permission-filtered search/read tools.
4. A discovered target is bound by a server-owned operation that loads its exact Process/SOP/Step context and confirms the selection to the frontend. Binding is a read/context action and does not create a Node.
5. If multiple targets plausibly match, the model asks a concise clarification. It must not guess an identity from a name or invent an ID.
6. A discussion request can explain the Process, SOP, Steps, and available actions without mutating anything. Selecting or mentioning a Process is not execution authorization.
7. For an explicit request to perform supported work, the model chooses the existing create-Node, append-text, and move-Step actions from the actual procedure.
8. One interaction creates at most one new Node for its bound Process. The server tracks the real saved Node and placement; the model does not pick another Node or actor.
9. Each text action saves a fresh canonical Node textbox and returns the actual saved content. Step movement uses the existing command and preserves Node status.
10. The existing Process Board displays committed movement, and the chat exposes the Node link even if later work fails or stops.
11. The user can open Inspect on the interaction and see every model request and the actual sequence of context, skill, and tool events.
12. Completion, Stop, a failed action, lost access, changed Process definition/Node placement, ambiguity, or a resource bound ends the foreground work and preserves already saved changes.

The demo Process may have three arbitrary or playful Steps such as greeting, entering a house, and preparing food. It proves reading, tool choice, saved text, and movement. Physical work is explicitly described as a simulation or written walkthrough; the assistant cannot claim that it physically entered a house or cooked food. A real Process requiring an unavailable external action must stop and say what is missing instead of fabricating success.

### 4.2 Meaning of agentic and not hardcoded

The application supplies tool descriptions, reusable skill guidance, real context, and limits. The model decides which supported tool to call, its valid business arguments, what work to write, and the appropriate authored next Step. It observes results before deciding what to do next.

Do not build `if the prompt contains Process` routing, sample-name matching, fixed three-Step automation, a scripted Node movement loop, canned replies, or special handling of the demo Process. A different Process with different names/content must work through the same mechanism. Connections and SOP express procedure; map geometry is presentation only.

Implementations, typed IDs, tool schemas, membership checks, transaction boundaries, and maximum work limits remain explicit code. A prompt/skill cannot authorize a forbidden operation or enlarge the tool catalog. The server binds company, user, Process, and tracked Node; model arguments never choose an actor, company, arbitrary URL, executable code, or undeclared operation.

### 4.3 Minimum context contract

| Included information | Source and handling |
| --- | --- |
| Identity | Current signed-in user, selected company, and relevant current role. Do not insert unrelated directory data. |
| Request/history | The submitted message and valid relevant conversation. Do not silently resubmit failed/interrupted turns or claim unsent content was sent. |
| Target | Server-confirmed canonical Process identity/name. Search results and discovered resources are permission-filtered. |
| SOP | Saved canonical editor JSON and exact textbox revisions; preserve enough structure to understand the text and references. |
| Steps | Exact Step identities/names, saved ordering, same-Process connections, and authored instructions from the SOP. No new per-Step instruction model. |
| Runtime instructions | The explicitly loaded application `ai/AGENTS.md` and any actual prompt text added by Mango/Pi. |
| Skills | Available skill names/descriptions and full relevant skill content when loaded. Clearly distinguish available, loaded, and actually sent content. |
| Tools | The exact enabled tool definitions, descriptions, argument schemas, and constraints. Availability is not permission to perform every action. |
| Work results | Server-confirmed Node/Step state and relevant completed tool results supplied to later calls. |

Reuse and centralize the existing context path. Do not assemble competing prompts in controllers, React components, and provider-specific adapters. Relevant RACI can be read when required, but full team/assignment expansion, company-wide retrieval, embeddings, and a knowledge graph are not MVP requirements.

For this short foreground MVP, preserve the current stop-on-definition-change contract and refresh context on the next Send. Stable long-running definition snapshots are a future Run feature. Independently capture immutable inspection data for each actual invocation so changing source files cannot rewrite what an earlier call displayed.

### 4.4 Only the necessary business actions

The Process execution catalog contains the existing three capabilities: create this interaction's Node in the bound Process/starting Step; append a new textbox to that Node; move it to an existing Step of that Process. Context discovery/binding and skill reading are supporting reads, not general mutation access.

Reuse the current implementation rather than writing new SQL/domain commands for equivalent behavior. Existing ordinary chat capabilities must not regress during provider integration, but this task does not expand ordinary chat into unrestricted automation. Prefer one Pi execution integration with the existing mode-appropriate tool catalog over two permanent provider loops or a compatibility layer.

MCP is not required for these internal actions. Do not create an MCP server, generic MCP gateway, dynamic server marketplace, or OAuth setup UI merely because the user colloquially calls the actions MCP tools. Expose the existing commands to Pi directly for the smallest skeleton and record their actual implementation in the English inventory.

### 4.5 Full inspection is mandatory

Reuse the existing compact modal/focus conventions. Provide an obvious Inspect entry for the current authorized developer/testing user, available throughout an interaction and after success, failure, or Stop. Retain the current backend inspection authorization initially; do not expose private context company-wide. New role-management or inspection-permission configuration is not required.

The MVP must capture complete inspectable data for its short chat interaction, not add Jobs or a durable Run-history product. Existing in-memory interaction retention is sufficient initially, but the UI must say that clearing/reloading loses that history. Do not write runtime traces, company context, credentials, or user data into the Git-tracked `ai/` folder. A protected copy/download of the current captured trace is useful if small; durable archives/retention systems are future scope.

The inspector has three kinds of information:

| Information | Required visibility |
| --- | --- |
| Loaded context/instructions | Exact common instructions, skill descriptions/full loaded skills, source/version or content hash, Process/SOP/Step data and relevant conversation. Record actual included text, not a summary pretending to be the prompt. |
| Every model invocation | Complete final redacted provider request body after context and provider transformations; provider/model/options, tool definitions, invocation purpose, sequence/time, response/result status, output and usage where available. Include any helper model calls or internal retries actually enabled. |
| Observable harness activity | Context loads/binding, skill discovery/loading, tool request/arguments, validation/authorization outcome, dispatch, saved result/error, cancellation, limits, and any enabled retry or compaction activity. Record failed/rejected actions even when there is no subsequent model call. |

Inspect the actual final request boundary. Current inspection misses fields including output limits, storage and parallel-call options and some SDK serialization, while later input is displayed only as additions. The new view must allow inspection of the complete request for any invocation, even if storage deduplicates common material. Include Pi-added instructions and transformations rather than only files written by Mango.

An event saying a request was prepared is not proof that it was dispatched. A tool request is not proof of a committed change. Preserve preparation, dispatch, completion, failure, and uncertain outcome as distinct observable facts. Do not invent an explanation of the model's internal decisions; show the actual selection, request, and result.

Capture records before the corresponding model call or tool dispatch, and do not silently truncate required inspection information. Use bounded data and explicit failure/omission markers. A viewer may collapse or paginate large content while retaining the complete captured content. If required capture fails or reaches its limit, stop before further unrecorded work and show what was retained. Keep stopped/failed interaction inspection accessible rather than replacing it with a generic error.

Credentials, authorization headers, provider keys, OAuth tokens, secret URLs, and unrelated sensitive error internals must never enter model context or the inspector. Sanitize before model egress and before recording. Provider-hidden instructions and hidden/private reasoning Mango never receives are unavailable; do not promise to expose them. Opaque/private continuation fields must be identified as omitted without presenting a redacted view as unredacted wire bytes. The product promise is exact Mango/Pi-supplied content subject to explicit security redaction, not access to the provider's internals.

For the minimum implementation, leave automatic compaction, auxiliary agents, and autonomous retries off unless needed for the supported existing behavior. If any feature makes another model call, it falls under the same inspection and resource limits. An enabled feature cannot bypass visibility merely because it is inside the harness.

### 4.6 Bounds and failures

Use the existing request timeout, cancellation propagation, output/context bounds, duplicate-call protection, and sequential execution principles. A small bounded call-budget change may be necessary to accommodate discovery and skill loads before three-Step execution; update backend, frontend validation, tests, and current AI laws consistently. Do not add company budget dashboards or a configurable resource-policy engine.

Stop must prevent new tool dispatches and signal Pi/provider cancellation. An already entered action may commit and must not be described as undone. Failed or uncertain writes are not automatically retried. A model error, aborted stream, or Pi `agent_end` does not by itself mean the business work succeeded.

## 5. The root AI folder

Use a root `ai/` directory. There is no special required root directory name for this integration; `AGENTS.md` and per-skill `SKILL.md` conventions are useful, and Pi supports controlled resource loading.

```text
ai/
  AGENTS.md
  MCP.md
  SKILLS.md
  skills/
    mango-process/
      SKILL.md
  runtime/                  # only if this is the chosen location for the Pi bridge
    ...
```

`AGENTS.md` contains provider-neutral application instructions for Mango's runtime models: correct vocabulary, how supplied context is used, honest claims about results, when to load guidance, and how to handle missing information. It is loaded for every supported model interaction. Move the authored instructions used by the new integration here or into actual skill/prompt files; do not leave competing copies of the same instructions embedded in multiple code paths. Add a `prompts/` directory only when a distinct real prompt is needed.

`MCP.md` is a plain-English reference of actual integrations and tools: purpose, available actions, internal/external effects, and implementation/availability. Initially it must state that no in-app MCP server is connected and describe the existing Mango function tools separately. A static document is not the authority for a particular company's current credentials, scopes, access, or connected status. Derive reference lists from registered tool definitions where practical; do not build a new registry service.

`SKILLS.md` lists actual runtime skills, their purpose, and when they are useful. Each skill's `SKILL.md` owns its full instructions. Start with only the skill needed to operate the existing Process/Node tools; do not manufacture an unused library of future skills. The list and descriptions must match the loaded skills. Skill content guides tool use and cannot grant permissions or supply a second Process definition.

The runtime must explicitly load the approved application instruction/skill files. Do not automatically ingest this repository's root `AGENTS.md`, parent-directory developer instructions, Codex user skills, home-directory credentials, arbitrary extensions, or unrelated project files. The repository root instructions govern coding agents and contain Git/cloud/development rules; they are not Mango customer-agent context.

Pi's normal skill discovery describes available skills and reads full files on demand. Reuse that support through its SDK/resource loader rather than inventing another skill framework. If loading requires a file-reading tool, expose only the approved packaged AI content needed for skills, or use a supported explicit load mechanism; do not enable general filesystem/shell access for customer agents. Log the full loaded content and its provenance through the inspector.

Generic authored instructions live in `ai/`; actual Process/Node data stays in existing Mango storage; executable business tools and authorization remain in the backend. This folder is not a second database, resource registry, credentials directory, or trace archive. Package its required files with the worker so loading does not depend on an incidental development working directory.

## 6. Pi integration boundary and verified capabilities

The authoritative repository is now [earendil-works/pi](https://github.com/earendil-works/pi); `badlogic/pi-mono` redirects there. The investigation checked GitHub release [v0.85.0](https://github.com/earendil-works/pi/releases/tag/v0.85.0), commit `107d79f11072bbc8a3a757ed7fd69596bee7d68c`, and current source. npm distribution tags were not verified during investigation. The worker may download/install the official Pi packages needed for implementation, must verify the available published version/API, and must pin the selected dependencies and lockfile. Do not depend on an unreviewed moving branch or vendor a fork of Pi.

| Pi layer | Finding and chosen use |
| --- | --- |
| `pi-ai` | Provider-neutral model/tool messages, streaming, usage, and provider adapters. Reuse it through Pi; one configured model is sufficient. |
| `pi-agent-core` | `Agent` provides the model/tool loop, context transformations, events, hooks, and cooperative cancellation. It is not by itself automatic skill/MCP discovery or a Mango durable-run engine. |
| Coding-agent SDK | Its session and resource-loader APIs provide native skills, context files, custom tools, and optional session features. Because skills are now an explicit MVP requirement, reuse the smallest supported Pi SDK/loading combination instead of building a competing skill loader. |
| Coding-agent defaults | Default coding tools, project/home resource discovery, credential files, retries/compaction, and coding-oriented prompts need explicit control. Expose only intended Mango/supporting read tools and approved instructions. |
| RPC | Pi's coding agent supports stdin/stdout JSON commands, but using the full CLI with uncontrolled defaults is not required. Prefer a small embedded SDK adapter. |
| Session persistence | Pi offers conversation/session storage and restoration. This does not supply atomic Mango state, durable approvals, or external-effect recovery. No second Pi session database is needed for the foreground MVP. |
| MCP | Not built in as connected application servers. Add adapters only when an actual later integration requires them. |
| New harness APIs | Do not adopt a broad new session/lane framework for this skeleton. An inspected release `watchSession()` path was explicitly unimplemented. Use the supported, necessary APIs. |

Proposed minimum boundary: Go supervises a bounded Node.js process running the Pi SDK. A narrow versioned JSON message protocol over stdin/stdout carries context, events, tool requests/results, and cancellation. Go executes the existing Mango commands using the real authenticated request and server-owned scope. Do not introduce a public generic tool endpoint. Keep transport concerns separate from business operations; choose another boundary only if repository evidence shows it is simpler and equally controlled.

Keep integration credentials in the backend. Provider authentication reaches the provider adapter through server-only configuration/memory, never model messages, inventory files, logs, or command-line arguments. Reuse the existing approved secret-loading path rather than requesting, printing, copying, or saving keys. Missing credentials can block a live smoke test; the worker must still complete local mocked-provider and real internal-command verification where possible and report the precise remaining limitation.

The inspected Pi package requires Node 22.19 or later. Mango's current backend container packages only the Go executable. The MVP must include the smallest supported runtime packaging and local startup wiring needed for Pi, not merely a script that works in the worker's checkout. Repository packaging changes are allowed; deployment or production cloud changes are not.

Pi tool execution defaults to parallel in the inspected core. Configure sequential execution for this MVP and check cancellation/current execution state before every dispatch. `terminate: true` is not an immediate barrier: remaining tools in a batch may still run, and follow-up termination depends on the finalized batch. Never use a Pi hook alone as the security boundary.

When using the native SDK loader, explicitly disable automatic project/home context, extensions, prompt templates, themes, and package discovery; supply only the approved skill paths and application instructions. Override system/append prompts as well as AGENTS files, use in-memory session/settings configuration, and disable automatic retry and compaction. Verify the installed API rather than copying options from a different release.

The inspected native skill catalog requires an active tool named `read` or `bash`. Keep a restricted `read` tool and no shell tool. Pi's native read tool supports custom read operations; use those to serve only approved, immutable skill/reference assets, with no default filesystem fallback. Disable customer prompt-template/slash-skill expansion so it cannot take a separate direct-file-reading path. Record the exact skill bytes returned and included in later requests.

Pi exposes payload and response hooks, tool events, context transformations, and session events. Capture the effective request after all enabled transformations and extension changes, immediately before provider dispatch. A listener that sees an earlier context object is not proof it saw the final body. Confirm the ordering for the chosen version/providers, including final callback return values and any transport-added body fields. Do not rely on a custom-fetch assumption that is unsupported by a provider adapter. Capture additional internal provider attempts if retries are enabled.

The inspected extension dispatcher catches `before_provider_request` handler errors and can continue sending, so an extension listener alone cannot enforce required capture. A supported approach is wrapping `session.agent.onPayload` after setup: await the original transformation, capture the final request through Go, await acknowledgment that the current interaction retained it, then return the payload. Recording failure must throw outside the extension dispatcher. This acknowledgment does not require a database or durable trace system. Likewise, `session.subscribe` does not await asynchronous listeners; use the awaited core agent event boundary for required capture barriers and the outer session stream only for supplementary presentation events. Confirm both failure behaviors against the pinned package.

### Source references

- [Pi agent API](https://github.com/earendil-works/pi/blob/v0.85.0/packages/agent/src/agent.ts) and [tool loop](https://github.com/earendil-works/pi/blob/v0.85.0/packages/agent/src/agent-loop.ts).
- [Pi model/provider API](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md).
- [Pi SDK and controlled resource loading](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/docs/sdk.md).
- [Pi skill loading](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/docs/skills.md) and [Agent Skills specification](https://agentskills.io/specification).
- [Native skill prompt construction](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/src/core/system-prompt.ts), [restricted read operations](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/src/core/tools/read.ts), and [resource loader](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/src/core/resource-loader.ts).
- [SDK callback wiring](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/src/core/sdk.ts), [extension error handling](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/src/core/extensions/runner.ts), and [session event delivery](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/src/core/agent-session.ts).
- [Pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), [RPC](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/docs/rpc.md), and [documented philosophy/boundaries](https://github.com/earendil-works/pi/blob/v0.85.0/packages/coding-agent/README.md#philosophy).
- [Package/runtime requirements](https://github.com/earendil-works/pi/blob/v0.85.0/packages/agent/package.json).

These are source findings, not proof of a successful Mango deployment. Recheck the chosen published package before implementation.

## 7. MVP acceptance and completion

1. The existing chat uses the actual installed Pi runtime for model/tool execution, with one working configured provider and no parallel replacement agent framework.
2. A discussion-only message receives current identity and selected Process context without creating or moving a Node.
3. A picker-selected Process works through its exact existing identity.
4. A natural-language Process request can search, resolve, bind, and then execute in the same interaction. Ambiguous results require clarification; binding alone does not execute.
5. Saved SOP JSON/revisions and actual Step identities/connections reach the model. A later Send sees updated saved content.
6. The model chooses supported tool calls from the procedure, with no hardcoded example names, fixed business-action loop, or canned output.
7. Two different simple Processes use the same mechanism. Renaming/changing the example Process requires no application-code change.
8. Execution creates exactly one Node for the bound Process, writes real canonical editor text, and moves the real Node between valid Steps through existing commands.
9. The Node link survives a later failure, and committed work appears through existing Board/realtime behavior.
10. A current permission failure, cross-company target, wrong-Process Step, or stale Node placement is rejected before its mutation.
11. Skills and common instructions load from the packaged `ai/` content. Repository developer/home instructions and arbitrary filesystem tools remain unavailable to the customer runtime.
12. The English tool/MCP and skill lists match reality. No external connection or capability is advertised as working merely because it appears in documentation.
13. Inspect exposes every effective model request, including all model options, actual tool definitions, loaded skills, and later results, subject only to explicit security omissions.
14. Inspect records harness/tool activity independently of the next model call, including invalid, denied, failed, stopped, and uncertain actions.
15. Inspection faithfully distinguishes prepared, dispatched, completed, and uncertain work. It does not rebuild past inputs from edited source files or silently truncate missing material.
16. Inspection access is reauthorized, credentials never appear, and clearing/reloading the MVP's in-memory chat history has an explicit retention limitation.
17. Stop and limits prevent later calls; no automatic retry repeats an uncertain mutation or claims committed work was undone.
18. Non-actionable playful Steps are visibly simulated; unsupported external work stops without fabricated success. No formal verified-success claim is introduced.
19. Targeted backend/frontend/adapter checks verify the real boundaries. Captured mock-provider requests are compared with inspection payloads, including continuation and failure cases; tests must exercise real Pi integration rather than a fake successful UI.
20. Current ordinary chat behavior and resource models remain intact. Update the short numbered business laws for the intentional changes.
21. The worker commits all intended implementation changes locally, reports worktree/branch/commit, actual checks and limitations, and stops without merging, pushing, opening a PR, or deploying.

Use proportionate verification in the implementation worktree. Backend Go tests on Windows use installed WSL2 Ubuntu through the approved outside-sandbox execution path on the first attempt; do not run Windows Go test executables. Prefer targeted meaningful checks and local fixtures/fake provider transports. Do not retrieve secrets, write live databases, or modify live cloud resources to make a demonstration pass. A real model smoke test may use the existing approved running/backend configuration without exposing credentials, and must use clearly identified test content/resources rather than modifying customer data without authorization.

The documentation merge itself runs no tests or builds under the repository's local-merge policy. That does not prohibit the separate implementation worker's proportionate tests.

### Explicitly outside the first MVP

- Job/Scheduled Job creation, recurrence, one-time future work, scheduler changes, and Job management UI.
- Persistent Runs, attempts/checkpoints, durable context archives, cross-restart recovery, and history dashboards.
- Company autonomy presets, approval gates/records, review queues, policy configuration, and new notifications.
- New Expected Outputs or Success Criteria fields, deterministic verification engines, and verified-success metrics.
- Staged company-state changes, commit/discard, inverse actions, compensation, and rollback systems.
- External email sending, Airtable/Linear actions, MCP servers/gateways, OAuth connection setup, generalized capability inference, and connection readiness services.
- Multiple-provider selection UI, automatic provider fallback, cost dashboards, and configurable budget products.
- Workflow orchestration, child Runs, multiple-order batch execution, and cross-Process autonomous work.
- Automatic company-wide knowledge retrieval, embeddings, semantic graph systems, subagent orchestration, and autonomous replanning.
- A redesigned chat/editor/Board, a second sidebar/navigation system, and Process Map/Workflow-copy changes.

Existing authorization, schema validation, bounded work, cancellation, atomic command behavior, and concurrency safeguards remain required. Minimal does not mean bypassing the mechanisms Mango already uses to save valid work.

## 8. Future product design, recorded but not authorized for the MVP

### 8.1 Vocabulary and targeting

A Job is a user-authored execution definition for an existing Process or, when supported, Workflow. It stores name, extra instructions, creator, company, explicit credential owner, model policy, limits, status, and capability requirements. Creating a Job does not execute it unless the user chooses that.

A Scheduled Job is the same definition with a future or recurring schedule and explicit timezone. The scheduler owns recurrence; the LLM does not remember when to wake. Manual, one-time future, and recurring triggers must converge on one creation/execution service.

A Run is one actual execution with stable identity/history. A Process-level Run normally has one Node. Resume continues that Run with another attempt/checkpoint; restart creates a new Run with current definitions and an inspectable link to its predecessor. A Workflow parent/child model must follow Mango's actual future Workflow runtime, not be invented incidentally here.

Job-specific instructions supplement the Process, such as selecting the Costco account, limiting an input window, or leaving an email as a draft. They do not replace the SOP or weaken company policy. Creating a Job should require only the extra instructions, timing, and any stricter settings, not restating the procedure.

### 8.2 Context, snapshots, inference, and readiness

A future Run freezes the Job, procedure/SOP/Steps, Expected Outputs, Success Criteria, relevant RACI/policy configuration, capability analysis, and model choice it started with. Later authored edits affect the next Run. Live permission and hard policy restrictions still apply to each action; an old snapshot cannot restore revoked authority or a deleted runtime Step.

Compile relevant actor/company/team/RACI identity, exact target/version, SOP, Steps/edges, criteria, Job instructions, policy, allowed capabilities/tools, and current Step/artifact/result state. Persist the exact redacted initial context and invocation-level changes/payloads; preserve the actual version/content of supplied attachments. Keep secret material and unrelated company data out.

Infer capabilities from SOP, Step text, criteria, and Job instructions against the real supported catalog. Preserve explicitly named systems such as Airtable. Record source Step/instruction, capability, required/optional status, confidence, resolved connection/tool, scopes, and analysis version. Changes mark analysis stale. The inference result does not grant access.

Activation/execution readiness checks target availability and permissions, current credential-owner membership, connection health/scopes, capability support, model availability, policy/approval representability, and valid limits/schedule. Missing requirements yield clear Needs Setup/remediation states rather than repeated predictable execution failures. Do not silently replace a disconnected owner with another person's credentials.

### 8.3 Verification, Node progression, and success

Add explicit Expected Outputs to existing Steps and overall Success Criteria to the existing Process. Preserve stable criterion identities and snapshot them. Keep SOP as the written procedure and do not create diagram-only Steps.

Perform deterministic checks where supported: required field, stored attachment, confirmed external record/result ID, format/value match, or recorded approval. Otherwise retain the model's assessment and supporting tool evidence, with human review where policy requires it. Missing criteria produce warnings and policy-controlled allowance; never invent them or call unverified work deterministically verified.

Commit Step evidence/completion and Node advancement atomically where required. Failed checks keep the Node at that Step. Completing every Step is insufficient if overall criteria remain unsatisfied. Without an authored next action, the Run becomes blocked/failed/needs attention rather than guessing.

The Node is the visible work object. Its textboxes, artifacts, attachments, email/chat associations, timeline, and exact Process assignment remain canonical. Active/waiting/blocked AI indicators derive from persisted Run state through existing Board reads/realtime. Run state does not replace `nodes.status` or create new AI-only columns.

### 8.4 Company policy, approvals, and credentials

Company administrators control simple Permissive/Balanced/Strict-style defaults. Lower-level Job choices may be stricter but may not weaken unauthorized company restrictions. Backend action metadata owns internal/external, read/write, risk, scopes, draft support, inverse support, and approval requirements; the model cannot classify its way around policy.

Balanced permits ordinary analysis, Node drafting, and authorized low-risk work without approval at every Step. Explicit authored gates, consequential external actions, conflicts, missing authority/information, limits, and relevant Process-level commits require intervention. RACI can route a request but never grants permission.

An approval names one exact proposed action or internal commit, with Node/Step, target, acting identity, recipient/content or diff, expected result, risk/reversibility, reason, and decision. Bind the approved payload/revision; changed content requires new approval. Recheck approver/execution authority and target state before idempotent dispatch. Rejection prevents execution and repeated resubmission without new authorized information.

Use explicit delegated connection ownership. Current Nylas personal/shared connection storage is reusable, but full granted-scope/readiness and Job-owner behavior are new. Membership removal must stop future execution even if a provider connection row still exists. Authorized reassignment is explicit and audited. Service identities are future scope unless Mango already defines them.

### 8.5 Staging, conflicts, and external effects

The Node is a conceptual worktree for business work, not a filesystem Git checkout. Node artifacts/history can persist while proposed changes to authoritative company records remain staged. Every mutation carries company, Job, Run, Node, Step, actor, tool, timestamp, approval, and commit attribution.

Pending actions store exact typed targets, before-state/version, proposed after-state, and supported inverse information. Commit checks current permission and versions before atomically applying the authorized internal change set. Discard marks proposals discarded and keeps the Node/audit history. Do not use normal editor conflict merging as a silent resolution of an AI staged commit conflict.

External effects cannot share a PostgreSQL transaction. Record intent before dispatch, use stable provider-supported idempotency, store external identifiers/results, and reconcile uncertain outcomes before retry. A Run-scoped key alone does not prevent duplicates after Restart; business action identity may also be needed. Compensation/rollback is offered only where reliable and is logged separately from discard. Sending email cannot be promised reversible.

Current email sending calls Nylas before persisting Sent. A database failure may occur after real delivery. The adapter has an idempotency-key option but the investigated runtime send path did not assign a durable action key. Existing browser Undo is a short in-memory pre-send delay, not recall. These must be addressed before future AI sends, not implemented for the internal-only MVP.

### 8.6 Durable scheduling and execution

Reuse EventBridge/SQS/PostgreSQL patterns without overloading email-specific queues and rows. Persist schedule/timezone/next occurrence and generation. Use short transactions, occurrence uniqueness, a durable dispatch intent, and worker attempt tokens. Do not hold database locks across model or external calls.

Run plus required Node/assignment/snapshot/events must be atomic through the existing transaction-level command. A background worker cannot simply call an HTTP Node creator and later insert the Run. Step results, action status, and required events likewise cannot be recorded as successful after a mutation rolled back.

Default to one unfinished Run per Scheduled Job, including approval waits. Record skipped/queued/blocked overlapping occurrences according to an explicit simple policy. Recovery after downtime is bounded and does not automatically replay an unlimited backlog. Schedule edits/pauses invalidate inappropriate future dispatches.

Retry is bounded and only for safe transient failures. Resume reauthorizes and continues the existing Run/checkpoint. Restart creates a fresh Run with current definitions but preserves/reconciles prior external effects. Stop persists the stop request, blocks new actions, signals cancellation, and reconciles in-flight uncertain work.

Enforce wall time, model tokens/cost estimates/invocations, tools/actions, retries, consecutive failures, concurrency, and any later child-depth limits. Include inference/verification/compaction calls. Reserve sufficient budget before calls; unavailable usage/cost remains unknown, not zero or guaranteed billing accuracy.

### 8.7 Events, history, UI, and lifecycle

Reuse `domain_events`, transactional realtime outbox, current audience checks, and notifications. Persist structured Run/model/action/approval/evidence events independently of mutable Node textboxes. Extend the existing timeline's supported event presentation deliberately; it currently accepts only a few event types. Do not add a second event bus or hot-polling Board loop.

Jobs and Scheduled Jobs appear as rows. Selecting a row opens a compact modal, not a sidebar, with Overview, AI Context, and Run History. Overview contains target, owner, instructions, schedule/timezone, readiness, status, limits, and controls. AI Context shows the current next-execution preview; historical Runs show their actual immutable input.

History includes trigger/scheduled time, start/end/duration, status/current or failed Step, Node link, provider/model, usage/cost where known, approval/tool counts, error, success evidence, and commit/discard/rollback state. Run details show Step history, actions/approvals, exact context, result, and permitted restart/resume. Secondary metrics may include success/verified-success rate, duration/cost, failures, approval frequency, and common blocked reasons.

Nodes expose Job/Run/model/acting-user affiliation through existing detail patterns. Show meaningful timeline messages rather than token streams. Notify for approvals, blocked/failed Runs, conflicts, limits, connection repair, and configured completion; avoid normal Step-transition notification noise.

Authorize Job creation/edit/activation, target/Node/context inspection, connections, approvals, commit/discard, restart/resume, company policy, and technical details independently as appropriate. A snapshot may contain several protected resources, so one Job link cannot grant access to all captured information. Existing resource permission vocabulary and RACI separation remain authoritative.

Relationships retain literal same-company typed identities. Job/Run affiliation grants no new access. Target recycle/deletion must safely pause/invalidate execution and retire live references; preserve promised historical evidence under an explicit retention/access contract. Do not recreate deleted Steps from snapshots, leave executable stale references, or introduce a resource registry/identity translation layer.

## 9. Future acceptance examples and unresolved decisions

### Costco Scheduled Job

The authored Fulfill Costco Sales Order Process receives and validates an order, creates an Airtable record, creates a Linear follow-up if required, prepares confirmation email, and evaluates completion. Its Step outputs and overall criteria identify the required records, draft/send authorization, summary, attachments, and unresolved discrepancies.

Daily Costco Order Fulfillment adds instructions to find orders since the previous successful Run, process valid orders, and notify Operations about incomplete ones. A weekday 8 AM schedule uses an explicit timezone. Mango infers email/Airtable/Linear capabilities, checks the actual connections/scopes, and exposes compiled context before activation.

One due occurrence creates one Run and appropriate Node, advances only after saved work/evidence, follows company action policy, drafts email, requests approval for sending under Balanced policy, records idempotent results, and marks success only after required criteria. History links the exact Node and context.

The example is a batch while a Process Run normally has one Node. A proposed smallest future interpretation is one batch Run/Node with per-order action/evidence identities. Decide whether one incomplete order blocks the whole batch or permits other valid orders to finish before Needs Attention. Never advance the successful-input watermark past unhandled orders or duplicate earlier external effects on restart.

### Approval, blocked/resume, restart, and discard

For email approval, save the draft and exact action preview, wait durably, reauthorize the approved action, and execute/reconcile it before continuing. A rejected action never sends. A changed recipient/body invalidates its approval.

If the Costco account is ambiguous, keep the Node at its current Step, record the missing information, notify the appropriate user, and resume the same Run with a new attempt after an authorized answer. Do not guess or rewrite history.

Restart preserves the previous Run and creates a new Run/Node using current definitions. Recognize already completed external business actions. Discard retires staged internal proposals, preserves Node/history/evidence, and does not claim external work was undone.

### Decisions deferred until their feature is implemented

- Actual Workflow execution semantics, entry/branch/join conditions, cycles, and parent/child limits.
- Multi-order Node granularity, partial success, input windows, and successful-watermark behavior.
- Business-day/holiday calendars, daylight-saving ambiguity, overlap, and missed-occurrence policy.
- Long-term trace retention, historical source-deletion access, and which non-developer roles can inspect technical context.
- Provider-specific idempotency guarantees/retention, external reconciliation, and reliable compensation.
- Company default autonomy, exact approval eligibility, and strict budget enforcement when provider cost data is incomplete.

None of these open future questions blocks the internal, foreground, fully inspectable Pi MVP in section 4.
