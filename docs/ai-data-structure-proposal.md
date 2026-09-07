# AI data structure

Implemented in source. The repository SQL must be applied by a human operator before enabling the integration.

A **chat** is the whole saved exchange. A **message** is one user or AI message in that chat. A **run** is one execution, which can answer, perform actions, or both. An **action** records one committed change to Mango data. An empty saved chat has no run; an ordinary reply has a run but no action.

Follow Hermes's existing storage conventions where they fit Mango: plain strings in text columns, structured events and command results in JSON. Preserve its exact session and message IDs. PostgreSQL uses `JSONB` where Hermes's SQLite stores serialized JSON in `TEXT`.

## Tables and columns

Every table has `company_id UUID` and `user_id UUID`, using the existing company and user identities. Every link includes both scope columns.

### ai_chats

| Column | Type | Value |
| --- | --- | --- |
| `company_id` | UUID | Owning company |
| `user_id` | UUID | Owning user |
| `chat_id` | TEXT | Exact Hermes session ID; Mango supplies it when starting a new chat |
| `name` | TEXT | Display name, such as `Invoice review` |
| `created_timestamp` | TIMESTAMPTZ | When the chat was created |

Primary key: `(company_id, user_id, chat_id)`. Creating an empty chat saves this row without invoking Hermes.

### ai_messages

| Column | Type | Value |
| --- | --- | --- |
| `company_id` | UUID | Same company as the chat |
| `user_id` | UUID | Same user as the chat |
| `message_id` | BIGINT | Hermes's exact native integer message ID, such as `147` |
| `chat_id` | TEXT | Required link to the whole chat |
| `run_id` | UUID, nullable | Local run only when the source proves that association |
| `role` | TEXT | `user` or `ai` |
| `content` | TEXT | Literal visible message text |
| `created_timestamp` | TIMESTAMPTZ | Hermes's original message timestamp |

Primary key: `(company_id, user_id, message_id)`. There is no separate order or position column. Native message IDs preserve insertion order when timestamps tie or the clock moves backward. The UI displays the latest page in that order and can load older messages.

Hermes calls the AI role `assistant`; the adapter translates it at the boundary. Native tool messages, reasoning and hidden compaction instructions do not become visible chat messages. Text parts are decoded using Hermes's display projection. Full native multimodal data remains in Hermes.

The pinned native transcript does not store a run ID on each message. The import leaves `run_id` null rather than matching by text or time. Repeated equal text can be two real messages. A full native snapshot removes obsolete copied representations after compaction; native message IDs are never translated or replaced with Mango IDs.

### ai_runs

| Column | Type | Value |
| --- | --- | --- |
| `company_id` | UUID | Execution's company |
| `user_id` | UUID | User whose authority applies |
| `run_id` | UUID | Mango's stable ID, allocated before sending |
| `hermes_run_id` | TEXT, nullable | Native execution ID, such as `run_` followed by 32 hexadecimal characters |
| `chat_id` | TEXT, nullable | Exact chat in the same scope |
| `status` | TEXT | `pending`, `running`, `stopping`, `completed`, `failed`, `cancelled`, or `interrupted` |
| `pending_input` | TEXT, nullable | Original text while native acceptance is uncertain; cleared on binding or terminal status |
| `history` | JSONB | Ordered array of recorded lifecycle, model, tool, reply and committed-action events |
| `created_timestamp` | TIMESTAMPTZ | When Mango reserved the execution |

Primary key: `(company_id, user_id, run_id)`. One company/user pair can have only one nonterminal run. A run may have no chat in the schema; the current chat UI always starts runs from chats.

The two run IDs are necessary because Mango needs retry protection before Hermes assigns its ID. The first submission under a local run ID wins. A retry sends that saved chat and text, even if replacement input arrives under the same ID. A different request needs a new ID. There is no request ID, payload hash, source-message link, cancelled flag or settled flag on the run.

Example history entry:

```json
{
  "id": "run_abc:call_123:tool.completed",
  "event": "tool.completed",
  "created_timestamp": "2026-09-07T01:20:00Z",
  "data": {
    "tool_name": "mango_create_node",
    "tool_call_id": "call_123",
    "succeeded": true
  }
}
```

History array order is successful append order. Stable event IDs make retries harmless. Supported Hermes hooks write a durable delivery queue in its scoped home before sending observations to Mango, so recording does not require an open browser. Raw provider reasoning, credentials and tool payloads are excluded. A session-end observation confirms the native executor status before its delivery is acknowledged; queued retries finish that check without requiring a browser. Unknown executions never gain a local run association merely by sharing a chat. Definitively rejected callbacks stay in the scoped queue for inspection without blocking later runs.

### ai_actions

| Column | Type | Value |
| --- | --- | --- |
| `company_id` | UUID | Same company as the run |
| `user_id` | UUID | Same user as the run |
| `run_id` | UUID | Required local run link |
| `action_name` | TEXT | Command, initially `mango_create_node` |
| `action_key` | TEXT | SHA-256 hex digest of normalized command arguments |
| `result` | JSONB | Saved result of the committed business command |

Primary key: `(company_id, user_id, run_id, action_name, action_key)`. All mutations use this one table. Reads and failed attempts appear in run history but do not create committed-action receipts.

For Node creation, `action_key` hashes the exact Process ID, Step ID and trimmed title, with UUIDs normalized to lowercase. It is a 64-character value, for example `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` (illustrative digest only). Repeating those arguments during the same run returns the original `result`, regardless of tool-call ID. The business change, result and committed-action history event share one transaction.

An action's chat is reached through its run. Receipts grant no access and do not replace live Process/Step/Node relationships. Replaying a receipt never recreates a subsequently deleted Node.

## Ownership and scope

Chats, messages, runs and actions use exact scoped foreign keys. Membership removal denies access while retaining historical retry protection; permanent company or user deletion cascades through the Mango records. There is no individual chat-deletion API in this layer.

Scheduled jobs and scheduled runs are not implemented. Native memory, learned skills, full session SQLite storage, response continuity and provider execution remain owned by Hermes.

See [Hermes business laws](tests/hermes.md), [relationship laws](tests/relationships.md) and [runtime setup](../hermes/README.md).
