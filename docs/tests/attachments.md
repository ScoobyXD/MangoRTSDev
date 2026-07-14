Last updated: 2026-07-13

# Attachments Tests

Coverage Status:
- Node attachment filename/type and visibility-gated thumbnail presentation are covered by `tests/frontend/modules/attachments/attachmentPresentation.test.ts`; concurrent byte reservations, deduplicated totals, partial success, latest-state append, stale navigation/scope/permission invalidation, and delete-while-uploading protection are covered by `tests/frontend/modules/editor/nodeTextBlockAttachments.test.ts`.
- Incoming email image selection/download/fullscreen behavior and node attachment removal controls are covered by `tests/frontend/modules/editor/emailViewerContract.test.ts`; shared editor image-reference behavior is covered by `tests/frontend/modules/editor/editorProjection.test.ts` and `tests/frontend/modules/editor/richTextEditing.test.ts`; existing-attachment destination linking and mailbox-complete signature resource IDs are covered by `tests/frontend/modules/attachments/attachmentApi.test.ts`.
- Outbound email metadata preflight, exact 24,000,000-byte and zero-byte boundaries, authorization, lazy storage opening, deterministic multipart framing, exact stream lengths, cancellation, provider rejection, and cleanup are covered by `backend/internal/http/communications_handlers_test.go` and `backend/internal/http/nylas_client_test.go`; bounded query shape is covered by the attachment handler/store contract tests.
- Direct-upload coverage must additionally prove bounded hashing, JSON-only Mango control requests, raw credential-free S3 PUTs, exact signed headers, progress/cancel/retry/resume, completed-part reconciliation, node-scoped deletion survival, and completed-only list/count refresh.
- Business Logic Covered By Scenarios: 100%
- Draft mutation leasing across preparation plus upload/link, mixed success, and final all-failed settlement is covered by `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts`; a mounted ComposePanel toolbar-plus-inline race remains a higher-level coverage gap.
- Business Logic Covered By Automated Tests: Partial. Existing attachment presentation, durable-reference serialization, authenticated content access, email send-time S3 resolution, draft/signature durable-inline guards, destination resource linking, and migration behavior are covered. `backend/internal/http/email_draft_attachment_scope_test.go` covers active/deleted exact and legacy draft links, wrong user/account, shared permission revocation, manager/admin bypass attempts, and independent sent-message survival; `tests/frontend/pages/home/homeMailDrafts.test.ts` covers durable draft preparation before upload plus failure retention. The direct browser path requires focused frontend hashing/transport/node-lifecycle tests, backend intent/storage/repository tests, and the static IaC contract in `infra/tests/attachment_direct_upload.test.mjs`; normal suites must not require live AWS.

## Business Logic

### 2026-07-10 Node Attachment Retention And Preview Contract

