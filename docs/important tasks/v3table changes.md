# Process Story

A Mango user creates a Node and adds textboxes. Textbox bodies are stored only in `node_textboxes`, and textbox-owned comments and seen markers disappear when their textbox no longer exists. If a comment's author account was deleted, the comment and captured display name remain while its relational user ID becomes null. When an email is downloaded, Mango stores one thread for the exact personal email account or shared email account and stores each message once inside that thread. `email_relationships` connects a selected message to a Node, Project, Logic Gate, or one of their textboxes. Deleting that connection removes only the relationship: normalized email, email draft content, and normalized email attachment links survive independently. Converting an email into a Node is an ordinary workflow: store the email, create the Node, create the relationship, and use normal resource permissions. A resource-shared email draft is stored in `email_drafts` and receives access from the related resource instead of a special collaboration-participant subsystem. No current Node editor content is written to `node_information` or `node_projection_table` after the cutover.

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

## Current implementation: Node textbox chat cutover completed

On 2026-08-03 Jonat completed the deliberately small Node-chat cutover and deployed/restarted the backend. `node_textbox_chats` is now the current authority for Node textbox chats.

The operator-run Step 2 reported `source_rows: 667`, `copied: 667`, `needs_human_mapping: 0`, and `discarded_deleted_host: 0`. The independent reconciliation reported 667 legacy chat rows, 667 exact copies, zero delta rows, zero deleted-host rows, zero review rows, one detached parent, and 667 permanent chat rows. The detached reply was intentionally preserved as a top-level chat and did not block the cutover.

Jonat's manual operation is intentionally reduced to two copy-paste SQL files:

1. `scripts/v3_node_textbox_chats_step1_count.sql` ran in a repeatable-read, read-only transaction and identified the exact source set.
2. `scripts/v3_node_textbox_chats_step2_create_copy_verify.sql` created the permanent table and migration controls, copied the approved snapshot, reconciled it, and committed successfully.
3. The deployed backend now reads, creates, edits, replies to, and deletes Node chats through `node_textbox_chats`, while preserving the existing API/frontend payload shape and excluding legacy chat projections.
4. Deleting a textbox deletes all chats owned by that textbox and their chat-attachment relationships, including chats that quote or select an attached email. The normalized email message, thread, and email attachments remain because the textbox owns the chat, not the email.

The component files below remain because automated tests exercise expansion, copy, and reconciliation separately. Operators should use the two step files above rather than assembling the components by hand.

1. `scripts/inspect_v3_node_chat_storage.sql` is a read-only query that proves the current chat source and separates live row counts from heap, index, and TOAST storage. Run this first in the approved read-only database session.
2. `scripts/v3_node_textbox_chats_expand_component.sql` is the reusable expansion component embedded in Step 2. It creates `node_textbox_chats`, migration ledgers, and the versioned `v3_node_textbox_chat_source_v1` classifier without copying data. It deliberately lives outside `backend/db/migrations` so deployment cannot run it ahead of the operator-controlled Step 2.
3. `scripts/copy_v3_node_textbox_chats.sql` is the separately operated snapshot copy. It consumes the shared classifier, uses a short transaction, preserves legacy chat IDs, writes a disposition for every source row, and never mutates a legacy table.
4. `scripts/verify_v3_node_textbox_chats.sql` is the read-only reconciliation. It reports later deltas, exact copies, deleted-host dispositions, detached parents, and rows requiring review without printing chat bodies.
5. `docs/tests/v3-node-textbox-chat-migration.md` records the business rules and required test scenarios. `backend/internal/store/v3_node_textbox_chat_migration_test.go` contains static safety checks plus an opt-in disposable-PostgreSQL rerun test.

The current source rule is exact:

- Before the live cutover, `node_projection_table` was the legacy UI authority for `Text block chat` rows. After the completed Step 2 and backend deployment, `node_textbox_chats` is the authority.
- The projection `information_id` is the permanent `chat_id`.
- JSON payload `block_id` is the owning permanent `textbox_id`.
- `node_information` is event/history storage. It is not the set to copy merely because it contains rows whose type is `Text block chat`.
- The completed Step 2 was the final snapshot. New Node chat writes no longer create `Text block chat` rows in `node_projection_table` or `node_information`.

Legacy Node chat rows remain unchanged as rollback and audit evidence, but current reads ignore them. Legacy-table retirement is a separate future decision and is not authorized by this checkpoint.

The 3.3 GB label shown for `node_information` is a physical relation-size measurement, not a live-row count. PostgreSQL relation size can include the main heap, indexes, out-of-line TOAST values, and space still occupied by old/dead row versions. Six hundred fifty live rows can therefore coexist with a multi-gigabyte relation. Use the inspection script to see each component and `pg_stat_user_tables.n_live_tup`/`n_dead_tup`; do not run `VACUUM FULL`, `CLUSTER`, or another table rewrite as part of this data-copy phase. Ordinary database maintenance is a separate operator decision after the actual size cause is measured.

Rows with valid data and a surviving permanent host are copied. A deleted user leaves a null `author_user_id` but retains the captured author name and message. A missing same-textbox parent detaches the reply. A missing host is recorded as `discarded_deleted_host` without deleting the source. Invalid JSON, invalid identities, ambiguous email selections, duplicate company chat IDs, and target conflicts are recorded as `needs_human_mapping` and left untouched.

