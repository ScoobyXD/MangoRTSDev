# v1 Mango MCP

Date: 2026-09-02

Status: approved implementation brief and conversation context. This document does not claim that an MCP server, OAuth connection, or any tool described below has already been implemented.

## 1. Latest agreed scope takes precedence

This section records Jonat's final instructions. It overrides broader ideas discussed earlier in the conversation.

1. Build the smallest useful Mango MCP that works through regular ChatGPT's connection system.
2. Use ChatGPT's connection system to hold credentials. Never put a reusable token in a prompt, memory, `AGENTS.md`, a skill, or a plugin manifest.
3. Reuse Mango's existing users, company memberships, permissions, resource identities, relationships, and business behavior. Do not create AI users or a parallel permission system.
4. Implement the necessary delegated authentication, token safety, connection lifecycle, and enterprise-relevant access controls. Security is not the part to omit for speed.
5. Expose a small set of basic, safe CRUD operations, not the entire application in this first version. CRUD means create, read, update, and delete according to the existing product's rules.
6. Make exposed mutations safe to retry. Do not promise an operation succeeded until its actual outcome is known.
7. Upgrade the Go toolchain and relevant repository build/test configuration to **Go 1.27.1**, the stable release explicitly selected by Jonat.
8. **If a candidate tool depends on browser execution, frontend coordination, or business/security behavior trapped in an HTTP handler that is not safely reusable, skip it and explicitly document why.**
9. **Do not fix that eligibility problem in this worker.** Do not extract or refactor those handlers, copy their validation, chain hidden API calls, automate clicks, write directly to storage, or introduce another workaround to make the tool appear supported.
10. Do not build a new concurrent-editing system or a new human-approval system. Preserve existing protections; skip operations that cannot safely work within them.
11. File transfers remain part of the full product vision but are deferred from this first implementation. Full application CRUD, broad browser/HTTP cleanup, autonomous exception handling, and background agents are also deferred.
12. The implementation worker must create **`docs/tests/ai mcp.md`** for the actual tool inventory, explicit omissions, and current numbered business-logic laws. Do not put that document in `docs/tasks`.
13. A second, independent worktree must comprehensively investigate browser-owned business behavior and produce a report. It must not fix the application.
14. Keep the existing app working. Prefer a smaller honest tool surface over unsupported tools, duplicated rules, speculative abstractions, or unsafe access.

Ordinary HTTP transport is not itself a defect: MCP is an API protocol and the existing browser uses APIs. The exclusion concerns business behavior or authorization that cannot be reused correctly without the deferred handler/browser refactor.

### Authorized sequence and ownership

1. The launcher creates this context document, commits only the intended documentation change to `main`, and pushes it.
2. Only after that push succeeds, it creates two separate user-visible Codex app tasks in new worktrees starting from the updated `main`.
3. Worker A owns minimal MCP/authentication, eligible basic tools, Go 1.27.1, tests, and `docs/tests/ai mcp.md`.
4. Worker B owns a documentation-only browser-business-behavior audit at `docs/importanttasks/browser-owned-business-behavior-audit.md`.
5. Each worker commits only its intended implementation or report in its own worktree and reports its branch, commit, verification, remaining setup, and limitations.
6. Neither worker merges into `main`, pushes a branch, opens a pull request, or hands work back into the local checkout without a later explicit request.
7. After creating both tasks, the launcher stops. It does not duplicate their work, poll their progress, or integrate their changes.

Follow the repository's `AGENTS.md`, including the branch-naming helper as the first command in each worker, the required model/reasoning/speed settings, Windows test rules, and all secret/database/cloud restrictions.

## 2. Why Mango is making this shift

Mango's management-technology work began with daily Quality/Cost/Delivery scorecards, red/yellow/green conditions, and Action Items that resurface commitments at later meetings. The concern was that a scorecard and an action list alone can be reproduced in a spreadsheet.

The existing product is more substantial than those two screens. It represents departments and nested Processes, work moving through Process boards, assignments, related work, a Process Map, daily scorecards, and management follow-through.

The earlier discussion explored a complete management-response loop:

`expected condition -> signal -> diagnosis -> human routing or authorized action -> execution -> verification -> history and learning`

That discussion included detecting abnormalities, identifying impact and dependencies, containing damage, obtaining decisions, escalating to the right human, resolving a problem, checking that it was genuinely resolved, reviewing recurrence, and updating standards. It also distinguished an immediate fix from a durable countermeasure.

Detection was identified as difficult. Physical problems need observable data or human reports; an agent cannot discover an uninstrumented factory failure by reasoning alone. Digital observation also requires actual data access and triggers. A permanent agent with access to every email and Slack message is neither a prerequisite nor the approved first implementation.

Jonat's decisive change was: let users bring an agent that can actually perform work, and make Mango the structured work environment that agent can read and operate. The analogy is a coding agent navigating a repository: Mango's Processes, Nodes, instructions, assignments, and relationships provide the context for a user's request.

The intended division is:

- The external agent supplies reasoning and uses available tools to execute work.
- Mango supplies current business context, permitted operations, shared state, and records of what actually happened.
- Exception detection becomes one possible later agent task, rather than a prerequisite for every useful workflow.

MCP supplies access and a tool protocol; it does not itself provide compute, an always-running worker, or authority over unrelated external systems. Reading a Process and posting a note is not proof that a shipment, account change, or email send actually occurred.

The earlier pasted ChatGPT suggestions are historical context, not permission to add a new exception object, automatic QCD inference, a graph engine, more dashboards, a recurrence platform, or a management ontology in v1. Existing product laws remain authoritative.

## 3. Intended user experience

### One-time connection

1. The user installs or enables the Mango plugin/connection in a supported ChatGPT account or workspace.
2. The user selects Connect Mango.
3. The user signs into the existing Mango account through the trusted login provider and authorizes the requested access.
4. ChatGPT's connection system obtains and holds the credentials outside model-visible conversation content.
5. Subsequent eligible chats use that connection without copying a token into each prompt.

Initial developer-mode setup and public/private plugin distribution are different stages. A developer test may require explicitly attaching the connection. The intended installed-plugin experience is a normal request in regular Chat, with optional explicit `@Mango` invocation when useful. Actual availability depends on the user's account, workspace policies, and current OpenAI support; verify the real target surface instead of claiming universal availability.

### Day-to-day work

An illustrative future request is: "Find my overdue procurement work and create an Action Item for each blocked order." The agent finds relevant permitted records, resolves exact identities, invokes supported operations, and reports actual results. A request is supported only to the extent that the implemented tool inventory says it is supported.

ChatGPT should not need a custom Mango chatbot, a custom GPT as a substitute, ChatGPT Work, Codex, a user-supplied OpenAI API key, or a Mango-hosted model to perform the core regular-Chat workflow.

### The browser is independent

- ChatGPT calls Mango through MCP APIs. It does not click, type, scrape, or drive the user's Mango browser.
- The browser is another independent client of the same Mango backend. It uses its own login session.
- The user can continue editing while the agent operates, or close the browser entirely.
- Committed agent changes should appear through the same existing realtime path used for other clients.
- This is one Mango user acting through another authorized application, not a second AI account impersonating a different employee.
- The browser and MCP must address the same environment and company context for their state to match.
- A cloud ChatGPT client cannot directly access the laptop's `localhost`. Development requires a properly protected reachable endpoint or supported development tunnel. Public distribution requires the supported stable deployment arrangement.

## 4. Components and how each side knows the other

### Mango plugin/connection description

The plugin describes Mango, its server URL, available capabilities, and usage instructions. It contains no universal customer credential. Installing it makes a capability available; connecting an account supplies a particular user's authorization.

### ChatGPT host versus model

The model chooses a tool and supplies its business arguments. ChatGPT's host/connection system performs the network call and attaches credentials. Do not teach the model to retrieve, print, remember, or manually inject access tokens.

The model can see returned business data needed for the task. It does not need the credential, and Mango should not return it in normal results or supposedly hidden metadata. OpenAI's exact internal credential-storage implementation is not something Mango implements or should invent claims about.

### Existing login provider

Mango uses Cognito. Preserve the existing identity provider and stable user mapping when practical. The authorization server is the service that authenticates the person and issues tokens; the MCP server is the service that accepts appropriately scoped access tokens and performs business operations.

### Existing Mango identity

The verified login subject maps to the same Mango user that the browser uses. Do not match accounts solely by display name or by a caller-provided email. Do not create a per-agent account, per-chat user, copied company membership, or second resource-permission model.

Keep three meanings separate:

- User: the existing Mango user derived from trusted authentication.
- Client: the application for which the authorization was issued, such as the configured ChatGPT client.
- Request: one server-correlated operation.

Optional conversation/run identifiers can group records or assist diagnostics. They are not authority. Neither an MCP transport session ID nor caller-provided `clientInfo`, `agent_name`, `user_id`, or an anonymous host hint proves Mango permissions.

ChatGPT recognizes Mango through the configured secure server address and authentication discovery. Mango verifies the trusted issuer and token claims. A verified application claim identifies the application for which the token was issued; a copied bearer token can still be used by its holder. OpenAI-managed client certificates can add platform-level verification if required, but do not replace user authorization or require a new AI identity.

## 5. Authentication requirements

Use maintained libraries and established provider functionality. Do not hand-roll an OAuth authorization server or introduce another identity platform merely to avoid verifying the current provider's capabilities.

### Authorization code and PKCE, in plain language

1. ChatGPT starts account linking and creates a random secret for that login attempt.
2. It sends a one-way fingerprint of that secret with the authorization request.
3. The user signs into Mango's trusted login system; the password is not given to the model.
4. The login system redirects back to the exact approved ChatGPT callback with a short-lived, single-use authorization code.
5. ChatGPT exchanges that code and the original random secret at the token endpoint.
6. The provider checks that the secret matches the earlier fingerprint and issues credentials.
7. ChatGPT's connection system supplies the access token on subsequent MCP requests.

