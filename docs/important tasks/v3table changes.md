# Process Story

A Mango user creates a Node and adds textboxes. Textbox bodies are stored only in `node_textboxes`, and textbox-owned comments and seen markers disappear when their textbox no longer exists. If a comment's author account was deleted, the comment and captured display name remain while its relational user ID becomes null. When an email is downloaded, Mango stores its thread and messages once, and `email_relationships` connects a selected message to a Node, Project, Logic Gate, or one of their textboxes. During V3, an older Attached-email snapshot with no durable thread/message is copied into those permanent tables only after exactly one mailbox is proven; the existing Attached-email information ID remains the relationship ID. Deleting a host removes only the relationship: normalized email, draft content, and email attachment links survive independently. Converting an email into a Node is an ordinary workflow: store the email, create the Node, create the relationship, and use normal resource permissions. Shared email drafts are stored in `email_drafts` and receive access from the related resource rather than a special collaboration-participant subsystem. No current Node editor content is written to `node_information` or `node_projection_table` after the cutover.

V3 must be released through separate operator-gated phases: create the permanent destinations, copy without deleting legacy sources, reconcile the copy, switch the application, observe a soak period, and retire legacy storage only in a later release.

# V3 table changes implementation handoff

## Purpose

This document is the implementation target and incident record for retiring the remaining Node information/projection storage and the special email collaboration/placement tables.

The implementation must update the canonical schema, provide separately operated and verified migration phases, update backend and frontend reads/writes, update tests and process documentation, and leave the repository capable of creating a clean database directly from `backend/db/schema.sql`.

An agent must not apply the migration to a live database. Repository agents may inspect a live database only with the designated database-enforced read-only credential. Never retrieve or print writer/admin credentials or unrelated secrets.

## Current status: the first V3 cutover was rolled back

The 2026-08-02 V3 attempt is abandoned. Do not revive or run the removed migration as-is.

- `841292a6` introduced the all-at-once V3 application and database cutover on worktree branch `codex/implement-v-database-table-changes0000672`.
- `1dfa8fd4`, `7218542e`, and `b5389fb2` fixed early validation defects and added the guarded legacy Node-textbox backfill.
- Worktree branch `codex/independently-audit-v-cutover-migration-failures0000675` then added a read-only preflight and successive fixes for deleted owners, lock ordering, deleted authors, and legacy email normalization.
- The migration had grown to roughly 2,200 lines and the application cutover affected about 100 files. It still discovered new live-data categories one failure at a time.
- `d4395940` removed the V3 migration and restored the application, canonical schema, tests, and helper scripts to the pre-V3 tree based on `b856962b`.
- `28ea506f` repaired two stale frontend test-runner references exposed by that rollback.
- `5c34b2f4` merged the rollback branch into `main`. The full repository test gate passed. A deployment environment must still be checked independently; a Git rollback does not prove which application revision is running.

Every attempt to run `20260802_zz_v3_database_table_cutover.sql` was rolled back. The development database therefore did not receive the V3 schema cutover. Two separately approved and committed data remediations did survive and must not be forgotten:

- 32 legacy HTML-envelope Node textbox projections were converted and inserted into `node_textboxes`. The backfill printed `converted:32`, `inserted:32`, and `remaining:0` only after `COMMIT`; a later PowerShell `Trim()` error happened during the zero-row post-check and did not undo those inserts.
- 113 orphan `node_content_changes` rows across 18 legacy textbox IDs were deleted in a separate guarded transaction after evidence showed that no permanent textbox or visible legacy projection survived.

Do not assume the development database is identical to either the original pre-V3 fixture or the rolled-back repository schema. Reinventory it with read-only queries before designing the replacement.

## Current implementation: additive Node chat baby phase

The repository now contains one deliberately small first phase. It has not been applied to a live database, it does not switch application reads or writes, and it does not delete or update any legacy row.

Jonat's manual operation is intentionally reduced to two copy-paste SQL files:

1. `scripts/v3_node_textbox_chats_step1_count.sql` runs in a repeatable-read, read-only transaction. It reports the current legacy chat count, exact `chats_to_copy`, missing-textbox rows, review rows, exception identities without message bodies, and the physical storage breakdown.
2. `scripts/v3_node_textbox_chats_step2_create_copy_verify.sql` is the one-time writer-paused operation. One outer transaction creates the new table and migration controls, copies the current chats, reconciles them, verifies the final count, and commits. Any review row or mismatch rolls the whole operation back.

The component files below remain because automated tests exercise expansion, copy, and reconciliation separately. Operators should use the two step files above rather than assembling the components by hand.

1. `scripts/inspect_v3_node_chat_storage.sql` is a read-only query that proves the current chat source and separates live row counts from heap, index, and TOAST storage. Run this first in the approved read-only database session.
2. `scripts/v3_node_textbox_chats_expand_component.sql` is the reusable expansion component embedded in Step 2. It creates `node_textbox_chats`, migration ledgers, and the versioned `v3_node_textbox_chat_source_v1` classifier without copying data. It deliberately lives outside `backend/db/migrations` so deployment cannot run it ahead of the operator-controlled Step 2.
3. `scripts/copy_v3_node_textbox_chats.sql` is the separately operated snapshot copy. It consumes the shared classifier, uses a short transaction, preserves legacy chat IDs, writes a disposition for every source row, and never mutates a legacy table.
4. `scripts/verify_v3_node_textbox_chats.sql` is the read-only reconciliation. It reports later deltas, exact copies, deleted-host dispositions, detached parents, and rows requiring review without printing chat bodies.
5. `docs/tests/v3-node-textbox-chat-migration.md` records the business rules and required test scenarios. `backend/internal/store/v3_node_textbox_chat_migration_test.go` contains static safety checks plus an opt-in disposable-PostgreSQL rerun test.

