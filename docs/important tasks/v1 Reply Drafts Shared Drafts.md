# V1 Reply Drafts and Shared Drafts

Date: August 17, 2026

Status: Investigation handoff and recommended implementation plan. Node email is still intentionally read-only. This document does not itself change business logic.

## Executive Summary

Mango should add Reply and Reply All inside Nodes through a small Node-specific draft workflow built on the current email, attachment, signature, realtime, and sent-message systems.

The clean design is:

1. Keep My Triage and Shared Triage behavior unchanged.
2. Keep the retained Project reply behavior unchanged while reusing only its editor and presentation pieces.
3. Extend the current `email_drafts` storage with explicit `mailbox_owner`, `node_private`, and `node_shared` scopes.
4. Use exact internal Mango message, thread, Node, mailbox connection, user, and Shared Inbox identities.
5. Let the backend create and resolve draft identity. The frontend must not manufacture deterministic draft IDs or repeat authorization logic.
6. Allow one owner-only private draft per user for one exact Node/source/sender and one shared draft for that exact Node/source/sender.
7. Initially allow shared Node drafts only when the source belongs to an exact Shared Inbox. A Node relationship must never grant permission to send through another user's personal mailbox.
8. Load no drafts when a Node or email opens. Load five draft summaries only when a draft list becomes visible. Load one exact draft only when it opens.
9. Use revision-checked, serialized autosave with explicit conflict handling. Do not silently merge competing full-document snapshots.
10. Keep the ten-second Send Now/Undo experience in the browser, but send through a draft-bound backend command with a durable provider idempotency key and recovery state.
11. Add active Node drafts to the existing email-removal protection used by Node-local textboxes and email-selection chats.
12. Do not restore the deleted collaboration/participant architecture, provider-ID fallbacks, client-only Node drafts, compatibility identities, or dual-write paths.

The current Node frontend looks lazy, but the backend summary read loads the complete thread and blanks bodies and attachments afterward. A true summary-only query is a required prerequisite.

## Why This Document Exists

The investigation began after commit `e7d270e4e367929cf5f426c8c1efdf83dd8e426b` intentionally removed the previous broken Node reply and draft implementation. The investigation was read-only and used this worker identity:

- Worktree: `C:\Users\Jonat\.codex\worktrees\1398\MangoRTSDev`
- Branch: `codex/investigate-simple-node-email-replies-and-drafts0000774`
- Investigation commit created: none

The goal was to determine the smallest clean long-term design for:

- Reply and Reply All inside Nodes;
- one private draft per user;
- one collaborative Node-shared draft where safe;
- exact sender authorization;
- bounded data loading;
- safe concurrent edits;
- exact attachment access;
- ten-second safe send with Send Now;
- idempotency and recovery;
- useful errors;
- removal protection;
- no change to existing Triage behavior.

This file is a handoff, not a substitute for the numbered business-law documents. An implementation must update the relevant laws in `docs/tests/*.md` in the same change.

## Mandatory Reading Before Implementation

An implementing agent must read these files before designing or changing relationships, permissions, attachments, deletion, or draft behavior:

- `AGENTS.md`
- `docs/tests/relationships.md`
- `docs/tests/email.md`
- `docs/tests/email drafts&shared.md`
- `docs/tests/node.md`
- `docs/tests/nodes.md`
- `docs/tests/my-triage.md`
- `docs/tests/shared-triage.md`
- `docs/tests/attachments.md`
- `docs/tests/projects.md`
- `docs/tests/REST API & WebSocket.md`

The current laws explicitly say Node email is read-only. Adding Node replies is an intentional business-logic change, so the implementation must directly revise those laws. Do not leave contradictory old laws in place.

The relationship laws remain mandatory:

- use exact typed internal identities;
- keep source tables authoritative;
- keep relationships company-scoped;
- validate access at every boundary;
- preserve semantic uniqueness;
- make deletion correct through every route;
- do not add a generic resource registry, translated identity, compatibility layer, or untyped edge.

## Current Product State

### Node Email

Node email currently supports:

- collapsed attached thread cards;
- thread summaries;
- opening one exact internal message;
- received attachment metadata and authenticated content;
- highlights and email-selection chats;
- email-to-textbox creation and navigation;
- reveal and focus behavior for linked messages and textboxes;
- realtime stored-thread refresh behavior;
- removal protection when Node-local textboxes or email-selection chats depend on the email.

Node email currently does not support:

- Reply or Reply All;
- private or shared drafts;
- outgoing draft attachments;
- signatures in Node replies;
- scheduling or sending.

The frontend enforces this with `repliesEnabled={false}` in `frontend/src/modules/editor/NodeWorkspaceSurface.tsx`. The shared conversation component clears draft state when replies are disabled.

### Current Node Lazy-Read Problem