This completed scoped phase authorizes only the Node textbox chat cutover. It does not authorize the remaining V3 table changes or any legacy-table retirement.

## Current implementation: V3 email expansion and copy SQL prepared

The repository now contains the additive email schema and operator-controlled copy phase. No repository agent applied it to the development database, no backend reader or writer changed, and no legacy table was changed or removed.

- `scripts/v3_email_step1_count.sql` is the copy-paste, repeatable-read, read-only preflight. On the cleaned development data it reported `READY_TO_COPY`, 74 legacy threads, 509 legacy messages, 256 retained projection rows, 28 exact whole-Node duplicate pairs, 228 final relationship identities, 49 drafts, 9 signatures, 1,347 legacy attachment relationships, 1,134 valid final attachment relationships, 213 proven zero-target orphan links to omit, 223 expected final threads, and 678 expected final messages.
- `scripts/v3_email_step2_create_copy_verify.sql` is the single operator entry point. It contains the complete plain PostgreSQL SQL inline, so an operator can open and execute the whole file in DBeaver without `psql` backslash commands such as `\\ir` or `\\set`. It creates the final tables, runs the classifier/content/dependent/attachment sections, records a source-to-target ledger, reconciles counts, and commits in one transaction. It never updates or deletes a legacy row. The smaller component files remain only for maintenance and focused tests.
- The 28 disputed Node pairs are now proven: each contains one collaboration row whose old `block_id` equals its own relationship ID and one `created_from_email` row. The self-ID is not a textbox ID. Both rows mean the same whole-Node relationship. Step 2 preserves the collaboration relationship ID, maps the other source row to it as `consolidated_duplicate`, and leaves both legacy rows untouched.
- One soft-deleted compose draft has a stale source ID and no usable source snapshot. Step 2 keeps that draft but leaves its final source-message foreign key null.
- The live read-only attachment audit found 213 validly shaped legacy file links whose exact email draft/message/relationship target no longer exists. Step 2 keeps every underlying `attachments` row, leaves every old `resource_attachments` row untouched, records each as `retained_orphan_evidence`, and creates only the 1,134 relationships with exactly one surviving target. Malformed or ambiguous links still stop the transaction.
- The full Step 2 entry point passed a first run, an identical rerun, and a forced-drift rollback test on a disposable PostgreSQL 18 database. `backend/internal/store/v3_email_migration_test.go` protects the additive and non-destructive contract.
- `backend/db/schema.sql` can create the final tables on a clean database, while the old tables remain present for the current backend and rollback evidence.

The next email task is backend cutover, not more data cleanup. Immediately before that cutover, pause every email writer, run Step 1 again, run Step 2 for the final delta, review `READY_FOR_BACKEND_CUTOVER_REVIEW`, and only then deploy code that uses the new tables. Old-table retirement remains a later explicit task.

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
- The migration encoded unproved assumptions about dual writes, deleted owners, chat visibility, author retention, email normalization, email drafts, attachment identity, and exact source-email-account ownership.
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
- `email_threads`, `email_messages`, `email_relationships`, and `email_drafts` are the four permanent email content tables. They are not three tables because email drafts have a different lifecycle from received and sent email messages.
- The table must be called `email_relationships`, not `email_placements`.
- The draft table must be called `email_drafts`.
- Email relationships do not contain `attached_by_user_id`, `created_from_email`, or special Node-conversion flags.
- Email conversion into a Node does not have a special database subsystem.
- Every email draft belongs to exactly one personal email account or shared email account. A resource-shared email draft may also point to one `email_relationships` row.
- Resource-shared email draft access comes from normal Node, Project, or Logic Gate permissions.
- There is no email-collaboration participant table after the cutover.
- Email threads and messages are not added to `resource_permissions`. Direct access comes from the exact personal email account or shared email account; attached access comes through `email_relationships` and the normal permissions of the related resource.
- Attachments remain in `attachments`, and `resource_attachments` is renamed to `attachment_relationships`. Do not add attachment blobs to the new chat, message, or relationship tables and do not create a third attachment relationship table.
- Textbox-owned chats, their attachment links, and seen snapshots are discarded when no permanent host textbox survives; a surviving reply with no surviving same-textbox parent becomes a top-level comment.
- Deleting a Node or textbox removes its email relationship, not the normalized `email_threads` or `email_messages` content.
- Email drafts and normalized email attachment links survive a deleted email relationship. A stored incoming-email file targets its exact normalized `email_message`, never an `email_relationship_id`.
- Keep email drafts and signatures when their personal email account or shared email account is disconnected. They become unusable for sending until that exact same email account reconnects; Mango never silently switches them to another email account.
- Application requests must never create, alter, or drop database schema. Schema changes belong only in operator-controlled migration SQL.
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
edited_timestamp            timestamptz
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
- Email selections require `selection_email_message_id` and may also retain `selection_textbox_id` when the selected email was shown in that textbox.
- Selection offsets must both be null or satisfy `0 <= selection_start <= selection_end`.
- `entity_links` is a JSON array containing the existing `{start, end, entity_type, entity_id, label}` shape.
- `revision > 0`.
- Attachment-only comments remain legal. Attachment content stays in `attachments`, the chat relationship stays in `attachment_relationships`, and the backend requires either message text or at least one valid attachment relationship.
- Preserve the old projection `information_id` as `chat_id` during backfill.

