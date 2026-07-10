Last updated: 2026-07-09

# Email Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (`tests/frontend/pages/home/homeCommands.test.ts` covers send payload construction and Mango attachment references; `tests/frontend/modules/editor/richTextEditing.test.ts` covers rich email HTML serialization, spacing, indentation, lists, links, and safe sanitization; backend communications and attachment handler tests cover provider send boundaries, S3 attachment resolution, and email draft attachment authorization. Draft/signature persistence endpoint coverage should be expanded with focused backend HTTP tests.)

## Business Logic

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
EMAIL13 - Durable email draft/signature/send payloads must not store raw base64 attachment content or data URLs.
EMAIL14 - Sending a Mango-authored email must serialize the editor body into professional HTML that preserves line breaks, blank lines, spacing, bullets, numbered lists, links, and indentation. Fonts are intentionally ignored until multiple fonts exist.
EMAIL15 - Legacy plain text drafts/signatures must still send safely as escaped/linkified HTML.
EMAIL16 - Scheduled sends are saved as durable drafts with a due timestamp, but V1 scheduled execution remains browser-driven while the app is open.
EMAIL17 - Successful sends delete the corresponding durable draft only after the provider send succeeds.
EMAIL18 - Nylas is the mailbox read/send provider boundary; Mango owns draft/signature persistence and attachment references.
EMAIL19 - SES remains for auth/invitation/system email and must not be confused with user mailbox draft/send behavior.
EMAIL20 - Provider reauthorization problems must be recoverable mailbox errors, not Mango logout/session failures.

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

Given:
- A signed-in user opens My Triage compose or reply with a connected personal mailbox.
- The user enters recipients, subject, body, or attachments and saves/closes the compose window.

Expected:
- Mango writes or updates a `communications_email_drafts` row scoped to the user's personal email connection.
- The browser may keep a local mirror, but reload uses the database row when available.
- Reopening Drafts shows the same draft on another browser session after backend sync.
- A different non-manager user cannot see or edit the personal draft.

### Scenario EMAIL-S2: Shared Draft Durability

Business logic covered:
- EMAIL1
- EMAIL4
- EMAIL5
- EMAIL6
- EMAIL10
- EMAIL12

Given:
- A user with edit access composes from a Shared Triage inbox with an assigned shared mailbox.

Expected:
- Mango saves the draft against `shared_inbox_id`.
- Users with Shared Triage view access can see the draft; users with edit access can mutate it.
- Attachments link to the draft through `resource_attachments` and remain permission-gated by the shared inbox.

### Scenario EMAIL-S3: Reply And Forward Resume

Business logic covered:
- EMAIL7
- EMAIL8
- EMAIL9
- EMAIL17

Given:
- A user replies to or forwards a provider message, closes compose, and later clicks Reply or Forward on the same source message in the same mailbox scope.

Expected:
- Mango resumes the existing stable draft ID instead of creating a duplicate.
- Reply context is restored so the original message being answered is visible.
- After a successful send, Mango deletes the saved draft.

### Scenario EMAIL-S4: Signature Persistence

Business logic covered:
- EMAIL2
- EMAIL3
- EMAIL4
- EMAIL5
- EMAIL6
- EMAIL11

Given:
- A user saves an email signature for their personal mailbox or for a shared inbox they can edit.

Expected:
- Mango saves the signature in `communications_email_signatures` for exactly one scope.
- Loading compose uses the database signature when available and localStorage only as fallback/migration.
- Future logo/image attachments for signatures use `email_signature` resource attachments.

### Scenario EMAIL-S5: Professional Email Rendering

Business logic covered:
- EMAIL14
- EMAIL15

Given:
- A draft or signature body contains rich editor content with paragraphs, blank lines, indentation, bullets, numbered lists, and links.

Expected:
- Sending uses the shared email HTML serializer, not raw draft text.
- The resulting HTML preserves spacing, line breaks, list structure, links, and indentation.
- Fonts are not part of this contract until Mango supports more than one email font.

### Scenario EMAIL-S6: Attachments And Provider Boundary

Business logic covered:
- EMAIL12
- EMAIL13
- EMAIL18
- EMAIL19
- EMAIL20

Given:
- A draft has normal file attachments and is sent through personal or shared mailbox scope.

Expected:
- The browser stores attachment IDs/references, not file bytes, in durable draft/send state.
- The backend reads S3 bytes from Mango attachments only at provider send time.
- Nylas handles user mailbox send/read operations; SES remains only for Mango system email.
- Provider reauth errors surface as mailbox repair states while the Mango session remains valid.
