Last updated: 2026-07-06

# My Triage Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (store-level conversion and transfer coverage exists; rule IDs are not fully mapped to automated tests yet)

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
MT12 - Converting into a Company Explorer folder or parent entity is invalid for email-derived node creation; conversion into a project may create email-derived node records and project relationship/projection records.
MT13 - Folder conversion targets, including legacy folder IDs and Company Explorer V2 parent entities, are rejected before node creation and must not create `company_explorer_items`, Explorer V2 rows, or folder item placements.
MT14 - Converting into a project requires project edit access and creates the project relationship/projection records needed for the new work item.
MT15 - Conversion defaults the status to Pending and priority to 3 when those values are not provided.
MT16 - Explicit conversion priority must be between 1 and 5.
MT17 - Successful conversion returns converted/deleted triage message IDs for backend reconciliation and realtime echo matching, but the source mailbox email row remains visible locally and shows its updated Logic Gate placement icon.
MT18 - Successful conversion emits the triage/workspace/projection events needed for other views to refresh.
MT19 - Reverting a converted email restores the triage item from the email-node placement and removes the workspace record that was created from that conversion.
MT20 - My Triage and Shared Triage must continue to live-reconcile mailbox messages when they are created, updated, or deleted without replacing the whole visible message list.
MT21 - My Triage and Shared Triage primary inboxes must show a fixed, predictable message batch size of 20 messages per page.
MT22 - My Triage and Shared Triage primary inboxes must immediately prefetch the next message page after the first visible page loads, without waiting for scrolling or the archive/advance action.
MT23 - Scrolling a My Triage or Shared Triage primary inbox must not archive messages and must not load the next primary-inbox page.
MT24 - Advancing a My Triage or Shared Triage primary inbox page is an explicit user action that archives only the messages visible on the current page.
MT25 - Advancing must display the prefetched next page before archiving the previous page whenever a prefetched page is available.
MT26 - Advancing must freeze the previous page's message IDs at click time so live updates cannot change what gets archived.
MT27 - The advance/archive action must remain immediately reusable after a page advances unless accepting the visible page would exceed the hidden archive queue limit.
MT28 - If no next page is available, advancing archives the current visible page and leaves the primary inbox empty until live updates or a refresh provide more messages.
MT29 - Advancing must enqueue the frozen visible message IDs through one page-level background archive request instead of waiting for those provider mutations before allowing the user to continue.
MT30 - The hidden archive queue may contain no more than 140 pending emails across queued and in-flight archive work.
MT31 - If accepting the current visible page would exceed 140 pending archive emails, the advance/archive action is disabled until enough queued archive work completes.
MT32 - Background archive work must be accepted by the backend in one request per advanced page; provider mutations run from a backend archive job worker behind the backend provider gate instead of occupying multiple browser request lanes.
MT33 - Advancing must prioritize showing the prefetched next page, enqueueing the previous page, and making the action usable again before any folder metadata reconciliation.
MT34 - Folder metadata refresh after archive or unarchive is only a count/metadata reconciliation step, must be coalesced across archive confirmations, and must not clear or duplicate an in-flight folder metadata request.
MT35 - Folder metadata reconciliation must not fetch the next message page or block the prefetched page from being shown.
MT36 - If folder metadata reconciliation is slow or fails after archive or unarchive, the triage list remains usable and counts can reconcile later.
MT37 - Backend or provider events caused by archive work must be identifiable as archive confirmations instead of generic mailbox updates.
MT38 - Archive confirmations for the frozen previous page must not trigger a full message-list reload or blank the currently visible prefetched page.
MT39 - Star and unstar actions in My Triage must optimistically update the visible message state and Starred count before backend or provider confirmation returns.
MT40 - Backend or provider confirmations caused by local My Triage star and unstar actions must reconcile caches/counts without triggering a full message-list reload or blanking the active Inbox or Starred tab.
MT41 - My Triage mail activation must not launch background workspace repair GET storms for inaccessible or stale logic gate IDs referenced by node rows.
MT42 - If an accepted background archive mutation fails or never confirms, the source email must not be deleted and may remain or reappear in the inbox after refresh/reconciliation.
MT43 - Selecting another email, focusing the email body/detail pane, or returning focus from the detail pane to the list must not reload, blank, or replace the visible message list.
MT44 - Browser focus and visibility-change events must not force a My Triage or Shared Triage message-list refresh.
MT45 - The normal full-list replacement path for My Triage is initial page/list load, browser refresh, or an explicit list identity change such as mailbox, search, unread filter, account, company, or selected Shared Triage mailbox.
MT46 - A communications realtime message.created event with a message ID must fetch that one message and insert it into the current date-sorted list when it matches the active filters; it must not reload the whole list.
MT47 - Communications realtime message.updated, message.opened, and message.deleted events with a message ID must update, reconcile, or remove only the affected visible or selected message; they must not reload the whole list when the affected message is not visible.
MT48 - Communications realtime message events without a message ID must not trigger a full message-list reload; the next explicit page/list load reconciles anything that could not be handled as a single-message update.
MT49 - Triage conversion realtime events must remove matching visible My Triage rows when the converted message IDs are present and must not use a full message-list reload as the default reconciliation path.
MT50 - A background archive response may return Accepted only after the backend has written a durable archive job and job-item rows for the accepted message IDs.
MT51 - Accepted archive job items must survive API process restart and be claimable by a backend worker until each item reaches archived or failed.
MT52 - The backend archive worker must claim pending or retryable job items with a processing lease so concurrent workers do not mutate the same active item at the same time.
MT53 - Retryable archive failures such as provider rate limits or transient provider errors must be recorded with attempt count, last error, and next available time instead of being dropped from memory.
MT54 - Final archive failures must be recorded on the job item and emit an archive-failed communications event; successful items must emit archive confirmation events.
MT55 - Duplicate active archive submissions for the same actor, mailbox scope, account, and message must not create duplicate active job items or duplicate provider archive attempts.
MT56 - My Triage archive jobs must use the actor's personal email connection, while Shared Triage archive jobs must preserve company/shared-inbox scope and use the shared mailbox connection that was authorized at acceptance time.
MT57 - Accepted background archive job IDs are pending work, not confirmed archive mutations; they must not be applied to the current visible message-list cache until an explicit user action or later full reload reconciles provider state.
MT58 - Transferring a direct email-created Kanban card into another node is not a revert; the email remains out of My Triage.
MT59 - A successful email-card transfer deletes the source email-created workspace node/card and creates or updates an email attachment on the target node.
MT60 - My Triage revert is only for restoring the original direct email-created card back to triage; once that email is transferred into another node, the transferred email is represented as a target-node attachment instead of a triage row.
MT61 - Drag payloads from My Triage and Shared Triage must carry message IDs plus source mailbox scope; Shared Triage drags include `shared_inbox_id`, while My Triage drags leave that scope empty. The supported cross-window boundary for these email drag payloads is Chrome window/tab to Chrome window/tab; cross-browser application drag/drop is not a documented business requirement unless a separate compatibility rule and test are added.
MT62 - Successful local email conversion into a Logic Gate or Company Explorer Logic Gate must keep the source email row visible in Inbox, All, My Triage, and Shared Triage mailbox lists, patch the row/detail/cache with the returned Logic Gate placement so the Logic Gate icon changes immediately, and suppress the matching local `triage.converted` echo. It must not remove the row from visible state, invalidate all communications message page/detail caches, reuse stale prefetched pages, trigger post-removal fill or message-length prefetch, blank the email list, or repeatedly issue mail GETs. This is a regression-prone path: any change to conversion, communications cache invalidation, realtime echo handling, pagination prefetch/refill, row-removal logic, or star/unstar mutation must preserve this keep-row/no-blank/no-refill/no-repeat-GET behavior.
MT63 - Successful local email conversion into a Company Explorer Logic Gate must show a temporary green success banner over the Company Explorer section; other Logic Gate conversion surfaces must show a temporary success banner or notice.
MT64 - When a dragged email is converted into a Logic Gate, Company Explorer Logic Gate, pinned Logic Gate, or non-Explorer eligible node target, the source email is set to unstarred through the same source mailbox scope after the workspace conversion succeeds. The conversion response returns `unstarred_message_ids`, and Home applies those IDs as a local star mutation so Inbox, All, Starred, My Triage, and Shared Triage views do not refill, blink, or reload.
MT65 - Unread My Triage email rows keep their outer unread outline/highlight, but the small top-left colored dot is reserved for the currently selected email only; unread but unselected rows must not show that dot.
MT66 - Sent email read receipts use Nylas open tracking on outbound personal sends and replies by sending `tracking_options.opens = true`; inbound messages do not create read receipts.
MT67 - The authoritative personal receipt signal is the Nylas `message.opened` webhook for the sender's personal grant; the signal is image/pixel based and can be blocked, proxied, delayed, or generated by privacy systems, so the product treats it as a `Seen` open-tracking signal rather than guaranteed human reading.
MT68 - Personal mailbox receipts are stored in the sender user's personal receipt scope and are enriched onto Sent message list/detail responses for that same personal mailbox scope.
MT69 - A personal `message.opened` receipt with a message ID must reconcile only the affected visible or selected sent message and must not trigger a full message-list reload, top-up, or prefetch.
MT70 - Sent messages without a stored personal receipt must not show a green `Not opened` indicator; the UI shows `Seen` only after a stored open signal, with timestamp/count details when available.
MT71 - Nylas receipt support requires a public `/nylas/webhook` destination for the same Nylas app/client ID used by outbound personal sends, and that webhook must subscribe to the Message tracking `message.opened` trigger.
MT72 - The Nylas dashboard Message tracking group may be configured with all 3 triggers selected: `message.opened`, `message.link_clicked`, and `thread.replied`; the current My Triage receipt contract consumes only `message.opened`, so link-clicked and thread-replied webhook deliveries must not create or mutate read-receipt state unless a future feature explicitly adds that behavior.
MT73 - The backend `NYLAS_WEBHOOK_SECRET` must match the secret returned by the configured Nylas webhook destination, and the Nylas app/environment must support message tracking; without that webhook secret and tracking-capable app, personal sends can request `tracking_options.opens = true` but the product will not receive usable receipt updates.
MT74 - Switching into My Triage or a mailbox-capable Shared Triage inbox must preserve the current mail list/counts until the selected mailbox identity is resolvable; a temporarily missing shared-inbox tree record must not be treated as a plain folder or no-mailbox state.
MT75 - Disconnecting a personal mailbox from My Triage requires an explicit point-of-click confirmation popover before the disconnect mutation runs.
MT76 - Personal reply drafts are unique per company, user, mailbox scope, and original message ID; opening Reply on the same source email resumes the existing draft instead of creating another draft row.
MT77 - A saved personal reply draft stores or reloads the original message context, and reopening the draft shows the original email being answered above the compose editor.
MT78 - Personal compose supports To, Cc, Bcc, Reply, Reply All, and Forward; Reply All excludes the active mailbox address from generated recipients.
MT79 - Personal compose supports scheduled sends by saving a scheduled draft with a due timestamp, sending it through the normal personal send path when due while the app is open, and deleting the scheduled draft only after send succeeds.
MT80 - Personal compose uses the same rich text controls expected from node and logic-gate editors: numbered/alphanumeric list, indent/outdent, bullet list, checklist, font size, bold, underline, and hyperlink creation.
MT81 - Personal compose stores rich editor content as sanitized rich HTML, while legacy plain text drafts continue to load and send as escaped/linkified HTML.
MT82 - Received personal email detail must display Cc recipients when the provider returns them; Bcc is displayed only when it is present on messages the user is allowed to see.
MT83 - Links in received personal email bodies, forwarded/replied original-message previews, sent reply bodies, and email signatures must open in a new browser tab when clicked.
MT84 - Node editor, logic-gate editor, and inline comment/chat text must auto-detect plain HTTP(S) or `www.` links, render them as blue underlined link text, and open them on a normal left click.
MT85 - The My Triage All mailbox control is a dropdown with All and Spam folder options; the selected option is visually highlighted and marked, and Spam loads the provider spam/junk mailbox.
MT86 - Spam mailbox reads are scoped to the same personal connection and filters as the current My Triage mailbox view; Spam messages must not leak into the primary inbox filter.
MT87 - We want multi browser click-drag ability. So I can drag an email from My Triage or Shared Triage and click drag it to another browser window (but the same account) and drop it off on the company explorer logic gate and create a node within that logic gate's kanban board with an email icon (but obviously not create a node on the company explorer)

