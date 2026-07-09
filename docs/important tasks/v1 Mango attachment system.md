# V1 Mango Attachment System

Investigation date: 2026-07-09

Status: highest-priority planning and implementation brief

Primary decision:

This is no longer only "store pasted images better."

This is now a global Mango attachment system.

The system must handle:
- pasted inline images in rich editors
- node attachment button uploads
- Logic Gate editor images and files
- project editor images and files
- text-block chat attachments
- node chat attachments
- incoming email attachments
- outgoing email attachments
- attached emails on nodes
- any future file-like thing users can paste, upload, drag, drop, attach, send, or view

The rule is simple:

Durable user file bytes belong in Amazon S3. Durable app/database records should store metadata, relationships, permissions context, and S3 object keys. Editor, chat, email, and projection payloads should store attachment references, not file bytes.

## Plain-English Summary

We found a concrete node case where projection content for a node with several pasted screenshots is about 6.5 million characters long. The content is mostly image/hash-looking data, which strongly indicates pasted screenshots are being stored inline inside editor content, probably as base64 `data:image/...` URLs.

That means the database, backend, JSON serializer, and sometimes read-time snapshot writes all have to carry giant strings just to open a node.

This is not only a node problem. The same pattern can happen anywhere Mango lets a user put file data into a text/editor/chat/email payload:

- node text boxes
- Logic Gate editor content
- project text blocks
- text-block chats
- node chats
- email replies and compose flows
- attached email projections
- node attachment controls

The correct V1 fix is to build one shared attachment system and move file bytes out of these content payloads.

## Priority

This is the utmost priority right now.

Reason:

The previous emergency slowness work reduced editor save dogpiling, but this finding exposes a deeper storage problem. Even with perfect save backpressure, a text box with pasted inline screenshots can still become multi-megabyte text. That hurts reads, writes, snapshots, history, browser memory, and future migrations.

The attachment system is foundational infrastructure. Once it exists, nodes, Logic Gates, projects, chats, and email can all converge on one durable rule.

## Non-Negotiable Requirements

### S3 Only

All environments use Amazon S3 for attachment bytes:

- local development
- dev
- prod

Do not build a separate local filesystem attachment provider for normal local development. The local backend should point at the dev S3 attachment bucket using the appropriate AWS SSO/developer credentials.

This avoids differences between local, dev, and prod behavior.

### Image Quality

The user experience must remain high quality.

Requirements:
- When the user opens a node, Logic Gate, project, chat, or email with an image, the inline image must look pristine.
- The inline editor image cannot be a visibly bad, tiny, blurry thumbnail.
- A temporary loading placeholder is acceptable while the image loads.
- The final inline rendered image must be high quality.
- Existing double-click-to-fullscreen image behavior must be preserved.
- Fullscreen view should use the original file or highest-quality available variant.

### Migration

Existing inline images must be migrated.

The 6.5M-character node projection should become normal editor text plus short attachment references.

### Global Scope

Do not solve only pasted node images.

The system must cover all current and future file-bearing surfaces:
- node text boxes
- node attachments
- node chats
- Logic Gate editor content
- project text blocks
- project chats
- incoming email attachments
- outgoing email attachments
- attached email snapshots/projections

## Current Evidence

The user manually checked a slow node's projection content and found it was about 6.5 million characters long, mostly screenshot/base64-looking data.

The confirmed, cross-cutting problem is file bytes embedded in content/projection payloads.

## Current Code And Schema Findings

### Node Projection Rows

`node_projection_table` stores projection `information` as text.

Important schema:

```text
node_projection_table
  company_id
  node_id
  information_id
  type
  information text not null
  created_timestamp
  updated_timestamp
```

The V2 node view loads projection rows and returns them in the consolidated node view.

When `information` contains base64 images, the server can read, copy, marshal, and sometimes snapshot huge strings just to open the node.

### Text Block Chat And Attached Email Projection Types

The schema includes projection information types:

```text
Text block chat
Attached email
```

That means node projections are already being used for more than plain editor text. Attachment cleanup must include chat and email-adjacent projection payloads, not just normal text boxes.

