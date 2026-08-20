# Process Story

A Mango user uploads one file and Mango stores the completed original in private S3 with one `attachments` row. Each Node, Project, Logic Gate, chat, email message, email draft, or signature that uses the file gets an `attachment_relationships` row. A Project textbox file remains a Project relationship with the textbox ID as origin metadata, while a sent Project chat owns its final link through `project_chat_message` and the exact `project_textbox_chats.chat_id`. Removing one relationship keeps the file when another valid relationship survives. Removing the final relationship makes the file garbage: Mango makes it unavailable, deletes its original and generated previews from S3, and then removes its database rows. Sending an email creates the exact `email_message` relationship before its draft is removed, so the Sent viewer can still open the file.

Last updated: 2026-08-17

Development Attachment Step 2 completed on 2026-08-04. The final sync reported `READY_FOR_ATTACHMENT_STEP2_DATABASE_BOUNDARY` with 491 upload jobs, 842 previews, and 1,080 relationships; all 253 pending zero-owner cleanups were finalized. The five retired attachment source tables (`attachment_migration_items`, `attachment_migration_runs`, `attachment_variants`, `resource_attachments`, and `attachment_upload_intents`) are absent from the canonical schema. The obsolete attachment migration command is removed; current operations use only final tables and the shared retry-safe cleanup service.

# Attachments Tests

Coverage Status:
- Attachment Steps 1 and 2 are complete in development. Historical Step 1 operator SQL remains test evidence, while the canonical schema intentionally excludes its retired source tables. Final-table SQL contracts are covered by `backend/internal/store/attachment_upload_schema_test.go`, preview constraints by `attachment_variant_schema_test.go`, draft discard cleanup by `email_draft_attachment_scope_test.go`, and one-versus-multiple-owner plus pending-relink behavior by `memory_attachment_links_test.go`. Retry-safe S3 cleanup, missing objects, retained shared keys, partial failure, and idempotent retry remain covered with mocked storage by `backend/internal/attachmentcleanup/service_test.go`.
- Node attachment filename/type and visibility-gated thumbnail presentation are covered by `tests/frontend/modules/attachments/attachmentPresentation.test.ts`; concurrent byte reservations, deduplicated totals, partial success, latest-state append, stale navigation/scope/permission invalidation, and delete-while-uploading protection are covered by `tests/frontend/modules/editor/nodeTextBlockAttachments.test.ts`.
- Incoming email image selection/download/fullscreen behavior and node attachment removal controls are covered by `tests/frontend/modules/editor/emailViewerContract.test.ts`; shared editor image-reference behavior is covered by `tests/frontend/modules/editor/editorProjection.test.ts` and `tests/frontend/modules/editor/richTextEditing.test.ts`; attachment-frame hydration ownership, refresh-after-DOM-replacement, object-URL revocation, and restored-frame cleanup are covered by `tests/frontend/modules/editor/editorImageHydration.test.ts`; existing-attachment destination linking and mailbox-complete signature resource IDs are covered by `tests/frontend/modules/attachments/attachmentApi.test.ts`.
- Outbound email metadata preflight, exact 24,000,000-byte and zero-byte boundaries, authorization, lazy storage opening, deterministic multipart framing, exact stream lengths, cancellation, provider rejection, and cleanup are covered by `backend/internal/http/communications_handlers_test.go` and `backend/internal/http/nylas_client_test.go`; bounded query shape is covered by the attachment handler/store contract tests.
- Direct-upload coverage must additionally prove bounded hashing, JSON-only Mango control requests, raw credential-free S3 PUTs, exact signed headers, progress/cancel/retry/resume, completed-part reconciliation, node-scoped deletion survival, and completed-only list/count refresh.
- Business Logic Covered By Scenarios: 100%
- Draft mutation leasing across preparation plus upload/link, mixed success, and final all-failed settlement is covered by `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts`; a mounted ComposePanel toolbar-plus-inline race remains a higher-level coverage gap.
- Business Logic Covered By Automated Tests: Partial. Existing attachment presentation, durable-reference serialization, authenticated content access, email send-time S3 resolution, draft/signature durable-inline guards, destination resource linking, and migration behavior are covered. `backend/internal/http/email_draft_attachment_scope_test.go` covers active/deleted exact and legacy draft links, wrong user/account, shared permission revocation, manager/admin bypass attempts, and independent sent-message survival; `tests/frontend/pages/home/homeMailDrafts.test.ts` covers durable draft preparation before upload plus failure retention. The direct browser path requires focused frontend hashing/transport/node-lifecycle tests, backend intent/storage/repository tests, and the static IaC contract in `infra/tests/attachment_direct_upload.test.mjs`; normal suites must not require live AWS.

## Business Logic

### 2026-07-10 Node Attachment Retention And Preview Contract

- A node text box is the upload origin for a file, not the lifetime owner of that file. Deleting the originating text box must delete only that text-box projection; it must not unlink the file's node `attachment_relationships` relationship, delete attachment metadata, or delete S3 bytes.
- The node-level attachment counter and list are the recovery and discovery surface for every retained node file, including files whose originating text box no longer exists. A retained file with no live origin must remain countable, listable, previewable, and downloadable, and its origin must use an explicit deleted-text-box fallback label rather than a misleading live text-box number.
- Clicking the non-action area of a node attachment row opens an in-app preview. Row activation must not silently download the file. The explicit download control remains available at the right side of the row and must not also open the preview.
- Preview bytes must be fetched through the authenticated Mango attachment-content API and normal resource authorization. The UI must not expose or depend on a public S3 object URL.
- In-app preview supports images, PDF, bounded plain-text and source-like content (including text, code, CSV, JSON, and XML), audio, and video when the browser can render the returned content type. Text preview may receive the full authenticated blob from the current content endpoint, but it decodes only `blob.slice(0, 256 KiB)` and renders at most 200,000 decoded characters so a large file cannot create unbounded decode or DOM work.
- Office documents, spreadsheets, presentations, archives, and unknown/binary formats are not converted in the browser. Their in-app state must say that preview is unavailable while keeping metadata and the explicit original-file download action usable.
- Preview requests and temporary object URLs are transient UI resources. Closing or replacing a preview must abort obsolete work where possible and revoke any object URL created for the previous file.
- Browser attachment policy defaults to 1 GiB (1,073,741,824 bytes) per file and is backend-authoritative/configurable. The old 12 MiB aggregate-per-text-box limit does not apply to the direct browser path. Files through and including 64 MiB use one presigned PUT; larger files use resumable S3 multipart upload with 16 MiB parts.
- Browser preparation and transfer remain bounded-memory: raw SHA-256 is computed incrementally, S3 receives raw `File`/`Blob` or bounded `File.slice` bodies, no whole-file `arrayBuffer()`/base64/data URL is created, and browser file bytes never pass through Mango API.
- Upload-progress rows are node-level transient state with preparing, uploading, retrying, completing, complete, canceled, and failed states, byte progress, cancel, and retry. Pending/failed/canceled upload jobs never appear in normal node counts/lists; successful sibling files remain attached.