## Nylas Configuration Contract

Personal read receipts depend on both outbound send tracking and webhook delivery. The expected Nylas webhook configuration for this contract is:

- Webhook destination URL: the backend `/nylas/webhook` route for the active environment, for example `https://api.dev.<domain>/nylas/webhook` in dev or a public HTTPS tunnel URL for localhost.
- Required trigger: Message tracking `message.opened`.
- Accepted full Message tracking selection: `message.opened`, `message.link_clicked`, and `thread.replied` selected together.
- Backend secret: `NYLAS_WEBHOOK_SECRET` set to the webhook secret returned by that Nylas destination.
- Current product behavior: only `message.opened` writes personal read-receipt summaries; `message.link_clicked` and `thread.replied` are allowed in Nylas but are ignored for read receipts.

## Scenarios

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

Given:
- A user has personal triage messages ready to convert.
- The request targets an existing logic gate, or an existing node with optional logic gate context.
- The user may have view-only or edit access to those targets.

Expected:
- Conversion fails when company, messages, or target data is missing.
- Conversion refreshes the message snapshot before creating workspace records.
- Target mode is inferred when the request omits it but includes a clear node or logic gate target.
- Conversion into an existing logic gate succeeds only with edit access to that logic gate.
- Conversion into an existing node succeeds only with edit access to the node and optional logic gate context.
- Missing status defaults to Pending.
- Missing priority defaults to 3, and priority outside 1 through 5 is rejected.
- Successful conversion returns converted/deleted triage IDs for backend reconciliation, emits refresh events, and keeps the source mailbox email row visible with updated Logic Gate placement state.

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

