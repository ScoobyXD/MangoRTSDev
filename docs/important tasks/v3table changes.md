# Process Story

A Mango user creates a Node and adds textboxes. Textbox bodies are stored only in `node_textboxes`, and textbox-owned comments and seen markers disappear when their textbox no longer exists. When an email is downloaded, Mango stores its thread and messages once, and `email_relationships` connects a selected message to a Node, Project, Logic Gate, or one of their textboxes. Deleting that host removes only the relationship: the normalized email, draft content, and email attachment links survive independently. Converting an email into a Node is an ordinary workflow: store the email, create the Node, create the relationship, and use normal resource permissions. Shared email drafts are stored in `email_drafts` and receive access from the related resource rather than a special collaboration-participant subsystem. No current Node editor content is written to `node_information` or `node_projection_table` after the cutover.

# V3 table changes implementation handoff

## Purpose

This document is the complete implementation target for retiring the remaining Node information/projection storage and the special email collaboration/placement tables.

The implementation must update the canonical schema, add a strict migration, update backend and frontend reads/writes, update tests and process documentation, and leave the repository capable of creating a clean database directly from `backend/db/schema.sql`.

An agent must not apply the migration to a live database. Repository agents may inspect a live database only with the designated database-enforced read-only credential. Never retrieve or print writer/admin credentials or unrelated secrets.

## Non-negotiable decisions

- Node textboxes do not have titles.
- `node_textboxes.body_json` is the only current Node textbox-body store.
- Node textbox comments live in `node_textbox_chats`.
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

The schema change is incomplete unless all application reads and writes move in the same implementation branch.

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

## Strict migration and sequencing

Implement this as one repository change, but the SQL itself should use safe phases inside a strict migration:

1. Assert the exact expected old schema and constraints. Abort on drift.
2. Create the new tables, constraints, indexes, and validation triggers.
3. Backfill normalized `email_threads` and `email_messages` first.
4. Backfill `node_textbox_chats`, preserving old chat IDs.
5. Backfill `email_relationships` from normalized thread links, old placement tables, collaborations, and attached-email projection rows.
6. Backfill `email_drafts`, replacing collaboration references with relationship references.
7. Backfill `node_textbox_seen_snapshots` from current textbox bodies and the old seen rows.
8. Rename `node_content_changes.information_id` to `textbox_id` and add its textbox foreign key.
9. Validate counts, IDs, selected messages, resource ownership, draft ownership, permissions, attachment targets, and thread/message membership after applying the explicit deleted-owner cleanup rules.
10. Abort on unexpected or ambiguous source data; do not treat known textbox-owned orphan rows or deleted email relationships as permanent content.
11. Switch all code paths to the new tables.
12. Remove old writers and readers.
13. Drop the retired tables and their triggers/indexes/constraints.
14. Ensure `backend/db/schema.sql` directly creates only the final schema and contains no create-then-drop history for these retired structures.

Do not use broad skip logic. Expected old objects should be referenced directly so an unexpected database state fails visibly.

## Data-source precedence during backfill

- `node_textboxes` is authoritative for current textbox bodies.
- Current `Text block chat` state comes from `node_projection_table`; `node_information` may contain stale earlier revisions.
- Normalized current email thread/message rows are preferred over duplicated collaboration or projection snapshots.
- Projection/collaboration snapshots are fallback repair sources only when normalized email rows are missing.
- `node_textboxes_history` is authoritative for permanent Node textbox save history.
- Existing normal resource permissions are authoritative after any required participant-permission backfill.

## Required verification

- Update the appropriate `docs/tests/*.md` files and put a distinct `Process Story` at the top of each changed business-process document.
- Add schema-contract tests asserting every final table and column.
- Add negative schema tests asserting all retired tables and columns are absent.
- Add migration tests using the exact expected pre-cutover schema and representative legacy rows.
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

Before another cutover attempt, run `powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts\run_v3_cutover_preflight.ps1`. The only input is the literal `mangorts_readonly` password, entered through a secure prompt. The script uses the fixed development connection metadata, verifies the role has no write privilege on `node_textboxes`, starts a repeatable-read read-only transaction, prints one JSON finding per category, and never changes a permanent table. Findings are labeled `blocker`, `cleanup`, or `review`; only blockers produce exit code 2.

Fresh-eyes evidence on 2026-08-02 established these identity and visibility rules:

- For a Text block chat, `information_id` is the chat ID and payload `block_id` is the host textbox ID. Historical frontend creation passed the current textbox ID as `block_id`; V3 did not invent this identity relationship.
- The old API returned only active projection rows, but the old UI rendered chat panes only for surviving textbox IDs. A hostless chat could therefore remain active in storage while being invisible in the Node UI.
- Textbox deletion gathered the chats visible in the browser and deleted them through separate requests. It was not one database transaction, so interrupted or incomplete cleanup could leave hostless active chats.
- A chat is textbox-owned. If its exact permanent host textbox is absent, the cutover discards the chat and its chat attachment links; it does not guess a replacement or create an empty fake textbox.
- If a chat's permanent textbox survives but its same-textbox parent does not, the cutover preserves the child as a top-level comment by leaving `parent_chat_id` null.
- Seen snapshots are derived per-user baselines, not permanent textbox bodies. The cutover discards an orphan seen row when its permanent textbox is absent.
- Normalized email content is not owned by its old Node/textbox link. Missing hosts remove relationship and permission rows only; email threads, messages, drafts, and email attachments are preserved, with attachments falling back to their exact normalized message identity.
