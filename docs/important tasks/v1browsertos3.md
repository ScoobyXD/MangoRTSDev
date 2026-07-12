# V1 Browser-to-S3 Attachment Uploads

Status: implementation-ready engineering brief  
Created: 2026-07-10  
Scope: browser-originated Mango attachments, starting with node and text-box attachments  
Related brief: [v1 Mango attachment system.md](./v1%20Mango%20attachment%20system.md)

Implementation target: replace the browser byte-transfer path, not the server upload capability used by non-browser producers.

## How to use this file

Give this file to the implementing Codex instance and tell it to implement the work end to end.

The implementing instance must read the repository's AGENTS.md and the related attachment brief before editing. It must inspect the current code and tests because source code is authoritative and this file is a design handoff, not permission to ignore newer repository changes.

Do not stop at an architecture proposal. Implement the backend, frontend, migrations, infrastructure-as-code, tests, and documentation described here. Do not apply production Terraform or mutate production AWS resources. Infrastructure changes must be committed as code and handed to Jonat for an explicitly approved apply.

## Outcome

Browser-selected files must travel directly from the browser to the private attachment S3 bucket. The Mango API remains the control plane:

1. It authenticates the user.
2. It authorizes the target resource.
3. It creates and owns the upload intent, attachment ID, and S3 key.
4. It issues short-lived presigned upload instructions.
5. It completes or aborts multipart uploads.
6. It verifies the completed S3 object.
7. It writes attachment metadata and the resource link to PostgreSQL.

The file bytes must not pass through the Mango API for normal browser uploads. The file bytes must never be stored in PostgreSQL, resource JSON, text-box projection JSON, base64, or data URLs.

The existing server-side streaming upload capability must remain available for non-browser producers such as incoming email, provider imports, migrations, and backend jobs.

## Fixed product decisions

- The browser upload limit is 1 GiB per file: 1,073,741,824 bytes.
- The backend limit is authoritative and configurable through MANGORTS_ATTACHMENT_MAX_BROWSER_UPLOAD_BYTES with the 1 GiB default.
- Do not retain the current 12 MiB aggregate-per-text-box limit for the direct upload path.
- Each selected file is an independent upload. One failed file must not discard files that already completed.
- Use a single presigned PUT for files up to and including 64 MiB.
- Use S3 multipart upload above 64 MiB.
- Use 16 MiB multipart parts, except the final part, with at most three part uploads in flight for one file and no more than four S3 PUT requests in flight across the page.
- Upload intents live for 24 hours.
- Single PUT URLs live for at most 60 minutes.
- Multipart part URLs live for at most 15 minutes and are issued in small batches so they can be refreshed.
- The frontend must show preparing, uploading, retrying, completing, complete, canceled, and failed states.
- The frontend must show byte-based progress and allow cancellation.
- A page reload must be able to resume an unexpired multipart intent for the same user and file when the local File can be selected or recovered again. At minimum, already accepted S3 parts must not be uploaded twice.
- A completed attachment is anchored to the node/resource, not owned by a text box.
- Deleting a text box must not delete its attachments or attached emails.
- The node-wide attachment counter and list must continue to include attachments originating from any text box in that node.
- Only completed attachments appear in normal node attachment counts and lists. Pending uploads belong in upload-progress UI.
- Row click preview, download behavior, type icons, image thumbnails, and visible filename extensions must continue to work. This task must not regress them.
- Direct upload is for private S3 objects. Do not make the bucket or objects public.

These values are product defaults, not S3's technical maximum. The implementation must make a future limit increase a configuration change rather than an upload rewrite.

## Verified current state

Reconfirm these paths and symbols before changing them:

- Frontend upload entry point: frontend/src/modules/attachments/attachmentApi.ts, function uploadMangoAttachment.
- Current frontend transport: multipart POST /v1/attachments.
- Node call path: addTextBlockAttachments in frontend/src/modules/editor/NodeWorkspaceSurface.tsx through uploadEditorAttachment in NodeWorkspaceSurfaceShared.tsx.
- Backend route: handleAttachmentUpload in backend/internal/http/attachment_handlers.go.
- Streaming storage contract: AttachmentPutObjectInput in backend/internal/http/attachment_storage.go.
- Current input includes Key, ContentType, ContentLength, SHA256, and Body io.ReadSeeker.
- inspectAttachmentUpload hashes, sizes, MIME-sniffs, and rewinds the multipart backing file.
- S3AttachmentStorage.PutObject sends the object to S3.
- Current authenticated content path uses S3AttachmentStorage.GetObject through handleAttachmentContent.
- Attachment persistence is CreateAttachmentWithResourceLink in backend/internal/store/postgres_attachments.go.
- The schema is attachments, attachment_variants, and resource_attachments in backend/db/migrations/20260709_mango_attachments.sql and backend/db/schema.sql.
- Text-block projection creation uses editorAttachmentReferencePayload in frontend/src/modules/editor/editorProjection.ts and deliberately omits legacy dataURL bytes.
- The node UI performs one shared attachment metadata GET per node and reuses the result for node and text-box counters.