- A node text box is the upload origin for a file, not the lifetime owner of that file. Deleting the originating text box must delete only that text-box projection; it must not unlink the file's node `resource_attachments` relationship, delete attachment metadata, or delete S3 bytes.
- The node-level attachment counter and list are the recovery and discovery surface for every retained node file, including files whose originating text box no longer exists. A retained file with no live origin must remain countable, listable, previewable, and downloadable, and its origin must use an explicit deleted-text-box fallback label rather than a misleading live text-box number.
- Clicking the non-action area of a node attachment row opens an in-app preview. Row activation must not silently download the file. The explicit download control remains available at the right side of the row and must not also open the preview.
- Preview bytes must be fetched through the authenticated Mango attachment-content API and normal resource authorization. The UI must not expose or depend on a public S3 object URL.
- In-app preview supports images, PDF, bounded plain-text and source-like content (including text, code, CSV, JSON, and XML), audio, and video when the browser can render the returned content type. Text preview may receive the full authenticated blob from the current content endpoint, but it decodes only `blob.slice(0, 256 KiB)` and renders at most 200,000 decoded characters so a large file cannot create unbounded decode or DOM work.
- Office documents, spreadsheets, presentations, archives, and unknown/binary formats are not converted in the browser. Their in-app state must say that preview is unavailable while keeping metadata and the explicit original-file download action usable.
- Preview requests and temporary object URLs are transient UI resources. Closing or replacing a preview must abort obsolete work where possible and revoke any object URL created for the previous file.
- Browser attachment policy defaults to 1 GiB (1,073,741,824 bytes) per file and is backend-authoritative/configurable. The old 12 MiB aggregate-per-text-box limit does not apply to the direct browser path. Files through and including 64 MiB use one presigned PUT; larger files use resumable S3 multipart upload with 16 MiB parts.
- Browser preparation and transfer remain bounded-memory: raw SHA-256 is computed incrementally, S3 receives raw `File`/`Blob` or bounded `File.slice` bodies, no whole-file `arrayBuffer()`/base64/data URL is created, and browser file bytes never pass through Mango API.
- Upload-progress rows are node-level transient state with preparing, uploading, retrying, completing, complete, canceled, and failed states, byte progress, cancel, and retry. Pending/failed/canceled intents never appear in normal node counts/lists; successful sibling files remain attached.

Required regression scenario:
- Upload previewable and non-previewable files from two node text boxes, delete one originating text box, and reopen the node.
- Confirm every retained file is still present in the node-level count/list, the deleted origin has the fallback label, supported rows preview in app without downloading, unsupported rows show preview-unavailable state, and the separate download control still returns the original file.
- Confirm text preview truncates rather than rejects larger content, decodes no more than the first 256 KiB, renders no more than 200,000 decoded characters, and shows `Preview limited to 256 KiB / 200,000 characters.` when content exceeds either display bound.
- Confirm closing/switching previews cleans up transient browser resources; upload validation accepts exactly 1 GiB and rejects one byte above before S3; the 64 MiB boundary selects single versus multipart correctly; and no 12 MiB text-box aggregate is applied to direct uploads.

