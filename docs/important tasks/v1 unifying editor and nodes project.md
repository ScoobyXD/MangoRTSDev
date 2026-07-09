# V1 Unifying Editor And Nodes Project

Last updated: 2026-07-08

## Purpose

MangoRTS currently has several user-facing editor and node-window implementations that look related but do not share one behavior source. This creates a product problem: a change to indentation, paste cleanup, deletion semantics, copy behavior, toolbar controls, or node-window chrome can land on one surface while another surface keeps different behavior.

This project is about unifying user-facing behavior. It is not about forcing every surface to use the same backend table, route, save controller, or persistence owner.

The desired end state is:

- One unified editor behavior source for all rich editor surfaces.
- One unified node shell behavior source for all node-window surfaces.
- Domain-specific persistence remains intact behind adapters.
- Chat stays separate from rich editor semantics.
- Node/project email pickers attach existing email only; they do not compose or send mail.
- Map work is completely out of scope for this project.

## Current Decisions

### Unified Editor

Unified editor means a change to user-facing editing semantics is made once and applies everywhere the Mango rich editor appears.

The shared semantics include, at minimum:

- Enter, Backspace, Delete, Tab, Shift+Tab, and indentation behavior.
- Copy, cut, paste, paste cleanup, linkification, and source-font normalization.
- Alphanumerical/numbered lists, bullet lists, checklist behavior, and indent guides.
- Bold, underline, font size, hyperlink creation, and table insertion where supported.
- Selection preservation, sticky collapsed-caret formatting, undo/redo routing, and keyboard shortcut routing.
- Sanitized rich HTML boundaries for saved/sent content.
- Plain-text legacy content loading through safe escaping/linkification.
- Sent email preservation of sanitized block indentation.

Target unified editor surfaces:

- Logic Gate editor text body.
- Node editor text boxes wherever the node editor appears.
- Node text box editor when a node is opened from Home, My Work, Updates, Kanban, Company Explorer/sidebar, minimized dock, or Projects.
- Project text boxes and project information editors.
- Project critical-path inline node windows.
- My Triage email compose and reply surfaces.
- Shared Triage email compose and reply surfaces.
- Email replies from an email attached to a node or project, if that reply sends or drafts real mail.

Explicitly excluded:

- Chat panes inside node/project text boxes. Chat is conversation UI, not the Mango rich editor.
- Map and legacy map-specific editor surfaces.
- Backend persistence unification for its own sake.

Persistence boundaries that must remain valid:

- Node text boxes continue to save node information/projection state.
- Logic Gate text bodies continue to save Logic Gate information/projection state.
- Project text boxes continue to save project information/projection state.
- My Triage sends and drafts continue to use personal mailbox draft/send scope.
- Shared Triage sends and drafts continue to use the selected company-owned shared mailbox scope.

### Unified Node Shell

Unified node shell means the user-facing node window frame, header, layout, and top-right action area come from one behavior source. It does not mean every node window must be opened by the same route or backed by the same page state.

The shared shell should cover:

- Header/title display and inline title behavior.
- Top-right controls such as minimize, close, open in new tab, fullscreen, delete, and future icons.
- Sizing, resizing, fullscreen, drag, dock/minimize behavior, and accessible labels where applicable.
- The three-column node workspace body: text boxes, attached emails, and chats.
- Node project placement controls when shown in the node header.
- Capability gating so unavailable actions are hidden or disabled without forking shell layout.

Target unified node shell surfaces:

- Home node popup.
- App/sidebar Company Explorer node popup.
- Minimized/dock-restored node popup.
- Updates tab row detail node popup/panel.
- Kanban or My Work node popup surfaces.
- Projects critical-path inline node window.
- Any project or page surface that opens a full node editor/window rather than a small card preview.

The backend/source data may remain different by opener. A node opened from Projects can still be opened because of a project relationship, and a node opened from Updates can still be opened because of an update row. Once a full node window appears, the shell behavior should be shared.

## Email Picker Boundary

The node/project email picker is an attachment picker. It should let a user search/select existing email and attach it to the current node/project context.

It must not:

- Compose a new email.
- Send email.
- Save email drafts.
- Contain its own compose editor.

Real email compose/reply belongs in the mail compose surfaces for My Triage/Shared Triage or in a dedicated reply surface for an attached email. Those compose/reply bodies must use the unified editor behavior.

## Splintering Inventory To Investigate

This list is not exhaustive, but it names the obvious implementation split points found before this project brief was written.

### Editor Surfaces

- `frontend/src/modules/editor/EditorDocumentSurface.tsx`
  - Main linked document editor surface.
- `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts`
  - Main editor command, paste, keyboard, selection, and outline behavior.
- `frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx`
  - Contains `NodeTextBlockEditor`, `EmailConversationPane`, `EmailPickerModal`, chat textareas, attached-email reply body textarea, and the email picker compose draft textarea.
- `frontend/src/modules/editor/NodeWorkspaceSurface.tsx`
  - Mounts node text blocks and the node/project email picker.
- `frontend/src/pages/home/HomeParts.tsx`
  - Contains `ComposePanel`, its own rich `contentEditable` body, toolbar, paste handling, `document.execCommand` calls, link creation, checklist insertion, and font-size behavior.
- `frontend/src/pages/home/HomeMailWorkspace.tsx`
  - Mounts the compose panel for My Triage/Shared Triage workflows.
- `frontend/src/modules/project-management/ProjectSummaryContent.tsx`
  - Uses `NodeTextBlockEditor` for project information text boxes and mounts `EmailPickerModal`.
