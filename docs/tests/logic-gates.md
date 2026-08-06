# Process Story: Editor link mode uses Logic Gate business commands

A user types `##` in a Node editor and selects a Logic Gate, or types `##` in a Logic Gate editor and selects a Project
↓
For a Node source, Mango requires a valid Node priority and assigns or moves the Node into the selected Logic Gate's Requested column
↓
Only a cross-Logic-Gate move creates the existing immutable transfer stamp on the Node timeline; an initial or same-gate assignment does not
↓
For a Logic Gate source, Mango creates or reuses the exact existing Logic Gate-to-Project relationship after normal source and target permission checks
↓
Both paths insert a durable target reference chip after the business command succeeds
↓
Removing the chip changes only editor content and never reverses the assignment, transfer, or Project relationship

Last updated: 2026-08-05

# Process Story: Logic Gate work continues after Logic Gate Map retirement

A user creates or opens a Logic Gate from Explorer, Home, Logic Gate Arena, Kanban, or a direct route
↓
The canonical Logic Gate record, Input/Output relationships, permissions, and GVIC assignments load through surviving APIs and caches
↓
No Logic Gate Map route, frame, coordinate payload, position store, or compatibility reader exists
↓
The Editor saves the one current final textbox document and manual Save appends saving-user history
↓
Rename, relationship, deletion, recycle, restore, attachment, email, and collaboration behavior publish the same retained domain effects
↓
No request or response reads, writes, or returns entity coordinates

# Process Story: Logic Gate documents use final storage

A user opens a Logic Gate and reads or edits its one document
↓
The existing projection-shaped read response is assembled from `logic_gate_textboxes`, exact final email relationships, and final attachment relationships
↓
Typing saves only through the editor JSON contract into `logic_gate_textboxes`, while a manual Save appends one batch to `logic_gate_textboxes_history`
↓
Deleting or recycling the Logic Gate cleans up exact final email and attachment ownership without reading or writing the legacy information/projection tables
↓
The two legacy Logic Gate tables may be retired only after the guarded copy, deployment, smoke, reconciliation, soak, snapshot, dependency, and operator-approval gates pass

Last updated: 2026-08-05

# Logic Gates Tests

Detailed Logic Gate Kanban board behavior, including subgrouping, request card footers, and card placement provenance, is covered in `docs/tests/kanbanboard.md`.

Coverage Status:
- Shared `@`/`!` people-picker palette key, fallback, and contrast behavior is covered by `tests/frontend/modules/editor/editorMentions.test.ts`.
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial overall. `backend/internal/store/editor_structured_collaboration_test.go`, the collaboration HTTP/delivery suites, and the disposable-PostgreSQL producer suite cover structured OT convergence, idempotency, snapshots/ETags, authorization, transactional Logic Gate create/update outbox rows, exact cross-instance fan-out, revocation, saved-version recovery, and derived-snapshot materialization. Frontend unit suites cover bounded rich-text operations, legacy cleanup, shared connection/health recovery, and host wiring; The dedicated production-path realtime runner and its real-browser Logic Gate workflow were removed from CI on 2026-07-28. Focused frontend and backend suites remain, while visible Logic Gate workflow acceptance is manual until replacement automation is added.

## Business Logic

