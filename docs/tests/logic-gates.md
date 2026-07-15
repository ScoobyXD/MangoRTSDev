Last updated: 2026-07-14

# Logic Gates Tests

Detailed Logic Gate Kanban board behavior, including subgrouping, request card footers, and card placement provenance, is covered in `docs/tests/kanbanboard.md`.

Coverage Status:
- Shared `@`/`!` people-picker palette key, fallback, and contrast behavior is covered by `tests/frontend/modules/editor/editorMentions.test.ts`.
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (`backend/internal/store/editor_projection_revisions_test.go` and `backend/internal/http/projection_revision_http_test.go` cover monotonic Logic Gate revisions, stale update/delete rejection, same-base concurrency, authorized canonical 409 data, and Node/Logic Gate isolation; `tests/frontend/modules/editor/editorProjectionSync.test.ts`, `editorProjection.test.ts`, `editorDocumentSaveQueue.test.ts`, and `nodeTextBlockProjectionSaves.test.ts` cover durable user/company/tab scopes, refresh restoration, bounded retry, multi-tab conflict blocking, revision-zero create payloads, initial edit gating, ACK-only saved state, and failed-save retention; `tests/frontend/modules/editor/unifiedRichEditorContract.test.ts` covers shared rich-editor behavior; shared editor attachment tests cover durable rich-editor image attachment references)

## Business Logic