Chat attachments live in `attachment_relationships` after the final rename:

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
email_account_type       text        not null
personal_user_id         uuid
personal_account_email   text
shared_inbox_id          uuid
email_account_email      text        not null
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
scope_type    -> email_account_type
account_email -> email_account_email
fetched_at    -> fetched_timestamp
add provider
```

Required rules:

- Primary key: `(company_id, email_thread_id)`.
- `email_account_type` is `personal_email_account` or `shared_email_account`.
- `provider` is `google` or `microsoft`.
- A personal email account requires `personal_user_id` and `personal_account_email`, with no `shared_inbox_id`.
- A shared email account requires `shared_inbox_id`, with no personal email account source columns.
- Account emails are normalized lowercase values.
- The row is scoped to exactly one personal email account or shared email account. It does not claim ownership of the worldwide conversation.
- If two Mango users participate in the same outside conversation through two different personal email accounts, Mango stores two `email_threads` rows. Provider IDs, subject, sender, body, or timestamp similarity must never merge those cross-account copies.
- Source identifiers remain durable origin metadata if the email account connection is later removed.
- `download_status` remains `partial`, `downloading`, `complete`, or `failed`.
- Preserve the current personal-email-account and shared-email-account provider-thread uniqueness rules.

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
- `attachment_metadata` may contain provider-only information needed to locate and download an email part. It never proves that Mango stored a file.
- A Mango-stored file exists only when an `attachments` row exists and an `attachment_relationships` row links it to this exact `email_message_id`.
- File bytes, object-storage keys, and file authorization never come from message JSON.
- Three messages in one conversation produce one `email_threads` row and three `email_messages` rows. Attaching only message 2 to a Node adds one `email_relationships` row for message 2; it does not duplicate the thread or any message.

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
- A message may have many relationships. Each relationship connects that exact message to one whole resource or one resource textbox.
- Deleting a relationship deletes only the connection. It never deletes the thread, message, email draft, or Mango-stored file.
- A file never targets `email_relationship_id`; normalized incoming-email files target `email_message`, email draft files target `email_draft`, signature images target `email_signature`, and chat files target `node_chat_message`.
- An email-derived Node is an ordinary Node with ordinary permissions plus an email relationship. It has no special ownership flag or permission system.

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

This replaces `communications_email_drafts` and stores both ordinary email drafts and resource-shared email drafts.

```sql
company_id                  uuid        not null
draft_id                    text        not null
email_relationship_id      uuid
source_email_message_id    uuid
email_account_type          text        not null
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
- Every email draft is associated with exactly one original personal email account or shared email account.
- `email_relationship_id is null` means an ordinary email-account draft.
- `email_relationship_id is not null` means a resource-shared email draft. There is no `email_draft_relationships` table.
- Many email drafts may point to the same relationship, but each email draft may point to at most one relationship.
- Resource-shared email draft authorization comes from normal permissions on the related Node, Project, or Logic Gate.
- If the email relationship is deleted, `email_relationship_id` becomes null through `ON DELETE SET NULL`. The email draft remains and falls back to exact personal-email-account or shared-email-account access.
- If the original email account disconnects, keep the email draft and its files but make it unsendable until the exact same email account reconnects. Never substitute another email account.
- `source_email_message_id` represents the source for reply and forward drafts.
- Reply and forward email drafts keep enough normalized source-message context to reopen safely. Source messages used by kept email drafts are not part of targeted cleanup.
- `kind` is `compose`, `reply`, or `forward`.
- `revision > 0`.
- `send_state` retains the current safe-send states.
- Keep send-claim and idempotency columns. They prevent duplicate external email sends during retries or crashes.
- Email draft files remain in `attachment_relationships` with `resource_type = 'email_draft'`.
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

### `email_signatures`

Rename `communications_email_signatures` to `email_signatures`.

Required behavior:

- Each signature row is scoped directly to exactly one personal email account or shared email account. There is no signature relationship table.
- Preserve all current signatures and allow at most one default signature for each exact email account.
- Keep signatures when an email account disconnects, but do not allow the signature to be used for sending until that exact same email account reconnects.
- Signature images target `email_signature` through `attachment_relationships`.

### `attachments` and `attachment_relationships`

`attachments` keeps the actual Mango file record. Rename `resource_attachments` to `attachment_relationships`; do not create another attachment-association table.

Required behavior:

