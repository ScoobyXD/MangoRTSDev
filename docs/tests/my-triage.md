Last updated: 2026-07-14

# My Triage Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (store-level conversion and transfer coverage exists; `tests/frontend/pages/home/homeMailboxRealtime.test.ts` covers exact personal/shared targets, first/reconnect acceptance, event mapping, coalescing, queued-final work, and obsolete-navigation cancellation; `tests/frontend/pages/home/homeMailDrafts.test.ts` covers the draft retention/purge matrix, scope generations/revisions, out-of-order loads, edits/deletes during load, multiple personal accounts, and durable draft preparation before attachment upload. Unified-editor, send-time attachment, draft API, body-marking, and cache tests cover the remaining named paths; rule IDs are not fully mapped to automated tests yet.)

- Automatic personal signature insertion, rich-body deduplication, compose-scope wiring, unified signature mounting, exact flush behavior, and stale-load/save ordering are covered by `tests/frontend/pages/home/homeCommands.test.ts` and `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts`.

## Business Logic

MT1 - My Triage is the current user's personal email triage queue and must not show another user's private triage items.
MT2 - Adding a message to My Triage requires a connected personal mailbox message ID that can be read from the user's email connection.
MT3 - Batch triage adds must clean blank message IDs, dedupe repeated IDs, and process no more than 50 messages in one request.
MT4 - Adding the same user/message pair again refreshes the stored message snapshot instead of creating a duplicate triage row.
MT5 - Removing a My Triage item only removes the current user's row for that message.
MT6 - Converting triage messages requires a company, at least one triage message, and a valid conversion target.
MT7 - Conversion must read or refresh the latest mailbox message snapshot before creating workspace records from the email.
MT8 - If the conversion mode is not explicit, the target mode is inferred from the provided node, logic gate, project, or new gate header fields; folder or parent entity fields do not make Company Explorer folder conversion valid.
MT9 - Converting into an existing logic gate requires edit access to that logic gate.
MT10 - Converting into an existing node requires edit access to the node and edit access to any provided logic gate context.
MT11 - Converting into a new logic gate requires a header/title and creates the logic gate, board/card records, and email-derived work item records together.
MT12 - Converting into a Company Explorer folder or parent entity is invalid for email-derived node creation; conversion into a project may create email-derived standalone node records and project relationship/projection records.
MT13 - Folder conversion targets, including legacy folder IDs and Company Explorer V2 parent entities, are rejected before node creation and must not create `company_explorer_items`, Explorer V2 rows, or folder item placements.
MT14 - Converting into a project requires project edit access and creates the project relationship/projection records needed for the new work item; if the target also carries a Logic Gate ID, the new node is assigned to that Logic Gate and related to the project.
MT15 - Conversion defaults the status to Pending and priority to 3 when those values are not provided.
MT16 - Explicit conversion priority must be between 1 and 5.
MT17 - Successful conversion returns converted/deleted triage message IDs for committed-response reconciliation; the source mailbox email row remains visible locally and shows its updated Logic Gate placement icon.
MT18 - Successful conversion returns the canonical result needed for concrete same-browser surfaces to patch; the conversion command emits no broad communications, workspace, or generic projection WebSocket event. A later exact-mailbox provider update is independent.
MT19 - Reverting a converted email restores the triage item from the email-node placement and removes the workspace record that was created from that conversion.
MT20 - My Triage subscribes only to `mailbox:personal:account:{user_id}:{normalized_account_email}` for the exact selected connected personal account. Shared Triage uses its separate exact shared-inbox pattern. There is no user-wide personal mailbox scope or background subscription for other accounts/views; payloads are compact post-commit hints and canonical HTTP reads remain authoritative.
MT21 - My Triage and Shared Triage primary inboxes must show a fixed, predictable message batch size of 12 messages per page.
MT22 - My Triage and Shared Triage primary inboxes automatically prefetch the next message page after the selected-detail foreground path settles, without waiting for scrolling or the archive/advance action.
MT23 - Scrolling a My Triage or Shared Triage primary inbox must not archive messages and must not load the next primary-inbox page.
MT24 - Advancing a My Triage or Shared Triage primary inbox page is an explicit user action that archives only the messages visible on the current page.
MT25 - Advancing must display the prefetched next page before archiving the previous page whenever a prefetched page is available.
MT26 - Advancing must freeze the previous page's message IDs at click time so local list changes cannot change what gets archived.
MT27 - The advance/archive action must remain immediately reusable after a page advances unless accepting the visible page would exceed the hidden archive queue limit.
MT28 - If no next page is available, advancing archives the current visible page and leaves the primary inbox empty until a canonical refresh provides more messages.
MT29 - Advancing must enqueue the frozen visible message IDs through one page-level background archive request instead of waiting for those provider mutations before allowing the user to continue.
MT30 - The hidden archive queue may contain no more than 140 pending emails across queued and in-flight archive work.
MT31 - If accepting the current visible page would exceed 140 pending archive emails, the advance/archive action is disabled until enough queued archive work completes.
MT32 - Background archive work must be accepted by the backend in one request per advanced page; provider mutations run from a backend archive job worker behind the backend provider gate instead of occupying multiple browser request lanes.
MT33 - Advancing must prioritize showing the prefetched next page, enqueueing the previous page, and making the action usable again before any folder metadata reconciliation.
MT34 - Folder metadata refresh after archive or unarchive is only a count/metadata reconciliation step, must be coalesced across committed local archive/unarchive responses and canonical archive-job reads, and must not clear or duplicate an in-flight folder metadata request.
MT35 - Folder metadata reconciliation must not fetch the next message page or block the prefetched page from being shown.
MT36 - If folder metadata reconciliation is slow or fails after archive or unarchive, the triage list remains usable and counts can reconcile later.
MT37 - Archive progress and completion are identified by durable archive job and job-item status returned from canonical archive-job reads, not by backend/provider browser events or generic mailbox updates.
MT38 - Reconciling durable archive-job status for the frozen previous page must not trigger a full message-list reload or blank the currently visible prefetched page.
MT39 - Star and unstar actions in My Triage must optimistically update the visible message state and Starred count before the committed HTTP response returns.
MT40 - The committed HTTP response for a local My Triage star or unstar action reconciles the affected row, caches, and counts without triggering a full message-list reload or blanking the active Inbox or Starred tab. External `message.created`, `message.updated` (including moves), and `message.deleted` hints reconcile the active displayed list and folder metadata canonically; folder hints reconcile metadata; local command echoes still use the committed result.
MT41 - My Triage mail activation must not launch background workspace repair GET storms for inaccessible or stale logic gate IDs referenced by node rows.
MT42 - If an accepted background archive job item reaches failed state or remains incomplete, the source email must not be deleted and may remain or reappear on the next canonical inbox load.
MT43 - Selecting another email, focusing the email body/detail pane, or returning focus from the detail pane to the list must not reload, blank, or replace the visible message list.
MT44 - Browser focus and visibility-change events must not force a My Triage or Shared Triage message-list refresh.
MT45 - The normal full-list replacement path for My Triage is initial page/list load, browser refresh, an explicit list identity change such as mailbox/search/unread/account/company/shared inbox, first subscription acceptance, reconnect acceptance, or one coalesced canonical reconciliation after a relevant active-mailbox message hint.
MT46 - Mailbox WebSocket payloads carry only the exact scope, trigger, and compact message/thread identifiers. They never fetch, insert, or live-patch message bodies; canonical page/list/detail reads remain authoritative.
MT47 - Local mail commands patch the affected visible or selected message from their committed response. External `message.created`, `message.updated` (including moves), and `message.deleted` hints reconcile the active displayed list/folders; a selected detail reload occurs only when the hint names that message or thread, so an unrelated new message never refetches it.
MT48 - Personal scope `mailbox:personal:account:<user_id>:<normalized_account_email>` requires that exact authenticated user/account relationship. Multiple personal accounts cannot wake one another, the removed `mailbox:personal:user:<user_id>` shape is invalid, and broad communications scopes are unsupported.
MT49 - A local triage conversion applies the committed response once and does not use a full message-list reload as the default reconciliation path.
MT50 - A background archive response may return Accepted only after the backend has written a durable archive job and job-item rows for the accepted message IDs.
MT51 - Accepted archive job items must survive API process restart and be claimable by a backend worker until each item reaches archived or failed.
MT52 - The backend archive worker must claim pending or retryable job items with a processing lease so concurrent workers do not mutate the same active item at the same time.
MT53 - Retryable archive failures such as provider rate limits or transient provider errors must be recorded with attempt count, last error, and next available time instead of being dropped from memory.
MT54 - Final archive failures and successful archive completions are recorded durably on job items and exposed by canonical archive-job reads; they do not publish communications WebSocket events.
MT55 - Duplicate active archive submissions for the same actor, mailbox scope, account, and message must not create duplicate active job items or duplicate provider archive attempts.
MT56 - My Triage archive jobs must use the actor's personal email connection, while Shared Triage archive jobs must preserve company/shared-inbox scope and use the shared mailbox connection that was authorized at acceptance time.
MT57 - Accepted background archive job IDs are pending work, not confirmed archive mutations; they must not be applied to the current visible message-list cache until an explicit user action or later full reload reconciles provider state.
MT58 - Transferring a direct email-created Kanban card into another node is not a revert; the email remains out of My Triage.
MT59 - A successful email-card transfer deletes the source email-created workspace node/card and creates or updates an email attachment on the target node.
MT60 - My Triage revert is only for restoring the original direct email-created card back to triage; once that email is transferred into another node, the transferred email is represented as a target-node attachment instead of a triage row.
MT61 - Drag payloads from My Triage and Shared Triage must carry message IDs plus one exact source mailbox scope. My Triage drags include normalized `account_email`; Shared Triage drags include `shared_inbox_id` and suppress personal account identity. Explorer, Kanban, project, and pin conversion handoffs must preserve that exact key through `POST /v1/communications/triage/convert` and the local committed-result event. The supported cross-window boundary is Chrome window/tab to Chrome window/tab; cross-browser application drag/drop is not a documented business requirement unless a separate compatibility rule and test are added.
MT62 - Successful local email conversion into a Logic Gate, Company Explorer Logic Gate, Kanban column, or project keeps the source row visible and patches row/detail/cache state from the committed result. It must not invalidate all communications caches, reuse stale prefetched pages, trigger post-removal fill or message-length prefetch, blank the list, or repeatedly issue mail GETs; it does not depend on a broad conversion/workspace realtime echo. A later exact-mailbox provider update may independently cause one canonical active-list reconciliation.
MT63 - Successful local email conversion into a Company Explorer Logic Gate must show a temporary green success banner over the Company Explorer section; other Logic Gate conversion surfaces must show a temporary success banner or notice.
MT64 - When a dragged email is converted into a Logic Gate, Company Explorer Logic Gate, Kanban column, project, pinned Logic Gate, or non-Explorer eligible node target, the source email is set to unstarred through the same source mailbox scope after the workspace conversion succeeds. The conversion response returns `unstarred_message_ids`, and Home applies those IDs as a local star mutation so Inbox, All, Starred, My Triage, and Shared Triage views do not refill, blink, or reload.
MT65 - Every unread My Triage email row shows the small top-left unread dot, unread text emphasis, and accessible unread state without the retired blue/thick outer card frame. Selection is independent: the entire selected card uses the established Mango selection surface, is exposed with `aria-pressed`, and remains visually distinct from unread state.
MT66 - Sent email read receipts use Nylas open tracking on outbound personal sends and replies by sending `tracking_options.opens = true`; inbound messages do not create read receipts.
MT67 - The authoritative personal receipt signal is the Nylas `message.opened` webhook for the sender's personal grant; the signal is image/pixel based and can be blocked, proxied, delayed, or generated by privacy systems, so the product labels it **Likely opened** rather than guaranteed human reading.
MT68 - Personal mailbox receipts are stored in the exact sender-user plus normalized personal-account scope and are enriched onto Sent message list/detail responses only for that same account. Two personal grants that happen to return the same provider message ID must not share receipt state, and there is no user-wide personal receipt fallback.
MT69 - A `message.opened` webhook may publish one compact exact-mailbox hint. If its message or thread is currently selected, Home invalidates and canonically reloads only that detail so the stored receipt summary converges; unrelated selections and the message list, top-up, and prefetch paths remain untouched.
MT70 - Sent messages without a stored personal receipt must not show a green `Not opened` indicator. Only a persisted Nylas `message.opened` signal renders the compact **Likely opened** chip. Hover/focus groups repeated signals, lists every distinct occurrence in local date/time, uses provider-reported identity only when present, labels a sole-recipient attribution as **inferred**, and keeps unknown multi-recipient activity anonymous. Inbox visibility, row preview, and Mango selection never create receipt state, and the tracking-pixel signal is not guaranteed human reading.
MT71 - Nylas receipt support requires a public `/nylas/webhook` destination for the same Nylas app/client ID used by outbound personal sends, and that webhook must subscribe to the Message tracking `message.opened` trigger.
MT72 - The Nylas dashboard Message tracking group may be configured with all 3 triggers selected: `message.opened`, `message.link_clicked`, and `thread.replied`; the current My Triage receipt contract consumes only `message.opened`, so link-clicked and thread-replied webhook deliveries must not create or mutate read-receipt state unless a future feature explicitly adds that behavior.
MT73 - The backend `NYLAS_WEBHOOK_SECRET` must match the secret returned by the configured Nylas webhook destination, and the Nylas app/environment must support message tracking; without that webhook secret and tracking-capable app, personal sends can request `tracking_options.opens = true` but the product will not receive usable receipt updates.
MT74 - Switching into My Triage or a mailbox-capable Shared Triage inbox must preserve the current mail list/counts until the selected mailbox identity is resolvable; a temporarily missing shared-inbox tree record must not be treated as a plain folder or no-mailbox state.
MT75 - Disconnecting a personal mailbox from My Triage requires an explicit point-of-click confirmation popover before the disconnect mutation runs.
MT76 - Personal reply drafts are unique per company, user, mailbox scope, and original message ID; opening Reply on the same source email resumes the existing draft instead of creating another draft row.
MT77 - A saved personal reply draft stores or reloads the original message context, and reopening the draft shows the original email being answered above the compose editor.
MT78 - Personal compose supports To, Cc, Bcc, Reply, Reply All, and Forward; Reply All excludes the active mailbox address from generated recipients. Forward is a distinct draft kind that targets the exact chosen message, does not send `reply_to_message_id`, and combines authored content with the locked sanitized original plus copied source attachments under EMAIL102.
MT79 - Personal compose supports scheduled sends by saving a scheduled draft with a due timestamp, sending it through the normal personal send path when due while the app is open, and deleting the scheduled draft only after send succeeds.
MT80 - Personal compose and reply use the unified editor semantics shared with node, Logic Gate, project, attached-email reply, and signature editor surfaces, including numbered/alphanumeric list, indent/outdent, bullet list, checklist, font size, bold, underline, italic, text highlight/No highlight, left/center/right alignment, table, hyperlink creation, paste cleanup, Delete/Backspace, and copy/cut/paste behavior. The visible controls use the complete shared toolbar inventory rather than a personal-compose-only toolbar.
MT81 - Personal compose stores rich editor content as sanitized rich HTML, while legacy plain text drafts continue to load and send as escaped/linkified HTML.
MT82 - Received personal email detail must display Cc recipients when the provider returns them; Bcc is displayed only when it is present on messages the user is allowed to see.
MT83 - Links in received personal email bodies, forwarded/replied original-message previews, sent reply bodies, and email signatures must open in a new browser tab when clicked.
MT84 - Node editor, logic-gate editor, and inline comment/chat text must auto-detect plain HTTP(S) or `www.` links, render them as blue underlined link text, and open them on a normal left click.
MT85 - The My Triage All mailbox control is a dropdown with All and Spam folder options; the selected option is visually highlighted and marked, and Spam loads the provider spam/junk mailbox.
MT86 - For Google personal mailboxes, Primary always uses `in:inbox -category:social -category:promotions`, with grouped user search and unread-only folded into that same native expression and the same exclusion enforced on fresh, refreshed, cached, and locally reconciled responses. All, Starred, Archive, and Spam retain their exact Gmail-native buckets; Spam, Social, and Promotions never leak into Primary.
MT87 - My Triage email drag/drop supports same-account Chrome window/tab drops onto Company Explorer Logic Gates, Logic Gate Kanban columns, project relationship panels, and Logic Gate groups inside a project; project drops create email-origin project node relationships, and Kanban or project drops open the created node popup after conversion succeeds.
MT88 - My Triage mailbox rows group messages by provider/Nylas `thread_id` when present so replies in the same conversation appear as one visible inbox item instead of duplicate rows; messages without a thread ID remain single-message rows.
MT89 - A grouped My Triage row uses the newest loaded message as the visible row representative while unread, starred, attachment, and thread-count indicators roll up from the loaded messages in that thread.
MT90 - Selecting a My Triage thread row resolves authoritative membership from Nylas thread `message_ids`, loads bounded preview metadata through structured `thread_id` message-list pages, and uses individual message-detail reads for full HTML bodies. Thread preview listing never combines `thread_id` with Gmail mailbox-native search, and the thread endpoint alone is not treated as containing full bodies. A selected single-message reader fills all remaining detail-pane height even when its body is short.
MT91 - Personal rich compose send must preserve sanitized block indentation, explicit line breaks, blank lines, and spacing, including indent/outdent and blockquote-style indents, so sent email HTML does not flatten intended paragraph indentation or collapse the body into one long line.
MT92 - Expired or revoked personal My Triage mailbox provider credentials return a My Triage reconnect/repair state, not a Mango auth logout. Personal mailbox folder, message-list, message-detail, send, archive, star, draft, calendar event-detail, and calendar RSVP endpoints must not represent provider reauthorization as a Mango session `401`, `unauthorized`, terminal-auth, logout, or login-redirect response; they must return a recoverable provider-specific response, such as `409 nylas_reauth_required`, while the user remains signed in to Mango.
MT93 - Any future change to unified editor semantics or shared editor format/outline controls must apply to My Triage compose and reply through the shared editor behavior and shared toolbar controls, not through a separate personal-compose-only implementation.
MT94 - Personal email compose/reply file attachments must follow `docs/tests/attachments.md`: files upload to Mango attachments before durable draft/send state is saved, normal durable payloads store attachment references instead of raw base64 `content`, and the draft API rejects embedded inline file bytes before persistence.
MT95 - Personal compose/reply inline body images use the unified rich-editor image attachment path and remain durable Mango attachment references until the backend send boundary, while normal file attachments use the mail attachment path.
MT96 - Incoming personal provider attachments can stay provider-referenced as mailbox metadata, but when converted into work, attached to a node, or otherwise made durable Mango work context, bytes must be cached/persisted into Mango S3 and stored as Mango attachment references.
MT97 - Mango-generated personal outgoing email HTML is marked as a Mango email body. When send-time preparation rewrites internal inline-image references, local Sent/reply caches must keep the provider-ready CID HTML plus metadata-only Mango attachment references when the provider send response omits body or attachment metadata; they must not restore the pre-send `mango-attachment:` HTML or cache raw attachment bytes.
MT98 - My Triage Inbox, All, Sent, and thread/detail views must preserve Mango-authored line breaks, spaces, and indentation when displaying sent or received copies of Mango-generated email bodies; this is a Mango display/cache contract and must not weaken the outbound email formatting that recipients receive. Once a detail or thread body is hydrated, later list, summary, star/read, or other preview-shaped payloads must not overwrite that hydrated body with a flattened snippet, and the detail pane must prefer a loading state over showing a snippet as if it were the full body.
MT99 - My Triage conversation detail orders messages newest first by provider timestamp with a deterministic message-ID tie-breaker; a locally sent reply is merged at the top immediately, including when the provider omits its initial timestamp or thread ID.
MT100 - Every message card in a My Triage conversation exposes Reply, Reply All, and Forward actions for that exact provider message. Recipients, original-message context, `reply_to_message_id`, and stable draft identity come from the chosen card rather than implicitly from the latest message.
MT101 - The conversation detail pane is the only vertical scroll container for a thread. Every expanded email body auto-sizes from the complete body and document-root dimensions, grows to its full rendered content without clipping, and must not have its own scrollbar or a fixed shallow body viewport.
MT102 - The newest conversation card is expanded by default and older cards are collapsed to headers. When a new inbound or outbound message joins the selected thread it becomes the expanded card and the previously expanded cards collapse; users can manually expand or collapse a card without introducing nested scrolling.
MT103 - The personal reply editor has a useful minimum/default height, can be resized vertically, and automatically saves and restores the user's clamped height preference for that mailbox scope; layout changes must not squeeze it below the minimum.
MT104 - Clicking a My Triage list row while compose/reply is open quietly preserves the current draft, exits compose, selects the clicked row, and displays its detail on the first click without reloading or blanking the list.
MT105 - Personal compose/reply font-size, Bold, Underline, Italic, Highlight/**No highlight**, alignment, and table controls preserve the editor selection when toolbar focus changes. Font size and highlight apply to selected text or pending collapsed-caret typing; **No highlight** clears selected/pending highlight; inline controls toggle off as well as on; and hover/focus/active styling applies only to the individual control. Enter commits a numeric font-size value once, while Escape cancels it without a blur commit.
MT106 - At personal send time, each authorized `mango-attachment:` image reference is deduplicated, resolved from Mango S3, assigned a unique alphanumeric content ID, added as an inline provider attachment, and rewritten to `cid:` in outbound HTML. Missing or unauthorized references fail the send instead of producing a broken image placeholder.

## Nylas Configuration Contract

Personal read receipts depend on both outbound send tracking and webhook delivery. The expected Nylas webhook configuration for this contract is:

- Webhook destination URL: the backend `/nylas/webhook` route for the active environment, for example `https://api.dev.<domain>/nylas/webhook` in dev or a public HTTPS tunnel URL for localhost.
- Required trigger: Message tracking `message.opened`.
- Accepted full Message tracking selection: `message.opened`, `message.link_clicked`, and `thread.replied` selected together.
- Backend secret: `NYLAS_WEBHOOK_SECRET` set to the webhook secret returned by that Nylas destination.
- Current product behavior: only `message.opened` writes personal read-receipt summaries; `message.link_clicked` and `thread.replied` are allowed in Nylas but are ignored for read receipts.

## Email Threading Contract

My Triage uses Nylas `thread_id` to group related messages into one inbox row. After the selected detail hydrates, bounded thread-filtered message pages provide conversation header metadata; list responses are not treated as complete bodies. Authoritative `message_ids` absent from those bounded previews are recovered immediately by exact ID, while preview-resolved older cards fetch single-message detail only when expanded. Detail cards are ordered newest first, the newest card expands while older cards collapse, and expanded cards auto-size inside the thread's single scroll surface.

MT107 - My Triage automatically inserts the default signature for the exact active personal account exactly once into each new compose, reply, and reply-all editor. A late database load may backfill only the matching still-open new draft while preserving typed text; reopening a saved draft must not add or replace a signature.
MT108 - My Triage thread inspection exposes expand-all, To/Cc/Bcc, authenticated image download/fullscreen, immediate reply focus, and bounded vertical resizing. Pointer-up, pointer-cancel, lost capture, or window blur ends resizing. A calendar invitation uses the shared EMAIL103 event card with authoritative title, time/timezone, organizer, guests, location, saved RSVP, meeting join/copy controls, and provider calendar link when available; RSVP controls prevent duplicate submission and show selected state only after provider success.
MT109 - Personal remote-draft reconciliation keeps the newest reply draft for each mailbox/source-message scope, deletes superseded remote duplicates, and restores saved Reply All To/Cc/Bcc addressing without reintroducing the active mailbox or duplicate recipients.
MT110 - Personal Save Draft and Send flush the mounted unified editor first and persist or submit the exact sanitized HTML returned by that flush, including the user's final DOM edit.
MT111 - The personal-account signature editor is a mailbox-scoped unified rich editor using the complete shared toolbar, including font-size, Bold, Underline, Italic, Highlight/**No highlight**, alignment, and table controls. Save Signature persists the exact flushed HTML; stale loads cannot overwrite newer edits, empty remote rows remain authoritative, and failed saves retain ordered mailbox-scoped pending sync without overtaking newer saves.
MT112 - Personal primary-inbox prefetch builds a bounded logical page of at most 12 unique thread rows, stops on a repeated page token or the configured provider-page budget, and never performs an unbounded serialized fill.
MT113 - Advance directly consumes the exact personal mailbox/filter/page-token prefetch, awaiting a matching in-flight prefetch instead of duplicating it. The click must not make a list request before swapping an available prefetched page.
MT114 - Initial next-page prefetch and provider mark-read yield foreground priority to the selected detail request while preserving immediate optimistic unread UI.
MT115 - Clicking a different personal thread replaces prior thread state immediately; stale results cannot reinsert old cards.
MT116 - Personal thread history uses bounded preview pages and lazy per-card body/attachment hydration. Collapsed cards perform no attachment-content reads, while Expand all intentionally hydrates all cards.
MT117 - First personal-account subscription acceptance and reconnect acceptance each coalesce one canonical folder/list reconciliation, including mail committed after the initial list and before first acceptance. Signed `message.created`, `message.updated` (including moves), `message.deleted`, and folder hints use the same one-active/one-queued-final coordinator; burst signals never overlap the active read. Its folder leg is authoritative: when the initial same-account folder load is still active, acceptance queues exactly one final refresh, bypasses reusable cache state, and fences any pre-invalidation provider result from refilling that account cache. An unrelated Shared Triage inventory refresh or equivalent resource-object replacement does not recreate the unchanged personal subscription or produce another acceptance/provider read.
MT118 - A personal mailbox hint received while another Home view/account is selected performs no provider GET. Navigation cancels/discards timers and pending work captured for the old exact request key, and opening the intended account performs its canonical load; Account A never invalidates or refreshes Account B. A hint that matched selected message/thread A is also discarded for detail purposes if selection B is active when its debounce or queued-final turn executes.
MT119 - Selecting an unread personal email by pointer, Enter, or Space immediately removes its unread dot/frame, updates the selected card and unread counter, and persists read state through the scoped provider command. Stale list/detail refreshes cannot resurrect unread while that command is authoritative; failure rolls the row/counter back, invalidates detail cache, and surfaces the established error.
MT120 - Selecting away from a successfully read personal message never marks it unread. A later provider or realtime refresh preserves the committed read state.
MT121 - Personal conversation detail resolves provider thread membership through `thread.message_ids`, hydrates any sent or older members absent from the bounded preview page, deduplicates by message ID, and orders deterministically. It supports external-initiated, user-initiated, alternating, and forwarded mail only when the provider thread or exact supported reply metadata establishes membership; subject similarity never joins conversations and missing thread identity remains a one-off.
MT122 - Ordinary personal durable draft list/get/create/update/delete operations require the authenticated user's exact personal account scope. Draft scope is immutable, known IDs in another user/account cannot be read, changed, reassigned, or deleted, and browser fallback data is keyed by company/user then filtered to the active account; only explicit pending-sync rows may migrate to the database. The My Triage Drafts tab renders those database drafts plus active collaboration shared drafts for which the current user is a permanent participant under EMAIL65 through EMAIL69; it never displays provider Drafts, another user's private draft, or a collaboration draft for a nonparticipant.
MT123 - A My Triage row shows the established accessible thread indicator on its left only when the canonical/loaded conversation count is greater than one; a one-off message or a message with an unproven thread count shows no thread icon.
MT124 - Personal read-on-open timers, optimistic overlays, and mutation responses use the authenticated company/user/account plus provider message ID. A completion may update only the exact captured mailbox/filter and selection generation; switching search, unread filter, view, account, user, or selected thread cannot let a stale success, rollback, error, or reconnect recovery mutate the new context.
MT125 - My Triage email cards use the shared compact triage-row layout. Horizontal card padding is no more than 6 CSS pixels per side, and the left indicator rail is no more than 20 CSS pixels wide while retaining the approximately 9-pixel unread dot, thread indicator, keyboard focus, and drag hit behavior.
MT126 - The top sender/subject line reserves only the width actually occupied by its top-right timestamp/action metadata. The body/snippet line flows beneath that metadata across the remaining card width to within 8 CSS pixels of the right edge; no fixed empty right metadata column or decorative spacer may shorten every line.
MT127 - Compact spacing must not change card meaning or accessibility: unread keeps its top-left dot and text emphasis without a blue/thick outer frame, selected keeps its independent full-card pressed surface, thread count retains its conditional icon, truncation uses ellipsis, and pointer/keyboard/drag targets remain usable.
MT128 - A personal-source collaboration is represented as one ordinary My Triage conversation row for every permanent participant, including a participant who was not a provider recipient. A shared-source collaboration also appears in My Triage as the guaranteed fallback when that participant cannot navigate the source Shared Triage mailbox.
MT129 - Provider-owned and virtual collaboration rows with the same immutable source mailbox plus provider thread/message identity are merged into one row. The newest canonical message and rolled-up unread/starred/attachment/thread state remain authoritative, while the collaboration/Node identity is retained for chat and shared-draft actions.
MT130 - Opening a collaboration-capable row leaves the My Triage email detail at full width with no chat rail. Only the row/detail's explicit **Chat** control opens the right-hand shared Node `ChatPane`; that control exposes its expanded state and the rail closes again without a durable mutation. Once open, the rail reads and writes the same chat records shown from the standalone Node without copying messages. Reading, highlighting, or abandoning an empty chat creates no Node; submitting the first nonempty root/reply chat ensures the collaboration Node and a successful chat write then displays that same message from either email or Node perspective.
MT131 - Selecting email body text exposes the shared chat action and captures exact message ID, trimmed quote, and text offsets; users may also create an unanchored chat. Activating an anchored chat navigates/highlights the correct message card and preserves the thread detail's single-scroll-surface behavior.
MT132 - Reply All exposes an explicit Create Shared Draft action for the exact selected message. The resulting collaboration draft follows EMAIL65 through EMAIL69 and appears once in My Drafts with source-mailbox and shared-state context, distinct from the user's private personal drafts.
MT133 - A collaboration shared draft sends immediately through EMAIL68. Its compose footer does not expose scheduled send, and the My Triage browser scheduler ignores shared drafts even if legacy/local state contains a timestamp.
MT134 - Unsynchronized personal fallback drafts survive Mango `401`, unclassified `403`, provider reauthorization/disconnection `409`, `5xx`, and network failures. Only explicit access/company revocation or definitive scope deletion purges the exact personal account; another personal account/shared inbox remains untouched.
MT135 - Personal draft loads use exact-scope generations plus local revisions. An older load cannot overwrite a newer load, save, delete, remote save completion, or a different personal account; stale callers return the current exact-scope draft set and browser storage preserves every unrelated scope.
MT136 - Personal compose creates the live exact-account draft before attachment upload/link. Draft-only attachment reads and mutations require that still-live owner/account draft; deleting it revokes draft-only list/content/send access, legacy accountless links remain owner-only read compatibility for a live draft, and independent sent-message attachment links remain valid.
MT137 - An open My Triage collaboration chat shows the EMAIL77 participant roster at the top: the prospective current actor before creation, then each durable participant represented once by a creator/direct-user avatar or deduplicated group-provenance cohort. Provider recipients and current group membership do not define this roster, and the canonical collaboration is refreshed after a committed mention so new permanent participants appear in the open email-chat header; this does not require the unchanged standalone-Node caller to render the email-specific roster adapter.
MT138 - A My Triage collaboration ensure/create or first-chat failure follows EMAIL78. It leaves the email selected and the rail open, preserves typed chat text, mention selections, reply target, and email anchor, removes any failed optimistic row, re-enables retry, and translates `failed_to_create_email_collaboration` or `email_collaboration_storage_not_ready` into a human recovery message rather than exposing either identifier as the complete banner text.
MT139 - The exact personal-account signature, including authenticated Mango image references, is durably saved and automatically appended once to every new compose, Reply, and Reply All for that account. Settings eagerly render its authenticated image preview; late hydration preserves live typing, and rerender, autosave, restored drafts, or reply-mode switches neither duplicate the signature nor replace deliberate edits.
MT140 - A personal read-on-open provider command survives ordinary mailbox-tab, search, unread-only, Home-view, and account navigation under its captured exact account. Navigation may prevent its completion from mutating the new visible list or selection, but it cannot cancel the command while retaining a local read overlay. Identical provider message IDs in another account remain independent.
MT141 - Personal folder loads are owned by company/user/account only. Changing list presentation filters while the request is active accepts the valid folder response and starts no duplicate replacement; changing the exact personal account rejects the old response and loads the destination account.
MT142 - Legacy personal `Seen` summaries are assigned to an exact account only for users with one stored personal connection. Ambiguous multi-account or orphan/no-stored-account broad rows are intentionally removed during cutover, never guessed into one account and never left as unreachable user-wide shadow rows.
MT143 - My Triage conversation headers show only the subject. Collapsed messages show sender/date/snippet and hide From/To/Cc/Bcc; activating the accessible disclosure reveals that exact message's labeled participants, full body, attachments, and actions without changing reply target or thread membership.
MT144 - Personal New, Reply, Reply All, Forward, and due scheduled-draft sends all enter EMAIL90's centralized ten-second pre-dispatch gate. The elevated non-green action row appears in the existing triage notice area with a right-to-left countdown; accessible Send now dispatches only that attempt immediately through the exact personal-account path, while Undo sends no provider request and keeps the durable draft/source available. For a due scheduled draft, Undo also clears the persisted send time so the scheduler cannot retry it; expiry dispatches once when neither action has already settled the attempt.
MT145 - My Triage uses one responsive mail-control row: a compact left-aligned search field and Search button, with the visible unread count, Unread only checkbox, and list-order control aligned to the right and wrapping cleanly at narrow widths. The list opens Newest first; the accessible icon/button exposes the current Newest/Oldest state and alternate action. Ordering is presentation-only over the current fixed page and composes with exact-account search and unread filtering without changing provider request identity, thread condensation, selection, or archive-page membership.
MT146 - My Triage loads all provider folder pages before deriving Inbox/Starred counters, keeps new-message compose body height responsive to the remaining detail workspace, and preserves the three-slot Compose/Sent/Archive-page header in Sent with the archive control disabled. Personal Sent messages keep signature/inline Mango images through an exact user/message attachment link after draft cleanup, and typing beside any hydrated inline image does not reload or flash it.
MT147 - A personal signature's display derivative may hydrate Settings/compose, but send authorizes and validates only the exact account's original bucket/key/size/SHA record, rewrites it to CID, and promotes its attachment metadata/link for Sent rendering. Missing/corrupt original state fails instead of sending display bytes or a temporary object URL.
MT148 - Personal timer-expiry and Send now dispatches use the same exact-account request once and surface the same backend failure. Any failed signature-image send leaves the current compose/reply and durable draft intact with an error, performs no success notice or draft deletion, and can be retried after the classified backend/storage issue is corrected.

## Scenarios

### Scenario MT-S0A: Personal Mailbox Provider Reauth Does Not Log Out Mango

Business logic covered:
- MT1
- MT2
- MT92

Given:
- A user is signed in to Mango with a valid Mango/Cognito session.
- The user's personal My Triage mailbox provider grant has expired or been revoked.
- The user opens My Triage or clicks a personal mailbox folder/message.

Expected:
- Folder, message-list, message-detail, send, archive, star, and draft reads or writes return a provider reauth-required response, such as `409 nylas_reauth_required`, not a Mango session `401`, `unauthorized`, terminal-auth, logout, or login-redirect response.
- The user remains signed in to Mango.
- The UI shows the My Triage reconnect/repair state for the personal mailbox.
- The app does not navigate to the Mango login page solely because the personal mailbox provider needs reconnecting.

### Scenario MT-S1: Personal Triage Add, Refresh, List, And Delete

Business logic covered:
- MT1
- MT2
- MT3
- MT4
- MT5

Given:
- User A and User B both belong to the same company.
- User A has a connected personal mailbox with messages M1 and M2.
- User B has no ownership over User A's personal triage rows.

Expected:
- User A can add M1 and M2 to My Triage.
- Re-adding M1 refreshes User A's stored snapshot and does not create a duplicate.
- A batch containing blanks, repeated IDs, and more than 50 IDs is cleaned and capped before processing.
- User A sees only User A's personal triage items.
- User B does not see or delete User A's personal triage item.
- Deleting M1 removes only User A's triage row for M1.

### Scenario MT-S2: Convert To Existing Workspace Targets

Business logic covered:
- MT6
- MT7
- MT8
- MT9
- MT10
- MT15
- MT16
- MT17
- MT18
- MT87

Given:
- A user has personal triage messages ready to convert.
- The request targets an existing logic gate, or an existing node with optional logic gate context.
- The user may have no-access or edit access to those targets.

Expected:
- Conversion fails when company, messages, or target data is missing.
- Conversion refreshes the message snapshot before creating workspace records.
- Target mode is inferred when the request omits it but includes a clear node or logic gate target.
- Conversion into an existing logic gate succeeds only with edit access to that logic gate.
- Conversion into an existing node succeeds only with edit access to the node and optional logic gate context.
- Missing status defaults to Pending.
- Missing priority defaults to 3, and priority outside 1 through 5 is rejected.
- Successful conversion returns the canonical committed result and converted/deleted triage IDs so the initiating browser patches the affected local row and concrete workspace surfaces while keeping the source mailbox email row visible with updated Logic Gate placement state. The conversion command emits no broad communications/workspace refresh event; if it changes an affected mounted board, only that board's `kanban.changed` hint may publish. A later exact-mailbox provider update remains independently eligible for canonical reconciliation.

### Scenario MT-S3: Convert To New Gate Or Project, Reject Folder Target

Business logic covered:
- MT6
- MT7
- MT8
- MT11
- MT12
- MT13
- MT14
- MT15
- MT16
- MT17
- MT18

Given:
- A user has personal triage messages ready to convert.
- The request targets a new logic gate, a folder/parent entity, or a project.
- The drag may cross same-account Chrome windows/tabs into Company Explorer, Kanban, or a project surface.

Expected:
- A new logic gate conversion requires a title/header and creates the gate plus related work records together.
- A folder or Company Explorer parent conversion is rejected before creating or deleting any workspace/triage records.
- Rejected folder conversion must not place a node in Company Explorer, create a folder item, or insert a node row into `company_explorer_items`.
- A project conversion requires project edit access and creates the project relationship/projection records.
- A project conversion may be project-only or project plus Logic Gate; project-only conversion creates a standalone project node relationship, while project plus Logic Gate also creates the Logic Gate node/card assignment.
- Kanban and project drops open the committed node popup after conversion, while preserving the exact personal account source scope.
- Successful conversion returns the canonical committed result and converted/deleted source triage IDs so the initiating browser patches the affected local rows and concrete workspace surfaces while keeping source mailbox email rows visible with updated Logic Gate placement state. The conversion command emits no broad communications/workspace refresh event; if it creates an assignment on an affected mounted board, only that board's `kanban.changed` hint may publish. A later exact-mailbox provider update remains independently eligible for canonical reconciliation.

### Scenario MT-S4: Revert Converted Email

Business logic covered:
- MT19

Given:
- A triage message was converted into a workspace node.
- The system still has enough email-node placement data to identify the conversion.

Expected:
- Reverting restores the message to My Triage.
- Reverting removes the workspace node/card created by that conversion.
- Reverting does not remove unrelated workspace records.

### Scenario MT-S5: Triage Paging And Explicit Archive Advance

Business logic covered:
- MT20
- MT21
- MT22
- MT23
- MT24
- MT25
- MT26
- MT27
- MT28
- MT29
- MT30
- MT31
- MT32
- MT33
- MT34
- MT35
- MT36
- MT37
- MT38
- MT39
- MT40
- MT41
- MT42
- MT43
- MT44
- MT45
- MT46
- MT47
- MT48
- MT49
- MT50
- MT51
- MT52
- MT53
- MT54
- MT55
- MT56
- MT57
- MT62
- MT63
- MT64
- MT65
- MT66
- MT67
- MT68
- MT69
- MT70
- MT71
- MT72
- MT73
- MT76
- MT77
- MT78
- MT79
- MT80
- MT81
- MT82
- MT83
- MT84
- MT85
- MT86
- MT93
- MT110
- MT112
- MT113
- MT114

Given:
- A user opens My Triage or a Shared Triage primary inbox with a connected mailbox.
- The mailbox has more than 12 messages available.
- The first visible page and the next page can be read from the mailbox provider.
- The user sends mail from the personal mailbox and later receives Nylas `message.opened` webhooks for those sent messages.
- The active Nylas app has a public `/nylas/webhook` destination with Message tracking `message.opened` selected; selecting all 3 Message tracking triggers (`message.opened`, `message.link_clicked`, and `thread.replied`) is valid for this environment.
- The user composes replies, reply-all messages, forwards, drafts, scheduled messages, and messages containing links/rich text.
- The provider mailbox contains Inbox, All, Sent, and Spam/Junk messages, while Mango contains database drafts in the exact active personal account scope.

Expected:
- The visible page contains no more than 12 messages.
- After the selected detail request gets foreground priority, the next page is prefetched as a bounded logical page of at most 12 unique thread rows; filling stops on a repeated provider token or the configured request budget.
- First acceptance and reconnect acceptance each reconcile the exact personal account once; a signed message/folder webhook then uses the same coalescer without polling.
- Clicking an email row, focusing the email body, and clicking back into the list do not reload, blank, or replace the message list.
- Browser focus and visibility changes do not force a message-list refresh.
- Relevant `message.created`, `message.updated` (including moves), and `message.deleted` hints reconcile the open personal list/folders; folder hints reconcile metadata; directly affected selected detail reloads, while unrelated new mail does not refetch it.
- Mail hinted while another view/account is active issues no provider GET and appears on the intended account's next canonical open. Local committed commands still patch affected visible or selected rows.
- Local conversion from the user's own email-to-Logic-Gate drop keeps source rows in place and patches Logic Gate icon state from the committed result without clearing caches, reusing stale prefetched pages, post-removal prefetching, repeated mail GETs, workspace panel GET bursts, or visible list blanking.
- The backend sets converted source emails to unstarred after successful conversion, the response includes successfully updated IDs in `unstarred_message_ids`, and the visible Home list/Starred count reconciles locally without loading replacement Starred rows.
- A successful local conversion shows a short green success notice.
- Every unread row shows its top-left dot and thicker unread frame; the selected row instead/also uses the distinct full-card Mango selection surface and accessible pressed state.
- Opening an unread row optimistically clears unread state and decrements the visible unread count; provider failure immediately rolls back and reports the error, while stale refreshes cannot resurrect unread after success.
- Personal mailbox realtime is limited to the exact authenticated user/account scope and carries compact hints, not message bodies. Multiple personal accounts cannot wake one another.
- Personal sends request Nylas open tracking, and Nylas `message.opened` webhooks store personal receipt summaries keyed by the sender user, normalized personal account identity, and provider message ID. Another personal account owned by that user cannot read or strengthen the receipt, even if its provider uses the same message ID.
- The configured webhook secret matches `NYLAS_WEBHOOK_SECRET`; otherwise webhook POSTs are rejected and no personal receipt summary is written.
- `message.link_clicked` and `thread.replied` webhook deliveries do not create or mutate read-receipt state under the current My Triage contract.
- The Sent mailbox shows **Likely opened** only for messages with a stored receipt signal; repeated occurrences and supportable/inferred/anonymous attribution follow MT70, while messages without a signal do not show `Not opened`.
- A selected affected Sent detail canonically reloads from its compact exact-mailbox `message.opened` hint; unrelated selections and cached list rows remain untouched.
- Replying to the same source email never creates more than one reply draft for that source message and mailbox scope.
- Reopening a reply draft shows the original email context above the compose editor.
- Reply, Reply All, Forward, Cc, and Bcc compose paths send through the normal personal mailbox connection and preserve local sent/reply reconciliation.
- A future scheduled send is saved as a scheduled draft, is sent through the normal personal send path when due while the app is open, and is deleted only after send succeeds.
- Rich compose controls use the unified editor behavior and complete shared segmented format/outline toolbar used by node, Logic Gate, project, and attached-email reply surfaces.
- Rich compose controls persist sanitized rich HTML, and legacy plain text drafts still send as escaped/linkified HTML.
- Save Draft and Send flush the compose editor and use the exact returned sanitized HTML.
- Received Cc recipients are visible in message detail.
- Email body/signature/original-preview links open in a new browser tab on click.
- Node editor, logic-gate editor, and inline comment/chat links render as clickable underlined links and open on single left click.
- The All mailbox dropdown can switch between All and Spam folder, with the selected option highlighted and marked.
- Google Primary always excludes Social and Promotions on fresh loads, `refresh=true`, cached responses, and local reconciliation; those messages remain available in All or Starred as appropriate.
- The Drafts tab reads the exact-scope Mango database collection and never requests the provider Draft mailbox.
- Scrolling the visible page does not archive any messages and does not append another primary-inbox page.
- Clicking the advance action freezes the currently visible message IDs, directly consumes (or awaits) the matching prefetched logical page without duplicating its provider reads, and enqueues only the frozen previous-page IDs for background archive.
- The frozen previous-page IDs are accepted by one page-level backend archive request only after durable archive job rows are written, and provider archive mutations continue from the backend worker.
- The advance action becomes usable again immediately after the next page is shown and the previous page is queued.
- The hidden archive queue accepts at most 140 pending emails; if adding the current page would exceed that limit, the advance action is disabled until enough background archive work completes.
- Accepted archive job items survive API restart and are retried by the backend worker until each item is archived or records a final failure.
- Duplicate active archive submissions for the same message and mailbox scope do not create duplicate active job items.
- Retryable provider failures remain recorded with attempt count, last error, and next retry time.
- Successful and final-failed archive job items expose their durable state through canonical job reconciliation without communications WebSocket events.
- Folder metadata refresh runs after the primary archive-and-next work as reconciliation only; it is coalesced, does not duplicate an in-flight folder request, and does not fetch the next email page.
- Canonical archive-job reconciliation updates pending bookkeeping without blanking, fully reloading, or removing rows from the currently visible prefetched page.
- Accepted background archive IDs are not treated as already archived in the frontend list cache; the current page remains stable while earlier page jobs drain in the backend.
- Starring or unstarring a message updates the row and Starred count locally, and the committed HTTP response reconciles that concrete state without blanking or fully reloading the active Inbox or Starred tab. External active-mailbox changes reconcile through the exact scoped coalescer.
- Opening or returning to My Triage does not fire background logic-gate view repair requests for missing, inaccessible, or stale node-linked logic gate IDs.
- If the backend accepts the archive page but a durable job item later reaches failed state or remains incomplete, the source email is not deleted and can remain or reappear on the next canonical load.
- If the archive request fails after the next page is shown, the user remains on the next page and sees an archive failure.
- If there is no next page, clicking the advance action enqueues the visible page and leaves the list empty until a later canonical load finds more inbox messages.

### Scenario MT-S6: Transfer Converted Email Card Into Existing Node

Business logic covered:
- MT17
- MT19
- MT58
- MT59
- MT60
- MT61

Given:
- A user converts a My Triage email into a Logic Gate Kanban node card.
- The converted email card is later dropped onto a different node card on the Kanban board.

Expected:
- The converted email is not restored to My Triage.
- The temporary source node/card created by the original conversion is deleted.
- The target node receives the email attachment and attached-email projection.
- Future placement lookup for the message points at the target node/card.
- The original conversion path keeps source mailbox scope on the drag payload, so the same card/transfer semantics apply when the source email came from Shared Triage.
- The revert behavior still applies only when reverting the original direct email-created card before it is transferred.

### Scenario MT-S7: Mailbox Activation And Disconnect Confirmation

Business logic covered:
- MT74
- MT75

Given:
- A user navigates between My Triage and mailbox-capable Shared Triage inboxes.
- The selected Shared Triage tree row may resolve after the active view changes.
- A connected personal mailbox exposes a disconnect action.

Expected:
- Opening My Triage loads folders, messages, Inbox counts, and Starred counts for the personal mailbox without requiring the user to click away and back.
- Opening a mailbox-capable Shared Triage inbox does not clear the visible list or counts solely because the selected shared-inbox metadata is still resolving.
- Once the selected shared-inbox metadata resolves, the active mailbox loads folders, messages, Inbox counts, and Starred counts for that mailbox.
- Clicking disconnect opens a small confirmation popover near the clicked button.
- The mailbox disconnect mutation runs only after the user confirms that popover.

### Scenario MT-S8: Threaded Inbox Rows And Conversation Detail

Business logic covered:
- MT88
- MT89
- MT90
- MT91
- MT97
- MT98
- MT99
- MT100
- MT101
- MT102
- MT115
- MT116

Given:
- A personal mailbox has multiple provider messages with the same Nylas `thread_id`.
- The newest loaded message is visible in My Triage.
- The user selects that row or sends a rich formatted reply with indented content.
- The provider send response may omit the body even though Mango submitted rich HTML.

Expected:
- The My Triage list shows one row for the thread, not one row per reply.
- The row preview comes from the newest loaded message while unread/starred/thread-count indicators roll up from the loaded messages in that thread.
- The right-side detail pane fills the available detail area and shows the conversation newest first with a deterministic tie-breaker.
- The newest card is expanded and older cards are collapsed; a newly received or locally sent reply moves to the top, expands immediately, and collapses the previously expanded cards.
- Each card's Reply, Reply All, and Forward actions target that card's message ID and original context.
- The thread detail pane owns the only vertical scrollbar; every expanded body auto-sizes to its full rendered height without an iframe/card scrollbar.
- A short plain-text message fills the remaining right-side detail height, while a long promotional HTML message expands to its complete document height and remains fully reachable through the detail-pane scrollbar.
- The selected message detail is the foreground read. Thread history starts from bounded structured `thread_id` list previews without Gmail-native mailbox search; authoritative members absent from those previews are recovered immediately through exact-ID personal-mailbox reads, while preview-resolved older bodies are fetched only when their card is expanded or Expand all is chosen.
- Selecting a row from another thread immediately replaces the prior conversation cards, while same-thread reconciliation may preserve already hydrated detail.
- Sent rich HTML preserves explicit line breaks, blank lines, spacing, and block indentation instead of flattening the reply body or indented paragraphs.
- Local Sent/reply caches keep provider-ready Mango HTML when the send response omits body content, including CID-rewritten inline-image HTML rather than stale internal attachment URLs.
- Mango's own Inbox, All, Sent, thread, and detail displays preserve Mango-authored line breaks, spaces, and indentation instead of flattening the same email body into one sentence.
- Once the selected message or thread has a hydrated body, list refreshes, read/star changes, and preview-only cache writes preserve that hydrated structure instead of replacing it with the row snippet.
- While a full detail body is being fetched, the detail pane may show a loading placeholder but must not present the inbox preview snippet as the full structured body.

### Scenario MT-S8B: Personal Signature Is Applied Automatically

Business logic covered:
- MT107

Given:
- A personal mailbox has a saved default signature and the user opens a new compose, reply, or reply-all editor.
- The signature may finish loading after the new editor opens.

Expected:
- The signature for that exact personal account appears once without requiring the user to press Insert Signature.
- If the signature arrives late, it is appended once to the matching still-open new draft without removing text already typed.
- Reopened saved drafts are not mutated, and rich-editor serialization cannot cause a duplicate signature.

### Scenario MT-S8C: Personal Signature Uses The Unified Editor

Business logic covered:
- MT94
- MT105
- MT111

Given:
- A user opens the signature editor for a personal account, formats text with the shared font-size, Bold, Underline, Italic, Highlight/No highlight, alignment, or table controls, and saves.
- A signature load, legacy backfill, failed retry, or newer save may overlap that edit.

Expected:
- The signature editor uses the same unified rich editor host, semantics, formatting controller, and toolbar as personal compose/reply; it is not a native textarea.
- Font-size, inline-format, highlight/No highlight, alignment, and table controls operate on the preserved selection or appropriate collapsed-caret/context semantics.
- Save Signature persists the exact flushed sanitized HTML for that account and reports success only after the remote save succeeds.
- Stale hydration cannot overwrite the newer local edit, an empty remote row remains authoritative, and pending retries/backfills are serialized before newer saves without replacing them.
- Embedded inline file bytes are rejected before durable signature persistence.

### Scenario MT-S9: Personal Mail Attachments Use Mango Attachments

Business logic covered:
- MT7
- MT17
- MT59
- MT80
- MT81
- MT94
- MT95
- MT96
- MT97
- MT106

Given:
- A user attaches files to a personal compose, reply, reply-all, forward, or scheduled draft.
- A user pastes an inline image into the personal compose/reply body.
- A personal mailbox message with provider attachments is converted into work or attached to a node.

Expected:
- File attachments upload to Mango attachments before durable draft/send state is saved.
- Personal draft/send payloads store Mango attachment references, not raw base64 attachment content.
- The draft API rejects embedded inline file bytes before durable storage.
- Inline body images use the unified rich-editor image attachment path and durable drafts keep Mango attachment references.
- At send time the backend deduplicates inline references, authorizes and reads the S3 bytes, creates matching inline provider/CID attachments, and rewrites image sources to `cid:`; ordinary attached files remain ordinary attachments.
- The send response/cache fallback contains provider-ready CID HTML and metadata-only attachment references, never raw bytes; missing or unauthorized inline references reject the send visibly.
- Current attached-email/conversion projections do not persist provider attachment bytes; before a personal provider attachment becomes a durable Mango-owned resource, it must be cached into Mango S3 and represented by Mango attachment references.

### Scenario MT-S10: Reply Target, Editor Controls, And Compose Transition

Business logic covered:
- MT76
- MT77
- MT80
- MT100
- MT103
- MT104
- MT105
- MT109
- MT110

Given:
- A user has a multi-message personal thread open.
- The user resizes the reply editor, formats selected text, or has an unsent compose/reply draft open.

Expected:
- Choosing Reply, Reply All, or Forward on an older card builds the action from that exact message and resumes only that message's stable draft.
- Reconciliation removes older remote reply drafts for the same mailbox/source-message scope, and reopening Reply All restores saved To/Cc/Bcc recipients with active-mailbox exclusion intact.
- The reply editor never collapses below its minimum, saves its resized height automatically, and restores the preference when another personal reply opens.
- Font-size and highlight apply to the preserved selection or pending collapsed-caret typing style; Bold, Underline, and Italic toggle on/off; **No highlight** clears selected/pending highlight; alignment and table actions use the preserved context; active indicators follow the selection or pending state.
- Saving, transitioning away, or sending flushes the mounted editor first so the final edit cannot be lost to stale compose state.
- Clicking a different email row quietly saves the active draft, closes compose, and shows the clicked message on the first click without replacing the visible list.

### Scenario MT-S11: Thread Inspection, Resize Release, And Calendar Event Card

Business logic covered:
- MT82
- MT88
- MT90
- MT92
- MT100
- MT101
- MT102
- MT103
- MT108

Given:
- A personal thread contains multiple messages, Cc/Bcc metadata, screenshots, attachments, or a calendar invitation.

Expected:
- `Expand all threads` expands every card and leaves the thread pane as the single scroll surface.
- Every message displays To, Cc, and provider-visible Bcc metadata when present.
- Selecting a body screenshot exposes Download and double-click opens a full-screen preview.
- Reply/Reply all focuses the body editor immediately and keeps the original target message visible.
- Releasing the reply resize pointer, cancelling it, losing pointer capture, or moving focus outside the browser ends resizing immediately; later cursor movement cannot change the height.
- A valid calendar invitation renders the shared event card with available title, local time plus provider timezone, organizer, guests, location, current response, Join meeting, Copy link, and Open calendar; Accept, Tentative, and Decline disable duplicate submission while pending and show saved state only after provider success.
- An expired/revoked grant, missing calendar scope, or provider failure leaves the RSVP unselected and presents a recoverable mailbox reconnect/provider error without logging the user out of Mango.

### Scenario MT-S12: Live Arrival, Complete History, Read State, And Draft Isolation

Business logic covered:
- MT20
- MT46
- MT48
- MT65
- MT88
- MT90
- MT117
- MT118
- MT119
- MT120
- MT121
- MT122
- MT123
- MT124
- MT134
- MT135
- MT136

Given:
- An external sender starts a conversation, the Mango user replies, and another message commits after the initial list but before first personal-account subscription acceptance.
- The provider may return the sent reply in thread membership even when it was absent from the first message-list page, or the send response may initially omit its thread ID while the exact reply target supplies that thread identity.
- The user selects the unread newest message and saves personal drafts in two authenticated user/account scopes.
- A draft load fails with recoverable auth/provider/service/network errors, then separate requests prove explicit revocation/deletion; overlapping loads complete out of order while a local save/delete occurs.
- The user attaches a file to a live draft, deletes the draft, and later opens an independently linked sent-message attachment.

Expected:
- First acceptance discovers the between-list-and-acceptance message through one canonical exact-account reconciliation; reconnect and later relevant hints use the same one-active/one-queued-final path.
- Returning from another Home view/account loads canonical state for the intended account without a background GET or cross-account invalidation.
- Conversation detail contains the external original, the Mango sent reply, and the newest inbound reply in deterministic order. Forwarded or subject-similar unrelated mail is not merged, and an unresolved one-off remains valid.
- The unread dot/frame and visible unread count clear immediately on pointer or keyboard open; success remains read across selection/realtime refresh, while failure rolls state and count back and surfaces the error.
- The multi-message row shows the thread icon; a one-message row does not.
- Each ordinary personal draft API operation and private Drafts-tab row requires the exact authenticated user/account database scope. User B cannot list, fetch, overwrite, move, delete, or access attachments for User A's private draft even when the draft ID is known; only permanent collaboration participation adds the explicit shared-draft exception. The tab never lists provider Drafts, and a successful remote load cannot resurrect an unmarked stale browser draft.
- Recoverable errors retain pending local drafts; only explicit revocation/deletion purges the exact scope. Out-of-order loads cannot overwrite newer loads, saves, deletes, or another personal account.
- Compose persists the live exact-account draft before attachment upload. Deleting it denies draft-scoped attachment access to every actor, while the independent sent-message link stays valid.

### Scenario MT-S13: Compact My Triage Cards

Business logic covered:
- MT65
- MT123
- MT125
- MT126
- MT127

Given:
- My Triage renders unread/read, selected/unselected, one-message, multi-message, draggable, and long-subject/snippet cards.

Expected:
- Each card has at most 6 CSS pixels of horizontal outer padding and at most a 20-pixel left indicator rail.
- The unread dot remains visible at the top left without adding an empty text gutter, and unread/selection/thread/drag/keyboard states remain distinct and operable.
- Sender/subject text uses the top line up to the real timestamp/action width.
- Snippet/body preview text continues beneath the timestamp to within 8 CSS pixels of the right edge, with ellipsis only after using that width.
- The row does not reserve a fixed empty right column.

### Scenario MT-S14: Email Collaboration, Participant Rows, And Shared Drafts

Business logic covered:
- MT122
- MT128
- MT129
- MT130
- MT131
- MT132
- MT133
- MT137
- MT138

Given:
- A personal email owner creates an anchored or unanchored chat and mentions another user/group.
- One participant is not a provider recipient, and another participant can also see the provider-owned row.
- A participant creates a shared draft from Reply All.
- The owner first opens the email without opening Chat, then explicitly opens the rail; an ensure or first-chat request may fail before a retry succeeds.

Expected:
- No collaboration Node exists until the first nonempty chat is submitted or explicit shared-draft creation is invoked; a retry reuses an already committed ensure if the subsequent chat write failed.
- Every permanent participant sees one ordinary deduplicated My Triage row backed by the canonical source conversation, including the shared-source fallback case.
- Opening the row keeps email detail full width and Chat closed. Only the explicit accessible Chat control mounts the right-hand rail; closing it or changing exact message/mailbox/view makes no collaboration mutation.
- The open rail renders the same shared ChatPane data shown on the Node; replies, indentation, selection navigation, mentions, attachments, and refresh semantics remain identical, and its header shows the canonical deduplicated participant/group-provenance roster.
- A failed ensure leaves no partial durable artifacts; a creation/write failure preserves the chat composer context, removes a failed optimistic row, re-enables retry, and translates `failed_to_create_email_collaboration` or `email_collaboration_storage_not_ready` into actionable text.
- The exact selected message supplies an anchored chat and Create Shared Draft Reply All context.
- My Drafts keeps exact-account private drafts isolated while also showing the one active participant-authorized collaboration draft with explicit source/shared context.
- The shared draft cannot be scheduled; its current revision is sent immediately through the collaboration source while ordinary private drafts retain the existing browser-driven scheduling path.
- A nonparticipant cannot list the row or draft by guessing IDs.

### Scenario MT-S15: Personal Signature Image And Start-Action Reliability

Business logic covered:
- MT95
- MT107
- MT111
- MT139

Given:
- Personal Account A has a saved signature containing a Mango image, while Account B has a different signature.
- The user opens signature settings, starts New compose, Reply, and Reply All, and a signature load overlaps typing or draft restoration.

Expected:
- Settings immediately show the image through the authenticated exact-account attachment context, and Save persists the flushed sanitized signature.
- Each Account A start action receives A's signature exactly once; Account B never leaks into it.
- Late completion appends without replacing typed/restored content, and autosave, rerender, or switching reply modes cannot duplicate the signature.

### Scenario MT-S16: Personal Navigation Ownership And Exact Receipt Cutover

Business logic covered:
- MT140
- MT141
- MT142

Given:
- Account A queues provider mark-read and starts a folder request, then list filters change and the user later selects Account B.
- Legacy personal receipt summaries exist for singleton-account, multi-account, and orphan users with no stored account connection.

Expected:
- Account A's provider command still executes under its captured scope but cannot patch Account B's visible state.
- A list-filter change accepts Account A's valid folder result without another request; the account change rejects it and loads Account B.
- Only singleton history is copied to `user_id:normalized_account_email`; ambiguous and orphan broad history is explicitly removed.
### Scenario MT-S17: Clean Thread Disclosure, Likely-Opened Occurrences, And Undo Send

Business logic covered:
- MT65
- MT70
- MT127
- MT143
- MT144

Given:
- An unread multi-message My Triage conversation contains different participants per message, a sent message has multiple stored open signals, and a personal compose/reply is submitted.

Expected:
- The unread dot/emphasis remains but no unread card has the blue/thick frame; selection and keyboard state remain independent.
- The overall header shows only the subject. Collapsed rows hide recipient details, while expanding one row reveals only that message's From/To/Cc/Bcc, body, files, and exact-message actions.
- **Likely opened** appears only from persisted provider open signals; the focused/hovered chip groups repeated signals, lists local occurrence times, uses provider identity only when reported, labels sole-recipient attribution as inferred, and otherwise remains anonymous.
- The non-green action row appears immediately. No personal-send HTTP request starts for ten seconds unless Send now is activated; Send now dispatches that exact attempt once, Undo prevents it and retains the draft, a due draft is unscheduled durably, and expiry sends once through the exact account when the attempt is still pending.

### Scenario MT-S18: Responsive Mail Controls And List Ordering

Business logic covered:
- MT21
- MT45
- MT86
- MT145

Given:
- A personal Primary page contains read and unread conversations with different timestamps.
- The user submits a search, enables Unread only, toggles Oldest/Newest ordering, and narrows the mail pane.

Expected:
- Search and Search stay compact on the left while unread count, Unread only, and the icon-plus-state order button align right on the same row or wrap as intact groups without overlap.
- The control starts Newest, exposes current/alternate state to assistive technology and tooltip users, and changes the visible label/icon when toggled.
- Search and unread-only remain exact-account provider filters; ordering reverses only the resulting current 12-conversation page and never changes its membership, selection, thread condensation, provider filter key, or Archive page action.

### Scenario MT-S19: Personal Counter, Sent Image, Typing, And Header Stability

Business logic covered:
- MT146

Given:
- A personal mailbox has Inbox and Starred on separate folder pages, and the user sends a draft containing a signature image.
- The user types beside an inline image in New Message, views the result in Sent, and narrows or enlarges the detail pane.

Expected:
- Both provider-backed counters remain visible, the compose body consumes the available height without clipping its controls, and typing never blanks or reloads the image.
- Sent preserves the ordinary three-button layout, disables Archive page/go-next, and renders the sent CID image after the source draft has been deleted.

### Scenario MT-S20: Personal Signature Send Integrity And Failure Recovery

Business logic covered:
- MT139
- MT144
- MT146
- MT147
- MT148

Given:
- The active personal account has a saved signature image with separate display and original bytes.
- The user sends once after the delay and once with Send now, then the original open/stream validation fails.

Expected:
- Each attempt dispatches once through the same exact-account backend path; success sends the validated original as CID and Sent resolves it through the promoted user/message link.
- Failure identifies the safe backend class, does not report success, and keeps the current compose plus durable draft and Mango reference available for retry.
