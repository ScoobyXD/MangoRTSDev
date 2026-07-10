# Browser-to-S3 attachment work: continuation handoff

Last updated: 2026-07-10

Worktree used for this implementation:

`C:\tmp\MangoRTSDev-workers\MangoRTSDev-attachment-node-attachment-fixes0000528`

This is the detailed continuation record for the browser-to-private-S3 attachment project. Read this entire document before changing or discarding any of the current work. The implementation is extensive and is present in the worktree, but it has **not been compiled, formatted, or executed successfully** because the Windows sandbox stopped creating child processes. Treat the source as implemented but not yet verified.

## Read these first

1. Read the root `AGENTS.md` completely. Its safety rules remain controlling.
2. Read `docs/important tasks/v1browsertos3.md`, which is the implementation brief copied/preserved in this worktree.
3. Read `docs/important tasks/v1 Mango attachment system.md`.
4. Read `docs/tests/`, especially the attachment and streaming documentation.
5. Read `docs/frontend/src/modules/editor.md` and `docs/frontend/src/modules/nodes.md`.
6. Run `git status --short` and inspect every changed/untracked file before editing. The worktree is intentionally dirty with the implementation described below. Do not reset, clean, or discard it.

The brief already existed in this worktree, so the source worktree at `C:\tmp\MangoRTSDev-workers\MangoRTSDev-fix-attachments-on-nodes0000523` did not need to be modified. Do not edit that source worktree.

## Safety boundary

- Do not run `terraform apply` or change live AWS/production resources.
- Do not run migrations or use a live database writer/admin credential from an agent session.
- Before **any** AWS or database operation, run:

  ```powershell
  python scripts/verify_agent_db_access_boundary.py
  ```

- Stop and ask Jonat to switch sessions if that verifier reports active `mangorts-prod`/`mangorts-dev` admin access, static AWS keys, or another write-capable path prohibited by `AGENTS.md`.
- Do not retrieve or print database writer passwords, Secrets Manager values, AWS session tokens, GitHub tokens, Nylas/provider secrets, origin-verification secrets, or password-bearing connection strings.
- Do not apply the new migration to dev or prod from an agent session. Jonat must use the human-only database administration path or an explicitly scoped application/API path.
- Do not install Docker Desktop, restart the laptop, delete databases, reset Git history, or run `git clean -fdx`.
- Normal source editing and mocked/local tests do not require the AWS/database safety check.

## Current status in one paragraph

The worktree contains the intended browser-to-S3 control plane, direct-upload frontend, durable memory/PostgreSQL intent state, S3 SDK integration, migration, cleanup/recovery behavior, Terraform configuration, documentation, and focused tests. One static-audit race was already corrected: replaying an idempotent create while a single-upload intent is `completing` now returns a state conflict instead of issuing another PUT URL. No executable test or build has passed or failed inside its own toolchain, because PowerShell itself could not be launched. The next agent's first job is therefore dependency/lock regeneration, formatting, compilation, tests, and correction of any failures—not redesigning the system from scratch.

## Non-negotiable architecture and business rules

These are deliberate invariants. Do not accidentally remove them while fixing compile/test failures.

1. There is one permanent Mango attachment model. Upload intents and multipart-part rows are durable workflow state, not a second permanent attachment model.
2. Browser attachment bytes go directly to a private S3 bucket. They must never pass through the Mango API, be converted to base64/data URLs, or be read entirely into browser or server memory.
3. Mango remains authoritative for authentication, company/resource authorization, upload policy, attachment and intent IDs, object keys, multipart upload IDs, size/type limits, completion, S3 verification, metadata, and resource linking.
4. Default maximum size is 250 MiB (`262144000` bytes), configurable on the backend and published through the upload policy.
5. Files through and including 64 MiB use a single presigned PUT. Files above 64 MiB use resumable multipart upload. The implemented multipart part size is 16 MiB, subject to S3's part-count limit; the backend also enforces a maximum of 10,000 parts.
6. Browser SHA-256 is incremental and bounded-memory, using 4 MiB hashing chunks. It represents the SHA-256 of the exact raw file bytes.
7. The raw-file SHA-256 and S3's checksum are separate facts. A single-object S3 SHA-256 can have full-object provenance; an S3 multipart checksum may be a composite and must never overwrite or masquerade as the raw-file SHA-256. Preserve algorithm, value, and provenance/type separately.
8. Attachment ownership is node-level. An editor text/information block is a projection or placement, not the attachment owner. Deleting a text box must not delete or hide node attachments or attached emails.
9. Preserve the existing node-wide attachment count/list, file-type icons, image thumbnails, visible filename extensions, row preview behavior, and separate download action.
10. Preserve backend/server-side streaming uploads used by email, imports, migrations, and jobs. Only the obsolete browser upload path is retired.
11. Do not reintroduce the legacy browser `FormData`/Mango-byte upload or the old browser-only multipart implementation. There must be one permanent browser upload path.
12. The separate existing approximately 24 MiB provider-email compose total is not the Mango attachment per-file limit. It was deliberately retained; old generic 10/12 MiB browser attachment limits were removed.

## Intended end-to-end flow