- `attachments` stores actual file metadata, storage keys, hashes, sizes, and content types.
- `attachment_relationships` is the authority for which Mango record a stored file belongs to.
- Incoming email files use `resource_type = 'email_message'` and the internal `email_message_id`.
- Email draft files use `resource_type = 'email_draft'` and the `draft_id`.
- Signature images use `resource_type = 'email_signature'` and the signature ID.
- Node chat files use `resource_type = 'node_chat_message'` and the chat ID.
- Ordinary resource files target the Node, Project, or Logic Gate.
- No file targets an `email_relationship_id`.
- Deleting an email relationship, host resource, chat, or textbox does not delete normalized incoming-email files.
- Legacy structured resource IDs must be decoded with the exact same URL-decoding behavior as the application before they are mapped.

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
communications_email_signatures            -> email_signatures
communications_email_thread_download_jobs -> email_thread_download_jobs
resource_attachments                       -> attachment_relationships
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
user_email_connections
company_email_connections
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
- Keep all email drafts durable in `email_drafts`. Authorize an ordinary email draft through its exact personal email account or shared email account and authorize a resource-shared email draft through its relationship's resource.
- Remove special collaboration participant fan-out. Realtime affected-resource fan-out must be derived from `email_relationships`.
- Remove special protected-collaboration Node behavior.
- Rename `communications_email_signatures` to `email_signatures` and keep each signature directly scoped to its exact email account.
- Rename `resource_attachments` to `attachment_relationships`. Update attachment lookup to use chat, email message, email draft, signature, and ordinary resource identities without duplicating attachment data.
- Never authorize a stored email through a provider ID alone. Use the exact email account or a surviving email relationship and normal resource permission.
- If a chat preserves a quote from an email and its email relationship is later removed, keep the quote. Opening the complete email then requires another surviving relationship or exact personal-email-account/shared-email-account access.
- Remove `ensureCommunicationsEmailDraftsSchema()` and all other request-time DDL. Backend readiness may perform a read-only schema check and fail clearly, but may not repair schema.
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

1. Treat the completed `node_textbox_chats` checkpoint as fixed. Do not recopy, rewrite, or combine it with the email operation.
2. Copy normalized `email_threads` and `email_messages` first.
3. Run only Jonat-approved, count-guarded relationship/recycle cleanup after the read-only preflight reproduces the approved set exactly.
4. Copy `email_relationships`, preserving existing relationship and Attached-email information IDs.
5. Copy `email_drafts`, `email_signatures`, required normal resource permissions, and `attachment_relationships` only after every referenced target identity exists.
6. Never delete or rewrite a legacy source row except for a separately approved targeted cleanup category.
7. Every source row must receive exactly one reported disposition: `copied`, `already_copied`, `discarded_approved_cleanup`, `discarded_deleted_host`, or `needs_human_mapping`.
8. Rerunning the copy after interruption must be safe and must not create duplicate permanent identities.
9. Split the operator SQL further when dependencies differ: thread/message copy first, approved relationship cleanup and relationship copy second, email draft/signature copy third, and attachment relationship conversion last.

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
- The July durable-email rollout intentionally allowed existing Attached-email projection snapshots to remain readable without backfilling `communications_email_threads` or `communications_email_messages`. V3 must normalize retained rows during cutover: prove exactly one personal email account or shared email account from a preserved thread, collaboration, exact shared-inbox/company-connection record, personal-email-account connection, placement-user connection, or archive-job record; create or reuse the email-account-scoped thread; copy the best snapshot; and preserve the Attached-email information ID as the relationship ID. Zero or multiple exact email-account candidates require explicit disposition and are never a reason to guess from content.
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

History, permissions, `attachments`, `attachment_relationships`, `email_signatures`, delivery jobs, audit/change tracking, and personal-email-account/shared-email-account connection tables remain separate because they have different product responsibilities.

## V3 cutover preflight and legacy-drift handling

The old `scripts\run_v3_cutover_preflight.ps1` and its TypeScript implementation were removed with the failed V3 cutover. Do not check them out from an old commit and treat them as authoritative. The replacement implementation must first rebuild one repository-owned preflight with these properties:

- It uses the database-enforced read-only role in a repeatable-read, read-only transaction and verifies that role cannot write to a representative permanent table.
- Its only interactive input is the literal read-only password. Connection metadata is documented in the wrapper, and the password is never printed or persisted.
- Inventory, copy, and reconciliation consume the same classified source views or mapping functions. They must not implement the same rules three different ways.
- Every legacy text payload is classified and validated before any JSON, UUID, integer, timestamp, or array cast.
- It inventories every later foreign key, uniqueness rule, parent link, personal-email-account/shared-email-account source, resource/textbox owner, email draft reference, attachment identity, seen snapshot, permission mapping, and destructive disposition before a copy phase runs.
- Every source row receives one explicit disposition: `copied`, `already_copied`, `discarded_approved_cleanup`, `discarded_deleted_host`, or `needs_human_mapping`.
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
- The preflight reports retained rows that need normalization as `email.legacy_snapshot_requires_normalization`. It separately reports exact-email-account failures as `email.legacy_snapshot_email_account_unresolved_or_ambiguous`.
- Exact email-account evidence is limited to preserved normalized thread metadata, collaboration scope, shared-inbox plus company-connection evidence, personal-email-account plus company-membership evidence, the importing placement user with exactly one matching connection, or an archive job tied to the same company/user and provider message. Subject, sender, snippet, body, and timestamps are content only and never identify the source email account.

## Approved V3 email decisions and current evidence

This section records the 2026-08-03 repository inspection, the read-only development-database inventory, and the product decisions Jonat approved during the follow-up discussion. It is the current handoff for the next email-migration task. Where an older section or older test rule conflicts with this section, this section is the V3 target and the older contract must be updated during implementation.

### Plain-language model

Use **personal email account** and **shared email account** in new product and migration prose. Do not use the word “personal” by itself. Existing code, old SQL columns, API fields, UI labels, and test names may still contain `mailbox`, `personal`, `shared`, `scope_type`, or `shared_inbox_id`; those are literal legacy identifiers, not the preferred V3 business terms.

An email thread does not “own” an outside conversation. It is Mango's stored copy of that conversation as seen through exactly one personal email account or shared email account.

