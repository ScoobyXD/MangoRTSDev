# Getting any agent onto Mango

## Short version

Mango must work with any capable agent, regardless of who built it. Hermes, OpenClaw, OpenAI, Anthropic, Google, Meta, xAI, Chinese labs, and future agents should all use the same public Mango contract.

MCP can be one convenient adapter, but it cannot be the foundation. The foundation must be:

1. A documented HTTPS API.
2. A machine-readable OpenAPI specification.
3. Standard OAuth authorization.
4. Stable resource IDs and predictable JSON schemas.
5. Safe writes with versions, idempotency, audit records, and permission checks.
6. A standard way to search, read, change, and watch Mango data.

If an agent can make HTTPS requests, complete OAuth through the user's browser, or call a cross-platform CLI, it should be able to use Mango. No agent should need Mango-specific code inside its model or runtime.

Initial signup is not the focus of this document. Assume the user already has a Mango account. The immediate goal is letting the user authorize any local agent and then say:

> On my Mango account, find this work, gather what you need, do it, save the result, and move it to Review.

## The non-negotiable product rule

The canonical integration must not depend on:

- Hermes.
- OpenClaw.
- MCP.
- A particular model provider.
- A particular operating system.
- Browser automation against Mango's own UI.
- A hidden prompt that only one agent vendor understands.

Mango should expose one stable public contract. Vendor-specific integrations sit on top of it.

```text
                         Mango public API
                                |
        +-----------------------+-----------------------+
        |                       |                       |
     OpenAPI                  Mango CLI               Events
        |                       |                       |
  Any HTTP-capable       Any agent that can       Polling, webhook,
      agent               run a command           SSE, or WebSocket
        |
        +------------- Optional MCP adapter -------------+
```

Business rules belong in the Mango backend. MCP servers, CLIs, SDKs, and provider integrations should be thin clients over the same API.

## What the user experience should become

Once a user already has a Mango account:

1. The user tells an agent to connect to Mango.
2. The agent discovers Mango's public integration instructions at a stable URL such as `https://mangorts.com/agents`.
3. The agent launches Mango authorization in the user's browser.
4. The user signs in directly to Mango and approves the requested company and permissions.
5. The agent receives a revocable, scoped authorization. It never receives the user's password.
6. The agent calls the Mango API directly or through the Mango CLI, SDK, or MCP adapter.
7. Mango records which user, agent installation, and agent run performed every change.

The first connection may require a browser approval. Normal work after that should not require the user to keep copying tokens, IDs, or instructions into the agent.

## The standards-based access layers

### 1. Public HTTPS API: the source of truth

The API is the lowest common denominator. Every other integration must call it.

Requirements:

- JSON request and response bodies.
- Stable resource IDs.
- Consistent authentication and errors.
- Cursor pagination for lists and search.
- Explicit API versioning and deprecation rules.
- Rate-limit and retry headers.
- Request and correlation IDs.
- Idempotency keys for mutations.
- Expected versions or `If-Match` for updates.
- Dry-run and confirmation support for destructive actions.
- Bounded responses suitable for agent context windows.

The public contract should be a deliberate subset of the internal/frontend API. Do not declare every current endpoint stable without reviewing its semantics.

### 2. OpenAPI: machine-readable discovery

Publish an OpenAPI 3.1 document at a stable location such as:

```text
https://api.mangorts.com/openapi.json
```

The specification should include:

- Authentication and scopes.
- Every public operation and schema.
- Whether each operation is read-only, idempotent, or destructive.
- Pagination and error shapes.
- Examples with fake IDs and data.
- Limits and expected retry behavior.

Many agents can turn an OpenAPI document into tools without MCP. Humans and generated SDKs can also use it.

### 3. Cross-platform Mango CLI: the universal fallback

Provide one signed CLI for Windows, macOS, and Linux. It should support browser authorization and machine-readable JSON output.

Example shape:

```text
mango auth connect
mango whoami --json
mango companies list --json
mango search --company <id> --query "quarterly report" --json
mango resource get --company <id> --type node --id <id> --json
mango work move --company <id> --assignment <id> --status review --json
```

An agent that can run a shell command can use Mango even if it cannot dynamically load OpenAPI or MCP tools. The CLI must use the public API and must not contain separate business logic.

### 4. Optional MCP adapter

MCP is useful and should be supported, but it is only an adapter.

The MCP server should:

- Call the public Mango API.
- Reuse the same OAuth tokens and schemas as the CLI.
- Expose a small, typed tool set.
- Mark tools as read-only, idempotent, or destructive where the protocol supports it.
- Avoid reproducing Mango permission or workflow logic locally.