The current source rule is exact:

- `node_projection_table` is the current UI authority for `Text block chat` rows. The application lists active projection rows and the frontend filters and parses this type.
- The projection `information_id` is the permanent `chat_id`.
- JSON payload `block_id` is the owning permanent `textbox_id`.
- `node_information` is event/history storage. It is not the set to copy merely because it contains rows whose type is `Text block chat`.
- The copy is only a snapshot. While the old application remains live, later chats continue to land in the legacy tables and appear as `ready_to_copy` on the next run. A final delta still requires paused writers before application cutover.

The 3.3 GB label shown for `node_information` is a physical relation-size measurement, not a live-row count. PostgreSQL relation size can include the main heap, indexes, out-of-line TOAST values, and space still occupied by old/dead row versions. Six hundred fifty live rows can therefore coexist with a multi-gigabyte relation. Use the inspection script to see each component and `pg_stat_user_tables.n_live_tup`/`n_dead_tup`; do not run `VACUUM FULL`, `CLUSTER`, or another table rewrite as part of this data-copy phase. Ordinary database maintenance is a separate operator decision after the actual size cause is measured.

Rows with valid data and a surviving permanent host are copied. A deleted user leaves a null `author_user_id` but retains the captured author name and message. A missing same-textbox parent detaches the reply. A missing host is recorded as `discarded_deleted_host` without deleting the source. Invalid JSON, invalid identities, ambiguous email selections, duplicate company chat IDs, and target conflicts are recorded as `needs_human_mapping` and left untouched.

This scoped phase does not authorize a full V3 cutover. The application must remain on legacy chat reads/writes until a later maintenance-window release has a zero-review final delta, reconciliation, rollback plan, and runtime cutover.

## What happened during the failed attempt

The sequence below is evidence for the next implementation, not a checklist to rerun.

1. Exact-column validation compared PostgreSQL arrays in an order- and collation-sensitive way. The first two failures were repository defects, fixed by `1dfa8fd4` and `7218542e`.
2. The migration assumed every active `Text box` projection already had an exact permanent `node_textboxes` row. Read-only diagnostics found 32 exceptions, all legacy HTML envelopes in one company. They were valid dual-write/backfill gaps, not corrupt editor content, and were converted by the guarded backfill from `b5389fb2`.
3. The next failure assumed every `node_content_changes.information_id` resolved to a permanent textbox. Diagnostics found 113 rows across 18 deleted legacy textbox IDs. Historical deletion had no foreign key and could leave those audit rows behind; the old UI already hid them through an inner join.
4. The next failure treated every stored chat row as current permanent content. Diagnostics found 12 active comments referring to six absent host textbox IDs and one reply whose parent did not resolve on the same textbox. The old UI rendered chats only through surviving textbox panes, so hostless rows could remain stored but invisible. Historical `information_id` is the chat ID; payload `block_id` is the host textbox ID. V3 did not invent that identity rule.
5. The first preflight reported 69 blocker rows across 15 categories: 12 hostless chats, one missing/wrong parent, 22 orphan seen snapshots, 33 draft source rows, and one incomplete attached-email attachment identity. Those classifications later changed as product rules and mapping evidence were established, proving the original preflight was not a stable contract.
6. The real migration deadlocked while upgrading locks against an active writer. `21e250d2` added up-front table locks, but this exposed that the all-at-once transaction held a very large lock and failure surface.
7. A surviving chat referenced a deleted user. The new foreign key rejected its `author_user_id`. The correct rule is to preserve the comment and captured display name while setting the nullable relational user ID to null, matching `ON DELETE SET NULL` behavior.
8. An attached-email projection contained legacy HTML beginning with `<`, and the migration attempted a JSON cast before safely classifying it. A preflight validity check elsewhere did not protect a different SQL path. All legacy text must be validated before any cast, and every consumer must use the same classified source.
9. The migration assumed an older Attached-email snapshot already had exactly one normalized thread/message target. Read-only inventory found 280 legacy snapshots requiring normalization. The July durable-email rollout had intentionally left older projection snapshots readable without backfilling `communications_email_threads` and `communications_email_messages`; their absence was expected legacy state, not disposable email data.
10. The expanded preflight eventually reported 25 categories, 64 blocker rows, 295 cleanup rows, and 33 review rows. The 295 cleanup count included all 280 legacy email snapshots, while a subset also appeared in the 64 unresolved/ambiguous mailbox-owner blockers. These aggregate totals were category counts, not unique records, but the output did not make that clear.
11. Dry-run/preflight logic and real-migration logic were separate implementations. A reassuring dry run could therefore be followed by a different real-run failure such as `cannot assign fallback email snapshot to exactly one normalized thread`. The next design must share mapping code or database views between inventory, copy, and reconciliation.
12. V3 application code was run against the still-pre-V3 database after the migration rolled back. Background workers repeatedly failed because `email_thread_download_jobs` did not exist, and editor access failed. Application and schema compatibility had been switched too early, so the repository/application cutover was rolled back completely.

## Root-cause classification