The frontend asks for a summary and later asks for one exact message:

- `frontend/src/modules/communications/communicationsApi.ts`
- `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx`
- `backend/internal/http/communications_node_email_thread_handlers.go`

However, `GetCommunicationsNodeEmailThread` in `backend/internal/store/postgres_email_threads.go` calls the full thread loader. The HTTP handler then loops through the messages and removes body and attachment fields when `summary=true`.

That means the response is small but the database and backend work are not truly lazy. The implementation must add a real summary query that does not select message bodies or hydrate attachment metadata. Preserve the public behavior and exact-message endpoint.

### Current Triage Drafts

Current draft routes live in `backend/internal/http/server.go` and `backend/internal/http/communications_email_draft_handlers.go`:

- `GET/POST /v1/communications/drafts`
- `GET/PUT/DELETE /v1/communications/drafts/{draft_id}`
- `GET/PUT /v1/communications/signature`
- generic communications send routes

Storage lives in `backend/internal/store/postgres_email_drafts.go` and `backend/db/schema.sql`.

Current important behavior:

- A draft is mailbox-owner scoped.
- List results omit bodies and attachments, but the list is unbounded and has no cursor.
- Exact GET hydrates the one draft and its source target.
- Exact draft responses load exact attachment metadata.
- Existing active replies are unique by creator, source message, and personal/shared sending scope.
- Mutations are last-write-wins; there is no database revision check.
- The frontend creates deterministic draft IDs and also performs semantic deduplication.
- PUT and DELETE invalidate all draft-list caches for the company.
- Triage has local-first recovery and serialized remote mutation logic.
- Triage does not have normal keystroke/debounced autosave. It saves on explicit Save, close, navigation, attachment preparation, scheduling, and send preparation.
- Draft realtime is intentionally absent, so another tab can retain a stale draft list.

Do not change any of this as part of the Node feature. Node drafts need their own API and state path.

### Current Project Reply

Project replies reuse the shared email conversation/editor components. There is no Project-specific draft backend. Project currently uses the mailbox-owner draft and generic send APIs.

Reusable Project pieces:

- conversation and reply presentation;
- unified rich-text editor;
- attachment toolbar and previews;
- signature presentation;
- ten-second safe-send banner.

Do not copy Project's orchestration:

- It constructs deterministic draft IDs in the frontend.
- It loads a full thread rather than a true summary.
- Its 500 ms autosave is not serialized or revision-checked.
- A slower older save can finish after a newer save.
- Successful send deletes the draft with a fire-and-forget request.
- A failed cleanup request is swallowed after local state is cleared.
- It sends through the generic endpoint with no draft revision or durable idempotency binding.

### Existing Ten-Second Safe Send

`frontend/src/modules/communications/outboundEmailUndo.ts` provides the current ten-second timer. It is browser memory only:

- Send schedules a ten-second delay.
- Send Now dispatches immediately.
- Undo cancels before a backend send request.
- Closing or refreshing before dispatch safely cancels the unsent action.
- The current backend send is not idempotent and is not bound to a draft.

The visual/controller behavior is reusable. The backend operation is not sufficient for Node drafts.

## What Was Removed and Must Not Return

The August 16 migration `backend/db/migrations/20260816_remove_node_email_drafts.sql` removed the previous Node implementation and permanently deleted its Node-scoped draft rows.

The removed model included or depended on:

- collaboration IDs;
- collaboration participant concepts;
- relationship-derived draft identity;
- Node/thread copies on mailbox drafts;
- `is_shared` compatibility behavior;
- frontend compatibility identities;
- old send-claim and completion paths tied to that architecture.

Do not restore:

- `collaboration_id` as draft identity;
- participant rows for Node email drafts;
- generic or surrogate resource identities;
- provider message/thread IDs as durable Mango identity;
- local browser fallback for Node-shared drafts;
- dual reads or writes to obsolete paths;
- migration logic that attempts to reconstruct deleted Node draft contents.

Some removed safety ideas were valid and can return narrowly: revisions, an exact send claim, one provider idempotency key, lease recovery, exact grant binding, attachment promotion, and exact completion. They must be implemented against the new direct Node/source identity rather than the old collaboration model.

## Recommended Reuse and Separation

### Reuse

- `email_connections`, `email_threads`, and `email_messages` as the canonical mailbox data.
- Exact internal `email_message_id` as the only reply source identity.
- `email_relationships` for stored-message visibility on a Node.
- `email_drafts` as the one draft table.
- `attachment_relationships` with `resource_type='email_draft'` as the only outgoing draft attachment owner.
- Current received-email attachment authorization and lazy content reads.
- Unified rich-text editor and email renderer.
- Existing signature storage and provider-safe HTML/reference handling.
- Nylas request admission/gating and existing provider error mapping.
- Sent-message normalization and persistence.
- Sent attachment promotion from `email_draft` to `email_message`.
- Existing realtime outbox infrastructure, with a new narrow Node-draft event scope.
- Current Send Now/Undo UI.