Current limits:

- CHAT_ATTACHMENT_MAX_BYTES is 10 MiB per file.
- CHAT_DRAFT_ATTACHMENT_MAX_TOTAL_BYTES is 12 MiB per text box/draft.
- backend/internal/http/request_limits.go applies a 40 MiB general request body ceiling.
- Multipart parsing retains only 1 MiB in memory and spills larger content to a temporary file.

Current storage behavior:

- New attachment bytes live in S3, not PostgreSQL.
- PostgreSQL stores filename, media type, size, SHA-256, bucket/key, dimensions, source metadata, and resource links.
- The current backend streaming flow no longer creates several whole-file in-memory copies.
- The remaining inefficiency for browser uploads is the byte path itself: browser to API, then API to S3, plus backend request lifetime and temporary-file use.

Current SHA-256 invariant:

- attachments.sha256 is text NOT NULL and must be nonblank.
- S3AttachmentStorage.PutObject currently validates a lowercase SHA-256 and uses it for SigV4 payload integrity.
- The database exposes SHA-256 but does not currently deduplicate by it.
- Legacy migration code uses SHA-256 for deterministic IDs and audit identity.
- S3 ETag is not a valid replacement for SHA-256, especially for multipart objects.

Current S3 configuration in attachment_storage.go:

- MANGORTS_ATTACHMENT_S3_BUCKET and existing aliases.
- MANGORTS_ATTACHMENT_AWS_REGION, aliases, then standard AWS region variables.
- MANGORTS_ATTACHMENT_S3_ENDPOINT for a custom endpoint.
- MANGORTS_ATTACHMENT_AWS_PROFILE for local profile use.
- MANGORTS_ATTACHMENT_S3_SERVER_SIDE_ENCRYPTION, default AES256.
- Environment, AWS CLI profile, or ECS task credentials.
- Custom endpoints currently preserve path-style behavior.

## Target sequence

    Browser                 Mango API                    PostgreSQL                 Private S3
       |                        |                            |                          |
       | POST upload intent    |                            |                          |
       |----------------------->| authorize + choose IDs     |                          |
       |                        | create pending intent ---->|                          |
       |<-----------------------| signed PUT or MPU plan      |                          |
       |                        |                            |                          |
       | PUT File/Blob directly ------------------------------------------------------->|
       |<-------------------------------------------------------------------------------|
       |                        |                            |                          |
       | POST complete         | complete MPU if needed     |                          |
       |----------------------->|--------------------------->| S3 API, not file bytes    |
       |                        | HEAD and verify object -------------------------------->|
       |                        | create attachment + link ->|                          |
       |<-----------------------| existing attachment response                           |

The browser sends the Cognito/Mango access token only to Mango API endpoints. It must never send that token, cookies, or Mango authorization headers to S3. The S3 request is authorized only by the short-lived presigned URL and its exact signed headers.

## Upload intent state machine

Create a durable upload-intent record. Do not encode the entire state in a browser token and do not create an attachment row that normal list queries can see before S3 completion.

States:

    pending -> uploading -> completing -> completed
       |          |             |
       +----------+-------------+-> failed
       +----------+-------------+-> aborted
       +----------+-------------+-> expired

Required behavior:

- pending: intent exists; S3 single PUT URL or multipart upload has been prepared.
- uploading: optional observable state; part URLs may be issued and parts may exist.
- completing: use a compare-and-set or row lock so only one request performs completion.
- completed: immutable terminal state containing the resulting attachment ID.
- failed: a recoverable or terminal failure is recorded without exposing secrets.
- aborted: S3 multipart upload is aborted or a single-PUT object is deleted.
- expired: no new URLs can be issued and no completion can occur.
- Completion is idempotent. Repeating it returns the same MangoAttachmentUploadResponse.
- Abort is idempotent.
- A clientRequestId makes intent creation idempotent for one company, actor, and target.
- An intent must never be repointed to another key, resource, company, actor, or attachment ID.
- Permission is checked both when the intent is created and when it is completed.
- If permission is revoked between those calls, completion fails and the object is cleaned up.

## Upload-intent persistence

Add a migration and update backend/db/schema.sql. Follow existing migration naming and repository conventions.

Use a table equivalent to attachment_upload_intents with at least:

- id UUID primary key.
- company_id UUID, derived from authenticated context.
- actor_user_id or the repository's authoritative actor identifier.
- attachment_id UUID, generated by the backend before signing.
- resource_type and resource_id.
- relationship_kind and source_kind.
- information_id, nullable.
- editor_surface, nullable if current rules permit.
- original_filename.
- declared_content_type.
- expected_size_bytes BIGINT.
- bucket.
- object_key.
- upload_strategy: single or multipart.
- s3_multipart_upload_id, nullable and never returned directly to an untrusted client.
- part_size_bytes and expected_part_count for multipart.
- client_request_id.
- status.
- sha256, required at creation after the browser's bounded-memory preparation pass.
- sha256_verification_method, for example s3_full, server_stream, or client_reported.
- storage_checksum_algorithm, value, and type when returned by S3.
- expires_at, created_at, updated_at, completed_at, and optional failure_code.

