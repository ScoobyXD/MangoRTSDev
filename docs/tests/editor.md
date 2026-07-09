Last updated: 2026-07-08

# Unified Editor Tests

Coverage Status:
- Business Logic Covered By Scenarios: 100%
- Business Logic Covered By Automated Tests: Partial (`tests/frontend/modules/editor/unifiedRichEditorContract.test.ts` covers the unified surface contract, mail compose/attached-reply adapter mounting, and EmailPickerModal attach-only source guard; shared editing primitives also have rich/plain editor module tests)

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

Given:
- A user can edit a Logic Gate body, a node text box, a project text box, a My Triage compose body, and a Shared Triage compose body.
- The implementation changes indentation, paste cleanup, list behavior, hyperlink creation, font size, Delete/Backspace, copy/cut/paste, or keyboard routing.

Expected:
- The behavior change is made in the shared editor behavior source or deliberately shared helper.
- Each target surface receives the same user-facing semantics.
- No target surface keeps a separate local implementation that disagrees with the shared behavior.
- Tests cover the shared behavior once and prove each adapter/mount uses that shared behavior.
- Mail compose/reply adapters do not call browser `document.execCommand` directly for rich editing commands when a shared editor command exists.

### Scenario ED-S2: Domain Persistence Stays Separate

Business logic covered:
- ED1
- ED3

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

Given:
- A user writes a personal compose, personal reply, shared compose, shared reply, or attached-email reply body.
- The body contains links, pasted content, rich formatting, indented blocks, or legacy plain text loaded from a draft.

Expected:
- The body editor uses the shared editor behavior.
- Legacy plain text loads safely as escaped/linkified rich content.
- Sent or saved rich content is sanitized.
- Indented blocks remain indented in sent HTML instead of flattening.

### Scenario ED-S4: Chat Is Excluded

Business logic covered:
- ED9

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

Given:
- A user opens an email picker from a node or project surface.

Expected:
- The picker allows finding, filtering, scrolling, dragging, and attaching an existing email where permitted.
- The picker does not allow composing a new email.
- The picker does not send email, schedule email, save drafts, or mount a compose body editor.

### Scenario ED-S6: Map Is Out Of Scope

Business logic covered:
- ED11

Given:
- A V1 unified editor implementation pass is changing rich editor behavior.

Expected:
- The pass does not spend implementation or verification time on legacy Map behavior.
- Map code is touched only if a shared helper used by live non-map editor surfaces requires a compatible update.