### Repository and rollout defects

- One transaction tried to create destinations, transform data, enforce new foreign keys, rename identities, switch contracts, and drop rollback sources.
- The migration encoded unproved assumptions about dual writes, deleted owners, chat visibility, author retention, email normalization, drafts, attachment identity, and mailbox ownership.
- Validation was ordered incorrectly in several places: unsafe casts or foreign-key inserts happened before the row was classified.
- The preflight did not share the migration's mapping implementation and its categories changed during the incident.
- Migration tests mostly inspected SQL strings and fixture text. They did not execute every phase against PostgreSQL, rerun it, and check rollback boundaries.
- The application was not backward-compatible with the pre-V3 schema, so deploying it before a proven database cutover caused immediate runtime failures.
- PowerShell wrappers converted expected nonzero readiness exits and empty post-check results into noisy exceptions, obscuring whether database work had committed.

### Expected legacy drift

- The 32 missing permanent Node textboxes were legacy HTML dual-write gaps and were recoverable without inventing IDs.
- Orphan content-change rows and seen snapshots could remain after textbox deletion because the old model lacked permanent foreign keys.
- Hostless chats could survive incomplete multi-request deletion even though the old UI no longer displayed them.
- Deleted chat authors could remain inside JSON because no relational foreign key cleared the embedded ID.
- Older Attached-email snapshots could legitimately lack normalized thread/message rows because the July rollout did not backfill historical snapshots.

### Genuinely ambiguous data

- Active user content must remain a blocker until its ownership or approved deletion rule is proven. Do not create fake empty textboxes or silently discard active comments.
- An email snapshot with zero or multiple exact mailbox candidates must remain for human review. Do not guess from subject, sender, body, snippet, or timestamp.
- Draft source/sent-message references that do not resolve to a normalized message are review items unless another durable identity proves the mapping.
- Counts from different preflight categories may overlap. Reports must include both category counts and unique source identities so operators know the actual number of affected records.

## Non-negotiable decisions

- Node textboxes do not have titles.
- `node_textboxes.body_json` is the only current Node textbox-body store.
- Node textbox comments live in `node_textbox_chats`.
- A surviving historical chat whose author no longer exists keeps its message and `author_display_name`; its nullable `author_user_id` becomes null, matching the permanent foreign key's `ON DELETE SET NULL` behavior.
- There is no separate `email_id`. `email_message_id` is Mango's permanent internal ID for an email message.
- Every email message belongs to an `email_thread_id`, including a one-message thread.
- `email_threads`, `email_messages`, `email_relationships`, and `email_drafts` are the permanent email content tables.
- The table must be called `email_relationships`, not `email_placements`.
- The draft table must be called `email_drafts`.
- Email relationships do not contain `attached_by_user_id`, `created_from_email`, or special Node-conversion flags.
- Email conversion into a Node does not have a special database subsystem.
- Shared-draft access comes from normal Node, Project, or Logic Gate permissions.
- There is no email-collaboration participant table after the cutover.
- Attachments remain in `attachments` and `resource_attachments`; do not add attachment blobs or attachment arrays to the new chat or relationship tables.
- Textbox-owned chats, their attachment links, and seen snapshots are discarded when no permanent host textbox survives; a surviving reply with no surviving same-textbox parent becomes a top-level comment.
- Deleting a Node or textbox removes its email relationship, not the normalized `email_threads` or `email_messages` content.
- Email drafts and attached-email attachment links survive a deleted relationship; an attachment without a surviving relationship targets its exact normalized `email_message`.
- The migration must fail on unexpected schema or unmapped data. Do not hide schema drift with broad `IF EXISTS` or `IF NOT EXISTS` statements.
- Preserve existing permanent IDs whenever possible so deep links, attachment relationships, and realtime identities remain stable.

## Final Node schema

### `node_textboxes`

This table already exists and remains the only current Node textbox-body store.

```sql
company_id        uuid        not null
node_id           uuid        not null
textbox_id        uuid        not null
body_json         jsonb       not null
revision          bigint      not null default 0
display_order     bigint      not null default 0
created_timestamp timestamptz not null default now()
updated_timestamp timestamptz not null default now()
deleted_timestamp timestamptz
```

Required keys and rules:

- Primary key: `(company_id, node_id, textbox_id)`.
- Foreign key: `(company_id, node_id)` references `nodes(company_id, node_id)` with cascade delete.
- `body_json` must remain valid Mango TipTap JSON.
- `revision >= 0`.
- No title column is added.

The following old projection-payload keys disappear with `node_projection_table`. They are JSON keys, not SQL columns:

```text
title
attachments
email_message_id
email_accent
document
```

### New `node_textbox_chats`

This replaces Node `Text block chat` rows in `node_information` and `node_projection_table`.

```sql
company_id                 uuid        not null
chat_id                    uuid        not null
node_id                    uuid        not null
textbox_id                 uuid        not null
parent_chat_id             uuid
selection_source           text        not null default 'text'
selection_textbox_id       uuid
selection_email_message_id uuid
selection_quote            text        not null default ''
selection_start            integer
selection_end              integer
author_user_id             uuid
author_display_name        text        not null default ''
message                    text        not null default ''
entity_links               jsonb       not null default '[]'::jsonb
mentioned_user_ids         uuid[]      not null default '{}'::uuid[]
mentioned_group_ids        uuid[]      not null default '{}'::uuid[]
revision                   bigint      not null default 1
created_timestamp          timestamptz not null default now()
updated_timestamp          timestamptz not null default now()
deleted_timestamp          timestamptz
```