Constraints and indexes:

- Unique company_id + actor identifier + client_request_id.
- Unique attachment_id.
- Unique bucket + object_key.
- Nonnegative expected_size_bytes. This brief requires that zero-byte files work through single PUT.
- Valid state, strategy, checksum-verification, and terminal-state checks.
- Index status + expires_at for cleanup.
- Index company_id + resource_type + resource_id for operational lookup.

Do not store presigned URLs, AWS credentials, session tokens, raw signed headers, file bytes, base64, or data URLs in this table.

Use a transaction to create the final attachment, create its resource link, and mark the intent completed. If S3 completes but the transaction fails, a retry must recover and finish the same attachment rather than creating a duplicate. Expired orphan cleanup is the final safety net, not the normal consistency mechanism.

Add an attachment_upload_parts table or an equivalently durable normalized representation for multipart intent state:

- intent_id + part_number as the primary/unique key.
- Expected byte length.
- Signed checksum algorithm and value.
- Signing timestamp/attempt metadata, without storing the signed URL.
- Optional last observed S3 ETag/checksum for diagnostics and resume.

Signing the same part number with the same checksum is idempotent and may return a fresh URL. A different checksum for an already established part is a file-identity mismatch and must be rejected unless the prior multipart upload is explicitly abandoned and a new intent is created.

Persist checksum provenance on the final attachments row too, not only on the temporary intent. Add final attachment fields equivalent to sha256_verification_method plus storage_checksum_algorithm, storage_checksum_value, and storage_checksum_type. Backfill existing rows honestly as server-computed/migrated according to their creation path. Keep API compatibility for the existing sha256 field.

## Resource ownership and node rules

The primary resource link for a node/text-box upload must be the node or other durable parent resource used by the current node-wide attachment query.

information_id or the equivalent text-box identifier is origin/display context only. It must not be the sole owner of the attachment.

Required invariants:

- Deleting a text box removes its projection/content but not the attachment row, S3 object, or durable node resource link.
- If the schema keeps an origin text-box reference, use a nullable foreign key with SET NULL or an intentionally non-cascading logical identifier.
- Completion must still be able to succeed if the originating text box is deleted while an upload is in progress, provided the node still exists and the actor still has node edit permission.
- Node-wide list and count use the durable node resource link.
- Text-box filtering may use origin metadata but cannot control lifetime.
- Email links follow the same lifetime rule: deleting a text box does not delete the email or its node-level association.
- Preserve existing source_kind, relationship_kind, resource constraints, information_id, and editor_surface semantics because grouping and display depend on them.

Do not invent a second, competing node attachment model.

## API contract

Use existing route registration, authentication, error-envelope, casing, and DTO conventions. The exact route names may be adjusted to match those conventions, but the API must expose these operations.

### 1. Read browser upload policy

    GET /v1/attachments/upload-policy

Example response:

~~~json
{
  "directUploadEnabled": true,
  "maxFileBytes": 1073741824,
  "singlePutMaxBytes": 67108864,
  "multipartPartBytes": 16777216,
  "maxConcurrentParts": 3,
  "intentLifetimeSeconds": 86400
}
~~~

This is cacheable user-visible policy, not authorization to upload. Intent creation remains authoritative. Do not expose bucket names or AWS details here.

### 2. Create an upload intent

    POST /v1/attachments/upload-intents

Example request:

~~~json
{
  "clientRequestId": "browser-generated-uuid",
  "filename": "quarterly-results.xlsx",
  "sizeBytes": 48123719,
  "sha256": "64-lowercase-hex-content-sha256",
  "contentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "resourceType": "node",
  "resourceId": "resource-uuid",
  "relationshipKind": "existing-current-value",
  "sourceKind": "existing-current-value",
  "informationId": "optional-text-box-id",
  "editorSurface": "optional-existing-value"
}
~~~

The request must not accept company ID, actor ID, attachment ID, S3 bucket, S3 key, S3 upload ID, encryption settings, or expiry.

For single PUT, return:

~~~json
{
  "uploadIntentId": "intent-uuid",
  "attachmentId": "server-generated-uuid",
  "expiresAt": "RFC3339 timestamp",
  "upload": {
    "strategy": "single",
    "method": "PUT",
    "url": "short-lived-presigned-url",
    "requiredHeaders": {
      "content-type": "signed-content-type",
      "x-amz-checksum-sha256": "base64-form-of-the-request-sha256",
      "x-amz-server-side-encryption": "AES256-if-signed"
    }
  }
}
~~~