PKCE means Proof Key for Code Exchange. It protects an intercepted authorization code from being redeemed without the matching secret. It does not make a later stolen access token harmless. Use the required S256 method and proper request/callback correlation, not a simplified home-made version.

### Discovery metadata

Discovery metadata is public machine-readable connection information, not a secret. The MCP resource describes its canonical identifier, trusted authorization server, and supported scopes. The authorization server describes its issuer, sign-in endpoint, token endpoint, supported methods, and public verification-key location.

Requirements to verify against current official OpenAI and MCP documentation:

- Protected-resource metadata and correct authentication challenges.
- Authorization-server discovery with the exact expected issuer.
- S256 advertised in `code_challenge_methods_supported`, not merely supported by an undocumented endpoint.
- Authorization-code flow and a supported client-registration method.
- Exact redirect URI copied from the actual ChatGPT integration configuration; no invented callback or wildcard redirect.
- Correct callback issuer validation where supported; do not advertise issuer-response support that the provider does not implement.
- The canonical `resource` value carried through authorization/token requests and enforced as the access-token audience.
- Correct per-tool authentication metadata and reauthorization errors so ChatGPT can show account linking when necessary.

A predefined OAuth client is a possible minimal first-client configuration if the actual ChatGPT setup supports it. Do not add dynamic registration, client-metadata machinery, or multiple providers solely for hypothetical future clients. Standard MCP interoperability remains the long-term direction; ChatGPT is the first client to prove.

### Access tokens and validation

Cognito uses signed JSON Web Tokens, commonly called JWTs. A signature proves issuance and integrity, not that consent still exists. Signed is not encrypted: avoid unnecessary personal data in token contents.

The MCP boundary must validate signature, trusted issuer, expected access-token type, allowed client, intended MCP audience, expiry/not-before, and required scopes. Do not accept a browser ID token as an MCP access token or reuse the current SPA validation policy unchanged.

After token validation, resolve the existing Mango user and current company membership and resource permissions. Private MCP execution must fail closed when authentication configuration is absent or invalid. Existing isolated auth-disabled development/testing behavior must not become a remotely exposed MCP bypass.

Every company-owned tool identifies its company explicitly and verifies resource/company consistency. Do not use one mutable server-wide "current company" or rely on a browser session-storage selection. If a grant promises restriction to one company, enforce that restriction in trusted authorization state, not just an argument or URL.

### Scopes are a cap, not replacement permissions

Minimal v1 candidates are `mango.read` and `mango.write`; exact provider-compatible names must be documented. Read means permission to request reads, and write means permission to request eligible mutations. Existing Mango access must also allow the particular operation.

`allowed operation = valid active connection + appropriate scope + current company/resource permission + existing business rules`

Future external sending and permission-administration tools may need separately consented categories such as `mango.send` and `mango.admin`. These were discussed as enterprise safeguards, not instructions to expose email sending or admin operations in this first tool set.

### Expiry, refresh, reconnect, and disconnect

- An access token is presented to Mango for work.
- A refresh token is presented to the authorization server for replacement credentials; ordinary Mango tool handlers should not receive it.
- Access-token expiry should normally trigger host-managed renewal, not a login for every operation.
- Failed/expired/revoked renewal requires an explicit reconnect flow; do not fall back to weaker authentication.
- Use provider-supported refresh-token rotation and safe handling of its grace/reuse behavior where applicable.
- Ten-minute access tokens and a longer renewable lifetime were illustrative policy proposals, not approved universal constants. Choose and document appropriate supported values and enterprise policy controls.
- Removing company/resource access must affect subsequent requests, including requests inside an already-open MCP connection.
- Disconnect stops future access under that authorization; it does not undo completed work, guarantee cancellation of an in-flight external action, or delete data already returned to a conversation.

### Revocation must be real

Deleting ChatGPT's stored copy does not erase an attacker-held copy. An administrator disabling the integration in Mango also cannot physically remove credentials from another service. Offline signature/expiry validation can continue accepting a previously issued token after provider revocation.

Provide an effective server-side way for the user to disconnect the authorization and for company administrators to disable its use in their company, without deleting the human's Mango account or unrelated browser access. This does not require a separate revocation microservice or another resource-permission system.

A small checked connection/grant record may be appropriate. Its job is the lifecycle of delegated authorization, not per-Node permissions or per-chat identity. Prove its trusted binding before committing to a schema. A simple enabled flag is a pause control, not sufficient permanent revocation if reenabling it resurrects old credentials. Checking only access-token issue time also fails when an old refresh token can issue a newer access token.

Provider-specific findings from the discussion that must be verified in the actual implementation:

- Cognito supports authorization-code exchange, PKCE, and resource binding, but the current repository does not prove complete ChatGPT discovery/callback compatibility.
- Cognito's documented token revocation is not observed by a plain signature-and-expiry verifier.
- Cognito's OAuth `userInfo` endpoint documents rejection of revoked access tokens and can observe provider-side revocation without requesting broad user self-service permissions merely for the lookup.
- An online provider check adds availability/latency/rate-limit concerns; caching successful checks introduces a revocation delay that must be stated and tested.
- Targeted Cognito refresh-token revocation requires the actual refresh credential, which ChatGPT holds in a direct flow. An access-token identifier is not a documented substitute for that credential.
- The reviewed AWS documentation did not establish that `origin_jti` is a safe, stable authorization-family binding through every rotated refresh token. Do not auto-register an unknown family as newly approved based on assumption.
- Reconnection must create a genuinely new approved authorization while keeping the old one rejected.

The authentication prototype must resolve those facts. If the proposed direct Cognito setup cannot meet the security contract, explain the exact blocker and request the smallest necessary architecture/authority decision. Do not silently replace Cognito, build a token broker, weaken revocation, or claim a boolean solves it.

### Enterprise baseline and data boundaries

Implement strict company isolation, current permissions, scope enforcement, safe credential handling, attributable operations, and effective connection control. Keep secrets in approved credential/provider stores, never tool results, URLs, debug logs, manifests, or source files. Limit exposed request sizes, timeouts, and abusive/expensive usage using existing mechanisms where possible.

Treat retrieved documents, comments, email text, and record fields as untrusted task data. Instructions embedded in that content must not become privileged tool instructions, grant access, or count as human approval. Preserve source attribution and test misleading content, without claiming Mango can guarantee the external model's behavior or introducing the deferred approval system.

Company data returned to ChatGPT leaves Mango's application boundary. Document what is shared. Support the relevant verified-identity configuration for ChatGPT Enterprise workspace/domain restrictions where available; do not assume a personal ChatGPT workspace is automatically an approved company destination or trust an unverified organization hint as policy authority.

Existing company sign-in and multifactor policies should apply to account linking. Full enterprise certification, a new identity-provider migration, provisioning platform, residency program, or compliance project is not authorized by this brief. Customer requirements for retention, residency, contracts, and audit evidence must not be represented as already satisfied merely because OAuth works.

## 6. Minimal server architecture and tool selection

Prefer one maintained Go MCP implementation in the existing backend, using Streamable HTTP at a protected endpoint such as `/mcp`. Do not add a Node/Python sidecar just because a tutorial uses that language. Do not write a protocol implementation from scratch when the maintained Go library fits.

The target call path is:

`ChatGPT host -> protected MCP tool -> eligible existing authorized operation -> canonical transaction/event -> existing realtime delivery`

An eligible operation already preserves the required permission checks, business rules, side effects, and lifecycle. Calling a repository method is not automatically equivalent to calling that operation.

### Tool selection contract

1. Mango supplies a catalogue of focused operations with names, descriptions, input/output schemas, and accurate safety metadata.
2. ChatGPT uses that information and applicable instructions to decide which installed tool fits the user's request.
3. Discovery/read tools return exact permitted IDs and enough context to resolve the task.
4. The model chooses a business operation and arguments; the host handles credentials and transport.
5. Mango validates the request independently and returns a factual result.
6. The model may make another supported call or explain the result/blocker.

Use concise cross-tool instructions for things such as resolving current identity/company and reading a resource before modifying it. Use per-tool descriptions for when/how to invoke each operation. No giant company dump, duplicated agent graph, new vector database, or permanent credential-bearing prompt is needed.

Names such as `get_me`, `list_processes`, `get_node`, `create_node`, and `update_node` are illustrative candidates, not a promised tool list. Do not register a tool until its real behavior passes the eligibility rules.

Do not expose arbitrary SQL, shell execution, browser automation, arbitrary URL fetching, `call_any_endpoint`, or an unrestricted resource/action/payload escape hatch. Keep tools focused on current user goals and typed existing resource identities.

Tool read/write/destructive/external-effect annotations influence client behavior. They are not backend permission checks or independently verifiable human approval. Accurate annotations remain required even though a new approval system is deferred.

## 7. Actual tool inventory and the strict skip rule

Worker A must create `docs/tests/ai mcp.md` with the current numbered Business Logic Laws at the top. Follow the repository's documentation format: one required behavior per law, at most one short process story, and no more than three main scenarios if they materially clarify the rules.

After the laws, include a concise inventory of every actual exposed tool:

- Exact registered tool name and purpose.
- Required inputs and returned results.
- Read/write scope and existing permission checks.
- Existing canonical operation/source location reused.
- Persistent side effects, events, and deletion semantics.
- Retry behavior and applicable test coverage.

Also include an **Intentionally not exposed** table. For every candidate considered but rejected, record the intended user action, exact source location, missing reusable business/security boundary, and explicit reason. For example: "Skipped intentionally: browser creates the record and then separately inserts/saves the required reference. No workaround added."

Do not present the roadmap or all REST endpoints as implemented tools. Do not quietly advertise read-only access as full CRUD. Aim for a genuinely useful small eligible CRUD slice; if a requested operation cannot be included under the skip rule, document the limitation and do not expand scope to force it.