### Keep Separate

- Triage draft lists, caches, local storage, generation counters, retry behavior, and endpoints.
- Shared Triage behavior and mailbox ownership.
- Project's current mailbox-owner draft behavior.
- Node draft identity and Node draft list state.
- Node permission checks versus mailbox sender checks.
- Private owner access versus Node-shared access.
- Message visibility relationships versus draft ownership.
- Draft attachments versus final sent-message attachments.
- Signature ownership versus Node ownership.

## Recommended Data Model

Keep one `email_drafts` table. Add only the fields needed to express direct Node scope, concurrency, and send recovery.

### Draft Scope

Add a checked scope such as:

- `mailbox_owner`: every current Triage/Shared Triage/Project row;
- `node_private`: one Node-local owner-only draft;
- `node_shared`: one Node-local collaborative draft.

Backfill current rows as `mailbox_owner`. Their behavior and current uniqueness must remain unchanged.

### Direct Identity Fields

A Node draft needs:

- `company_id`;
- stable server-generated `draft_id`;
- exact typed `node_id`;
- exact internal `source_email_message_id`;
- exact immutable sender `email_connection_id`;
- exact personal user or Shared Inbox authorization scope;
- immutable creator/owner for a private draft;
- draft kind `reply`;
- recipients, subject, body, and existing draft timestamps;
- positive `revision`;
- deletion timestamp;
- narrow send state and recovery fields.

Use same-company foreign keys. Prefer `RESTRICT` for Node and source-message deletion so all cleanup must pass through the supported attachment-safe path.

The sender connection must equal the source message's thread connection. The server validates this at creation and every important command boundary. A writable From value must not be accepted from the browser.

### Semantic Uniqueness

For active private drafts:

```text
company + node + source internal message + sender connection + owner user
```

For active shared drafts:

```text
company + node + source internal message + sender connection
```

Create partial unique indexes for live rows in the applicable scope. Use a transaction and `INSERT ... ON CONFLICT ... RETURNING` so concurrent creators receive the same semantic draft.

`draft_id` is the stable storage and attachment identity. The frontend never calculates it. Reply versus Reply All is not part of identity.

### Reply Versus Reply All

Recommended rule: one draft exists per semantic identity regardless of whether the user first clicked Reply or Reply All.

The first creation initializes recipients:

- Reply uses source Reply-To, otherwise source From.
- Reply All includes that target plus source To and Cc.
- Remove the actual sending account.
- Deduplicate case-insensitively.
- Never copy Bcc.

If the draft already exists, clicking either action reopens it and does not reset user-edited recipients. If product wants an explicit "change to Reply All recipients" action, it should show the additions and require confirmation rather than silently replacing the recipient list.

## Sender and Permission Rules

Message visibility and send authority are independent.

A user may be allowed to read an attached email through a Node while having no right to use the mailbox connection that ingested it. Node access must never grant a Nylas grant, a Shared Inbox permission, or access to another user's personal signature.

### Recommended Personal-Source Rule

- The exact personal mailbox owner may create one private Node draft.
- Other Node users cannot create, edit, attach files to, or send from that personal source.
- No Node-shared draft is allowed for a personal sender in V1.

Allowing collaborators to draft for a personal sender would require an explicit product rule for sender consent, visibility, signature access, handoff, and final send authority. Do not infer that rule.

### Recommended Shared-Inbox Rule

- A user must have Node Edit and exact Shared Inbox Edit to create a private or shared draft.
- A private draft remains visible only to its creator.
- One shared draft exists for the exact Node/source/sender.
- Shared draft reads, edits, outgoing attachment access, and sends require current Node Edit plus current access to the exact Shared Inbox.
- The backend rechecks both permissions and the connection status at send time.
- Revocation takes effect immediately.

The actual sender account is fixed and displayed read-only. Do not offer a free-text From picker.

### Shared Inbox Provenance Risk

Current Node and Project projections may find a Shared Inbox by ordering matching Shared Inbox rows and taking the first one. More than one Shared Inbox record can point to the same email connection. That is not a safe authorization or signature choice.

V1 must bind an exact Shared Inbox scope to the draft and verify that it maps to the source thread's exact connection. If the mapping is ambiguous, fail closed with a specific error until the user or data contract resolves it.

## Recommended API

Keep Node drafts off the current communications draft routes.

### Create or Reopen

```http
POST /v1/nodes/{node_id}/email-drafts
```

Request:

```json
{
  "source_email_message_id": "internal Mango UUID",
  "visibility": "private or shared",
  "reply_mode": "reply or reply_all",
  "shared_inbox_id": "required only for an exact shared scope"
}
```