ATT1 - All durable user file bytes must be stored in private Amazon S3 through the Mango attachment system in local, dev, and prod environments; normal local development must not use a separate filesystem attachment backend.
ATT2 - Postgres stores attachment metadata, S3 object keys, variants, ownership/resource links, and audit fields; editor, chat, email, projection, and saved-version payloads store attachment references, not file bytes.
ATT3 - Durable Mango payloads must not store `data:image/...;base64`, `data:application/...;base64`, durable `dataURL` fields, or normal app email attachment payloads carrying raw base64 content.
ATT4 - Temporary browser previews may use object URLs or data URLs only before upload completes; those values must be replaced by attachment references before durable save, send, snapshot, history, or projection writes.
ATT5 - Rich-editor pasted or dropped inline images must be handled through the shared unified rich-editor image path behind `useEditorDocumentSurfaceHandlers` and `editorImages`, then saved as attachment references across node, Logic Gate, project, My Triage, Shared Triage, attached-email reply body, and personal/shared email-signature surfaces.
ATT6 - Inline editor images must render as high-quality images on first open, not low-quality thumbnails, and double-click/fullscreen preview must load the original or highest-quality available variant.
ATT7 - Node attachment-button uploads and attachment lists use the same Mango attachment API, private S3 storage, metadata records, and `resource_attachments` links as pasted inline images. The node loads attachment metadata separately from file bytes; image bytes are requested only when a row is visible or near-visible, and original bytes are requested only by an explicit download.
ATT8 - Chat attachments remain chat UI, not unified rich-editor content, but they still upload through the global Mango attachment API and persist attachment references instead of durable `dataURL` values.
ATT9 - Project text-block attachments and project chat attachments use the same global attachment system while preserving project-owned persistence for project text boxes.
ATT10 - Before an outgoing personal/shared compose or reply can upload or link an `email_draft` attachment, Mango must create/confirm the live durable draft in the exact immutable personal-account or shared-inbox scope. The browser then uploads to Mango attachments and saves references in draft/send state; the backend reads S3 bytes only at provider send. Pasted inline images remain Mango references until they become CID-linked provider attachments at that boundary.
ATT11 - Incoming provider email attachments may stay provider-referenced while they are only mailbox-list metadata, but must be cached or persisted into Mango S3 when attached to a node, converted into work, repeatedly opened as a durable Mango resource, or otherwise selected for Mango ownership.
ATT12 - Attached-email projections and communications email JSON may store provider IDs, message/thread metadata, inline/content IDs, and Mango attachment references, but must not store attachment bytes.
ATT13 - Attachment content access must be authorized through Mango resource permissions; knowing an S3 key or attachment ID is not enough to read bytes.
ATT14 - Developer inspection uses DBeaver for `attachments`, `attachment_variants`, and `resource_attachments` metadata, then AWS S3 console/CLI for the referenced object key when byte inspection is explicitly needed.
ATT15 - Backend validation must reject new durable inline file-byte payloads in normal editor, chat, projection, saved-version, email send, communications draft, and communications signature paths.
ATT16 - Migration must be dry-run first, idempotent, resumable, auditable, and must record old-to-new attachment mappings before rewriting existing inline/base64 payloads.
ATT17 - Email send preparation must find each `mango-attachment:` image source, deduplicate repeated IDs, authorize the existing resource link, resolve original S3 bytes within the total attachment limit, assign an alphanumeric content ID, add one inline provider attachment, and rewrite the image source to the matching `cid:` URI. It must reject missing/unauthorized references and return only metadata—not base64 bytes—in local sent-message fallback data.
ATT18 - Explicit files uploaded from a node text box are node resource links with `relationship_kind=file_attachment`, `information_id` set to that text-box ID, and `editor_surface=node_text_block`. This metadata determines list scope; file bytes and legacy `dataURL` values do not.
ATT19 - A text-box attachment list contains only active node `file_attachment` links whose `information_id` matches that text box. A node-wide attachment list contains every active node `file_attachment` link regardless of text box and must not count other relationship kinds.
ATT20 - Node attachment lists use the backend resource-link list as canonical data and display attachment metadata returned with each link. A text-box title may label or group a node-wide row when its `information_id` resolves to a current block; an unresolved block must not make an otherwise active node `file_attachment` disappear from the node-wide list.
ATT21 - User downloads request the `original` attachment variant through Mango's authenticated content endpoint, which rechecks resource authorization before reading private S3 bytes. The browser download uses `original_filename`; clients must not expose or navigate directly to `storage_bucket` or `storage_key`.
ATT22 - Read access to the owning node permits listing and downloading its attachments. Creating a new node attachment remains an edit operation and must stay hidden or disabled for a view-only user.
ATT23 - Right-clicking an attachment row in a node-wide or text-box attachment list exposes a red `Remove from node` action only when the viewer can edit that node. The action removes the active node resource link; it does not delete shared attachment metadata, private S3 bytes, or links owned by another resource.
ATT24 - An inline image in an incoming email body can be selected with one click to expose an authenticated download action and opened in fullscreen preview with a double-click. Inline `cid:` sources must resolve through an authorized Mango or provider attachment endpoint rather than exposing a public object URL.
ATT25 - Selecting an inline image in a unified rich editor preserves its visual selection/resize handles and establishes a collapsed document caret immediately before the image frame. Text or spaces typed at that caret appear before the image, and image resizing remains available in node, Logic Gate, project, My Triage, Shared Triage, attached-email reply, and email-signature editors.
ATT26 - Browser-selected file bytes go directly to private S3 through short-lived presigned requests. Mango API remains the authoritative control plane for authentication, authorization, upload intents, IDs, object keys, limits, signing, completion/abort, S3 verification, metadata, and durable resource linking; browser bytes never traverse Mango API.
ATT27 - The configurable browser limit defaults to 1 GiB per file. Single PUT applies through and including 64 MiB; larger files use 16 MiB multipart parts with at most three parts in flight per file and four S3 PUTs across the page. There is no 12 MiB aggregate-per-text-box limit on this path.
ATT28 - Browser raw file SHA-256 is computed incrementally with bounded memory before intent creation. `attachments.sha256` remains the raw content hash; S3 checksum algorithm/value/type and SHA verification method are recorded separately, and multipart ETags/composite checksums never replace the raw hash.
ATT29 - Upload intents and multipart part state are durable and idempotent. Creation uses actor/company/client-request identity; signing the same part/checksum may refresh its URL; completion and abort replay safely; resume reconciles authoritative accepted parts; naturally expired intents remain `expired`, only explicit abort/cancel records `aborted`, and expired work is cleaned up by the application with S3 lifecycle as a backstop.
ATT30 - Only completed intents create/list permanent attachments. Node-level progress preserves filename/extension/size, byte progress, cancel/retry, and the states preparing, uploading, retrying, completing, complete, canceled, and failed. Each selected file is independent and one failure cannot discard completed siblings.
ATT31 - Server-side streaming PutObject, including non-seekable producer streams, remains available for incoming email, provider imports, migrations, and backend jobs. Removing the old browser multipart-byte path must not remove or weaken backend-originated streaming or authenticated GetObject reads.
ATT32 - Pasting an existing attachment-backed editor image into another unified rich editor target must create the destination resource's authorized `inline_image` link before inserting the image reference. An asynchronous upload or existing-attachment link may commit only while its originating editor root, document target, attachment resource context, and saved range are still current; switching targets or unmounting must not insert it into the next document.
ATT33 - During one browser page/app session, authenticated attachment content uses one shared Blob singleflight/cache across mounted editor windows, keyed by API base, company, auth-session generation, attachment ID, and requested variant. Failures evict immediately; auth generation is checked again before delivery so stale in-flight prior-user data is rejected; completed cache entries obey expiry/LRU byte bounds and large originals are not retained. Object URLs are never shared cache values: every consumer creates and revokes its own URL. One consumer abort only detaches that consumer, and the last-consumer upstream abort is deferred through the StrictMode cleanup/setup turn so a replay owner can attach without starting a duplicate GET.
ATT34 - Each mounted rich-editor DOM has exactly one attachment-image hydration owner for each document update. Hydration observes image frames relative to the editor's nested scrollport with a near-viewport margin, schedules visible display-image reads through one bounded priority queue, marks queued/in-flight frames so duplicate owners cannot race, and returns cleanup that detaches observers/tasks and revokes every URL created for that DOM before replacement, context change, or unmount. A failed frame is unscheduled and re-observed with bounded retry/backoff instead of remaining permanently unhydrated.
ATT35 - A node uses one StrictMode-safe resource-attachment metadata singleflight/cache for its node-wide and per-text-box attachment lists. The canonical node-scope response is reused by every list, is loaded without one variant query per attachment, and is explicitly invalidated before upload completion, link, unlink, or another local attachment refresh signal can reload it.
ATT36 - Successful supported still-image uploads create repository-backed high-quality `display` and small `thumbnail` variants after the original attachment and resource link have committed. Generation is bounded, best-effort, idempotent, and retryable on completed-intent replay; it currently server-sniffs static JPEG/PNG only, never upscales, and safely leaves GIF/WebP/APNG/SVG/AVIF/HEIC or over-limit inputs on authorized original fallback. Derivative failure must never change a completed original into a failed upload.
ATT37 - Each attachment variant row owns nullable content SHA-256, generation version, and update time while `attachments.sha256` remains the original-file hash. Derivative object keys include the generated digest and are immutable for that content. The content route performs one minimal repository read for attachment, requested-or-original variant, and active authorization links; authorizes those links; emits strong validators only for verified current rows plus `Cache-Control: private, max-age=0, no-cache, must-revalidate` and `X-Content-Type-Options: nosniff`; validates object length against repository metadata; and returns a matching `304` before object storage. A legacy/stale or missing derivative falls back once to the authorized original without exposing a bucket or key.
ATT38 - Existing supported images are repaired through the human-only `mango-attachment-variants` repository command. It requires company scope and an explicit limit, defaults to dry-run, requires both apply and a scary confirmation string to write, runs with concurrency one, and resumes deterministically with `-after-attachment-id` plus a reported next cursor. Apply reports failures and exits nonzero when any item failed. Current-generation rows are included so storage existence checks can heal missing objects. Normal tests cover the command without any agent running it against dev or production storage; the database-agent boundary verifier does not authorize this writer/S3 operation.
ATT39 - Incoming email body text and HTML never wait for inline attachment bytes. CID images resolve independently through authenticated Mango/provider reads, and a slow, failed, or aborted image leaves the body readable.
ATT40 - Collapsed historical email cards issue no attachment-content reads. Expanded-card reads are abortable when scope, thread, message, or attachment changes and release transient object URLs during cleanup.
ATT41 - Initial body detail carries provider attachment metadata and only the inline content required by concrete CID recovery; ordinary body-only or ordinary file-attachment detail does not fetch or embed raw MIME bytes. Calendar RSVP may still authenticate and parse raw MIME at the action boundary.
ATT42 - Outbound email has a separate aggregate limit of exactly 24,000,000 attachment bytes; it does not change the general direct-browser limit of 1 GiB per file. Recipient and nonempty-content-or-valid-reference checks run first, then every unique Mango attachment is resolved through one original-content metadata/link read and authorized before any S3 body is opened. Declared original sizes are nonnegative and summed without overflow; zero bytes and exactly 24,000,000 bytes are valid, while any larger aggregate fails before S3.
ATT43 - After outbound preflight succeeds, S3 bodies open lazily inside the admitted provider send and stream directly into a deterministic-length Nylas multipart request. Each returned object length must match the authorized metadata before reading; the stream is bounded to that exact size, detects short, long, and failing readers, and closes on success, failure, provider rejection, or cancellation. Outbound send creates neither base64 attachment copies nor a complete multipart buffer, while incoming Nylas MIME recovery and calendar attachment content remain unchanged.
ATT44 - Every `email_draft` attachment list/content/send/edit authorization first proves that the exact draft exists and is not deleted. Personal operations are owner-only and new IDs include normalized account; legacy accountless user/draft IDs are owner-only read compatibility for a live draft and cannot mutate. Company manager/admin status is not a personal override. Shared reads require current View and mutations current Edit access to the exact live inbox/draft. Cross-user/account/inbox identifiers fail closed.
ATT45 - Deleting an email draft immediately makes every draft-only attachment URL/link unreadable and immutable, including exact and legacy resource IDs and manager/admin bypass attempts. The attachment object or metadata need not be deleted when another live resource owns it: an independently linked `email_message`/sent attachment remains readable through that resource's authorization.
ATT46 - Draft attachment mutation ownership spans durable preparation plus the complete upload or existing-attachment link operation. Concurrent mutations for one exact draft share preparation but retain independent active leases until each settles. Failure cleanup may delete an otherwise-empty draft only after the last lease ends and only when every mutation failed; while another lease remains active, or after any mutation succeeds, the draft stays live.

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
- For browser files, Mango authorizes and creates an intent while the browser sends raw bytes directly to the configured private S3 attachment bucket; backend-originated producers retain server streaming.
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
- ATT32