The frontend calculates raw SHA-256 in its preparing state before creating the intent. It sends lowercase hex; the backend validates it and converts it to the encoding required by the S3 checksum header. Never load the complete file into memory to calculate it.

For multipart, return:

~~~json
{
  "uploadIntentId": "intent-uuid",
  "attachmentId": "server-generated-uuid",
  "expiresAt": "RFC3339 timestamp",
  "upload": {
    "strategy": "multipart",
    "partSizeBytes": 16777216,
    "partCount": 13
  }
}
~~~

Do not return all presigned part URLs up front and do not return the raw S3 multipart upload ID.

### 3. Sign one or more multipart parts

    POST /v1/attachments/upload-intents/{intentId}/parts

Example request:

~~~json
{
  "parts": [
    {
      "partNumber": 1,
      "checksumAlgorithm": "SHA256",
      "checksum": "base64-part-checksum"
    }
  ]
}
~~~

Example response:

~~~json
{
  "parts": [
    {
      "partNumber": 1,
      "method": "PUT",
      "url": "short-lived-presigned-part-url",
      "expiresAt": "RFC3339 timestamp",
      "requiredHeaders": {
        "x-amz-checksum-sha256": "base64-part-checksum"
      }
    }
  ]
}
~~~

Rules:

- Limit one request to a small batch, for example 20 part numbers.
- Part numbers must be within the intent's calculated range.
- Expected part size is calculated by the backend from intent size and part size; only the final part may be shorter.
- Checksum headers and values included in the signature must be sent exactly by the browser.
- Never sign arbitrary client headers.
- Never allow a key or S3 upload ID in this request.
- Refuse expired, terminal, wrong-actor, wrong-company, or unauthorized intents.

### 4. Read resumable intent state

    GET /v1/attachments/upload-intents/{intentId}

Return safe intent metadata, current state, and accepted part numbers/ETags/checksums. The backend obtains authoritative multipart part state with ListParts when needed. Do not trust only browser local storage.

This endpoint must not return credentials, the raw S3 upload ID, stale presigned URLs, or another user's intent.

### 5. Complete

    POST /v1/attachments/upload-intents/{intentId}/complete

Single PUT request body:

~~~json
{}
~~~

Multipart request body:

~~~json
{}
~~~

For multipart, the backend calls ListParts and constructs CompleteMultipartUpload from S3's authoritative consecutive parts, not from a client-supplied ETag list. It uses only the intent-owned bucket, key, and upload ID, and compares every S3 part checksum with the checksum stored when that part was signed. It then performs HeadObject with checksum mode enabled.

Completion verifies:

- Current actor and company own the intent.
- Current actor still has edit permission through requireAttachmentResourceEdit.
- Intent is not expired, aborted, or failed.
- S3 object is at the exact intent-owned bucket and key.
- ContentLength exactly equals expected_size_bytes.
- Multipart part count and order are correct.
- S3 accepted the signed part checksums.
- For single PUT, S3's persisted full-object SHA-256 equals the intent's raw SHA-256.
- Server-side encryption matches policy.
- Stored checksum metadata is captured.
- Filename, resource context, and display metadata come from the intent, not the completion request or S3 user metadata.

Return the existing MangoAttachmentUploadResponse shape so node/editor call sites need minimal change. If the intent already completed, return the same response with success.

### 6. Abort

    DELETE /v1/attachments/upload-intents/{intentId}

For multipart, call AbortMultipartUpload. For a completed single PUT that has not been finalized, call DeleteObject. Mark the intent aborted. Repeating the request succeeds.

Client cancellation should call this endpoint best-effort after aborting active browser requests.

## SHA-256 and S3 checksum design

Do not weaken or fake the current SHA-256 field.

Requirements:

- SHA-256 means the raw file-content SHA-256, not ETag and not an S3 multipart composite value.
- Compute browser SHA-256 incrementally in bounded chunks, preferably in a Web Worker, before creating the upload intent.
- Never call file.arrayBuffer() for the entire file.
- Never encode the file as base64 or a data URL.
- The preparation pass reads the local File once in bounded chunks. The subsequent S3 upload reads it again but creates no whole-file copy and sends no bytes through Mango API.
- For multipart, calculate each part's S3 checksum just before queueing that bounded File slice for upload.
- Use S3-supported part checksum headers so S3 validates every uploaded part.
- Preserve the returned S3 checksum algorithm, value, and checksum type separately from raw SHA-256.
- Mark how SHA-256 was verified. Existing backend-streamed rows are server_stream. A single PUT whose full SHA-256 S3 validates is s3_full. Multipart raw SHA-256 is client_reported unless a later trusted processor verifies it; its S3 part checksums remain independently verified.
- Never use client_reported SHA-256 as a security decision or trusted deduplication key.
- Do not put a CRC, ETag, or composite digest into attachments.sha256.
- Keep attachments.sha256 nonblank for now unless a deliberate repository-wide migration proves nullable SHA is cleaner and updates every consumer and migration.