Required keys and rules:

- Primary key: `(company_id, chat_id)`.
- Unique key: `(company_id, node_id, textbox_id, chat_id)`.
- `(company_id, node_id, textbox_id)` references `node_textboxes` with cascade delete.
- A parent chat must belong to the same company, Node, and textbox.
- `selection_source` is `text` or `email`.
- Text selections may use `selection_textbox_id`.
- Email selections may use `selection_email_message_id`.
- Selection offsets must both be null or satisfy `0 <= selection_start <= selection_end`.
- `entity_links` is a JSON array containing the existing `{start, end, entity_type, entity_id, label}` shape.
- `revision > 0`.
- Attachment-only comments remain legal, so the database must not require nonblank `message` without considering attachments.
- Preserve the old projection `information_id` as `chat_id` during backfill.

Chat attachments remain in `resource_attachments`:

```text
resource_type = 'node_chat_message'
resource_id   = chat_id
```

Do not add separate chat-attachment, chat-participant, chat-user-mention, or chat-group-mention tables.

Recommended indexes:

```text
idx_node_textbox_chats_textbox_created
  (company_id, node_id, textbox_id, created_timestamp, chat_id)
  where deleted_timestamp is null

idx_node_textbox_chats_parent
  (company_id, node_id, textbox_id, parent_chat_id)
  where parent_chat_id is not null and deleted_timestamp is null

GIN indexes on mentioned_user_ids and mentioned_group_ids if query plans require them
```

### New `node_textbox_seen_snapshots`

This replaces `node_projection_seen_snapshots` and preserves the existing unseen-text-change behavior.

```sql
company_id                uuid        not null
node_id                   uuid        not null
textbox_id                uuid        not null
user_id                   uuid        not null
body_json                 jsonb       not null
textbox_revision          bigint      not null
textbox_updated_timestamp timestamptz not null
seen_timestamp            timestamptz not null default now()
```

Required keys and rules:

- Primary key: `(company_id, node_id, textbox_id, user_id)`.
- `(company_id, node_id, textbox_id)` references `node_textboxes` with cascade delete.
- `user_id` references `users(user_id)` with cascade delete.
- Store the exact textbox baseline needed by the existing unseen-change comparison.

### Changed `node_content_changes`

This product-history table stays because the UI displays unseen authored changes.

Rename:

```text
information_id -> textbox_id
```

Final columns:

```sql
company_id         uuid        not null
change_id          uuid        not null
node_id            uuid        not null
textbox_id         uuid        not null
change_type        text        not null
text               text        not null
start_offset       integer     not null
end_offset         integer     not null
actor_user_id      uuid
actor_display_name text        not null default ''
created_timestamp  timestamptz not null default now()
```

Add a foreign key from `(company_id, node_id, textbox_id)` to `node_textboxes`. `node_content_change_seen` remains unchanged.

## Final email schema

### `email_threads`

This replaces `communications_email_threads`.

```sql
company_id               uuid        not null
email_thread_id          uuid        not null
mailbox_scope_type       text        not null
personal_user_id         uuid
personal_account_email   text
shared_inbox_id          uuid
mailbox_account_email    text        not null
provider                 text        not null
provider_thread_key      text        not null
provider_thread_id       text        not null default ''
root_provider_message_id text        not null
download_status          text        not null default 'partial'
history_complete         boolean     not null default false
fetched_timestamp        timestamptz
last_download_error      text        not null default ''
created_timestamp        timestamptz not null default now()
updated_timestamp        timestamptz not null default now()
```

Renames and additions:

```text
scope_type    -> mailbox_scope_type
account_email -> mailbox_account_email
fetched_at    -> fetched_timestamp
add provider
```

Required rules:

- Primary key: `(company_id, email_thread_id)`.
- `mailbox_scope_type` is `personal` or `shared`.
- `provider` is `google` or `microsoft`.
- Personal scope requires `personal_user_id` and `personal_account_email`, with no `shared_inbox_id`.
- Shared scope requires `shared_inbox_id`, with no personal source columns.
- Account emails are normalized lowercase values.
- Source identifiers remain durable origin metadata if the mailbox connection is later removed.
- `download_status` remains `partial`, `downloading`, `complete`, or `failed`.
- Preserve the current personal-scope and shared-scope provider-thread uniqueness rules.

### `email_messages`

This replaces `communications_email_messages`.

```sql
company_id          uuid        not null
email_message_id    uuid        not null
email_thread_id     uuid        not null
provider_message_id text        not null
message_order       integer     not null
subject             text        not null default ''
sender_snapshot     jsonb       not null default '[]'::jsonb
to_snapshot         jsonb       not null default '[]'::jsonb
cc_snapshot         jsonb       not null default '[]'::jsonb
bcc_snapshot        jsonb       not null default '[]'::jsonb
reply_to_snapshot   jsonb       not null default '[]'::jsonb
message_timestamp   timestamptz
rich_html_body      text        not null default ''
text_fallback       text        not null default ''
snippet             text        not null default ''
unread              boolean     not null default false
starred             boolean     not null default false
folder_snapshot     jsonb       not null default '[]'::jsonb
folder_id_snapshot  jsonb       not null default '[]'::jsonb
attachment_metadata jsonb       not null default '[]'::jsonb
download_complete   boolean     not null default false
created_timestamp   timestamptz not null default now()
updated_timestamp   timestamptz not null default now()
```

