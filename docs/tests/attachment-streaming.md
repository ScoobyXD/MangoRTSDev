Last updated: 2026-07-13

# Attachment Transfer And Streaming Tests

## Business Logic

AST1 - Normal browser-selected attachment bytes travel directly from the browser to private S3 through short-lived presigned requests. Mango API receives JSON control-plane requests only and must not receive browser file bytes, `FormData` file parts, base64, or data URLs.

AST2 - Browser preparation computes the raw file-content SHA-256 incrementally in bounded chunks. It must not call whole-file `arrayBuffer()`, encode the file as base64/data URL, or retain memory proportional to file size.

AST3 - Browser files through and including 64 MiB use one presigned PUT. Larger browser files use resumable multipart upload with 16 MiB parts, at most three parts in flight for one file and four S3 PUTs in flight across the page. Raw `File`/`Blob` or bounded `File.slice` bodies go to S3 with only the exact signed headers and no Mango authorization header or cookie.

AST4 - The configurable browser limit defaults to 1 GiB (1,073,741,824 bytes) per file. The old 12 MiB aggregate-per-text-box limit does not apply to direct browser upload. Each file succeeds or fails independently, and only completed attachments enter normal lists/counts.

AST5 - Browser upload intents and multipart part state are durable and idempotent. Retry refreshes an expired URL for the same intent/part; resume reconciles accepted S3 parts; cancel aborts active requests and best-effort aborts the intent; expiry cleanup aborts multipart work or deletes an unfinalized single-PUT object. Natural TTL expiry remains `expired`, while only an explicit abort/cancel records `aborted`. S3 AbortIncompleteMultipartUpload lifecycle is a backstop, not the primary cleanup path.

AST6 - `attachments.sha256` always means raw file-content SHA-256. S3 checksum algorithm/value/type and SHA verification provenance are separate fields: single PUT may be `s3_full`, backend streaming is `server_stream`, and multipart raw SHA remains `client_reported` unless a trusted processor later verifies it. ETag and multipart composite checksums never replace raw SHA-256.

AST7 - Backend-originated producers such as incoming email, provider imports, migrations, and backend jobs retain the streaming storage path. That boundary accepts an `io.Reader`, exact content length, and precomputed SHA-256 and streams without requiring seek support, `io.ReadAll`, `bytes.Clone`, or another full-file hash pass. Seekable streams may use normal SDK retries; a non-seekable stream is never replayed automatically after a partial request.

AST8 - Backend-originated producers validate metadata and derive content type/hash with bounded work before calling storage. Invalid metadata, cancellation, storage failure, or authorization failure must not create final attachment metadata/resource links. The removed browser multipart HTTP handler is not a fallback server-streaming path.

AST9 - The legacy inline-attachment migration may begin with already-decoded bytes because extraction is its purpose, but it must wrap those bytes in a reader and must not add another full-file clone at the S3 boundary.

AST10 - Postgres stores durable metadata, checksum provenance, intent/part state, and resource links only. It never stores presigned URLs, S3 upload IDs exposed to clients, browser file bytes, base64, or data URLs.

AST11 - Static JPEG/PNG display and thumbnail generation begins only after original upload finalization/linking commits. It is bounded and best-effort, uses exact-length seekable derivative uploads plus content-addressed immutable keys, records derivative SHA/version metadata idempotently, and processes/persists each derivative independently. It never turns derivative failure into original-upload failure. Unsupported/animated, non-default JPEG-orientation, or over-limit images remain on original fallback.

AST12 - Outbound email attachment resolution is metadata-first. Recipient/content validation, tenant-scoped original metadata, active resource-link authorization, nonnegative sizes, and the overflow-safe 24,000,000-byte aggregate all pass before any S3 GetObject. The general 1 GiB browser limit is independent; zero-byte email attachments and an aggregate of exactly 24,000,000 bytes are valid.