The server:

1. Authenticates the actor and company.
2. Requires Node Edit.
3. Proves the exact internal message exists.
4. Proves its thread is attached to this exact Node.
5. Derives and authorizes the sender connection.
6. Enforces the private/shared rules.
7. Creates or returns the one semantic draft.
8. Initializes subject, recipients, body, and exact sender signature only on first creation.

The response includes the server draft ID, revision, actual From display, visibility, and server-computed capabilities.

### List Five Summaries

```http
GET /v1/nodes/{node_id}/email-drafts?cursor={cursor}
```

- Fixed page size of five.
- Called only while a draft list/drawer is visible.
- Returns summaries only: no body, received attachment list, draft attachment list, signature bytes, or source body.
- Order by `updated_timestamp DESC, draft_id ASC`.
- Fetch six rows, return five, and issue a cursor only when the sixth exists.
- Cursor predicate must handle equal timestamps with the draft ID tie-breaker.

### Exact Draft

```http
GET /v1/nodes/{node_id}/email-drafts/{draft_id}
```

Return one authorized draft, its exact draft attachment metadata, and only the small source summary needed by the composer. Do not hydrate by provider ID and do not load the complete thread.

### Save

```http
PATCH /v1/nodes/{node_id}/email-drafts/{draft_id}
```

Require `expected_revision`. Update only when the row is live, still editable, and has that revision. Increment the revision. Do not list attachments or invalidate every company draft list in the response path.

### Discard

```http
DELETE /v1/nodes/{node_id}/email-drafts/{draft_id}
```

Require the expected revision. Soft-delete the draft and atomically retire its exact `email_draft` attachment relationships. Mark newly ownerless attachments for the existing cleanup service.

### Send

```http
POST /v1/nodes/{node_id}/email-drafts/{draft_id}/send
```

Require the expected revision. The client must not send a free-form company, sender, arbitrary attachment list, or provider source identity. The server derives all of them from the authorized exact draft.

## Frontend State and Loading

Keep existing Node email viewing and navigation intact.

Recommended state shape:

```text
mode: none | private | node_shared
visible summary page(s): at most five per page
active draft: at most one exact hydrated draft
active draft key: company + node + thread + source message + visibility + draft ID
local editor state
last acknowledged revision
one in-flight save
one coalesced newest pending save
optional remote-conflict revision
```

### Loading Rules

- Opening a Node: zero draft calls.
- Expanding an email thread: summary columns only.
- Opening one message: one exact-message read and its exact received attachment metadata.
- Clicking Reply/Reply All: create-or-get one exact draft.
- Opening Drafts: one five-summary page.
- Opening a draft summary: one exact draft read.
- Typing: no thread, list, source-body, or attachment read.
- Draft realtime event: no thread reload and no full-list reload.
- Successful send: refresh only the affected exact stored-thread summary or apply the durable sent-message result.

### Autosave

Use a short debounce, such as 500 ms, but serialize saves per draft:

1. Let one request run.
2. While it runs, keep only the newest complete editor state.
3. When it returns, update the acknowledged revision.
4. If newer local state exists, issue one next save against the new revision.
5. Never run two unordered saves for one draft.

Every save must use the expected revision. A stale save returns a conflict rather than overwriting remote work.

### Conflict Behavior

V1 should use optimistic concurrency, not a CRDT, operational transform, or automatic HTML merge.

On conflict:

- preserve the local unsaved text in memory;
- show that the draft changed elsewhere;
- offer to reload the shared version;
- offer to copy or preserve the user's local version;
- do not silently merge;
- do not silently overwrite;
- do not issue another save until the user resolves the conflict.

This applies to two tabs editing one private draft and multiple users editing one shared draft.

## Realtime Design

Current draft CRUD does not emit a realtime outbox event. The existing realtime outbox can be reused, but Node drafts need a narrow event scope. Do not send draft content through the chat scope or mailbox-list scope.

An event should contain only:

- company ID;
- Node ID;
- draft ID;
- source message ID;
- visibility;
- action: created, updated, deleted, sending, sent, or failed;
- revision;
- updater identity suitable for UI display;
- optional origin client ID for self-event suppression.

Private events are restricted to the owner. Shared events are delivered only to currently authorized Node/shared-mailbox users.

When events arrive:

- update a visible summary row if enough metadata is present;
- otherwise invalidate only the visible Node draft page;
- if the exact draft is open and clean, coalesce a burst and fetch that one draft once;
- if the exact draft is dirty, mark a conflict instead of fetching over it;
- never reload a thread because somebody typed in a draft;
- never include body HTML, attachment bytes, signed URLs, credentials, or provider secrets.

## Attachments and Signatures

### Received Attachments

Received message attachments remain owned by `email_message` and use the current exact Node/thread/message authorization path. Collapsed messages must not read attachment bytes.

