Last updated: 2026-07-10

# Attachments Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (`tests/frontend/modules/api/requestJSON.test.ts` covers multipart upload request headers; `tests/frontend/modules/editor/editorProjection.test.ts` covers attachment-reference serialization for editor text-block/chat payloads and legacy data-url parsing without emitting new durable data URLs; `tests/frontend/modules/editor/richTextEditing.test.ts` covers the durable rich-editor image attachment reference source; `tests/frontend/pages/home/homeCommands.test.ts` covers email compose payloads sending Mango attachment references without durable `content`; `backend/internal/http/attachment_handlers_test.go` covers attachment metadata/resource links, content permission checks, and `email_draft`/`attached_email` resource authorization; `backend/internal/http/communications_handlers_test.go` covers email send-time S3 resolution into provider payloads, rejection of raw attachment content, and rejection of inline data URL send bodies; `backend/internal/http/durable_inline_guard_test.go` covers backend durable-inline-byte guard shapes; `backend/internal/attachments/migration/scanner_test.go` covers scanner rewrite/idempotency/signals; `backend/cmd/mango-attachment-migrate/main_test.go` covers dry-run report mapping and apply confirmation)

## Business Logic

ATT1 - All durable user file bytes must be stored in private Amazon S3 through the Mango attachment system in local, dev, and prod environments; normal local development must not use a separate filesystem attachment backend.
ATT2 - Postgres stores attachment metadata, S3 object keys, variants, ownership/resource links, and audit fields; editor, chat, email, projection, and saved-version payloads store attachment references, not file bytes.
ATT3 - Durable Mango payloads must not store `data:image/...;base64`, `data:application/...;base64`, durable `dataURL` fields, or normal app email attachment payloads carrying raw base64 content.
ATT4 - Temporary browser previews may use object URLs or data URLs only before upload completes; those values must be replaced by attachment references before durable save, send, snapshot, history, or projection writes.
ATT5 - Rich-editor pasted or dropped inline images must be handled through the shared unified rich-editor image path behind `useEditorDocumentSurfaceHandlers` and `editorImages`, then saved as attachment references across node, Logic Gate, project, My Triage, Shared Triage, and attached-email reply body surfaces.
ATT6 - Inline editor images must render as high-quality images on first open, not low-quality thumbnails, and double-click/fullscreen preview must load the original or highest-quality available variant.
ATT7 - Node attachment-button uploads use the same Mango attachment API, S3 storage, metadata records, and `resource_attachments` links as pasted inline images.
ATT8 - Chat attachments remain chat UI, not unified rich-editor content, but they still upload through the global Mango attachment API and persist attachment references instead of durable `dataURL` values.
ATT9 - Project text-block attachments and project chat attachments use the same global attachment system while preserving project-owned persistence for project text boxes.
ATT10 - Outgoing personal and shared email compose/reply attachments upload to Mango attachments before durable draft/send state is saved; the backend reads S3 bytes only when sending through the provider. Pasted inline images remain Mango references in durable content and become CID-linked inline provider attachments at that send boundary. Email signature images/logos, when supported, use the same Mango attachment system through `email_signature` resource links.
ATT11 - Incoming provider email attachments may stay provider-referenced while they are only mailbox-list metadata, but must be cached or persisted into Mango S3 when attached to a node, converted into work, repeatedly opened as a durable Mango resource, or otherwise selected for Mango ownership.
ATT12 - Attached-email projections and communications email JSON may store provider IDs, message/thread metadata, inline/content IDs, and Mango attachment references, but must not store attachment bytes.
ATT13 - Attachment content access must be authorized through Mango resource permissions; knowing an S3 key or attachment ID is not enough to read bytes.
ATT14 - Developer inspection uses DBeaver for `attachments`, `attachment_variants`, and `resource_attachments` metadata, then AWS S3 console/CLI for the referenced object key when byte inspection is explicitly needed.
ATT15 - Backend validation must reject new durable inline file-byte payloads in normal editor, chat, projection, saved-version, and email send/draft paths.
ATT16 - Migration must be dry-run first, idempotent, resumable, auditable, and must record old-to-new attachment mappings before rewriting existing inline/base64 payloads.
ATT17 - Email send preparation must find each `mango-attachment:` image source, deduplicate repeated IDs, authorize the existing resource link, resolve original S3 bytes within the total attachment limit, assign an alphanumeric content ID, add one inline provider attachment, and rewrite the image source to the matching `cid:` URI. It must reject missing/unauthorized references and return only metadata—not base64 bytes—in local sent-message fallback data.
ATT18 - Explicit files uploaded from a node text box are node resource links with `relationship_kind=file_attachment`, `information_id` set to that text-box ID, and `editor_surface=node_text_block`. This metadata determines list scope; file bytes and legacy `dataURL` values do not.
ATT19 - A text-box attachment list contains only active node `file_attachment` links whose `information_id` matches that text box. A node-wide attachment list contains every active node `file_attachment` link regardless of text box and must not count other relationship kinds.
ATT20 - Node attachment lists use the backend resource-link list as canonical data and display attachment metadata returned with each link. A text-box title may label or group a node-wide row when its `information_id` resolves to a current block; an unresolved block must not make an otherwise active node `file_attachment` disappear from the node-wide list.
ATT21 - User downloads request the `original` attachment variant through Mango's authenticated content endpoint, which rechecks resource authorization before reading private S3 bytes. The browser download uses `original_filename`; clients must not expose or navigate directly to `storage_bucket` or `storage_key`.
ATT22 - Read access to the owning node permits listing and downloading its attachments. Creating a new node attachment remains an edit operation and must stay hidden or disabled for a view-only user.

