Last updated: 2026-07-10

# Attachment Streaming Tests

## Business Logic

AST1 - Normal multipart attachment uploads must not materialize redundant full-file byte slices in the API process. The multipart parser may retain at most the configured small-file memory threshold; larger file parts use request-scoped temporary storage.

AST2 - Before S3 storage, the API reads the seekable multipart file as a stream to compute the authoritative byte size and SHA-256 value. Content detection reads only the bounded sniff prefix. The file must then be rewound for storage.

AST3 - The S3 storage boundary accepts a seekable body, exact content length, and precomputed SHA-256 payload hash. It rewinds and streams that body directly into the signed request without `io.ReadAll`, `bytes.Clone`, or a second payload-hash pass.

AST4 - The SHA-256 value used for SigV4, S3 transfer, and attachment metadata must describe the same bytes. Invalid or incomplete stream metadata must fail before any S3 request.

AST5 - Resource authorization, dimension validation, source-kind validation, and relationship-kind validation occur before object storage. Postgres continues to store metadata and resource links only; S3 remains the only durable file-byte store.

AST6 - Request cleanup closes multipart files and removes request-scoped temporary files. Cancellation or storage failure must stop streaming and must not create attachment metadata or resource links.

AST7 - The legacy inline-attachment migration may begin with already-decoded bytes because extraction is its purpose, but it must wrap those bytes in a reader and must not add another full-file clone at the S3 boundary.

AST8 - This streaming refactor does not change the current product limits of 10 MiB per file and 12 MiB per text box. Capacity changes require a separate quota and direct-to-S3 design decision.

## Scenarios

### Scenario AST-S1: Normal Upload Streams One Backing File

Given a user uploads an attachment larger than the multipart in-memory threshold:

- The multipart parser writes the file part to request-scoped temporary storage.
- The API computes size and SHA-256 through a bounded streaming pass.
- The stream is rewound.
- S3 receives the exact original bytes and declared content length.
- The signed payload hash equals the metadata SHA-256.
- No full-file `[]byte` copy is created by the handler or S3 storage implementation.

### Scenario AST-S2: Small And Empty Files

Given a small or empty attachment:

- Size, hash, and detected/fallback MIME metadata are deterministic.
- The rewind leaves the complete file available to S3.
- Zero-byte files use the SHA-256 of the empty payload and stream successfully.

### Scenario AST-S3: Invalid Metadata Or Broken Stream

Given invalid dimensions, invalid source/relationship kinds, a failed seek, a failed read, a negative content length, or an invalid SHA-256 value:

- The request fails clearly.
- No S3 request is issued when validation can fail before storage.
- No attachment metadata or resource link is created.

## Automated Coverage

- `backend/internal/http/attachment_handlers_test.go` covers upload hashing, byte sizing, MIME sniffing, rewind behavior, exact stored bytes, and metadata/resource-link creation.
- `backend/internal/http/attachment_storage_test.go` covers streamed request bytes, explicit content length, precomputed SigV4 payload hash, rewind behavior, and invalid stream metadata.
