# One-Time Dev Data Migration Handoff

Last updated: 2026-07-09

This is a handoff note for the MangoRTS V1 attachment cleanup / dev database compaction work. It is intentionally explicit so another Codex agent can continue without needing the chat transcript.

## Current Goal

Clean old durable inline file bytes from the dev database without preserving every broken autosave/history duplicate.

The original V1 attachment work added the shared Mango attachment system and a migration command. The current follow-up is deciding how to handle the huge amount of duplicated dev-only node editor history.

The desired end state:

- Current editor/projection content stores Mango attachment references, not `data:image/...;base64`, `data:application/...;base64`, durable `dataURL`, or raw attachment `content`.
- S3/private attachment storage owns file bytes.
- Postgres text/JSON rows stop carrying large inline file bytes.
- Dev history bloat caused by old autosave behavior is compacted instead of migrated row-for-row.

## Safety Boundaries

Do not run apply mode or destructive SQL against prod.

For any database/AWS work:

- Run `python scripts\verify_agent_db_access_boundary.py` first.
- The current convenient local workflow uses the human `mangorts-dev` profile and the dev database. That is acceptable only when Jonat explicitly chooses to do dev-only work from his terminal.
- Do not read or print secrets from `infra/aws-dev/terraform.tfvars` / `infra/aws-prod/terraform.tfvars`.
- Do not run this plan against prod without a separate preservation plan, read-only proof, backup/export, and explicit approval.

## Relevant Code And Docs

Main attachment phase doc:

- `docs/important tasks/v1 Mango attachment system.md`

Attachment test ledger:

- `docs/tests/attachments.md`

Migration command:

- `backend/cmd/mango-attachment-migrate`

Scanner package:

- `backend/internal/attachments/migration`

Backend guards:

- `backend/internal/http/durable_inline_guard.go`
- Guard wiring in node, Logic Gate, project, and communications handlers.

Node editor behavior docs:

- `docs/tests/nodes.md`
  - `N23`: live typing writes current state to `node_projection_table`; it must not append a full rich-text document row to `node_information` on every keystroke autosave.
  - `N25`: manual Save flushes pending projection saves and writes one saved-version batch to `node_information`.

Schema shape:

- `node_projection_table` is the current editor projection/hot read model.
- `node_information` is durable history / save-version material.
- `node_projection_seen_snapshots` is per-user seen snapshot material and can duplicate projection payloads.

## What Has Already Happened

Phase 3 implementation was merged to main.

Implemented pieces include:

- Dry-run-first migration CLI: `backend/cmd/mango-attachment-migrate`.
- Scanner/rewrite core: `backend/internal/attachments/migration`.
- Backend guards that reject normal durable inline file-byte writes.
- Tests for scanner, command guardrails, backend guard shapes, and send/save rejection paths.
- Docs/test updates for Phase 3.

After merge, the first full dry run failed on `communications_triage_items.message` with:

```text
query communications_triage_items.message: unused argument: 0
```

Root cause:

- `collectCandidateRows` always passed `$1`, `$2`, `$3`.
- The `communications_triage_items` query used `$2` and `$3` but did not consume `$1`.

Fix applied locally in `C:\Users\Jonat\MangoRTSDev` and in the worker:

- `backend/cmd/mango-attachment-migrate/main.go`
  - Triage query now includes `where nullif($1, '') is null`.
  - This means unscoped dry runs scan triage.
  - Company-scoped dry runs skip triage because `communications_triage_items` has no `company_id`.
- `backend/cmd/mango-attachment-migrate/main_test.go`
  - Added `TestCandidateSourcesConsumeStandardQueryArguments`.

Verification already run for this fix:

```powershell
go test ./cmd/mango-attachment-migrate
git diff --check
```

Note for next agent:

- At the time this handoff was written, Jonat's main checkout may still have this fix as uncommitted local changes:
  - `backend/cmd/mango-attachment-migrate/main.go`
  - `backend/cmd/mango-attachment-migrate/main_test.go`
- There may also be untracked report files under `tmp/`.

## How Jonat Got DB Env Vars

Jonat normally starts the local cloud-integrated backend with:

```powershell
cd C:\Users\Jonat\MangoRTSDev
aws sso login --profile mangorts-dev
.\scripts\start_local_cognito_backend.ps1 -AwsProfile mangorts-dev -StopExisting
```