The preferred frontend implementation uses a dedicated worker and an incremental hashing package already present in the repository, if one exists. If a dependency is required, select a small maintained package with browser and worker support. Add dependency lockfile changes intentionally. Do not implement cryptographic primitives from scratch.

Memory must be O(part size times concurrency), not O(file size). With 16 MiB parts and concurrency three, file-processing memory should stay bounded near the active chunks plus normal browser/network overhead regardless of whether the file is 80 MiB or 1 GiB.

## Browser transport implementation

Presigned S3 uploads use normal HTTPS requests supported by current Chrome, Edge, Firefox, and Safari. There are no AWS credentials in the browser.

Use XMLHttpRequest for the raw S3 PUTs if the current browser target needs reliable upload-progress events. fetch upload progress is not consistently available across the supported browser set.

Transport rules:

- Send File or Blob bytes directly to the presigned S3 URL.
- For multipart, use File.slice(start, end).
- Send only the exact required signed headers.
- Do not attach Mango's API client interceptors to S3 requests.
- Do not send Authorization, cookies, company headers, tracing headers, or JSON content type unless they are explicitly signed.
- Capture ETag from every successful multipart response. S3 CORS must expose it.
- Treat a network error with no readable response as a possible CORS failure and log a useful non-secret diagnostic.
- Retry network errors, 408, 429, and retryable 5xx responses with exponential backoff and jitter.
- On 403 from an expired part URL, ask Mango API for a new URL for that same part rather than restarting the full upload.
- Cap automatic part attempts, for example at five. Leave the upload resumable after retry exhaustion.
- Aggregate multipart progress by confirmed bytes plus in-flight request progress.
- Abort active requests on user cancel and component teardown.
- Never retain File/Blob objects in global Redux-like persisted state or serialize them.
- Local resume metadata may contain intent ID, filename, size, lastModified, and relative path fingerprint, but never a presigned URL.

Preserve the public uploadMangoAttachment behavior if practical. Split its internals into small control-plane and byte-transport helpers so tests can separately cover Mango API calls and S3 PUT behavior.

## S3 object-store design

Add a direct-upload/presigner abstraction instead of turning AttachmentObjectStorage into an unstructured collection of AWS-specific calls.

The backend needs provider operations equivalent to:

- PresignPutObject.
- CreateMultipartUpload.
- PresignUploadPart.
- ListParts.
- CompleteMultipartUpload.
- AbortMultipartUpload.
- HeadObject with checksum metadata.
- DeleteObject for abandoned single-PUT objects.

Keep PutObject and GetObject for backend-originated uploads and current authenticated downloads.

Prefer the AWS SDK for Go v2 S3 client and presign client. Do not extend a handwritten SigV4 implementation for the new browser flow. Keep custom endpoint and path-style behavior covered by tests.

Object key rules:

- The backend generates the attachment ID and object key.
- Use opaque IDs, for example companies/{companyID}/nodes/{nodeID}/attachments/{attachmentID}/original.
- Do not place the original filename in the key. Store it in PostgreSQL.
- Normalize and validate filename for display and Content-Disposition, not for authority.
- A repeated intent must reuse its assigned key; a different intent must get a different key.
- Never overwrite an existing completed attachment object.

The browser should not choose object metadata. Apply server-side encryption, storage class, tags, and other object policy from backend configuration.

For custom/local endpoints, distinguish the server-reachable endpoint from the browser-reachable presign endpoint when necessary. Add an explicit setting such as MANGORTS_ATTACHMENT_S3_PRESIGN_ENDPOINT rather than emitting a URL containing an ECS-only, Docker-only, or loopback hostname that the browser cannot reach. The hostname used in the signature must match the hostname the browser uses.

## S3 CORS

Manage bucket CORS in infra/modules/mangorts-platform/ and environment configuration. Do not apply it to production from an agent session.

CORS must:

- Allow only the actual Mango application origins for each environment, plus the documented local origin in development.
- Allow PUT for single and multipart part uploads.
- Allow GET/HEAD only if current thumbnail/preview behavior needs direct S3 reads. Current authenticated backend downloads may remain unchanged in this task.
- Allow every exact signed request header, including content-type, checksum headers, and signed server-side-encryption headers.
- Expose ETag and any checksum response headers the frontend reads.
- Set a reasonable preflight max age.
- Avoid wildcard production origins.

Example shape, adjusted to actual signed headers:

~~~json
[
  {
    "AllowedOrigins": ["https://actual-app-origin.example"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": [
      "content-type",
      "x-amz-checksum-sha256",
      "x-amz-server-side-encryption"
    ],
    "ExposeHeaders": ["ETag", "x-amz-checksum-sha256"],
    "MaxAgeSeconds": 3600
  }
]
~~~

Do not cargo-cult this example. Generate a presigned request in tests/dev, inspect its signed headers, and make the IaC match exactly.

## IAM and lifecycle

The backend task role/presigning principal needs the minimum bucket/prefix permissions for:

- PutObject and multipart part upload signing.
- AbortMultipartUpload.
- ListMultipartUploadParts.
- GetObject/HeadObject verification.
- DeleteObject for abandoned pre-finalization objects.
- Existing GetObject and PutObject server flows.

Keep permissions limited to the attachment bucket and expected key prefix. If SSE-KMS is configured later, add only the required KMS permissions and signed headers; default AES256/SSE-S3 should continue to work.

Configure an S3 lifecycle AbortIncompleteMultipartUpload rule so abandoned multipart storage is eventually reclaimed. Add application cleanup too:

- Periodically find expired pending/uploading intents.
- Abort their multipart upload or delete their unfinalized single-PUT object.
- Mark them expired.
- Retry cleanup safely.
- Emit metrics for cleanup failures.

The lifecycle rule is a backstop for application cleanup.

## Authorization and security invariants

Security is not the reason for this project, but the direct upload must not create an obvious authority bypass.

- Derive company and actor from authenticated request context.
- Run requireAttachmentResourceEdit when issuing an intent and again at completion.
- Bind the intent to company, actor, resource type/id, information_id, editor_surface, relationship_kind, source_kind, attachment ID, bucket, key, expected size, filename, and expiry.
- Never accept those authority fields again at completion.
- Presigned URLs are short-lived bearer capabilities. Do not log their query strings.
- Do not put presigned URLs in PostgreSQL, projections, analytics payloads, error reporting, or browser-persisted state.
- Sanitize logs so S3 upload IDs and signed URLs are absent.
- A URL signs only one opaque key and required headers.
- HEAD verification must use the intent-owned key, never a client-provided key.
- Completion must reject size mismatch even if S3 accepted the object.
- Existing handleResourceAttachmentLink must not be reused without verifying access to the source attachment/resource. Current same-company lookup plus destination edit permission is not sufficient proof of source read authority.
- Rate-limit intent creation and part signing through existing API mechanisms if available.
- Keep bucket public access blocked.

Content scanning, malware quarantine, and advanced content validation are outside v1 unless an existing scanner already provides them. The state machine should leave room for a future quarantined/processing state without redesigning ownership.

## Compatibility and cleanup of old code

Do not delete server-side PutObject. It is still needed by migrations, incoming email, provider imports, and non-browser producers.

Do not write any new inline dataURL/base64 attachment bytes. Keep legacy dataURL parsing/fileFromDataURL read compatibility only until repository search and migration evidence prove all legacy inline data is gone. Removing the only reader before migration completion would strand old content.

For the old browser multipart POST /v1/attachments:

1. Build and test the direct path.
2. Switch uploadMangoAttachment and all browser call sites to the direct path.
3. Search the full repository for remaining callers.
4. Keep a temporary fallback only if deployment ordering requires it because bucket CORS/IAM cannot be applied atomically with frontend deployment.
5. Once every environment has direct upload enabled and no supported client calls the old route, delete the browser-only multipart route, its 10 MiB/12 MiB UI policy, and dead tests/helpers.
6. Retain shared validation and server-streaming storage code used by non-browser sources.

Do not leave two permanent browser upload implementations.

The 40 MiB generic API request cap remains useful because direct intent/complete calls are tiny JSON. Do not raise it merely to accommodate attachments after file bytes bypass the API.

## Frontend behavior

Keep the existing node attachment experience:

- The paperclip/add-attachment control begins selection and upload.
- The adjacent node-wide attachment count opens the aggregate list.
- The list includes attachments from all text boxes in the node.
- Each row shows a type icon; image rows show a thumbnail when available.
- The extension remains visibly pinned at the title's right edge even when the basename is truncated.
- Row click previews/views the attachment.
- The download button remains a separate explicit action and must not trigger the row preview.
- Deleting a text box does not make completed rows disappear from the node-wide list.

Add upload UX without turning the attachment list into a second nested card:

- Show each selected file once with filename, extension, size, progress, state, cancel, and retry.
- Keep successful files visible/available even if a sibling upload fails.
- Announce failures accessibly and preserve keyboard operation.
- Do not block node editing while S3 transfers continue.
- If a text box is deleted during upload, keep the progress item at node level and finalize to the node if authorization still passes.
- Refresh/invalidate the shared node attachment query once per successful completion, not on every part.

The separate mention/profile color fix is not part of this direct-upload migration, but this work must not regress the existing colored @ and ! suggestion rows.

## Backend implementation boundaries

Expected files include, after confirming current repository layout:

- backend/internal/http/attachment_handlers.go
- backend/internal/http/attachment_storage.go
- backend/internal/store/repository.go
- backend/internal/store/postgres_attachments.go
- backend/internal/store/memory_attachments.go
- backend/internal/domain/types.go if checksum provenance is exposed
- backend/db/schema.sql
- a new backend/db/migrations migration
- route registration and configuration files discovered by repository search

