Last updated: 2026-07-12

# Email Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (`tests/frontend/pages/home/homeCommands.test.ts` covers send payload construction, Mango attachment references, and mailbox-scoped signature save ordering; `tests/frontend/modules/editor/richTextEditing.test.ts` covers rich email HTML serialization, spacing, indentation, lists, links, highlight sanitization, and safe sanitization; `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts` covers exact compose/signature flush submission, unified signature mounting, shared highlight controls, and signature hydration/save ordering; backend communications and attachment handler tests cover provider send boundaries, S3 attachment resolution, email draft attachment authorization, and rejection of embedded inline file bytes from durable draft/signature writes. Broader draft/signature persistence endpoint coverage remains partial.)
- Thread viewer parity and Reply All focus are covered by `tests/frontend/modules/editor/emailViewerContract.test.ts`; recipient deduplication/mailbox exclusion by `tests/frontend/modules/communications/emailRecipients.test.ts`; semantic reply-draft identity by `tests/frontend/pages/home/homeMailDrafts.test.ts`; and calendar RSVP request construction by `tests/frontend/modules/communications/communicationsApi.test.ts`.

- Automatic signature insertion, rich-body deduplication, signature-only draft detection, mailbox scope keys, and personal/shared signature request scope are covered by `tests/frontend/pages/home/homeCommands.test.ts`, `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts`, and `tests/frontend/modules/communications/communicationsApi.test.ts`.

## Business Logic

### 2026-07-10 Node Attached-Email Retention Contract

- An email attached to a node is node-owned durable context. A text box may display or originate that association, but deleting the text box must not delete the attached-email projection, detach the provider message, or remove the email from the node-level count/list.
- The global node-header email counter/list opens a standalone node-level attached-email organizer modal with its folders/list and selected conversation. It must not depend on a live text box, auto-create a text box, or choose another text box as a replacement display target.
- The standalone global attached-email organizer must remain usable on a node with zero text boxes and by a user who can view but cannot edit the node. Existing per-text-box email panes remain unchanged for surviving boxes.
- File attachments that belong to the retained email continue to follow their provider/Mango ownership and authorization rules. Retaining the attached-email projection must never copy raw provider attachment bytes into the node projection.

Required regression scenario:
- Attach an email from a node text box, delete that box, reopen the node with no live text boxes, and open the email from the node-header counter/list.
- Confirm the count and projection remain, the standalone attached-email organizer renders its list/folders and retained thread, no replacement text box is created, and a view-only user can open it without receiving edit controls.