Given:
- A user pastes or drops an image into a node text box, Logic Gate editor body, project text box, My Triage compose/reply body, Shared Triage compose/reply body, attached-email reply body, or personal/shared email signature.
- A user copies an existing attachment-backed image into a different unified editor resource, or changes editor targets while an image upload/link is pending.

Expected:
- The shared rich-editor image path uploads the file through the Mango attachment API.
- The saved editor/email body stores an attachment reference, not a data URL or base64 blob.
- The first rendered inline image is high quality.
- Inline image hydration has one DOM owner, starts only when a frame is visible or near-visible, coalesces repeated display reads by attachment/variant/auth generation, and revokes each consumer-owned URL during document cleanup.
- Clicking an email-body image selects it and exposes an authenticated download action; double-click/fullscreen opens the original or highest-quality available variant.
- In editable content, image selection establishes a usable caret immediately before the image, and the same drag and resize behavior works in node, Logic Gate, project, compose, and reply editors.
- Copying an attachment-backed image creates the destination resource link before the reference is inserted; a stale asynchronous completion does not mutate a different or unmounted editor target.
- Backend guards reject attempts to persist durable inline image bytes, including communications draft and signature bodies.

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
- Each selected file creates an independent node-owned direct-upload intent. Exactly 1 GiB is accepted and one byte above is rejected before S3; files through 64 MiB use single PUT and larger files use 16 MiB multipart parts without a 12 MiB text-box aggregate.
- Overlapping picker batches cannot overwrite one another. Completed attachment IDs append to current node state, while each pending file appears once in node-level progress and uses the page/per-file concurrency caps.
- When a multi-file upload only partly succeeds, every successfully uploaded attachment remains linked, visible, and downloadable; the failed files are reported without discarding the successful results.
- Upload completion is scoped to the authenticated company/actor and durable node resource. Deleting the origin text box does not invalidate node ownership or recreate the projection; completion still succeeds when the node exists and current node edit authorization passes. Node deletion or permission loss rejects completion and cleans up the unfinalized object.
- Each node text box exposes a list/count containing only file attachments linked to that text block, while one node-wide list/count contains the union across all text boxes without issuing one attachment-list request per text box.
- React StrictMode remounts and multiple node-window consumers share one node-scope metadata request; upload completion, linking, and unlinking invalidate that cache before the next refresh.
- Node-wide and per-text-box rows show a recognizable image, spreadsheet, document, presentation, PDF, archive, text/code, audio, video, or generic-file icon. A recognized final extension takes precedence over an unhelpful MIME value; unknown types use the generic fallback rather than appearing broken.
- Image rows use visibility observation with a small vertical prefetch margin, so only visible or near-visible rows request bytes; closed menus and off-screen aggregate rows do not fetch thumbnails.
- A visible image row requests the authenticated `thumbnail` variant first and retries the authenticated `display` variant when that read fails; the backend may resolve a missing variant to the original. Each request is abortable, and the browser revokes temporary object URLs on image failure, dependency change, menu close, or unmount. A failed preview returns to the classified image/file icon instead of breaking the row.
- A long or opaque filename base may ellipsize, but a separate non-shrinking extension badge at the title's right edge always remains visible. The badge is uppercase and includes the leading dot (for example `.PNG` or `.XLSX`); names without a usable extension show `NO EXT`.
- Every row exposes a separate far-right download action that fetches the authorized original attachment bytes and preserves the original filename.
- Listing and downloading require view access to the node; uploading still requires edit access.
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
- ATT42
- ATT43
- ATT44
- ATT45