Required changes and rules:

- Remove `provider_thread_id` from individual messages; it already exists on `email_threads`.
- Convert `message_timestamp` from a Unix-number `bigint` to `timestamptz`.
- Primary key: `(company_id, email_message_id)`.
- Unique: `(company_id, email_thread_id, provider_message_id)`.
- Unique: `(company_id, email_thread_id, email_message_id)` for composite relationship validation.
- `(company_id, email_thread_id)` references `email_threads` with cascade delete.
- Address, folder, and attachment metadata values remain JSON arrays.
- `message_order >= 0`.

### New `email_relationships`

This replaces all special Node-email placement, attachment, and collaboration links.

```sql
company_id            uuid        not null
email_relationship_id uuid        not null
email_thread_id       uuid        not null
email_message_id      uuid        not null
resource_type         text        not null
resource_id           uuid        not null
resource_textbox_id   text
created_timestamp     timestamptz not null default now()
```

Required keys and rules:

- Primary key: `(company_id, email_relationship_id)`.
- `resource_type` is `node`, `project`, or `logic_gate`.
- `resource_textbox_id is null` means the relationship applies to the whole resource.
- Node textbox IDs must resolve to `node_textboxes.textbox_id`.
- Project textbox IDs must resolve to `project_textboxes.textbox_id`.
- Logic Gate textbox IDs must resolve to `logic_gate_textboxes.textbox_id`.
- A database constraint trigger must validate the resource and optional textbox against the table selected by `resource_type`.
- `(company_id, email_thread_id, email_message_id)` must reference a message in the specified thread.
- Prevent duplicate active relationships for the same message, resource, and optional textbox.
- Preserve `attached_email_information_id` as `email_relationship_id` where possible.

Intentionally absent:

```text
email_id
attached_by_user_id
created_from_email
collaboration_id
board_id
card_id
logic_gate_id
node_id
project_id
title
```

Recommended indexes:

```text
idx_email_relationships_resource
  (company_id, resource_type, resource_id, resource_textbox_id, created_timestamp)

idx_email_relationships_message
  (company_id, email_thread_id, email_message_id)

unique active identity
  (company_id, email_message_id, resource_type, resource_id, coalesce(resource_textbox_id, ''))
```

### `email_drafts`

This replaces `communications_email_drafts` and stores both ordinary mailbox drafts and resource-shared drafts.

```sql
company_id                  uuid        not null
draft_id                    text        not null
email_relationship_id      uuid
source_email_message_id    uuid
mailbox_scope_type          text        not null
personal_user_id           uuid
personal_account_email     text
shared_inbox_id            uuid
sender_account_email       text        not null default ''
created_by_user_id         uuid
updated_by_user_id         uuid
kind                       text        not null default 'compose'
to_recipients              text        not null default ''
cc_recipients              text        not null default ''
bcc_recipients             text        not null default ''
subject                    text        not null default ''
body_editor_html           text        not null default ''
scheduled_send_timestamp   timestamptz
revision                   bigint      not null default 1
send_state                 text        not null default 'draft'
send_claim_token           text        not null default ''
send_idempotency_key       text        not null default ''
send_idempotency_grant_id  text        not null default ''
send_idempotency_timestamp timestamptz
send_claimed_revision      bigint      not null default 0
send_claimed_timestamp     timestamptz
sent_email_message_id      uuid
sent_provider_message_id   text        not null default ''
created_timestamp          timestamptz not null default now()
updated_timestamp          timestamptz not null default now()
deleted_timestamp          timestamptz
```

Required behavior:

- Primary key: `(company_id, draft_id)`.
- `email_relationship_id is null` means an ordinary mailbox draft.
- `email_relationship_id is not null` means a resource-shared draft.
- Shared-draft authorization comes from normal permissions on the related Node, Project, or Logic Gate.
- `source_email_message_id` represents the source for reply and forward drafts.
- `kind` is `compose`, `reply`, or `forward`.
- `revision > 0`.
- `send_state` retains the current safe-send states.
- Keep send-claim and idempotency columns. They prevent duplicate external email sends during retries or crashes.
- Draft attachments remain in `resource_attachments` with `resource_type = 'email_draft'`.
- Preserve existing text `draft_id` values; current IDs are not UUID-only.

Remove or replace these old columns:

```text
remove collaboration_id
remove is_shared
source_message_id -> source_email_message_id
account_email     -> sender_account_email
remove reply_to_message
sent_message_id   -> sent_email_message_id and sent_provider_message_id
```

### `email_thread_download_jobs`

Rename `communications_email_thread_download_jobs` to `email_thread_download_jobs`. Its operational behavior stays.

```sql
download_job_id               uuid        not null
company_id                    uuid        not null
email_thread_id               uuid        not null
download_scope                text        not null
requested_provider_message_id text        not null default ''
requested_by_user_id          uuid
status                        text        not null default 'pending'
attempt_count                 integer     not null default 0
last_error                    text        not null default ''
available_at                  timestamptz not null default now()
processing_started_at         timestamptz
completed_timestamp           timestamptz
failed_timestamp              timestamptz
created_timestamp             timestamptz not null default now()
updated_timestamp             timestamptz not null default now()
```

Preserve the current active-job uniqueness and claim indexes.

## Tables deleted completely