Required regression scenario:
- Upload previewable and non-previewable files from two node text boxes, delete one originating text box, and reopen the node.
- Confirm every retained file is still present in the node-level count/list, the deleted origin has the fallback label, supported rows preview in app without downloading, unsupported rows show preview-unavailable state, and the separate download control still returns the original file.
- Confirm text preview truncates rather than rejects larger content, decodes no more than the first 256 KiB, renders no more than 200,000 decoded characters, and shows `Preview limited to 256 KiB / 200,000 characters.` when content exceeds either display bound.
- Confirm closing/switching previews cleans up transient browser resources; upload validation accepts exactly 1 GiB and rejects one byte above before S3; the 64 MiB boundary selects single versus multipart correctly; and no 12 MiB text-box aggregate is applied to direct uploads.

ATT1 - All durable user file bytes must be stored in private Amazon S3 through the Mango attachment system in local, dev, and prod environments; normal local development must not use a separate filesystem attachment backend.
ATT2 - Postgres stores attachment metadata, S3 object keys, previews, ownership/resource links, and audit fields; editor, chat, email, projection, and saved-version payloads store attachment references, not file bytes.
ATT3 - Durable Mango payloads must not store `data:image/...;base64`, `data:application/...;base64`, durable `dataURL` fields, or normal app email attachment payloads carrying raw base64 content.
ATT4 - Temporary browser previews may use object URLs or data URLs only before upload completes; those values must be replaced by attachment references before durable save, send, snapshot, history, or projection writes.
ATT5 - Rich-editor pasted or dropped inline images must use the shared unified rich-editor image path behind `useEditorDocumentSurfaceHandlers` and `editorImages`, then save attachment references across Node, Logic Gate, Project, My Triage, Shared Triage, personal or resource-shared Node/Project Reply, and personal/shared email-signature surfaces.
ATT6 - Inline editor images must render as high-quality images on first open, not low-quality thumbnails, and double-click/fullscreen preview must load the original or highest-quality available preview directly into its stable final dark overlay. Opening must not flash a transient extra panel, outline, unmeasured window, or geometry jump while the source loads. The overlay exposes a conspicuous bright-red top-right close X with accessible button semantics; activating it closes the preview while supported Escape/backdrop or existing double-click dismissal remains intact.
ATT7 - Node attachment-button uploads and attachment lists use the same Mango attachment API, private S3 storage, metadata records, and `attachment_relationships` links as pasted inline images. The node loads attachment metadata separately from file bytes; image bytes are requested only when a row is visible or near-visible, and original bytes are requested only by an explicit download.
ATT8 - Chat attachments remain chat UI, not unified rich-editor content, but they still upload through the global Mango attachment API and persist attachment references instead of durable `dataURL` values. Every posted chat image row exposes a separate right-side authenticated original-file download control, and double-clicking the image row opens the same shared dark fullscreen image viewer used by inline editor images, including its original download and bright-red close X.
ATT9 - Project text-block attachments and project chat attachments use the same global attachment system. The projection-shaped Project response rebuilds textbox file references from active Project relationships and chat file references from active `project_chat_message` relationships; it never reads a legacy Project projection row.
ATT10 - Before an outgoing compose or Reply can upload or link an `email_draft` attachment, Mango must create or confirm the exact live personal or resource-shared draft. Reply starts personal; checking **Shared Draft** proves effective Edit access to the exact Node or Project and creates or opens its shared draft. First creation copies the current persisted personal attachment links without moving them, while an existing shared draft is never reseeded. The browser then uploads to Mango attachments and saves references in draft/send state; the backend reads S3 bytes only at provider send. Pasted inline images remain Mango references until they become CID-linked provider attachments at that boundary.
ATT11 - Incoming provider email attachments may stay provider-referenced while they are only mailbox-list metadata, but must be cached or persisted into Mango S3 when attached to a node, converted into work, repeatedly opened as a durable Mango resource, or otherwise selected for Mango ownership.
ATT12 - Attached-email projections and communications email JSON may store provider IDs, message/thread metadata, inline/content IDs, and Mango attachment references, but must not store attachment bytes.
ATT13 - Attachment content access must be authorized through Mango resource permissions; knowing an S3 key or attachment ID is not enough to read bytes.
ATT14 - Developer inspection uses DBeaver for `attachments`, `attachment_previews`, and `attachment_relationships` metadata, then AWS S3 console/CLI for the referenced object key when byte inspection is explicitly needed.
ATT15 - Backend validation must reject new durable inline file-byte payloads in normal editor, chat, projection, saved-version, email send, communications draft, and communications signature paths.
ATT16 - Migration must be dry-run first, idempotent, resumable, and auditable. It must report old-to-new attachment mappings before rewriting existing inline/base64 payloads, but `attachment_migration_runs` and `attachment_migration_items` are not permanent product tables and are retired after the new backend passes Step 3.
ATT17 - Email send preparation must find each `mango-attachment:` image source, deduplicate repeated IDs, authorize the existing resource link, resolve original S3 bytes within the total attachment limit, assign an alphanumeric content ID, add one inline provider attachment, and rewrite the image source to the matching `cid:` URI. It must reject missing/unauthorized references and return only metadata—not base64 bytes—in local sent-message fallback data.
ATT18 - Explicit files uploaded from a node text box are node resource links with `relationship_kind=file_attachment`, `information_id` set to that text-box ID, and `editor_surface=node_text_block`. This metadata determines list scope; file bytes and legacy `dataURL` values do not.
ATT19 - A text-box attachment list contains only active node `file_attachment` links whose `information_id` matches that text box. A node-wide attachment list contains every active node `file_attachment` link regardless of text box and must not count other relationship kinds.
ATT20 - Node attachment lists use the backend resource-link list as canonical data and display attachment metadata returned with each link. A text-box title may label or group a node-wide row when its `information_id` resolves to a current block; an unresolved block must not make an otherwise active node `file_attachment` disappear from the node-wide list.
ATT21 - User downloads request the original attachment through Mango's authenticated content endpoint, which rechecks resource authorization before reading private S3 bytes. The browser download uses `original_filename`; clients must not expose or navigate directly to `storage_bucket` or `storage_key`.
ATT22 - Edit access to the owning node permits listing, previewing, downloading, and creating its attachments. A no-access user receives no attachment metadata or controls.
ATT23 - Right-clicking an attachment row in a node-wide or text-box attachment list exposes a red `Delete permanently` action only when the viewer can edit that Node. The action menu mounts in the shared app overlay above clipping and stacking contexts, prefers a visible position beside the attachment list, and clamps inside the viewport when neither side fits. After confirmation, Mango deletes the original object, generated previews, attachment metadata, and Node links. Deletion is rejected if the attachment is still actively linked to another resource.
ATT24 - An inline image in an incoming email body can be selected with one click to expose an authenticated download action and opened in fullscreen preview with a double-click. Inline `cid:` sources must resolve through an authorized Mango or provider attachment endpoint rather than exposing a public object URL.
ATT25 - Selecting an inline image in a unified rich editor preserves its visual selection/resize handles and establishes a collapsed document caret immediately before the image frame. Text or spaces typed at that caret appear before the image, and image resizing remains available in Node, Logic Gate, Project, My Triage, Shared Triage, personal or resource-shared Node/Project Reply, and email-signature editors.
ATT26 - Browser-selected file bytes go directly to private S3 through short-lived presigned requests. Mango API remains the authoritative control plane for authentication, authorization, upload jobs, IDs, object keys, limits, signing, completion/abort, S3 verification, metadata, and durable resource linking; browser bytes never traverse Mango API.
ATT27 - The configurable browser limit defaults to 1 GiB per file. Single PUT applies through and including 64 MiB; larger files use 16 MiB multipart parts with at most three parts in flight per file and four S3 PUTs across the page. There is no 12 MiB aggregate-per-text-box limit on this path.
ATT28 - Browser raw file SHA-256 is computed incrementally with bounded memory before upload-job creation. `attachments.sha256` remains the raw content hash; S3 checksum algorithm/value/type and SHA verification method are recorded separately, and multipart ETags/composite checksums never replace the raw hash.
ATT29 - Upload jobs and multipart part state are durable and idempotent. Creation uses actor/company/client-request identity; signing the same part/checksum may refresh its URL; completion and abort replay safely; resume reconciles authoritative accepted parts; naturally expired upload jobs remain `expired`, only explicit abort/cancel records `aborted`, and expired work is cleaned up by the application with S3 lifecycle as a backstop.
ATT30 - Only completed upload jobs create/list permanent attachments. Node-level progress preserves filename/extension/size, byte progress, cancel/retry, and the states preparing, uploading, retrying, completing, complete, canceled, and failed. Each selected file is independent and one failure cannot discard completed siblings.
ATT31 - Server-side streaming PutObject, including non-seekable producer streams, remains available for incoming email, provider imports, migrations, and backend jobs. Removing the old browser multipart-byte path must not remove or weaken backend-originated streaming or authenticated GetObject reads.
ATT32 - Pasting an existing attachment-backed editor image into another unified rich editor target must create the destination resource's authorized `inline_image` link before inserting the image reference. An asynchronous upload or existing-attachment link may commit only while its originating editor root, document target, attachment resource context, and saved range are still current; switching targets or unmounting must not insert it into the next document.
ATT33 - During one browser page/app session, authenticated attachment content uses one shared Blob singleflight/cache across mounted editor windows, keyed by API base, company, auth-session generation, attachment ID, and requested representation. Failures evict immediately; auth generation is checked again before delivery so stale in-flight prior-user data is rejected; completed cache entries obey expiry/LRU byte bounds and large originals are not retained. Object URLs are never shared cache values: every consumer creates and revokes its own URL. One consumer abort only detaches that consumer, and the last-consumer upstream abort is deferred through the StrictMode cleanup/setup turn so a replay owner can attach without starting a duplicate GET.
ATT34 - Each mounted rich-editor DOM has exactly one attachment-image hydration owner for each document update. Hydration observes image frames relative to the editor's nested scrollport with a near-viewport margin, schedules visible display-image reads through one bounded priority queue, marks queued/in-flight frames so duplicate owners cannot race, and returns stable cleanup that detaches observers/tasks and revokes every URL created for that DOM before replacement, context change, or unmount. Delete followed by editor undo/redo refreshes the current hydration generation so a restored attachment-backed frame renders immediately with the correct source without a page refresh; superseded URLs are revoked, and the original owner cleanup still disposes the newest generation. A failed frame is unscheduled and re-observed with bounded retry/backoff instead of remaining permanently unhydrated.
ATT35 - A node uses one StrictMode-safe attachment-relationship metadata singleflight/cache for its node-wide and per-text-box attachment lists. The canonical node-scope response is reused by every list, is loaded without one preview query per attachment, and is explicitly invalidated before upload completion, link, unlink, or another local attachment refresh signal can reload it.
ATT36 - Successful supported still-image uploads create repository-backed high-quality `display` and small `thumbnail` previews after the original attachment and resource link have committed. Generation is bounded, best-effort, idempotent, and retryable on completed-job replay; it currently server-sniffs static JPEG/PNG only, never upscales, and safely leaves GIF/WebP/APNG/SVG/AVIF/HEIC or over-limit inputs on authorized original fallback. Derivative failure must never change a completed original into a failed upload.
ATT37 - Each attachment preview row owns nullable content SHA-256, generation version, and update time while `attachments.sha256` remains the original-file hash. Derivative object keys include the preview digest and are immutable for that content. The content route performs one minimal repository read for attachment, requested-or-original content, and active authorization links; authorizes those links; emits strong validators only for verified current rows plus `Cache-Control: private, max-age=0, no-cache, must-revalidate` and `X-Content-Type-Options: nosniff`; validates object length against repository metadata; and returns a matching `304` before object storage. A legacy/stale or missing derivative falls back once to the authorized original without exposing a bucket or key.
ATT38 - Existing supported image previews are repaired through the human-only `mango-attachment-previews` repository command. It requires company scope and an explicit limit, defaults to dry-run, requires both apply and a scary confirmation string to write, runs with concurrency one, and resumes deterministically with `-after-attachment-id` plus a reported next cursor. Apply reports failures and exits nonzero when any item failed. Current-generation rows are included so storage existence checks can heal missing objects. Normal tests cover the command without any agent running it against dev or production storage; the database-agent boundary accountable does not authorize this writer/S3 operation.
ATT39 - Incoming email body text and HTML never wait for inline attachment bytes. CID images resolve independently through authenticated Mango/provider reads, and a slow, failed, or aborted image leaves the body readable.
ATT40 - Collapsed historical email cards issue no attachment-content reads. Expanded-card reads are abortable when scope, thread, message, or attachment changes and release transient object URLs during cleanup.
ATT41 - Initial body detail carries provider attachment metadata and only the inline content required by concrete CID recovery; ordinary body-only or ordinary file-attachment detail does not fetch or embed raw MIME bytes. Calendar RSVP may still authenticate and parse raw MIME at the action boundary.
ATT42 - Outbound email has a separate aggregate limit of exactly 24,000,000 attachment bytes; it does not change the general direct-browser limit of 1 GiB per file. Recipient and nonempty-content-or-valid-reference checks run first, then every unique Mango attachment is resolved through one original-content metadata/link read and authorized before any S3 body is opened. Declared original sizes are nonnegative and summed without overflow; zero bytes and exactly 24,000,000 bytes are valid, while any larger aggregate fails before S3.
ATT43 - After outbound preflight succeeds, S3 bodies open lazily inside the admitted provider send and stream directly into a deterministic-length Nylas multipart request. Each returned object length must match the authorized metadata before reading; the stream is bounded to that exact size, detects short, long, and failing readers, and closes on success, failure, provider rejection, or cancellation. Outbound send creates neither base64 attachment copies nor a complete multipart buffer, while incoming Nylas MIME recovery and calendar attachment content remain unchanged.
ATT44 - Personal `email_draft` attachment reads and account-scoped link/unlink operations remain owner-only in the exact owner, sending account, and draft. Resource-shared draft attachment reads and mutations instead require effective Edit access to its exact Node or Project. Shared-inbox, manager, or administrator status never grants cross-user personal-draft or cross-resource shared-draft access.
ATT45 - A Node or Project email view lists and opens received attachments through its existing exact resource/thread/message authorization path. Reply defaults to the exact creator-owned **My Draft**; checking **Shared Draft** switches to the one exact resource-shared draft, and unchecking switches back without deleting either. Every outgoing file and signature image is authorized through the active draft's `email_draft` relationship and promoted to the sent message before draft deletion.
ATT46 - Email-collaboration chat attachments are ordinary Node `chat_attachment` references on the one collaboration Node and use the same upload, authorization, preview, deletion-ownership, and no-inline-bytes behavior from ATT8 and ATT15. The email surface must not clone attachment rows or provider/S3 bytes when it mounts the shared ChatPane.
ATT47 - Provider-backed files and CID images in an email collaboration are downloaded with company plus collaboration identity. Permanent participation is checked before source-mailbox resolution, the fetched provider message must belong to the collaboration's immutable exact thread, and the same authorized path is used by Triage and Node attached-email viewers; source-mailbox navigation permission is neither granted nor required.
ATT48 - Separate email attachment lists hide only attachments whose normalized Content-ID is actually referenced by the message body. `is_inline`, `content_disposition=inline`, or a Content-ID alone is not sufficient to hide a file; every unreferenced provider/Mango attachment remains visible with its metadata and existing authorized preview/download action in My Triage, Shared Triage, and attached-email Node viewers.
ATT49 - Email-signature images remain private Mango attachment references. Signature settings eagerly hydrate the compact authenticated preview through the exact mailbox-scoped `email_signature` resource, while save/send continue to persist references and provider-safe HTML rather than secrets, storage keys, public URLs, or inline file bytes.
ATT50 - Every `email_draft` attachment list, content, send, or mutation first proves that the exact draft exists and is not deleted. Personal operations require the exact owner and sending-account scope; resource-shared operations require effective Edit access to the exact owning Node or Project. Send separately rechecks exact personal-mailbox ownership or Shared Inbox send/Edit authority, and every cross-user, account, inbox, or resource identifier fails closed.
ATT51 - While an email draft is deleted or retired, every draft-only attachment URL/link is unreadable and immutable, including exact and legacy resource IDs and manager/admin bypass attempts. Explicit discard, direct wide unlink, and permanent owner deletion do not revive it. Restoring a recycled Node or Project may reactivate only the shared-draft links captured with that owner, after the owner and wide email relationship exist and the draft receives a fresh revision. The attachment object or metadata need not be deleted when another live resource owns it: an independently linked `email_message`/sent attachment remains readable through that resource's authorization.
ATT52 - Personal draft attachment preparation keeps its existing independent mutation settlement behavior. First shared-draft creation atomically links the current persisted personal attachment set to the new shared draft without removing personal ownership; an existing shared draft is never overwritten, and unchecking **Shared Draft** mutates no link. Every later resource-shared attachment add or remove supplies the expected draft revision; a stale revision returns HTTP 409 without changing the link, and success advances the revision. Shared drafts add no server lease or automatic reload/retry loop.
ATT53 - Signature editor, signature Preview, and composed-message insertion rehydrate each durable image after editor lifecycle replay through the exact `email_signature` authorization scope. Loading and terminal failure are explicit private preview states rather than attempts to navigate the browser to `mango-attachment:`; successful display uses a revocable object URL with contain sizing, cleanup revokes it and restores the durable reference, and the existing authenticated original/lightbox behavior remains independent.
ATT54 - Reusing an attachment-backed node/project inline image as a chat attachment creates only the authorized `chat_attachment` resource link for the existing attachment ID; it must not GET the original content or create an upload job. The composer stages the selected thumbnail immediately as transient processing UI, blocks send until the link reconciles, replaces success with the durable reference, and keeps a failed item visible and removable without persisting transient state or image bytes. Only a legacy image with no attachment ID may use the upload fallback.
ATT55 - A successful ordinary personal/shared mailbox send promotes each Mango outgoing attachment from its draft-only ownership to an exact `email_message` resource link before local Sent state is returned. The link is idempotent, preserves inline versus ordinary relationship kind, uses personal user/message or shared-inbox/message authorization, and remains readable after the draft is deleted; the Sent viewer treats a durable `attachment_id` as a resolvable source even when provider response metadata omits filename or provider ID.
ATT56 - Outbound provider multipart streaming validates each source's declared length and preserves genuine open/read/short/long attachment failures before provider acceptance. After exact bytes are validated, source close is cleanup-only; a cleanup-induced cancellation cannot override a successful provider response with `attachment_storage_failed`. When a browser abandons an authenticated provider attachment preview, matching request-context cancellation exits silently without a misleading proxy-error response or log.
ATT57 - A saved personal/shared signature image is sendable only from a coherent original record: requested and served content is the original, byte sizes match, original/current bucket and key agree with configured storage, and the stored SHA-256 is valid and equal. A healthy display derivative proves only preview health; outbound CID construction never substitutes display bytes for a missing, stale, or corrupt original. Provider multipart validates the original object's reported length, exact stream length, and SHA-256 before success.
ATT58 - Every non-canceled outbound attachment failure emits one sanitized communications-send log containing request correlation, POST route, company/user/scope, safe attachment ID/index/count, failure class, and public code. Object-not-found returns attachment_content_not_found, configured storage unavailability or timeout returns attachment_storage_unavailable, and reported/short/long size failures return attachment_content_length_mismatch; opaque open/read/checksum failures retain attachment_storage_failed. Logs never contain filenames, storage keys/buckets, signed URLs, credentials, raw bodies, or bytes, and a canceled request exits silently.
ATT59 - Starting a personal/shared Forward copies every ordinary source attachment and each inline asset actually referenced by the retained body into the exact live Mango forward-draft resource before send. The copied reference keeps the provider attachment ID only as source provenance and uses its new Mango attachment ID for authorization; retained `cid:` URLs are rewritten to those copied durable IDs. Unreferenced inline-only assets are not promoted, aggregate size is checked against ATT42 before copying, and partial download/upload failure stays visible and retryable without falsely claiming the complete forward is ready.
ATT60 - A visible or near-visible durable editor image must not depend forever on an `IntersectionObserver` callback or an unbounded content request. Hydration schedules already-visible frames immediately, uses a bounded observer watchdog, applies a per-attempt deadline, retries the authenticated original content after display failure/timeout through the shared bounded queue/backoff, revokes any late object URL, and reaches ready or explicit error while preserving the durable attachment ID. Realtime state never contains attachment bytes, object URLs, signed URLs, credentials, or secrets.
ATT61 - External rich-document image import authorizes edit access to the exact destination resource before any outbound request. The server accepts only credential-free HTTP(S) URLs on default ports, revalidates each redirect with a five-hop limit, resolves only public global-unicast addresses, rejects localhost/private/link-local/multicast destinations, streams at most 24,000,000 bytes, and accepts only detected PNG, JPEG, GIF, or WebP bodies. It computes the hash server-side, writes the original to private attachment storage, creates the destination inline-image link, and never stores or returns the source URL, credentials, signed URL, or image bytes in editor state.
ATT62 - A mounted attachment-backed editor image tolerates several transient content-read failures through finite background retries before showing an explicit unavailable state. Double-clicking an unavailable frame starts a fresh display hydration generation and separately loads the authenticated original into the fullscreen preview. The preview shows loading rather than navigating to the internal `mango-attachment:` reference, retries transient original-load failures, and exposes an accessible Retry action after terminal failure. Closing the preview or unmounting its editor aborts obsolete work and revokes owned object URLs.