Given:
- A user attaches a file while composing, replying, replying all, forwarding, or scheduling personal/shared email.
- A user adds an image/logo attachment to a personal or shared email signature.

Expected:
- Mango creates/confirms the exact live durable draft before the browser uploads or links any draft attachment; concurrent preparation for the same draft coalesces.
- Draft/send payloads store attachment IDs or reference objects.
- Signature image/logo payloads store Mango attachment references through `email_signature` resource links.
- Personal signature resource IDs require both the user and connected account email, while shared signature resource IDs use the selected shared inbox; an incomplete personal mailbox scope must not create an attachment link.
- The backend reads S3 bytes at send time and passes normal files to the provider as ordinary attachments.
- Each pasted image reference is deduplicated, permission-checked, converted to one inline attachment with a matching alphanumeric CID, and rewritten from the private Mango source to `cid:` in outbound HTML.
- Personal and Shared Triage use the same conversion while preserving their personal/shared permission and grant scopes.
- Personal draft metadata and bytes remain owner-only. New links use the exact owner account; legacy three-part owner/draft links remain readable only by that owner and only while the draft is live, and are rejected for new links/uploads/mutations. Provider reauthentication does not erase the known association. Wrong-account identifiers and company administrator/manager roles cannot authorize another user's direct resource operations. Shared reads require current View and mutations current Edit access to the exact live inbox/draft.
- After draft deletion, every draft-scoped list/content/send/link/unlink attempt returns not found for owners and administrative bypass attempts. A legitimately independent sent-message attachment link continues to authorize the same bytes without reviving the deleted draft.
- Missing or unauthorized inline references fail the send, and local sent-message fallback data contains provider-ready CID HTML plus metadata-only references rather than raw bytes.
- Normal durable email payloads do not carry raw base64 `content`.
- Communications draft and signature upserts reject durable inline data URLs/base64 file bytes.
- Missing recipients and empty content without a valid attachment reference fail before attachment repository, S3, or provider work. Attachment-only messages remain valid.
- All attachment metadata and resource authorization pass before the first S3 read, so an unauthorized file, an invalid size, or a later item that pushes the aggregate above 24,000,000 bytes opens no earlier object.
- Exactly sized S3 bodies stream once into a known-length provider multipart body in attachment order; length disagreement, truncation, extra bytes, reader failure, cancellation, and provider failure close the active body and fail the send.
- Browser uploads remain direct browser-to-private-S3 and retain the independent 1 GiB per-file policy.

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