Example: Alice and Bob both use Mango and exchange one thread containing three messages.

- Alice's personal email account produces one `email_threads` row and three `email_messages` rows.
- Bob's personal email account produces a different `email_threads` row and three different `email_messages` rows.
- Mango never merges Alice's and Bob's rows just because the provider IDs, subject, participants, bodies, or times look related.
- If Alice attaches message 2 to one Node, Mango adds one `email_relationships` row that points to Alice's internal message-2 ID and that Node.
- If the same message is also attached to a Project, Mango adds a second relationship. The thread and its three messages are still stored once for Alice's personal email account.
- An email draft remains a separate `email_drafts` row because it can be edited, scheduled, discarded, or sent independently of the stored thread.

### Final tables and what each one does

The four permanent email content tables are:

1. `email_threads`: one conversation copy for one exact personal email account or shared email account.
2. `email_messages`: one immutable stored email inside one thread. Every message belongs to a thread, including a one-message conversation.
3. `email_relationships`: one connection from one exact stored message to a whole Node, Project, or Logic Gate, or to one textbox inside that resource.
4. `email_drafts`: Mango-authored compose, reply, and forward work, always tied to one exact original personal email account or shared email account and optionally tied to one email relationship.

Supporting final tables are:

- `email_signatures`, renamed from `communications_email_signatures`.
- `email_thread_download_jobs`, renamed from `communications_email_thread_download_jobs`.
- `attachments`, which stores each real Mango file record.
- `attachment_relationships`, renamed from `resource_attachments`, which states what Mango record each file belongs to.

Do not create `email_draft_relationships`, `email_collaboration_participants`, a signature relationship table, or another attachment relationship table.

### Current-to-final table inventory

| Current or legacy source | Final use or disposition |
| --- | --- |
| `communications_email_threads` | Copy and transform into `email_threads`. |
| `communications_email_messages` | Copy and transform into `email_messages`. |
| `communications_email_drafts` | Copy all active and soft-deleted rows into `email_drafts`. |
| `communications_email_signatures` | Rename/copy into `email_signatures`; keep every row. |
| `communications_email_thread_download_jobs` | Rename/copy into `email_thread_download_jobs`; preserve operational state. |
| `node_information` and `node_projection_table` Attached-email rows | Use active projection state as relationship authority and history as evidence. Normalize retained message snapshots, then retire the email rows with the old Node stores in the later retirement release. |
| `project_information`, `project_projection_table`, `logic_gate_information`, `logic_gate_projection_table` Attached-email rows | Normalize retained email content and copy active relationships. History is evidence, not another relationship. |
| `communications_email_collaborations` | Use its fuller snapshots and account evidence where needed, then retire it. |
| `communications_email_collaboration_participants` | Repair missing normal resource permission first, then retire it without a replacement participant table. |
| `communications_email_nodes` | Collapse its Node/message association into `email_relationships`, then retire it. |
| `communications_email_node_attachments` | Use only unique evidence needed for the final relationship or message, then retire it. |
| `communications_node_email_threads` | Treat as an old Node-to-thread link, not a thread store. Replace it with exact-message relationships, then retire it. |
| `attachments` | Keep as the actual Mango file table. |
| `resource_attachments` | Rename/copy to `attachment_relationships`. |
| `user_email_connections` | Keep as personal-email-account connection and provider-grant plumbing. It is not stored email content. |
| `company_email_connections` and `shared_inboxes` | Keep as shared-email-account connection, provider-grant, and access plumbing. They are not stored email content. |
| `communications_email_archive_jobs` and `communications_email_archive_job_items` | Keep; use as exact source-email-account evidence where valid. |
| `communications_triage_items` | Keep; update final IDs/contracts as required. |
| `resource_permissions` | Keep for Node, Project, and Logic Gate access. Do not add email thread or message rows to it. |
| `node_textbox_chats` | Keep as the completed chat authority. Change only its email-selection contract during email cutover. |
| `recycle_bin_items` | Jonat approved clearing all development recycle-bin data in a separate exact-count, human-operated cleanup. Do not silently include it in an automatic migration. |

### Read-only development-database snapshot

These counts were observed during the 2026-08-03 read-only investigation. They are evidence, not permanent constants. Step 1 must recount them before any operator uses a write script.

- The final V3 email tables were absent.
- `communications_email_threads`: 74 rows. Sixty-one were complete personal-email-account rows, one was a failed/incomplete personal-email-account row, and twelve were complete shared-email-account rows.
- `communications_email_messages`: 509 rows. All inspected address/folder/attachment JSON values were valid arrays; all bigint message timestamps were Unix seconds; 334 rows had `download_complete = false`.
- Before cleanup there were 321 active Attached-email projections. The cleaned source now has 256 rows: 250 Node, 6 Project, and 0 Logic Gate.
- The 256 retained rows become 228 final relationship identities because 28 exact Node pairs describe the same whole-Node relationship.
- `communications_email_collaborations`: 43 rows with 56 participant rows.
- `communications_email_nodes`: 111 rows.
- `communications_email_node_attachments`: 12 rows.
- `communications_node_email_threads`: 80 rows.
- `communications_email_thread_download_jobs`: 29 rows: 28 complete, one failed, none active.
- `communications_email_drafts`: 49 rows: 15 active and 34 soft-deleted; 10 compose, 38 reply, and one forward.
- `communications_email_signatures`: 9 rows.
- `attachments`: 1,199 rows.
- `resource_attachments`: 1,347 rows. Active email-related links included 200 Node email-file links, 22 `email_message` links, 41 `email_draft` links, and one legacy `attached_email` link.
- All 156 Mango attachment IDs found in message attachment metadata resolved to real attachment rows.
- Email archive storage contained 740 jobs and 6,994 job items.
- `communications_triage_items`: 10 rows.
- `recycle_bin_items`: 0 rows after the separately approved 97-row development cleanup.
- All 16 current Node-chat email selections resolved at the time of inspection.