Keep HTTP orchestration, durable repository state, and S3 provider operations separated. Handler tests should use fakes and must not require AWS.

Repository operations should make state transitions explicit instead of exposing generic update-any-field methods.

## Frontend implementation boundaries

Expected files include:

- frontend/src/modules/attachments/attachmentApi.ts
- frontend/src/modules/editor/NodeWorkspaceSurface.tsx
- frontend/src/modules/editor/NodeWorkspaceSurfaceShared.tsx
- existing attachment-list/progress components discovered by repository search
- a focused browser S3 transport module
- a dedicated hashing worker/module
- frontend type definitions and query invalidation code

Do not introduce the AWS SDK or AWS credentials into the browser merely to PUT to presigned URLs. A small transport using the existing API client for control-plane calls and raw XMLHttpRequest for S3 is sufficient.

## Infrastructure boundaries

Expected IaC lives under infra/modules/mangorts-platform/. Inspect all environment consumers before changing module inputs.

Implement:

- Attachment bucket CORS.
- Required task-role S3 actions.
- AbortIncompleteMultipartUpload lifecycle rule.
- Explicit environment configuration for max bytes, direct-upload enablement, URL expiry, and any browser-reachable custom endpoint.

Do not run terraform apply. Do not change production Route53, Cognito, RDS, ECS, ECR, Secrets Manager, GitHub environments, or live bucket settings without explicit user approval.

Before any AWS or database access, run:

    python scripts/verify_agent_db_access_boundary.py

Stop if it reports admin/write access, static keys, or another prohibited write path. Unit tests and local source changes do not require live AWS or database access.

## Error contract

Use stable machine-readable error codes alongside existing API error formatting. At minimum distinguish:

- attachment_file_too_large, including maxFileBytes.
- attachment_upload_intent_expired.
- attachment_upload_intent_not_found.
- attachment_upload_intent_forbidden.
- attachment_upload_state_conflict.
- attachment_upload_part_invalid.
- attachment_upload_checksum_mismatch.
- attachment_upload_size_mismatch.
- attachment_upload_incomplete.
- attachment_upload_storage_unavailable.

Do not expose bucket, key, upload ID, AWS request signing details, or raw provider errors to the browser.

## Observability

Add structured, non-secret events/metrics for:

- Intent created.
- Single versus multipart selection.
- Bytes expected and completed.
- Part retry count.
- Completion latency.
- Aborted/expired intent count.
- Checksum/size mismatch.
- Orphan cleanup success/failure.
- S3 provider error category.

Safe identifiers are intent ID, attachment ID, company ID according to existing logging policy, strategy, part number, size, status, and stable error code. Never log signed URLs, query strings, Authorization headers, raw upload IDs, file bytes, or tokens.

## Tests

### Backend handler tests

- Authenticated authorized intent creation.
- Unauthenticated and unauthorized creation.
- Wrong company, actor, or resource.
- File exactly at 1 GiB accepted and one byte above rejected without touching S3.
- Zero-byte file uses single PUT and completes.
- Single/multipart strategy boundary at 64 MiB.
- Server-generated key/attachment ID; client cannot inject either.
- Exact signed headers returned.
- Expired intent cannot sign parts or complete.
- Permission revoked between creation and completion.
- Wrong actor cannot resume, sign, complete, or abort.
- Invalid, duplicate, missing, out-of-range, and nonconsecutive parts.
- Wrong final-part size.
- S3 HEAD size mismatch.
- Checksum mismatch.
- Encryption-policy mismatch.
- Completion idempotency under sequential and concurrent replay.
- Abort idempotency.
- S3 completion succeeds but DB transaction fails; retry recovers.
- Text box deleted during upload; node-authorized completion still succeeds.
- Node deleted or permission lost; completion fails and cleanup occurs.
- Completed attachment has the same response shape and resource metadata as the current upload.
- Pending/failed intents never appear in normal attachment lists/counts.

### Storage/presigner tests

- AWS SDK v2 presign operations use the configured bucket, key, region, expiry, encryption, and checksums.
- Custom endpoint and path-style URLs are correct.
- Browser-reachable presign endpoint is honored.
- No client-provided key or upload ID reaches provider calls.
- Multipart complete and abort use the stored intent values.
- HeadObject requests checksum metadata.
- Existing PutObject streaming and GetObject behavior remain covered.
- Signed header output matches the CORS allow/expose set documented in IaC.

### Repository tests

- All state transitions and terminal-state guards.
- Idempotent clientRequestId.
- Idempotent final attachment/resource-link creation.
- Concurrent completion.
- Expiry scan.
- Text-box deletion does not cascade into attachment/resource link.
- Memory and PostgreSQL repositories have equivalent behavior.

### Frontend tests