EMAIL1 - Mango email drafts are Mango application records, not Nylas provider drafts and not browser-only state.
EMAIL2 - Browser `localStorage` may be used only as a migration/fallback mirror for drafts and signatures; the database is the source of truth when the backend is reachable.
EMAIL3 - Personal draft and signature rows are scoped to the actor's personal `user_email_connections` tuple of `user_id` plus `account_email`.
EMAIL4 - Shared draft and signature rows are scoped to `shared_inbox_id`; `shared_inboxes` remains the Mango permission/resource wrapper and points to `company_email_connections` for provider grant plumbing.
EMAIL5 - A draft or signature row must be either personal or shared, never both and never neither.
EMAIL6 - Personal drafts are visible/editable only to the owning user inside the company; shared drafts/signatures require Shared Triage view/edit access for the selected shared inbox.
EMAIL7 - Draft IDs remain client-stable text IDs so reply/forward resume behavior and existing `email_draft` attachment resource IDs do not break; new personal reply/forward IDs include the connected personal mailbox scope to avoid cross-account collisions.
EMAIL8 - Reply drafts are unique per company, mailbox scope, and source message ID; reopening Reply resumes the existing draft and preserves the original message context.
EMAIL9 - Forward drafts are unique per company, mailbox scope, and source message ID; reopening Forward resumes the existing draft.
EMAIL10 - Draft rows store addressing text, subject, sanitized editor body content, source message metadata, schedule timestamp, scope, creator/updater, and timestamps; attachments stay in `resource_attachments`.
EMAIL11 - Email signatures store sanitized editor body content and default metadata; signature attachments use `email_signature` resource attachments when images/logos are supported.
EMAIL12 - Normal file attachments for drafts use `email_draft` resource attachments and are sent by resolving Mango attachment IDs to S3 bytes at send time.
EMAIL13 - Durable email draft/signature/send payloads must not store raw base64 attachment content or data URLs. Draft and signature API writes must reject embedded inline file bytes before any durable write.
EMAIL14 - Sending a Mango-authored email must serialize the editor body into professional HTML that preserves line breaks, blank lines, spacing, bullets, numbered lists, links, indentation, font size, bold, underline, and text highlight color. Font-family selection is intentionally ignored until multiple font families exist; this does not disable font-size formatting.
EMAIL15 - Legacy plain text drafts/signatures must still send safely as escaped/linkified HTML.
EMAIL16 - Scheduled sends are saved as durable drafts with a due timestamp, but V1 scheduled execution remains browser-driven while the app is open.
EMAIL17 - Successful sends delete the corresponding durable draft only after the provider send succeeds.
EMAIL18 - Nylas is the mailbox read/send provider boundary; Mango owns draft/signature persistence and attachment references.
EMAIL19 - SES remains for auth/invitation/system email and must not be confused with user mailbox draft/send behavior.
EMAIL20 - Provider reauthorization problems must be recoverable mailbox errors, not Mango logout/session failures.
EMAIL21 - A thread action targets the exact message card on which Reply, Reply All, or Forward was chosen; its provider message ID, recipients, original context, and stable draft identity must not be substituted with the latest thread message.
EMAIL22 - Conversation details are newest first with a deterministic message-ID tie-breaker. New inbound or locally sent messages appear expanded at the top and collapse previously expanded cards while preserving the single grouped mailbox row.
EMAIL23 - A thread detail pane owns the only vertical scrollbar. A selected single-message reader uses all remaining detail-pane height as its flexible minimum, so a short body never leaves a shallow fixed-height reader box; every expanded message document grows to its complete rendered content, including content sized from the document root, without clipping or exposing a per-message body scrollbar. Collapsed cards remain header summaries until expanded.
EMAIL24 - Reply body editors have a nontrivial minimum/default height, support vertical resizing, and automatically persist a clamped per-user mailbox-scope height preference.
EMAIL25 - Selecting a mailbox row while compose/reply is open quietly saves eligible draft content, exits compose, and shows the selected message on the first click without reloading the list.
EMAIL26 - Shared font-size minus/value/plus, Bold, Underline, and highlight-color controls preserve the editor range when toolbar focus changes. Font size applies to a selected range or pending caret, Bold and Underline toggle both on and off, highlight applies to the restored non-collapsed selection and supports clear/no-highlight, and serialized outbound HTML preserves every applied format. Enter commits the numeric font-size value once; Escape cancels the draft value without a later blur commit.
EMAIL27 - Durable pasted-image bodies store Mango attachment references. At the backend send boundary, authorized references are deduplicated, resolved from S3, converted to inline attachments with unique alphanumeric content IDs, and rewritten to matching `cid:` image sources; normal files remain non-inline and broken/unauthorized inline references reject the send.