### 2026-08-04 Attachment Step 2 Backend Cutover

- Production attachment SQL now reads and writes only `attachment_relationships`, `attachment_upload_jobs`, `attachment_upload_parts.upload_job_id`, and `attachment_previews`; originals remain in `attachments`. The retained legacy tables are operator evidence only until Step 3.
- Every supported owner deletion routes through one relationship-retirement helper. It locks affected attachment rows, retires only the selected owner relationships, and marks an attachment pending deletion only when no active relationship survives. Node textbox deletion keeps the independent Node owner relationship.
- Pending deletion is terminal for new reads and links. A backend cleanup worker retries each company, protects keys still referenced by retained originals, previews, or active upload jobs, treats an already-missing object as success, and hard-deletes final relationship/preview/attachment rows only after all unprotected S3 deletions succeed. Logs contain IDs and status only.
- Sending from My Triage, Shared Triage, Node, or Project uses the existing mailbox send path and `email_draft` attachment relationships. Personal draft relationships remain owner-only; resource-shared draft and attachment access requires effective Edit to the exact Node or Project. Successful send creates the exact sent-`email_message` links before deleting the draft; explicit discard retires only that draft's relationships, and no `email_send` preview exists.
- The human preview repair command is `go run ./cmd/mango-attachment-previews`; apply requires `-apply -confirm GENERATE_ATTACHMENT_PREVIEWS_FOR_COMPANY`.