Hermes and other MCP-capable agents get a polished experience. Agents without MCP still receive the same capabilities through HTTPS or the CLI.

### 5. SDKs later

Generated or handwritten SDKs can be added for TypeScript, Python, Go, and other languages. SDKs are conveniences, not the contract.

## Authorization after signup

### Human-delegated access

For a local agent acting for a user, use OAuth Authorization Code with PKCE:

1. The local agent or Mango CLI generates a code accountable and challenge.
2. It opens Mango in the user's browser.
3. The user signs in to Mango and approves access.
4. Mango redirects to a temporary localhost callback or another approved client callback.
5. The client exchanges the code for scoped tokens.

The password, MFA code, and email verification remain inside the Mango browser flow.

Device authorization can be added for agents that cannot receive a localhost callback. A manually created personal access token may be a limited fallback, but it should not be the primary experience.

### Agent installation identity

Do not treat every agent as an unnamed copy of the human user. Create an installation record such as:

```text
agent_installation_id
user_id
company_id
display_name
client_type
granted_scopes
created_timestamp
last_used_timestamp
revoked_timestamp
```

Example display names:

- `Claude Code on Jonat-Laptop`
- `Hermes on Office-PC`
- `Future Agent on Accounting-Desktop`

Mango should show these installations in user settings with their scopes, last use, and a Revoke button.

Do not identify the agent only by a free-form provider name. Provider names change, and some agents may be private or unknown. Use a Mango-issued installation ID as the durable identity.

### Scopes

Start with narrow scopes such as:

```text
workspace.read
documents.write
work_items.write
comments.write
attachments.read
attachments.write
events.read
communications.read
communications.send
workspace.delete
company.admin
```

Defaults should permit reading and ordinary work, not deletion, email sending, permission changes, or company administration.

OAuth scopes do not replace Mango's existing company and entity permissions. Both checks apply:

```text
allowed = token scope allows operation
          AND user/agent may access the company
          AND entity permissions allow the operation
```

## Mango as a remote workspace

Mango is not literally a normal filesystem. It is a permissioned object graph with documents and workflows. Agents can still use a filesystem-like addressing model.

```text
mango://<company_id>/<resource_type>/<resource_id>
mango://<company_id>/<resource_type>/<resource_id>/document
mango://<company_id>/<resource_type>/<resource_id>/blocks/<information_id>
mango://<company_id>/attachments/<attachment_id>
mango://<company_id>/logic-gates/<logic_gate_id>/work/<assignment_id>
```

The important mappings are:

| Filesystem concept | Mango concept |
| --- | --- |
| Volume | Company |
| Directory | Folder or project |
| File | Node or document |
| Workflow directory | Logic gate |
| Task | Node-to-logic-gate assignment |
| File content | Public document/block representation |
| Link | Relationship or Explorer placement |
| Metadata | Status, priority, due date, permissions, RACI roles |
| Revision | Version, editor sequence, or ETag |
| Watch journal | Ordered change feed |
| Blob | Attachment |

Explorer paths are human-readable aliases, not canonical identity. A resource may be moved, renamed, or appear in more than one place. Agents must write using stable IDs.

## Minimum public operations

The exact URL design can change, but every agent needs equivalent operations.

### Discovery and identity

```text
get_capabilities
get_current_user
list_companies
get_company_permissions
```

### Navigation and search

```text
list_children
search_workspace
get_resource
list_related_resources
```

Search must eventually cover more than names and IDs. It should support:

- Projects, logic gates, nodes, and folders.
- Document and block text.
- Durable comments.
- Work status and assignment metadata.
- Attachment names and extracted text when allowed.
- Resource type, dates, status, owners, and tags as filters.
- Cursor pagination.
- Permission filtering before results are returned.

### Documents

```text
get_document
list_blocks
create_block
update_block
delete_block
list_versions
restore_version
```

Do not make external agents understand private React editor markers or frontend-only JSON. Publish a versioned document/block schema. A practical first format is structured JSON with safe Markdown or plain-text fields.

Every update should include an expected version. If another user or agent changed the document, return a conflict instead of silently overwriting it.

### Work

```text
list_work
get_work_item
create_work_item
claim_work
renew_claim
release_claim
move_work
request_review
complete_work
```

The canonical work identity should be the assignment ID or a documented company/node/logic-gate tuple. Projected Kanban card IDs should not become the public durable identity for logic-gate work.

The existing user-facing workflow is:

```text
Requested -> Backlog -> Pending -> In Progress -> Review -> Done
```

Board status is not enough to describe an agent run. Keep internal run states separate, for example:

```text
queued
needs_information
ready
running
waiting_for_external_system
blocked
ready_for_review
failed
cancelled
done
```

### Comments and agent conversations

Create a real server-side comment/message contract:

```text
list_comments
create_comment
reply_to_comment
resolve_comment
```

Messages should have stable IDs, authors, timestamps, resource/work links, and attachment references. Do not use browser-local comments or require agents to construct opaque editor chat JSON.

### Attachments

```text
list_attachments
get_attachment_metadata
download_attachment
upload_attachment
link_attachment
unlink_attachment
```

Large files will need streaming or multipart upload rather than buffering the whole file in memory. Downloads and metadata must remain permission-filtered through their linked resources.

### Changes and events

Any agent must be able to resume after being offline. Provide an ordered change feed such as:

```text
GET /v1/changes?company_id=<id>&after=<cursor>&limit=<n>
```

Each event should include:

```text
event_id
sequence or cursor
company_id
resource_type
resource_id
operation
actor_user_id
agent_installation_id
agent_run_id
created_timestamp
payload or changed fields
```

Support several delivery options over the same event schema:

- Polling with a cursor. This is the universal fallback.
- Signed outbound webhooks.
- SSE or WebSocket subscriptions.

Document replay retention, ordering, duplicate delivery, retry behavior, and when a client must refetch a resource.

## Mutation safety contract

Every public mutation should support the same safety rules.

### Idempotency

Clients send an `Idempotency-Key`. Retrying the same operation must not create duplicate nodes, comments, assignments, cards, or events.

### Optimistic concurrency

Clients send an expected version or `If-Match`. A stale update returns a conflict with the current version. Agents should then reread, merge, or ask the user.

### Destructive operations

Deletion should use a two-step flow:

1. Preview or dry run returns the exact objects and relationships that would change.
2. A separate request includes a short-lived confirmation token.

Default agent scopes should not include permanent deletion. Prefer recycle-bin behavior where possible.

### Consistent errors

Use one documented error format with:

```text
code
message
request_id
retryable
field_errors
current_version
```

Agents should not need to parse human UI text to understand what failed.

## Agent runs and audit history

Mango should know that an agent performed work, even when the agent uses the same underlying user permissions.

Add durable records similar to:

```text
agent_installations
agent_runs
agent_run_events
agent_messages
agent_artifacts
external_references
```

An agent run should record:

- The requesting user.
- The agent installation.
- Company and work item.
- Granted scope at execution time.
- Start, heartbeat, completion, and failure timestamps.
- Current internal run state.
- External systems used.
- Result summary and artifact references.
- Correlation and idempotency IDs.

Do not store private chain-of-thought. Store actions, tool calls at an appropriate audit level, user-visible summaries, errors, outputs, and provenance.

For unattended work, claims need leases and heartbeats so abandoned work can be retried safely. A crashed agent must not leave a permanent lock.

## Working with DEACOM, Costco/IRI, Airtable, and other applications

The local agent should usually connect to these systems directly through their APIs, MCP servers, CLIs, browser automation, or desktop tools.

Mango should remain the source of truth for:

- The requested work.
- Business context and permissions.
- The normalized result.
- Source system and external object IDs.
- Retrieval timestamp and source version.
- Relevant files or links.
- The agent run that produced the result.
- Human review and approval.

Mango should not require every third-party integration to run inside Mango. It also should not store third-party passwords in documents or agent prompts.

An external result should carry provenance such as:

```text
provider_type
external_object_id
source_url
retrieved_timestamp
source_version
content_hash
agent_run_id
```

## Prompt-injection and data safety

Mango documents, attachments, emails, and external web pages are untrusted data. Their content must not silently become system instructions for an agent.

The public schemas and adapters should keep these separate:

```text
trusted operation instructions
user-authored task
untrusted retrieved content
```

Other security requirements:

- Agents never receive Mango database credentials.
- Agents use only scoped Mango application APIs.
- Tenant and entity permissions are always checked by the backend.
- Tokens are revocable, expiring, and stored in an OS credential store where possible.
- Secrets are never returned in normal resource reads, logs, events, or search results.
- Cross-company operations are rejected unless explicitly authorized.
- Email sending, external publishing, deletion, and administration require separate scopes and stronger approval.
- Logs and artifacts follow company retention and access policies.

## Current Mango foundation

The existing code already has useful building blocks:

- Bearer-token authentication and company membership checks in `backend/internal/http/auth_middleware.go`.
- A broad REST surface registered in `backend/internal/http/server.go`.
- Permission-filtered consolidated node and logic-gate views in `backend/internal/http/consolidated_view_handlers.go`.
- Logic-gate work states and assignments in `backend/internal/store/logic_gate_work.go`.
- Stable information/projection IDs and editor history for nodes and logic gates.
- Attachments with resource-linked permissions.
- Domain events, event rows, idempotency fields, and realtime replay infrastructure.
- Company Explorer search that resolves names and IDs to stable resources and location paths.