- Policy and intent requests send JSON metadata only, never file bytes.
- S3 request sends raw File/Blob bytes and no Mango Authorization header.
- Exact required signed headers are sent.
- Progress aggregation is accurate.
- Cancellation aborts requests and calls the API abort endpoint.
- Retry obtains a fresh URL after expiry.
- Retry does not re-upload confirmed multipart parts.
- Resume reconciles local state with backend/ListParts state.
- Whole-file arrayBuffer, base64, dataURL, and FormData-to-Mango are absent from the new path.
- SHA-256 is the raw file hash and is calculated with bounded memory.
- Partial multi-file success remains attached.
- Completion triggers one node attachment refresh.
- Long names preserve the visible extension.
- Image thumbnail/type icon/preview/download row behavior remains intact.
- Deleting a text box during/after upload preserves the node-level attachment.

### Integration tests

Create an opt-in local/dev S3 integration test that covers CORS preflight, single PUT, multipart PUT, ETag exposure, completion, HEAD checksum, abort, and cleanup. It must skip clearly when the safe dev fixture is not configured.

Do not require live AWS for the normal unit suite.

## Documentation to update with implementation

When code and verification land, update:

- docs/important tasks/v1 Mango attachment system.md with a reciprocal link and the new control-plane/data-plane flow.
- docs/tests/attachment-streaming.md to distinguish backend-originated streaming from browser direct upload.
- the appropriate node business-rules document under docs/tests so attachment/email lifetime is explicitly node-level.
- docs/frontend/src/modules/editor.md with node-wide aggregation, progress, preview, and text-box deletion behavior.
- Any API/storage test guide affected by the new endpoints.
- prod launch progress log.md only after the relevant environment is actually deployed and verified.

Do not claim production deployment in docs when only source/IaC changes exist.

## Implementation order

1. Read AGENTS.md, this file, the related Mango attachment brief, docs/tests, and current source/tests.
2. Run repository-wide searches for every browser and server caller of POST /v1/attachments, PutObject, SHA256, dataURL, and fileFromDataURL.
3. Record a clean baseline of targeted tests and git status without reverting user changes.
4. Add upload-intent domain/repository state and migration.
5. Add S3 SDK v2 presigner/multipart/head/abort/delete operations behind focused interfaces.
6. Add policy, intent, part-signing, status, complete, and abort handlers.
7. Add backend unit tests before connecting the frontend.
8. Add the browser worker/checksum and direct S3 transport.
9. Switch uploadMangoAttachment internally while preserving its useful call-site contract.
10. Add progress/cancel/retry/resume UI using existing attachment styling.
11. Add CORS/IAM/lifecycle IaC and tests, without applying production changes.
12. Verify text-box deletion and node-wide grouping.
13. Remove dead browser-only upload code if repository and deployment compatibility permit; retain server-source streaming.
14. Update docs listed above.
15. Run targeted tests, backend go test ./..., frontend typecheck/tests/build, and the repository full test runner.
16. Inspect git diff/status and report exactly what passed, what was skipped, and what still requires an approved infrastructure deployment.

## Verification commands

Use repository-native commands and adjust only when package scripts show different names:

    cd backend
    go test ./...

    cd ../frontend
    npm test -- --run
    npm run build

    cd ..
    node scripts/run_all_tests.mjs

Run focused packages/tests during development. Do not run npm install from repository root. Use npm ci in frontend only when dependencies must be restored.

For frontend visual behavior, start the local backend/frontend and verify the attachment dropdown at desktop and mobile widths. Check long filenames, extensions, image thumbnails, progress rows, row preview, download click isolation, deletion persistence, and failed/retried uploads. Capture screenshots when the local environment supports it.

## Definition of done

This task is complete only when:

- Normal browser attachment bytes go browser-to-S3 and never through Mango API.
- Mango API remains authoritative for auth, permissions, IDs, keys, size policy, finalization, and metadata.
- 1 GiB files are accepted and larger files are rejected before upload.
- Single PUT and multipart upload both work with bounded memory.
- Multipart retry, cancel, expiry, idempotent completion, and abandoned cleanup are implemented.
- SHA-256 retains its raw-file meaning and S3 checksum metadata is represented honestly.
- No new file bytes/base64/data URLs are written to PostgreSQL or projections.
- Node/text-box ownership and deletion rules are preserved.
- Existing attachment list icons, image thumbnails, visible extensions, preview, and downloads still work.
- Server-originated attachment uploads still work.
- CORS/IAM/lifecycle changes exist as reviewed IaC.
- All relevant automated tests pass, or any environment-only skips are explicitly reported.
- Documentation contains precise business rules and does not falsely claim a production deployment.

## Official S3 references

- Presigned uploads: https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html
- Presigned URL behavior and checksum headers: https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html
- Multipart overview: https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html
- Multipart limits: https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html
- Upload checksum integrity: https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html
- CompleteMultipartUpload API: https://docs.aws.amazon.com/AmazonS3/latest/API/API_CompleteMultipartUpload.html

Treat AWS documentation and the installed AWS SDK version as authoritative for exact checksum/header behavior. Add tests for the actual generated presigned requests instead of relying on assumptions.