### Scenario ATT-S9: Remove An Attachment From A Node

Business logic covered:
- ATT13
- ATT18
- ATT19
- ATT20
- ATT23

Given:
- One attachment is linked to a node text box and appears in both that text-box list and the node-wide list.
- The same attachment may also be referenced by another authorized resource.
- One viewer can edit the node and another viewer has view-only access.

Expected:
- Right-clicking the row as the editor shows `Remove from node` in red.
- Choosing the action unlinks the attachment from the node and refreshes the text-box and node-wide counts/lists.
- The operation does not delete attachment metadata, private S3 bytes, or a link owned by another resource.
- The view-only user can list, preview, and download according to node access but cannot invoke the removal action.

### Scenario ATT-S10: Incoming Email And Unified Editor Image Actions

Business logic covered:
- ATT5
- ATT6
- ATT11
- ATT12
- ATT13
- ATT24
- ATT25
- ATT32
- ATT39
- ATT40
- ATT41

Given:
- A personal, shared, or node-attached email body contains an inline screenshot referenced by `cid:` or provider attachment metadata.
- A user selects or copies an inline image in any unified rich editor surface, including a personal/shared email signature.

Expected:
- Mango renders the sanitized incoming body before CID attachment bytes finish loading, then resolves each inline image independently through the authorized attachment boundary.
- Collapsed historical cards make no body-detail or attachment-content reads. Expanding a card activates its lazy body read and abortable CID downloads; replacing or collapsing the card aborts work that no longer has a visible consumer.
- Ordinary message detail does not fetch raw MIME merely because attachment metadata is empty or no calendar part is present; MIME recovery remains limited to a concrete missing inline-CID body reference, while calendar RSVP may still use authenticated raw MIME parsing.
- A single click on the incoming image exposes an explicit authenticated download action, and a double-click opens fullscreen preview.
- Selecting the editable image preserves its resize selection and places a document caret immediately before its frame.
- Typing text or spaces at that caret moves the editable image forward, and resize behavior is consistent in node, Logic Gate, project, My Triage, Shared Triage, attached-email reply, and email-signature editors.
- Copying an attachment-backed image to a different resource authorizes and links it to that destination before insertion, and a target switch prevents a stale asynchronous insertion.
- Closing or replacing previews releases transient browser object URLs.
- The DOM and download action do not expose provider credentials, private S3 keys, or a public object URL.