LG1 - Logic gates support generated, verified, consulted, and informed GVIC assignments.
LG2 - Logic Gate Generated is a single-user slot; Verified accepts multiple explicit users.
LG3 - Logic Gate Generated and Verified assignments must use user principals, not group principals.
LG4 - Replacing Generated removes its previous user; adding Verified keeps the existing Verified users.
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
LG17 - Live Logic Gate editor typing writes the current JSON document to `logic_gate_textboxes.body_json`, advances its revision, and never writes `logic_gate_information` or `logic_gate_projection_table`.
LG18 - Logic Gate Save Settings lists saved editor versions sorted by saved timestamp, including save kind, saving user, save time, and saved text box count; automatic saved-version creation is disabled during the emergency slowness fix.
LG19 - Clicking Save flushes and acknowledges pending collaboration operations, materializes the canonical document, then creates one manual saved version batch in `logic_gate_textboxes_history`.
LG20 - Logic Gate automatic saved-version creation must not run in the background during the emergency slowness fix. If auto saved versions are re-enabled later, they must only consider active Logic Gates, must only save Logic Gates whose final document changed, and must never scan or save every Logic Gate in the system.
LG21 - Restoring a Logic Gate saved version requires confirmation and overwrites the current `logic_gate_textboxes` row from final history without creating another saved-version row.
LG22 - Logic Gate typing uses ordered 160 ms structured-operation micro-batches on one exact document queue. Stable operation IDs and server revisions serialize commit acknowledgement without overlapping whole-document projection writes or cross-target queue replacement.
LG23 - Logic Gate editor save state must use the vocabulary and behavior `has changed`, `has not changed`, `save in progress`, and `save needed after current save`. The editor is marked `has not changed` only when the completed request's version matches the latest local version.
LG24 - The Logic Gate editor exposes applying the current GVIC template to already assigned nodes as a one-shot action in the shared **More editor actions** menu, not as a persistent checkbox, fifth GVIC card, or vertical control between the title and GVIC fields.
LG25 - Pressing the Logic Gate editor's apply-to-assigned-nodes action opens an explicit Yes/No confirmation; No, cancel, or dismissal makes no write, and only Yes applies the current Logic Gate GVIC template to nodes currently assigned to that Logic Gate. Ordinary GVIC role edits remain template-only for existing assigned nodes.
LG26 - Logic Gate editor surfaces participate in the unified editor contract: changes to indent/outdent, paste cleanup, Delete/Backspace, copy/cut/paste, lists, checklist, hyperlink, font-size, bold, underline, italic, strikethrough, text highlight/No highlight, left/center/right alignment, table, and people-suggestion/entity-boundary semantics must apply to Logic Gate editor text wherever it is opened. The `@`/`!` people picker uses stable, visible per-user profile colors rather than gray-only rows.
LG27 - Logic Gate editor inline images/files must follow `docs/tests/attachments.md`: rich-editor paste/drop uses the shared editor image path, `logic_gate_textboxes.body_json` stores attachment references, and file ownership comes only from `attachments` plus `attachment_relationships`; no durable row stores data URLs or base64 file bytes.
LG28 - The Logic Gate editor toolbar must use the shared rich-editor toolbar source and shared formatting controller. Font-size minus/value/plus, Bold, Underline, Italic, Strikethrough, the Highlight split button with **No highlight**, left/center/right alignment, table insertion, and the outline-style dropdown must match node text boxes, project text boxes, mail editor surfaces, and email signatures. The highlight main hitbox applies the chosen color without opening the picker, while the arrow only opens the picker. Vibrant active styling applies only to the individual hitbox and remains distinct from hover, focus, and disabled state.
LG29 - A Logic Gate permissions view opened from the editor, Company Explorer, Home, Logic Gate Arena, Kanban, or another surviving Logic Gate entry point always displays **Save** when editable. Saving persists the current selection without closing; denied views remain dismissible and do not attempt a write. This permission action is distinct from editor saved-version Save.
LG30 - When a personal or Shared Triage email is converted into a node/card assigned to a Logic Gate, the created attached-email projection retains the source account email and, for shared mail, the shared-inbox ID. Later node email reads and mutations use that stored mailbox scope.
LG31 - Logic Gate Arena work loads use one cache-first, cancelable, single-flight loader whether the gate came from forced Arena props or the current selection.
LG32 - Changing the selected Logic Gate aborts the obsolete request, and selection generation prevents a late A response from overwriting B or a newer A selection.
LG33 - First mounted-board subscription acceptance, reconnect acceptance, and compact `kanban.changed` hints share one single-flight targeted Logic Gate work loader with at most one queued final read; they do not overlap or abort/restart an active read. A later local board handler joining an accepted shared scope receives immediate acceptance. Admission proves the owning Logic Gate exists and current Edit access applies; publication rechecks that audience so a revoked subscriber receives no later hint. No projection delta, sequence, replay, or gap protocol exists.
LG34 - The Logic Gate work response exposes only the minimal Logic Gate header/default/request-owner data, actor permission flags, board, columns, and minimal cards.
LG35 - The work ETag uses one dedicated Logic Gate work-version row plus actor permission identity/flags and a response-contract salt; authorization is evaluated before `304 Not Modified`.
LG36 - The board request owner is the Logic Gate's Generated user ID. The work payload does not ship the full GVIC assignment collection, and GVIC still does not grant resource permission.
LG37 - Logic Gate text highlighting must use the shared `EditorTabBar` split button, palette/custom/**No highlight** choices, and shared formatting controller. The main hitbox applies/toggles the selected color to a restored range or collapsed-caret pending style without opening the picker; the arrow opens the picker without applying color. Highlight reports the chosen active/pending color and round-trips through sanitized rich HTML. **No highlight** clears selected highlighting or the pending highlight typing style, and a selection ending at a line/list-item boundary must not bleed into the following sibling.
LG38 - Hydrating changed Logic Gate editor content while the editor or one of its shared toolbar controls owns focus must preserve the logical selection. The editor restores the last valid range, records text offsets before replacing the DOM, and restores those offsets afterward so toolbar focus does not move formatting to an unrelated location.
LG39 - When a Logic Gate document is hidden by Metadata, History, or Save Settings isolation, its rich editor must also be hidden and formatting commands must be disabled. Editor navigation tabs remain usable so the user can return to the document.
LG40 - Every successful Logic Gate rename entry point covered by RW15 publishes the concrete committed-title event after commit, and applicable same-window Logic Gate labels converge under RW15. An active Editor title draft/caret is preserved until editing ends; passive dock/pin updates preserve recency/storage, and no cross-user/generalized fan-out is created.
LG41 - The Logic Gate editor header keeps Editor, Permissions, the shared formatting toolbar, Outline Styles/Automatic Numbering, and the immediately adjacent More control on one nonwrapping line. Relationships, Metadata, History, Save Settings, save-version/related-node commands, and any supported secondary actions remain available in the keyboard-operable **More editor actions** menu with their existing permission and disabled states.
LG42 - Blocking Logic Gate editor dialogs and fullscreen image previews mount through the shared body-level modal portal above Key Views, Explorer, Search Explorer, and feature-local stacking contexts, trap focus while topmost, and restore prior focus when closed.
LG43 - The Generated, Verified, Consulted, and Informed cards remain in one compact four-column horizontal row. Narrowing may clip that row beneath an adjacent pane, but must not wrap it vertically or add a persistent apply/current-GVIC card.
LG44 - Reassigning a Node from Logic Gate A to Logic Gate B commits one membership change that identifies both source and destination projections. After success, A removes the Node immediately through the established canonical board refresh path and B/current consumers converge; failure leaves the existing projection intact, and duplicate local/realtime hints do not create duplicate refreshes or false membership.
LG45 - A Node popup opened from Logic Gate Arena owns its transient half/fullscreen mode locally. Realtime acceptance and canonical summary/work/view projection reconciliation may update Node/board data and titles, but reopening/reconciling the same Node must preserve fullscreen until the user exits fullscreen or closes it; opening a different Node starts from the normal saved half-view ratio.
LG46 - Each Logic Gate independently editable body is an exact collaboration document with its own server-ordered revision, snapshot, ETag, pending queue, and `editor:logic_gate:{logic_gate_id}:{document_id}` scope.
LG47 - Concurrent valid Logic Gate operations integrate automatically and converge in deterministic order; an older valid base is not rejected merely because another collaborator committed first. Stable operation IDs deduplicate retries, and no end-user whole-document conflict workflow exists.
LG48 - Unacknowledged Logic Gate operations are durable under user/company/document/client/operation identity and survive unmount, refresh, disconnect, and reconnect. Saved state advances only after backend commit acknowledgement/deduplication.
LG49 - Exact committed Logic Gate deltas reach every healthy exact subscriber through the shared outbox/backplane/spine and apply once without echo-saving. Gaps, reconnect, or saved-version replacement trigger a canonical full snapshot plus automatic pending-operation reapplication.
LG51 - A successful cross-Logic-Gate Node reassignment creates exactly one immutable Node timeline transfer stamp in the same transaction, using historical actor/source/destination name snapshots.
LG52 - Same-Logic-Gate status movement, initial assignment, and removal do not create cross-Logic-Gate transfer stamps.
LG50 - A Logic Gate document is fully healthy only after identity/Edit authorization, exact subscription acceptance, confirmed heartbeat, canonical snapshot recovery, buffered-event ordering, and pending acknowledgements complete. Orange permits durable queued typing; global red states gate interactions.
LG54 - The current product has exactly one independently editable document per Logic Gate. It has no Logic Gate textbox-chat pane, so the final model must not invent a `logic_gate_textbox_chats` table or chat API.
LG55 - The existing projection-shaped Logic Gate read contract is assembled from the one live `logic_gate_textboxes` row, its final attachment relationships, and exact `email_relationships` joined to `email_messages` and `email_threads`; this preserves the frontend response without preserving legacy storage.
LG56 - Current Logic Gate attached-email access comes only from an exact active `email_relationships` row plus normal Logic Gate permission. The cutover adds no new attach-email product surface.
LG57 - Legacy Logic Gate information writes are closed: text writes require the editor JSON contract, and unsupported legacy information types are rejected. There is no compatibility read, fallback, or dual write.
LG58 - Logic Gate deletion and recycle capture use final textbox/history, exact email relationships, and modular attachment cleanup. Removing one attachment owner retains a shared file, while final-owner cleanup follows the pending-delete, S3-before-Postgres, retry-safe lifecycle.
LG59 - Dropping `logic_gate_information` and `logic_gate_projection_table` is a separate human operation. It requires PostgreSQL 17.x, exact unordered schema evidence, a reconciled copy, no-current-writer proof, smoke/recycle verification, soak and snapshot confirmation, no surviving dependency, and explicit operator approval.
LG60 - Universal picker link mode in a Node editor may target only a Logic Gate or Project. A Logic Gate target requires a valid priority and uses the existing assignment/move command with Requested as the destination status.
LG61 - The picker does not define transfer history. The existing cross-Gate move command creates exactly one immutable transfer stamp; initial assignment, same-Gate assignment, status movement, and Project association create none.
LG62 - Universal picker link mode in a Logic Gate editor may target only a Project. It creates or reuses the exact existing Logic Gate/Project relationship and does not create a Project-scoped Logic Gate.
LG63 - Reference mode remains available for Nodes, Logic Gates, and Projects in every Logic Gate editor. Reference-chip deletion changes only the editor document and never reverses a Gate assignment, transfer, or Project association.
LG64 - A Logic Gate-to-Project link is successful only after the normal Project relationship command commits. If authorization, target existence, or another business rule rejects it, no relationship or chip is created.

## Scenarios

### Scenario LG-S1: Generated Single User And Verified Multiple Users

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
- Generated accepts exactly one user and selecting a second Generated user replaces the first.
- Verified accepts multiple users.
- Group principals are not selectable or accepted for Generated or Verified.

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
- The user switches between exact document targets while one collaboration operation is awaiting acknowledgement.
- The user opens Save Settings, changes the auto-save interval, manually saves, or waits for an auto-save interval.

Expected:
- Regular typing renders immediately and becomes a short ordered structured-operation micro-batch on the exact Logic Gate document.
- Backend Edit authorization, collaboration integration, next revision, canonical state, and outbox event commit atomically; only the acknowledgement marks Saved.
- Every healthy exact subscriber, including another tab/user/backend instance, applies the committed operation once without refresh or echo-save; unrelated scopes receive nothing.
- Manual Save flushes pending acknowledgements, materializes the canonical head, then writes one saved-version batch; automatic background version creation remains disabled.
- Confirmed restore commits a canonical replacement and compact snapshot-required event; subscribers recover the full snapshot without a whole-body socket payload.
- Disconnect/reconnect subscribes first, validates the full snapshot/ETag, orders buffered events, reapplies durable pending operations, and returns green only after convergence.
- Deletion uses an exact tombstone and a late operation cannot recreate the document. No expected-revision conflict modal, server-version choice, or retained full-body draft exists.
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
- The editor saves the latest final Logic Gate textbox document.

Expected:
- The image upload/reference behavior comes from the unified rich-editor image path, not a Logic Gate-only implementation.
- The saved `logic_gate_textboxes` document stores attachment references.
- Final Logic Gate textbox/history rows do not store durable data URLs or base64 file bytes.
- Fullscreen image preview still opens the original or highest-quality available file through the shared body-level modal layer above Key Views/Explorer/Search Explorer, traps focus while open, and restores prior focus when closed.

### Scenario LG-S8: Logic Gate Permissions Save

Business logic covered:
- LG29

Given:
- A manager or administrator opens permissions for the same Logic Gate from the editor, Logic Gate Arena, and Company Explorer.
- A second viewer can open the Logic Gate but cannot edit permission settings.

Expected:
- Every editable Logic Gate permissions view displays the shared explicit `Save` button.
- Clicking Save commits the current permission selection, reports loading or failure state, leaves the view open on success, and is not confused with the Logic Gate editor saved-version command.
- The no-access or denied state remains dismissible without issuing a permission update.

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

LG51 - Email-derived Nodes are not attached to a Logic Gate at chat creation. A later ordinary assignment is allowed, preserves selected Node priority/status behavior, and returns `created_from_email=true` immediately so the established email icon appears on the Logic Gate row/card without waiting for a refresh.
LG52 - Normal and urgent mentions committed from a Logic Gate editor use that Logic Gate's current effective GVIC assignments and roles. Node GVIC is not consulted for a Logic Gate-owned action.
LG53 - A Logic Gate GVIC mutation sends an assignment update only to a newly assigned or effective-role-changed user. Existing unchanged users, removed users, unrelated users, and the actor receive none.

### Scenario LG-S13: Final Logic Gate storage and retirement boundary

Business logic covered:
- LG17
- LG19
- LG21
- LG54
- LG55
- LG56
- LG57
- LG58
- LG59

Given:
- A user opens the current Logic Gate document, types, manually saves, restores a saved batch, and reloads it.
- The Logic Gate has a final attachment relationship and may have an exact final attached-email relationship.
- An old client attempts a legacy information/projection write.
- An operator evaluates the two legacy Logic Gate tables for retirement.

Expected:
- Current document reads and writes use `logic_gate_textboxes`; manual save and restore use `logic_gate_textboxes_history`.
- The existing projection-shaped read contains the final textbox, attachment references, and only exact active final email relationships.
- No Logic Gate chat table or chat feature is created.
- The legacy text endpoint directs the caller to editor JSON, every unsupported legacy information type is rejected, and no legacy row is written.
- Delete and recycle paths use only final Logic Gate, email, and attachment ownership rules, including shared-file retention and last-owner cleanup.
- Retirement refuses PostgreSQL drift, unsupported legacy rows, copy mismatch, missing approvals, or surviving dependencies and never uses `CASCADE`.

### Scenario LG-S18: Universal Picker Link Commands

Business logic covered:
- LG51
- LG52
- LG60
- LG61
- LG62
- LG63
- LG64

Given:
- A Node with a valid priority is assigned to Logic Gate A, and the user can edit Logic Gate B and a target Project.

When:
- The user types `##` in the Node editor and selects Logic Gate B.
- The user types `##` in Logic Gate B's editor and selects the Project twice.
- The user later removes both inserted reference chips.

Expected:
- The Node moves to Logic Gate B Requested and receives exactly one A-to-B transfer stamp.
- The Project keeps one stable existing-Logic-Gate relationship after both commands and no Project-scoped Logic Gate is created.
- Removing either chip changes only the editor document; it does not move the Node back or remove the Project relationship.