### Outgoing Draft Attachments

Outgoing files use the stable server draft ID with `resource_type='email_draft'`.

- The exact draft must exist and be live before upload or link.
- Private attachment access requires the exact owner and Node/sender authorization.
- Shared attachment access requires the same Node and Shared Inbox rules as the draft.
- Draft deletion immediately revokes draft-only links.
- An independently promoted sent-message link survives draft retirement.
- Send resolves attachment IDs from the exact draft on the server; the browser cannot inject another resource's IDs.
- Preserve the exact 24,000,000-byte outbound aggregate limit and lazy S3 streaming.
- Batch attachment metadata reads or cap the count so send does not become one query per attachment.

### Existing Authorization Contradiction

`docs/tests/attachments.md` ATT44 says that another Shared Inbox editor cannot access a user's mailbox-owned draft attachments. `backend/internal/http/email_draft_attachment_scope_test.go` currently expects Shared Inbox editors to access a shared draft's attachments, and `backend/internal/store/email_attachment_access.go` follows that broader rule.

Do not make Node behavior depend on this ambiguity. Add explicit `node_private` and `node_shared` authorization branches and intentionally settle the existing mailbox-owner law/test disagreement separately.

### Signatures

Signatures stay owned by the exact personal mailbox or Shared Inbox. A Node does not own a signature.

The server applies the actual sender's current signature only when it creates a brand-new draft. Reopening or autosaving never reapplies it. Signature attachment references remain private and are authorized through the exact sender scope during preview and send.

## Safe Send, Idempotency, and Recovery

### Ten-Second Boundary

The smallest contract keeps the countdown in the browser:

```text
user clicks Send
-> ten-second local countdown
-> Undo: no backend send request
-> Send Now or timer expiry: exact draft send command
```

Closing or refreshing before dispatch safely cancels the unsent action. If product later requires send to survive tab close, Mango needs a durable `send_not_before` queue and cancel endpoint. That is a larger feature and is not recommended for V1.

### Send Claim

The backend must transactionally:

1. Lock the exact draft.
2. Recheck Node, draft, sender, company, connection, and grant authorization.
3. Confirm the expected revision.
4. Validate recipients and body/reference content.
5. Freeze the payload and attachment set.
6. Create or reuse one send attempt for that draft revision.
7. Persist one provider idempotency key and exact connection/grant binding.
8. Mark the revision as sending.
9. Commit before calling the provider.

Send Now and timer expiry may race, but both converge on the same database claim. The frontend does not own provider identity logic.

### Provider Call

Reuse the existing Nylas gate, error mapping, provider-safe body handling, attachment streaming, and current sent-message normalization.

Nylas currently documents `Idempotency-Key` for send requests:

- maximum length 256 characters;
- scoped per grant;
- retained for one hour;
- the same key and payload can safely retry;
- a different payload for the same key can return 409;
- concurrent use can return 409.

Official reference: https://developer.nylas.com/docs/v3/email/idempotent-send/

### Completion

After provider success, one database transaction must:

1. Persist or converge the exact normalized sent message.
2. Store provider message/thread identity as provenance.
3. Create idempotent `email_message` attachment relationships.
4. Preserve Node/project visibility propagation required by current sent-message behavior.
5. Retire the draft's attachment relationships.
6. Mark the draft sent/retired.
7. Store the resulting internal sent-message ID.
8. Enqueue the compact realtime event.

Do not fire-and-forget draft deletion after clearing the UI.

### Failure Rules

- Validation/auth failure before provider contact: release the claim and keep the draft editable.
- Definite provider rejection: keep the draft and return the mapped error.
- Connection reauthentication required: keep the draft and do not switch senders.
- Network or provider outcome unknown: keep the frozen attempt and retry only with the same provider key.
- Provider accepted but local persistence failed: retry the same key, receive the same provider result, and complete local persistence.
- Claim worker crash: a recovery path may reacquire the expired claim but must reuse the same attempt/key.
- Idempotency payload mismatch: stop with a conflict; never create a new key automatically.
- Unknown outcome after the provider's idempotency window: mark `email_send_outcome_unknown` and require reconciliation instead of risking a duplicate.

## Recommended Error Codes

Use stable, specific codes with no cross-company or cross-user information leak:

- `node_email_reply_source_not_found`
- `node_email_reply_source_not_attached`
- `node_email_sender_not_authorized`
- `node_email_sender_scope_ambiguous`
- `node_email_draft_not_found`
- `node_email_draft_access_denied` when safe to distinguish
- `node_email_draft_revision_conflict`
- `node_email_draft_send_in_progress`
- `email_connection_reauth_required`
- `email_send_idempotency_conflict`
- `email_send_outcome_unknown`
- existing `email_removal_has_node_work`
- existing recipient/content validation codes
- existing `attachment_content_not_found`
- existing `attachment_storage_unavailable`
- existing `attachment_content_length_mismatch`
- existing `attachment_storage_failed`