### Scenario ATT-S11: Browser Direct Upload Reliability And Cleanup

Business logic covered:
- ATT26
- ATT27
- ATT28
- ATT29
- ATT30
- ATT31

Given:
- A user selects empty, small, 64 MiB, multipart, and over-limit files from a node text box.
- A multipart part URL expires, a request is retried, the page reloads, one sibling fails, and the user cancels another upload.
- A backend email/import producer also stores an attachment.

Expected:
- Mango control-plane requests contain JSON metadata only, while S3 requests contain raw File/Blob bytes and exact signed headers without Mango authorization or cookies.
- Hashing and multipart work stay bounded by active chunks rather than whole-file size, and SHA-256 keeps raw-file meaning with separate S3 checksum provenance.
- Empty files complete through single PUT; 64 MiB is single PUT; one byte above uses multipart; exactly 1 GiB is allowed; one byte above the configured maximum is rejected before S3.
- Retry obtains a fresh URL for the same part, confirmed parts are not uploaded twice, resume reconciles backend/ListParts state, and completion/abort are idempotent.
- Cancel aborts active browser requests and best-effort aborts the intent. Expired or abandoned objects are cleaned by the application, with AbortIncompleteMultipartUpload lifecycle as a backstop.
- Completed siblings remain in node lists, while pending/failed/canceled rows remain progress state only and trigger no permanent attachment count.
- The backend-originated producer still streams through PutObject without a redundant full-file copy.