AST13 - Outbound S3 readers open only after the Nylas send gate admits the request. Their reported length must equal preflight metadata and their byte stream must be exactly that length. Multipart encoding supplies a deterministic Content-Length while streaming through bounded memory, without outbound base64 or a complete multipart buffer, and closes readers on every completion, error, cancellation, or provider-failure path. Incoming provider attachment and calendar raw-MIME behavior is unchanged.

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

Given an empty file, a file exactly 1 GiB, a file one byte too large, and sibling uploads:

- The empty file uses single PUT and the raw empty-payload SHA-256.
- Exactly 1 GiB is accepted; one byte above is rejected before S3 is touched.
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

### Scenario AST-S5: Post-Finalization Image Derivatives

Given a supported still image, unsupported/animated image, and a completed-intent replay:

- Original attachment/link finalization completes before any decode, encode, derivative storage write, or variant upsert.
- Supported static JPEG/PNG processing is magic-sniffed before a full bounded source copy, then capped by source bytes, dimensions, pixels, output size, timeout, and concurrency one; display fits within 2048x2048 and thumbnail within 384x384 without upscaling. A JPEG whose EXIF orientation is not safely normalized is skipped.
- GIF/WebP/APNG/SVG/AVIF/HEIC and over-limit inputs skip generation and retain original fallback.
- First completion and completed replay may invoke the idempotent ensure service, so a prior best-effort failure can retry.
- Timeout, decode, encode, storage, or upsert failure is logged with a bounded reason and the completed original response still succeeds; one derivative's failure cannot discard the successfully stored/upserted sibling.

### Scenario AST-S6: Outbound Email Metadata Preflight And Exact Streaming

Given an outbound message contains zero-byte, boundary-sized, unauthorized, oversized, mismatched, truncated, overlong, failing, or canceled Mango attachment streams:

- Missing recipients or empty content without valid references fails before attachment work.
- Every unique attachment uses one tenant/soft-delete-scoped original metadata-and-links read; repeated authorization targets may reuse the same permission result without weakening checks.
- The complete declared aggregate is validated before S3, so a rejected final item cannot cause an earlier object read.
- After admission, objects open in output order and stream directly to Nylas with deterministic multipart length.
- Storage Content-Length disagreement fails before body reads; short, long, and failing streams terminate the multipart send and every opened body closes.
- The HTTP consumer can receive multipart bytes before the source finishes, and a non-replayable stream is never retried accidentally.
- Incoming Nylas attachment downloads, MIME recovery, and calendar RSVP parsing continue to use the shared inbound attachment content model.

## Required Automated Coverage

- Backend direct-upload handler/storage tests must cover policy boundaries, intent/part state, exact signed headers, verification, retry/abort/idempotency, cleanup, and the retained server-streaming PutObject/GetObject behavior without live AWS.
- Backend outbound-email tests must cover metadata-only rejection before S3, exact aggregate boundaries, authorization/query shape, deterministic multipart `Content-Length`, bounded exact stream reads, lazy open order, cancellation/provider failure, and source closure without live S3 or Nylas.
- Frontend attachment tests must cover JSON-only Mango control requests, raw S3 File/Blob PUTs without Mango credentials, bounded-memory hashing, progress, retry/cancel/resume, and partial multi-file success.
- `infra/tests/attachment_direct_upload.test.mjs` is the static contract for source-controlled CORS headers/origins, the multipart lifecycle backstop, prefix-scoped task-role actions, and ECS upload-policy settings.

## Opt-In Dev S3 Integration

`backend/internal/http/attachment_storage_integration_test.go` skips before credential loading unless an explicitly approved isolated dev fixture is configured. It runs `python scripts/verify_agent_db_access_boundary.py` before any S3 request, refuses production-like profiles or prefixes outside `agent-fixtures/`, and covers CORS preflight, single PUT, multipart part PUT/ETag/list/complete, checksum HEAD, abort, and cleanup. It is never part of an agent's normal test run and must not be enabled without Jonat's explicit safe-fixture confirmation.