EMAIL28 - The default signature for the exact active personal mailbox or Shared Triage inbox is automatically inserted exactly once into every newly created compose, reply, and reply-all body. If database hydration completes after the editor opens, Mango backfills only that still-open new draft, preserves text already typed, never rewrites a reopened saved draft, and never duplicates a signature already present in rich or legacy body content.
EMAIL29 - When remote hydration returns multiple reply drafts for the same company, user, mailbox scope, and source message, Mango keeps the newest semantic draft and deletes the superseded remote draft rows. A stale duplicate must not reappear after the surviving draft is sent, deleted, or reopened.
EMAIL30 - Personal, shared, node-attached, and project-attached thread viewers expose the same expand-all, To/Cc/Bcc, Reply/Reply All, authenticated attachment, inline-image download/fullscreen, and original-message context behavior while preserving the originating mailbox scope.
EMAIL31 - Vertical reply resizing ends on pointer-up even outside the handle, pointer-cancel, lost pointer capture, or window blur. Pointer movement after any of those events must not continue changing editor height.
EMAIL32 - Calendar-invitation metadata (`text/calendar` or `.ics`) may identify a candidate invitation in the viewer, but the backend always derives `METHOD`, `VEVENT`, and UID from authenticated raw MIME. RSVP controls prevent duplicate submission while pending and display a saved/selected response only after provider success; malformed invitations, missing/ambiguous events, expired grants, and provider failures leave no false selected state and surface a recoverable error.
EMAIL33 - Reopening a saved Reply All draft restores its saved To, Cc, and Bcc fields while still applying the active-mailbox exclusion and case-insensitive recipient deduplication rules.
EMAIL34 - My Triage compose/reply, Shared Triage compose/reply, attached-email reply, and personal/shared signature editing must use the same `EditorDocumentSurface`, shared behavior/formatting controller, and `EditorTabBar` controls as the other unified editor surfaces. The signature editor must be a unified rich editor rather than a native textarea.
EMAIL35 - Save Draft, Send, and Save Signature must synchronously flush the mounted rich editor and persist or submit the exact sanitized HTML returned by that flush, including the user's final uncommitted DOM edit; cached React state must not substitute an older body.
EMAIL36 - Signature persistence is scoped to the exact personal account or shared inbox. An in-flight remote load must not overwrite a newer local edit, an existing remote row remains authoritative even when its body is empty, and save success is shown only after the remote write succeeds. A failed save retains the exact mailbox-scoped pending body, retries it before accepting older remote state, serializes retries/backfills with newer saves, and clears pending state only after that same body succeeds.
EMAIL37 - Selecting a mailbox row makes that message detail the foreground provider read. First body paint must not wait behind unread-state mutation, next-page prefetch, historical thread hydration, collapsed-card attachment reads, or background archive work.
EMAIL38 - Selecting a row from a different thread replaces prior conversation state immediately. Requests started for the old selection may finish, but must not repopulate the new detail pane or continue nonessential attachment hydration.
EMAIL39 - The selected message body hydrates first. Historical thread rows load preview metadata in bounded pages and fetch full bodies or attachment content only when the user expands that card; Expand all is an explicit request to hydrate every card.
EMAIL40 - Received body text and HTML render before inline CID downloads finish. Each CID source resolves independently, a slow or failed image never hides readable body content, and collapsed cards issue no attachment-content reads.
EMAIL41 - Normal detail reads use mailbox-scoped frontend/backend caches and same-key in-flight coalescing without `refresh=true`. Raw MIME is not part of an ordinary body-only detail critical path; calendar RSVP and concrete unresolved inline-content recovery remain authenticated raw-MIME uses.

## Scenarios

### Scenario EMAIL-S1: Personal Draft Durability

Business logic covered:
- EMAIL1
- EMAIL2
- EMAIL3
- EMAIL5
- EMAIL6
- EMAIL7
- EMAIL10
- EMAIL25
- EMAIL35

Given:
- A signed-in user opens My Triage compose or reply with a connected personal mailbox.
- The user enters recipients, subject, body, or attachments and saves/closes the compose window.

Expected:
- Mango writes or updates a `communications_email_drafts` row scoped to the user's personal email connection.
- The browser may keep a local mirror, but reload uses the database row when available.
- Reopening Drafts shows the same draft on another browser session after backend sync.
- A different non-manager user cannot see or edit the personal draft.
- Clicking an email in the left list while compose is open quietly saves eligible draft content, closes compose, and renders the clicked email immediately.
- Saving or sending flushes the mounted editor first and persists or submits the exact returned sanitized HTML.

### Scenario EMAIL-S2: Shared Draft Durability

Business logic covered:
- EMAIL1
- EMAIL4
- EMAIL5
- EMAIL6
- EMAIL10
- EMAIL12
- EMAIL35