Expected:
- A new logic gate conversion requires a title/header and creates the gate plus related work records together.
- A folder or Company Explorer parent conversion is rejected before creating or deleting any workspace/triage records.
- Rejected folder conversion must not place a node in Company Explorer, create a folder item, or insert a node row into `company_explorer_items`.
- A project conversion requires project edit access and creates the project relationship/projection records.
- Successful conversion returns converted/deleted source triage IDs, emits refresh events, and keeps source mailbox email rows visible with updated Logic Gate placement state.

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

### Scenario MT-S5: Live Triage Paging And Explicit Archive Advance

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

Given:
- A user opens My Triage or a Shared Triage primary inbox with a connected mailbox.
- The mailbox has more than 20 messages available.
- The first visible page and the next page can be read from the mailbox provider.
- The user sends mail from the personal mailbox and later receives Nylas `message.opened` webhooks for those sent messages.
- The active Nylas app has a public `/nylas/webhook` destination with Message tracking `message.opened` selected; selecting all 3 Message tracking triggers (`message.opened`, `message.link_clicked`, and `thread.replied`) is valid for this environment.
- The user composes replies, reply-all messages, forwards, drafts, scheduled messages, and messages containing links/rich text.
- The mailbox contains Inbox, All, Sent, Draft, and Spam/Junk messages.