ATT63 - The complete final table set is `attachments`, `attachment_relationships`, `attachment_upload_jobs`, `attachment_upload_parts`, and `attachment_previews`. There is no second attachment ownership table. Upload jobs use `upload_job_id` and `attachment_relationship_id`, upload parts use `upload_job_id`, and previews use `preview_type`; the old intent, resource-attachment, and variant column names do not remain. This is the completed Step 2 contract. During Step 1 only, the deployed legacy backend still requires `attachment_upload_parts.upload_intent_id` and its foreign key to `attachment_upload_intents`; the operator changes that column and foreign key at the short, writer-paused boundary immediately before the Step 2 backend deploy.
ATT64 - `attachment_relationships` is the only ownership and access link. Each row points one stored attachment to one exact live Mango owner. An attachment ID or S3 key alone grants no access.
ATT65 - Removing one relationship keeps the attachment when another active valid relationship survives. Removing the final active relationship makes the attachment unowned and requires deletion of the original S3 object, all preview S3 objects, and the attachment database records.
ATT66 - Final-link deletion first marks `attachments.deleted_timestamp` so new reads and links fail. Cleanup deletes S3 objects before hard-deleting Postgres rows, treats an already-missing S3 object as deleted, and retries temporary S3 failures without losing the stored keys.
ATT67 - Deleting an owning Node, Project, Logic Gate, supported chat, email message, email draft, signature, or other owner removes or retires its attachment relationships and runs the zero-relationship check. Recycling a Node or Project captures its active resource-shared `email_draft` links before retirement; restoring that same owner revives only those captured links after their draft and wide email relationships, with the draft advanced to a fresh revision. Permanent deletion and direct wide unlink have no attachment-link restore. Deleting a Project textbox retires Project relationships whose `information_id` is that textbox and every chat relationship owned by its chats. The current Logic Gate product has no Logic Gate chat owner/table; deleting a Logic Gate removes only its final resource relationships. A textbox recorded only as a Node attachment's upload origin is not the owner; deleting that textbox keeps the surviving Node relationship and file.
ATT68 - The 213 proven legacy relationships whose exact target was already deleted are approved bad data. Step 1 exact-checks each ledger identity and checksum, accepts an identity that is already physically absent as settled, and deletes an exact present match without inventing an owner. It also removes any other relationship that is already deleted or whose exact supported owner no longer exists; these are reported as a separate cleanup class and are never added to the approved 213 set. A valid active `attachment_relationships` row created by the then-current backend after the legacy checkpoint is retained even when it has no `resource_attachments` source; Step 1 independently proves its exact owner and active attachment before counting it. Because every count is a relationship count rather than a file count, each affected attachment is deleted only when it has zero other valid relationships. Step 1 checks every attachment, including attachments outside these cleanup classes.
ATT69 - Sending an email creates an idempotent `email_message` relationship for every retained sent file before the email draft is removed. Sent-message visibility and authorization come from that relationship, not from a preview type.
ATT70 - `email_send` is removed. `attachment_previews` permits only `display` and `thumbnail`; the completed original is stored by `attachments`. Outbound email size checks and streaming are separate code and do not require an `email_send` preview.
ATT71 - The development attachment cutover has no known unfinished uploads to preserve. Step 1 still counts every upload-job status and stops if unexpected active jobs appear. `attachment_upload_parts` remains because future files larger than 64 MiB still need resumable multipart uploads.
ATT72 - Attachment rollout completed all three gates: copy/reconcile, the writer-paused Step 2 boundary plus final backend deploy, then tests/snapshot and strict retirement of `resource_attachments`, `attachment_upload_intents`, `attachment_variants`, `attachment_migration_runs`, and `attachment_migration_items`. Fresh databases contain only the five final attachment tables.
ATT73 - A complete bucket-wide S3 audit is not required for the first consolidation. Every object actively deleted by the migration or product cleanup must still be matched to its database key, and normal product deletion must start through Mango rather than by directly removing an S3 object.

