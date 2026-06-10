# Agentic Email Node V1 Project Tracker

Date: 2026-05-25

This is the project document for adding an agentic email add-on to MangoRTS. The V1 scope is an email-to-node suggestion engine: Mango reads a user's connected mailbox, finds messages or threads that likely belong to existing nodes, and presents those suggestions for user review.

Keep this document provider-neutral. Mango should own the product workflow, data contracts, permissions, audit trail, and approval model. AI providers are replaceable reasoning adapters.

## Purpose

Mango nodes are already the natural unit of work context. Each node can collect:

- node title, description, status, priority, and assignee;
- Logic Gate and Kanban work state;
- comments, chats, mentions, and activity;
- linked emails and future communication history;
- relevant files, links, and task metadata.

The agentic email feature should use that bounded node context to reduce communication triage work without giving an AI provider control over Mango's workflow.

The V1 product goal is:

```text
connected mailbox
-> bounded candidate generation
-> provider-neutral classification
-> saved email-to-node suggestions
-> user accepts, rejects, or ignores
-> canonical email-node links and feedback events
```

## Core Principle

Mango is the agent platform. OpenAI, Anthropic, local models, or any future agent runtime are implementation details behind Mango-owned interfaces.

Do not let provider-specific concepts leak into product tables, permissions, APIs, or UI behavior. Store provider metadata for observability and debugging, but keep the domain model independent.

## MVP Definition

V1 is only the suggestion engine.

Included:

- sync or read connected mailbox messages and threads;
- generate a small candidate set of possible nodes per email/thread;
- classify each candidate with an agent-agnostic contract;
- store suggested email-node matches with confidence, evidence, and status;
- show suggestions in the inbox and on node views;
- let the user accept or reject suggestions;
- convert accepted suggestions into canonical email-node links;
- record feedback so quality can improve.

Not included in V1:

- automatic email sending;
- autonomous mailbox actions;
- automatic node creation from emails;
- automatic acceptance of suggested links;
- draft reply generation;
- follow-up recommendations;
- attachment content analysis unless already available through a safe bounded pipeline.

## Agent-Agnostic Architecture Rules

- Mango owns every tool contract. Providers do not call databases, email APIs, or internal services directly.
- Agent inputs and outputs must use Mango-defined JSON schemas.
- The first classifier should be callable through an interface such as `EmailNodeClassifier`, not through provider SDK calls scattered across handlers.
- Provider adapters may exist for OpenAI, Anthropic, local models, or other services, but they must all return the same Mango result shape.
- Provider-specific run IDs, model names, token counts, and latency belong in observability metadata, not in canonical product decisions.
- The same workflow should run with a non-AI heuristic classifier for tests, local development, fallback, and cost control.
- Agent jobs must be idempotent. Re-running classification for the same email/thread and node candidate should not create duplicate suggestions.
- Agent work must be bounded by company, user, mailbox account, and explicit candidate nodes.

## Guardrails

- Email content is untrusted input. A message body must never be allowed to override system instructions, call tools, change permissions, send mail, or alter workflow state.
- V1 suggestions require user review. No automatic linking until quality metrics and product rules explicitly justify it.
- Sending email is out of scope for V1. Future draft/send flows must require final user approval.
- Every suggestion must include enough evidence for the user to understand why it was proposed.
- Every accepted or rejected suggestion must be auditable.
- Users must be able to see their complete email list even when suggestions are present.
- Access control must follow existing effective access rules. If a user cannot view a node, the agent must not suggest that node to them.
- Mailbox data must stay tenant-isolated. Cross-company candidate generation is forbidden.
- Avoid whole-company context reads. Candidate generation must use bounded queries, indexes, pagination, and explicit limits.
- Do not train external provider models on customer data unless the customer contract, provider contract, and product setting explicitly allow it.

## Target Components

### Mailbox Ingestion

Mango already has production Gmail OAuth concerns tracked in `production-gmail-oauth.md`. The agent project should not depend on one mailbox vendor forever.

Supported paths:

- Nylas as the current integration layer where it remains useful;
- direct Gmail API integration if needed later;
- direct Microsoft Graph integration for Outlook/Exchange;
- future enterprise mail providers through the same internal mailbox abstraction.

Mailbox ingestion should normalize:

- mailbox account;
- provider message ID and thread ID;
- sender and recipients;
- subject;
- snippet and body text;
- timestamps;
- labels/folders;
- attachment metadata;
- sync cursor or provider history token.

### Candidate Generation

The classifier should not be asked to compare one email against every node in a company.

Candidate generation should produce a small, explainable set of possible nodes using cheap signals first:

- existing linked sender or recipient on a node;
- subject or thread text matching node title/key terms;
- recent user activity near the email timestamp;
- node assignee, RACI users, or participants matching sender/recipient;
- Logic Gate or project folder proximity;
- previously accepted links in the same email thread;
- explicit user-selected node context from the UI.

The candidate generator should return a bounded list such as the top 5 to 20 node candidates per email/thread.

### Classifier Contract

The classifier receives only the email/thread and bounded candidate node summaries.

Example logical input:

```text
company_id
user_id
mailbox_account_id
email_thread_summary
candidate_nodes[]
existing_email_node_links[]
classification_policy
```

Example logical output:

```text
suggestions[]
  node_id
  confidence
  decision: suggest | weak_suggest | no_match
  reason
  evidence_refs[]
  risk_flags[]
```

The provider adapter can use any implementation internally, but the Mango service should only depend on this contract.

### Suggestion Persistence

Add or adapt tables around two concepts:

- `email_node_suggestions`: pending, accepted, rejected, stale, or superseded recommendations.
- `email_node_links`: canonical user-approved links between email threads/messages and nodes.

Suggested fields for `email_node_suggestions`:

- `company_id`
- `user_id`
- `mailbox_account_id`
- `email_thread_id`
- optional `email_message_id`
- `node_id`
- `confidence`
- `status`
- `reason`
- `evidence_refs` JSON
- `risk_flags` JSON
- `classifier_version`
- `provider_kind`
- `provider_model`
- `provider_run_id`
- timestamps for created, updated, accepted, rejected, and stale states.

The canonical `email_node_links` table should not require provider metadata to function. It should represent the product fact that a user or workflow linked an email/thread to a node.

### Review UI

Inbox surface:

- show the full mailbox list;
- show suggested node matches as secondary metadata;
- let users accept or reject a suggestion without leaving the list;
- avoid hiding emails that have no suggestion.

Node surface:

- show accepted linked emails;
- show pending suggested emails for that node;
- show evidence and confidence in a compact way;
- let users accept, reject, or open the full thread.

Admin/debug surface:

- expose classifier version, provider, run time, and failure reason for internal diagnosis;
- do not expose raw prompt internals to normal users unless a support/debug mode needs it.

## Project Phases

### Phase 0: Product And Data Discovery

- [ ] Inventory existing email tables, mailbox sync paths, and Nylas integration points.
- [ ] Inventory existing node/email linking behavior from email conversion flows.
- [ ] Decide whether V1 operates on email messages, email threads, or both.
- [ ] Decide whether suggestions are per-user, shared per-company, or hybrid.
- [ ] Define retention rules for email body text, snippets, and classifier artifacts.
- [ ] Define the first accepted/rejected feedback events.

Done when Mango has a written data contract for email records, node summaries, suggestions, and canonical links.

### Phase 1: Mailbox And Node Read Foundations

- [ ] Ensure mailbox reads are paginated and scoped by company, user, and mailbox account.
- [ ] Ensure node candidate reads use bounded indexed queries.
- [ ] Add or confirm canonical `email_node_links`.
- [ ] Add `email_node_suggestions` with idempotency constraints.
- [ ] Add audit fields for user decisions.
- [ ] Add repository tests for suggestion create/update/idempotency behavior.

Done when the backend can persist and query suggestions without an AI provider.

### Phase 2: Candidate Generator

- [ ] Build the first deterministic candidate generator.
- [ ] Use sender/recipient, subject keywords, existing links, user activity, and node participants as initial signals.
- [ ] Limit candidates per email/thread.
- [ ] Persist candidate-generation diagnostics for debugging.
- [ ] Add tests proving candidate generation does not scan unbounded company data.

Done when Mango can produce reasonable candidate nodes without calling a model.

### Phase 3: Agent-Abstraction Layer

