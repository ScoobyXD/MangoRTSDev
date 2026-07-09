Last updated: 2026-07-09

# Attachments Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (`tests/frontend/modules/api/requestJSON.test.ts` covers multipart upload request headers; `tests/frontend/modules/editor/editorProjection.test.ts` covers attachment-reference serialization for editor text-block/chat payloads and legacy data-url parsing without emitting new durable data URLs; `tests/frontend/modules/editor/richTextEditing.test.ts` covers the durable rich-editor image attachment reference source)

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
ATT10 - Outgoing personal and shared email compose/reply attachments upload to Mango attachments before durable draft/send state is saved; the backend reads S3 bytes when sending through the provider.
ATT11 - Incoming provider email attachments may stay provider-referenced while they are only mailbox-list metadata, but must be cached or persisted into Mango S3 when attached to a node, converted into work, repeatedly opened as a durable Mango resource, or otherwise selected for Mango ownership.
ATT12 - Attached-email projections and communications email JSON may store provider IDs, message/thread metadata, inline/content IDs, and Mango attachment references, but must not store attachment bytes.
ATT13 - Attachment content access must be authorized through Mango resource permissions; knowing an S3 key or attachment ID is not enough to read bytes.
ATT14 - Developer inspection uses DBeaver for `attachments`, `attachment_variants`, and `resource_attachments` metadata, then AWS S3 console/CLI for the referenced object key when byte inspection is explicitly needed.
ATT15 - Backend validation must reject new durable inline file-byte payloads in normal editor, chat, projection, saved-version, and email send/draft paths.
ATT16 - Migration must be dry-run first, idempotent, resumable, auditable, and must record old-to-new attachment mappings before rewriting existing inline/base64 payloads.

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

### Scenario ATT-S5: Outgoing Email Attachments

Business logic covered:
- ATT3
- ATT4
- ATT10
- ATT15

Given:
- A user attaches a file while composing, replying, replying all, forwarding, or scheduling personal/shared email.

Expected:
- The browser uploads the file to Mango attachments before durable draft/send state is saved.
- Draft/send payloads store attachment IDs or reference objects.
- The backend reads S3 bytes at send time and passes them to the provider.
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
- Durable Mango email attachment use caches/persists bytes into Mango S3.
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
- The migration is resumable and records old-to-new mappings.
- Migrated content contains attachment references and no durable inline file bytes.
- Backend validation prevents normal product paths from reintroducing the removed durable inline file-byte shapes.