### Attachment Step 1 operator sequence

The number of repository scripts does not equal the number of product rollout
steps. Step 1 deliberately has two SQL entry points: a read-only decision report
and a separately authorized database/data operation. Step 2 owns the application
code cutover plus its short database column/FK switch. Step 3 owns testing,
snapshot, cutoff, and old-table retirement; no Step 3 retirement SQL exists yet
because that work is not authorized until Step 2 passes its gates.

1. In DBeaver, use the database-enforced read-only credential to run `scripts/attachment_step1_preflight.sql`. Its first result set starts with the decision row. Continue only when that first row is `READY_FOR_ATTACHMENT_STEP1`, every one of the 213 evidence identities says `ready_to_delete` or `already_absent`, and no blocking relationship identities are reported.
2. In a separately approved writer session, run `scripts/attachment_step1_create_copy_reconcile.sql`. It deletes only exact current rows in the reported approved, already-deleted, or missing-owner cleanup classes. A failure leaves the transaction aborted; roll it back, investigate, and rerun the preflight. Do not edit a deletion predicate to make a count pass.
3. With the normal backend database configuration, attachment bucket/region, and AWS SSO profile set only in the operator session, run the cleanup from `backend/`. The first command is dry-run only:

```powershell
go run ./cmd/mango-attachment-step1-cleanup -company-id <company-uuid> -limit 100
```