### Current Editor Chat Attachment Shape

Frontend editor chat attachments currently include a possible inline data URL:

```ts
export type EditorChatAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  dataURL?: string;
};
```

That `dataURL?: string` is a red flag for durable payloads. Data URLs are useful only as temporary local previews before upload. They should not be persisted in projection rows, chat JSON, project information, email JSON, or saved versions.

### Current Email Attachment Shape

Frontend email attachments currently include possible base64 content:

```ts
export type EmailAttachment = {
  id?: string;
  filename: string;
  content_type?: string;
  content?: string;
  content_id?: string;
  content_disposition?: string;
  is_inline?: boolean;
  size?: number;
};
```

For outgoing email, `content?: string` means attachment bytes can travel through the app as base64. For V1 Mango attachments, outgoing email should reference uploaded Mango attachments, and the backend should read bytes from S3 only at send time.

### Email Node Tables

The database has email-to-node tables:

```text
communications_email_nodes
  message jsonb not null
```

```text
communications_email_node_attachments
  message jsonb not null
```

Those `message jsonb` payloads need to be audited. They should not become a long-term place where attachment bytes or large inline email parts live.

### Project Text Blocks

Project summary text blocks store `attachments` in editor content structures. Those attachment objects need to be converted to references to Mango attachment records, not embedded data URLs.

## Effect Of The Unified Editor And Node Work

The V1 unifying editor/node project changes the frontend integration plan, but it does not change the storage architecture.

Unified rich editor surfaces now share behavior through `useEditorDocumentSurfaceHandlers` and, for mail-style surfaces, `UnifiedRichEditorSurface`. That means pasted/dropped inline images in rich editor bodies should be fixed once in the shared editor image path instead of patched separately per surface.

This applies to:

- Logic Gate editor text
- node text boxes wherever the node editor is opened
- project text boxes
- project critical-path inline node text boxes
- My Triage compose/reply bodies
- Shared Triage compose/reply bodies
- attached-email reply bodies

The unified editor work explicitly preserves domain persistence. Node text still saves through node information/projection paths, Logic Gate text through Logic Gate information/projection paths, project text through project information/projection paths, and mail compose/reply through mailbox draft/send paths. The attachment system therefore needs one shared file-byte backend, but each surface still links attachments to its owning resource.

The unified node shell also helps because full node windows opened from Home, sidebar/app shell, Updates, Kanban/My Work, dock restore, and project critical-path rows now share the same node workspace body boundary. Node attachment UI should be wired once through that shared node workspace/shell path instead of per opener.

Important boundary:

- Chat panes are still conversation UI, not unified rich editor surfaces.
- Node/project email pickers are attach/select surfaces only; they do not compose or send mail.
- Chat attachment conversion, node attachment-button uploads, project attachment arrays, and email attachments still need their own conversion points, even though they should all store bytes through the same Mango attachment API.

## Core Architecture

The Mango attachment system has two durable layers:

1. Postgres stores metadata, relationships, permissions context, and object keys.
2. Amazon S3 stores the actual bytes.

The app and API sit in front of S3. Users should not need raw S3 access. The backend enforces Mango permissions before returning or signing access to an object.

## S3 Storage

Use private S3 buckets.

Possible buckets:

```text
mangorts-dev-attachments
mangorts-prod-attachments
```

Local development uses the dev S3 bucket.

Possible object keys:

```text
companies/{company_id}/attachments/{attachment_id}/original
companies/{company_id}/attachments/{attachment_id}/display
companies/{company_id}/attachments/{attachment_id}/thumbnail
companies/{company_id}/attachments/{attachment_id}/email-send
```

Use stable metadata in Postgres to know MIME type, filename, size, hash, and which variant each object key represents.

### S3 Security Requirements

- Buckets must have Block Public Access enabled.
- Objects must not be public.
- Backend app role gets scoped read/write permissions.
- Human developer/admin roles may get read/list permissions for dev inspection.
- Prod human access should be limited and intentional.
- Agents should not fetch or print attachment bytes unless explicitly approved and safely scoped.
- Objects should use server-side encryption.
- Signed URLs, if used, should be short-lived.