LG1 - Logic gates support generated, verified, consulted, and informed GVIC assignments.
LG2 - Logic gate generated and verified GVIC assignments are single-user slots.
LG3 - Logic gate generated and verified GVIC assignments must use a user principal, not a group principal.
LG4 - Replacing the generated or verified user on a logic gate removes the previous user for that role.
LG5 - Logic gate consulted and informed GVIC assignments may include users and user groups.
LG6 - Nodes dropped or created into a logic gate requested column store the requesting user.
LG7 - The generated user for the logic gate sees accept and deny actions for requested nodes sent by another user.
LG8 - Accepting a requested node moves it to pending and clears the request sender.
LG9 - Denying a requested node moves it to backlog and clears the request sender.
LG10 - The requesting user sees request-sent status on the requested card and can cancel the request back to backlog.
LG11 - Pasted rich text in Logic Gate editor surfaces must normalize to the app/editor font family instead of preserving source document fonts.
LG12 - Pasting selected inline text into a Logic Gate editor must not create extra blank rows above or below the pasted content from source boundary whitespace.
LG13 - New Logic Gate editor documents default to alphanumerical numbering, and the editor outline dropdown lists alphanumerical numbering before indent guides.
LG14 - The Logic Gate editor font-size control applies to selected text and, for a collapsed caret, becomes the sticky font size for subsequently typed characters until changed again. Toolbar focus and repeated plus/minus clicks preserve the saved caret and update the visible pending size/typing height rather than discarding it.
LG15 - Logic Gate editor Bold, Underline, Italic, and Strikethrough controls must toggle selected text or collapsed-caret typing semantics and must visually reflect the active or pending formatting at the current caret or selection. Italic selected with a collapsed caret remains pending after toolbar focus and applies to subsequently typed text.
LG16 - Inserting a table from the shared Logic Gate editor toolbar must insert it at the current caret/selection location, not at the top-left or beginning of the editor. A table must not inject cell-level alignment-icon controls because alignment remains in the shared header toolbar.
LG17 - Live Logic Gate editor typing writes the current text state to the Logic Gate editor projection table and must not append a full rich-text document row to `logic_gate_information` on every keystroke autosave.
LG18 - Logic Gate Save Settings lists saved editor versions sorted by saved timestamp, including save kind, saving user, save time, and saved text box count; automatic saved-version creation is disabled during the emergency slowness fix.
LG19 - Clicking Save in the Logic Gate editor flushes pending projection saves first, then creates a manual saved editor version in `logic_gate_information`.
LG20 - Logic Gate automatic saved-version creation must not run in the background during the emergency slowness fix. If auto saved versions are re-enabled later, they must only consider active Logic Gates, must only save Logic Gates whose editor projection has changed, and must never scan or save every Logic Gate in the system.
LG21 - Restoring a Logic Gate saved version requires confirmation and overwrites the current Logic Gate editor projection row from that saved version without creating another saved-version row.
LG22 - Logic Gate editor projection saves must use one-save-at-a-time, target-safe latest-content behavior: while a save is in progress, later edits update the latest queued content for their own document target without starting an overlapping persistence request. A pending value for one Logic Gate/document target must not be erased by editing another target, and queued targets drain serially in deterministic first-target order.
LG23 - Logic Gate editor save state must use the vocabulary and behavior `has changed`, `has not changed`, `save in progress`, and `save needed after current save`. The editor is marked `has not changed` only when the completed request's version matches the latest local version.
LG24 - The Logic Gate editor exposes applying the current GVIC template to already assigned nodes as a one-shot action in the shared **More editor actions** menu, not as a persistent checkbox, fifth GVIC card, or vertical control between the title and GVIC fields.
LG25 - Pressing the Logic Gate editor's apply-to-assigned-nodes action opens an explicit Yes/No confirmation; No, cancel, or dismissal makes no write, and only Yes applies the current Logic Gate GVIC template to nodes currently assigned to that Logic Gate. Ordinary GVIC role edits remain template-only for existing assigned nodes.
LG26 - Logic Gate editor surfaces participate in the unified editor contract: changes to indent/outdent, paste cleanup, Delete/Backspace, copy/cut/paste, lists, checklist, hyperlink, font-size, bold, underline, italic, strikethrough, text highlight/No highlight, left/center/right alignment, table, and people-suggestion/entity-boundary semantics must apply to Logic Gate editor text wherever it is opened. The `@`/`!` people picker uses stable, visible per-user profile colors rather than gray-only rows.
LG27 - Logic Gate editor inline images/files must follow `docs/tests/attachments.md`: rich-editor paste/drop uses the shared editor image path, and durable Logic Gate information/projection rows store attachment references instead of data URLs or base64 file bytes.
LG28 - The Logic Gate editor toolbar must use the shared rich-editor toolbar source and shared formatting controller. Font-size minus/value/plus, Bold, Underline, Italic, Strikethrough, the Highlight split button with **No highlight**, left/center/right alignment, table insertion, and the outline-style dropdown must match node text boxes, project text boxes, mail editor surfaces, and email signatures. The highlight main hitbox applies the chosen color without opening the picker, while the arrow only opens the picker. Vibrant active styling applies only to the individual hitbox and remains distinct from hover, focus, and disabled state.
LG29 - A Logic Gate permissions view opened from the editor, map, Company Explorer, or another Logic Gate entry point always displays **Save** when editable. Saving persists the current selection without closing; read-only and denied views remain dismissible and do not attempt a write. This permission action is distinct from editor saved-version Save.
LG30 - When a personal or Shared Triage email is converted into a node/card assigned to a Logic Gate, the created attached-email projection retains the source account email and, for shared mail, the shared-inbox ID. Later node email reads and mutations use that stored mailbox scope.
LG31 - Logic Gate Arena work loads use one cache-first, cancelable, single-flight loader whether the gate came from forced Arena props or the current selection.
LG32 - Changing the selected Logic Gate aborts the obsolete request, and selection generation prevents a late A response from overwriting B or a newer A selection.
LG33 - First mounted-board subscription acceptance, reconnect acceptance, and compact `kanban.changed` hints share one single-flight targeted Logic Gate work loader with at most one queued final read; they do not overlap or abort/restart an active read. A later local board handler joining an accepted shared scope receives immediate acceptance. Admission proves the owning Logic Gate exists and current View access applies; publication rechecks that audience so a revoked subscriber receives no later hint. No projection delta, sequence, replay, or gap protocol exists.
LG34 - The Logic Gate work response exposes only the minimal Logic Gate header/default/request-owner data, actor permission flags, board, columns, and minimal cards.
LG35 - The work ETag uses one dedicated Logic Gate work-version row plus actor permission identity/flags and a response-contract salt; authorization is evaluated before `304 Not Modified`.
LG36 - The board request owner is the Logic Gate's Generated user ID. The work payload does not ship the full GVIC assignment collection, and GVIC still does not grant resource permission.
LG37 - Logic Gate text highlighting must use the shared `EditorTabBar` split button, palette/custom/**No highlight** choices, and shared formatting controller. The main hitbox applies/toggles the selected color to a restored range or collapsed-caret pending style without opening the picker; the arrow opens the picker without applying color. Highlight reports the chosen active/pending color and round-trips through sanitized rich HTML. **No highlight** clears selected highlighting or the pending highlight typing style, and a selection ending at a line/list-item boundary must not bleed into the following sibling.
LG38 - Hydrating changed Logic Gate editor content while the editor or one of its shared toolbar controls owns focus must preserve the logical selection. The editor restores the last valid range, records text offsets before replacing the DOM, and restores those offsets afterward so toolbar focus does not move formatting to an unrelated location.
LG39 - When a Logic Gate document is hidden by Metadata, History, or Save Settings isolation, its rich editor must also be hidden and formatting commands must be disabled. Editor navigation tabs remain usable so the user can return to the document.
LG40 - Every successful Logic Gate rename entry point covered by RW15 publishes the concrete committed-title event after commit, and applicable same-window Logic Gate labels converge under RW15. An active Editor or Logic Gate Map title draft/caret is preserved until editing ends; passive dock/pin updates preserve recency/storage, and no cross-user/generalized fan-out is created.
LG41 - The Logic Gate editor header keeps Editor, Permissions, the shared formatting toolbar, Outline Styles/Automatic Numbering, and the immediately adjacent More control on one nonwrapping line. Relationships, Metadata, History, Save Settings, save-version/related-node commands, and any supported secondary actions remain available in the keyboard-operable **More editor actions** menu with their existing permission and disabled states.
LG42 - Blocking Logic Gate editor dialogs and fullscreen image previews mount through the shared body-level modal portal above Key Views, Explorer, Search Explorer, and feature-local stacking contexts, trap focus while topmost, and restore prior focus when closed.
LG43 - The Generated, Verified, Consulted, and Informed cards remain in one compact four-column horizontal row. Narrowing may clip that row beneath an adjacent pane, but must not wrap it vertically or add a persistent apply/current-GVIC card.
LG44 - Reassigning a Node from Logic Gate A to Logic Gate B commits one membership change that identifies both source and destination projections. After success, A removes the Node immediately through the established canonical board refresh path and B/current consumers converge; failure leaves the existing projection intact, and duplicate local/realtime hints do not create duplicate refreshes or false membership.
LG45 - A Node popup opened from Logic Gate Arena owns its transient half/fullscreen mode locally. Realtime acceptance and canonical summary/work/view projection reconciliation may update Node/board data and titles, but reopening/reconciling the same Node must preserve fullscreen until the user exits fullscreen or closes it; opening a different Node starts from the normal saved half-view ratio.
LG46 - Every Logic Gate `Text box` projection has a positive, monotonically increasing server revision. A never-created projection is written with `expected_revision: 0`; every update and delete carries the exact loaded revision. Delete advances a hidden revision tombstone, and explicit revision-zero recreation continues from that sequence.
LG47 - Logic Gate revision comparison and mutation are one transaction: exactly one same-base concurrent write wins. A stale authorized update/delete returns `409 projection_revision_conflict` with canonical current projection/revision data; authorization occurs before disclosure, and the client never automatically rebases a stale full-document overwrite.
LG48 - Logic Gate editor base revision and durable unsynced draft state are scoped by authenticated user, company, Logic Gate, browser tab, and information ID. Base/saved state advances only after backend ACK; persistence rejection stays failed/dirty in the serial queue, refresh restores only the exact matching tab scope, an ACK or resolution clears only that tab's retained key, and automatic saved-version creation remains disabled.
LG49 - A dirty Logic Gate editor with a confirmed failed write, revision conflict, or terminal authentication failure displays a large non-dismissible sync-loss modal and blocks editing. Transient delivery failures use bounded retry/backoff; resolution explicitly loads the server version or rechecks the latest revision before retrying the retained local draft, without auto-refresh or auto-logout.
LG50 - A Logic Gate document stays non-editable/loading until current identity, edit permission, and the initial projection/revision are loaded. Late hydration must not replace a locally dirty/restored draft.

## Scenarios

### Scenario LG-S1: Generated And Verified Single User Slots

Business logic covered:
- LG1
- LG2
- LG3
- LG4

Given:
- A logic gate has editable GVIC fields.
- A company user is assigned to the logic gate's generated or verified field.
- A second user is later selected for the same generated or verified field.

Expected:
- The generated or verified field accepts exactly one user.
- Group principals are not selectable or accepted for generated or verified.
- Selecting the second user replaces the first user for that role.

### Scenario LG-S2: Consulted And Informed Users And Teams

Business logic covered:
- LG1
- LG5

Given:
- A logic gate has consulted and informed GVIC fields.
- A company has users, user groups, and nested user groups.

Expected:
- Consulted and informed can include individual users.
- Consulted and informed can include user groups.
- Consulted and informed can hold multiple assignments.

### Scenario LG-S3: Requested Node Ownership

Business logic covered:
- LG6
- LG7
- LG8
- LG9
- LG10

Given:
- A logic gate has a generated user.
- Another user drops or creates a node into the requested column.

Expected:
- The requested card records the requesting user.
- The generated user sees accept and deny actions on the requested card.
- Accept moves the card to pending.
- Deny moves the card to backlog.
- The requesting user sees request-sent status and can cancel the request to backlog.

### Scenario LG-S4: Logic Gate Rich Text Editing Controls

Business logic covered:
- LG11
- LG12
- LG13
- LG14
- LG15
- LG16
- LG26
- LG28
- LG37
- LG38
- LG41
- LG43

Given:
- A user edits a Logic Gate text body.
- The user pastes styled text copied from another application.
- The user changes font size, Bold, Underline, Italic, Strikethrough, highlight/No highlight, alignment, outline style, or inserts a table.
- A document refresh arrives while the editor or one of its shared toolbar controls owns focus.

Expected:
- Pasted content renders in the Logic Gate editor's normal font family.
- Pasted inline text does not gain empty rows above or below the copied text.
- New Logic Gate editor text uses alphanumerical numbering by default, and alphanumerical numbering appears first in the outline dropdown.
- Changing font size while text is selected changes that selected text.
- Changing font size with only a caret sets the font size for the next typed characters; repeated plus/minus clicks keep that caret and pending size across toolbar focus and update the returned caret/typing height.
- Bold, Underline, Italic, and Strikethrough buttons reflect the caret or selected text state, can be active together, and affect selected text or subsequent collapsed-caret typing; Italic is not lost when toolbar focus returns to the editor.
- The highlight main hitbox immediately applies/toggles the selected color to the restored selection without opening the picker, and the arrow opens the palette without applying. At a collapsed caret, highlight or **No highlight** controls subsequent typing and survives sanitized serialization.
- Highlighting one line/list item does not mark the following sibling, while intentional multi-line selections remain supported.
- Left, center, and right alignment reflect and change the active paragraph/selected block or active-table context.
- The toolbar uses the complete shared formatting and outline controls rather than a Logic Gate-only implementation; vibrant active styling affects only the individual hitbox and remains distinct from hover/focus/disabled state.
- The primary header keeps Editor, Permissions, formatting, Outline Styles/Automatic Numbering, and the immediately adjacent More control on one nonwrapping line.
- The four GVIC cards remain in one horizontal row that may clip beneath an adjacent pane rather than wrapping into taller header content.
- Secondary destinations and commands remain in **More editor actions**.
- External hydration restores the same logical selection offsets after replacing the editor DOM, including when toolbar focus has moved the browser selection.
- Table insertion uses the current caret/selection position from the shared toolbar and does not add a cell-level alignment-icon overlay.
- The same rich editing semantics come from the unified editor behavior used by node, project, and email compose/reply editor surfaces.
- Typing `@` or `!` opens the shared people picker with a stable color keyed by normalized user ID, then email, then display name. Keyboard-active treatment adds a translucent same-color tint and the existing active rail while preserving the opaque profile avatar and tested readable contrast.

### Scenario LG-S5: Logic Gate Editor Projection Saves And Saved Versions

Business logic covered:
- LG17
- LG18
- LG19
- LG20
- LG21
- LG22
- LG23
- LG46
- LG47
- LG48
- LG49
- LG50
- LG39

Given:
- A user has edit access to a Logic Gate.
- The user types in the Logic Gate editor.
- The user switches between document targets while a projection save is in progress.
- The user opens Save Settings, changes the auto-save interval, manually saves, or waits for an auto-save interval.

Expected:
- Regular typing updates `logic_gate_projection_table` for the current editor state instead of appending repeated full-document rows to `logic_gate_information`.
- Save Settings shows saved versions with save kind, saving user, timestamp, and text box count.
- Manual Save first flushes pending projection updates, then writes one saved-version batch to `logic_gate_information`.
- Automatic saved-version creation does not run in the background during the emergency slowness fix.
- Restoring a saved version asks for confirmation and replaces the current Logic Gate editor projection with the selected saved content.
- When a user types a paragraph, the editor updates immediately and marks the editor projection as `has changed`.
- After the debounce delay, the editor starts at most one projection save for that Logic Gate editor document.
- If the user keeps typing while that save is in progress, the editor keeps the newest content in memory, marks `save needed after current save`, and does not start overlapping saves.
- When the in-progress save finishes, the editor marks the projection `has not changed` only if the completed save version is still the latest local version.
- If newer edits arrived while the save was in progress, the editor sends exactly one follow-up projection save using the newest in-memory content.
- Pending latest content for each edited document target remains queued; switching targets cannot replace another target's pending save, and the queue persists targets serially in first-target order.
- Keep the editor non-editable while identity, permissions, and the initial projection revision load; a late response cannot replace a restored or locally dirty document.
- Open one Logic Gate document in two tabs that share local storage at the same base revision and save different text concurrently; exactly one succeeds, while the stale tab retains its tab-specific local draft behind the blocking modal and cannot overwrite without an explicit latest-revision recheck. Saving or resolving one tab does not clear the other tab's retained draft.
- Fail a dirty write and verify bounded transient retry, failed-queue retention, refresh restoration for the same user/company only, terminal-auth blocking, and saved/`has not changed` state only after backend ACK.
- A stale update or delete receives canonical current data only after edit authorization; a current delete hides the projection and preserves monotonic revision history for later explicit recreation.
- Opening Metadata, History, or Save Settings hides the document and disables its formatting commands without disabling the navigation tabs needed to return.

### Scenario LG-S6: Logic Gate GVIC Apply To Assigned Nodes Action

Business logic covered:
- LG24
- LG25

Given:
- A user is editing a Logic Gate that has generated, verified, consulted, and informed GVIC fields.
- The Logic Gate has nodes already assigned to it.
- The user changes the Logic Gate's GVIC template.
- The user presses the apply-to-assigned-nodes action.

Expected:
- The apply-to-assigned-nodes action is available in **More editor actions**, and no checkbox, separate row, or fifth apply/current-GVIC card appears beside the role fields.
- Pressing the action opens an explicit Yes/No confirmation before any bulk node GVIC update is sent.
- Choosing No, canceling, or dismissing the confirmation leaves the current Logic Gate GVIC template saved but does not update existing assigned node snapshots.
- Only choosing Yes applies the current Logic Gate GVIC template to nodes currently assigned to that Logic Gate.
- Changing Generated, Verified, Consulted, or Informed directly does not implicitly apply that change to existing assigned nodes.

### Scenario LG-S7: Logic Gate Editor Images Use Mango Attachments

Business logic covered:
- LG17
- LG22
- LG26
- LG27
- LG42

Given:
- A user pastes or drops screenshots into a Logic Gate editor body.
- The editor saves the latest Logic Gate projection.

Expected:
- The image upload/reference behavior comes from the unified rich-editor image path, not a Logic Gate-only implementation.
- The saved Logic Gate projection stores attachment references.
- Logic Gate information/projection rows do not store durable data URLs or base64 file bytes.
- Fullscreen image preview still opens the original or highest-quality available file through the shared body-level modal layer above Key Views/Explorer/Search Explorer, traps focus while open, and restores prior focus when closed.

### Scenario LG-S8: Logic Gate Permissions Save

Business logic covered:
- LG29

Given:
- A manager or administrator opens permissions for the same Logic Gate from the editor, map, and Company Explorer.
- A second viewer can open the Logic Gate but cannot edit permission settings.

Expected:
- Every editable Logic Gate permissions view displays the shared explicit `Save` button.
- Clicking Save commits the current permission selection, reports loading or failure state, leaves the view open on success, and is not confused with the Logic Gate editor saved-version command.
- The view-only or denied state remains dismissible without issuing a permission update.

### Scenario LG-S9: Email Conversion Retains Mailbox Scope

Business logic covered:
- LG30

Given:
- A user converts a personal email and a Shared Triage email into nodes/cards assigned to a Logic Gate.

Expected:
- The personal attached-email projection retains `account_email`.
- The shared attached-email projection retains both `shared_inbox_id` and `account_email`.
- Reopening either message from the created node uses the stored scope for thread hydration, attachments, Reply/Reply All, drafts, and calendar invitation responses instead of falling back to another mailbox grant.

### Scenario LG-S10: Arena Work Load, Version, And Minimal Header

Business logic covered:
- LG31
- LG32
- LG33
- LG34
- LG35
- LG36
- LG40

Given:
- A Logic Gate with a Generated user is opened in Arena from forced props and the matching current selection.
- A cached snapshot exists, the user quickly changes gates, and acceptance/hints arrive while one mounted-board read is slow; another local board handler may join the accepted scope.
- The same Logic Gate is renamed successfully from each supported entry point while multiple applicable RW15 consumers are mounted; one title `contentEditable` has a live draft/caret.

Expected:
- The cached board renders immediately and the duplicate selection paths share one request.
- The obsolete gate request is aborted and cannot commit stale state.
- First/reconnect/late-handler acceptance and hints use one active targeted loader plus at most one queued final reload; no overlap/restart, broad workspace reload, projection replay, or gap protocol runs.
- Each successful rename publishes one committed-title event after commit and all non-edited mounted same-window labels converge immediately; the edited title applies its deferred update only after editing ends.
- Failed renames publish no event, and title draft/caret plus dirty or in-flight editor text remain untouched.
- The response carries `request_owner_user_id` and actor permission flags but no full GVIC, node, assignment, or status collections.
- Authorization runs before conditional-response handling, and changes that affect the representation advance its version or contract fingerprint.

### Scenario LG-S11: Cross-Gate Reassignment Converges Both Boards

Business logic covered:
- LG44

Given:
- Logic Gate A's Kanban is mounted and a Node popup reassigns that Node to Logic Gate B.
- The same successful mutation is observed locally and through realtime, or the mutation fails.

Expected:
- Success identifies A and B, removes the Node from A without refresh, and reconciles each mounted/relevant destination through the canonical board loader.
- Local and socket hints coalesce and cannot apply a duplicate projection.
- Failure emits no success invalidation and leaves A's existing Node visible.

### Scenario LG-S12: Same-Node Board Reconciliation Preserves Fullscreen

Business logic covered:
- LG31
- LG33
- LG45

Given:
- A Node popup is opened from Logic Gate Arena and the user switches it to fullscreen.
- Notification ticket/summary and board work/view reconciliation update the mounted cards and re-run the controlled same-Node open request.

Expected:
- Canonical data and title changes still apply.
- The same-Node reconciliation does not restore the half-view ratio or clear fullscreen.
- Fullscreen persists until the user explicitly exits or closes the popup.
- Closing or opening a different Node restores the normal saved half-view behavior.