### `node_information`

Delete the table and all columns:

```text
company_id
information_id
node_id
type
information
save_batch_id
save_kind
saved_by_user_id
saved_by_display_name
source_information_id
created_timestamp
updated_timestamp
```

Data handling:

- `Text box`: current body already exists in `node_textboxes`.
- `Text block chat`: backfill into `node_textbox_chats`.
- `Attached email`: backfill into `email_relationships`.
- `Saved version`: permanent history already belongs in `node_textboxes_history`.
- `Checklist`, `Status`, `Due date`, `Employee name`, `PDF`, `PNG`, `MOV`, and `Hyperlink`: there is no new generic information replacement. The migration must abort if live rows contain necessary data not already represented by canonical current tables.

### `node_projection_table`

Delete the table and all columns:

```text
company_id
node_id
information_id
type
information
is_deleted
revision
created_timestamp
updated_timestamp
```

### `node_projection_seen_snapshots`

Replace with `node_textbox_seen_snapshots`. Remove old columns:

```text
company_id
node_id
information_id
user_id
information
projection_updated_timestamp
seen_timestamp
```

### `communications_email_collaborations`

Delete the table and all columns:

```text
company_id
collaboration_id
node_id
attached_email_information_id
scope_type
personal_user_id
personal_account_email
shared_inbox_id
account_email
provider_thread_id
root_message_id
latest_message_id
message_snapshot
created_by_user_id
created_timestamp
updated_timestamp
email_thread_id
```

Move any unique message snapshot data into `email_threads` and `email_messages`; move the association into `email_relationships`; move drafts into `email_drafts`.

### `communications_email_collaboration_participants`

Delete the table and all columns:

```text
company_id
collaboration_id
user_id
added_by_user_id
added_via_type
added_via_id
created_timestamp
```

Before dropping, verify participants already have equivalent normal resource permissions. Backfill normal permissions if required. Do not add a replacement participant table.

### `communications_email_nodes`

Delete the table and all columns:

```text
company_id
user_id
message_id
node_id
board_id
card_id
logic_gate_id
message
created_timestamp
updated_timestamp
email_thread_id
```

Replace its association data with `email_relationships`.

### `communications_email_node_attachments`

Delete the table and all columns:

```text
company_id
user_id
message_id
node_id
board_id
card_id
logic_gate_id
message
created_timestamp
updated_timestamp
email_thread_id
```

Replace its association data with `email_relationships`.

### `communications_node_email_threads`

This is a Node-to-thread link, not a second thread store. Delete it and all columns:

```text
company_id
node_id
information_id
email_thread_id
selected_provider_message_id
created_by_user_id
created_timestamp
```

Replace it with `email_relationships`.

## Table-name replacements

The old names must not remain in a newly created database:

```text
communications_email_threads              -> email_threads
communications_email_messages             -> email_messages
communications_email_drafts               -> email_drafts
communications_email_thread_download_jobs -> email_thread_download_jobs
node_projection_seen_snapshots             -> node_textbox_seen_snapshots
```

The implementation may use create/backfill/swap rather than raw `ALTER TABLE ... RENAME` when column transformations or strict validation require it.

## Database triggers and view-version behavior

Remove old triggers tied to retired stores:

```text
trg_node_view_version_information
trg_node_view_version_projection
trg_node_view_user_version_snapshots
trg_logic_gate_work_version_email_origin
```

Add or replace with:

```text
trg_node_view_version_textboxes
trg_node_view_version_textbox_chats
trg_node_view_version_email_relationships
trg_node_view_user_version_textbox_snapshots
trg_logic_gate_work_version_email_relationships
trg_validate_email_relationship_resource
```

Requirements:

- Node view versions change when Node textboxes, Node textbox chats, or Node email relationships change.
- Per-user Node view versions change when textbox seen snapshots change.
- Logic Gate work views update when relevant email relationships change.
- Email relationship validation must reject missing resources, mismatched resource types, missing textboxes, and textboxes belonging to the wrong resource.

## Tables explicitly staying unchanged in this work

```text
node_textboxes
node_textboxes_history
project_textboxes
project_textboxes_history
logic_gate_textboxes
logic_gate_textboxes_history
project_information
project_projection_table
logic_gate_information
logic_gate_projection_table
node_content_change_seen
attachments
resource_attachments
user_email_connections
company_email_connections
communications_email_signatures
communications_email_archive_jobs
communications_email_archive_job_items
communications_triage_items
```

The `information_type` enum remains because Project and Logic Gate information/projection tables still use it.

## Required application cutover

The schema change is incomplete unless all application paths are planned, but the live releases must remain schema-compatible:

- Before Phase 4, deployed code must continue to run against the pre-V3 schema while copy and reconciliation occur beside it.
- The Phase 4 application must not start until its required tables and reconciled data are proven present.
- The rollback build must remain able to use the preserved legacy sources until the separate retirement release.

### Node editor

- Read textbox bodies and ordering from `node_textboxes` only.
- Read and write Node comments through `node_textbox_chats`.
- Stop creating Node rows in `node_information` and `node_projection_table`.
- Stop composing current Node editor state from `node_projection_table`.
- Preserve existing API response shapes temporarily if that keeps the frontend cutover isolated, but the backend response must be composed from the new authoritative tables.
- Move unseen-change snapshot reads/writes to `node_textbox_seen_snapshots`.
- Remove the unused frontend textbox-title default and all projection-title handling.