### What disqualifies a candidate in this version

- Frontend click handlers, timers, editor-close events, or local state complete required business effects.
- A safe operation would require extracting handler-only authorization, notifications, cleanup, or business behavior.
- Reproducing it would require duplicating validation in the MCP adapter or chaining lower-level calls to imitate a browser workflow.
- It requires a new human-approval mechanism or concurrency redesign to be safe.
- Its retry/outcome semantics cannot be made reliable within a small eligible server operation, especially external sends.
- It relies on disabled legacy behavior or on changing existing product laws.

Adding narrow MCP authentication, protocol adaptation, scoped durable retry protection, and server-derived attribution is within scope. Refactoring application workflows to create eligibility is not. Where the boundary is unclear, choose the smaller exposed surface and report the gap.

## 8. Safe retries, committed results, and live visibility

### Safe retries are required for exposed writes

A lost response is not proof that a write failed. Retrying a creation after the server committed must not create another resource.

Use a stable operation key and durable outcome using existing infrastructure where it fits. Scope the key to the authenticated user/client, company, and operation as appropriate. Repeating the same key and payload returns the same committed outcome; reusing the key with different inputs returns a conflict. Concurrent duplicates must converge. A protocol request ID alone is not a durable business-operation key.

Check current authorization before returning a stored result so a retry cannot disclose data after access was removed. Retain no success result for rolled-back changes. Avoid unnecessary retry loops, generic workflow engines, and broad exactly-once claims.

External systems and Mango's database cannot generally commit in one transaction. An uncertain send requires outcome reconciliation rather than blind repetition. Email sending is not a required v1 tool and should be skipped when it depends on the deferred browser/send refactor.

### Reuse the existing realtime path

Successful operations should preserve the canonical transaction, durable domain events/outbox, notifications, and existing realtime delivery. Do not add an MCP-specific websocket or a second live-update platform.

Return concise receipts containing exact typed resource IDs, committed revision where available, outcome, operation/event reference where available, and a canonical Mango link. A server commit and a browser rendering that commit are distinct events; do not claim the browser visibly updated merely because a write succeeded. An offline client must catch up through the existing mechanisms.

### Trace and attribution

Use server-derived user and authorized-client attribution for actual operations. A caller-written `client_id` in an editor payload is not proof of OAuth client identity. Generate trustworthy server request correlation rather than accepting all attribution from caller headers.

Reuse existing event/history/logging structures where possible. Do not build a universal timeline subsystem in this first slice. Existing Node timeline event types do not already represent every CRUD action. Record actual committed facts without claiming an agent note proves successful execution.

Model-authored progress notes, attempts, blockers, and verified outcomes have different meanings. An optional run label may group them but cannot become identity or authorization.

## 9. Existing Mango laws must survive unchanged

Before designing or changing any relevant relationship or permission behavior, read `docs/tests/relationships.md` in full. Also read the laws for each touched subsystem.

Important examples from the conversation:

- Product-facing Process is the existing canonical `logic_gate`, not a new resource identity.
- Company, canonical type, and literal existing ID identify a resource. Do not add a central resource registry, surrogate mapping, copied agent graph, or generic universal edge table.
- Assignments help discover work but do not grant unrelated access. Relationship presence is not permission.
- Company Explorer placement, operational relationships, and Process Map geometry have separate authorities. A map trace is not an audit timeline or a causal inference engine.
- Use current Process work operations, not disabled legacy Kanban-board/column APIs.
- Nodes do not gain arbitrary `assignee_user_id` or `status_color` writes; use current assignment/work-state rules if those operations are eligible.
- Action Item Source is immutable creation provenance. It is separate from an inline reference and from live Huddle Entity relationships.
- Huddle Node snapshot relationships remain immutable; later live changes do not rewrite them.
- QCD remains the existing manual current-business-day judgment. Automatic inferred scoring and historical rewriting were not approved.
- A KPI is currently a named document, not a newly authorized numeric measurement/formula engine.
- Unlink, recycle, restore, and permanent delete are different operations. Some Entity/Action Item deletions are permanent; many other resources use recycle rules.
- Existing deletion confirmations, dependency guards, restoration ownership, and admin-only purge rules are not removed because new approval work is deferred.
- Email and attachment relationships keep exact Mango identities and existing owner/sender authority; provider IDs or temporary file URLs are not substitutes.

## 10. Repository findings that motivated the scope split

These are investigation starting points from the conversation, not a claim that every current path has been audited. Recheck exact behavior on the worker's branch; line numbers may change.

### Authentication and company context

