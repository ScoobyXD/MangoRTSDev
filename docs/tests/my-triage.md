Last updated: 2026-06-29

# My Triage Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: 0% (rule IDs are not mapped to automated tests yet)

## Business Logic

MT1 - My Triage is the current user's personal email triage queue and must not show another user's private triage items.
MT2 - Adding a message to My Triage requires a connected personal mailbox message ID that can be read from the user's email connection.
MT3 - Batch triage adds must clean blank message IDs, dedupe repeated IDs, and process no more than 50 messages in one request.
MT4 - Adding the same user/message pair again refreshes the stored message snapshot instead of creating a duplicate triage row.
MT5 - Removing a My Triage item only removes the current user's row for that message.
MT6 - Converting triage messages requires a company, at least one triage message, and a valid conversion target.
MT7 - Conversion must read or refresh the latest mailbox message snapshot before creating workspace records from the email.
MT8 - If the conversion mode is not explicit, the target mode is inferred from the provided node, logic gate, project, folder, parent entity, or new gate header fields.
MT9 - Converting into an existing logic gate requires edit access to that logic gate.
MT10 - Converting into an existing node requires edit access to the node and edit access to any provided logic gate context.
MT11 - Converting into a new logic gate requires a header/title and creates the logic gate, board/card records, and email-derived work item records together.
MT12 - Converting into a folder or project creates email-derived node records and places or relates them to the selected target.
MT13 - Converting into a legacy folder requires edit access to that folder, and converting into a V2 Explorer parent requires edit access to the parent container.
MT14 - Converting into a project requires project edit access and creates the project relationship/projection records needed for the new work item.
MT15 - Conversion defaults the status to Pending and priority to 3 when those values are not provided.
MT16 - Explicit conversion priority must be between 1 and 5.
MT17 - Successful conversion removes the converted messages from My Triage and returns the deleted message IDs.
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
MT32 - Background archive work must be accepted by the backend in one request per advanced page; provider mutations run behind the backend provider gate instead of occupying multiple browser request lanes.
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
- Successful conversion removes the triage messages and emits the refresh events.

### Scenario MT-S3: Convert To New Gate, Folder, Or Project

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
- A folder conversion places the new work item under the selected folder or V2 parent only when the user can edit that parent.
- A project conversion requires project edit access and creates the project relationship/projection records.
- Successful conversion removes the source triage messages and emits refresh events.

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

Given:
- A user opens My Triage or a Shared Triage primary inbox with a connected mailbox.
- The mailbox has more than 20 messages available.
- The first visible page and the next page can be read from the mailbox provider.

Expected:
- The visible page contains no more than 20 messages.
- The next page is prefetched after the visible page loads.
- Created, updated, and deleted message events reconcile the affected message live without replacing the whole triage list.
- Clicking an email row, focusing the email body, and clicking back into the list do not reload, blank, or replace the message list.
- Browser focus and visibility changes do not force a message-list refresh.
- New-email realtime events with a message ID fetch that single message and insert it into the current date-sorted list when it matches the active filters.
- Updated, opened, deleted, or converted-message realtime events touch only the affected visible or selected row when the event carries enough IDs.
- Realtime message events that do not carry a message ID do not trigger a whole-list reload; the next explicit page/list load reconciles provider state.
- Scrolling the visible page does not archive any messages and does not append another primary-inbox page.
- Clicking the advance action freezes the currently visible message IDs, shows the prefetched next page, and enqueues only the frozen previous-page IDs for background archive.
- The frozen previous-page IDs are accepted by one page-level backend archive request, and provider archive mutations continue in the background.
- The advance action becomes usable again immediately after the next page is shown and the previous page is queued.
- The hidden archive queue accepts at most 140 pending emails; if adding the current page would exceed that limit, the advance action is disabled until enough background archive work completes.
- Folder metadata refresh runs after the primary archive-and-next work as reconciliation only; it is coalesced, does not duplicate an in-flight folder request, and does not fetch the next email page.
- Archive confirmation events from the app backend or provider webhook reconcile caches/counts without blanking or fully reloading the prefetched page.
- Starring or unstarring a message updates the row and Starred count locally, and the matching backend/provider confirmation does not blank or fully reload the active Inbox or Starred tab.
- Opening or returning to My Triage does not fire background logic-gate view repair requests for missing, inaccessible, or stale node-linked logic gate IDs.
- If the backend accepts the archive page but a later provider mutation fails or never confirms, the source email is not deleted and can remain or reappear after refresh.
- If the archive request fails after the next page is shown, the user remains on the next page and sees an archive failure.
- If there is no next page, clicking the advance action archives the visible page and leaves the list empty until more messages arrive or a refresh reloads the inbox.