### Email

- Store downloaded mail in `email_threads` and `email_messages`.
- Read attached emails through `email_relationships` joined to messages and threads.
- Create an email-derived Node through the ordinary Node creation workflow and then insert an `email_relationships` row.
- Replace collaboration routes and special collaboration resource guards with ordinary resource permission checks.
- Keep shared drafts durable in `email_drafts` and authorize them through their relationship's resource.
- Remove special collaboration participant fan-out. Realtime affected-resource fan-out must be derived from `email_relationships`.
- Remove special protected-collaboration Node behavior.
- Update attachment lookup to use the new chat, email message, relationship, and draft identities without duplicating attachment data.
- Update recycle-bin allowlists and backup/restore ordering for every changed table.

The application-cutover phase requires a maintenance window with application/API
workers and other database writers paused. Do not hold `ACCESS EXCLUSIVE` locks
across the entire historical copy. Each phase must declare its exact locks and
timeout; the final delta copy and application switch should hold only the shortest
bounded locks needed to prevent new legacy writes.

## Required phased migration and sequencing

V3 must not create tables, copy data, switch application code, and drop legacy storage in one migration transaction. The repository change may be cohesive, but the live rollout must use separate operator-gated releases. Do not put these phases in an automatic migration chain that immediately applies every phase.

### Phase 1: expand the schema

1. Assert the exact expected old schema and constraints. Abort on drift.
2. Create the permanent V3 tables, constraints, indexes, and validation triggers alongside the legacy tables.
3. Add compatibility columns where identity must move, including `node_content_changes.textbox_id` alongside `information_id` and both legacy and permanent attachment targets.
4. Leave all legacy tables, rows, readers, and writers intact. This phase must not copy, rewrite, or delete source data and must not switch application behavior.

### Phase 2: restartable copy

1. Copy normalized `email_threads` and `email_messages` first.
2. Copy `node_textbox_chats`, preserving old chat IDs and recoverable author snapshots.
3. Copy `email_relationships`, preserving existing relationship and Attached-email information IDs.
4. Copy `email_drafts`, `node_textbox_seen_snapshots`, content-change identity, permissions, and attachment identity.
5. Never delete or rewrite a legacy source row during the copy.
6. Every source row must receive exactly one reported disposition: `copied`, `already_copied`, `discarded_deleted_host`, or `needs_human_mapping`.
7. Rerunning the copy after interruption must be safe and must not create duplicate permanent identities.

### Phase 3: authoritative reconciliation

1. Run one read-only inventory that uses the same mapping and validation rules as the copy.
2. Reconcile each source category to its target by company, permanent ID, ownership, selected message, thread/message membership, attachment target, and payload content.
3. Report all blockers together. A zero-blocker result means every source row has exactly one valid disposition; it does not merely mean that SQL statements can run.
4. Keep ambiguous active content as a blocker for human review. Do not invent owners, create fake textboxes, or discard active comments or emails.

### Phase 4: application cutover

1. In one planned maintenance window, pause database writers, run a final restartable delta copy, and repeat reconciliation.
2. Switch backend and frontend readers and writers to the permanent V3 tables.
3. Run editor, email, attachment, draft, permissions, and history smoke tests before restoring writers.
4. Do not drop legacy tables or columns in this phase. They remain an immediate rollback source.

### Phase 5: soak and retirement

1. Observe the V3 application for an agreed soak period and compare permanent-table behavior with the preserved legacy source.
2. Retire legacy readers and writers only after the cutover has remained healthy.
3. Drop retired tables, columns, triggers, indexes, and constraints in a later explicit migration and release.
4. Ensure `backend/db/schema.sql` directly creates only the final schema and contains no create-then-drop history for retired structures.

Each phase must have an exact precondition, a postcondition query, and a safe rollback boundary. Do not use broad skip logic. Expected objects should be referenced directly so an unexpected database state fails visibly.

## Data-source precedence during backfill

- `node_textboxes` is authoritative for current textbox bodies.
- Current `Text block chat` state comes from `node_projection_table`; `node_information` may contain stale earlier revisions.
- Normalized current email thread/message rows are preferred over duplicated collaboration or projection snapshots.
- Projection/collaboration snapshots are fallback repair sources only when normalized email rows are missing.
- The July durable-email rollout intentionally allowed existing Attached-email projection snapshots to remain readable without backfilling `communications_email_threads` or `communications_email_messages`. V3 must normalize those rows during cutover: prove exactly one mailbox from a preserved thread, collaboration, exact shared inbox/account, placement user connection, or archive-job record; create or reuse the mailbox-scoped thread; copy the best snapshot; and preserve the Attached-email information ID as the relationship ID. Zero or multiple mailbox candidates are blockers, never a reason to delete the email or invent ownership.
- `node_textboxes_history` is authoritative for permanent Node textbox save history.
- Existing normal resource permissions are authoritative after any required participant-permission backfill.

## Required verification