1. The browser requests Mango's upload policy and validates the file before doing storage work.
2. The browser hashes the raw file incrementally. The worker and fallback both process bounded `File.slice(...)` chunks and never materialize the whole file.
3. The browser creates or resumes an upload intent through authenticated Mango JSON control-plane calls. `X-Mango-Company-ID` is a Mango control-plane header only; it is not included in the JSON body and is never sent to S3.
4. Mango authenticates the actor, validates company membership, authorizes edit access to the node/resource, validates MIME/filename/size/checksum metadata, creates server-owned identifiers and object key, and chooses single or multipart strategy.
5. For a single upload, Mango returns a short-lived URL plus the exact headers that were signed. The browser PUTs the raw `File` directly to S3 via XHR.
6. For multipart, Mango owns the S3 multipart upload ID and signs parts just in time. The browser uploads `File.slice(...)` blobs directly to S3, captures ETag/checksum response metadata, and durably reports accepted part state to Mango.
7. On URL expiry or a storage 403, the browser asks Mango for fresh signing material and retries with bounded backoff. Signed URLs are never persisted in local storage.
8. The browser asks Mango to complete. Mango takes a durable completion claim, completes or reconciles S3 state, performs `HeadObject`, validates bytes/checksum/encryption/storage metadata, finalizes the permanent attachment and original resource link transactionally, and returns the attachment.
9. Replay is idempotent. A completed intent returns the existing attachment identifiers without a new storage URL. A concurrent `completing` intent does not receive an overwrite URL.
10. Cancel, expiry, lost-client, and orphan paths abort multipart state where possible and persist a terminal state. S3 lifecycle configuration provides a second incomplete-multipart cleanup layer.

## Backend implementation

### Key source areas

Known key files include the following. This is not a substitute for `git status --short`; there are additional modified tests, repositories, docs, and Terraform files.

- `backend/internal/http/attachment_direct_upload_handlers.go`
- The adjacent direct-upload configuration and handler test files under `backend/internal/http/`
- `backend/internal/http/attachment_storage.go`
- `backend/internal/http/attachment_storage_test.go`
- `backend/internal/http/attachment_storage_integration_test.go`
- Existing attachment handler/server/CORS files under `backend/internal/http/`
- `backend/internal/domain/attachment.go` and related domain types
- Attachment repository interfaces and their memory/PostgreSQL implementations
- New upload-intent repository implementations and tests in the memory/PostgreSQL repository areas
- `backend/db/migrations/20260710_browser_attachment_uploads.sql`
- `backend/db/schema.sql`
- API startup/configuration under `backend/cmd/miraeopus-api/`
- `backend/go.mod`

Use `rg --files backend` and `git status --short` to obtain the exact current names after the process launcher works.

### Upload-intent model

The implementation reserves server-generated attachment/intent IDs and stores private object key/multipart upload ID only in durable backend state. Intent state includes the actor, company/resource identity, client idempotency identity, filename/content type/size/raw SHA-256, strategy, status/version, timestamps, expiry, failure information, completion claim data, and final attachment identity. Multipart rows retain expected and observed part sizes, part number, expected checksum, ETag/S3 checksum information, signing count, and signing time.

Important durable statuses are:

- `pending`
- `uploading`
- `completing`
- `completed`
- `failed`
- `aborted`
- `expired`

Important replay behavior:

- A matching completed request returns the existing attachment/result without a new URL.
- Pending/uploading single intents may receive refreshed PUT signing material.
- A single intent already in `completing` returns `409 attachment_upload_state_conflict`; this was a specific race found and fixed during static review.
- Failed/aborted terminal intents return a conflict rather than being silently resurrected.
- Expired intents return the expired/gone behavior rather than being revived.
- The original primary resource link remains stable on replay. Do not allow an idempotency replay to relink an attachment to a different node.

The memory and PostgreSQL repositories are intended to implement equivalent transitions. PostgreSQL finalization creates/updates the permanent attachment and resource link atomically. Schema/migration work adds intent/part persistence, checksum/provenance metadata, constraints, and uniqueness for attachment identity, storage key, and the client idempotency identity.

### Authentication and authorization

- Every create/status/sign/cancel/complete path requires an authenticated actor.
- `X-Mango-Company-ID` is validated against actor membership; it is not trusted as authorization by itself.
- Resource edit permission is checked at intent creation and rechecked for status/sign/complete operations where appropriate, so revoked access cannot continue an upload.
- Existing attachment/source reads are authorized before relinking/reusing anything.
- JSON decoding disallows unknown fields, and identifier/object-key injection attempts are rejected.
- The client cannot choose object keys, S3 upload IDs, attachment IDs, or final ownership.
- Oversize requests are rejected before an S3 multipart upload or PUT intent is created.

### Legacy route and streaming behavior

The old browser byte-upload `POST /v1/attachments` behavior is intentionally retired and returns HTTP 410. Its browser-body parsing/inspection path was removed. Do not restore it to fix a frontend caller; migrate the caller to the direct-upload control plane instead.

Backend `Put`/streaming storage behavior remains for non-browser producers. The S3 provider accepts a non-seekable `io.Reader` without buffering it wholesale. Non-seekable streams use a no-retry strategy because an automatic replay is unsafe; seekable readers retain normal retry behavior. The provider supplies the precomputed payload SHA/checksum to signing rather than reading the stream again.

### S3 provider

The provider was changed from handwritten SigV4 logic to AWS SDK for Go v2. `backend/go.mod` currently pins the Go-1.23-compatible set selected during implementation:

- `github.com/aws/aws-sdk-go-v2` v1.41.0
- `github.com/aws/aws-sdk-go-v2/config` v1.32.6
- `github.com/aws/aws-sdk-go-v2/service/s3` v1.95.0
- `github.com/aws/smithy-go` v1.24.0

The provider uses the SDK's default credential chain, native presigner, multipart APIs, `ListParts` paginator, complete/abort/head/delete/get operations, and SDK error handling. It supports separate backend and browser-facing presign endpoints plus path-style custom endpoints for tests/emulators.

Presigned responses expose only the actual required signed headers. A late SDK build middleware restores `Content-Type` during bodyless PUT presigning because the SDK may otherwise remove it. CORS/header tests are intended to ensure the returned signed-header set matches bucket CORS and that Mango auth/company headers are absent from the S3 request.

Do not log presigned URLs, credentials, upload IDs, tokens, or secrets. Structured observability added around the workflow is intended to use safe identifiers/counters such as intent ID, strategy, bytes, signing attempt, completion latency, mismatch class, storage outcome, abort/expiry, and cleanup result.

### Completion, verification, and recovery

- The repository supplies a durable completion claim to prevent double-finalization.
- Part completion accepts only the expected part numbers, exact sizes, checksums, and durable ETag/checksum state.
- Completion verifies object size and available S3 checksum/encryption/storage metadata with `HeadObject` before permanent finalization.
- The raw browser SHA-256 remains the raw-file digest; S3 checksum algorithm/value/provenance are recorded separately.
- Recovery is HEAD-first. If an object already exists after a lost completion response, it can be reconciled rather than blindly recompleted.
- For a stale multipart completion, the code can list parts/reopen the completion path when the final object is absent.
- The current completion recovery grace is a package variable defaulting to 30 seconds so tests can override it.
- The repository completion lease is currently hardcoded to two minutes. Before the grace, conflicting completion returns 409; between grace and lease the handler performs HEAD/ListParts recovery; at or after the lease, a stale claim may be reclaimed.
- The 30-second grace and two-minute lease are not currently environment-configurable. This is a follow-up/design risk, not a known compile error.

### Expiry and orphan cleanup

The cleanup worker starts once with the API server and is cancelled by `Server.Close`. It scans for overdue active intents, aborts multipart uploads where needed, removes orphaned single objects where appropriate, and persists terminal state. Static review confirmed that DELETE/abort on an expired intent is safe in both repositories: the memory repository can perform abort cleanup without being trapped by an expiry transition, and the PostgreSQL implementation uses its own atomic transition. Overdue active intents cleaned by abort become aborted; an already persisted expired intent remains expired.

Defaults represented in code/Terraform are intended to be approximately:

- Direct upload enabled: true
- Maximum file size: 250 MiB / 262144000 bytes
- Intent lifetime: 86400 seconds
- Single PUT presign lifetime: 3600 seconds
- Part presign lifetime: 900 seconds
- Incomplete multipart S3 lifecycle cleanup: 2 days

Read the exact environment-variable identifiers from the current backend/Terraform code rather than inventing new names.

## Frontend implementation

### Key files

- `frontend/src/modules/attachments/attachmentDirectUpload.ts`
- `frontend/src/modules/attachments/attachmentHash.ts`
- `frontend/src/modules/attachments/attachmentHashWorker.ts`
- `frontend/src/modules/attachments/attachmentApi.ts`
- Focused tests under `tests/frontend/modules/attachments/`
- Updated editor/workspace/project/home attachment call sites identified by `git status` and `rg`
- `frontend/package.json`
- `frontend/package-lock.json`

### Hashing and data-plane behavior

- `hash-wasm` 4.12.0 supplies incremental `createSHA256()`, `init()`, `update(Uint8Array)`, and `digest("hex")` behavior.
- The normal path uses a Vite module worker. A bounded fallback is guarded for environments without `Worker` support.
- Hash input is processed in 4 MiB slices. Do not replace it with `arrayBuffer()` on the entire file, `FileReader.readAsDataURL`, base64, or JSON byte transport.
- The browser uses XHR for direct S3 PUTs so it can report upload progress and cancel in flight.
- Single PUT sends the raw `File`; multipart sends bounded `File.slice(...)` blobs.
- Image/editor previews use object URLs rather than data URLs. Ensure object URLs remain revoked at the appropriate lifecycle boundary.

### Strategy, concurrency, retries, and completion

- At or below 64 MiB, use one signed PUT.
- Above 64 MiB, use 16 MiB multipart slices.
- Multipart concurrency is bounded to three parts per file, with a global direct-upload cap of four.
- Retry uses bounded backoff. A 403/expired URL triggers a control-plane refresh rather than retrying the same URL forever.
- Cancellation aborts active XHRs and asks Mango to abort durable intent/S3 multipart state.
- Completion itself is retried safely through the idempotent Mango control plane.
- Progress state is exposed in node UI with cancel/retry handling.

### Resume metadata

Resume records are metadata only. They must not contain presigned URLs, the private object key, S3 upload ID, file bytes, credentials, or auth tokens. The implemented record identity was expanded to include enough metadata to avoid reusing an intent for the wrong logical attachment, including content type, relationship/source kinds, message/editor/provider context, and image dimensions in addition to the file/client identity.

When debugging resume, preserve the rule that stale identity mismatch creates a new correct intent instead of attaching an old upload to a new resource. A resumed request still goes through Mango authorization and requests fresh signing material.