That script reads dev config/secrets and sets:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_SSLMODE`
- `PGPASSWORD`
- `PGSSLMODE`

It then runs the backend in the foreground. Jonat can press `Ctrl+C`; the DB env vars remain in that PowerShell process. Then the dry-run command can use those env vars.

For the attachment dry run, `-SkipNylas` is acceptable if using the helper only to set DB env vars:

```powershell
.\scripts\start_local_cognito_backend.ps1 -AwsProfile mangorts-dev -StopExisting -SkipNylas
```

Then press `Ctrl+C` after the backend starts.

## Dry Run Commands Used

Initial full dry run:

```powershell
cd C:\Users\Jonat\MangoRTSDev\backend
go run .\cmd\mango-attachment-migrate -report ..\tmp\attachment-migration-dry-run.json
```

Higher-limit full dry run:

```powershell
cd C:\Users\Jonat\MangoRTSDev\backend
go run .\cmd\mango-attachment-migrate -limit 5000 -report ..\tmp\attachment-migration-dry-run-5000.json
```

Important:

- Do not add `-apply` unless Jonat explicitly approves an apply step.
- Dry run writes only JSON reports.

## Dry Run Results

First report:

```text
Path: C:\Users\Jonat\MangoRTSDev\tmp\attachment-migration-dry-run.json
Size: ~4 MB
dry_run: true
scanned candidate rows: 1557
affected rows: 1555
embedded files found: 3420
estimated decoded bytes: 1,507,936,136
```

Rows by table in first report:

```text
node_information                  1000
node_projection_seen_snapshots     234
node_projection_table              219
logic_gate_information              59
project_information                 32
logic_gate_projection_table          5
communications_email_nodes           3
project_projection_table             3
```

Because `node_information` hit exactly 1000, the default limit was capped.

Second/higher-limit report:

```text
Path: C:\Users\Jonat\MangoRTSDev\tmp\attachment-migration-dry-run-5000.json
Size: ~10 MB
dry_run: true
apply: false
scanned candidate rows: 4208
affected rows: 4206
embedded files found: 8358
estimated decoded bytes: 2,963,128,334
large payload threshold: 1,048,576 bytes
```

Breakdown from `attachment-migration-dry-run-5000.json`:

```text
node_information                  3651 rows   7526 files   ~2.56 GB decoded
node_projection_seen_snapshots     234 rows    355 files   ~195 MB decoded
node_projection_table              219 rows    335 files   ~173 MB decoded
logic_gate_information              59 rows     79 files   ~22.7 MB decoded
project_information                 32 rows     46 files   ~7.8 MB decoded
logic_gate_projection_table          5 rows     10 files   ~3.4 MB decoded
project_projection_table             3 rows      4 files   ~0.6 MB decoded
communications_email_nodes           3 rows      3 files   ~4 KB decoded
```

Important confirmations:

- `node_information` did not hit the 5000 row limit. It found 3651 affected rows.
- `communications_triage_items` scanned and found 0 affected rows.
- `communications_email_node_attachments` scanned and found 0 affected rows.
- The bloat is overwhelmingly node editor history/projection duplication, not email or triage.
- Worst rows are node editor/source rows around 8.7 MB to 10 MB each.
- Signals on the largest rows include `data_application`, `data_image`, `durable_data_url_field`, `base64_marker`, and `large_payload_with_base64_marker`.

## Current Decision

For dev, do not migrate every bloated `node_information` row one-for-one.

Jonat observed that most `node_information` bloat came from an old bug where every character/word typed after inserting an image caused another huge full document/history row. This is dev data, not prod, and preserving every duplicate autosave is not valuable.

Decision:

- Treat `node_projection_table` as the source of truth for current node editor content.
- Keep/migrate current `node_projection_table` rows.
- Compact `node_information` instead of migrating thousands of duplicate history rows.
- Delete `node_projection_seen_snapshots` for the target dev company because they are per-user seen snapshots and duplicate bloated projection payloads.
- Recreate one clean `node_information` saved-version batch per node from migrated current projections if preserving a manual/history anchor is useful.

This is a dev-only compaction plan. Do not apply it to prod casually.

## Proposed Dev Compaction Plan

Target company seen in reports:

```text
11111111-1111-1111-1111-111111111111
```

Recommended order:

1. Ensure the triage query fix is committed/available in main.
2. Run a fresh dry run if needed to confirm current report numbers.
3. Apply attachment migration to the current node projection rows first.
4. Clear old node history/snapshots for the dev company.
5. Recreate minimal `node_information` rows from migrated `node_projection_table`.
6. Rerun dry run.
7. Verify no node projection/history/snapshot rows retain inline file bytes.

Why projection first:

- `node_projection_table` is current user-visible editor content.
- Migrating projection first rewrites the content to attachment references.
- Recreated `node_information` can then copy clean projection content instead of copying inline bytes.

Tables to compact for the dev company:

- `node_information`
- `node_projection_seen_snapshots`

Do not delete:

- `node_projection_table`
- `nodes`
- relationships/assignments/events unless a separate reason is proven.

## Implemented Dev Compaction Command

The next guarded tooling step is now implemented:

```text
backend/cmd/compact-node-information-from-projections
```

Purpose:

- Dev-only node editor history compaction.
- Requires `-company-id`.
- Defaults to dry-run.
- Requires `-apply -confirm-apply=COMPACT_DEV_NODE_INFORMATION` before destructive changes.
- Refuses prod-like targets when `APP_ENV`, `MANGORTS_ENV`, `MANGORTS_STAGE`, `DB_NAME`, or `DB_HOST` look production-like.
- Preserves `node_projection_table`.
- Deletes/recreates only `node_information` and clears `node_projection_seen_snapshots` for the target company in apply mode.
- Runs the delete/reinsert work in a single transaction in apply mode.
- Recreates one manual save-version batch per node from current `node_projection_table` `Text box` rows.
- Preserves `source_information_id` as the projection row's `information_id`.
- Blocks apply while any current `node_projection_table` rows still contain inline-byte signals, so run the attachment migration for `node_projection_table` first.

Report byte fields in this command are Postgres text bytes via `octet_length(information)`, not decoded embedded-file bytes. The existing `mango-attachment-migrate` dry-run report remains the decoded-byte inventory source.

Dry-run shape:

```powershell
cd C:\Users\Jonat\MangoRTSDev\backend
go run .\cmd\compact-node-information-from-projections -company-id 11111111-1111-1111-1111-111111111111 -report ..\tmp\node-history-compaction-dry-run.json
```

Apply shape, only after Jonat approves, the DB access boundary verifier passes in that exact session, and `node_projection_table` has already been migrated clean:

```powershell
cd C:\Users\Jonat\MangoRTSDev\backend
go run .\cmd\compact-node-information-from-projections -company-id 11111111-1111-1111-1111-111111111111 -apply -confirm-apply COMPACT_DEV_NODE_INFORMATION -report ..\tmp\node-history-compaction-apply.json
```

Verification after apply:

```powershell
cd C:\Users\Jonat\MangoRTSDev\backend
go run .\cmd\mango-attachment-migrate -limit 5000 -report ..\tmp\attachment-migration-post-compaction.json
```

Expected post-compaction result:

- `node_information` should be reduced to current `Text box` projection rows copied as one manual save-version batch per node.
- `node_projection_seen_snapshots` should be 0 for the target company.
- `node_projection_table` should be unchanged by the compactor and should already be clean from the attachment migration.

## Prior Open Implementation Detail

The current `mango-attachment-migrate -apply` command applies the scanner migration for selected source tables, but it is not designed as a history compactor.

This was the original instruction for the maintenance command. It is kept below for design context.

Suggested command name:

```text
compact-node-information-from-projections
```

Suggested behavior:

- Requires `-company-id`.
- Requires explicit confirmation string such as:

```text
COMPACT_DEV_NODE_INFORMATION
```

- Defaults to dry-run.
- Supports `-apply` only with confirmation.
- Reports before/after counts and bytes.
- Runs in a transaction.
- Deletes `node_information` for the company.
- Deletes `node_projection_seen_snapshots` for the company.
- Inserts one `node_information` row per current `node_projection_table` row, or one save batch per node, using clean migrated projection content.
- Uses `save_kind='manual'` or a clear value that passes current constraints. Current constraint allows only `legacy`, `manual`, `auto`.
- Uses a generated `save_batch_id` per node if recreating saved-version batches.
- Preserves `source_information_id` as the projection row's `information_id`.
- Does not touch prod.

Possible SQL shape for recreation, to be refined and tested:

```sql
insert into node_information (
  company_id,
  information_id,
  node_id,
  type,
  information,
  save_batch_id,
  save_kind,
  saved_by_display_name,
  source_information_id,
  created_timestamp,
  updated_timestamp
)
select
  projection.company_id,
  gen_random_uuid(),
  projection.node_id,
  projection.type,
  projection.information,
  batch.save_batch_id,
  'manual',
  'Dev history compaction',
  projection.information_id,
  now(),
  now()