Expected:
- The visible page contains no more than 20 messages.
- The next page is prefetched after the visible page loads.
- Created, updated, and deleted message events reconcile the affected message live without replacing the whole triage list.
- Clicking an email row, focusing the email body, and clicking back into the list do not reload, blank, or replace the message list.
- Browser focus and visibility changes do not force a message-list refresh.
- New-email realtime events with a message ID fetch that single message and insert it into the current date-sorted list when it matches the active filters.
- Updated, opened, deleted, or converted-message realtime events touch only the affected visible or selected row when the event carries enough IDs.
- Local conversion from the user's own email-to-Logic-Gate drop keeps converted source email rows in place, patches their Logic Gate icon state from the conversion result, and suppresses matching local `triage.converted` echoes without clearing all message caches, reusing stale prefetched pages, post-removal prefetching, repeated mail GETs, workspace panel GET bursts, or visible list blanking.
- The backend sets converted source emails to unstarred after successful conversion, the response includes successfully updated IDs in `unstarred_message_ids`, and the visible Home list/Starred count reconciles locally without loading replacement Starred rows.
- A successful local conversion shows a short green success notice.
- Unread rows keep their unread outline, while the top-left dot is visible only on the selected email row.
- Realtime message events that do not carry a message ID do not trigger a whole-list reload; the next explicit page/list load reconciles provider state.
- Personal sends request Nylas open tracking, and Nylas `message.opened` webhooks store personal receipt summaries keyed by the sender mailbox scope and provider message ID.
- The configured webhook secret matches `NYLAS_WEBHOOK_SECRET`; otherwise webhook POSTs are rejected and no personal receipt summary is written.
- `message.link_clicked` and `thread.replied` webhook deliveries do not create or mutate read-receipt state under the current My Triage contract.
- The Sent mailbox shows `Seen` only for messages with a stored receipt signal; messages without a signal do not show `Not opened`.
- A `message.opened` event with a message ID updates the affected sent row/detail only and preserves the rest of the visible list and prefetched page state.
- Replying to the same source email never creates more than one reply draft for that source message and mailbox scope.
- Reopening a reply draft shows the original email context above the compose editor.
- Reply, Reply All, Forward, Cc, and Bcc compose paths send through the normal personal mailbox connection and preserve local sent/reply reconciliation.
- A future scheduled send is saved as a scheduled draft, is sent through the normal personal send path when due while the app is open, and is deleted only after send succeeds.
- Rich compose controls persist sanitized rich HTML, and legacy plain text drafts still send as escaped/linkified HTML.
- Received Cc recipients are visible in message detail.
- Email body/signature/original-preview links open in a new browser tab on click.
- Node editor, logic-gate editor, and inline comment/chat links render as clickable underlined links and open on single left click.
- The All mailbox dropdown can switch between All and Spam folder, with the selected option highlighted and marked.
- Scrolling the visible page does not archive any messages and does not append another primary-inbox page.
- Clicking the advance action freezes the currently visible message IDs, shows the prefetched next page, and enqueues only the frozen previous-page IDs for background archive.
- The frozen previous-page IDs are accepted by one page-level backend archive request only after durable archive job rows are written, and provider archive mutations continue from the backend worker.
- The advance action becomes usable again immediately after the next page is shown and the previous page is queued.
- The hidden archive queue accepts at most 140 pending emails; if adding the current page would exceed that limit, the advance action is disabled until enough background archive work completes.
- Accepted archive job items survive API restart and are retried by the backend worker until each item is archived or records a final failure.
- Duplicate active archive submissions for the same message and mailbox scope do not create duplicate active job items.
- Retryable provider failures remain recorded with attempt count, last error, and next retry time.
- Successful archive job items emit archive confirmations; final failed items emit archive-failed communications events.
- Folder metadata refresh runs after the primary archive-and-next work as reconciliation only; it is coalesced, does not duplicate an in-flight folder request, and does not fetch the next email page.
- Archive confirmation events from the app backend or provider webhook reconcile pending archive bookkeeping without blanking, fully reloading, or removing rows from the currently visible prefetched page.
- Accepted background archive IDs are not treated as already archived in the frontend list cache; the current page remains stable while earlier page jobs drain in the backend.
- Starring or unstarring a message updates the row and Starred count locally, and the matching backend/provider confirmation does not blank or fully reload the active Inbox or Starred tab.
- Opening or returning to My Triage does not fire background logic-gate view repair requests for missing, inaccessible, or stale node-linked logic gate IDs.
- If the backend accepts the archive page but a later provider mutation fails or never confirms, the source email is not deleted and can remain or reappear after refresh.
- If the archive request fails after the next page is shown, the user remains on the next page and sees an archive failure.
- If there is no next page, clicking the advance action archives the visible page and leaves the list empty until more messages arrive or a refresh reloads the inbox.

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