- `frontend/src/modules/editor/EditorContent.tsx`
  - Main linked editor coordination and save wiring.

### Node Shell Surfaces

- `frontend/src/pages/home/HomeParts.tsx`
  - `NodeEditorPopup` implements popup sizing, fullscreen, minimize/collapse, close, delete, title, and body mounting.
- `frontend/src/app/AppSidebarChrome.tsx`
  - `AppNodeEditorPopup` has a separate node popup implementation for sidebar/app shell flows.
- `frontend/src/app/applayout.tsx`
  - Owns sidebar/explorer popup state and minimized tab restoration.
- `frontend/src/app/AppTaskbar.tsx`
  - Owns minimized project/node/Logic Gate tab affordances.
- `frontend/src/modules/project-management/ProjectSummaryContent.tsx`
  - Mounts inline node windows from project critical-path rows.
- `frontend/src/modules/kanban/KanbanOverlays.tsx`
  - Check for node popup or node detail shell behavior opened from Kanban/My Work.
- `frontend/src/pages/home/UpdatesView.tsx`
  - Check for node popup/detail surfaces opened from update rows.

### Do Not Spend Time Here

- Legacy Map/node-map behavior is out of scope for this project unless a live non-map editor or node shell imports a helper from there.
- Old documentation under `docs/important tasks/Old Stuff/` is historical only.

## Desired Implementation Shape

The future implementation pass should read existing code first and then make the smallest durable consolidation that creates one source of truth.

Recommended direction:

1. Define a shared editor behavior component/hook/module that owns the rich editing semantics.
2. Keep domain-specific adapters around it for load/save/send:
   - Node adapter.
   - Logic Gate adapter.
   - Project adapter.
   - Personal email compose/reply adapter.
   - Shared email compose/reply adapter.
3. Move paste, delete, indent, list, link, font-size, selection, and keyboard routing behavior out of one-off surface implementations and into the shared editor behavior source.
4. Replace the email compose `ComposePanel` custom rich-body behavior with the shared editor behavior through an email adapter.
5. Replace attached-email reply textarea behavior with the shared editor behavior if it sends/drafts real mail.
6. Leave chat textareas alone except for normal chat-specific fixes.
7. Remove compose/send/draft UI and logic from `EmailPickerModal`; keep search, mailbox tabs, filters, scrolling, drag, and attach/select behavior.
8. Define a shared node shell component/hook/module for node window chrome and actions.
9. Mount the same node shell from Home, sidebar/app shell, Updates, Kanban/My Work, and Projects, with capability flags for actions that are not available in every opener.
10. Keep backend save boundaries per domain; do not flatten persistence just to make code look uniform.

Implementation names are not mandated. Prefer names and module placement that fit the repo after reading current code.

## Acceptance Criteria

- Changing editor indentation, paste cleanup, Delete/Backspace behavior, copy/cut/paste behavior, list behavior, hyperlink behavior, or font-size behavior in the shared editor source changes every target editor surface.
- Node, Logic Gate, Project, My Triage, Shared Triage, and attached-email reply editor surfaces all mount the shared editor behavior or a narrow adapter around it.
- Chat panes inside node/project text blocks do not use the unified editor and do not inherit rich-editor keyboard semantics.
- Node text boxes still save to node information/projection.
- Logic Gate editor text still saves to Logic Gate information/projection.
- Project text boxes still save to project information/projection.
- Email compose/reply still sends through the correct personal or shared mailbox scope.
- Node/project email picker has no compose/send/draft controls.
- Adding a new top-right node-window action in the shared node shell makes it appear on every full node window surface where the capability is enabled.
- Home, sidebar/app shell, Updates, Kanban/My Work, and Projects node windows share shell chrome behavior instead of maintaining independent top-right action implementations.
- No implementation or verification work is spent on legacy Map behavior for this project.

## Phases

There are only two implementation phases for this project.

### Phase 1: Unify All Editors

- Confirm every current rich editor surface in code before changing implementation.
- Extract or formalize one shared editor behavior source for rich editing semantics.
- Convert node, Logic Gate, project, personal compose/reply, shared compose/reply, and attached-email reply bodies to the shared editor behavior.
- Keep persistence adapters separate for node, Logic Gate, project, personal mailbox, and shared mailbox saves.
- Remove compose/send/draft behavior from node/project `EmailPickerModal` as part of this editor boundary cleanup.
- Keep `EmailPickerModal` attach/select behavior, mail search/list UX, scrolling, filters, and drag behavior.
- Leave chat textareas outside the unified editor except for normal chat-specific fixes.
- Add focused tests proving shared command behavior and adapter mounting.
- Verify representative editor surfaces:
  - Logic Gate editor.
  - Home node text box.
  - Updates row node text box.
  - Project critical-path inline node text box.
  - Project text box.
  - My Triage compose/reply.
  - Shared Triage compose/reply.
  - Attached-email reply body.
  - Node/project email picker attach flow with no compose controls.

### Phase 2: Unify The Node Shell

- Confirm every current full node window/shell surface in code before changing implementation.
- Extract or formalize one shared node shell for node window chrome and actions.
- Convert Home, app/sidebar, Updates, Kanban/My Work, dock restore, and Projects inline node windows to the shared shell.
- Keep opener-specific state, permissions, route/deep-link handling, and backend save boundaries behind props/adapters.
- Add focused tests proving shared shell actions and representative surface mounting.
- Verify representative node shell surfaces:
  - Home node popup.
  - App/sidebar Company Explorer node popup.
  - Updates row node popup/panel.
  - Kanban/My Work node popup.
  - Dock-restored node popup.
  - Project critical-path inline node window.