from node_projection_table projection
join (
  select company_id, node_id, gen_random_uuid() as save_batch_id
  from node_projection_table
  where company_id=$1::uuid
  group by company_id, node_id
) batch
  on batch.company_id=projection.company_id
 and batch.node_id=projection.node_id
where projection.company_id=$1::uuid;
```

Check whether `gen_random_uuid()` is available in the DB before relying on it. The Go code already has UUID generation helpers, so a Go maintenance command may be safer than raw SQL.

## Current Migration Apply Caveat

Before any apply:

- The apply path uploads bytes to S3 via `httpapi.NewS3AttachmentStorageFromEnv()`.
- It requires attachment S3 bucket/region env config.
- It records:
  - `attachments`
  - `attachment_variants`
  - `resource_attachments`
  - `attachment_migration_runs`
  - `attachment_migration_items`
- It rewrites supported source rows.

For dev compaction, prefer:

1. Apply attachment migration to current projections.
2. Then compact/recreate history.

Do not apply migration to all `node_information` unless Jonat changes the decision and wants to preserve old dev history.

## Suggested Next Agent Checklist

1. Check main working tree:

```powershell
cd C:\Users\Jonat\MangoRTSDev
git status --short --branch
```

2. Confirm whether these local changes are committed:

```text
backend/cmd/mango-attachment-migrate/main.go
backend/cmd/mango-attachment-migrate/main_test.go
docs/important tasks/one time data migration.md
```

3. Run focused tests:

```powershell
cd C:\Users\Jonat\MangoRTSDev\backend
$env:GOCACHE = "C:\tmp\MangoRTSDev-workers\MangoRTSDev-mangp-attachment-phase-30000510\backend\go-build-cache"
go test ./cmd/mango-attachment-migrate
go test ./cmd/compact-node-information-from-projections
go test ./internal/attachments/migration
```

4. Use the Go compaction command rather than hand-running destructive SQL.

5. Keep any future changes under `backend/cmd/compact-node-information-from-projections` with scary dry-run/apply flags and tests.

6. Before running anything against dev DB:

```powershell
python scripts\verify_agent_db_access_boundary.py
```

7. Use Jonat's local backend helper to populate DB env vars if needed:

```powershell
aws sso login --profile mangorts-dev
.\scripts\start_local_cognito_backend.ps1 -AwsProfile mangorts-dev -StopExisting -SkipNylas
```

Then press `Ctrl+C` after backend startup and run dry-run/apply commands in the same PowerShell.

8. Re-run high-limit dry run after compaction/migration:

```powershell
cd C:\Users\Jonat\MangoRTSDev\backend
go run .\cmd\mango-attachment-migrate -limit 5000 -report ..\tmp\attachment-migration-post-compaction.json
```

9. Expected result after projection migration + compaction:

- `node_information` should be dramatically smaller and should no longer dominate the report.
- `node_projection_seen_snapshots` should be 0 if cleared.
- `node_projection_table` should no longer contain inline file bytes after migration.
- Remaining work should be Logic Gate/project/email stragglers.

## What Not To Do

- Do not ask Jonat to paste huge JSON reports into chat.
- Read report files from disk instead.
- Do not hand-run destructive SQL without a checked plan and explicit approval.
- Do not use this dev compaction approach for prod.
- Do not delete `node_projection_table`.
- Do not run `-apply` accidentally.
- Do not print DB passwords, AWS session tokens, Nylas secrets, or tfvars contents.

## Useful Report Reader Snippet

This PowerShell snippet summarizes a report without dumping the whole JSON:

```powershell
$path = "C:\Users\Jonat\MangoRTSDev\tmp\attachment-migration-dry-run-5000.json"
$json = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
$results = @($json.results)

"scanned=$($json.scanned_rows) affected=$($json.affected_rows) files=$($json.embedded_file_count) decoded=$($json.estimated_decoded_bytes)"

$results |
  Group-Object { $_.location.table } |
  Sort-Object Count -Descending |
  ForEach-Object {
    $files = 0
    $decoded = 0L
    foreach ($r in $_.Group) {
      foreach ($f in @($r.embedded_files)) {
        $files++
        $decoded += [int64]$f.estimated_decoded_bytes
      }
    }
    "{0} rows={1} files={2} decoded={3}" -f $_.Name, $_.Count, $files, $decoded
  }
```

## Plain-English Summary

The attachment migration worked as an inventory tool and found about 2.96 GB of inline file bytes in dev. Almost all of it is repeated node editor history from an old autosave bug. The current projection table has the live/current content. For dev, the right move is probably to migrate current projections to attachment references, then compact/delete the duplicated node history and recreate only clean minimal history from projection rows. This saves time and avoids preserving thousands of useless duplicate autosave rows.