### UI and caller migration

- Existing editor, workspace/project, and home/node attachment callers were migrated to the direct uploader.
- `uploadMangoAttachment` no longer performs the old `FormData` upload; it delegates only to the direct path.
- Obsolete browser-only multipart code was removed after callers were migrated.
- The node remains the attachment owner even when an editor text box initiated the upload.
- Deleting a text box must leave node attachments and attached emails visible in the node-level collection.
- Existing file icons, image thumbnails, visible extensions, row preview interaction, node-wide count/list, and separate download action were retained.
- The existing provider-email compose aggregate-size rule remains separate from Mango's 250 MiB per-file policy.

### Frontend dependency warning

`hash-wasm` 4.12.0 was added manually to `package.json` and `package-lock.json` because npm could not launch. Static review found the API/type usage sound, but the lockfile entry lacks npm-generated integrity metadata and the dependency is probably not installed in `node_modules`. The next agent must regenerate and inspect the lockfile with npm before trusting `npm ci`, tests, or build output.

## Infrastructure implementation

Terraform code was added/updated in the shared attachment module and dev/prod wiring. Use `git status --short` and inspect all changed `.tf` files for exact names. The intended code-only changes are:

- Private S3 bucket/public-access protections.
- Exact direct-PUT CORS methods, origins, allowed request headers, and exposed ETag/checksum/type response headers.
- Localhost origins only in development configuration, not production.
- Lifecycle abort of incomplete multipart uploads, defaulting to two days.
- IAM scoped to the attachment prefix (`companies/*`) for the required object and multipart actions, including Put/Get/Delete, AbortMultipartUpload, and ListParts-related access.
- Backend environment configuration for direct-upload enablement, maximum bytes, intent TTL, single/part presign TTL, and optional browser presign endpoint.
- Static infrastructure assertions wired into the repository's test runner.
- Production bucket configuration remains deliberately unset/empty by default rather than inventing a live value.

No Terraform command successfully ran, and nothing was applied.

Important deployment caution: S3 CORS, lifecycle, and public-access-block resources are authoritative singleton settings. Before any approved apply, inventory the existing bucket configuration and Terraform state and reconcile/import it. Blindly applying these resources could overwrite unrelated existing CORS/lifecycle rules. Run the agent access-boundary verifier before an AWS-backed plan. An actual apply requires Jonat's explicit confirmation and the appropriate human/deployment path.

## Documentation updated

The implementation work included precise updates across these areas:

- `docs/important tasks/v1browsertos3.md`
- `docs/important tasks/v1 Mango attachment system.md`
- `docs/frontend/src/modules/editor.md`
- `docs/frontend/src/modules/nodes.md`
- Attachment/editor/node test documentation under `docs/tests/`
- REST/API attachment documentation

The docs now describe the direct data plane, Mango control plane, company header placement, 250 MiB/64 MiB rules, bounded hashing, node ownership/deletion behavior, raw-versus-S3 checksum provenance, and preserved server streaming behavior. One streaming doc was specifically corrected to say that non-seekable server streams remain supported rather than implying a seekable-only implementation.

## Tests added or expanded, but not executed

These are source-level additions and intended coverage, not passing results.

### Backend handler/domain coverage

- Zero/invalid size, the 64 MiB strategy boundary, 250 MiB maximum, and oversize rejection before S3 work.
- Unknown-field and ID/key/upload-ID injection rejection.
- Exact signed headers and absence of Mango auth/company headers from S3.
- Company-header membership validation, missing/wrong actor, revoked permission, and source-read authorization.
- MIME/content-type handling.
- Deleted text-box behavior while node attachments remain owned/visible.
- Multipart part size/checksum/ETag validation.
- Completion checksum/size/provenance behavior.
- Cancel/abort, expiry, orphan cleanup, completion replay, stale recovery, and lease behavior.
- Legacy browser endpoint returning 410.

### Repository/schema coverage

- Memory repository status transitions and idempotent finalization replay.
- PostgreSQL query/scanner ordering and finalization structure.
- Static schema/migration checks for tables, columns, constraints, and indexes.
- No live PostgreSQL writer test was run.

### S3 provider coverage

- Real SDK presigning behavior and provider parameters.
- Signed-header behavior.
- `ListParts` pagination.
- S3's possible HTTP-200 response containing an embedded completion error.
- Non-seekable streaming behavior.
- An opt-in integration test covers CORS, single PUT, multipart, ETag/head verification, abort, and cleanup. It is guarded by explicit fixture environment variables, refuses prod-like profile/prefix combinations, and runs the access-boundary verifier before an S3 request. It was not run.

### Frontend coverage

- Bounded hashing/worker fallback and raw SHA result.
- Single versus multipart strategy boundaries.
- Direct S3 header separation.
- Retry/403 URL refresh, cancellation, progress, completion replay, and resume behavior.
- Resume-record identity mismatch, including the added relationship/source/editor/provider/dimension fields.
- Node-level ownership/caller behavior where covered by existing UI tests.

### Infrastructure coverage

- Static assertions for private bucket controls, exact CORS, lifecycle cleanup, IAM actions/prefix, defaults, and dev/prod wiring.

## Exact verification state and runner failure

**Tests/builds that passed: none.** No executable verification command reached the underlying Go, npm, Node, or Terraform program.