- `backend/internal/http/auth_middleware.go`: `withAuth` currently applies its normal checks to `/v1/` and `/v2/`, not a newly added bare `/mcp` path. Attach explicit MCP protection.
- The same file maps verified claims to existing users/memberships. The company scanner reads query/top-level JSON and does not by itself validate nested MCP arguments.
- `backend/internal/auth/jwt.go`: current browser-oriented token validation does not establish the full delegated MCP resource/scope/revocation contract.
- `frontend/src/auth/cognitoAuth.ts`: the helper named `getAccessToken` currently prefers an ID token; do not reuse that as the MCP token contract. Browser logout is not a complete remote-connection revocation design.
- `frontend/src/auth/currentCompany.ts`: browser-selected company is session state, not proof of authorization.
- `backend/internal/http/auth_membership_cache.go`: current memberships may be cached; fresh membership resolution already exists and revocation timing must be intentional.
- `infra/modules/mangorts-platform/cognito.tf` and `infra/aws-prod/cognito.tf`: existing SPA and reserved machine clients are not proof of a complete ChatGPT delegated setup. A client-credentials machine token cannot stand in for the person.

### Handler-owned behavior

- `backend/internal/http/work_item_handlers.go` owns more than parsing: permission checks, actor metadata, operation execution, realtime publication, and notifications appear in the request path.
- `backend/internal/modules/kanban/service.go` is not automatically an authorization-complete substitute for that handler.
- `backend/internal/http/editor_json_handlers.go` also handles mention notification and realtime wakeup behavior.
- Latest scope explicitly forbids extracting or copying this behavior just to expose a v1 tool. Flag the candidate and leave the refactor to a later task.

### Existing reliability and history

- `backend/internal/store/postgres_nodes.go` contains atomic resource-plus-event paths, but generic Node creation is not uniformly protected by a durable caller operation key.
- `backend/internal/store/postgres_editor_textboxes.go` has revision behavior and a stale-document merge path; do not claim all stale edits are rejected or that an operation ID is already a stored result lookup everywhere.
- `backend/internal/store/domain_events.go` and `postgres_domain_events.go` provide useful event/outcome foundations, not complete connected-client attribution by themselves.
- `backend/internal/http/realtime_spine.go` and `realtime_publish.go` already provide durable delivery and current-permission audience handling.
- The existing Node timeline is limited to defined event types such as transfers, Project assignment, and verification; it is not a universal CRUD audit.

## 11. Worker B: comprehensive browser-business-behavior audit

Output: `docs/importanttasks/browser-owned-business-behavior-audit.md`.

This worker may write its report but must not change application code, schema, infrastructure, runtime configuration, dependencies, or production systems. It must not implement MCP or repair the findings. It should commit only the report in its own branch.

### Audit method

1. Inventory meaningful user actions across every current frontend surface, not just backend routes or visible buttons.
2. Follow complete click handlers, imported helpers, API sequences, deferred saves, effects, timers, close/unmount/page-hide handlers, cache-driven decisions, and error recovery.
3. Trace corresponding server authorization, validation, transactions, relationships, projections, events, notifications, and cleanup.
4. Separate UI-only behavior from lasting business behavior. Focus/caret/navigation/preview/optimistic display normally stay in the UI.
5. Classify each action as server-complete, browser-coordinated business behavior, handler-only business behavior, UI-only, unsupported, or not fully verified.
6. For every finding, provide the action, exact source locations, browser-owned steps, current server capability, failure/permission/retry risks, what a direct agent/API caller would miss, and the smallest later correction. Recommendations are not authorization to implement.
7. Report coverage by module, including audited areas with no finding, so "comprehensive" is supported by an inventory rather than four examples.
8. State remaining uncertainty, inaccessible paths, and anything not inspected. Do not claim execution or production verification from source inspection alone.

Cover at least Processes/Nodes, Explorer/folders, assignments and relationships, Projects, editors/documents/chats/history, Huddles, Entities/Action Items, KPIs/QCD, Process Map, email/drafts/shared drafts/triage, attachments, account records, permissions/groups/users, pins/views/preferences/notifications, and delete/recycle/restore/purge.

### Confirmed examples to investigate, not the complete audit

1. **Document history:** `frontend/src/modules/editor/EditorContent.tsx` flushes document and metadata saves before a separate save-version request. `editorExitHistory.ts` uses close/unmount/page-hide lifecycle to create changed-only history. A document API write alone may omit the history step.
2. **Create Node from image:** `EditorContent.tsx` coordinates Node creation, attachment linking, document saving, and textbox metadata as multiple writes. Failure after the first step may leave partial work.
3. **Inline Action Item creation:** `frontend/src/modules/editor/tiptap/MangoTiptapEditor.tsx` and `editorEntityLinks.ts` create an Entity with immutable Source, then insert a local reference and rely on a later save. For Huddles, the live relationship/rollup follows the document/chat reference, not Source alone. Standalone creation and create-and-reference are different goals.
4. **Email sending and shared drafts:** `frontend/src/modules/communications/communicationsApi.ts`, `outboundEmailUndo.ts`, and `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx` coordinate a browser-memory Undo delay, send, revision-aware draft cleanup, and cleanup-only retry. Shared-draft switching flushes personal draft edits first. `backend/internal/http/communications_handlers.go` sends externally before completing local persistence, so a later error does not prove no send occurred.