Important current gaps:

- No public self-service agent authorization flow.
- No first-class agent installation or machine principal.
- No published OpenAPI contract.
- No cross-platform Mango agent CLI.
- No Mango MCP adapter.
- No unified public capability discovery.
- Search is mostly names and IDs, not full workspace content.
- General writes lack consistent expected-version and idempotency behavior.
- Comments are fragmented between browser-local and editor-specific formats.
- No public cursored change-feed contract.
- No consistent dry-run and confirmation contract for destructive actions.
- Work-item and projected Kanban identities need a clear public definition.

## Recommended build order

### Phase 1: vendor-neutral read-only access

Build:

1. OAuth PKCE connection for an existing Mango user.
2. Agent installation and revocation records.
3. A reviewed public API subset.
4. OpenAPI 3.1 publication.
5. Cross-platform CLI with JSON output.
6. Capability discovery, companies, navigation, search, and consolidated resource/document reads.
7. Contract tests and a provider-neutral conformance test suite.

Success test:

> A previously unknown agent with only HTTP/OpenAPI support, or only shell access to the Mango CLI, can connect and answer, "What work is pending in my Mango company?"

### Phase 2: safe writes

Build:

1. Public document/block schema.
2. Expected-version writes.
3. Consistent idempotency.
4. Create and update work items.
5. Durable comments.
6. Attachments.
7. Work transitions through Review.
8. Audit attribution for user, installation, and run.

Success test:

> Any conforming agent can complete a work item, save results without overwriting another user's changes, and move it to Review without creating duplicates.

### Phase 3: durable autonomous work

Build:

1. Agent runs and internal run states.
2. Claims, leases, heartbeats, cancellation, and retries.
3. Cursored change feed.
4. Signed webhooks and realtime subscriptions.
5. Needs-information conversations.
6. User-visible run activity and revocation controls.

Success test:

> An agent can stop, restart, resume from a cursor, safely reclaim abandoned work, ask a user for information, and return the result for review.

### Phase 4: convenience adapters and ecosystem support

Build:

1. MCP adapter over the public API.
2. Generated SDKs.
3. Provider-specific install guides only where helpful.
4. External-system provenance and integration policies.
5. A public conformance badge or report for third-party agent clients.

The MCP adapter may ship earlier for testing, but it must never become the only supported path.

## Conformance requirements

Before claiming that Mango works with any agent, test the contract without using a Mango-specific model integration.

The conformance suite should verify that a client can:

1. Discover the API and required authorization.
2. Connect an existing user.
3. List allowed companies.
4. Search and resolve a resource to a stable ID.
5. Read a bounded document and its version.
6. Create an idempotent work item.
7. Detect and recover from a version conflict.
8. Add a durable comment.
9. Move work to Review.
10. Resume changes from a cursor.
11. Respect permission denial and token revocation.
12. Preview but not execute a destructive action without confirmation.

Run the same tests against:

- Raw HTTPS calls generated from OpenAPI.
- The Mango CLI.
- The MCP adapter.
- At least two unrelated agent runtimes.

No adapter should receive capabilities that are unavailable through the public API.

## Decisions to keep stable

1. The public API is canonical. Adapters are replaceable.
2. Any agent provider may connect if it follows the contract.
3. Stable IDs are canonical; Explorer paths are aliases.
4. The user authorizes an installation, company, and scopes through Mango.
5. Mango permissions remain authoritative.
6. Passwords and database credentials never go to agents.
7. Writes are versioned and idempotent.
8. Destructive actions are separately scoped and confirmation-gated.
9. Mango stores durable work state, audit history, results, and provenance.
10. Agent-specific internal states remain separate from user-facing board columns.
11. Polling is always available even when webhooks or realtime transports are not.
12. MCP is supported but never required.

## First concrete milestone

Build the smallest complete vertical slice for an existing user:

1. Publish a small OpenAPI contract.
2. Authorize a local client through browser OAuth with PKCE.
3. List companies.
4. Search Mango by name or ID.
5. Read one node, project, logic gate, document, and work view by stable ID.
6. Expose the same operations through the Mango CLI.
7. Prove that two unrelated agents can use it without Mango-specific runtime code.

Do not begin with autonomous execution, dozens of tools, or provider-specific integrations. First prove that an unknown agent can connect and read Mango through the public contract. Everything else depends on that.