4. Review the safe ID/count report. Apply one retryable batch only with both explicit switches:

```powershell
go run ./cmd/mango-attachment-step1-cleanup -company-id <company-uuid> -limit 100 -apply -confirm DELETE_ATTACHMENT_STEP1_ORPHANS
```

5. Repeat dry-run/apply until `examined=0`, then rerun the preflight and preserve its reconciliation report. Do not run `scripts/attachment_step2_database_cutover.sql` during Step 1. Development later completed Step 2 by pausing writers, rerunning this exact preflight/reconcile/cleanup sequence, and running the boundary immediately before deploying the Step 2 backend. Repeat that order in every future environment.

## Attachment Step 2 deployment sequence

Development completed this sequence on 2026-08-04. It remains the required runbook for another environment.

1. Pause every attachment, email, chat, and editor writer and keep them paused through the database boundary and backend replacement.
2. Run `scripts/attachment_step1_preflight.sql` with the database-enforced read-only credential. Stop unless its first decision row is ready and all reconciliation and active-upload checks pass.
3. In the separately approved writer session, run `scripts/attachment_step1_create_copy_reconcile.sql` once more to capture the final legacy/final-only delta.
4. From `backend/`, run the Step 1 cleanup dry-run, then approved batches with `-apply -confirm DELETE_ATTACHMENT_STEP1_ORPHANS` until `examined=0`. Rerun the read-only preflight and preserve the clean report.
5. With writers still paused, run `scripts/attachment_step2_database_cutover.sql` directly in DBeaver. Its transaction takes the short exclusive lock, renames `attachment_upload_parts.upload_intent_id` to `upload_job_id`, replaces the foreign key with `attachment_upload_jobs(upload_job_id)`, and must finish with `READY_FOR_IMMEDIATE_STEP2_BACKEND_DEPLOY`.
6. Immediately deploy the matching Step 2 backend from this repository state. Do not start the legacy backend after the boundary. Verify `/healthz`, a final-table attachment list/read, and upload-job/part resume behavior before resuming writers.
7. Observe cleanup retries and final-table writes. Do not run Step 3 retirement, drop legacy tables, take destructive database action, or delete S3 objects manually as part of this deployment.


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
- The backend writes metadata and attachment relationships to Postgres.
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
- ATT34
- ATT61

Given:
- A user pastes or drops an image into a node text box, Logic Gate editor body, project text box, My Triage compose/reply body, Shared Triage compose/reply body, Node/Project owner-draft Reply body, or personal/shared email signature.
- A user pastes a mixed ClickUp, Linear, or similar SOP document containing formatted text and multiple inline images into one of those editors.
- A user copies an existing attachment-backed image into a different unified editor resource, or changes editor targets while an image upload/link is pending.
- The user double-clicks an inline image, closes the preview, deletes the hydrated image, and invokes editor undo/redo without refreshing the page.

Expected:
- The shared rich-editor image path uploads the file through the Mango attachment API.
- The saved editor/email body stores an attachment reference, not a data URL or base64 blob.
- The first rendered inline image is high quality.
- Inline image hydration has one DOM owner, starts only when a frame is visible or near-visible, coalesces repeated display reads by attachment/preview/auth generation, and revokes each consumer-owned URL during document cleanup.
- Undo/redo refreshes that owner's current hydration generation, revokes superseded object URLs, and restores the deleted image fully rendered with the correct source immediately; the owner's original cleanup still disposes the refreshed generation.
- Clicking an email-body image selects it and exposes an authenticated download action; double-click/fullscreen opens the original or highest-quality available preview directly in the stable dark overlay, with no transient panel/outline or geometry jump and with a bright-red top-right accessible close X.
- In editable content, image selection establishes a usable caret immediately before the image, and the same drag and resize behavior works in node, Logic Gate, project, compose, and reply editors.
- Copying an attachment-backed image creates the destination resource link before the reference is inserted; a stale asynchronous completion does not mutate a different or unmounted editor target.
- Mixed rich paste resolves all images through the shared durable path with a maximum of three unique image imports in flight, preserves document/image order, and commits once after all resolutions settle.
- A protected remote import checks destination edit permission before fetching, rejects unsafe or oversized/non-raster sources and redirects, stores no source URL, and lets one failed image degrade to safe fallback text without losing the rest of the pasted document.
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
- Each selected file creates an independent node-owned direct-upload job. Exactly 1 GiB is accepted and one byte above is rejected before S3; files through 64 MiB use single PUT and larger files use 16 MiB multipart parts without a 12 MiB text-box aggregate.
- Overlapping picker batches cannot overwrite one another. Completed attachment IDs append to current node state, while each pending file appears once in node-level progress and uses the page/per-file concurrency caps.
- When a multi-file upload only partly succeeds, every successfully uploaded attachment remains linked, visible, and downloadable; the failed files are reported without discarding the successful results.
- Upload completion is scoped to the authenticated company/actor and durable node resource. Deleting the origin text box does not invalidate node ownership or recreate the projection; completion still succeeds when the node exists and current node edit authorization passes. Node deletion or permission loss rejects completion and cleans up the unfinalized object.
- Each node text box exposes a list/count containing only file attachments linked to that text block, while one node-wide list/count contains the union across all text boxes without issuing one attachment-list request per text box.
- React StrictMode remounts and multiple node-window consumers share one node-scope metadata request; upload completion, linking, and unlinking invalidate that cache before the next refresh.
- Node-wide and per-text-box rows show a recognizable image, spreadsheet, document, presentation, PDF, archive, text/code, audio, video, or generic-file icon. A recognized final extension takes precedence over an unhelpful MIME value; unknown types use the generic fallback rather than appearing broken.
- Image rows use visibility observation with a small vertical prefetch margin, so only visible or near-visible rows request bytes; closed menus and off-screen aggregate rows do not fetch thumbnails.
- A visible image row requests the authenticated `thumbnail` preview first and retries the authenticated `display` preview when that read fails; the backend may resolve a missing preview to the original. Each request is abortable, and the browser revokes temporary object URLs on image failure, dependency change, menu close, or unmount. A failed preview returns to the classified image/file icon instead of breaking the row.
- A long or opaque filename base may ellipsize, but a separate non-shrinking extension badge at the title's right edge always remains visible. The badge is uppercase and includes the leading dot (for example `.PNG` or `.XLSX`); names without a usable extension show `NO EXT`.
- Every row exposes a separate far-right download action that fetches the authorized original attachment bytes and preserves the original filename.
- Listing and downloading require edit access to the node; uploading still requires edit access.
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
- ATT50
- ATT51
- ATT59

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
- Starting Forward copies eligible source ordinary/CID-referenced attachments into the exact draft, rewrites the locked original to copied Mango references, and visibly reports partial copy failures before send; it never embeds provider bytes or authorizes the forward through the source attachment ID alone.
- Personal draft metadata and bytes remain owner-only. New links use the exact owner account; legacy three-part owner/draft links remain readable only by that owner and only while the draft is live, and are rejected for new links/uploads/mutations. Provider reauthentication does not erase the known association. Wrong-account identifiers and company administrator/manager roles cannot authorize another user's direct resource operations. Shared reads and mutations require current Edit access to the exact live inbox/draft.
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
- The migration is resumable and idempotent, and its operator report records every old-to-new mapping and disposition. The temporary migration run/item tables are not retained as final product tables.
- Migrated content contains attachment references and no durable inline file bytes.
- Backend validation prevents normal product paths from reintroducing the removed durable inline file-byte shapes.
- Live database/S3 dry-run or apply steps remain manual operations requiring the agent DB access boundary accountable, report review, and explicit approval.

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
- One user has edit access to the node and another user has no access.