Every attempted process launch failed while the sandbox tried to create PowerShell:

```text
CreateProcessAsUserW failed: 1312
A specified logon session does not exist. It may already have been terminated.
```

This occurred even for a read-only `git status --short`, showing that the failure is outside the repository/toolchains. Fresh attempts and explicit executable variants did not resolve it.

Attempts or intended verification affected by the same blocker included:

- `gofmt` on changed Go files: did not start.
- `go mod tidy`: did not start.
- Backend compilation/`go test ./...`: could not be reached.
- `npm install` and an `npm.cmd` retry: did not start.
- Frontend tests/build: could not be reached.
- `terraform fmt`: did not start.
- Infrastructure Node/static test: did not start.
- `git diff --check`: did not start.
- `node scripts/run_all_tests.mjs`: skipped because its prerequisites and even simple child processes could not launch.

Static audits did inspect the logic available in context. They found the single-upload `completing` replay race described above, which was fixed. They also found the dependency/formatting gaps below. Static review is not a passing test result.

## Known incomplete mechanical work and compile risks

1. `backend/go.mod` was edited, but `backend/go.sum` has no corresponding new AWS SDK/Smithy entries and was not modified. Run `go mod tidy` and inspect the resulting diff.
2. Changed/new Go files are visibly not all `gofmt`-formatted. Run `gofmt` on every changed and untracked `.go` file.
3. AWS SDK API usage appears statically valid, including presigning, checksum types, streaming `Body io.Reader`, pagination, and scanner/select ordering, but it has never compiled in this worktree.
4. `frontend/package-lock.json` has a manually added `hash-wasm` entry without npm-generated integrity metadata. Regenerate it with npm and inspect that only intended dependency changes occurred.
5. `node_modules` probably does not contain `hash-wasm`; no frontend typecheck/test/build has run.
6. Terraform was neither formatted nor validated. The infrastructure static test also did not run.
7. PostgreSQL behavior has static/repository tests but no live PostgreSQL fixture execution.
8. The opt-in S3 integration test was not run and must not be pointed at production.
9. Completion recovery grace/lease values are not fully environment-configurable, as noted above.
10. Because the final diff could not be reopened after the last edits, the next agent must perform a complete diff review for accidental files, formatting, generated lock/sum correctness, and stale documentation references.

## Prioritized continuation checklist

Do these in order once the Windows process-launch/logon-session problem is repaired.

### 1. Re-establish a working local runner without destructive actions

- Confirm a trivial PowerShell command and `git status --short` can launch.
- Do not restart the laptop without explicit user approval.
- Do not reset or clean the worktree.
- Capture the complete modified/untracked file inventory.

### 2. Review the diff before generating files

Use `git diff --stat`, `git diff`, `git status --short`, and `rg` to locate all direct-upload symbols. Confirm there are no unrelated user changes before touching overlapping files.

Search specifically for stale/conflicting browser paths and limits, for example:

- old `FormData` attachment uploads
- old browser multipart helpers
- whole-file `arrayBuffer()`/data URL/base64 attachment handling
- browser calls to the retired `POST /v1/attachments`
- stale 10 MiB/12 MiB Mango attachment limits
- attachment ownership tied to editor text/information IDs instead of node resource IDs

Do not remove the separate provider-email aggregate limit or backend streaming storage path.

### 3. Repair Go dependency metadata and formatting

From `backend/`:

```powershell
go mod tidy
go test ./...
```

Before the test, format every changed and untracked `.go` file with `gofmt -w`. Inspect both `go.mod` and the newly generated `go.sum`; do not accept an unexplained major dependency upgrade.

If compilation fails, prioritize:

- Exact AWS SDK v2 presigner/checksum option types.
- The late build middleware used to retain signed `Content-Type`.
- S3 complete-multipart embedded error handling.
- Repository interface parity between memory and PostgreSQL implementations.
- SQL SELECT column order versus scanners.
- API route/config constructor wiring and `Server.Close` cleanup cancellation.

### 4. Repair the npm lock and run frontend verification

From `frontend/`, run npm so it generates a canonical `hash-wasm` lock entry and installs the package. `npm install` is appropriate for repairing the lock; inspect its diff, then confirm a clean install with `npm ci` if practical. Use the scripts actually defined in `frontend/package.json` for focused tests/typecheck/build.

At minimum verify:

- Focused attachment/hash/direct-upload tests.
- All frontend tests.
- TypeScript/Vite production build.
- Worker bundling and fallback in the test environment.
- No Mango auth/company headers or cookies are sent to an S3 URL.
- Progress/cancel/retry and object-URL cleanup behavior.

### 5. Format and statically validate infrastructure

Run `terraform fmt` recursively on the changed Terraform, then run the repository's infrastructure static tests. A local syntax/validate step is appropriate if it does not contact AWS. Before any AWS-backed `plan`, run the access-boundary verifier. Do not apply.

Review the resulting plan only after explicit scope is established, paying special attention to whether CORS/lifecycle/public-access resources would replace existing singleton configuration.

### 6. Run the full repository verification

From the repository root:

```powershell
node scripts/run_all_tests.mjs
git diff --check
git status --short
```

Also run the backend and frontend focused commands separately so failures are attributable. Record exact commands and results in this document or the final handoff.

### 7. Fix failures caused by this implementation

