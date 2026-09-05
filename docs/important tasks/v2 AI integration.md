# V2 AI Integration

Date: September 4, 2026

Status: Jonat authorized both MVP tasks to begin. The Process AI skeleton is implemented in worktree 0000842, with verified discussion, follow-up context, inline reference labels, and developer context inspection; the full proposal remains future scope. Integration and publishing require a separate request.

## Current decision

Build the smallest working Process-level AI experience first. A user asks the AI to perform one existing Process from a chat box. Mango supplies the user identity, selected Process, its Steps, and its SOP automatically. The AI can create a Node, write text in that Node, and move it between that Process's Steps.

The full original proposal is retained below as future scope and as a verbatim reference. Its instructions to implement everything, its original first-version requirements, tests, and acceptance checklist do not apply to the small first version. The current decision and first-version scope in this document take precedence.

Jonat authorized implementation of this small first version. The backlog, live database changes, integration into main, deployments, and publishing remain outside that authorization. Current behavior is documented in [AI & MCP laws and tool inventory](../tests/AI%26MCP.md) and [relationship laws](../tests/relationships.md).

## First version: ask the AI to perform a Process

### Intended interaction

1. The user types a request in a chat box, such as “Please carry out #Prepare meeting summary.”
2. Typing `#` opens the existing universal picker so the user can select the exact existing Process.
3. The selected Process appears as an inline reference in the message.
4. The user submits the message with Enter after selecting the Process.
5. Mango automatically supplies the context listed below.
6. The AI creates a Node in that Process and places it in the appropriate starting Step.
7. The AI follows the supplied SOP and Steps, writes its work into the Node, and moves the Node as it progresses.
8. The user can open the Node and see the saved text and current Step in Mango's existing interfaces.

The aim is to prove that AI can perform useful internal work from an existing Process without making the user repeat its procedure or configure a Job. Start with one selected Process and one work item. Batch processing and Workflow execution are future questions.

### Automatically supplied context

| Context | Minimum contents |
|---|---|
| User | The authenticated acting user and company scope needed for the request. |
| Request | The user's submitted message and exact selected Process reference. |
| Process | Its existing identity, name, and relevant authored description. |
| Steps | Their exact existing identities, names, order, and logical connections. The SOP supplies the written explanations; there are no separate per-Step instruction fields. |
| SOP | The selected Process's authoritative SOP/editor content. |
| Execution feedback | The created Node identity and results of the internal actions, so subsequent actions use the actual saved Node and Step. |

Read these through Mango's existing data and permission paths. Keep context limited to this work; company-wide search, embeddings, and a new context-management platform are unnecessary for this version. Credentials and secrets never belong in model input.

### Only three internal actions

| Action | Required behavior |
|---|---|
| Create a Node | Create a real Node through Mango's existing creation and Process-assignment behavior. Return its real identity. |
| Write text into the Node | Use the existing Node text-box/editor storage to save the AI's work. |
| Move the Node between Steps | Use the existing Step-placement behavior within the selected Process. Show the persisted placement in the existing Process Board. |

“Internal CRUD” means these narrow operations in this version. It does not mean unrestricted creation, editing, or deletion across Mango. There is no need to build an MCP server or connect external MCP tools to expose these actions to the model; ordinary backend tool calls are sufficient unless an existing narrower implementation already fits.

These are normal saved Node changes. There is no separate sandbox, staged company-state copy, final commit, discard-all button, or promised automatic undo in the first version.

### Keep the implementation small

1. Reuse the existing chat/editor, universal picker, Process, Step, SOP, Node, and Process Board behavior.
2. Use the selected Process's canonical stored identity; do not invent a parallel Process resource or infer the target from its display name.
3. Reuse normal backend authorization for every read and action. The model receives no extra access simply because the user submitted a chat message.
4. Keep the available actions restricted to the selected Process and the Node being worked on.
5. Use one working model connection. Provider choice remains an implementation detail to settle against existing support; do not build multi-provider selection, adapters for every provider, or fallback orchestration now.
6. Use the smallest model/tool execution loop that performs the real actions and returns their results. Do not build a general agent framework.
7. Display saved results and failures plainly. If the SOP needs an unavailable external action, report that limit instead of pretending it happened.
8. Stop on a failed or unsupported action rather than adding autonomous replanning or a retry platform. Ordinary request timeouts and a simple execution bound do not require a new resource-policy system.
9. Treat existing API validation and successful persistence as basic correctness. Do not add the proposed Expected Outputs or Success Criteria verification engine yet.
10. Keep concerns separate using the project's existing code structure, without introducing a new service for every concept in the full proposal.

### Explicitly outside the first version

- Jobs, Scheduled Jobs, recurring or future execution, scheduler infrastructure, and Jobs management UI.
- The full persistent Run/attempt/checkpoint framework and Run history dashboards.
- Approval requests, approval gates, company autonomy presets, and policy configuration UI.
- Multiple providers, automatic model selection, and provider fallback.
- External MCPs, third-party integrations, OAuth connection setup, capability inference, and readiness analysis.
- Sending email, creating Airtable records, creating Linear issues, and other external actions.
- New Step Expected Outputs fields, Process Success Criteria fields, formal verification, and verified-success metrics.
- Staging, change sets, commit/discard, inverse actions, and rollback systems.
- Workflow orchestration, child Runs, multiple-order batches, and cross-Process execution.
- Durable invocation archives, full event-log infrastructure, cost dashboards, and notifications. The developer context inspector described below is included in the small version.
- Retry/resume/restart management, schedule overlap policies, configurable budgets, and a new conflict-resolution system.
- New navigation, a separate AI board, or changes to Process Map, Workflow copying, or Company Explorer.

Existing permissions, validation, persistence, and concurrency behavior still apply. Deferring new AI subsystems does not remove the controls already used by normal Mango operations.

### First-version acceptance

1. A user can select one existing Process through the reused `#` picker in the chosen chat surface.
2. Submitting the request starts real model execution without requiring a Job form or restating the SOP.
3. The model receives the authenticated user context, selected Process, its Steps, its SOP, and the user's request.
4. The AI creates a real Node assigned to the selected Process.
5. The AI saves useful text in that Node using the existing storage path.
6. The AI moves the Node between valid Steps of that Process, and the saved movement appears in the existing UI.
7. Unauthorized, invalid, failed, or unavailable operations produce a clear failure instead of fabricated success.
8. The example works with internal Mango actions alone and introduces none of the deferred platforms.

Use a simple internal example, such as drafting a meeting summary and action list from information supplied in the message. The Costco/email/Airtable/Linear example belongs to future integration work.

### First-version implementation decisions

- Reuse the floating Mango chat, the universal reference picker, and the existing OpenAI Responses connection. Ordinary chat remains available.
- The selected Process remains as the existing inline reference label across Sends until removed or replaced. Referencing it supplies context for discussion; only an execution request creates one new Node.
- Read the actual Steps and canonical SOP textboxes before calling the model. The SOP lists and briefly explains the Steps; map positions and sizes do not determine execution.
- Let the model select a clear starting Step and follow the SOP and logical connections. An ambiguous path or unavailable external action stops with an explanation.
- Create the Node with In Progress status and its starting Step in one existing command. Later moves preserve its status.
- Each text action adds a fresh canonical textbox and reads back the saved document. Existing Node text remains intact.
- Recheck the definition and access before each action. Enforce the expected Process, Step, status, and assignment version inside each Node write/move transaction so a concurrent human move cannot be overwritten.
- Reuse the existing foreground limit: eight sequential actions, nine model responses, and a 90-second deadline per Send. This is a small experiment, with no persistent Run, automatic retry, or resume system.
- Link the created Node from chat as soon as its creation succeeds, including when later work fails or stops. Already saved work remains in Mango.
- Tests use the existing HTTP/model stub, memory repository, and frontend test runner. No paid provider call or live database write is required for repository verification.

### Implementation verification — September 4, 2026

- Complete backend `go test ./...` passed through WSL2 Ubuntu, including ordinary identity injection, current-user assignments beyond 50 Processes, developer context inspection, incomplete-Process discussion, refreshed canonical SOP reads, and the existing execution/store regressions.
- The existing disposable PostgreSQL gate passed on local PostgreSQL 18.4, including the new guarded Node write/move test; the new queries use PostgreSQL 17-compatible features.
- The complete frontend relationship suite passed 1,064 tests with zero failures; the production build passed. Browser verification confirmed the actual editor reference label, persistent Process identity on follow-up, and context inspection dialog.
- Tests cover selected-Process context and three-tool restriction, actual saved Node text/Step changes, current access, changed SOP/Steps/connections, concurrent human movement, identical text in different Steps, picker binding/reset, and retained Node links.
- The original 72,523-byte proposal in the appendix was verified against its recorded SHA-256.
- Model responses were supplied by a local test server. A live model demonstration has not been performed; this uses Mango's existing server-side OpenAI configuration.
- No packages, schema migrations, live database writes, main integration, push, or pull request were added by this task.

### What Mango sends to the model

1. **Instructions:** Mango's fixed behavior and tool-use rules; Process discussion/execution rules replace general chat rules when a Process is selected.
2. **Current identity, every Send:** authenticated user ID, display name, email, selected company ID, and current company role. These come from server-side authentication, not client-supplied profile fields.
3. **Selected Process, when present:** its exact ID and name, current Step IDs/names/order, logical connections, and canonical SOP JSON with textbox identity and revision. Missing SOP/Steps are reported as execution blockers while discussion remains available. Map geometry is excluded.
4. **Conversation:** completed user/assistant exchanges and the latest user message. The current Process selection is refreshed independently of old transcript text.
5. **Tools:** the permitted function names, descriptions, and argument schemas. Process execution uses only its three narrow actions; general chat includes the existing current-user assignment query.
6. **Within one Send:** each subsequent model call retains earlier input and adds the model's completed tool call and Mango's actual result. The provider's encrypted reasoning continuation is forwarded by the existing SDK loop and is not displayed as readable context.
7. **Settings:** the configured server model, selected reasoning effort, and existing foreground/output limits. Provider credentials stay in server memory and are not prompt content.

For a dev_admin, enable **Inspect context** before Send, then open **View context** on that chat turn. The view shows the initial human-readable input and additions for each model call, using data captured from the actual backend request parameters. Earlier input is reused by later calls; it is not duplicated in the inspector. Encrypted reasoning items are counted as omitted. Nothing is saved as a new run log or transcript table.

## Full future product requirements

Everything in this section is retained from the original vision for later work. It is not a checklist for the first version or a commitment to build all of it in one release. Revisit each capability after the smaller product works end to end. Repeated requirements from the original are combined here; its complete wording, examples, 75 tests, 45 acceptance items, and 40 deliverables remain in the appendix.

### 1. Vocabulary and authored procedure