Prefer 404 for unauthorized identifier probing, 409 for revision/send/idempotency conflicts, and a retryable service error for temporary provider/storage availability.

## Removal, Deletion, and Recycle Rules

### Removing an Email From a Node

Current `backend/internal/store/postgres_nodes.go` blocks removal when the exact Node/thread has a textbox relationship or an email-selection chat. Extend that same transactional protection to active Node drafts.

Removal is blocked when any of these depend on the Node email:

- a Node-local textbox relationship;
- an active Node email-selection chat;
- an active `node_private` draft for that Node/thread;
- an active `node_shared` draft for that Node/thread;
- an unresolved send attempt for one of those drafts.

Return `email_removal_has_node_work`. The user must discard or resolve the draft before unlinking the email.

### Deleting or Recycling a Node

Recommended rule:

- recycle Node-scoped drafts with the Node;
- do not promote them into Triage;
- permanent deletion locks and retires Node drafts;
- retire exact draft attachment links and mark newly ownerless attachments;
- remove exact Node email relationships;
- then delete the Node/projections;
- mailbox-owner Triage/Project drafts survive merely because the source thread appeared on that Node.

Whole-Node deletion needs an audit. `backend/internal/store/postgres_company_explorer.go` retires several Node-owned resources, but the investigation did not prove that every typed Node `email_relationships` row is removed. Those relationships do not have a direct Node foreign key. Add a focused deletion test before relying on the current path.

### Source and Sender Deletion

- Active Node drafts should restrict hard deletion of their exact source message/thread until the draft cleanup path runs.
- A disconnected sender keeps its draft but cannot send.
- Never silently move a draft to another mailbox or grant.
- Permission revocation immediately removes draft and attachment access.
- If provider contact already began before revocation, completion must still record the actual external outcome.

## Migration Rules

Create one new PostgreSQL-17-compatible forward migration after `20260816_remove_node_email_drafts.sql`.

The migration must:

1. Report the PostgreSQL server version and stop on unsupported versions.
2. Add the explicit scope and Node/concurrency/send fields.
3. Backfill current rows as `mailbox_owner` with revision 1 and draft state.
4. Preserve current Triage/Project uniqueness through scope-specific partial indexes.
5. Add private and shared Node semantic unique indexes.
6. Add matching five-item keyset-pagination indexes.
7. Add same-company typed foreign keys and checks.
8. Stop on duplicate semantic keys, invalid source links, ambiguous sender mappings, or orphan draft attachment relationships.
9. Avoid using physical column order as drift detection.
10. Compare exact unordered column-name sets and exact counts when validating schema.

Do not:

- edit the historical removal migration;
- resurrect deleted Node draft rows;
- infer contents from provider data;
- add compatibility views;
- add old identity columns;
- apply the migration to a live database from an agent session.

## Current Risks and Known Gaps

An implementing agent should account for these findings rather than copying current behavior blindly:

1. Node summary reads currently hydrate the full thread before stripping body/attachment fields.
2. Current draft lists are unbounded.
3. Current draft updates are last-write-wins.
4. The frontend and backend both participate in draft identity/deduplication.
5. Existing upsert can change `source_email_message_id`; a reply source should be immutable.
6. `sender_account_email` is stored but generic send is not bound to the same connection later.
7. A Reply-To request field exists in current code but is not durably used as the source contract.
8. Recipient generation is frontend-only and has differed from deleted backend Reply All behavior.
9. Current attachment authorization for Shared Inbox drafts conflicts with the owner-only written law.
10. Generic send has no draft ID, expected revision, or durable idempotency claim.
11. The current Nylas client supports an idempotency header, but the generic handler does not use it for draft send.
12. Provider success followed by database failure can produce a 500 and a duplicate on retry.
13. Project autosave can finish out of order.
14. Project post-send draft deletion is fire-and-forget.
15. Current Node/Project Shared Inbox provenance may choose the first matching inbox arbitrarily.
16. Node draft CRUD has no dedicated realtime scope.
17. Project exact-message read loads the whole thread and loops over it.
18. Linked-email preview resolution can probe attached threads sequentially to find one message.
19. Whole-Node deletion may leave typed email relationships unless every caller/path is proven.
20. Current schema cannot distinguish a Project reply from a Triage reply for the same creator/source/mailbox, so those surfaces can resolve the same mailbox-owner row. Do not change this while adding Node-specific rows.

## Implementation Phases

Follow the repository's layered-growth rule. Each phase must end in a working product slice.

### Phase 1: Complete Private Reply Slice