Given:
- A user with edit access composes from a Shared Triage inbox with an assigned shared mailbox.

Expected:
- Mango saves the draft against `shared_inbox_id`.
- Users with Shared Triage view access can see the draft; users with edit access can mutate it.
- Attachments link to the draft through `resource_attachments` and remain permission-gated by the shared inbox.
- Saving or sending flushes the mounted editor first and persists or submits the exact returned sanitized HTML.

### Scenario EMAIL-S3: Reply And Forward Resume

Business logic covered:
- EMAIL7
- EMAIL8
- EMAIL9
- EMAIL17
- EMAIL21
- EMAIL29

Given:
- A user replies to or forwards a provider message, closes compose, and later clicks Reply or Forward on the same source message in the same mailbox scope.

Expected:
- Mango resumes the existing stable draft ID instead of creating a duplicate.
- Reply context is restored so the original message being answered is visible.
- Choosing the action on an older thread card uses that exact message ID and context rather than the newest card.
- If legacy or remote state contains duplicate semantic reply drafts, Mango retains the newest draft, removes the superseded remote rows, and does not expose an older draft after the current one is sent or deleted.
- After a successful send, Mango deletes the saved draft.

### Scenario EMAIL-S4: Signature Persistence

Business logic covered:
- EMAIL2
- EMAIL3
- EMAIL4
- EMAIL5
- EMAIL6
- EMAIL11
- EMAIL13
- EMAIL28
- EMAIL34
- EMAIL35
- EMAIL36

Given:
- A user saves an email signature for their personal mailbox or for a shared inbox they can edit.
- The user may format the signature or save while signature hydration, a legacy backfill, or a prior failed save is still resolving.

Expected:
- Mango saves the signature in `communications_email_signatures` for exactly one scope.
- Loading compose uses the database signature when available and localStorage only as fallback/migration.
- New compose, reply, and reply-all editors receive the exact mailbox-scoped default signature automatically, including a safe one-time backfill when remote loading finishes after the editor opens.
- Reopened saved drafts are left unchanged, and automatic or manual insertion cannot add a duplicate signature.
- The signature is edited through the shared unified rich editor and shared font-size, Bold, Underline, highlight, and outline controls, not a native textarea.
- Save Signature flushes the editor and writes exactly that returned HTML for the active personal-account or shared-inbox scope.
- A stale load cannot overwrite a newer local edit; an empty remote row is authoritative; failed saves remain mailbox-scoped pending sync and cannot overtake newer saves.
- The durable signature endpoint rejects embedded inline file bytes before persistence.
- Future logo/image attachments for signatures use `email_signature` resource attachments.

### Scenario EMAIL-S5: Professional Email Rendering

Business logic covered:
- EMAIL14
- EMAIL15
- EMAIL26
- EMAIL34
- EMAIL35

Given:
- A draft or signature body contains rich editor content with paragraphs, blank lines, indentation, bullets, numbered lists, links, and highlighted text.

Expected:
- Sending uses the shared email HTML serializer, not raw draft text.
- The resulting HTML preserves spacing, line breaks, list structure, links, indentation, selected font sizes, bold, underline, and sanitized text highlight colors.
- Font-size controls retain the selected range even if the numeric picker receives focus, and Bold/Underline can be toggled off as well as on.
- Font-family choice is not part of this contract until Mango supports more than one font family.

### Scenario EMAIL-S6: Attachments And Provider Boundary

Business logic covered:
- EMAIL12
- EMAIL13
- EMAIL18
- EMAIL19
- EMAIL20
- EMAIL27

Given:
- A draft has normal file attachments or pasted inline screenshots and is sent through personal or shared mailbox scope.

Expected:
- The browser stores attachment IDs/references, not file bytes, in durable draft/send state.
- Draft and signature durable-write endpoints reject embedded data URLs or raw inline file bytes before storage.
- The backend reads S3 bytes from Mango attachments only at provider send time.
- Each pasted screenshot is sent once as an authorized inline/CID attachment, the outbound HTML references the matching `cid:`, and the local send response contains provider-ready HTML plus metadata rather than raw bytes.
- Missing or unauthorized pasted-image references reject the send instead of delivering a broken placeholder.
- Nylas handles user mailbox send/read operations; SES remains only for Mango system email.
- Provider reauth errors surface as mailbox repair states while the Mango session remains valid.