- A **Job** is a user-authored, durable AI execution definition targeting one Process or supported Workflow. It stores its name, optional extra instructions, creator, credential owner, company, status, model policy, resource limits, tool requirements, and permitted stricter execution settings.
- A **Scheduled Job** is a Job with a recurring or future schedule, including a one-time future occurrence. The scheduler owns time; the model does not remember when to wake itself.
- A **Run** is one actual execution of a Job. Each scheduled occurrence or “Run now” creates a new Run with its own stable identity and history. Restart creates another Run; resume continues the same Run with a new attempt/checkpoint.
- The Process or Workflow remains the authored procedure: SOP, Steps, connections, RACI, permissions, Expected Outputs, and Success Criteria. A Job adds execution instructions and timing without making users rewrite that procedure.
- The existing Node remains the visible runtime work object. Do not create parallel Process, Workflow, Step, SOP, assignment, permission, or Node models.

### 2. Job creation and management

- Add Create Job through the existing Process action/menu and preselect that Process. Support name, optional extra instructions, manual/one-time/scheduled execution, timezone, activation, and optional stricter limits or approval settings; use company defaults.
- Creating a Job does not itself execute it unless the user chooses immediate execution. The intended scheduled flow is Process → Create Job → instructions/schedule → readiness review → activate.
- Job instructions supplement the procedure and appear in every Run. They cannot silently override company policy, permissions, SOP, Expected Outputs, or Success Criteria. Any permitted procedure override must be explicit and authorized.
- Preserve instructions such as selecting an account or table, drafting instead of sending, selecting recipients, considering data since a previous Run, and flagging a threshold. Their ambiguity must be surfaced rather than guessed.
- Keep normal Jobs and Scheduled Jobs distinguishable in product language. “Cron job” is not the primary user-facing term.

### 3. Process and Workflow execution

- Process Runs normally use one Node assigned to that Process. Workflow execution must reuse Mango's actual composition/runtime semantics; it may coordinate child Process Runs or Nodes.
- Do not fake a Workflow by treating one Process Node as the whole Workflow. If coherent Workflow runtime support does not exist, retain it as future scope and deliver Process support independently.
- All manual, scheduled, and restart trigger paths converge on the same Run-creation/execution behavior.
- A Run uses understandable queued, preparing, running, awaiting-approval/review, blocked, failed, succeeded, and cancelled semantics where supported by existing conventions.
- Persist Step results before moving the Node. Failed Steps keep the Node at the failure point. Evaluate final completion conditions before success, including required review/commit behavior.

### 4. Expected Outputs and Success Criteria

- Store explicit Step Expected Outputs on the existing Step using existing editing patterns. Make them readable, editable, inspectable, included in model context, and preserved for each Run.
- Expected Outputs describe required artifacts or facts before a Step completes. They are checkpoints, not automatic human approval gates.
- Allow missing Step outputs where company policy permits, warn about weaker verification, and never invent authoritative criteria or claim deterministic verification.
- Store explicit Process-level Success Criteria separately from Step outputs and evaluate both. Completed Steps alone do not establish Process success.
- Reuse deterministic checks for facts such as record/attachment existence, required fields, formats, approval records, matching values, and returned external identifiers.
- For judgment-based criteria, keep the model evaluation, evidence, relevant tool results, and human approval where required. A model's statement alone must not be presented as a deterministic check.
- If final criteria fail, continue only where the authored Process provides a clear safe action; otherwise stop with an appropriate blocked/failed/needs-attention result.

### 5. Company autonomy and action policy

- Authorized company administrators configure execution policy using existing settings and permissions. Possible presets are Permissive, Balanced, and Strict; evaluate actual action properties rather than only a preset label.
- Balanced allows analysis, drafting, low-risk internal work, and normal Step progression without approval at every Step. It requires approval at explicit gates and for irreversible external actions, and Process-level review of staged authoritative changes where appropriate.
- Stricter company/Job settings can require more review. Lower-level configuration cannot weaken company rules without authority. Any broadly authorized external actions still obey hard security restrictions.
- Include effective policy in model context, but enforce access, scopes, action restrictions, approvals, and limits in the backend. A blocked tool request returns a structured reason, a readable Node event, and the appropriate execution state.
- Human intervention belongs at real policy boundaries, high-risk/irreversible actions, explicit gates, conflicts, missing capabilities/credentials/critical information, material ambiguity, exhausted limits, or unresolved verification failure.
- Tool metadata describes read/write, internal/external, reversibility, risk, required permission/scope, inverse action, draft support, policy requirements, and availability to the acting identity. The model must not classify its own authority.

### 6. Provider-neutral execution

- Reuse model integrations through a common execution interface when multi-provider support is introduced. Keep business logic outside provider adapters and avoid assumptions that every provider uses the same message/tool-call format.
- Support normalization of instructions/context, tool definitions/calls/results, streaming, usage/tokens/cost, stop reasons, errors, model/provider identifiers, and request identifiers.
- The full vision includes OpenAI, Anthropic, Google, xAI, and future providers without branding Mango's execution model as a particular vendor's assistant.
- Record actual provider/model per Run and relevant invocation. Do not silently switch providers; fallback requires explicit company/Job policy, and an ordinary provider failure stops or pauses execution.

### 7. Context compilation and exact inspection

- Reuse one central place to assemble execution context; avoid independent prompt construction in UI components, controllers, scheduler handlers, and provider adapters.
- Include relevant company/user identity, roles, Teams, RACI, acting-on-behalf-of identity, target identity/version/parent context, authoritative SOP/editor content, and every applicable Step's identity, instructions, ordering/connections, configuration, outputs, gates, assignments, tool hints, and supported branch conditions.
- Include Process Success Criteria, separately identified Job instructions, company policy and limits, required/resolved capabilities, allowed tools/actions/scopes, missing capabilities, and tool constraints.
- Include changing Run state: current Step, prior results, relevant Node artifacts/text/attachments, tool results, approvals, failed checks, and remaining outputs. Avoid unrelated company information and repeated irrelevant raw logs.
- Compile from the actual authoritative editor representation. Do not add broad semantic retrieval, embeddings, or a company knowledge graph for this feature.
- Show a current compiled preview on the Job and preserve the actual Mango-supplied context for historical Runs, including tool definitions and later context changes/results at relevant model invocations.
- Store initial context, Step changes, appended tool results, provider/model, timestamps, and redaction status. Inspection must distinguish exact supplied context from a summary and from hidden provider internals Mango cannot see.
- Keep credentials, tokens, passwords, secret headers, and raw authentication material outside model input and inspection. Redact sensitive technical payloads appropriately.

### 8. Stable Run definitions

- Snapshot or version-reference Job settings/instructions, target definition, SOP, Steps, Expected Outputs, Success Criteria, relevant RACI/explicit permissions, capability analysis, model decision, and effective execution policy at Run creation.
- An active Run retains its starting authored definition; the next Run uses later edits. Make that version inspectable.
- Live external data may change. Recheck current authorization and hard policy at action time; a historical snapshot never preserves revoked authority.

### 9. Capability inference and readiness

- Infer capabilities from SOP, Step instructions/outputs, Success Criteria, Job instructions, and explicitly named systems. Map requirement → capability → supported integration/MCP implementation without binding a generic capability to one implementation unnecessarily.
- Preserve a named-system constraint such as Airtable or Linear. Examples include email search/draft/send, Airtable record read/write, and Linear issue creation.
- Store inspectable requirement source, required/optional status, confidence where useful, resolved integration, scopes, connection status, and analysis version. Refresh or mark stale after procedure or Job edits. Normal users should not maintain MCP lists manually; corrections may be supported where appropriate.
- Before activation/execution, check capability coverage, compatible tools, connections/health/scopes, active credential owner, target existence/access, Job execution authority, company policy, representable approvals, provider availability, and valid resource settings.
- Present clear Ready/Needs setup/missing connection or scope/owner reassignment/policy-blocked states and missing-output warnings. Missing required capabilities block predictable execution failures.

### 10. Credentials and authorization

- Prefer delegated user integrations with a clear credential owner. Reuse secure OAuth/vault infrastructure. Audit actions as Mango AI acting on behalf of that user where supported.
- Recheck membership, target access, connection health, scopes, tool authority, and approval state during execution. Owner removal, expired/disconnected credentials, or lost permission pauses/blocks work; never silently use another person's credentials.
- Allow authorized administrators to reassign the credential owner. Company service identities remain future work unless already supported.
- Authorize viewing/creating/editing/disabling Jobs, activation, execution, context and Node inspection, approvals, staged-change commit/discard, restart/resume, company-policy edits, and raw technical-detail access through existing backend rules.

### 11. Durable scheduling

- Support Run now, one-time future execution, recurrence, explicit timezone, pause/resume/disable, schedule edits, and last/next Run display. Reuse durable scheduler/worker infrastructure.
- For a due occurrence, establish unique ownership, check active/readiness/authorization state, create exactly one Run and its required Node, enqueue execution, record scheduled/actual times, and calculate the next occurrence.
- Tolerate restarts, retries, duplicate delivery, database failures, and provider failures without duplicate Runs. Use durable uniqueness/idempotency protection.
- Default to one active Run per Scheduled Job. An overlap has an explicit queued/skipped/blocked outcome visible in history. Do not create an uncontrolled missed-run backlog or backfill without explicit support.

### 12. Node experience and live progress

- Use existing Node text boxes, timeline, attachments, email/chat associations, draft presentation, and error/approval surfaces for AI work, with clear links to its Job, Run, provider, and acting user.
- Each Step produces understandable work summaries, outputs, evidence, actions taken/pending, and unresolved issues. Normal users should not need protocol logs.
- Show active AI activity and current Step on the existing Node card. Move only after saved completion; display paused/approval/blocked/failed states accurately and stop the working animation when inactive.
- Reuse Node tabs where appropriate and keep Node links easy to find in Job/Run history. Do not redesign the whole Node or introduce a separate AI board.
- Use existing realtime infrastructure for state, placement, tool progress, approvals, timeline entries, completion, failure, conflict, and limit stops. Server transitions remain authoritative; stale clients cannot overwrite newer execution state.

### 13. Staging, reversibility, and approvals

- Attribute every AI mutation to company, Job, Run, Node, Step, actor, tool/action, timestamp, approval state, and commit state.
- Where feasible, stage authoritative internal changes for Process-level review using existing draft/revision/transaction infrastructure. Support apply/commit, discard, modification requests, and selective approvals/rejections without requiring a commit after every Step.
- Discard preserves the Node and execution record: proposed/discarded content, reason, and decision maker. It does not erase history or pretend completed external actions never occurred.
- Define action-level support for deferred execution, drafts, staging, before-state, inverse operation, transaction rollback, version restore, compensation, or no reversal. Record rollback details, authorize rollback, and log attempts/results. Never promise undo the external system cannot guarantee.
- Tie approval to one exact action or Process-level commit. Show target, actor, content, reason, reversibility, expected result, diff/preview, and approve/reject/edit where supported.
- After approval, reauthorize and recheck target/action state, execute safely, record the outcome, and continue. Rejection prevents execution, preserves the proposal/history, and does not allow repeated resubmission without new information.
- Draft email, publishing, deletion, customer communication, payments, and other consequential actions follow policy and explicit approval requirements.

### 14. Failure, retry, resume, restart, and conflicts

