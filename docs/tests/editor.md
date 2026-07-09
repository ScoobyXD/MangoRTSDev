Last updated: 2026-07-09

# Unified Editor Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (`tests/frontend/modules/editor/unifiedRichEditorContract.test.ts` covers the unified surface contract, full mail compose/attached-reply control exposure, shared controller wiring, and EmailPickerModal attach-only source guard; shared editing primitives also have rich/plain editor module tests, including automatic outline numbering toggle behavior and the durable rich-editor image attachment reference source)

## Business Logic

ED1 - Unified editor means shared user-facing editing semantics across rich editor surfaces; it does not require one shared backend table, API route, save controller, or storage owner.
ED2 - The unified editor contract applies to Logic Gate editor text, node editor text boxes wherever a node editor is opened, project text boxes, project inline critical-path node windows, My Triage compose/reply, Shared Triage compose/reply, and attached-email reply bodies that send or draft real mail.
ED3 - Node text boxes must keep saving through node information/projection persistence, Logic Gate text through Logic Gate information/projection persistence, project text boxes through project information/projection persistence, personal compose/reply through personal mailbox draft/send scope, and shared compose/reply through the selected shared mailbox scope.
ED4 - Editing semantics for Enter, Backspace, Delete, Tab, Shift+Tab, indent/outdent, copy, cut, paste, paste cleanup, source-font normalization, linkification, undo/redo routing, selection preservation, and keyboard shortcut routing must come from one shared editor behavior source or a deliberately shared helper used by every target surface.
ED5 - Rich controls for numbered/alphanumerical lists, bullet lists, checklist, indent guides, font size, bold, underline, hyperlink creation, and table insertion where supported must not be reimplemented per surface with divergent semantics.
ED6 - Pasted rich text in any unified editor surface must normalize to the app/editor font family and must not add extra blank rows around selected inline pasted text because of source boundary whitespace.
ED7 - Legacy plain text loaded into a unified rich editor surface must load through safe escaping/linkification and must not bypass the same sanitization boundary used for rich HTML.
ED8 - Email compose/reply bodies using the unified editor must send sanitized rich HTML and preserve sanitized block indentation, including indent/outdent and blockquote-style indentation.
ED9 - Chat panes inside node/project text boxes are conversation UI, not unified editor surfaces; chat textareas must not inherit rich editor toolbar, indentation, paste, or delete semantics unless a future chat-specific rule explicitly adds that behavior.
ED10 - Node/project email pickers are attach/select surfaces only and must not expose compose, send, scheduled send, or draft-save behavior.
ED11 - Map and legacy map-specific editing behavior is outside the V1 unified editor project unless a live non-map editor surface imports a helper that must be changed for the shared contract.
ED12 - Any future change to unified editor semantics must update one shared behavior test plus adapter/mount coverage proving each target surface receives the shared behavior.
ED13 - The V1 shared rich editor behavior source is the editor module handler contract behind `useEditorDocumentSurfaceHandlers`; target surfaces must either call that handler directly or mount a narrow adapter such as `UnifiedRichEditorSurface`, while preserving their own persistence/send adapter.
ED14 - Mail compose/reply and attached-email reply must expose the shared editor format/outline toolbar controls for font size, bold, underline, the outline-style dropdown, and table insertion where supported; mail-specific wrapper controls may add list insertion, indent/outdent, and link commands, but must call the shared editor controller instead of local DOM commands.
ED15 - Nodes opened from Projects participate in the same unified editor contract in both project entry paths: the Critical Path inline node window and the Logic Gates / Nodes tab double-click opener. The Logic Gates / Nodes opener may route to the standard standalone node popup, but the node text boxes inside that popup must still use the shared node editor behavior rather than a project-local editor implementation.
ED16 - The Logic Gate editor text body is a unified editor surface.
ED17 - Node editor text boxes are unified editor surfaces wherever a full node editor is opened, including Home, My Work, Updates, Kanban, Company Explorer/sidebar, minimized dock restore, Project critical-path inline node windows, and Project Logic Gates / Nodes double-click node popups.
ED18 - Project text boxes and project information editors are unified editor surfaces.
ED19 - My Triage email compose and reply bodies are unified editor surfaces.
ED20 - Shared Triage email compose and reply bodies are unified editor surfaces.
ED21 - Attached-email reply bodies opened from an email attached to a node or project are unified editor surfaces when that reply sends or drafts real mail.
ED22 - Chat panes inside node or project text boxes are explicitly not unified editor surfaces; they are conversation UI with chat-specific behavior.
ED23 - Node and project email pickers are explicitly not compose editor surfaces; they may search, filter, scroll, drag, and attach existing email, but they must not contain compose, send, scheduled send, draft-save, or rich body editing behavior.
ED24 - Map and legacy map-specific editor surfaces are explicitly outside the V1 unified editor contract unless they import a helper that is actively shared by a live non-map unified editor surface.
ED25 - Backend persistence unification is explicitly outside the unified editor contract; shared editing behavior must not force node, Logic Gate, project, personal mailbox, shared mailbox, or attached-email reply content into one storage owner.
ED26 - Rich-editor pasted or dropped inline images in unified editor surfaces must follow the global attachment contract in `docs/tests/attachments.md`: temporary previews are allowed, but durable editor/email content stores attachment references instead of data URLs or base64 bytes.
ED27 - Chat attachments remain outside the unified rich-editor contract; they must use the global attachment contract as chat attachments rather than inheriting rich-editor body semantics.

