# CtrlLoop database schema

The existing [CtrlLoop migration](../backend/db/migrations/20260913_ctrl_loop.sql) creates four tables with 47 columns. The [attachment migration](../backend/db/migrations/20260913_z_ctrl_loop_attachments.sql) changes existing attachment constraints and owner-validation behavior, and adds job-deletion cleanup. The [canonical schema](../backend/db/schema.sql) contains the same definitions.

The Mango source-email popup adds **no tables or columns**. It uses the existing company, thread, and message IDs and the existing `source_url` text columns. Reading `email_thread_id` into the Go run struct does not change the database.

The inventories below match the migration's declared types, nullability, and defaults. `timestamptz` means PostgreSQL `timestamp with time zone`. “None” means no explicit SQL default; a nullable omitted column receives `NULL`. Identity generation is listed separately from ordinary SQL defaults.

## `ctrl_loop_jobs` — 14 columns

One personal-mailbox automation and its original/current workbook pointers.

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| `company_id` | `uuid` | No | None |
| `job_id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | None |
| `email_connection_id` | `uuid` | No | None |
| `name` | `text` | No | None |
| `instructions` | `text` | No | None |
| `time_zone` | `text` | No | None |
| `status` | `text` | No | `'Awaiting file'` |
| `last_error` | `text` | No | `''` |
| `original_attachment_id` | `uuid` | Yes | None |
| `current_attachment_id` | `uuid` | Yes | None |
| `activated_at` | `timestamptz` | No | `clock_timestamp()` |
| `last_updated` | `timestamptz` | Yes | None |
| `revision` | `bigint` | No | `1` |

The primary key is `(company_id, job_id)`. Required same-company membership and mailbox foreign keys both use `ON DELETE CASCADE`. Original/current attachment foreign keys use the default `NO ACTION`; both pointers must be null together or populated together. Trimmed name length is 1–160 and instructions length is 1–12,000. Status is exactly `Awaiting file`, `Listening`, `Processing`, or `Error`; revision must be positive.

`ctrl_loop_job_owner` validates the personal mailbox owner and enabled mailbox on insertion or mailbox reassignment. Every update preserves company, job, and user identity; once set, the original attachment cannot change. Indexes support `(company_id, email_connection_id, activated_at)` and `(company_id, user_id, job_id)`.

## `ctrl_loop_runs` — 15 columns

One durably accepted source email, including its processing attempt and saved-change count.

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| `company_id` | `uuid` | No | None |
| `run_id` | `uuid` | No | `gen_random_uuid()` |
| `email_connection_id` | `uuid` | No | None |
| `email_thread_id` | `uuid` | Yes | None |
| `email_message_id` | `uuid` | Yes | None |
| `status` | `text` | No | `'pending'` |
| `last_error` | `text` | No | `''` |
| `arrival_at` | `timestamptz` | No | None |
| `source_url` | `text` | No | `''` |
| `session_id` | `text` | No | `''` |
| `token_hash` | `text` | No | `''` |
| `token_expires_at` | `timestamptz` | Yes | None |
| `created_at` | `timestamptz` | No | `clock_timestamp()` |
| `completed_at` | `timestamptz` | Yes | None |
| `changed_cells` | `integer` | No | `0` |

The primary key is `(company_id, run_id)`. `(company_id, email_connection_id, email_message_id)` is unique. The same-company mailbox foreign key cascades deletion. The `(company_id, email_thread_id, email_message_id)` foreign key refers to the exact stored email; deleting that email sets only the thread/message IDs to null and retains the run. Internal run statuses are `pending`, `processing`, `saving`, `completed`, and `error`. The changed-cell count cannot be negative.

The nonempty `token_hash` has a partial unique index; only a hash is stored. A queue index covers `(company_id, status, created_at)`.

## `ctrl_loop_run_jobs` — 6 columns

The exact workbooks authorized for a run, their starting versions, and staged cell targets.

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| `company_id` | `uuid` | No | None |
| `run_id` | `uuid` | No | None |
| `job_id` | `uuid` | No | None |
| `base_attachment_id` | `uuid` | No | None |
| `base_revision` | `bigint` | No | None |
| `targets` | `jsonb` | No | `'[]'` |

The primary key is `(company_id, run_id, job_id)`. Same-company run and job foreign keys cascade deletion. The base-attachment foreign key uses the default `NO ACTION`. `targets` must be a JSON array containing at most 500 entries. The repository validates entries as sheet/cell targets; that entry shape is not a SQL check. An index covers `(company_id, job_id, run_id)`.

## `ctrl_loop_changes` — 12 columns

One actually saved cell change and its seen/unseen state.

| Column | Type | Nullable | Default |
| --- | --- | --- | --- |
| `change_id` | `bigint` | No | `GENERATED ALWAYS AS IDENTITY` |
| `company_id` | `uuid` | No | None |
| `run_id` | `uuid` | No | None |
| `job_id` | `uuid` | No | None |
| `sheet` | `text` | No | None |
| `cell` | `text` | No | None |
| `previous_text` | `text` | No | None |
| `display_text` | `text` | No | None |
| `source_url` | `text` | No | None |
| `arrival_at` | `timestamptz` | No | None |
| `saved_at` | `timestamptz` | No | `clock_timestamp()` |
| `seen` | `boolean` | No | `false` |

The primary key is `change_id`. `(company_id, run_id, job_id, sheet, cell)` is unique. The exact run/job foreign key cascades deletion. The unseen index covers `(company_id, job_id, change_id)` only where `seen` is false; the history index covers `(company_id, job_id, change_id DESC)`.

## Existing attachments and deletion

Neither migration adds columns to `attachments` or `attachment_relationships`. The attachment migration expands `attachment_relationships_type_chk` to accept `ctrl_loop_job` and adds `attachment_relationships_ctrl_loop_shape_chk`. That owner type requires `relationship_kind='file_attachment'`, null `information_id`, empty `message_id`, and empty `editor_surface`.

The existing `mangorts_validate_attachment_relationship_owner` function gains a branch requiring a valid UUID for the exact job in the same company; the attachment must exist and be live. Existing resource types retain their owner checks. A new `ctrl_loop_retire_attachments` trigger runs before job deletion, including membership/mailbox cascades. It retires that job's exact live attachment relationships and marks a file pending deletion only when no other live owner remains. Shared files stay live. The trigger performs no S3 operation; eventual file deletion uses the existing attachment cleanup lifecycle.

Deleting a mailbox removes its jobs and runs; their dependent run/job rows and change history cascade. Deleting a membership removes its jobs and those jobs' work/history rows. Deleting only a source email preserves its run and history while clearing the stored email identity. The application can then finish a pending run without modifying a workbook.

Applying the migrations does not backfill, rewrite, or delete existing business records. Replacing constraints validates existing attachment rows and requires database locks. The new cleanup updates happen when a job is later deleted.

## Rollout

An operator runs the read-only [preflight](../scripts/ctrl_loop_preflight.sql), reviews its reported database and server version, and proceeds only after `READY`. It returns `STOP` outside PostgreSQL 17/18, when required existing tables are missing, or when `ctrl_loop_jobs` already exists. It is not a complete schema or migration-ledger audit.

The operator applies `20260913_ctrl_loop.sql` followed by `20260913_z_ctrl_loop_attachments.sql` through the existing controlled migration process with writers stopped. These scripts are not automatically applied at application startup. Deploy matching API and worker code after the schema is ready. The popup itself requires no further migration. See [CtrlLoop setup](ctrl-loop-setup.md) for configuration and rollout checks.