### Exact source-of-truth order

When several old rows describe the same email, use this order:

1. An existing normalized `communications_email_threads` and `communications_email_messages` row is the highest-priority content source.
2. An exact collaboration or conversion full-message snapshot is next.
3. Exact archive-job, personal-email-account connection, or shared-email-account connection evidence may prove the source email account.
4. An active Attached-email projection summary may create a partial normalized message when fuller content does not exist. Preserve its subject, sender, snippet, and date; use empty bodies only when no body exists; mark it incomplete for later download.
5. If the exact source email account still cannot be proven, assign `needs_human_mapping` unless the row belongs to the separately approved targeted cleanup set described below.

The active Attached-email projection decides whether a current resource relationship exists. Old information/history, collaboration, conversion, and Node-thread rows are supporting evidence and must not create duplicate relationships.

### The small problem set that causes most migration difficulty

Do not delete all stored email. The read-only evidence found three narrow cleanup sets that remove most of the ambiguity while preserving useful content.

#### Completed cleanup checkpoint

- The 64 account-unresolved relationship rows were removed in the separately approved cleanup. The new preflight finds zero retained relationships without exactly one proven personal email account or shared email account.
- The one Project duplicate pair was resolved by the separate cleanup. No Project duplicate remains.
- All 97 approved development recycle-bin rows were removed. The new preflight requires the count to remain zero.
- No email thread, message, draft, signature, stored file, or old rollback table is deleted by the new create/copy script.

#### The 28 retained Node source pairs

- Each pair contains one collaboration row whose old `block_id` equals its own Attached-email information ID and one `created_from_email` row.
- The self-ID does not resolve to `node_textboxes`; it is an old relationship marker, not a textbox. Both rows therefore describe the same message/account/whole-Node relationship.
- The copy preserves the collaboration Attached-email information ID as the final relationship ID and records the other source row as `consolidated_duplicate`.
- Both legacy rows remain unchanged for rollback and audit evidence. The consolidation happens only in the final `email_relationships` table.
- The operator script requires exactly 28 pairs, exactly two rows per pair, one self-ID collaboration row, and one `created_from_email` row. Any drift rolls back.

The cleaned source has 256 projection rows and 228 final relationship identities: `256 - 28 = 228`.

The final preflight expects 223 email-account-scoped threads and 678 messages. Those totals include all 74 existing threads and 509 existing messages, normalized retained projection snapshots, and 33 draft-only source messages across 29 draft-only source threads. It keeps all 49 drafts, all 9 signatures, all 1,347 attachment relationships, and every valid stored file. One soft-deleted compose draft is retained with a null source-message link because its stale source ID has no usable snapshot.

### Access, relationships, chats, and deletion

- A user may open the complete stored email directly through the exact personal email account or shared email account that the thread belongs to.
- A user may also open it through an `email_relationships` row when normal permissions grant access to that relationship's Node, Project, or Logic Gate.
- `resource_permissions` continues to contain ordinary resource permissions. Do not add a new resource type or a polymorphic email thread/message ID column.
- A whole-resource relationship has `resource_textbox_id = null`. A textbox relationship contains the exact textbox ID, and a database trigger verifies that the textbox belongs to the selected resource.
- The relationship has an exact internal `email_message_id`, not a provider message ID, thread ID, or relationship ID standing in for a message.
- Prevent duplicate relationships for the same company, message, resource, and optional textbox.
- Deleting a resource or relationship deletes only the link and relationship-derived access. It does not delete the normalized thread, message, email draft, or incoming-email files.
- If a chat preserves a quote from an email and the relationship is later removed, the quote remains.
- Opening the complete email from that chat then requires another surviving relationship or access through the exact personal email account or shared email account.
- If targeted cleanup removes a selected source relationship, preserve the chat text/quote and clear or detach only the full-email reference. Never delete the chat for that reason.
- The completed Node-chat cutover remains untouched. Current chat email selections must move to internal `email_message_id` values during the email cutover.

The special collaboration participant permission system retires. Read-only evidence found 55 of 56 participant entries already had normal effective Node edit access; one collaboration creator did not. Before retirement, grant or repair the exact missing normal permission only after the preflight proves the same exception. Realtime audiences then come from the related resource and normal permissions, not a collaboration-participant table.

### Email drafts and signatures