### Local Development With S3

Local backend should use the same S3 attachment code path as dev/prod.

Expected setup:

- local backend configured with the dev attachment bucket
- AWS SSO profile for dev
- no local filesystem attachment mode for normal development

This keeps local behavior honest.

## Developer Inspection Workflow

The S3 equivalent of opening DBeaver is the AWS S3 console.

Developer workflow:

1. Open DBeaver.
2. Query `attachments`.
3. Find the `attachment_id`, filename, MIME type, size, and `storage_key`.
4. Query `resource_attachments` to see what resource owns or references it.
5. Open AWS Console.
6. Go to S3.
7. Open the dev attachment bucket.
8. Search or browse by the `storage_key`.
9. Open or download the object if the human dev role permits it.

The database tells the story. S3 holds the bytes.

Longer-term developer/admin helper:

Build an internal "Attachment Inspector" screen that can search by:

- attachment ID
- node ID
- Logic Gate ID
- project ID
- chat/message ID
- email message ID
- filename
- uploader
- company ID
- MIME type
- size
- SHA-256 hash

The inspector should open files through the normal backend access endpoint, not by making S3 public.

## Database Model

Exact naming can change, but V1 needs this shape.

### attachments

```text
attachments
  attachment_id uuid primary key
  company_id uuid not null
  uploaded_by_user_id uuid
  original_filename text not null
  mime_type text not null
  byte_size bigint not null
  sha256 text not null
  storage_bucket text not null
  storage_key text not null
  original_width integer
  original_height integer
  source_kind text not null
  source_provider text
  created_timestamp timestamptz not null
  deleted_timestamp timestamptz
```

Possible `source_kind` values:

- `user_upload`
- `editor_paste`
- `chat_upload`
- `email_incoming`
- `email_outgoing`
- `migration_inline_image`

### attachment_variants

```text
attachment_variants
  attachment_id uuid not null
  variant_type text not null
  mime_type text not null
  byte_size bigint not null
  width integer
  height integer
  storage_bucket text not null
  storage_key text not null
  created_timestamp timestamptz not null
```

Expected variants:

- `original`
- `display`
- `thumbnail`

The inline editor should use `display` only if it is high quality. The final inline visual must not be a low-quality thumbnail.

### resource_attachments

```text
resource_attachments
  company_id uuid not null
  resource_type text not null
  resource_id text not null
  attachment_id uuid not null
  information_id uuid
  message_id text
  editor_surface text
  relationship_kind text not null
  created_by_user_id uuid
  created_timestamp timestamptz not null
  deleted_timestamp timestamptz
```

Possible `resource_type` values:

- `node`
- `logic_gate`
- `project`
- `node_chat_message`
- `project_chat_message`
- `email_message`
- `email_draft`
- `attached_email`

Possible `relationship_kind` values:

- `inline_image`
- `file_attachment`
- `chat_attachment`
- `email_attachment`
- `email_inline_attachment`
- `migrated_inline_image`

The relationship row lets us answer: "Which files belong to this node?" or "Which node/chat/email uses this attachment?"

## API Model

V1 should use a shared attachment API.

Possible endpoints:

```text
POST /v1/attachments
GET /v1/attachments/:attachment_id
GET /v1/attachments/:attachment_id/content?variant=display
GET /v1/attachments/:attachment_id/content?variant=original
GET /v1/resources/:resource_type/:resource_id/attachments
POST /v1/resources/:resource_type/:resource_id/attachments
DELETE /v1/resources/:resource_type/:resource_id/attachments/:attachment_id
```

Upload endpoint should support:

- image paste
- drag/drop
- file input
- chat attachment
- email compose attachment
- node attachment button

Download/content endpoint should:

- authenticate user
- resolve attachment metadata
- resolve resource ownership/access
- check parent resource permission
- stream bytes or return a short-lived signed S3 URL

## Frontend Model

Durable editor/chat/email content should store attachment references only.

Good:

```json
{
  "type": "image",
  "attachment_id": "019f...",
  "filename": "screenshot.png",
  "mime_type": "image/png",
  "width": 1920,
  "height": 1080
}
```