- Replace Node's false-summary backend read with a real summary query.
- Add scope, direct identity, revision, and send recovery storage.
- Add server-created private draft identity.
- Add exact create/reopen, get, autosave, discard, attachments, signature, and sender capability.
- Add complete draft-bound idempotent safe send.
- Add Reply and Reply All UI for authorized personal/shared senders.
- Preserve all existing Node viewer, chat, textbox, highlight, and navigation behavior.
- Keep Triage/Project behavior unchanged.

Do not release a private draft slice that saves but cannot safely send end to end.

### Phase 2: Node-Shared Draft Layer

- Add shared-inbox-only Node-shared identity.
- Add five-summary pagination.
- Add exact shared authorization and attachment rules.
- Add revision conflict UI.
- Add compact targeted realtime invalidation with burst coalescing.
- Add permission-revocation and two-user tests.

### Phase 3: Deletion and Production Hardening

- Extend email-removal protection.
- Audit whole-Node recycle/permanent deletion.
- Add migration preflights and rollout checks.
- Add query budgets and production-shaped plans.
- Add failure injection around every send boundary.
- Update every affected numbered business-law document.
- Run the full repository verification gate before merge.

## Required Automated Tests

### Identity and Storage

- Two concurrent private creates converge on one row.
- Two concurrent shared creates converge on one row.
- One private draft per user per exact Node/source/sender.
- One shared draft per exact Node/source/sender.
- Different Nodes do not share Node-local drafts.
- Reply and Reply All reopen the same semantic draft.
- Triage and Project mailbox-owner rows remain unchanged.
- Cross-company and cross-source identifiers fail closed.
- Source identity cannot change during update.

### Authorization

- Personal owner can create/edit/send private draft.
- Another Node editor cannot use the personal mailbox.
- Shared Inbox editor plus Node editor can use the exact shared sender.
- Missing Node Edit fails.
- Missing/revoked Shared Inbox Edit fails immediately.
- Company manager/admin is not an automatic private-draft owner.
- Ambiguous Shared Inbox mapping fails closed.
- Sender disconnect/reauth keeps draft but blocks send.

### Reply Recipients and Signature

- Reply-To wins over From.
- Reply All includes To/Cc.
- Actual sender is removed.
- Case-insensitive duplicates collapse.
- Bcc is never copied.
- Existing draft recipients are not reset on reopen.
- Signature applies once on first creation.
- Reopen and autosave do not duplicate the signature.
- Signature images remain exact authenticated references.

### Lazy Loading and Query Budgets

- Opening a Node makes zero draft calls.
- Collapsed thread loads no message body or attachment metadata.
- Thread summary SQL does not select body columns.
- Opening one message loads one exact body and exact received attachment metadata.
- Draft list returns exactly five summaries and no body/attachment data.
- Equal-timestamp cursor boundaries do not skip or duplicate drafts.
- Exact draft GET loads one draft and one attachment set.
- Autosave performs one conditional update plus compact outbox work, not list/thread/attachment reads.
- Typing never reloads a thread.
- A realtime burst causes at most one coalesced exact fetch.
- Attachment send metadata is batched or explicitly bounded.

### Concurrency

- Two tabs editing one private draft receive a revision conflict.
- Two users editing one shared draft receive a revision conflict.
- A slower older save cannot overwrite a newer save.
- Local unsaved content remains recoverable after conflict.
- Delete conflicts with an in-flight save safely.
- Edits/deletion are blocked while the exact revision is sending.

### Attachments

- Private owner-only access.
- Shared exact Node/Shared Inbox access.
- Permission revocation blocks content immediately.
- Cross-draft attachment ID fails.
- Delete during upload/mutation lease is safe.
- Exactly 24,000,000 bytes succeeds; one byte over fails.
- Send promotes links before draft retirement.
- Draft-only content becomes unreadable after discard.
- Independently sent-message-owned content survives.
- Storage not-found, unavailable, short, long, and opaque failure codes remain exact.

### Safe Send and Recovery

- Undo sends nothing.
- Timer expiry sends once.
- Send Now sends once.
- Send Now/timer race sends once.
- Duplicate HTTP calls converge on one claim.
- Provider concurrent/idempotency conflict is handled.
- Definite rejection keeps draft.
- Provider timeout retries the same key.
- Provider success plus database failure completes through the same key.
- Server crash after claim recovers the same attempt.
- Server crash after provider acceptance does not create a second attempt.
- Payload mismatch never gets a fresh automatic key.
- Expired unresolved provider window becomes `email_send_outcome_unknown`.
- Success creates the exact sent message, promotes attachments, retires the draft, and emits one event.

### Removal and Regression