- Allow minor discretion within the authored procedure but stop on material assumptions: ambiguous customers/recipients/amounts/vendors, ignored discrepancies, skipped outputs, unauthorized substitutions/actions, Process redesign, policy changes, or scope expansion.
- Show where and why work stopped, retain the Node at that Step, notify the appropriate user, and expose permitted recovery. Avoid aggressive autonomous replanning.
- Retry only bounded, safe transient failures within the same Run. Do not blindly repeat irreversible actions or requests whose external outcome is unknown.
- Resume the same Run after missing information, approvals, connection repair, conflict resolution, or an authorized continuation; retain history and record a new attempt/checkpoint.
- Restart creates a new Run using current Job/Process definitions and appropriate Node semantics, with an inspectable relationship to the prior Run. Cancellation and staged-change discard remain distinct actions.
- Detect stale authoritative writes before applying them using existing concurrency/version conventions. Show the conflict and require explicit resolution/refresh/retry; neither silent last-write-wins nor model-selected winners resolve material conflicts.

### 15. Resource bounds

- Provide company defaults and stricter Job limits for duration, tokens, cost, model calls, tool calls, action count, retries, consecutive failures, child depth, and total/per-Job concurrency where applicable.
- Normal users cannot exceed hard company/platform limits. Stop safely at a limit, preserve work/evidence, explain which bound was reached, and support authorized inspection and recovery with adjusted limits.

### 16. History, events, metrics, and notifications

- Maintain structured append-only execution events independently of mutable Node text. Cover creation/queue/start, Node/Step changes, model/tool activity and blocks, outputs/checks, approvals, staging/commit/discard, conflicts, recovery, final states, rollback, and limits.
- Derive readable Node timeline entries from those records. Expand details where useful without showing secrets or unnecessary raw payloads.
- Preserve enough history to identify the trigger, target version, Nodes, actor, provider/model, supplied context/tools, actions and blocks, approvals, completed Steps, output evidence, failures, duration, usage/cost, change disposition, and reasons for success.
- Notify relevant users for approval, blocks, failure, limits, broken connections, conflicts, and configured completion. Respect company/user preferences and avoid notifications for ordinary Step movement.
- Where enough data exists, offer secondary metrics: success/verified-success rate, duration, usage/cost, failures, approval frequency, commonly failed Steps, and missing capabilities.

### 17. Jobs UI

- Show Jobs and Scheduled Jobs as rows within existing product organization, with name, target/type, schedule, status/readiness, last result, next Run, owner, and tool warnings where relevant.
- Row selection opens a compact modal/pop-up with Overview, AI Context, and Run History tabs. Do not add a left sidebar or use a right-hand detail sidebar. Follow existing focus and keyboard-accessibility conventions.
- Overview exposes instructions, target, timing/timezone, activation/setup state, creator/credential owner, policy/limit summaries, and run/pause/resume/edit/disable controls.
- AI Context exposes the next-Run preview, included sources, capabilities/integrations/scopes where relevant, missing connections, selected provider/model, version, and redaction notices.
- Run History shows stable identity, trigger/schedule/start/end/duration/status/Step, Node, provider/model, usage/cost, approval/tool counts, error, and commit/discard/rollback state.
- Selecting a historical Run reveals its actual context, Step history, Node, tools, approvals, evidence, result/error, and permitted restart/resume. Provide loading, error, blocked, and retry states.

### 18. Persistence and architecture constraints

- Reuse existing domain records, services, API conventions, authorization, transactions, realtime, scheduler/worker, providers, MCP/integrations, notifications, outbox, audit, and draft/versioning facilities before adding equivalents.
- The original lists Job management, scheduling, readiness/inference, context, execution, authorization, approvals, staging, conflicts, usage, providers, logging, Node presentation, and notifications as responsibilities. It does not require a separate service or table for every responsibility.
- Conceptual records are Job, capability requirement, Run, Step attempt, event, action/change, approval, and company policy. Preserve relevant identities/configuration/versions/state/times/usage/errors/evidence, using existing equivalents where present and stable IDs instead of array positions.
- Use exact company-scoped resource identities and existing relationship semantics. Target deletion/archive safely invalidates or pauses dependent Jobs; lifecycle handling must follow the relationship and recycle contracts.
- Use transactions for required multi-write actions: Job/Run/Node associations, action/approval links, evidence/Step completion, and change-set commits must not be left partially saved. Persisted context must match execution.
- External calls require recorded intent, safe idempotency where supported, request identifiers, recorded outcomes, and reconciliation when uncertain. A database transaction alone cannot guarantee an external action's outcome.
- Avoid destructive migrations, speculative abstractions, large unjustified dependencies, duplicate models/navigation, and execution confined to the frontend. Preserve existing data and independently mergeable work.

### 19. Future examples, acceptance, and delivery

- Preserve the full Costco order example: receive/identify and attach an order, validate fields/totals, create an Airtable record, create a Linear follow-up if needed, draft/approve/send confirmation, and record final summary/evidence against Step outputs and overall criteria.
- Preserve its weekday 8:00 AM schedule, checking for new orders since the previous successful Run, processing valid orders, and notifying Operations about incomplete ones.
- Preserve the blocked ambiguous-account example, same-Run resume, new-Run restart, and internal staged-change discard with retained history.
- The original's 75 tests cover Job/schedule creation and management, duplicate prevention, Node progress, context/snapshots, providers/capabilities, authorization/policy/approvals, staging/reversal, failures/recovery/limits/conflicts, identity loss, events/history/UI/metrics, domain reuse, deletion, atomicity, and external idempotency.
- Its 45 acceptance items and technical constraints remain the full-vision targets, not the first-version gate.
- Future delivery reports cover current architecture, chosen approach, vocabulary, targeting/instructions, context/snapshots, verification, tools/credentials/providers, policy/approvals, Node execution/staging, recovery/conflicts/limits, logs/UI/history, schema and code changes, actual tests/results, example walkthroughs, assumptions/limitations, and preservation of the independent map/copy work. The original's exact 40-item list is retained below.

### 20. Boundaries retained from the original

- Do not reimplement Company Explorer, Company/Process Map, Workflow Canvas/layout, map placement, drag/drop, Process/Workflow creation or deep copying, reusable Process/Workflow references, or Workflow composition in this AI effort.
- Do not add a generalized knowledge graph, automatic company-wide Process inference, broad company semantic retrieval, a second structural navigation system, a diagram-only runtime, a new Node definition, or a provider-specific business architecture.
- Reuse RACI, permissions, email/chat links, attachments, and relationships as they exist. Existing relationship laws govern design changes and remain separate from historical Run snapshots.
- Keep approvals tied to actions and policy rather than requiring signoff at every Step by default.

## Future questions to resolve when relevant

1. Batch meaning: does each Costco order get a Node and its own execution outcome, and how does the daily trigger aggregate them? The original's one-Run/one-Node description does not settle mixed success across multiple orders.
2. Repeat processing: what records work already completed when a batch partly fails, or a restarted Run sees the same order again? “Since the previous successful Run” alone does not settle this.
3. Discard meaning: which changes are still pending, which are already applied, and which external effects cannot be undone?
4. Verification meaning: when can model judgment support success, and when is a deterministic check or human decision required?
5. Scheduling vocabulary: clarify the UI distinction between “one time” and a Scheduled Job that runs once in the future.
6. Snapshot versus live editing: how does an active Run retain its authored Step definition while respecting deletion, movement, and current authorization on actual Process/Node resources?

These questions do not add batch execution, staging, verification, scheduling, or snapshots to the first version.

## Verbatim original proposal — future reference only

The following block preserves the complete original attachment without edits. Its implementation commands are quoted reference material, not current execution instructions. The decision at the top of this file overrides its scope and sequencing. The original worktree reference file is also retained unchanged as `mango-ai-discussion-original.txt`.

Original size: 72,523 bytes.

Original SHA-256: `62DA1D33DC3B24EA0A25754A299DABF345681563D21AD890C8C8C373DE974E96`.

<!-- BEGIN VERBATIM ORIGINAL PROPOSAL -->
````text
You are working inside the Mango codebase.

This is a standalone implementation task focused exclusively on how Mango creates, schedules, executes, supervises, verifies, records, and displays AI work using LLMs and tools.

Mango may use multiple model providers, including OpenAI, Anthropic, Google, xAI, and future providers. Do not build the product around ChatGPT, Codex, Claude, Gemini, Grok, or any other single model.

This task is intentionally separate from another implementation effort covering:

- Company Explorer
- Company Map / Process Map
- Workflow Canvas
- Workflow and Process creation
- Drag-and-drop copying
- Recursive Workflow copying
- Layout persistence
- Map placement
- Workflow composition

Do not reimplement or redesign those systems in this task.

Assume Mango already has, or will separately have, the following domain concepts:

- Companies
- Users
- Teams
- Folders
- Workflows
- Processes
- Steps
- SOP/editor documents
- RACI assignments
- Permissions
- Process Boards
- Runtime Nodes
- Node timelines
- Node text boxes
- Node attachments
- Email and chat associations
- Existing integrations or MCP infrastructure where present

Integrate with the repository’s existing versions of those concepts. Do not create parallel Process, Workflow, Step, SOP, permission, assignment, or Node models.

The objective of this task is to implement the real vertical slice for:

- Jobs
- Scheduled Jobs
- Runs
- Context compilation
- Model-provider abstraction
- Tool and MCP requirement inference
- Integration-readiness checks
- Company-level AI autonomy policy
- Approval enforcement
- Step-level expected outputs
- Process-level success criteria
- Node-based AI execution
- Live Process Board progress
- Reversible and staged changes
- External side-effect protection
- Failure, stopping, retrying, restarting, and resuming
- Conflict detection
- Resource limits
- User-facing run history
- Structured execution logging
- Job inspection UI
- Exact per-Run AI-context inspection

Do not merely create mockups or write an implementation plan. Inspect the codebase, explain the approach briefly, and then implement the complete working vertical slice unless a genuine technical blocker prevents a specific portion.

# Scope boundary

This task must remain independently mergeable from the separate Process Map and Workflow-copy work.

Do not implement:

- Process or Workflow deep copying
- Company Explorer drag-and-drop
- Company Map placement
- Workflow Canvas layout
- Reusable Process references
- Reusable Workflow references
- A new Company Explorer
- A second structural navigation system
- A generalized knowledge graph
- Automatic company-wide process inference
- Broad semantic retrieval across all company information
- A new definition of a Mango Node
- A separate diagram-only execution model
- A provider-specific AI architecture
- A system that asks the user to approve every Step by default

Make only the changes needed to integrate Jobs, Scheduled Jobs, Runs, LLM execution, approvals, verification, and observability into Mango’s existing domain.

# Before changing code

1. Inspect the current frontend, backend, database schema, migrations, API conventions, authorization model, realtime system, job or scheduler infrastructure, model integrations, MCP integrations, tool-calling implementation, Process model, Workflow model, Step model, SOP/editor storage, RACI model, permissions, Node model, Process Board, Node timeline, text-box system, attachments, and event logging.

2. Search for any existing concepts that already represent:
   - Jobs
   - Scheduled work
   - Runs
   - Agents
   - AI executions
   - Tool calls
   - Approvals
   - Policies
   - Events
   - Audit records
   - Change sets
   - Draft state
   - Background workers
   - Cron scheduling
   - Model providers
   - MCP servers
   - OAuth integrations
   - Node transitions