## Scenarios

### Scenario ATT-S1: S3 Attachment Spine

Business logic covered:
- ATT1
- ATT2
- ATT13
- ATT14

Given:
- A user uploads a file to Mango in local or dev.
- The upload has a parent resource context such as node, Logic Gate, project, chat, or email.

Expected:
- The backend stores bytes in the configured private S3 attachment bucket.
- The backend writes metadata and resource links to Postgres.
- Content reads go through Mango permission checks.
- A developer can find metadata in DBeaver and use the stored object key to inspect the object in S3 when appropriate.

### Scenario ATT-S2: Unified Rich-Editor Inline Images

Business logic covered:
- ATT3
- ATT4
- ATT5
- ATT6
- ATT15
- ATT17

Given:
- A user pastes or drops an image into a node text box, Logic Gate editor body, project text box, My Triage compose/reply body, Shared Triage compose/reply body, or attached-email reply body.

Expected:
- The shared rich-editor image path uploads the file through the Mango attachment API.
- The saved editor/email body stores an attachment reference, not a data URL or base64 blob.
- The first rendered inline image is high quality.
- Double-click/fullscreen opens the original or highest-quality available variant.
- Backend guards reject attempts to persist durable inline image bytes.

### Scenario ATT-S3: Node, Logic Gate, And Project Attachments

Business logic covered:
- ATT7
- ATT9
- ATT13

Given:
- A user uploads a file from the node attachment button.
- A user adds files to project text-block attachment areas.
- A user opens a project critical-path inline node window.

Expected:
- Node-level uploads create attachment metadata and node resource links.
- Project text-block attachments create project-owned attachment references and links.
- Project inline node windows inherit node attachment behavior while preserving node-owned persistence.
- Permission checks follow the owning resource.

### Scenario ATT-S4: Chat Attachments

Business logic covered:
- ATT3
- ATT4
- ATT8
- ATT15

Given:
- A user attaches an image or file to a node or project text-block chat draft.

Expected:
- The chat draft may show temporary upload preview state.
- The submitted chat message stores attachment references only.
- Durable chat JSON/projection data does not store `dataURL` or base64 file bytes.
- Chat remains outside unified rich-editor indentation/list/paste semantics.