Bad:

```json
{
  "dataURL": "data:image/png;base64,..."
}
```

Temporary local previews may use object URLs or data URLs in memory only. They must be replaced by attachment references after upload and must not be saved.

## Paste And Upload Flow

When a user pastes an image into an editor:

1. Browser intercepts paste.
2. Browser sees an image file/blob.
3. Browser inserts a temporary local preview.
4. Frontend uploads the image to `POST /v1/attachments` with parent resource context.
5. Backend checks edit permission on the parent resource.
6. Backend stores bytes in S3.
7. Backend inserts `attachments`, `attachment_variants`, and `resource_attachments`.
8. Backend returns `attachment_id` plus display metadata.
9. Frontend replaces temporary preview with an attachment reference.
10. Editor projection save stores only the attachment reference.

When upload fails:

- show a clear failed upload state
- do not leave base64 in saved editor content
- do not silently drop the image

## Viewing Flow

When a user opens a node, Logic Gate, project, chat, or email:

1. The main GET loads text/content with attachment references.
2. The frontend renders text immediately.
3. For each image/file reference, frontend requests attachment metadata or content.
4. Backend checks view permission on the parent resource.
5. Browser loads a high-quality display image.
6. Double-click opens the original/highest-quality object in fullscreen.

This keeps node/project/Logic Gate GETs small while preserving image quality.

## Node Attachments

Node attachment buttons should use the same global attachment system.

Expected behavior:

- Upload file to S3 through Mango API.
- Create `attachments` metadata.
- Link file to the node with `resource_attachments`.
- Node view can list attachments by querying attachment metadata, not by embedding bytes.
- Node editor text can reference an attachment inline when needed.

The app can show a node-level files panel or attachment list by listing `resource_attachments` for that node.

## Chat Attachments

Chat attachments should not store `dataURL` durably.

Expected behavior:

- User attaches file to chat draft.
- Frontend uploads file to Mango attachments.
- Draft state stores temporary upload state and eventual `attachment_id`.
- Submitted chat message stores attachment references.
- Chat message projection stores IDs and metadata, not bytes.
- Image chat attachments preview through `GET /v1/attachments/:id/content`.

Current `EditorChatAttachment.dataURL` should become temporary-only or be replaced with a reference shape.

## Project Attachments

Project text block attachments should use the same system.

Expected behavior:

- `attachments` inside project text block content become attachment references.
- Project text block save payloads never contain data URLs.
- Project chat attachments use the same chat attachment flow.
- Project view can load attachment metadata separately from heavy bytes.

## Email Attachments

Email needs special handling because Nylas/provider attachments already exist.

### Incoming Email Attachments

Incoming email metadata can still come from Nylas/provider.

For attachment bytes, V1 should choose a consistent rule:

- If an incoming email attachment is merely listed in the mailbox, we can keep it provider-referenced.
- If an incoming email is attached to a node, converted into work, opened repeatedly, or selected for durable Mango use, cache/persist the attachment into Mango S3.
- Store a Mango `attachment_id` and link it to the relevant email/node resource.

This avoids repeatedly downloading the same provider attachment and avoids storing large email attachment data inside `message jsonb`.

### Outgoing Email Attachments

Outgoing email should not send base64 attachment content from the browser through durable app payloads.

Expected flow:

1. User attaches file in email compose/reply.
2. Frontend uploads file to Mango attachment API.
3. Email draft stores `attachment_id`.
4. When sending, backend reads bytes from S3.
5. Backend passes bytes/content to Nylas/provider.
6. Sent email record stores provider message IDs and Mango attachment references.

The frontend `EmailAttachment.content?: string` shape should be retired for normal durable flows.

### Attached Emails On Nodes

Attached email projections should store:

- message ID
- thread ID
- sender/recipient metadata
- subject
- timestamps
- body/reference metadata as appropriate
- attachment references

They should not store attachment bytes in `node_projection_table.information` or `communications_email_node_attachments.message`.

## Inline Images In Emails

Emails often contain inline images referenced by content IDs (`cid:`).

Plan:

- Preserve semantic relationship between email body and inline attachment.
- Cache inline image bytes into Mango S3 when the email becomes durable in Mango.
- Rewrite or resolve `cid:` references through Mango attachment IDs when rendering inside Mango.
- Do not embed the inline image bytes directly in message JSON or node projection text.

## Migration Plan

Migration must be dry-run first, resumable, auditable, and idempotent.

### Inventory

Scan all likely content locations for:

- `data:image/`
- `data:application/`
- `base64,`
- large JSON/text fields
- `dataURL`
- email attachments with `content`

Candidate tables/fields:

- `node_projection_table.information`
- `node_information.information`
- Logic Gate editor/projection/source tables
- project editor/projection/source tables
- `communications_email_nodes.message`
- `communications_email_node_attachments.message`
- communication triage message JSON
- chat/message projection payloads
- saved version/history tables

### Dry Run Report

Dry run should report:

- table
- row ID
- resource type
- resource ID
- information ID or message ID
- count of embedded files/images
- estimated decoded byte size
- MIME types
- proposed S3 keys
- proposed attachment IDs
- proposed rewrite preview

### Extract And Store

For each embedded file:

1. Parse content safely.
2. Decode base64.
3. Compute SHA-256.
4. Upload original bytes to S3.
5. Create attachment metadata.
6. Generate image variants if needed.
7. Link attachment to parent resource.
8. Rewrite content to attachment reference.
9. Record migration mapping.

### Verify

Verification must prove:

- no migrated row still contains `data:image/`
- known large node is no longer multi-megabyte projection text
- migrated images render inline at high quality
- fullscreen viewer opens original/highest-quality image
- permissions still work
- S3 object exists for every attachment row
- every migrated attachment row has at least one resource link

## Guardrails

After V1, the backend should reject or normalize durable content that attempts to save inline file bytes.

Guard against:

- `data:image/...;base64`
- `data:application/...;base64`
- editor/chat attachment objects with `dataURL`
- email send payloads with raw base64 content in normal app flows
- giant projection rows caused by embedded file bytes

Frontend cleanup is not enough. Backend must enforce the rule.

## Performance Goals

The known 6.5M-character node should become a normal-sized projection row with a few attachment IDs.

Expected wins:

- smaller node/Logic Gate/project payloads
- smaller projection saves
- less DB text/JSON bloat
- less JSON marshal work
- less browser JSON parse work
- fewer duplicate file copies in history/snapshots
- reusable cached image/file bytes through S3/browser cache

## Compressed Implementation Plan

Do not turn this into eight separate projects. The work should move in three real phases.

### Phase 1: Build The Attachment Spine

This phase creates the shared system everything else uses.

Do together:

- document the no-inline-file-bytes rule in docs/tests
- inventory the current file-bearing surfaces and existing data URL/base64 content
- define the attachment schemas
- define the S3 bucket/key strategy
- add `attachments`
- add `attachment_variants`
- add `resource_attachments`
- add the S3 upload/download/signing service
- add attachment API endpoints
- add parent-resource permission checks
- add backend tests for upload, metadata, link, content access, unlink/delete, and permission failures

Outcome:

Mango has one S3-backed attachment system that can store bytes, record metadata, link files to resources, and serve files securely.

### Phase 2: Wire The Product Surfaces

This phase converts the app to use the shared attachment system everywhere users create or view files.

Do together:

- add the shared frontend attachment upload client
- add the shared durable attachment reference type
- add high-quality image rendering
- preserve fullscreen original-image viewing
- add upload progress/error states
- integrate attachment upload/reference handling into `useEditorDocumentSurfaceHandlers` and `editorImages` so rich-editor pasted/dropped images are handled once for node, Logic Gate, project, My Triage, Shared Triage, and attached-email reply bodies
- replace rich-editor pasted image HTML/data URLs with attachment references before durable save/send
- convert node attachment button uploads
- convert Logic Gate editor images/files
- convert project text block attachments
- convert project chat attachments
- convert node/text-block chat attachments while keeping chat semantics separate from unified rich editor semantics
- convert outgoing email compose/reply attachments so the backend reads S3 bytes at send time
- cache incoming email attachments into Mango attachments when they become durable Mango resources
- preserve inline email image semantics without storing bytes in message JSON