Expected:
- Right-clicking the row as the editor shows `Delete permanently` in red, visibly beside the attachment list and above the list's clipping/stacking context, and asks for confirmation.
- Choosing the action deletes the original object, generated previews, attachment metadata, and Node links, then refreshes the text-box and node-wide counts/lists.
- If another resource still has an active link, the delete is rejected and its metadata and private S3 bytes remain intact.
- The edit-authorized user can list, preview, download, and permanently delete an unshared Node file; the no-access user receives neither the list nor its actions.

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
- ATT34
- ATT39
- ATT40
- ATT41
- ATT54

Given:
- A personal, shared, or node-attached email body contains an inline screenshot referenced by `cid:` or provider attachment metadata.
- A user selects or copies an inline image in any unified rich editor surface, including a personal/shared email signature.
- In editable content, the user deletes a hydrated attachment-backed image and undoes the deletion.

Expected:
- Mango renders the sanitized incoming body before CID attachment bytes finish loading, then resolves each inline image independently through the authorized attachment boundary.
- Collapsed historical cards make no body-detail or attachment-content reads. Expanding a card activates its lazy body read and abortable CID downloads; replacing or collapsing the card aborts work that no longer has a visible consumer.
- Ordinary message detail does not fetch raw MIME merely because attachment metadata is empty or no calendar part is present; MIME recovery remains limited to a concrete missing inline-CID body reference, while calendar RSVP may still use authenticated raw MIME parsing.
- A single click on the incoming image exposes an explicit authenticated download action, and a double-click opens the original/highest-quality source directly in the stable dark fullscreen overlay with its bright-red accessible close button and no intermediate panel or geometry jump.
- Turning an attachment-backed node/project editor image into chat paints it in the composer immediately, links the existing attachment without a content GET or upload job, and reconciles success/failure before send becomes available.
- Selecting the editable image preserves its resize selection and places a document caret immediately before its frame.
- Typing text or spaces at that caret moves the editable image forward, and resize behavior is consistent in node, Logic Gate, project, My Triage, Shared Triage, Node/Project owner-draft Reply, and email-signature editors.
- Copying an attachment-backed image to a different resource authorizes and links it to that destination before insertion, and a target switch prevents a stale asynchronous insertion.
- Undo restores a deleted editable image fully rendered immediately; refreshing/replacing the hydration generation and closing/replacing previews revoke superseded transient object URLs without leaking them.
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

### Scenario ATT-S12: Previews, Conditional Reads, And Existing-Image Repair

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
- A supported image has no current display/thumbnail preview, an unsupported or animated image is opened, and a caller repeats an authorized conditional content request.

Expected:
- Original metadata/link finalization succeeds before bounded derivative work begins, and derivative failure leaves the original readable.
- Display and thumbnail are generated and persisted independently with content-addressed immutable keys and idempotent repository upserts; replay or the guarded repair command may retry missing/current-version objects without duplicating previews or discarding a successful sibling.
- Unsupported, animated, oversized, or over-dimension input is not decoded into a misleading derivative and falls back to the original.
- Repeated consumers share one Blob request per auth-scoped key while owning separate revocable object URLs; only visible/near-visible frames enter the bounded hydration queue.
- Authorization runs on every content request. A matching validator returns `304` before S3/object storage, uses private cache semantics and `nosniff`, and never exposes storage identifiers.
- A derivative row whose object is missing falls back to the original once.
- Existing-image repair is human-only, dry-run by default, requires company plus limit, reports a deterministic next cursor, cannot apply without the explicit confirmation guard, and exits nonzero after its report when apply has failures.

### Scenario ATT-S13: Collaboration Chat, Received Files, And Owner Reply Attachments

Business logic covered:
- ATT2
- ATT8
- ATT13
- ATT15
- ATT42
- ATT43
- ATT44
- ATT45
- ATT46
- ATT47

Given:
- A current Node user attaches a file to email collaboration chat and opens received files or CID images from the related email.
- An incoming provider message in the collaboration's immutable exact thread contains an ordinary file and a CID image.
- Another current Node user without source-mailbox navigation reads the chat, provider file, and CID content, while a user without Node access guesses the IDs and a Node user requests a message from another thread.

Expected:
- Chat uses the collaboration Node's existing chat-attachment links, and email/Node surfaces show the same references without cloning rows or bytes.
- Received-message files retain Node/thread/message authorization, while Reply attachment add/remove uses only the current user's exact owner mailbox draft and grants no access to another user's draft.
- Lack of source-mailbox navigation does not block a Node-authorized received-file read, while a user without Node access and a cross-thread identifier are denied.
- Incoming provider files and CID images authorize company plus permanent collaboration participation before resolving the immutable source mailbox, accept only a provider message in the collaboration's exact thread, reject cross-thread and nonparticipant requests, and use the same path from Triage and Node attached-email viewers.
- Durable chat payloads contain Mango references only.

### Scenario ATT-S14: Node Email Attachment Discovery And Signature Preview

Business logic covered:
- ATT11
- ATT12
- ATT24
- ATT48
- ATT49
- ATT53

Given:
- One incoming message contains a body-referenced CID image plus an ordinary PDF that also carries provider Content-ID metadata.
- The message is converted to a new Node and separately attached to an existing Node.
- A mailbox signature contains a Mango-owned image.