### Scenario ATT-S5: Outgoing Email And Signature Attachments

Business logic covered:
- ATT3
- ATT4
- ATT10
- ATT15

Given:
- A user attaches a file while composing, replying, replying all, forwarding, or scheduling personal/shared email.
- A user adds a future image/logo attachment to an email signature.

Expected:
- The browser uploads the file to Mango attachments before durable draft/send state is saved.
- Draft/send payloads store attachment IDs or reference objects.
- Signature image/logo payloads store Mango attachment references through `email_signature` resource links.
- The backend reads S3 bytes at send time and passes normal files to the provider as ordinary attachments.
- Each pasted image reference is deduplicated, permission-checked, converted to one inline attachment with a matching alphanumeric CID, and rewritten from the private Mango source to `cid:` in outbound HTML.
- Personal and Shared Triage use the same conversion while preserving their personal/shared permission and grant scopes.
- Missing or unauthorized inline references fail the send, and local sent-message fallback data contains provider-ready CID HTML plus metadata-only references rather than raw bytes.
- Normal durable email payloads do not carry raw base64 `content`.

### Scenario ATT-S6: Incoming And Attached Email Attachments

Business logic covered:
- ATT11
- ATT12
- ATT13

Given:
- A provider message has attachments or inline content IDs.
- The message is attached to a node, converted into work, or opened as durable Mango work context.

Expected:
- Provider-only mailbox metadata can remain provider-referenced until Mango needs durable ownership.
- Current attached-email projections store message metadata without provider attachment bytes; any path that makes provider attachments durable Mango-owned resources must first cache/persist those bytes into Mango S3.
- Attached-email projections store metadata and Mango attachment references, not attachment bytes.
- Reads remain scoped by the node/email/shared-inbox permissions that authorize the user.

### Scenario ATT-S7: Migration And Regression Guard

Business logic covered:
- ATT3
- ATT15
- ATT16

Given:
- Existing node, Logic Gate, project, chat, email, or saved-version rows contain inline base64/data URL file bytes.

Expected:
- The migration dry run reports affected rows, decoded byte estimates, parent resources, and proposed attachment IDs before writing.
- The migration dry run inventories node projection/source/history rows, Logic Gate projection/source rows, project projection/source rows, communications email node JSON, attached-email JSON, triage message JSON, and large chat/message projection payloads where they live in those durable text/JSON rows.
- Apply mode is disabled unless explicitly requested with the apply flag, confirmation string, and company scope.
- The migration is resumable, idempotent, and records old-to-new mappings in migration run/item tables.
- Migrated content contains attachment references and no durable inline file bytes.
- Backend validation prevents normal product paths from reintroducing the removed durable inline file-byte shapes.
- Live database/S3 dry-run or apply steps remain manual operations requiring the agent DB access boundary verifier, report review, and explicit approval.

### Scenario ATT-S8: Node Attachment Discovery And Download

Business logic covered:
- ATT7
- ATT13
- ATT18
- ATT19
- ATT20
- ATT21
- ATT22

Given:
- A user uploads explicit files from two different text boxes on the same node.
- The node also has resources linked as `inline_image`, `chat_attachment`, or `email_attachment`.
- A second user can view but cannot edit the node.

Expected:
- Each upload creates a node `file_attachment` link with the originating text-box ID in `information_id` and `node_text_block` in `editor_surface`.
- Each text-box list returns only active `file_attachment` links matching that text-box ID.
- The node-wide list returns all active node `file_attachment` links and excludes links with every other relationship kind.
- Rows use returned attachment metadata for original filename and byte size and may use the matching text-box title as context.
- An active node `file_attachment` whose text box no longer resolves remains visible in the node-wide list with fallback context.
- Both users can download authorized original bytes through the Mango API using the original filename; neither receives a raw S3 URL or storage key.
- Only the user with edit access can upload another attachment.