### Scenario ATT-S12: Variants, Conditional Reads, And Existing-Image Repair

Business logic covered:
- ATT13
- ATT21
- ATT33
- ATT34
- ATT35
- ATT36
- ATT37
- ATT38

Given:
- A static JPEG or PNG completes upload and the same image appears more than once in one or more editor DOMs.
- A supported image has no current display/thumbnail generation, an unsupported or animated image is opened, and a caller repeats an authorized conditional content request.

Expected:
- Original metadata/link finalization succeeds before bounded derivative work begins, and derivative failure leaves the original readable.
- Display and thumbnail are generated and persisted independently with content-addressed immutable keys and idempotent repository upserts; replay or the guarded repair command may retry missing/current-version objects without duplicating variants or discarding a successful sibling.
- Unsupported, animated, oversized, or over-dimension input is not decoded into a misleading derivative and falls back to the original.
- Repeated consumers share one Blob request per auth-scoped key while owning separate revocable object URLs; only visible/near-visible frames enter the bounded hydration queue.
- Authorization runs on every content request. A matching validator returns `304` before S3/object storage, uses private cache semantics and `nosniff`, and never exposes storage identifiers.
- A derivative row whose object is missing falls back to the original once.
- Existing-image repair is human-only, dry-run by default, requires company plus limit, reports a deterministic next cursor, cannot apply without the explicit confirmation guard, and exits nonzero after its report when apply has failures.

### Scenario ATT-S13: Concurrent Draft Attachment Preparation And Cleanup

Business logic covered:
- ATT46

Given:
- Two inline-image, upload, or existing-link mutations begin against one otherwise-empty exact personal/shared draft.
- Durable draft preparation finishes once, the first mutation fails, and the second remains in progress.
- The second mutation is exercised once as a success and once as a failure.

Expected:
- Each mutation retains its lease through preparation and the complete upload/link operation.
- The first failure cannot delete the draft while the second lease is active.
- A successful sibling latches the group as successful and no later failure deletes the draft.
- When both fail, only the final settlement requests one empty-draft cleanup.