- Keep all active and soft-deleted email drafts. Soft-deleted rows remain part of history/recovery unless a later explicit product decision says otherwise.
- An ordinary email draft has no `email_relationship_id`. A resource-shared email draft has exactly one optional relationship ID.
- Many email drafts may share one relationship; one email draft never points to multiple relationships.
- Deleting a relationship sets the email draft relationship to null and leaves the email draft available through its exact original email account.
- Disconnecting the source email account keeps the email draft, its body, and its files. It becomes unsendable until the exact same email account reconnects.
- Keep safe-send claim, revision, lease, grant, and idempotency data so retries and crashes cannot send twice.
- Keep source and sent-message identity. Reply and forward email drafts may require a minimal normalized source message even when other old email data is cleaned.
- Keep every signature. Each signature belongs directly to one exact personal email account or shared email account, with at most one default signature per email account.
- Disconnecting the email account keeps its signature but makes it unusable for sending until that same email account reconnects.

### Attachment authority

- `email_messages.attachment_metadata` may retain provider-only IDs, content IDs, names, content types, sizes, and other values needed to locate a provider part.
- Provider metadata must not pretend a Mango attachment exists when no `attachments` row exists.
- `attachments` contains the actual Mango file record. `attachment_relationships` is the only authority for what Mango record the file belongs to.
- Incoming-email files target the internal `email_message_id`; email draft files target `draft_id`; signature images target the signature ID; Node chat files target the chat ID.
- Files never target an email relationship. Removing a relationship must not orphan or delete a normalized message file.
- File bytes, storage keys, hashes, and access checks never come from message JSON.

### Request-time schema changes are forbidden

The current `ensureCommunicationsEmailDraftsSchema()` path performs draft-table DDL on first use after backend startup. A normal API request can therefore create or alter tables, drop and recreate triggers, and change constraints. This must be removed during V3.

- Application/API request handlers never create, alter, or drop schema.
- The operator-controlled migration is the only place for V3 schema DDL.
- Backend startup/readiness may run a read-only schema compatibility check and fail with a clear message. It may not repair the schema.
- The normal application database role should not have DDL permission. A separate operator migration role performs reviewed schema changes.

### Why the one-shot migration failed

The earlier attempt combined too many risks in one large transaction and learned about live exceptions one failure at a time. The main failure classes were:

- It assumed old Attached-email snapshots already had normalized messages, although 205 legacy snapshots lacked them.
- It treated ambiguous personal-email-account/shared-email-account evidence as a mapping problem that had to be solved inside the write transaction.
- It validated or cast legacy HTML, JSON, UUIDs, arrays, and timestamps on different code paths, so preflight success did not guarantee migration success.
- It mixed current projections with stale history, deleted hosts, and duplicate collaboration/conversion rows.
- It did not fully order threads, messages, relationships, email drafts, permissions, and attachment foreign keys before inserting dependents.
- It attempted large lock upgrades while active writers were running, causing deadlocks and timeouts.
- It combined table creation, data copy, constraint changes, application-contract changes, and old-table removal, making rollback and rerun behavior too large to reason about.
- Its preflight and copy logic were separate implementations and reported overlapping category totals without a unique-record total.
- The application was deployed against a database that had rolled back, so missing V3 tables immediately broke background jobs and editor access.
- Draft DDL still exists in a runtime request path, which hides schema ownership and must not survive the cutover.

### Required small migration sequence

#### Step 1: one read-only count and preflight report

Entry checks:

- Use only the database-enforced read-only credential in a repeatable-read, read-only transaction.
- Assert the exact current schema and that final V3 tables are absent or, on a rerun, exactly match the expected expansion schema.
- Do not print bodies, addresses, credentials, provider tokens, storage URLs, or attachment bytes.

The first script must measure:

- current and final table presence plus exact target-column assertions in the write entry point;
- counts and distinct identities for normalized threads/messages and retained Attached-email projections;
- exact source-email-account candidates for every retained relationship and kept draft;
- zero unresolved retained relationships, the exact shape of all 28 Node source pairs, and the 228 expected final relationships;
- all 49 email drafts, including soft-delete status, kind, source/sent-message references, safe-send state, and file links;
- all 9 signatures and their exact email-account scope and image links;
- all `attachments` and `resource_attachments` counts, with exact structured-ID decoding and target resolution asserted during copy;
- deleted/stale resource and textbox hosts, download-job state, and the required zero recycle-bin count;
- expected final thread, message, relationship, draft, signature, job, and attachment-relationship totals without returning user email content.

Chat-selection conversion, collaboration-permission retirement, and backend contract checks belong to the separately gated backend-cutover preflight. They do not block creation of the additive copy because this phase does not switch those readers or writers.

Exit check: every source row has exactly one proposed disposition, all destructive candidates match their approved count and have zero forbidden dependencies, and the report clearly says whether Step 2 is ready. A report mismatch changes nothing and is safe to rerun.

#### Step 2: separately operated create, copy, recount, and reconcile

Use one human-operated SQL entry point composed of small deterministic subphases with a ledger/checkpoint table:

1. Reassert the cleaned checkpoint: zero unresolved retained relationships, exactly 28 approved Node source pairs, zero recycle-bin rows, and no invalid hosts. Do not repeat cleanup and do not change a legacy row.
2. Create final tables, constraints, indexes, triggers, and the renamed support-table destinations. Do not switch application code.
3. Copy existing normalized threads/messages, then normalize the retained one-account legacy snapshots in deterministic company/account/thread/message batches.
4. Recount and reconcile thread/message IDs, content fields, thread membership, order, source account, and completeness before creating dependents.
5. Copy the 228 retained relationship identities and repair the one expected normal permission exception only if the preflight still proves it.
6. Copy every email draft and signature, preserving IDs, soft-delete state, source/sent-message links, send-safety state, and exact email-account scope.
7. Convert `resource_attachments` to `attachment_relationships` after every referenced message, email draft, signature, chat, and ordinary resource identity exists.
8. Copy/reconcile download jobs and other references only after their parent IDs exist.

