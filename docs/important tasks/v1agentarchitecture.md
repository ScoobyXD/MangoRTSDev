# Agent Service V1 Project Doc

This document is the architecture note, project document, and lightweight tracker
for adding the MangoRTS Agent Service.

The goal is simple:

```text
User clicks the agent icon on a node
-> MangoRTS gathers the node and Logic Gate context
-> Agent Service starts a Codex worker in an isolated branch/worktree
-> Codex does the requested code work or asks a clarification question
-> MangoRTS shows the agent status, chat, branch/worktree, and final summary
-> A human verifies and merges
```

Use **Agent Service** in product language, code, docs, and prompts.

## Core Decisions

- Agent Service is a separate service from the main MangoRTS app.
- Agent Service has zero database credentials.
- Agent Service interacts with MangoRTS like a normal user through MangoRTS APIs.
- Agent Service may read broad MangoRTS context through API permissions.
- Agent Service may create and update allowed MangoRTS records through APIs.
- Agent Service must not have delete permissions in V1.
- Agent Service must not directly write to the database.
- Codex is the worker that reads the repo, edits code, runs checks, and reports back.
- The node that launched the agent is the origin of the work, not a hard silo.
- The first useful milestone is node -> context bundle -> isolated worktree -> Codex running.

## Mental Model

Agent Service automates the current manual Codex workflow.

Today, a human can:

1. Look at a MangoRTS Logic Gate board for feature or bug requests.
2. Open a node.
3. Read the request, chats, emails, files, and screenshots.
4. Create a separate branch/worktree/IDE session.
5. Paste the request into Codex.
6. Let Codex implement the change.
7. Review and merge the result.

V1 should do the same thing without the human copy/paste step.

The service should not become a complicated multi-agent router. It should be a
thin execution service that knows how to:

- receive a launch request from MangoRTS
- fetch the latest context through MangoRTS APIs
- create an isolated Git branch/worktree
- start Codex with the context
- relay clarification questions and final summaries back to MangoRTS

## Product Flow

The agent icon can appear in either place:

- the node header
- the node card on the Kanban board

When a user clicks the icon:

1. MangoRTS creates or updates an agent run for that node.
2. MangoRTS moves the node from `requested` to `pending`.
3. MangoRTS sends the agent run to Agent Service.
4. Agent Service fetches the context bundle through MangoRTS APIs.
5. Agent Service creates an isolated branch/worktree from local `main`.
6. Agent Service injects the context into Codex.
7. Codex decides whether it can work immediately.
8. If Codex needs clarification, it posts a node chat question and the node stays `pending`.
9. If Codex can work, the node moves to `in_progress`.
10. Codex edits the repo, runs appropriate checks, and writes a final summary.
11. MangoRTS moves the node to `verify`.
12. A human reviews the branch/worktree and decides whether to merge.

V1 should not auto-merge to `main`.

## Status Flow

Use the board statuses the app already understands as much as possible.

```text
requested -> pending -> in_progress -> verify
```

Meanings:

- `requested`: user-created feature request or bug report is waiting for action.
- `pending`: agent run exists, context is being gathered, or Codex is asking clarifying questions.
- `in_progress`: Codex is actively working in an isolated branch/worktree.
- `verify`: Codex says the work is complete and a human should review it.

If the backend currently uses a different status key for the human review column,
do not start with a status migration. Map to the existing key and keep the
product label as needed.

## Context Bundle

Latency matters. Agent launch should avoid many slow round trips where possible.
Prefer one context-bundle API endpoint or a very small number of API calls.

The context bundle should include:

- latest projection of the Logic Gate
- latest projection of the launching node
- node title, body, fields, status, and metadata
- Logic Gate SOP or operating instructions
- all node text editor content
- all node chats/history
- all relevant emails connected to the node
- all node files and attachments
- screenshots and image attachments in a form Codex can read
- any useful linked context available through the app
- a MangoRTS explanation file for agents
- agent run id, launching user, company id, Logic Gate id, node id, and timestamps

The bundle should explicitly tell Codex:

- it is working inside MangoRTS
- the current workspace is a Logic Gate
- the launching node is the origin request
- it may inspect related app context through provided tools/API context
- it must not delete app data
- it should ask a node-chat question if the request is unclear
- it should write a final summary and branch/worktree details when done

Screenshots matter for UI bug reports and UI feature requests. V1 should treat
images as first-class context, not as optional decoration.

## Agent Identity And Permissions

Use a shared MangoRTS agent user for V1, for example:

```text
agent-service@mangorts.com
```

This is an application user, not a database user.

Allowed through MangoRTS APIs:

- read Logic Gates the agent user can access
- read nodes/cards the agent user can access
- read node chats, text editors, files, attachments, screenshots, and emails
- append node chat messages
- create/update agent run records
- move node status through allowed transitions
- write final summaries and branch/worktree metadata

Not allowed in V1:

- direct database credentials
- direct database writes
- deleting nodes
- deleting chats
- deleting files or attachments
- deleting Logic Gates
- deleting users or companies
- changing production cloud resources
- auto-merging to `main`

The Agent Service should look powerful from a product perspective, but boring
from a database perspective. It is just another app user that reads fast, writes
fast, and runs Codex in a repo workspace.

## Agent Run Record

MangoRTS should keep a durable run record even though the actual Codex session is
temporary.

The run record should track:

- company id
- Logic Gate id
- launching node id
- launching user id
- agent user id
- run status
- created at
- started at
- finished at
- branch name
- worktree path
- context bundle id or snapshot reference
- final summary
- error message, if any
- whether the run asked for clarification

The run record is the birth certificate. The final summary is the death
certificate.

Codex should also write a short starting note after it receives context:

- what it thinks the task is
- whether it needs clarification
- what it is going to inspect or change

## Worktree Behavior

Agent Service should create an isolated branch/worktree instead of working in the
main repo checkout.

The workflow should be similar in spirit to the existing human helper:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\new_codex_vscode.ps1 "<purpose>"
```

But the Agent Service does not need to open VS Code.

Expected V1 behavior:

- base the worker from local `main`
- fetch `origin/main` only to verify local `main` contains GitHub's latest `main`
- allow local `main` to be ahead of GitHub
- create a unique branch name from the agent run and node title
- create a separate worktree under a predictable local path
- write the context bundle into the worktree in an ignored agent/context location
- start Codex headlessly in that worktree
- capture branch, worktree path, checks run, and final summary

Possible branch format:

```text
agent/0001234-fix-login-redirect
```

Possible worktree root:

```text
C:\tmp\mangorts-agent-worktrees\0001234-fix-login-redirect
```

Do not open a new IDE for V1 Agent Service runs.

## Clarification Loop

If Codex does not understand the request, it should not guess.

Instead:

1. Codex posts a concise question in the node chat.
2. The node remains `pending`.
3. The agent run is marked as waiting for user input.
4. The user answers in node chat.
5. The user clicks the agent icon again, or MangoRTS resumes the run if resume is easy.

For V1, clicking the icon again after a user reply is acceptable. Do not build a
permanently running agent listener just to wait for replies.

## Implementation Phases

There are exactly two implementation phases for V1.

### Phase 1: MangoRTS Launch And Context

Status: not started

Goal: clicking the agent icon creates a durable run and gives Agent Service the
context it needs.

Tasks:

- [ ] Add an agent icon/action to node headers and/or Kanban node cards.
- [ ] Add or reuse an `agent_runs` persistence model.
- [ ] Add a backend endpoint to start an agent run from a node.
- [ ] Move the node from `requested` to `pending` when a run starts.
- [ ] Add a context-bundle API for the launching node.
- [ ] Include Logic Gate projection, node projection, chats, editors, emails, files, and screenshots.
- [ ] Include the MangoRTS agent explanation text in the context bundle.
- [ ] Add APIs for Agent Service to append node chat messages.
- [ ] Add APIs for Agent Service to update allowed node statuses.
- [ ] Show agent run status and branch/worktree metadata in the UI when available.

Acceptance criteria:

- Clicking the icon creates an agent run.
- The node moves to `pending`.
- A context bundle can be fetched through MangoRTS APIs with no DB credentials.
- The context includes screenshots/attachments in a Codex-readable form.
- Agent Service can post a chat message as the agent user through the API.

### Phase 2: Agent Service Codex Runner

Status: not started

Goal: Agent Service receives a run, creates an isolated worktree, starts Codex
with the context, and reports back to MangoRTS.

Tasks:

- [ ] Create the separate Agent Service.
- [ ] Configure Agent Service with MangoRTS API base URL and agent-user auth.
- [ ] Do not configure database credentials.
- [ ] Receive or poll for agent runs.
- [ ] Fetch the context bundle through MangoRTS APIs.
- [ ] Create a unique branch/worktree from local `main`.
- [ ] Write the context bundle into the worktree.
- [ ] Start Codex headlessly with the context.
- [ ] Move the node to `in_progress` when Codex begins code work.
- [ ] Relay clarification questions to node chat and leave the node `pending`.
- [ ] Capture final summary, branch, worktree path, and checks.
- [ ] Move the node to `verify` when Codex finishes.

Acceptance criteria:

- A real node launch can start Agent Service.
- Agent Service creates an isolated branch/worktree.
- Codex receives the node and Logic Gate context.
- Codex can ask a clarification question in node chat.
- Codex can complete work and report branch/worktree details.
- MangoRTS shows enough information for a human to review and merge manually.

## Do Not Build In V1

- Always-on agents watching every node.
- One app account per agent run.
- Direct DB credentials in Agent Service.
- Agent-side delete permissions.
- Automatic merge to `main`.
- Automatic production deploy.
- Complex multi-agent routing.
- Production-level scoped agent-run tokens.
- A new VS Code IDE per agent run.

## Prompt For The Next Codex Instance

Copy/paste this into the new Codex instance that will implement the project:

```text
You are working in C:\Users\Jonat\MangoRTSDev on MangoRTS.