### Scenario EMAIL-S7: Thread Ordering, Collapse, And One Scroll Surface

Business logic covered:
- EMAIL21
- EMAIL22
- EMAIL23
- EMAIL24
- EMAIL31

Given:
- A hydrated email thread contains several messages and the user sends or receives another message.

Expected:
- Cards render newest first, with the newest message expanded and older messages collapsed to headers.
- The new message appears at the top immediately and becomes the sole automatically expanded card.
- Users can expand older cards and see their complete bodies without an internal message scrollbar; the thread pane remains the only vertical scroll surface.
- A short selected message fills the remaining right-hand detail area, while a long HTML message expands to its complete document height and remains fully reachable through that one detail-pane scrollbar.
- A resized reply body restores its saved mailbox-scope height and cannot be squeezed below the minimum.
- Pointer-up inside or outside the resize handle, pointer-cancel, lost capture, and window blur all end resizing; later pointer movement does not change the height.

### Scenario EMAIL-S8: Expand-All, Recipient Metadata, And Image Inspection

Business logic covered:
- EMAIL21
- EMAIL23
- EMAIL30
- EMAIL33

Given:
- A personal, shared, node-attached, or project-attached thread includes several messages, Cc/Bcc metadata, provider attachments, and inline CID screenshots.

Expected:
- `Expand all threads` expands every message/thread group without changing message order.
- To, Cc, and provider-supplied Bcc recipients remain visible for each message.
- Reply all includes every visible reply-to/from, To, and Cc address exactly once and excludes the active mailbox where its identity is known.
- Reopening a saved Reply All draft restores its To/Cc/Bcc addressing without reintroducing the active mailbox or duplicate recipients.
- Selecting an inline screenshot exposes a download action; double-click opens the original image in a full-screen overlay.
- Image and file attachments remain downloadable through authenticated provider/Mango attachment reads.

### Scenario EMAIL-S9: Calendar Invitation RSVP

Business logic covered:
- EMAIL18
- EMAIL20
- EMAIL30
- EMAIL32

Given:
- A connected Google or Microsoft mailbox receives one valid `METHOD:REQUEST` iCalendar message containing exactly one `VEVENT` and UID.

Expected:
- The expanded message displays Accept, Tentative, and Decline.
- Provider attachment metadata may mark the message as a candidate invitation, but Mango resolves `METHOD`, `VEVENT`, and UID from authenticated raw MIME rather than client-supplied provider identifiers.
- Mango finds exactly one non-cancelled provider event and sends `yes`, `maybe`, or `no` through Nylas.
- Missing, cancelled, malformed, unmatched, or ambiguous invitations fail visibly without sending an RSVP.
- Shared Triage RSVP requires edit access to the shared inbox.
- Response controls are disabled while the request is pending, and a selected/saved state appears only after provider success.
- Insufficient calendar scope, expired/revoked grants, and provider failures surface a recoverable reconnect/provider error, leave the user signed in to Mango, and never report or display a saved response.

### Scenario EMAIL-S10: Foreground Detail And Lazy Thread Hydration

Business logic covered:
- EMAIL37
- EMAIL38
- EMAIL39
- EMAIL40
- EMAIL41

Given:
- A personal or shared mailbox page is prefetching, the selected row is unread, and its thread contains several older messages with inline images.

Expected:
- The selected detail request starts before delayed mark-read and speculative prefetch work.
- The selected body becomes readable without waiting for raw MIME, historical message details, or CID downloads.
- Thread preview metadata is bounded, collapsed messages fetch no body or attachment bytes, and expanding one older card hydrates only that card.
- Rapidly selecting another thread removes the prior cards immediately and stale completions do not reinsert them.