3. Reuse existing architecture and terminology rather than building duplicate systems.

4. Preserve existing naming conventions, migration conventions, transaction patterns, component patterns, API style, authorization checks, realtime conventions, and visual design system.

5. Do not expose integration credentials, OAuth tokens, secrets, or raw authentication material to an LLM prompt.

6. Give me a concise current-state assessment and implementation plan.

7. After the assessment, implement the complete vertical slice. Do not stop after the plan unless a genuine blocker exists.

8. Make reasonable assumptions where needed and clearly list them in the final summary.

# Required vocabulary

Vocabulary is important and must remain consistent throughout the backend, frontend, UI copy, tests, documentation, and final summary.

## Job

A Job is a user-authored AI execution definition associated with a specific Process or Workflow.

A Job contains the durable configuration needed to execute that target, such as:

- Name
- Target Process or Workflow
- Optional Job-specific instructions
- Creator
- Credential owner
- Company
- Model-selection policy where supported
- Resource limits
- Status
- Tool or capability requirements
- Approval-policy configuration where supported
- Other existing execution configuration

A Job can be manually run or configured as a one-time Job.

Creating a Job does not itself mean that an execution has already happened unless the user explicitly chooses to run it immediately.

## Scheduled Job

A Scheduled Job is a Job that has a recurring or future schedule.

Examples:

- Every weekday at 8:00 AM
- Every Friday at 4:00 PM
- On the first business day of each month
- Once at a specific future time

The scheduler is responsible for recurrence.

The LLM must not be responsible for remembering when to run itself.

The scheduler creates a Run when the Scheduled Job becomes due.

The implementation may use a shared Job database table with schedule fields if that fits the existing architecture, but the UI and product language must distinguish a normal Job from a Scheduled Job.

Do not use “cron job” as the primary user-facing term. “Scheduled Job” is the user-facing product term. A cron expression may be used internally or exposed in an advanced interface.

## Run

A Run is one actual execution instance of a Job or Scheduled Job.

Examples:

- The Monday 8:00 AM execution of a Scheduled Job is one Run.
- The Tuesday 8:00 AM execution is another Run.
- Clicking “Run now” creates a new Run.
- Restarting a Job from the beginning creates a new Run.
- Resuming a blocked Run continues that Run with a new attempt or checkpoint record.

Every Run must have its own stable identity and history.

A Scheduled Job may produce many Runs over time.

Do not call the recurring definition itself a Run.

# Core product model

The user first authors how work should happen using Mango’s existing operating model:

- Workflow
- Process
- SOP
- Steps
- Step connections
- RACI
- Permissions
- Expected outputs
- Success criteria

The user should not have to rewrite that entire procedure when creating a Job.

The Process or Workflow is the authored procedure.

The Job specifies when and under what additional instructions AI should execute that procedure.

The Run is the actual attempt.

The Node is the runtime work object through which the execution progresses.

# Primary user flow

The intended Process-level flow is:

1. The user opens an existing Process.
2. The Process already has an SOP and Steps describing the work.
3. The user chooses “Create Job.”
4. Mango asks only for the additional information needed for this Job, such as:
   - Job name
   - Optional Job-specific instructions
   - Run once, run manually, or schedule
   - Schedule and timezone
   - Optional stricter approval or resource settings
5. The user does not need to restate every Process Step.
6. Mango reads the Process definition.
7. Mango reads the SOP/editor content.
8. Mango reads every Step.
9. Mango reads the Expected Outputs for every Step.
10. Mango reads the overall Process Success Criteria.
11. Mango reads the Job-specific instructions.
12. Mango infers which capabilities, integrations, or MCP tools are required.
13. Mango checks whether those capabilities are available and properly authorized.
14. Mango displays a simple readiness result.
15. The user activates the Job or Scheduled Job.
16. When the Job executes, Mango creates a Run.
17. The Run creates or associates the correct runtime Node according to Mango’s existing Node architecture.
18. The Node enters the first relevant Process Step.
19. The AI executes the Process through the Node.
20. The Node visibly moves through the Process Board as Steps are completed.
21. The Node timeline records human-readable execution progress.
22. Mango pauses only at actual policy boundaries, approval gates, conflicts, missing information, or failures.
23. Mango evaluates Step Expected Outputs before advancing.
24. Mango evaluates overall Process Success Criteria before marking the Run successful.
25. The completed or failed Run appears in the Job’s Run history.
26. The user can inspect the exact AI context, actions, duration, status, Node, and result.

# Creating a Job

Add or reuse an appropriate “Create Job” action in the existing Process UI.

If the repository already has an action dropdown or Process menu, integrate there rather than creating an unrelated navigation system.

A Job created from a Process should automatically target that Process.

The creation flow should not ask the user to manually reproduce the SOP or Step instructions.

At minimum, allow the user to configure:

- Job name
- Optional Job-specific instructions
- Execution type:
  - Manual
  - One time
  - Scheduled
- Schedule when applicable
- Timezone
- Whether to activate immediately
- Optional stricter resource limits if supported
- Optional stricter approval requirements if supported

Use company-level defaults wherever possible.

The simplest successful experience should be:

1. Open a Process.
2. Click Create Job.
3. Enter optional additional instructions.
4. Select “Every weekday at 8:00 AM.”
5. Review tool readiness.
6. Activate.

# Job-specific instructions

A Job may contain additional instructions beyond the underlying Process.

Examples:

- “Run this for the Costco account.”
- “Use the East Coast sales table.”
- “Send the finished report to Alice.”
- “Only include orders received since the previous Run.”
- “Notify me if revenue is more than 10% below last week.”
- “Do not send the email automatically; leave it as a draft.”

These instructions must be included in the compiled AI context for every Run of that Job.

The Job-specific instructions supplement the Process.

They do not replace the SOP, Steps, Step Expected Outputs, or overall Success Criteria unless the product explicitly allows an authorized override.

Do not silently let a Job contradict company policy or bypass target permissions.

# Workflow-targeted Jobs

A Job may target a Workflow where the existing Mango model supports Workflow execution.

Reuse the repository’s actual Workflow composition and runtime semantics.

Do not invent a second Workflow execution model.

Because Mango Nodes are assigned to Processes, the expected conceptual behavior is:

- A Process-targeted Run normally creates one runtime Node for that Process.
- A Workflow-targeted Run may act as a parent orchestration Run.
- It may create child Process Runs or Nodes as the Workflow reaches its contained Processes.
- The exact implementation must follow Mango’s existing runtime architecture.

If the current codebase does not yet have a coherent Workflow runtime model:

- Fully implement the Process-targeted vertical slice.
- Preserve a target type that can support Workflows.
- Do not fake Workflow execution by pretending a single Process Node represents an entire Workflow.
- Clearly describe the limitation in the final summary.

# Step Expected Outputs

A Step must support explicit Expected Outputs.

Expected Outputs describe what must be true or what artifact must exist before the Step should be considered complete.

Examples:

- “The purchase-order number has been extracted.”
- “The order total matches the source document.”
- “A valid customer record has been found.”
- “The Airtable order row has been created.”
- “The draft confirmation email exists.”
- “Any discrepancies are listed in the Node timeline.”

Inspect the current Step and SOP/editor design.

Add Expected Outputs using the existing architecture and UI patterns.

Prefer a structured field associated with the existing Step rather than hiding the only authoritative value inside arbitrary rich text.

The SOP editor may display and edit these fields as part of the authored procedure, but do not create a separate set of diagram-only Steps.

Expected Outputs should be:

- Easy for a user to write
- Easy for the LLM to read
- Available in the compiled Run context
- Visible during Run inspection
- Available to the execution engine when deciding whether to advance the Node
- Versioned or snapshotted for each Run

Expected Outputs are strongly encouraged but do not have to be mandatory in every Process.

If a Step has no Expected Outputs:

- Warn the user that Step completion will be less verifiable.
- Do not invent criteria.
- Do not claim the Step is deterministically verified.
- Follow company policy regarding whether the Job may still run.

# Process Success Criteria / Expected Outputs

A Process must support explicit overall Success Criteria or Expected Outputs.

These describe the final state required before a Run should be marked successful.

Examples:

- “The sales-order record exists in Airtable.”
- “All required fields have passed validation.”
- “The confirmation email has been approved and sent.”
- “The Node contains the final order summary and source attachments.”
- “No unresolved purchase-order discrepancies remain.”

Use whichever product term best matches the repository, but keep the concept explicit.

The compiled context must include both:

- Step-level Expected Outputs
- Process-level Success Criteria

The AI may evaluate whether the criteria appear satisfied, but that assessment is not the only enforcement mechanism.

Where a criterion can be checked deterministically, Mango should perform or reuse a deterministic check.

Examples:

- Record exists
- Required field is non-empty
- External action returned a success identifier
- Attachment exists
- Approval was recorded
- Value matches expected format

Where deterministic verification is unavailable, store:

- The AI’s evaluation
- Supporting evidence
- Relevant tool results
- The user’s approval where required

If all Steps finish but the Process Success Criteria are not satisfied, do not silently mark the Run successful.

The Run should continue only if the Process provides a clear next action. Otherwise, stop as Blocked, Failed, or Needs Attention according to existing status conventions.

# Company-level AI execution policy

Autonomy and approval behavior must be controlled primarily by company policy.

Different companies have different tolerances for autonomous AI actions.

One company may want:

- “Let the AI run with minimal interruption.”

Another may want:

- “Require approval before almost every write.”

Do not hard-code one universal approval style.

Implement or reuse a company-level AI execution policy.

The policy must be configurable by appropriately authorized company administrators.

Use the existing company-settings and permission infrastructure.

Do not build an unnecessarily complex policy programming language for the first version.

A reasonable first version may use presets such as:

- Permissive
- Balanced
- Strict

The underlying system should still evaluate actual action characteristics rather than relying only on the preset’s label.

A reasonable default Balanced policy is:

- Allow drafting and analysis inside the Node without approval.
- Allow the AI to progress through normal Steps without requiring human approval at every Step.
- Allow low-risk internal work inside the Run sandbox.
- Require approval before irreversible external side effects.
- Require approval at explicit authored approval gates.
- Require one Process-level review before committing staged authoritative internal changes where appropriate.
- Stop on conflicts, missing permissions, material ambiguity, or missing capabilities.

A Strict company may require approvals more frequently.

A Permissive company may allow authorized low-risk or reversible changes to commit automatically.

The company policy may allow administrators to authorize specific external actions more broadly, but hard security and authorization boundaries must never be bypassed.

Lower-level settings may make execution stricter than company policy.

A normal user or Job must not weaken a company policy that they are not authorized to override.

# Prompt guidance versus enforcement

The effective company AI policy must be included in the LLM context so the model understands:

- What it may do
- What requires approval
- What is forbidden
- When it must stop
- How much discretion it has
- What resource limits apply
- What Success Criteria must be satisfied

However, the prompt is not the security boundary.

Enforce permissions, approvals, scopes, action restrictions, and limits outside the LLM through Mango’s backend execution and tool-permission layer.