Expected:
- The CID image renders in the body and is not duplicated below it, while the unreferenced PDF remains listed with filename, type, size, and authenticated download in both Node paths.
- The viewer reads canonical message metadata under the retained mailbox scope and never persists provider bytes or invents another attachment owner.
- Opening signature settings loads the image preview immediately through authorized Mango content reads; saving remains durable and exposes no private object URL or credential.
- Signature editor and compose survive immediate hydration cleanup/replay, expose loading or terminal Preview unavailable states without a broken browser thumbnail, use contain sizing on success, revoke stale display URLs, retain the durable reference, and keep the authorized original/lightbox path.

### Scenario ATT-S15: Concurrent Draft Attachment Preparation And Cleanup

Business logic covered:
- ATT52

Given:
- Two inline-image, upload, or existing-link mutations begin against one otherwise-empty exact personal/shared draft.
- Durable draft preparation finishes once, the first mutation fails, and the second remains in progress.
- The second mutation is exercised once as a success and once as a failure.

Expected:
- Each mutation retains its lease through preparation and the complete upload/link operation.
- The first failure cannot delete the draft while the second lease is active.
- A successful sibling latches the group as successful and no later failure deletes the draft.
- When both fail, only the final settlement requests one empty-draft cleanup.

### Scenario ATT-S16: Sent Inline Attachment Promotion

Business logic covered:
- ATT51
- ATT55

Given:
- A personal or shared draft contains one Mango signature/inline image that is rewritten to CID for provider send.
- The provider returns a message ID with partial attachment metadata, and the source draft is then deleted.

Expected:
- Mango backfills safe attachment metadata, creates one idempotent exact sent-message link with the inline relationship, and returns no raw attachment bytes.
- The source draft link becomes unreadable as before, while the independent sent-message link authorizes display hydration and original viewing without a public or stale object URL.

### Scenario ATT-S17: Accepted Signature Image And Canceled Preview

Business logic covered:
- ATT49
- ATT56

Given:
- An outbound signature image streams its exact declared bytes, its source reports cancellation only during cleanup, and the provider accepts the message.
- A separate provider-backed image preview is canceled by the browser during hydration cleanup.

Expected:
- The accepted send succeeds and is never rewritten as `attachment_storage_failed` by source cleanup; genuine content-read and length-validation failures remain attachment failures.
- The abandoned preview releases work without writing a proxy error response or logging the expected request cancellation as a provider failure.

### Scenario ATT-S18: Signature Original Integrity And Safe Failure Evidence

Business logic covered:
- ATT49
- ATT55
- ATT57
- ATT58

Given:
- Personal and shared signatures each persist a Mango image with distinct healthy original and display objects.
- A send is repeated with object-not-found, unavailable, reported-length, short, long, read, checksum, and canceled-request failures.

Expected:
- Compose preview may use display, but CID multipart contains the authorized original bytes and SHA-256; the accepted response retains CID metadata and gains the exact sent-message inline link.
- Known public codes remain specific, every non-canceled failure log identifies its safe attachment index/class and send request, no secret/body/filename data appears, and request cancellation produces no failure log.

### Scenario ATT-S19: Final Table Consolidation And Orphan Cleanup

Business logic covered:
- ATT63
- ATT64
- ATT65
- ATT66
- ATT67
- ATT68
- ATT69
- ATT70
- ATT71
- ATT72
- ATT73

Given:
- One attachment has two valid relationships, and another has only one valid relationship.
- The 213 known legacy relationships still point to deleted targets.
- One sent-email file is related to its email draft before send.
- An S3 deletion temporarily fails.
- No upload job is expected to be active.

Expected:
- Step 1 creates or exact-verifies and reconciles the five final tables, deletes the 213 exactly proven broken relationship rows plus separately proven deleted/missing-owner relationships, preserves valid post-checkpoint final-only relationships, deletes every file proven to have zero valid relationships, and never invents a replacement owner.
- Removing one of two valid relationships keeps the shared file. Removing the sole valid relationship marks the attachment deleted, rejects new reads and links, deletes its original and previews from S3, and then removes its database rows.
- A temporary S3 failure leaves the attachment marked for retry with its object keys still available to cleanup; it does not produce an untracked S3 object.
- Deleting a Node attachment's origin textbox keeps the Node-owned relationship. Deleting the actual owning resource removes its relationship and triggers the same final-link check.
- Sending promotes the draft file to an exact `email_message` relationship before draft cleanup, and the Sent viewer remains authorized without an `email_send` preview.
- Unexpected active upload jobs stop Step 1. Multipart part rows remain attached to their renamed upload jobs.
- Step 2 writes only final tables. Step 3 runs the full test/reconciliation gate, takes a database snapshot, and only then drops the five retired tables.
- The operation checks every S3 key it deletes but does not require a complete bucket-wide audit.


# Process Story: browser bytes go directly to final attachment storage

A user selects a file, Mango creates an `attachment_upload_jobs` row, and the browser uploads bounded chunks directly to private S3. Completion creates the `attachments` row and an exact `attachment_relationships` owner link. Removing one owner preserves shared content; removing the last owner marks it pending, deletes S3 originals/previews first, then deletes PostgreSQL rows with retry-safe cleanup.

Last updated: 2026-08-04

# Attachment Transfer And Streaming Tests

## Business Logic

AST1 - Normal browser-selected attachment bytes travel directly from the browser to private S3 through short-lived presigned requests. Mango API receives JSON control-plane requests only and must not receive browser file bytes, `FormData` file parts, base64, or data URLs.

AST2 - Browser preparation computes the raw file-content SHA-256 incrementally in bounded chunks. It must not call whole-file `arrayBuffer()`, encode the file as base64/data URL, or retain memory proportional to file size.

AST3 - Browser files through and including 64 MiB use one presigned PUT. Larger browser files use resumable multipart upload with 16 MiB parts, at most three parts in flight for one file and four S3 PUTs in flight across the page. Raw `File`/`Blob` or bounded `File.slice` bodies go to S3 with only the exact signed headers and no Mango authorization header or cookie.

AST4 - The configurable browser limit defaults to 1 GiB (1,073,741,824 bytes) per file. The old 12 MiB aggregate-per-text-box limit does not apply to direct browser upload. Each file succeeds or fails independently, and only completed attachments enter normal lists/counts.

AST5 - Browser upload jobs and multipart part state are durable and idempotent. Retry refreshes an expired URL for the same job/part; resume reconciles accepted S3 parts; cancel aborts active requests and best-effort aborts the job; expiry cleanup aborts multipart work or deletes an unfinalized single-PUT object. Natural TTL expiry remains `expired`, while only an explicit abort/cancel records `aborted`. The retired `attachment_upload_intents` table is never used or recreated. S3 AbortIncompleteMultipartUpload lifecycle is a backstop, not the primary cleanup path.

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