Each deterministic batch uses stable ordering and upsert/conflict checks that accept an exact prior copy but reject different data under the same ID. The ledger records source identity, target identity, disposition, source fingerprint, batch, and completion time. A process crash leaves completed batches reusable and incomplete work rerunnable. No step deletes preserved legacy rollback sources.

Exit check: source-versus-target counts and fingerprints reconcile; every source row has one disposition; all foreign keys and uniqueness rules pass; all expected email drafts, signatures, files, relationships, chat selections, permissions, and jobs resolve; and no `needs_human_mapping` row remains outside a Jonat-approved disposition.

Rollback: before application cutover, rollback means stop using the new tables and leave old readers/writers unchanged. Within a subphase, an assertion or mismatch rolls back that subphase. Never drop the old tables in Step 2.

#### Step 3: backend cutover after the data checkpoint

Entry check: Step 2 reconciliation has passed from a final delta run with all database writers paused.

- Pause API workers, download workers, archive workers, webhook consumers, and any other email writers for the shortest practical maintenance window.
- Rerun final delta copy and reconciliation.
- Deploy code that reads and writes only the final email contracts, removes runtime schema DDL, uses exact-email-account or relationship-derived access, and uses `attachment_relationships`.
- Smoke-test list/read, import, relationship create/delete, Node/Project/Logic Gate opening, chat selections, compose/reply/forward, email draft save/send/recovery, signature use, personal-email-account/shared-email-account access, realtime fan-out, and file download.
- Restore writers only after the checkpoint passes.

Exit check: no new email writes reach the retired sources, all smoke tests pass, and final counts remain reconciled. Keep legacy tables unchanged for the agreed soak and rollback period. Retirement is a later explicit release.

Writer rule: the simplest rollout is old-writer operation during long copy, then a short writer freeze for final delta and cutover. A temporary dual-write path is needed only if the business cannot accept that maintenance window; it must not be invented by default.

### Repository paths inspected for the next implementation

Schema and migrations: `backend/db/schema.sql`, `backend/db/migrations/20260527_email_node_attachments.sql`, `backend/db/migrations/20260709_mango_attachments.sql`, `backend/db/migrations/20260709_zz_email_drafts_signatures.sql`, `backend/db/migrations/20260713_email_thread_collaboration.sql`, `backend/db/migrations/20260719_persist_node_email_threads.sql`, and `backend/db/migrations/20260728_durable_email_thread_download_jobs.sql`.

Core backend stores and contracts: `backend/internal/store/postgres_email_threads.go`, `backend/internal/store/postgres_email_drafts.go`, `backend/internal/store/postgres_email_collaboration.go`, `backend/internal/store/postgres_email_thread_download_jobs.go`, `backend/internal/store/postgres_attachments.go`, `backend/internal/store/postgres_attachment_uploads.go`, `backend/internal/store/postgres_resource_access.go`, `backend/internal/store/communications_email_conversion_atomic.go`, `backend/internal/store/shared_email_drafts.go`, `backend/internal/store/shared_email_draft_send.go`, and `backend/internal/domain/types.go`.

Core backend HTTP/provider paths: `backend/internal/http/communications_handlers.go`, `backend/internal/http/communications_email_draft_handlers.go`, `backend/internal/http/communications_email_collaboration_handlers.go`, `backend/internal/http/communications_email_collaboration_thread.go`, `backend/internal/http/communications_email_collaboration_draft_send.go`, `backend/internal/http/communications_email_thread_download_worker.go`, `backend/internal/http/communications_node_email_thread_handlers.go`, `backend/internal/http/communications_shared_inbox_handlers.go`, `backend/internal/http/communications_archive_worker.go`, `backend/internal/http/attachment_handlers.go`, `backend/internal/http/nylas_client.go`, `backend/internal/http/nylas_mime_attachments.go`, and `backend/internal/http/realtime_ws.go`.

Core frontend paths: `frontend/src/modules/communications/communicationsApi.ts`, `frontend/src/modules/communications/emailThreadMessages.ts`, `frontend/src/modules/attachments/attachmentApi.ts`, `frontend/src/modules/editor/editorEmailMailboxScope.ts`, `frontend/src/modules/editor/editorProjection.ts`, `frontend/src/modules/editor/NodeWorkspaceSurface.tsx`, `frontend/src/pages/home/homeCommands.ts`, `frontend/src/pages/home/homeMailDrafts.ts`, `frontend/src/pages/home/homeMailboxRealtime.ts`, `frontend/src/pages/home/emailCollaborationChat.ts`, `frontend/src/pages/home/HomeMailWorkspace.tsx`, and `frontend/src/pages/home/HomePage.tsx`.

### Next future implementation task

Implement the backend cutover to the final email tables only after an operator reruns the read-only preflight and create/copy/reconcile entry point with all email writers paused. That task must remove request-time draft DDL, switch all readers/writers and attachment authorization to the final contracts, update chat selections to internal message IDs, run the complete smoke-test list, and keep every old table unchanged for rollback. Old-table retirement is a separate later decision.