If the model attempts a forbidden or approval-gated action:

- The backend must block the action.
- The backend must not rely on the model voluntarily complying.
- The Run must receive a structured response explaining why it was blocked.
- The Node timeline should show a human-readable event.
- The Run should enter the appropriate Awaiting Approval, Blocked, or Failed state.

# Avoid approval fatigue

Do not require a human to approve every Step by default.

Step Expected Outputs are primarily used for:

- Agent self-checking
- Engine validation
- Evidence capture
- Process progress
- Debugging

They are not automatically human-signoff gates.

The AI should normally be allowed to execute multiple Steps continuously inside the Node.

Human intervention should occur at:

- Explicit authored approval gates
- Company-policy boundaries
- Irreversible actions
- High-risk actions
- Conflicts
- Missing credentials
- Missing tools
- Missing critical information
- Material ambiguity
- Resource-limit exhaustion
- A failed verification that the AI cannot safely resolve

The basic principle is:

- Processes create checkpoints.
- Actions and policies determine approvals.
- Humans should not be interrupted for every minor operation.

# Action classification

Do not ask the LLM to decide by itself whether an action is reversible, irreversible, sensitive, or approval-gated.

Represent these properties in Mango’s tool or capability metadata.

Each mutating tool action should expose or derive metadata such as:

- Read-only or mutating
- Internal or external
- Reversible or irreversible
- Risk level
- Required permission
- Required OAuth or integration scope
- Whether an inverse action exists
- Whether it supports draft mode
- Whether company policy requires approval
- Whether the action is currently allowed for the credential owner

Examples:

## Low-risk internal work

- Create a text box inside the Run’s Node
- Add a generated summary to the Node timeline
- Attach a generated file to the Node
- Create a staged internal record
- Generate a draft

These should normally proceed without asking for approval at every action.

## Reversible external work

Examples may include:

- Updating a Linear issue where the prior value can be restored
- Creating a draft record that can be deleted
- Changing a reversible status
- Updating an Airtable field when the previous value is recorded

These may proceed automatically under a permissive or balanced policy when:

- The user has authorization.
- The tool declares a reliable inverse operation.
- Mango records the before-state or inverse action.
- Company policy allows it.

## Irreversible or externally consequential work

Examples include:

- Sending an email
- Publishing content
- Submitting a payment
- Deleting an external record without recovery
- Sending a message to a customer
- Finalizing a transaction
- Inviting an external party
- Approving a legally or financially consequential action

These should require human approval by default.

Where possible, the AI should prepare a draft or proposed action inside the Node before asking for approval.

# Model-neutral provider architecture

Mango must support multiple LLM providers without embedding business logic inside one provider’s API.

Create or reuse a provider-neutral model abstraction.

It should normalize, as appropriate:

- System and user instructions
- Structured context
- Tool definitions
- Tool calls
- Tool results
- Streaming output
- Usage information
- Token counts
- Cost metadata
- Stop reasons
- Errors
- Model identifiers
- Provider identifiers
- Request identifiers

The Job and Run domain models must not assume that every provider uses OpenAI-style message names or tool-call shapes.

Provider-specific adapters may translate between Mango’s internal representation and:

- OpenAI
- Anthropic
- Google
- xAI
- Other providers

Store the actual provider and model used for each Run and, where useful, for each model invocation.

Do not call the model itself “Codex” in the product model.

Do not silently switch providers during a Run unless the company or Job explicitly allows fallback.

A provider failure should normally stop or pause the Run rather than silently changing execution behavior.

# Context compiler

Create or reuse a centralized Context Compiler.

Do not construct prompts independently inside random controllers, React components, scheduler handlers, or provider adapters.

The Context Compiler should produce a normalized execution-context bundle for a Run.

For the first version, keep the context model deliberately understandable.

Do not add a generalized knowledge graph, embedding-based company search, or complicated retrieval system unless the repository already requires one for a narrow existing behavior.

At minimum, the compiled context must include:

## Company and actor identity

- Company identity
- User or credential-owner identity
- Relevant role information
- Relevant Team memberships
- Relevant RACI relationship to the target
- The fact that the action is being performed by Mango AI on behalf of the user
- A compact summary of relevant assigned Processes or Workflows where useful

Do not inject full unrelated company data merely because it exists.

## Target identity

- Target type
- Target ID
- Target name
- Relevant parent Workflow or Process context
- Target version or snapshot identity

## SOP/editor content

- The authoritative SOP content for the target Process
- Workflow documentation where a Workflow is being executed and the repository supports it
- The exact authored content required to understand the procedure

Follow Mango’s existing authoritative editor storage convention.

If Mango uses Tiptap, Yjs, JSON snapshots, plaintext projections, or another format, compile from the correct authoritative or server-readable representation.

## Steps

For every applicable Step, include:

- Stable Step identity within the Run snapshot
- Name
- Description
- Authored instructions
- Ordering or graph relationship
- Relevant configuration
- Expected Outputs
- Explicit approval gate where present
- Relevant RACI or assignment information
- Relevant tool hints
- Branch or condition information where already supported

## Overall Process Success Criteria

Include the complete Process-level Success Criteria.

## Job-specific instructions

Include the additional instructions the user entered for this Job.

Clearly distinguish authored Process instructions from Job-specific instructions.

## Company execution policy

Include a clear, model-readable statement of:

- Allowed actions
- Approval-gated actions
- Forbidden actions
- Stop conditions
- Resource limits
- Conflict behavior
- Material-assumption rules
- Commit or review behavior

## Available capabilities and tools

Include:

- Required capabilities
- Resolved tools or MCP integrations
- Allowed actions
- Current scopes
- Relevant action-risk metadata
- Missing capabilities
- Tool-use constraints

Never include credentials, access tokens, refresh tokens, passwords, API secrets, or secret headers.

## Current Run state

As the Run progresses, include the relevant current state:

- Current Step
- Prior Step results
- Node artifacts produced so far
- Relevant Node text boxes
- Relevant attachments
- Relevant tool results
- Pending approvals
- Failed verifications
- Remaining expected outputs

Do not repeatedly inject irrelevant raw logs when a compact structured state is sufficient.

# Exact AI-context visibility

The user must be able to inspect the AI context Mango supplied.

This must not be a vague summary that claims to be the prompt.

Store and display the exact Mango-generated context sent for each Run or model invocation, subject to security redaction.

This may include:

- Mango-authored system instructions
- Mango-authored execution instructions
- Structured target context
- SOP content
- Steps
- Expected Outputs
- Success Criteria
- Job instructions
- Company policy
- Tool definitions
- Tool constraints
- Relevant Run state

The UI must not claim to expose hidden provider-internal prompts that Mango never sees.

Secrets and credential material must be redacted.

A Job-level AI Context tab should show the current compiled preview for the next Run.

A historical Run must preserve the immutable context actually used by that Run.

If the execution engine makes multiple model calls, preserve enough invocation-level context to explain what was sent at each important point.

At minimum, store:

- Initial compiled Run context
- Per-Step context changes where applicable
- Tool results added to later invocations
- Provider and model
- Timestamp
- Redaction status

# Run definition snapshotting

A Run must use a stable snapshot of the authored execution definition it started with.

At Run creation, snapshot or version-reference the relevant:

- Job configuration
- Job-specific instructions
- Process or Workflow definition
- SOP content
- Steps
- Step Expected Outputs
- Process Success Criteria
- Relevant RACI configuration
- Relevant explicit permissions
- Required capability analysis
- Model-selection decision
- Effective execution policy

If the user edits the Process while a Run is active:

- The active Run should continue using the definition it started with.
- The next Run should use the updated definition.
- The UI should make the Run’s definition version inspectable.

Do not allow an in-flight Run’s meaning to silently change because someone edited the SOP.

Live external data retrieved by tools is not part of the authored-definition snapshot and may still change during execution.

Authorization and hard policy restrictions must still be checked at action time. A historical policy snapshot is useful for audit, but it must not let a Run bypass a newly applied hard restriction.

# Capability and MCP requirement inference

The user should not be forced to manually configure a list of MCP servers for every Job.

Mango should infer required capabilities from:

- Process SOP
- Step instructions
- Step Expected Outputs
- Process Success Criteria
- Job-specific instructions
- Explicitly named systems such as Gmail, Airtable, Linear, Slack, or another connected application

Examples:

- “Send the finished report to Alice” implies an email-sending capability.
- “Update the Airtable sales table” implies Airtable read/write access.
- “Create a Linear issue” implies Linear issue-creation access.
- “Check for an email from this sender” implies email search or inbox-read access.

The preferred abstraction is:

Process or Step requirement
→ capability
→ concrete integration or MCP implementation

Do not permanently bind a Process to one particular MCP-server implementation if the same capability can be provided by another supported integration.

For example:

- Capability: email.search
- Capability: email.draft
- Capability: email.send
- Capability: airtable.records.read
- Capability: airtable.records.write
- Capability: linear.issues.create

Mango may then resolve those capabilities to the company’s connected integrations.

If the user explicitly names a system, such as Airtable, preserve that system constraint.

Store inferred requirements as inspectable metadata.

Where useful, record:

- Capability
- Source Step or instruction
- Required or optional
- Confidence
- Resolved integration
- Required scopes
- Connection status

Recompute or mark the capability analysis stale when:

- The SOP changes
- Steps change
- Expected Outputs change
- Success Criteria change
- Job instructions change

The user should see the inferred tool list but should not have to manage it manually in the normal flow.

An advanced correction or override mechanism may be added if it fits existing product patterns.

# Integration-readiness check

Before activating or running a Job, perform a readiness check.

The readiness check must verify:

- Required capabilities were inferred
- A compatible integration or MCP tool exists
- The relevant user or company connection exists
- The connection is healthy
- Required scopes are granted
- The credential owner is still active
- The user can access the target Process or Workflow
- The user may create and execute the Job
- Company policy permits the action class
- Required approvals can be represented
- The model provider is available
- The target has not been deleted or archived
- Resource configuration is valid

Display a clear result such as:

- Ready
- Needs setup
- Missing Gmail connection
- Linear connection lacks write permission
- Credential owner must be reassigned
- Add Step Expected Outputs for stronger verification
- Process Success Criteria are missing
- Job cannot run under current company policy

A missing required capability should block activation or execution rather than allowing repeated predictable failures.

# Credentials and acting identity

Use the user’s delegated integrations by default.

A Scheduled Job must have a clear credential owner or execution identity.

Use existing secure OAuth, vault, or integration-token infrastructure.

Do not:

- Put credentials into prompts
- Store raw credentials in Job instructions
- Let the LLM see access tokens
- Let a Run execute under an ambiguous user
- Continue using credentials after the owner loses authorization

Record actions as:

“Mango AI acting on behalf of [user]”

where the target system and audit model support it.

For each tool action, check:

- Credential owner
- Current connection status
- Current scopes
- Current company membership
- Current target access
- Current tool authorization
- Current approval state

If the credential owner leaves the company, loses permission, disconnects the integration, or has an expired connection:

- Pause or block the Job.
- Do not silently switch to another user’s credentials.
- Show a clear remediation state.
- Allow an authorized administrator to reassign the credential owner.

Architect the system so company-owned service identities could be supported later, but do not invent them in this task unless the repository already has that concept.

# Scheduling

The scheduler owns time-based execution.

When a Scheduled Job becomes due:

1. Acquire an idempotent scheduling lock.
2. Validate that the Job is active.
3. Re-run readiness and authorization checks.
4. Prevent duplicate creation for the same scheduled occurrence.
5. Create one Run.
6. Create or associate the runtime Node.
7. Submit the Run to the execution engine.
8. Record the scheduled time and actual start time.
9. Calculate the next occurrence.
10. Release or persist the appropriate lock state.

Store and respect timezone explicitly.

Use the repository’s existing scheduler or worker system where possible.

Support, at minimum:

- Run now
- One-time future execution
- Recurring execution
- Pause
- Resume
- Disable
- Edit schedule
- View next Run
- View last Run

Do not write a fragile in-process timer if the application already has durable job infrastructure.

The scheduler must tolerate:

- Process restarts
- Worker retries
- Duplicate delivery
- Temporary database failure
- Model-provider failure

Use idempotency keys or equivalent uniqueness protection.

# Overlapping Scheduled Runs

Avoid accidentally starting multiple concurrent Runs of the same Scheduled Job.

A reasonable first-version default is:

- One active Run per Scheduled Job.
- If the next occurrence arrives while the previous Run is still active, do not silently execute both.
- Mark the occurrence as queued, skipped, or blocked according to a clear Job policy.
- Display what happened in the history.

Do not create an unbounded backlog after downtime.

Do not automatically run every missed historical occurrence unless the Job explicitly supports backfill.

# Run lifecycle

Reuse existing status conventions where practical, but preserve these semantics.

A Run may conceptually move through:

- Queued
- Preparing
- Running
- Awaiting Approval
- Awaiting Review
- Blocked
- Failed
- Succeeded
- Cancelled

A Process-level Run should:

1. Create or associate a Node.
2. Place the Node into the first applicable Step.
3. Mark that Step execution as Running.
4. Display an active AI indicator on the Node card.
5. Execute allowed work.
6. Write understandable progress into the Node timeline.
7. Produce a Step result or evidence block.
8. Evaluate the Step Expected Outputs.
9. Remain in the Step if the outputs are not satisfied.
10. Move the Node to the next Step only after the Step is complete.
11. Continue without asking for human approval unless a real gate is reached.
12. Evaluate final Process Success Criteria.
13. Commit, await review, or stage completion according to company policy.
14. Mark the Run Succeeded only when the completion conditions are satisfied.

Do not move the Node visually before the persisted transition succeeds.

Do not treat a frontend animation as the source of truth.

# Node as the AI worktree

Use the existing Mango Node as the user-facing worktree or sandbox for the Run.

This is a conceptual Git-worktree analogy.

Do not add Git as a dependency for company data.

The Node already represents runtime work moving through Process Steps.

Use it as the place where the AI:

- Creates text boxes
- Writes summaries
- Records Step results
- Adds attachments
- Associates relevant emails
- Associates relevant chats
- Produces drafts
- Records proposed actions
- Stores verification evidence
- Displays errors
- Shows approvals
- Shows final outputs

The Node should remain understandable to a normal business user.

Do not force the user to inspect a raw technical log to understand what happened.

Each completed Step should normally produce a clear Node timeline entry or text block containing:

- Step name
- Summary of work
- Outputs produced
- Expected Outputs checked
- Evidence
- Actions taken
- Actions awaiting approval
- Errors or unresolved issues

Use Mango’s existing Node text-box and timeline systems rather than creating an unrelated AI-output document model.

# Live Process Board execution

The user should be able to see AI work happening on the existing Process Board.

When the AI is actively working on a Node:

- Show an AI icon on the Node card.
- Show an animated ring, spinner, or equivalent Mango-style progress indicator around or near the icon.
- Make it clear which Step is currently being executed.
- Persist the real execution state.
- Update through Mango’s existing realtime mechanism.

When the AI finishes a Step:

- Persist the Step completion.
- Move the Node to the next Step.
- Continue the active AI indicator on the new Step if execution continues.

When the Run is Awaiting Approval:

- Stop the active spinner.
- Show an approval or paused state.

When Blocked or Failed:

- Keep the Node in the Step where the issue occurred.
- Show a clear status.
- Add an understandable timeline event.

The user should literally be able to watch the Node move from Step to Step.

Do not create separate AI-only Step columns disconnected from the Process Board.

# Staged internal changes

For Mango-controlled authoritative data, follow a no-untracked-mutations rule.

Every AI-created mutation must be attributable to:

- Company
- Job
- Run
- Node
- Step
- Acting user or credential owner
- Tool or internal action
- Timestamp
- Approval state
- Commit state

Where feasible, authoritative internal changes should be staged as a Run change set rather than immediately mutating committed company state.

The AI should be able to work end-to-end in its Node worktree.

At a Process-level checkpoint, the user or company policy may:

- Commit or apply the staged changes
- Discard the staged changes
- Request modifications
- Approve selected actions
- Reject selected actions

Do not require a commit after every Step.

Discarding a change set must not erase the Run’s audit history.

The Node and structured event record should continue to show:

- What was proposed
- What was discarded
- Why it was discarded
- Who made the decision

Reuse any existing draft, revision, event-sourcing, versioning, transaction, or outbox infrastructure.

Do not build a fake visual “diff” that has no actual persistence semantics.

# Reversibility

Reversibility is an execution-layer property, not something the model should improvise.

For every mutating action, determine whether Mango can:

- Avoid executing it until approval
- Execute it in draft mode
- Stage it internally
- Record the before-state
- Generate a reliable inverse action
- Roll it back transactionally
- Restore a prior version
- Compensate for it
- Not reverse it at all

Where an action is reliably reversible:

- Record the necessary before-state or inverse operation.
- Tie the inverse operation to the Run.
- Make rollback available to authorized users.
- Log the rollback.

Where an action is not reliably reversible:

- Mark it as irreversible.
- Require approval by default.
- Prefer generating a draft or proposal first.
- Clearly explain the side effect to the approver.

Never represent “undo” as guaranteed if the external system cannot actually guarantee it.

# Approval flow

An approval request must be tied to a specific proposed action or Process-level commit.

It should show:

- Job
- Run
- Node
- Current Step
- Proposed action
- Target system
- Acting identity
- Data or content to be sent
- Why approval is required
- Whether the action is reversible
- Expected result
- Relevant diff or preview
- Approve
- Reject
- Edit where supported

Examples:

- Review and send email
- Approve publishing
- Approve deletion
- Approve Process change set
- Approve external customer communication

Approval must be enforced on the backend.

Do not execute the action merely because the frontend displayed an approval modal.

After approval:

- Reauthorize the acting user.
- Recheck the action and target state.
- Execute idempotently.
- Record the result.
- Continue the Run.

After rejection:

- Record the rejection.
- Keep the proposed artifact where appropriate.
- Stop or continue according to the authored Process.
- Do not let the model repeatedly resubmit the same rejected action without new information.

# Bounded discretion and stopping behavior

The AI may use reasonable judgment for minor implementation details that are clearly inside the authored Process.

It must not make material business assumptions on its own.

Examples of material assumptions include:

- Choosing a customer when the identity is unclear
- Inventing a missing amount
- Changing a recipient
- Selecting an unapproved vendor
- Ignoring a discrepancy
- Skipping an Expected Output
- Substituting one external system for another without permission
- Performing an irreversible action without approval
- Redesigning the Process
- Changing company policy
- Expanding the task beyond the Job

When the AI is clearly stuck or detects that something important is wrong:

- Stop.
- Do not continue by inventing an answer.
- Record the issue.
- Keep the Node in the current Step.
- Mark the Run Blocked, Failed, or Needs Attention.
- Notify the appropriate user.
- Provide clear restart or resume options.

Do not implement an aggressive autonomous replanning loop for the first version.

# Retry, resume, and restart

Distinguish these actions.

## Retry a failed action

Retry the same idempotent tool action or verification within the same Run.

Use bounded automatic retries only for clearly transient failures, such as:

- Temporary network timeout
- Rate limit with an allowed retry
- Short provider outage
- Retry-safe database conflict

Do not automatically retry irreversible actions without idempotency protection.

## Resume a Run

Continue the same Run from its blocked or failed Step after:

- The user supplies missing information
- An approval is granted
- A missing connection is repaired
- A conflict is resolved
- The user chooses to continue

Preserve the prior Run history and create a new attempt or checkpoint record.

## Restart from scratch

Create a new Run for the same Job.

Do not erase or mutate the previous Run.

Link the history sufficiently for the user to understand that the new Run was a restart, using the repository’s normal audit conventions.

A user should be able to:

- Inspect where the prior Run failed
- Restart the whole Job
- Resume from the current Step where safe
- Cancel the Run
- Discard staged changes

# Conflicts

Use a conservative first-version conflict policy.

If two Runs or a Run and a human modify the same authoritative record:

- Do not silently use last-write-wins.
- Detect the stale version using optimistic concurrency, revision IDs, hashes, timestamps, or existing repository conventions.
- Stop the affected commit or action.
- Record the conflict.
- Show the user what changed.
- Require an explicit resolution, refresh, rebase, or retry.

Internal staged change sets may coexist before commit.

Conflict detection must happen before applying the authoritative change.

The model must not choose a winner by itself when resolving a material data conflict.

# Resource limits

Every Run must have bounded resource usage.

Create or reuse company-level defaults for:

- Maximum wall-clock duration
- Maximum model tokens
- Maximum model cost
- Maximum model invocations
- Maximum tool calls
- Maximum action count
- Maximum retries
- Maximum consecutive failures
- Maximum nested Workflow or child-Run depth where applicable
- Maximum concurrent Runs
- Maximum concurrent Runs per Job

A Job may set stricter limits where supported.

A normal user must not exceed company or platform hard limits without authorization.

When a limit is reached:

- Stop execution safely.
- Do not loop forever.
- Record which limit was reached.
- Keep all completed work and evidence.
- Mark the Run Blocked or Failed according to existing conventions.
- Let an authorized user inspect and restart or resume with updated limits.

# Structured system event log

The Node timeline is the primary user-facing execution story.

However, mutable Node text boxes must not be the only system record.

Create or reuse a structured append-only execution event log in the database.

Structured events should cover, as applicable:

- Run created
- Run queued
- Run started
- Node created
- Step entered
- Model invocation started
- Model invocation completed
- Tool requested
- Tool authorized
- Tool blocked
- Tool completed
- Tool failed
- Output produced
- Expected Output evaluated
- Step completed
- Approval requested
- Approval granted
- Approval rejected
- Change staged
- Change committed
- Change discarded
- Conflict detected
- Run blocked
- Run resumed
- Run restarted
- Run failed
- Run succeeded
- Run cancelled
- Rollback attempted
- Rollback completed
- Resource limit reached

Store structured metadata rather than only formatted strings.

The Node timeline should display a human-readable projection or selected view of these events.

Raw debugging details may be expandable, but the normal experience should remain understandable.

