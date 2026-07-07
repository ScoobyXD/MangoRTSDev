# V1 Agent Architecture Prototype

This document records the first simple decision for adding Hermes-style agents to MangoRTS.

The goal is not to design the final agent system yet. The goal is to get a basic prototype working.

## Core idea

Agents are not always-on workers.

For V1, an agent is a short-lived run:

1. A user clicks an agent icon on a node card.
2. MangoRTS creates an agent run record.
3. A temporary Hermes agent session starts.
4. The agent reads the Logic Gate SOP and the node card.
5. The agent either asks for more information or does the work.
6. The agent writes a summary of what happened.
7. The agent session ends.

The agent disappears after the run, but MangoRTS keeps the durable record of what happened.

## First user flow

The first prototype use case is a coding agent for a Logic Gate Kanban board.

1. A user creates or receives a node card on a Logic Gate Kanban board.
2. The card shows an agent icon.
3. The user clicks the agent icon.
4. MangoRTS starts an agent run for that one card.
5. The agent reads:
   - the Logic Gate SOP
   - the node card title and details
   - the node chat/history
   - any useful linked context
6. If the request is unclear, the agent posts a question in the node chat and stops.
7. If the request is clear, the agent moves the card to `In Progress`.
8. The agent attempts the work.
9. When done, the agent posts a summary and moves the card to `Verify`/`Review`.
10. A human verifies the result.

For now, the user can click the agent icon again after replying to a question. We do not need a permanently running agent waiting for replies.

## Agent identity

For the first prototype, all temporary agent sessions can use one MangoRTS agent account.

Example account:

```text
hermes-agent@mangorts.com
```

This account is the API identity used by Hermes when it needs to read or write MangoRTS data.

The account can:

- read the relevant Logic Gate
- read the relevant node card
- read and write node chat messages
- move the node card between allowed statuses
- write agent summaries

This keeps V1 simple. We do not need a new email/account for every agent run.

## Agent runs are still separate

Even if all agents use one account, each temporary session needs its own agent run record.

An agent run should record:

- which company it belongs to
- which Logic Gate it belongs to
- which node/card it belongs to
- who started it
- when it started
- when it ended
- current status
- final summary
- error message, if any
- link to the Hermes session/task, if available

This lets MangoRTS answer:

> What was this agent asked to do, what did it do, and when did it do it?

## Important distinction

There are two identities involved:

### Agent account

The shared MangoRTS account that authenticates API calls.

Example:

```text
hermes-agent@mangorts.com
```

### Agent run

The specific temporary session working on one node card.

Example:

```text
Agent run 1842 on node "Fix login redirect bug"
```

Many agent runs can use the same agent account.

## V1 authentication approach

For the basic prototype, Hermes can call MangoRTS APIs using the shared agent account.

That is enough to prove the loop:

1. click agent icon
2. start Hermes
3. Hermes reads MangoRTS data
4. Hermes writes chat/status updates
5. Hermes exits
6. MangoRTS shows the result

## V2 safety direction

The shared account should not stay broad forever.

Later, MangoRTS should issue short-lived scoped agent-run tokens.

A scoped token would say something like:

```text
This token belongs to agent run 1842.
It may only read Logic Gate A.
It may only read/write Node B chat.
It may only move Node B through allowed statuses.
It expires soon.
```

This protects the app if an agent makes a bad decision or a token leaks.

But this is not required for the first prototype.

## Node chat

The agent needs a durable place to ask questions and leave summaries.

For V1, the simplest acceptable behavior is:

- agent questions appear in the node chat
- user replies appear in the same node chat
- final agent summary appears in the same node chat

If the current node chat is not durable enough, we should add a simple server-side agent message table.

The important point is that the agent should not hold context forever. It should be able to reconstruct context from the node, the Logic Gate SOP, and the stored chat history.

## Card status behavior

The agent should use the same statuses the board already understands.

Expected V1 transitions:

```text
Requested/Pending -> In Progress -> Verify/Review -> Done
```

If the agent needs more information, the card can stay where it is and the agent run can be marked as waiting for user input.

The product may call the human-check column `Verify`, while the backend may still use the existing `review` status key. We should avoid a status migration until needed.

## Backend pieces needed for the prototype

Minimum V1 backend pieces:

1. An `agent_runs` table.
2. A way to create an agent run when the user clicks the card icon.
3. A way for Hermes to read the Logic Gate SOP and node/card context.
4. A way for Hermes to write node chat messages.
5. A way for Hermes to move the card status.
6. A way to store the final agent run summary.

Optional but useful:

- agent run logs
- current run status on the card
- cancel button
- retry button
- link to Hermes session/task

## Frontend pieces needed for the prototype

Minimum V1 frontend pieces:

1. Show an agent icon on node cards.
2. Let the user click it to start an agent run.
3. Show a simple running/waiting/done indicator.
4. Show agent messages in node chat.
5. Refresh the card when the agent moves it.

## Prototype principle

Keep the first version simple.

Do not start with:

- always-on agents
- agents automatically watching every card
- one email per agent run
- a complex multi-agent router
- production-level scoped tokens

Start with:

```text
one shared agent account
one clicked card
one temporary Hermes run
one durable run record
one node chat thread
one final summary
```

That is the foundation.