- Make minimal, source-appropriate fixes.
- Re-run the focused failing test, its package/suite, and the full runner.
- Preserve unrelated changes.
- Do not weaken authorization, checksum, ownership, or size-boundary tests merely to make them pass.

### 8. Final source review

Confirm all of the following before calling the work merge-ready:

- Browser bytes never traverse Mango.
- No whole-file buffering/base64/data URL remains for attachment upload.
- Single threshold is inclusive at 64 MiB; max is inclusive at 250 MiB as specified by policy/tests.
- Multipart last-part sizing and 10,000-part limit are correct.
- URL refresh does not change intent ownership or object key.
- Completion is safe under retries and concurrent callers.
- Completed intent replay does not return a new PUT URL.
- Raw SHA-256 and S3 checksum provenance remain separate.
- Node deletion/text-box deletion semantics match the business rules.
- Old browser byte route stays retired while server streaming remains.
- CORS matches exactly the headers emitted by signing.
- Logs contain no signed URLs, secrets, tokens, upload IDs, or file bytes.
- Migration/schema and memory/PostgreSQL repository behavior remain aligned.

## Optional integration work requiring special care

The S3 integration test is intentionally opt-in. If Jonat explicitly wants it run:

1. Read its environment-variable guards in `backend/internal/http/attachment_storage_integration_test.go` instead of guessing values.
2. Run `python scripts/verify_agent_db_access_boundary.py` first.
3. Use only a safe dev fixture bucket/prefix dedicated to agent fixtures.
4. Confirm the test's prod-profile/prefix refusal remains active.
5. Never retrieve writer/app secrets.
6. Record objects created and verify cleanup/abort behavior.

Do not use this as authorization for Terraform apply or production changes.

For PostgreSQL, prefer mocked/static tests or an already approved isolated local fixture. Do not connect with dev/prod writer/admin credentials and do not apply the migration from an agent session.

## What a successful final handoff must report

When verification is finally possible, report all of the following explicitly:

1. What was implemented and any compile-driven changes made after this record.
2. Important architecture decisions, especially control plane versus data plane, intent state, checksum provenance, and node ownership.
3. Every exact test/build/format command that passed.
4. Anything skipped and the exact reason.
5. Infrastructure that exists only as code and still requires explicit deployment approval/import/reconciliation.
6. Remaining risks or follow-up work.

Do not claim tests passed if a process failed before the test runner started. Do not claim infrastructure is deployed merely because Terraform code exists.

## Exact backend reference appendix

This appendix records the exact source/API/config details recovered during the final backend audit. If a name differs at compile time, inspect the current code and update this document; the code is authoritative.

### Exact new and modified backend files known at handoff

New files:

- `backend/db/migrations/20260710_browser_attachment_uploads.sql`
- `backend/internal/http/attachment_direct_upload_config.go`
- `backend/internal/http/attachment_direct_upload_handlers.go`
- `backend/internal/http/attachment_direct_upload_handlers_test.go`
- `backend/internal/http/attachment_storage_integration_test.go`
- `backend/internal/store/attachment_upload_schema_test.go`
- `backend/internal/store/memory_attachment_uploads.go`
- `backend/internal/store/memory_attachment_uploads_test.go`
- `backend/internal/store/postgres_attachment_uploads.go`

Important modified files:

- `backend/go.mod`
- `backend/db/schema.sql`
- `backend/cmd/miraeopus-api/main.go`
- `backend/cmd/miraeopus-api/cors_test.go`
- `backend/internal/domain/types.go`
- `backend/internal/http/attachment_handlers.go`
- `backend/internal/http/attachment_handlers_test.go`
- `backend/internal/http/attachment_storage.go`
- `backend/internal/http/attachment_storage_test.go`
- `backend/internal/http/server.go`
- `backend/internal/store/repository.go`
- `backend/internal/store/memory.go`
- `backend/internal/store/memory_attachments.go`
- `backend/internal/store/postgres_attachments.go`

### Exact control-plane route contract

All routes below are under `/v1/attachments`.

`GET /v1/attachments/upload-policy` returns policy fields including `directUploadEnabled`, `maxFileBytes`, `singlePutMaxBytes`, `multipartPartBytes`, `maxConcurrentParts`, and `intentLifetimeSeconds`. The handler reports direct upload disabled if configured storage does not implement `AttachmentDirectUploadStorage`.

`POST /v1/attachments/upload-intents` accepts a JSON body capped at 64 KiB with these intended fields:

- `clientRequestId`
- `filename`
- `sizeBytes`
- `sha256`, lowercase 64-character raw-file hex
- `contentType`
- `resourceType`
- `resourceId`
- `relationshipKind`
- `sourceKind`
- optional `informationId`
- optional `messageId`
- optional `editorSurface`
- optional `sourceProvider`
- optional positive `originalWidth` and `originalHeight`

The client idempotency scope is `(company, actor, clientRequestId)`. Immutable metadata mismatch conflicts. Multipart provider creation currently occurs before durable insertion because the provider upload ID must be stored; if insertion fails or loses an idempotency race, the just-created provider upload is best-effort aborted.

The create response intentionally contains only public workflow data such as `uploadIntentId`, `attachmentId`, intent expiry, and upload descriptor. It never exposes private storage bucket/key or the provider multipart upload ID. A single descriptor contains method, URL, exact required headers, and URL expiry. A multipart descriptor contains strategy, part size, and part count; part URLs are requested separately.