- Update the appropriate `docs/tests/*.md` files and put a distinct `Process Story` at the top of each changed business-process document.
- Add schema-contract tests asserting every final table and column.
- Add negative schema tests asserting all retired tables and columns are absent.
- Add automated PostgreSQL integration tests that apply every phase in order to the exact expected pre-cutover schema with representative legacy rows, verify each phase's postconditions and rerun behavior, and prove that legacy sources remain available until the separate retirement phase. Static SQL string checks are not sufficient.
- Test empty databases created from `backend/db/schema.sql`.
- Test Node textbox create/edit/delete/reorder and history.
- Test Node textbox chat create/edit/delete/reply, mentions, entity links, email selections, and attachment-only messages.
- Test unseen text-change reads and marking one/all changes seen.
- Test downloading email threads/messages and one-message threads.
- Test email relationships for whole Nodes, Projects, Logic Gates, and each supported textbox type.
- Test invalid resource/textbox combinations are rejected by the database.
- Test email-to-Node conversion creates an ordinary Node plus relationship.
- Test ordinary drafts, shared-inbox drafts, resource-shared drafts, send claims, retries, recovery, and duplicate-send prevention.
- Test authorization revocation through normal resource permissions.
- Test realtime Node, Logic Gate, chat, email, and draft events.
- Test attachment reads/writes for chats, messages, and drafts.
- Test recycle-bin capture/restore ordering.
- Run the complete repository gate: `node scripts/run_all_tests.mjs`.

## Final permanent content model

The main permanent content tables for this cutover are:

```text
node_textboxes
node_textbox_chats
email_threads
email_messages
email_relationships
email_drafts
```

History, permissions, attachments, delivery jobs, audit/change tracking, and mailbox connection tables remain separate because they have different product responsibilities.

## V3 cutover preflight and legacy-drift handling

The old `scripts\run_v3_cutover_preflight.ps1` and its TypeScript implementation were removed with the failed V3 cutover. Do not check them out from an old commit and treat them as authoritative. The replacement implementation must first rebuild one repository-owned preflight with these properties:

- It uses the database-enforced read-only role in a repeatable-read, read-only transaction and verifies that role cannot write to a representative permanent table.
- Its only interactive input is the literal read-only password. Connection metadata is documented in the wrapper, and the password is never printed or persisted.
- Inventory, copy, and reconciliation consume the same classified source views or mapping functions. They must not implement the same rules three different ways.
- Every legacy text payload is classified and validated before any JSON, UUID, integer, timestamp, or array cast.
- It inventories every later foreign key, uniqueness rule, parent link, mailbox owner, resource/textbox owner, draft reference, attachment identity, seen snapshot, permission mapping, and destructive disposition before a copy phase runs.
- Every source row receives one explicit disposition: `copied`, `already_copied`, `discarded_deleted_host`, or `needs_human_mapping`.
- Output includes category totals, unique source-row totals, overlap counts, full machine-readable results in a named local artifact, and a short console summary. Samples are not a substitute for the full inventory.
- `blocker`, `cleanup`, and `review` are stable documented meanings. A readiness exit code must be reported plainly rather than buried under a PowerShell exception stack.
- A zero-blocker result is necessary but not sufficient: the final delta copy and reconciliation must be repeated with writers paused before application cutover.

The scoped chat inspection and reconciliation commands are now `scripts/inspect_v3_node_chat_storage.sql` and `scripts/verify_v3_node_textbox_chats.sql`. They report chat-only results in the SQL client and deliberately do not claim to be the full V3 machine-readable preflight.

The full replacement preflight command and exact machine-readable output location must still be added here when that implementation exists. Until then, there is no approved full V3 cutover command.

Fresh-eyes evidence on 2026-08-02 established these identity and visibility rules:

- For a Text block chat, `information_id` is the chat ID and payload `block_id` is the host textbox ID. Historical frontend creation passed the current textbox ID as `block_id`; V3 did not invent this identity relationship.
- The old API returned only active projection rows, but the old UI rendered chat panes only for surviving textbox IDs. A hostless chat could therefore remain active in storage while being invisible in the Node UI.
- Textbox deletion gathered the chats visible in the browser and deleted them through separate requests. It was not one database transaction, so interrupted or incomplete cleanup could leave hostless active chats.
- A chat is textbox-owned. If its exact permanent host textbox is absent, the cutover discards the chat and its chat attachment links; it does not guess a replacement or create an empty fake textbox.
- If a chat's permanent textbox survives but its same-textbox parent does not, the cutover preserves the child as a top-level comment by leaving `parent_chat_id` null.
- Seen snapshots are derived per-user baselines, not permanent textbox bodies. The cutover discards an orphan seen row when its permanent textbox is absent.
- Normalized email content is not owned by its old Node/textbox link. Missing hosts remove relationship and permission rows only; email threads, messages, drafts, and email attachments are preserved, with attachments falling back to their exact normalized message identity.
- Legacy chat payloads stored `author_id` only inside JSON, so deleting a user could not clear that identity. During cutover, a syntactically valid author ID that no longer resolves is treated like `ON DELETE SET NULL`: preserve the comment and captured author name, and store a null `author_user_id`.
- Historical migration and rollout documentation prove that pre-July Attached-email snapshots were valid without durable thread/message rows. Their absence is an expected dual-write/backfill gap, not corrupt email content.
- The preflight reports such rows as `email.legacy_snapshot_requires_normalization` (automatic cleanup) and reports only zero/multiple mailbox resolution as `email.legacy_snapshot_mailbox_unresolved_or_ambiguous` (blocker).
- Mailbox evidence is exact and mailbox-scoped: preserved normalized thread metadata, collaboration scope, shared inbox plus company connection, personal account plus company membership, the importing placement user with exactly one matching connection, or an archive job tied to the same company/user and provider message. Subject, sender, snippet, body, and timestamps are content only and never ownership evidence.
