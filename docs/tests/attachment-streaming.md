Last updated: 2026-07-10

# Attachment Transfer And Streaming Tests

## Business Logic

AST1 - Normal browser-selected attachment bytes travel directly from the browser to private S3 through short-lived presigned requests. Mango API receives JSON control-plane requests only and must not receive browser file bytes, `FormData` file parts, base64, or data URLs.

AST2 - Browser preparation computes the raw file-content SHA-256 incrementally in bounded chunks. It must not call whole-file `arrayBuffer()`, encode the file as base64/data URL, or retain memory proportional to file size.

AST3 - Browser files through and including 64 MiB use one presigned PUT. Larger browser files use resumable multipart upload with 16 MiB parts, at most three parts in flight for one file and four S3 PUTs in flight across the page. Raw `File`/`Blob` or bounded `File.slice` bodies go to S3 with only the exact signed headers and no Mango authorization header or cookie.

AST4 - The configurable browser limit defaults to 250 MiB (262,144,000 bytes) per file. The old 12 MiB aggregate-per-text-box limit does not apply to direct browser upload. Each file succeeds or fails independently, and only completed attachments enter normal lists/counts.

AST5 - Browser upload intents and multipart part state are durable and idempotent. Retry refreshes an expired URL for the same intent/part; resume reconciles accepted S3 parts; cancel aborts active requests and best-effort aborts the intent; expiry cleanup aborts multipart work or deletes an unfinalized single-PUT object. S3 AbortIncompleteMultipartUpload lifecycle is a backstop, not the primary cleanup path.

AST6 - `attachments.sha256` always means raw file-content SHA-256. S3 checksum algorithm/value/type and SHA verification provenance are separate fields: single PUT may be `s3_full`, backend streaming is `server_stream`, and multipart raw SHA remains `client_reported` unless a trusted processor later verifies it. ETag and multipart composite checksums never replace raw SHA-256.

AST7 - Backend-originated producers such as incoming email, provider imports, migrations, and backend jobs retain the streaming storage path. That boundary accepts an `io.Reader`, exact content length, and precomputed SHA-256 and streams without requiring seek support, `io.ReadAll`, `bytes.Clone`, or another full-file hash pass. Seekable streams may use normal SDK retries; a non-seekable stream is never replayed automatically after a partial request.

AST8 - Backend-originated producers validate metadata and derive content type/hash with bounded work before calling storage. Invalid metadata, cancellation, storage failure, or authorization failure must not create final attachment metadata/resource links. The removed browser multipart HTTP handler is not a fallback server-streaming path.

AST9 - The legacy inline-attachment migration may begin with already-decoded bytes because extraction is its purpose, but it must wrap those bytes in a reader and must not add another full-file clone at the S3 boundary.

AST10 - Postgres stores durable metadata, checksum provenance, intent/part state, and resource links only. It never stores presigned URLs, S3 upload IDs exposed to clients, browser file bytes, base64, or data URLs.

## Scenarios

### Scenario AST-S1: Browser Upload Bypasses Mango API Bytes

Given a user selects browser files on both sides of the 64 MiB strategy boundary:

- Mango API receives policy/intent/part/complete JSON only.
- The browser incrementally hashes the raw file with bounded memory.
- S3 receives the raw File/Blob bytes through presigned PUTs.
- The S3 request sends the exact signed headers and no Mango authorization header.
- A 64 MiB file uses one PUT; a file one byte larger uses 16 MiB multipart parts.
- Progress, cancellation, URL refresh, retry, and resume do not create a whole-file memory copy.

### Scenario AST-S2: Browser Limit, Empty File, And Partial Success

Given an empty file, a file exactly 250 MiB, a file one byte too large, and sibling uploads:

- The empty file uses single PUT and the raw empty-payload SHA-256.
- Exactly 250 MiB is accepted; one byte above is rejected before S3 is touched.
- The old 12 MiB text-box aggregate does not reject direct uploads.
- A failed sibling does not discard already completed files.
- Pending/failed/canceled uploads stay in progress UI and outside normal attachment counts.

### Scenario AST-S3: Backend Producer Streams One Backing Body

Given incoming email, an import, migration, or backend job produces an attachment:

- The producer computes size and raw SHA-256 through a bounded streaming pass when required.
- S3 receives the exact stream and declared content length without the storage boundary materializing or rewinding the whole body.
- SigV4 payload integrity and stored `server_stream` SHA provenance describe the same bytes.
- The storage boundary creates no redundant full-file byte slice.
- A non-seekable producer is sent once and is not replayed automatically after a partial failure.

### Scenario AST-S4: Invalid Metadata Or Broken Stream

Given invalid dimensions, invalid source/relationship kinds, a failed read, a negative content length, or an invalid SHA-256 value:

- The request fails clearly.
- No S3 request is issued when validation can fail before storage.
- No attachment metadata or resource link is created.

## Required Automated Coverage

- Backend direct-upload handler/storage tests must cover policy boundaries, intent/part state, exact signed headers, verification, retry/abort/idempotency, cleanup, and the retained server-streaming PutObject/GetObject behavior without live AWS.
- Frontend attachment tests must cover JSON-only Mango control requests, raw S3 File/Blob PUTs without Mango credentials, bounded-memory hashing, progress, retry/cancel/resume, and partial multi-file success.
- `infra/tests/attachment_direct_upload.test.mjs` is the static contract for source-controlled CORS headers/origins, the multipart lifecycle backstop, prefix-scoped task-role actions, and ECS upload-policy settings.

## Opt-In Dev S3 Integration

`backend/internal/http/attachment_storage_integration_test.go` skips before credential loading unless an explicitly approved isolated dev fixture is configured. It runs `python scripts/verify_agent_db_access_boundary.py` before any S3 request, refuses production-like profiles or prefixes outside `agent-fixtures/`, and covers CORS preflight, single PUT, multipart part PUT/ETag/list/complete, checksum HEAD, abort, and cleanup. It is never part of an agent's normal test run and must not be enabled without Jonat's explicit safe-fixture confirmation.