Read docs/agents/v1agentarchitecture.md first. It is the project doc and tracker
for Agent Service V1. Follow it closely.

Important project decisions:
- Use the name Agent Service in new code, docs, and product language.
- Agent Service is separate from the main MangoRTS app.
- Agent Service has zero database credentials.
- Agent Service acts like a normal MangoRTS user through MangoRTS APIs.
- Agent Service must not have delete permissions in V1.
- Codex is the worker that edits code in an isolated branch/worktree.
- The node that launched the agent is the origin request, not a hard scope silo.
- V1 must not auto-merge to main.
- Screenshots and image attachments are first-class context.

Implement this in exactly two V1 phases:

Phase 1: MangoRTS Launch And Context
- Add the app/backend pieces for clicking an agent icon on a node.
- Create a durable agent run.
- Move the node from requested to pending.
- Add a context-bundle API with Logic Gate projection, node projection, chats,
  editors, emails, files, screenshots, and MangoRTS agent explanation text.
- Let the agent user append chat messages and update allowed node statuses
  through MangoRTS APIs.
- Surface agent run status and branch/worktree metadata in the UI when available.

Phase 2: Agent Service Codex Runner
- Create the separate Agent Service.
- Configure it with MangoRTS API access only, never DB credentials.
- Receive or poll for agent runs.
- Fetch context through MangoRTS APIs.
- Create an isolated branch/worktree from local main.
- Write the context bundle into the worktree.
- Start Codex headlessly with that context.
- Relay clarification questions to node chat.
- Move nodes through pending, in_progress, and verify.
- Report final summary, checks, branch, and worktree path back to MangoRTS.

Repo notes:
- Backend is in backend/ and is Go module miraeopus/backend.
- Frontend is in frontend/ and is a Vite/React app.
- There is no root package.json.
- Use existing repo patterns before inventing new abstractions.
- Do not run destructive commands, reset Git history, delete databases, or use
  database writer/admin access.
- Before any AWS or database work, follow AGENTS.md and run the access-boundary
  check described there.

Start by inspecting the existing backend/frontend patterns for nodes, Logic
Gates, chats, attachments, emails, statuses, and auth. Then update the tracker
checkboxes in docs/agents/v1agentarchitecture.md as work is completed.
```