## Scenarios

### Scenario ED-S1: Shared Editing Semantics Across Target Surfaces

Business logic covered:
- ED1
- ED2
- ED4
- ED5
- ED6
- ED12
- ED13
- ED14
- ED15
- ED16
- ED17
- ED18
- ED19
- ED20
- ED21

Given:
- A user can edit a Logic Gate body, a node text box, a project text box, a My Triage compose body, a Shared Triage compose body, and an attached-email reply body.
- A user can open a node from a Project critical-path row and by double-clicking a node in the Project Logic Gates / Nodes tab.
- The implementation changes indentation, paste cleanup, list behavior, hyperlink creation, font size, Delete/Backspace, copy/cut/paste, or keyboard routing.

Expected:
- The behavior change is made in the shared editor behavior source or deliberately shared helper.
- Each target surface receives the same user-facing semantics.
- The unified editor target inventory is Logic Gate editor text, node editor text boxes from every full node editor opener, project text boxes/information editors, My Triage compose/reply, Shared Triage compose/reply, and attached-email reply bodies that send or draft real mail.
- Project critical-path node text boxes and Project Logic Gates / Nodes standalone node-popup text boxes receive the same node editor semantics.
- No target surface keeps a separate local implementation that disagrees with the shared behavior.
- Tests cover the shared behavior once and prove each adapter/mount uses that shared behavior.
- Mail compose/reply adapters do not call browser `document.execCommand` directly for rich editing commands when a shared editor command exists.
- Mail compose/reply and attached-email reply adapters expose numbered list, indent, outdent, bullet list, checklist, font size, bold, underline, link, and table controls where table insertion is supported.
- Font size, bold, underline, outline-style dropdown, and table insertion are supplied by the shared editor toolbar control source rather than a compose-only or attached-reply-only toolbar implementation.

### Scenario ED-S2: Domain Persistence Stays Separate

Business logic covered:
- ED1
- ED3
- ED25

Given:
- A user edits node, Logic Gate, project, personal email, and shared email rich editor content.

Expected:
- Node edits persist to node information/projection state.
- Logic Gate edits persist to Logic Gate information/projection state.
- Project edits persist to project information/projection state.
- Personal email compose/reply sends or drafts through the personal mailbox scope.
- Shared email compose/reply sends or drafts through the selected shared mailbox scope.
- The shared editor behavior does not force unrelated domains into one backend persistence path.

### Scenario ED-S3: Email Compose And Reply Use Unified Rich Editing

Business logic covered:
- ED2
- ED7
- ED8
- ED14
- ED19
- ED20
- ED21

Given:
- A user writes a personal compose, personal reply, shared compose, shared reply, or attached-email reply body.
- The body contains links, pasted content, rich formatting, indented blocks, or legacy plain text loaded from a draft.

Expected:
- The body editor uses the shared editor behavior.
- Legacy plain text loads safely as escaped/linkified rich content.
- Sent or saved rich content is sanitized.
- Indented blocks remain indented in sent HTML instead of flattening.
- Numbered-list toolbar actions create or toggle a shared automatic numbered/alphanumerical list item rather than only changing an outline-style setting.
- The visible mail toolbar includes the shared font-size control, bold/underline controls, and outline-style dropdown used by the main editor.

### Scenario ED-S4: Chat Is Excluded

Business logic covered:
- ED9
- ED22

Given:
- A user opens a chat pane inside a node or project text block.

Expected:
- Chat remains a conversation composer.
- Chat does not show the unified rich editor toolbar.
- Chat does not receive rich editor indentation, paste, delete, list, or font-size semantics.
- Chat-specific quote/prefill and mention behavior can continue independently.

### Scenario ED-S5: Node And Project Email Picker Is Attach Only

Business logic covered:
- ED10
- ED23

Given:
- A user opens an email picker from a node or project surface.

Expected:
- The picker allows finding, filtering, scrolling, dragging, and attaching an existing email where permitted.
- The picker does not allow composing a new email.
- The picker does not send email, schedule email, save drafts, or mount a compose body editor.

### Scenario ED-S6: Map Is Out Of Scope

Business logic covered:
- ED11
- ED24

### Scenario ED-S7: Unified Rich-Editor Images Use Mango Attachments

Business logic covered:
- ED2
- ED3
- ED13
- ED26
- ED27

Given:
- A user pastes or drops an image into a node text box, Logic Gate editor body, project text box, My Triage compose/reply body, Shared Triage compose/reply body, or attached-email reply body.
- A user separately attaches an image to a node/project chat.

Expected:
- The rich-editor image insertion path comes from the shared editor handler contract.
- Durable saved rich-editor content stores attachment references, not `data:image/...;base64` or durable `dataURL` values.
- Each rich-editor surface still saves or sends through its own node, Logic Gate, project, personal mailbox, or shared mailbox adapter.
- Chat attachment behavior follows `docs/tests/attachments.md` as chat attachment behavior and does not become unified rich-editor content.

Given:
- A V1 unified editor implementation pass is changing rich editor behavior.

Expected:
- The pass does not spend implementation or verification time on legacy Map behavior.
- Map code is touched only if a shared helper used by live non-map editor surfaces requires a compatible update.