- Existing textbox dependency blocks Node email removal.
- Existing email-selection chat blocks removal.
- Active private draft blocks removal.
- Active shared draft blocks removal.
- Unresolved send attempt blocks removal.
- Discarding the final Node work unblocks removal.
- Node recycle/purge handles drafts and attachment links exactly once.
- Triage/Project drafts survive unrelated Node deletion.
- My Triage regression suite passes unchanged.
- Shared Triage regression suite passes unchanged.
- Project reply regression suite passes unchanged.
- Node viewing, received attachments, highlights, chats, textbox linking, and navigation regressions pass.

## Production-Scale Checks

Before rollout, measure and inspect:

- active and soft-deleted draft counts by scope;
- duplicate current semantic identities;
- source-message and sender-connection join failures;
- multiple Shared Inbox records per connection;
- orphan `email_draft` attachment relationships;
- dangling Node `email_relationships` rows;
- body and recipient size distribution;
- attachments per draft and total outbound bytes;
- stale send claims and unknown attempts;
- realtime outbox volume and backlog;
- exact keyset-list query plans on the largest tenant;
- exact Node summary and message query plans;
- lock duration during create, save, send claim, discard, and Node deletion;
- index build size and rollout duration;
- provider idempotency duration and grant scope;
- logs and metrics for failures without logging bodies, recipients, filenames, storage keys, tokens, signed URLs, or secrets.

Expected request/query behavior:

- Node open: no draft query.
- Thread summary: one bounded metadata query, no bodies or attachment metadata.
- Exact message: one exact message query plus one exact attachment metadata query.
- Visible draft list: one limit-six keyset query returning five.
- Exact draft: one exact draft/source query plus one attachment metadata query.
- Autosave: one conditional update and one outbox insert in the transaction.
- Realtime burst: one coalesced exact draft read at most.
- Send: bounded claim reads, batched attachment metadata, provider streaming, then one exact completion transaction.

## Decisions Jonat Must Make Before Shared-Draft Implementation

The investigation recommends defaults, but these are product decisions and must not be guessed if Jonat chooses differently.

1. Can a Node-shared draft use a personal sender?
   - Recommended: no; Shared Inbox source only.
2. Are Reply and Reply All separate drafts?
   - Recommended: no; one draft, first action initializes recipients.
3. Who can see a Node-shared draft?
   - Recommended: require Node Edit plus exact Shared Inbox access for all operations.
4. Must ten-second send survive tab close or refresh?
   - Recommended: no; closing before backend dispatch safely cancels it.
5. Do private Node drafts appear in Triage?
   - Recommended: no; keep them Node-local so Triage is unchanged.
6. What happens when the Node is recycled?
   - Recommended: recycle drafts with the Node; permanently retire them only on purge.
7. What identifies the Shared Inbox when several records use one connection?
   - Recommended: bind one exact scope and fail closed while ambiguous.
8. Can Node View read shared drafts while Node Edit is required for mutation?
   - Recommended: Edit-only throughout for V1 because drafts can contain unsent sensitive content.
9. Does V1 include scheduled send?
   - Recommended: no; only Reply, Reply All, ten-second safe send, and Send Now.
10. Does "collaborative" require live character-level co-editing?
    - Recommended: no; revision conflicts and explicit reload/copy choices are the simplest reliable V1.

## Definition of Done

V1 is done only when all of these are true:

1. Node email remains lazy at the database, API, and frontend layers.
2. Existing viewing, received attachments, highlights, chats, textbox relationships, and navigation still work.
3. Only exact ingested Mango messages can be reply sources.
4. The actual sender is fixed, server-derived, and authorized.
5. Private drafts are owner-only.
6. One safe shared draft exists only where the sender policy allows it.
7. Draft identity and recipient initialization are backend-owned.
8. Autosave is serialized and revision-checked.
9. Realtime never reloads whole threads or all drafts.
10. Attachments follow exact typed authorization and survive send correctly.
11. Ten-second safe send, Send Now, idempotency, cleanup, and ambiguous-result recovery are complete.
12. Node email removal is blocked by active Node-local drafts.
13. Migration is forward-only, PostgreSQL-17-compatible, and has no legacy fallback.
14. My Triage and Shared Triage behavior is unchanged.
15. All affected business-law documents are updated as short strict numbered laws.
16. Full repository verification passes on the completed merged implementation.

## Final Direction for the Next Agent

Start with the smallest private end-to-end slice. Do not begin by rebuilding collaborative infrastructure. First make Node thread summaries truly lazy, add direct typed draft identity, let the backend initialize and version one private draft, and complete the entire idempotent send lifecycle. Only after that works should the shared-inbox collaboration layer be added.

When implementing, delete obsolete assumptions instead of adapting them. Do not copy Project's unsafe autosave/send cleanup. Do not route Node drafts through Triage. Do not let the frontend choose identity or sender authority. Do not add a central registry or compatibility path. Keep every read, write, event, attachment, and deletion tied to the exact company, Node, internal message, draft, user, and sender scope.