`POST /v1/attachments/upload-intents/{intentId}/parts` signs multipart parts. The request batch limit is eight. Each requested part carries `partNumber`, `checksumAlgorithm` (currently exactly `SHA256`), and a checksum encoded as base64 of the raw 32-byte SHA-256. Duplicate/out-of-range parts and malformed checksums are rejected. The backend calculates the expected size, including the last part, and durably upserts expected checksum/size before signing. Re-signing identical state increments the signing-attempt counter; changing an already committed expected checksum/size conflicts. Part URL lifetime is capped at 15 minutes and by remaining intent lifetime.

`GET /v1/attachments/upload-intents/{intentId}` returns resumable status, strategy, size/raw SHA, expiry, part sizing/count, failure code, IDs, and accepted parts. For multipart, S3 `ListParts` is reconciled against durable expected size/checksum state and only exact accepted matches are returned. Local storage is never authoritative.

`POST /v1/attachments/upload-intents/{intentId}/complete` uses the durable completion claim. For single PUT it HEADs, verifies length/checksum/SSE, and deletes/reopens a safely retryable bad object so the client can obtain a fresh URL. For multipart it lists the exact part set, verifies part number/size/checksum/ETag, computes expected S3 composite checksum from authoritative part checksums, completes with the sorted authoritative metadata, then HEAD-verifies final length/composite provenance/SSE. An irrecoverable completed-object mismatch is deleted and fails the intent. Permanent attachment/resource-link finalization is transactional and replay returns the original resource-link ID.

`DELETE /v1/attachments/upload-intents/{intentId}` is idempotent. It aborts multipart where applicable, deletes any object, and persists a terminal state without changing completed/aborted/expired results. Verify the exact overdue-cleanup terminal transition during tests: the direct backend audit observed overdue active cleanup becoming `aborted`, while an earlier prose description said cleanup marked it `expired`. The code and tests must be made internally consistent; already-persisted `expired` intents must remain expired.

Legacy `POST /v1/attachments` returns `410 Gone` for browser byte uploads.

### Exact configuration identifiers

- `MANGORTS_ATTACHMENT_DIRECT_UPLOAD_ENABLED`, default `true`
- `MANGORTS_ATTACHMENT_MAX_BROWSER_UPLOAD_BYTES`, default `262144000`
- `MANGORTS_ATTACHMENT_UPLOAD_INTENT_TTL_SECONDS`, default `86400`
- `MANGORTS_ATTACHMENT_SINGLE_PUT_URL_TTL_SECONDS`, default/cap `3600`
- `MANGORTS_ATTACHMENT_MULTIPART_PART_URL_TTL_SECONDS`, default/cap `900`
- `MANGORTS_ATTACHMENT_UPLOAD_CLEANUP_INTERVAL_SECONDS`, default `900`
- `MANGORTS_ATTACHMENT_S3_BUCKET`
- `MANGORTS_ATTACHMENT_AWS_REGION`
- `MANGORTS_ATTACHMENT_S3_ENDPOINT`
- `MANGORTS_ATTACHMENT_S3_PRESIGN_ENDPOINT`
- `MANGORTS_ATTACHMENT_AWS_PROFILE`
- `MANGORTS_ATTACHMENT_S3_SERVER_SIDE_ENCRYPTION`

Configuration normalization caps supported browser size at `16 MiB * 10,000` even if an environment value is larger. Default S3 SSE is `AES256`; the string `none` disables it, and another supported explicit S3 value is passed through. Verify enum/API behavior during compilation and provider tests.

Single PUT signing is intended to require exactly `Content-Type`, `x-amz-checksum-sha256`, and `x-amz-server-side-encryption` when enabled. Multipart part signing is intended to require exactly `x-amz-checksum-sha256`.

### Exact persistence/checksum notes

The permanent attachment fields added/expanded are:

- `SHA256`: lowercase raw-file digest
- `SHA256VerificationMethod`
- `StorageChecksumAlgorithm`
- `StorageChecksumValue`
- `StorageChecksumType`

Migration verification methods are intended to allow `server_stream`, `s3_full`, and `client_reported`. S3 checksum types are `FULL_OBJECT` and `COMPOSITE`. Single PUT can be `s3_full` when the provider full-object checksum matches the base64 raw digest. Multipart raw SHA remains `client_reported` even though each part and the S3 composite are independently provider-verified.

Database guarantees include unique `(company_id, actor_user_id, client_request_id)`, unique attachment ID, unique `(storage_bucket, storage_key)`, part primary key `(upload_intent_id, part_number)`, strict status/strategy/checksum/part constraints, actor/company foreign keys, and indexes for expiry/status/resource/actor lookup.

Migration deployment risk: the migration includes strict lowercase SHA/checksum provenance constraints. Before human-approved application, legacy attachment data must be audited through a physically read-only/human-approved path for blank, uppercase, or malformed hashes. An agent must not run that live query with writer/admin access.

### Exact recovery and cleanup details

Ambiguous completion currently polls HEAD ten times at 50 ms before the wider recovery decisions. The recovery grace is 30 seconds and test-overridable; the persistence lease is hardcoded at two minutes. This bounded request polling and the timing thresholds should be reviewed under load but must not be casually removed without preserving lost-response recovery.

Permission loss on an active intent performs best-effort multipart abort/object deletion and terminal transition. It must not delete an already completed permanent attachment.