- [ ] Define the `EmailNodeClassifier` interface.
- [ ] Define provider-neutral request and response structs.
- [ ] Add a deterministic/no-op classifier for tests and local fallback.
- [ ] Add one provider adapter behind the interface.
- [ ] Add timeout, retry, rate-limit, and budget controls.
- [ ] Add trace metadata without coupling product behavior to the provider.

Done when the classifier can be swapped without changing handlers, repositories, or UI contracts.

### Phase 4: Background Classification Jobs

- [ ] Trigger classification when new emails arrive.
- [ ] Trigger classification on demand from an inbox or node view.
- [ ] Reclassify when node context materially changes.
- [ ] Mark stale suggestions when email or node context changes enough to invalidate evidence.
- [ ] Make jobs idempotent and safe to retry.
- [ ] Add observability for latency, cost, failures, and suggestion volume.

Done when suggestions appear asynchronously and failures do not block normal email usage.

### Phase 5: User Review Experience

- [ ] Add inbox UI affordances for pending suggestions.
- [ ] Add node UI affordances for pending and accepted emails.
- [ ] Add accept/reject actions.
- [ ] Show concise evidence for each suggestion.
- [ ] Keep complete mailbox visibility available at all times.
- [ ] Add frontend tests for accept/reject state transitions.

Done when a user can review AI-suggested email-node matches without trusting automation blindly.

### Phase 6: Quality Loop

- [ ] Track accepted rate, rejected rate, ignored rate, and stale rate.
- [ ] Track precision by confidence band.
- [ ] Track classifier version performance over time.
- [ ] Use accepted/rejected links as feedback signals for future candidate generation.
- [ ] Add review tools for low-confidence or high-impact mistakes.

Done when Mango can measure whether the feature is actually helping.

### Phase 7: Follow-Up Recommendations

Only begin after V1 suggestion quality is acceptable.

- [ ] Detect threads linked to nodes with no reply after a configurable threshold.
- [ ] Use node context and thread state to recommend follow-up, not to send one.
- [ ] Show "follow up?" recommendations inside node and inbox views.
- [ ] Let users dismiss or request a draft.
- [ ] Record recommendation outcomes.

Done when Mango can recommend follow-ups without drafting or sending mail automatically.

### Phase 8: Draft Reply Assistance

Only begin after follow-up recommendations are trusted.

- [ ] Generate drafts using linked emails, node context, chats, and relevant activity.
- [ ] Show exactly what context was used.
- [ ] Require user review and explicit send approval.
- [ ] Keep provider tool access read-only during drafting.
- [ ] Add audit logs for draft creation and user-approved sends.

Done when Mango can help compose replies while the user remains the sender of record.

### Phase 9: Enterprise Hardening

- [ ] Add company-level AI provider configuration.
- [ ] Add provider allow/deny settings.
- [ ] Add per-company retention and redaction policies.
- [ ] Add data-residency and model-routing controls if needed.
- [ ] Add security review for prompt injection, data leakage, and mailbox permissions.
- [ ] Add billing/cost controls for classification volume.

Done when the feature is suitable for broad customer rollout.

## Initial Metrics

- candidate generation recall from reviewed samples;
- accepted suggestion rate;
- rejected suggestion rate;
- ignored suggestion rate;
- precision by confidence band;
- average suggestions per email/thread;
- classification latency;
- classification cost per mailbox per day;
- background job failure rate;
- user time saved, measured through product events where possible.

## Open Product Questions

- Should V1 classify individual messages, whole threads, or both?
- Are suggestions private to the mailbox owner, or should accepted links become company-visible on the node?
- Should low-confidence suggestions appear by default, or only behind an "other possible matches" view?
- Should attachment text be excluded from V1?
- What is the minimum evidence a suggestion must show to be useful?
- Should users be able to manually link an email to a node from the inbox as a non-AI baseline?

## Done Criteria For V1

V1 is done when:

- connected mailbox emails can be considered for node suggestions;
- candidate generation is bounded and tested;
- one provider adapter works behind a Mango-owned classifier interface;
- suggestions are persisted idempotently;
- users can accept or reject suggestions;
- accepted suggestions become canonical email-node links;
- rejected suggestions are recorded as feedback;
- permissions, tenant boundaries, and audit logs are covered by tests;
- no AI path can send email, change permissions, or hide mailbox messages.