The report should include tests a future fix would need: no browser open, a second observing browser, failure after each step, response loss after commit, denied/cross-company inputs, concurrent change/removal, and provider-success/local-save-failure for external actions. This audit worker does not build those fixes or tests now.

## 12. Full future tool coverage: context, not v1 scope

The original product target is every supported business operation the connected user is allowed to perform. The small first release does not redefine that long-term target as "read some context and post notes."

| Area | Eventual operation families |
| --- | --- |
| Discovery | Current user/companies, users/groups, My Processes/My Nodes/My Work, search, location, related context |
| Processes and work | Process lifecycle, board work, Node creation/assignment/movement, state, issue flag |
| Nodes | Lifecycle, priority/dates, documents, chats, metadata, timeline reads, verification |
| Organization | Folder creation/rename/move, valid resource placement/move/unlink, target deletion |
| Projects | Lifecycle, documents/chats, membership, Node creation, critical path, timeline items |
| Huddles | Board/Node lifecycle, live memberships, immutable snapshots, editors/chats, Explorer |
| KPIs and QCD | Existing KPI document lifecycle and permitted daily rating read/set/clear |
| Entities and Action Items | Types, folders, field definitions/values, Entity lifecycle, Action Item creation and Source reads |
| Relationships | Existing Node structure, work assignments, Project/Huddle membership, operational flow, accounts, RACI |
| Process Map | Scene/tiles, geometry, exact operational edges and dependent trace geometry |
| Email | Authorized message/thread reads, exact links, triage, personal/shared drafts, permitted send/reply/archive/calendar responses |
| Files | Authorized content/metadata, upload/complete/abort, attachment link/unlink |
| Accounts/settings | Existing account records, pins, saved views, notifications, permitted user/group/member/permission actions |
| Recovery | Documented delete/recycle/restore and admin-only permanent purge |

This table is neither a current tool list nor permission to expose every existing endpoint. Immutable fields, unsupported methods, and existing business-law restrictions remain excluded even in a future full implementation.

## 13. Deferred capabilities, preserved for the next phases

### Bidirectional file transfer

Required in the longer-term product, deferred in this worker:

- User-provided or generated ChatGPT files can become durable Mango attachments.
- Mango files can be read or returned to ChatGPT after current owner/resource authorization.
- Use the supported host file-input/output contract and actual file bytes, not a local path on a different machine or a temporary URL stored as a permanent attachment.
- Preserve existing upload intents, exact attachment relationships, checksum/size/type validation, and cleanup.
- Secure remote retrieval against arbitrary/private-network targets and unsafe redirects. Do not make a generic URL-fetch tool.
- Prove real file delivery and supported formats/limits in regular ChatGPT; a downloadable link alone is not proof the model can process the file.

### Concurrent editing

Existing revision/collaboration behavior must not regress. The agent cannot see another browser's unsaved text that never reached the server. A future dedicated task may harden stale writes/merges and improve the experience, but this worker does not introduce another editor or synchronization layer. Skip candidate tools needing that work.

### Human approval

Future consequential actions may use ChatGPT's approval UI or a signed-in Mango approval step bound to the exact action, resource, parameters, and relevant revision. A model-provided `confirmed: true` or typed human name is not independent evidence of human approval.

Do not create that new system here. Keep existing requirements and correct tool annotations. Skip an operation that cannot meet its current safety requirements without new approval work.

### Autonomous operation and learning

Schedulers, sensors, continuous email/Slack monitoring, an exception engine, severity/routing policies, autonomous external execution, causal inference, recurrence analysis, automatic QCD, and a postmortem/learning platform are not v1 requirements. A future loop must distinguish a signal from a diagnosis, an attempted action from a verified result, containment from permanent correction, and claimed completion from evidence.

## 14. Worker A implementation and verification order

1. Read this brief and the applicable current business laws. Confirm the hard exclusions before choosing tools.
2. Verify the official MCP library/toolchain requirements and perform the requested Go 1.27.1 repository upgrade. Align module/build images/CI/scripts and the test runtime; do not silently verify with an older Go version or alter unrelated developer configuration.
3. Prove the authentication architecture with the smallest identity/read surface. Resolve client registration, discovery, exact callbacks, audience/scopes, refresh, provider revocation, and secure local connection binding. Do not use a fake permissive path as production proof.
4. Implement a protected MCP endpoint and minimal connection/configuration/setup documentation using current libraries and existing Mango identity/permissions.
5. Inspect candidate basic CRUD operations. Register only those that can safely reuse complete current server behavior without the prohibited handler/browser refactor. Document skips as soon as they are found.
6. Add durable safe retries and truthful server-derived outcomes for every exposed mutation. Preserve the existing event/realtime path and no-browser operation.
7. Complete `docs/tests/ai mcp.md` with actual tools, current laws, exclusions, and test coverage. Update other business-law documents only if authorized behavior truly changes.
8. Verify the implemented slice with protocol tests and, when approved setup/access exists, actual regular ChatGPT linking and calls. Clearly separate mocked/local verification from real host/provider verification.
9. Review the diff for scope, secrets, regressions, unnecessary dependencies/abstractions/loops, and accidentally exposed unsupported tools. Commit intended work locally and stop.