Outcome:

Normal app usage stops creating new durable inline file bytes across nodes, Logic Gates, projects, chats, and email.

### Phase 3: Migrate And Lock The Door

This phase cleans existing data and prevents regression.

Do together:

- build a dry-run inline image/file migration report
- migrate the known 6.5M-character node first
- migrate node projection/source rows
- migrate Logic Gate/project editor rows
- migrate chat payloads
- migrate email JSON and attached-email projection payloads where file bytes exist
- migrate saved versions/history where applicable
- verify rendering, permissions, S3 object integrity, and fullscreen behavior
- add backend guards that reject durable `data:image/...;base64`, `data:application/...;base64`, durable `dataURL`, and normal app email attachment payloads carrying raw base64 bytes

Outcome:

Existing bloat is removed, and new inline file-byte bloat cannot come back through normal save/send paths.

## Acceptance Criteria

Global attachment system:

- All normal file bytes are stored in S3.
- Local development uses the same S3 attachment backend as dev.
- Postgres stores metadata and relationship rows.
- Main resource/editor/chat/email payloads store attachment references only.
- Backend rejects durable inline base64 file bytes.

Image quality:

- Inline editor images are high quality on first open.
- Low-quality thumbnails are not used as the final inline image.
- Double-click opens fullscreen.
- Fullscreen loads original/highest-quality available file.

Node:

- Known 6.5M-character node projection shrinks to normal content plus attachment references.
- Node attachment button uploads use the shared attachment system.
- Node view lists and renders attachments through shared APIs.
- Node windows opened from Home, sidebar/app shell, Updates, Kanban/My Work, dock restore, and Projects use the same node attachment behavior through the shared node workspace/shell boundary.

Logic Gate:

- Logic Gate editor images/files use shared attachments.
- Logic Gate pasted/dropped inline images are converted through the unified rich editor image path, not a Logic Gate-only path.

Project:

- Project text block attachments use shared attachments.
- Project chat attachments use shared attachments.
- Project critical-path inline node windows inherit node attachment behavior, while project text boxes keep project-owned attachment links.

Chat:

- Chat attachments store attachment IDs, not data URLs.
- Image preview and fullscreen behavior still work.
- Chat attachment conversion remains a chat-specific path, even though it stores bytes in the same attachment backend.

Email:

- Outgoing email attachments upload to Mango S3 first.
- Backend reads S3 attachment bytes to send through provider.
- Incoming email attachments can be cached into Mango S3 when they become durable Mango resources.
- Attached email projections do not store attachment bytes.
- My Triage and Shared Triage compose/reply bodies use the unified rich editor for body images, while normal file attachments use the mail attachment path.

Developer inspection:

- Developer can find attachment metadata and resource links in DBeaver.
- Developer can use `storage_key` to inspect bytes in AWS S3 console.
- Optional admin Attachment Inspector is planned.

Migration:

- Dry run exists.
- Migration is resumable and idempotent.
- Migration records old-to-new attachment mapping.
- Verification proves no migrated rows retain inline base64 images.

## What Not To Do

Do not:

- build a normal local filesystem attachment provider
- store base64 image/file data inside editor HTML
- store chat attachment bytes in projection JSON
- store outgoing email attachment bytes durably in frontend/API JSON
- store incoming email attachment bytes inside `message jsonb`
- make S3 objects public
- use bad thumbnails as final inline editor images
- fix only nodes
- fix only pasted images
- run migration without a dry run and rollback/audit plan

## Final Direction

Build V1 Mango Attachment System.

This should become the shared foundation for every file-like object in Mango:

- upload once through the Mango attachment API
- store bytes in private S3
- store metadata and links in Postgres
- reference attachments from editor/chat/email/project/node/Logic Gate payloads
- render high-quality images through secure app endpoints
- preserve fullscreen originals
- migrate existing inline/base64 file bytes out of durable content

Once this exists, node projection bloat, chat attachment bloat, project attachment bloat, and email attachment storage problems all get addressed by one coherent system.