The cleanup worker runs once at server startup, then at its bounded interval, scans up to 100 candidates, aborts multipart before deleting objects, and leaves failed provider cleanup eligible for retry. `Server.Close()` must cancel it. Confirm exact failed/expired/aborted transition semantics against both memory and PostgreSQL tests.

Structured logs must not contain presigned URLs, object keys, multipart upload IDs, raw hashes/checksums, credentials, secrets, or file bytes.

### Exact backend test names recorded

In `attachment_direct_upload_handlers_test.go`:

- `TestAttachmentDirectUploadPolicyAndIntentBoundaries`
- `TestAttachmentDirectUploadSingleCompletionIsVerifiedAndIdempotent`
- `TestAttachmentDirectUploadMultipartSigningAndAuthoritativeCompletion`
- `TestAttachmentDirectUploadAuthorizationExpiryOriginAndAbort`
- `TestLegacyBrowserAttachmentUploadRouteIsGone`
- `TestAttachmentDirectUploadCompanyHintAndRequestValidation`
- `TestAttachmentDirectUploadMultipartAmbiguousCompletionRecovery`

In `memory_attachment_uploads_test.go`:

- `TestMemoryAttachmentUploadIntentIdempotencyAndPayloadConflict`
- `TestMemoryAttachmentUploadMultipartPartsClaimAndFinalize`
- `TestMemoryAttachmentUploadExpiryScanKeepsIntentCleanupEligible`
- `TestMemoryAttachmentUploadFailedAndAbortTransitions`

In `attachment_upload_schema_test.go`:

- `TestAttachmentUploadSchemaContract`

In `attachment_storage_test.go`:

- `TestS3AttachmentStoragePutObjectStreamsWithPrecomputedHash`
- `TestS3AttachmentStoragePutObjectSendsExplicitEmptyPayload`
- `TestS3AttachmentStoragePutObjectRejectsInvalidStreamMetadata`
- `TestS3AttachmentStoragePutObjectDoesNotReplayNonSeekableBody`
- `TestS3AttachmentStoragePresignsBrowserEndpointAndExactHeaders`
- `TestS3AttachmentStorageSDKProviderOperationsAndPagination`
- `TestS3AttachmentStorageCompleteMultipartSurfacesEmbeddedS3Error`
- `TestS3AttachmentStorageGetObjectStreamsSDKResponse`

The opt-in integration test is `TestAttachmentS3DevFixtureEndToEnd`.

Suggested focused backend sequence after `go mod tidy` and `gofmt`:

```powershell
Set-Location backend
go test ./internal/store
go test ./internal/http
go test ./cmd/miraeopus-api
go test ./...
```

Run `go test -race ./internal/http ./internal/store` as additional verification if the Windows Go environment supports the race detector.

## Exact frontend continuation appendix

The most likely first-build integration defects are worker bundling, the manually edited npm lock, XHR response-header exposure under real S3 CORS, scheduler permit release during abort/retry, and exact TypeScript agreement with backend response shapes.

When reviewing scheduler changes, verify every success, failure, retry, and cancellation path releases both per-file and global permits exactly once. Cancellation must abort hashing when possible, abort active XHRs, prevent queued work from starting, release permits, best-effort DELETE the Mango intent, and suppress stale progress callbacks after component unmount.

Resume after a page reload still requires the user to reselect/provide the same browser `File`; local storage intentionally cannot preserve file bytes. Do not misrepresent metadata resume as offline file persistence.

There is one policy detail to reconcile explicitly during tests: the backend audit states that zero-byte files are supported, while one frontend handoff description said to reject zero-length files. Inspect the brief, backend handler test expectation, frontend policy code, and focused tests. Choose one documented behavior and make both sides agree; do not let the mismatch survive silently. The existing backend test name `TestAttachmentDirectUploadPolicyAndIntentBoundaries` is expected to reveal the backend side.

Once the browser can run, inspect actual network traffic in addition to automated tests:

- Mango create/status/sign/complete are authenticated JSON control-plane requests.
- S3 PUTs contain raw bytes and only exact signed headers.
- S3 receives no Mango bearer authorization, cookie, or `X-Mango-Company-ID`.
- Test exactly 64 MiB and 64 MiB plus one byte.
- Test multipart failure/retry, 403 URL refresh, cancel, page reload/file reselection, and lost completion response.
- Delete a text box and verify node files and attached emails remain visible.
- Verify icon/thumbnail/extension/row preview/separate download behavior.
- Verify object URLs are revoked and no upload progress callback mutates unmounted UI.

Useful regression searches after the launcher works:

```powershell
rg -n "FormData|readAsDataURL|data:image|/v1/attachments|10\s*\*\s*1024|12\s*\*\s*1024" frontend tests
rg -n "uploadMangoAttachment|attachmentDirectUpload|X-Mango-Company-ID" frontend tests
```

Inspect every hit. The 410 test/route and separate email-provider aggregate limit are intentional and must not be mechanically deleted.

## Bottom line for the next agent

Continue from the existing implementation. Do not rebuild it as a parallel model and do not restore the legacy browser upload. The immediate blockers are mechanical but material: restore process execution, generate `go.sum`, format Go, regenerate the npm lock entry, install dependencies, compile, test, format/validate Terraform, run the full repository suite, review the entire diff, and fix failures. Only after those steps pass is the branch ready to be described as verified or merge-ready.