### Minimum test expectations

- Reject missing, malformed, expired, wrong-issuer, wrong-client, wrong-audience, wrong-token-type, and insufficient-scope credentials.
- No private execution when auth is unconfigured; public discovery reveals no customer data.
- Browser and MCP resolve the same existing user; caller arguments cannot replace that identity.
- Reject unauthorized resources, guessed typed IDs, cross-company reads/writes/links, and permission leakage through errors/results.
- Check current connection/membership/resource authority even in an existing transport session and on stored-result replay.
- Verify renewal, revoked access, revoked renewal, new authorization after reconnect, and rejection of old credentials after reconnect.
- Exercise same-operation retries, different-payload key reuse, concurrent duplicates, response loss after commit, and failed transactions.
- Ensure every exposed mutation has the same required rules and effects as its existing canonical operation.
- Demonstrate operation with no Mango browser running; when UI observation is available, confirm the existing browser receives committed changes without a new MCP-specific channel.
- Do not claim omitted editor, approval, file, email, or frontend-workflow behavior was tested or implemented.
- Test tool discovery, representative direct/indirect prompts, ambiguous requests, and unsupported requests in the actual host when possible. Protocol tests alone do not prove automatic tool choice.
- Include adversarial document/comment/record text that asks the agent to ignore rules, disclose hidden data, or perform unrelated actions; verify server permissions and scope checks remain authoritative and no content is treated as approval.

Run targeted tests and proportionate full repository verification for the Go/auth/backend changes. On Windows, use WSL2 Ubuntu and the approved outside-sandbox path for Go tests; do not invoke Windows `go test` or weaken Application Control. The full runner is `node scripts/run_all_tests.mjs`. Use existing supported test fixtures/disposable environments; never write to a live database or obtain a live writer/admin credential.

### Deployment and setup boundaries

Repository code, tests, configuration definitions, and human-run setup instructions are in scope. They are not permission to apply production Terraform, modify live Cognito/Route53/RDS/ECS/ECR/Secrets Manager/GitHub environments/Nylas, publish the plugin, or write live databases without the separately required confirmation.

Do not pretend the live ChatGPT integration is verified if registration, credentials, cloud configuration, or user authorization is unavailable. Report exactly what is implemented, what was verified, and the remaining operator steps. Do not solve missing access by inventing credentials, bypassing security, or introducing a materially different auth provider.

For any necessary repository schema/operator changes, keep PostgreSQL 17 compatibility, plain operator SQL, canonical schema/law updates, and explicit human rollout instructions. Do not apply them to a live database.

## 15. Completion reports

Worker A must report the implemented auth/connection behavior, actual exposed tools, intentionally skipped tools and reasons, Go version used for tests, verification results, exact remaining user/provider/deployment setup, changed backend/schema areas, worktree path, branch, and local commit. No claim of full CRUD or enterprise certification.

Worker B must report audited coverage, the comprehensive findings document, strongest risks, unverified areas, documentation-only diff verification, worktree path, branch, and report commit. No application fixes.

Both must obey the no-merge/no-push/no-PR boundary. Integration and production rollout remain separate decisions after review.

## 16. Source references and research boundary

The conversation used the following primary documentation. Check current pages during implementation; do not invent host behavior or copy example credentials. Provider documentation establishes capability, not proof that Mango's deployed configuration already enables it.

- [OpenAI: plugins in Chat and Work](https://learn.chatgpt.com/docs/plugins)
- [OpenAI: build an MCP server and define tools](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI: authentication, discovery, scopes, callbacks, and client identification](https://developers.openai.com/plugins/build/auth)
- [OpenAI: connect a server to ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [OpenAI: file-input and tool metadata reference](https://developers.openai.com/plugins/reference)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [PKCE standard](https://www.rfc-editor.org/rfc/rfc7636)
- [AWS: authorization endpoint, PKCE, and resource binding](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)
- [AWS: access-token claims](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html)
- [AWS: refresh tokens and rotation](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html)
- [AWS: token-revocation behavior](https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html)
- [AWS: revocation endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/revocation-endpoint.html)
- [AWS: user-information endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/userinfo-endpoint.html)
- [Official Go MCP SDK](https://github.com/modelcontextprotocol/go-sdk)
- [Go release history](https://go.dev/doc/devel/release)

At the time of the discussion, Mango declared Go 1.23.0, its Docker build used Go 1.23, and the Windows installation reported Go 1.23.12. The inspected official MCP Go SDK release required at least Go 1.25. Go 1.27.1 was verified as released on 2026-09-01 and explicitly selected by the user. The SDK minimum is not the chosen deployment target.

Keep Mango's repository private. Publishing an MCP endpoint or a minimal plugin description does not require publishing application source, database schemas, scripts, credentials, or private customer data.