# Run observability

For every Run, preserve enough information to answer:

- Which Job created this Run?
- Was it manual, one-time, scheduled, restarted, or resumed?
- Which Process or Workflow version did it use?
- Which Node or Nodes were associated?
- Which user’s authority was used?
- Which provider and model were used?
- Which prompt and context did Mango provide?
- Which capabilities and tools were available?
- Which tools were called?
- Which actions were blocked?
- Which approvals were requested?
- Which Steps completed?
- Which Expected Outputs were satisfied?
- What evidence supported completion?
- What failed?
- How long did the Run take?
- How many tokens and tool calls were used?
- What did it cost where provider usage is available?
- Were changes committed, rejected, discarded, or rolled back?
- Why was the Run marked successful?

# Jobs management UI

Add or reuse a Jobs management surface associated with the existing Process or Workflow UI.

Do not create a new left sidebar.

Do not make the Job detail experience a right-hand sidebar.

The user should be able to see multiple Jobs and Scheduled Jobs as rows.

A reasonable row includes:

- Job name
- Target
- Job or Scheduled Job type
- Schedule
- Status
- Readiness
- Last Run
- Last Run result
- Next Run
- Owner or credential owner
- Required-tool warning where relevant

Clicking a Job row should open a compact modal or pop-up.

It should not replace the entire application unless the existing design system strongly requires a full detail page.

It should not slide in as a sidebar.

Use progressive disclosure so most users see only the important information.

# Job detail modal

The Job detail modal should use tabs.

At minimum, support:

## Overview

Show:

- Job name
- Target Process or Workflow
- Job-specific instructions
- Manual, one-time, or scheduled status
- Schedule
- Timezone
- Active, paused, or needs-setup state
- Creator
- Credential owner
- Company-policy summary
- Resource-limit summary
- Last Run
- Next Run
- Run now
- Pause or resume
- Edit
- Disable

## AI Context

Show:

- Current compiled-context preview for the next Run
- Company and actor context
- SOP content included
- Steps included
- Step Expected Outputs
- Process Success Criteria
- Job-specific instructions
- Effective company AI policy
- Required capabilities
- Resolved integrations or MCP tools
- Missing connections
- Model and provider selection where known
- Redaction notices
- Context version

The normal user does not have to inspect this tab, but the system must be transparent and debuggable.

## Run History

Show one row per Run.

At minimum:

- Run ID
- Trigger type
- Scheduled time
- Start time
- End time
- Duration
- Status
- Current or failed Step
- Associated Node
- Provider and model
- Token or cost information where available
- Approval count
- Tool-call count
- Error summary
- Commit, discard, or rollback state

Selecting a Run should show:

- Exact Run context snapshot
- Step-by-Step history
- Node link
- Tool actions
- Approvals
- Expected Output evidence
- Final result
- Error details
- Restart
- Resume where allowed

## Performance

Where sufficient history exists, show simple metrics such as:

- Success rate
- Verified-success rate
- Average duration
- Average model usage
- Average cost where available
- Failure count
- Approval frequency
- Most common failed Step
- Most common missing capability

Keep this secondary and unobtrusive.

# Node affiliation

Every Process-level Run must make its associated Node easy to locate.

The Job detail and Run history should link directly to the Node.

The Node should expose the fact that it was created or operated by:

- Job
- Scheduled Job where applicable
- Run
- Model provider
- Acting user

Use the existing Node detail experience.

If Mango already supports tabs inside a Node, add or reuse an appropriate AI Run or Execution tab.

Do not redesign the entire Node UI for this task.

The Node’s normal timeline should still show the user-facing work.

# Node timeline presentation

The Node timeline should make AI execution understandable without showing every low-level token or raw protocol message.

Human-readable timeline entries may include:

- “AI began Validate Purchase Order.”
- “Airtable connection checked.”
- “Purchase-order number extracted.”
- “Order total matched the source document.”
- “Draft confirmation email created.”
- “Waiting for approval to send email.”
- “Email approved by Alice.”
- “Email sent.”
- “Step completed.”
- “Run stopped because the customer record could not be identified.”
- “Run resumed by Bob.”
- “Changes discarded.”

Where useful, let a user expand an event to see:

- Tool
- Request summary
- Result summary
- Model invocation
- Structured metadata
- Related attachment
- Before-and-after values
- Approval record

Do not display secrets or unnecessary raw payloads.

# Notifications

Use existing Mango notification infrastructure.

Notify the relevant user or assignee when a Run:

- Needs approval
- Becomes blocked
- Fails
- Reaches a resource limit
- Needs a repaired connection
- Detects a conflict
- Completes where notification is configured

Avoid excessive notifications for normal Step transitions.

Respect user and company notification settings.

# Authorization

Add backend authorization checks for all Job and Run operations.

At minimum, verify:

- User may view the target
- User may create a Job for the target
- User may edit or disable the Job
- User may activate a Scheduled Job
- Credential owner may access the target
- Credential owner may use the required integration
- User may inspect the Run context
- User may view the associated Node
- User may approve the proposed action
- User may commit or discard staged changes
- User may restart or resume
- User may change company AI policy
- User may view raw technical execution details

“All content the user can see” must still respect permissions.

A Job must not become a way to execute against a Process the user cannot otherwise access.

Reauthorize important actions at execution time rather than relying only on the permissions that existed when the Job was created.

# Suggested backend architecture

Reuse existing names and services where possible.

Conceptually, the implementation should have centralized services for:

- Job management
- Scheduling
- Readiness analysis
- Capability inference
- Context compilation
- Run creation
- Run execution
- Step execution
- Tool authorization
- Approval handling
- Change-set staging
- Commit and discard
- Conflict detection
- Resource accounting
- Provider abstraction
- Event logging
- Node projection
- Notifications

Do not duplicate Run execution logic across API controllers, scheduler handlers, and UI-triggered “Run now” paths.

All trigger paths should converge on the same Run-creation and execution service.

# Suggested data concepts

Follow the existing schema and avoid parallel tables where equivalent records already exist.

The following are conceptual requirements, not mandatory table names.

## Job record

May include:

- ID
- Company ID
- Target type
- Target ID
- Name
- Job-specific instructions
- Job type
- Status
- Creator ID
- Credential-owner ID
- Schedule configuration
- Timezone
- Next Run time
- Last Run time
- Model policy
- Resource limits
- Approval overrides
- Definition version
- Created at
- Updated at

## Capability requirement

May include:

- Job ID
- Capability
- Source Process, Step, or instruction
- Required or optional
- Resolved integration
- Required scope
- Status
- Confidence
- Analysis version

## Run record

May include:

- ID
- Job ID
- Company ID
- Trigger type
- Scheduled occurrence
- Node ID
- Parent Run ID where Workflow orchestration needs it
- Status
- Current Step
- Definition snapshot
- Context snapshot
- Provider
- Model
- Acting-user ID
- Credential-owner ID
- Started at
- Ended at
- Usage
- Cost
- Error
- Success evaluation
- Commit state
- Created at

## Run Step or Step Attempt

May include:

- Run ID
- Snapshotted Step identity
- Source Step ID
- Attempt number
- Status
- Started at
- Ended at
- Expected Outputs
- Verification evidence
- Error
- Model usage

## Run event

Append-only structured event.

## Run action or change

May include:

- Run ID
- Node ID
- Step
- Tool
- Target
- Action type
- Internal or external
- Read or write
- Reversible status
- Risk level
- Before-state
- Proposed after-state
- Inverse operation
- Approval requirement
- Execution status
- Idempotency key

## Approval

May include:

- Run action
- Requested from
- Requested by
- Status
- Reason
- Preview
- Decision maker
- Decision timestamp
- Decision note

## Company AI policy

May include:

- Company ID
- Autonomy preset
- Action-policy configuration
- Default resource limits
- Default commit behavior
- Model policy
- Policy version
- Updated by
- Updated at

Use stable IDs.

Do not use array positions as durable identities.

Use transactions where partial state would be dangerous.

# Realtime behavior

Use Mango’s existing realtime or collaboration system.

Live updates should propagate for:

- Run status
- Current Step
- Node movement
- AI activity indicator
- Approval request
- Approval decision
- Tool status
- New Node timeline entries
- Completion
- Failure
- Conflict
- Resource-limit stop

Protect against stale clients overwriting newer Run state.

Use server-authoritative transitions.

# Failure atomicity

Where a single internal action requires multiple database writes, use a transaction.

Do not leave:

- A Run without its required Job association
- A Process Run without its Node
- An approval without its action
- An action marked completed when its mutation rolled back
- A Step marked complete when its evidence failed to persist
- A committed change set with partial changes
- A scheduler occurrence that produces duplicate Runs
- A Run context snapshot that does not match the execution

External systems cannot always participate in database transactions.

For external actions:

- Use idempotency where supported.
- Record intent before execution.
- Record the external request identifier.
- Record the result after execution.
- Use reconciliation for uncertain outcomes.
- Do not blindly retry an action whose outcome is unknown.

# Example acceptance scenario

Implement and verify the following scenario.

## Authored Process

A user has a Process called:

“Fulfill Costco Sales Order”

The Process contains:

- A main SOP
- Several Steps
- Expected Outputs for each Step
- Overall Process Success Criteria
- RACI assignments
- Permissions

Example Steps:

1. Receive sales order
2. Validate sales order
3. Enter order into Airtable
4. Create Linear follow-up if needed
5. Prepare confirmation email
6. Confirm completion

Example Expected Outputs:

### Receive sales order

- Source order is attached to the Node.
- Purchase-order number is extracted.
- Customer is identified as Costco.

### Validate sales order

- Required fields are present.
- Totals match.
- Any discrepancy is recorded.

### Enter order into Airtable

- Airtable order record exists.
- Returned record ID is stored.
- Entered values match the validated order.

### Create Linear follow-up if needed

- A Linear issue exists when a discrepancy requires follow-up.
- The Linear issue is linked in the Node.

### Prepare confirmation email

- A complete email draft exists.
- Recipient and order number are visible.
- No email has been sent without authorization.

### Confirm completion

- Final Node summary exists.
- All Process Success Criteria have been evaluated.

Overall Process Success Criteria:

- The Costco order is valid.
- The Airtable order record exists.
- Any required Linear issue exists.
- The confirmation email has been handled according to company policy.
- The Node contains the final summary and supporting evidence.
- No unresolved discrepancy remains.

## Create a Scheduled Job

From the Process, the user creates:

“Daily Costco Order Fulfillment”

Job-specific instructions:

“Check for new Costco orders received since the previous successful Run. Process every valid order. Notify the Operations Manager if an order is incomplete.”

Schedule:

“Every weekday at 8:00 AM”

Mango should:

- Read the Process SOP.
- Read all Steps.
- Read Step Expected Outputs.
- Read Process Success Criteria.
- Include the Job-specific instructions.
- Infer email, Airtable, and Linear capabilities.
- Check the user’s connected integrations.
- Show missing connections or scopes.
- Compile a transparent AI-context preview.
- Activate the Scheduled Job only when ready.

## Scheduled execution

At the next scheduled time:

- The scheduler creates exactly one Run.
- The Run creates the appropriate Node.
- The Node appears in the first Process Step.
- The Node card shows the active AI indicator.
- The Node timeline records progress.
- The AI executes allowed Steps without requesting approval at every Step.
- The Node moves visibly between Steps.
- Step Expected Outputs are evaluated.
- Airtable and Linear actions follow tool-risk and company-policy rules.
- The email is prepared as a draft.
- Sending the email requires approval under the default Balanced policy.
- The user sees the proposed recipient and content.
- After approval, the email is sent idempotently.
- The Process Success Criteria are evaluated.
- The Run is marked successful only after the required conditions are satisfied.
- The Job history links to the Node.
- The history shows duration, status, exact context, tools, approvals, and result.

## Failure scenario

During a later Run, the AI cannot identify which Costco account applies.

It must:

- Stop in the current Step.
- Not guess.
- Record the ambiguity in the Node.
- Mark the Run Blocked or Needs Attention.
- Notify the appropriate user.
- Allow the user to provide the missing information.
- Resume the same Run from the blocked Step.
- Preserve all prior history.

## Restart scenario

The user decides the failed Run’s work is unusable.

The user chooses Restart from scratch.

Mango must:

- Preserve the previous Run.
- Create a new Run.
- Create or associate the correct new runtime Node according to existing semantics.
- Use the current Process and Job versions.
- Make the restart relationship inspectable.
- Not silently overwrite the previous history.

## Discard scenario

The AI produces poor internal changes.

The user chooses Discard.

Mango must:

- Leave authoritative company state unchanged.
- Mark the staged change set discarded.
- Preserve the Node and execution history.
- Show what was discarded.
- Not pretend the Run never occurred.

# Required tests

Add or update tests for at least the following behaviors.

1. Creating a Job from a Process.
2. Creating a Scheduled Job from a Process.
3. Creating a one-time Job.
4. Running a Job manually.
5. Pausing and resuming a Scheduled Job.
6. Editing a schedule and timezone.
7. A scheduler occurrence creates one Run.
8. Duplicate scheduler delivery does not create duplicate Runs.
9. A Run is linked to its Job.
10. A Process-level Run is linked to its Node.
11. The Node begins in the correct first Step.
12. The AI activity indicator reflects persisted Run state.
13. The Node moves only after Step completion persists.
14. Step Expected Outputs are included in compiled context.
15. Process Success Criteria are included in compiled context.
16. SOP/editor content is included in compiled context.
17. Job-specific instructions are included in compiled context.
18. Company AI policy is included in compiled context.
19. Relevant user and company identity are included.
20. Credentials and secrets are not included.
21. Required capabilities are inferred from Process instructions.
22. Explicitly named tools such as Airtable or Linear are honored.
23. Missing integrations produce Needs Setup.
24. Missing required scopes block execution.
25. Capability requirements refresh after Process or Job edits.
26. The current compiled preview is visible on the Job.
27. A Run preserves the exact context it used.
28. Editing the Process does not change an active Run’s snapshot.
29. The next Run uses the updated Process definition.
30. Provider and model are stored per Run.
31. Provider-specific adapters use the common execution interface.
32. The backend blocks a forbidden tool action even if the model requests it.
33. Balanced policy does not require approval at every Step.
34. An irreversible external action requires approval by default.
35. A draft can be created before approval.
36. Approval is reauthorized on the backend.
37. Rejection prevents execution.
38. A reversible action records its inverse or before-state where supported.
39. Internal mutations are attributable to the Run.
40. Staged internal changes can be committed.
41. Staged internal changes can be discarded.
42. Discarding changes preserves Run history.
43. A failed Step keeps the Node in that Step.
44. Material ambiguity stops the Run rather than being guessed.
45. Resume continues the existing Run.
46. Restart creates a new Run.
47. Retry is bounded.
48. An irreversible uncertain external action is not blindly retried.
49. Resource limits stop a runaway Run.
50. Concurrent conflicting writes do not silently use last-write-wins.
51. A conflict produces an inspectable blocked state.
52. Expired credentials pause or block the Job.
53. A removed credential owner cannot continue executing.
54. An authorized administrator can reassign the credential owner.
55. The Node timeline receives human-readable events.
56. Structured Run events persist independently of mutable text boxes.
57. Run history links to the associated Node.
58. Run history displays status and duration.
59. Run history displays the exact redacted context.
60. Run history displays approvals and tool actions.
61. Job-row selection opens a compact modal or pop-up.
62. Job-row selection does not open a new sidebar.
63. The modal contains Overview, AI Context, and Run History tabs.
64. Performance metrics are calculated correctly where implemented.
65. One active Run per Scheduled Job is enforced by default.
66. Missed schedules do not create an uncontrolled backlog.
67. Authorization prevents unauthorized Job creation.
68. Authorization prevents unauthorized Run inspection.
69. Authorization prevents unauthorized approval.
70. Process or Workflow deletion safely pauses or invalidates its Jobs.
71. The implementation reuses existing Process, Step, SOP, Node, RACI, and permission models.
72. The implementation does not create a duplicate Company Explorer.
73. The implementation does not modify the independent Process/Workflow deep-copy semantics.
74. Database failures do not leave half-created Runs or orphaned approvals.
75. External-action idempotency prevents duplicate side effects.

# Primary acceptance checklist

The implementation is complete when:

1. A user can open a Process and create a Job.
2. The user does not have to rewrite the Process SOP or Steps.
3. The user can add Job-specific instructions.
4. The user can make the Job manual, one-time, or scheduled.
5. A Scheduled Job stores a clear schedule and timezone.
6. Mango infers required capabilities and tools.
7. Mango checks connected integrations and scopes.
8. Missing requirements are displayed before execution.
9. Mango compiles the Process SOP into the Run context.
10. Mango compiles every relevant Step.
11. Mango compiles each Step’s Expected Outputs.
12. Mango compiles the Process Success Criteria.
13. Mango compiles the Job-specific instructions.
14. Mango compiles the company AI policy.
15. Mango does not expose credentials to the model.
16. The Job works through a provider-neutral model interface.
17. A scheduled occurrence creates exactly one Run.
18. A Process-level Run creates or associates the correct Node.
19. The Node appears in the correct Process Step.
20. An AI activity indicator appears on the Node card while active.
21. The Node visibly moves Step by Step.
22. Step Expected Outputs control Step completion.
23. Process Success Criteria control final success.
24. The AI does not ask for approval at every Step by default.
25. Company policy controls autonomy.
26. The backend enforces policy independently of the prompt.
27. Irreversible external actions require approval by default.
28. Internal work can be staged inside the Node worktree.
29. Staged work can be committed or discarded.
30. Discarding work does not erase history.
31. Reversible actions record rollback information where supported.
32. Material ambiguity stops the Run.
33. The user can resume a blocked Run.
34. The user can restart from scratch as a new Run.
35. Conflicts stop rather than silently overwrite data.
36. Resource limits stop runaway execution.
37. The Node timeline shows understandable execution history.
38. A structured system log exists underneath the Node presentation.
39. Jobs and Scheduled Jobs appear as rows.
40. Clicking a row opens a compact modal, not a sidebar.
41. The modal shows Overview, AI Context, and Run History.
42. Each historical Run links to its Node.
43. Each historical Run preserves its actual compiled context.
44. Each Run records provider, model, timing, status, and usage where available.
45. The architecture remains independent of the separate Process Map and Workflow-copy implementation.

# Technical requirements

- Reuse existing scheduler and worker infrastructure.
- Reuse existing model-provider integrations where possible.
- Reuse existing MCP and integration infrastructure.
- Reuse existing Node and Process Board realtime behavior.
- Reuse existing SOP/editor storage.
- Reuse existing RACI and permissions.
- Reuse existing event, audit, outbox, or notification infrastructure.
- Use stable database IDs.
- Use durable scheduling.
- Use idempotency.
- Use database transactions where appropriate.
- Add backend authorization checks.
- Reauthorize sensitive actions at execution time.
- Keep secrets outside model context.
- Store exact redacted Run context.
- Use server-authoritative state transitions.
- Prevent duplicate Runs.
- Prevent duplicate external side effects.
- Prevent unbounded retries.
- Prevent silent last-write-wins conflicts.
- Preserve active-Run definition snapshots.
- Persist resource usage.
- Persist Run history.
- Persist structured events.
- Persist Node associations.
- Provide frontend loading, error, blocked, and retry states.
- Follow keyboard-accessibility and focus-management conventions for the modal.
- Avoid adding a large dependency without a strong reason.
- Preserve existing data.
- Avoid destructive migrations.
- Do not create only static mockups.
- Do not place execution logic solely in the frontend.
- Do not make prompts the authorization boundary.
- Do not build a generalized autonomous-agent framework beyond the requirements above.
- Do not build automatic company-wide Process inference.
- Do not redesign Mango’s Node concept.
- Do not reimplement the Process Map, Workflow Canvas, Company Explorer, or deep-copy system.

# Final deliverables

After implementation, provide:

1. A concise summary of the existing AI, Process, Step, SOP, Node, scheduler, tool, integration, and event architecture you found.
2. The implementation approach selected.
3. The exact definitions of Job, Scheduled Job, and Run.
4. How Jobs target Processes and Workflows.
5. How Job-specific instructions work.
6. How the Context Compiler works.
7. The exact context included by default.
8. How Run definition snapshotting works.
9. How Step Expected Outputs are stored and evaluated.
10. How Process Success Criteria are stored and evaluated.
11. How required capabilities and MCP tools are inferred.
12. How integrations are resolved and checked.
13. How credentials remain outside the prompt.
14. How provider-neutral model execution works.
15. How company-level autonomy policy works.
16. How backend policy enforcement works.
17. How approvals work.
18. How the Node acts as the user-facing worktree.
19. How internal changes are staged, committed, and discarded.
20. How reversible and irreversible actions differ.
21. How the Process Board shows live AI progress.
22. How the Node moves between Steps.
23. How failures, retries, resumes, and restarts work.
24. How conflicts are detected.
25. How resource limits are enforced.
26. How the Node timeline and structured event log relate.
27. How the Jobs list and compact detail modal work.
28. How historical Runs expose their exact context and associated Node.
29. The database and migration changes.
30. The primary backend files changed.
31. The primary frontend files changed.
32. The tests added or updated.
33. The commands run and their results.
34. A manual walkthrough of the Costco Scheduled Job scenario.
35. A manual walkthrough of an approval-gated external action.
36. A manual walkthrough of a blocked Run and resume.
37. A manual walkthrough of restart and discard.
38. Any assumptions or remaining limitations.
39. Any areas where the existing codebase prevented an exact implementation.
40. Confirmation that the separate Process Map and Workflow-copy systems were not reimplemented.

Do not merely write a plan.

Implement the real Job, Scheduled Job, Run, Context Compiler, provider abstraction, capability inference, readiness checks, company AI policy, approval enforcement, Step verification, Process Success Criteria, Node execution, live Step progression, worktree-style staging, Run history, and observability vertical slice inside the actual Mango codebase.

````
<!-- END VERBATIM ORIGINAL PROPOSAL -->
