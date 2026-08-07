# Node Editor Behavior And Header

Status: complete

## Requested work

- Open pinned Nodes at their normal size instead of forcing fullscreen.
- Preserve the exact first-click caret while a sleeping Node editor becomes live, without blinking its content.
- Center the timeline plus over the left rail.
- Replace the old labelled email and assignment controls with the compact mail count/plus controls, clickable current Logic Gate/Project chips, and a `##` universal linker.
- Record the first exact Project assignment as a durable compact Node timeline stamp.
- Give the Node email column a visible rounded, elevated bottom edge.

## Implementation

- The sidebar pin launch contract now sets `initialFullscreen` to false.
- Pointer activation bookmarks the clicked stable block ID/text offset and resolves it in the attached live Tiptap DOM before revealing it.
- The Node header uses the shared universal picker with only Logic Gate and Project link targets; it delegates to the existing typed assignment/relationship commands.
- New Project relationships and `project_assignment` timeline events commit atomically. Same-Project retries create no duplicate stamp.
- The email pane height reserves a bottom gutter while retaining its rounded border and shadow.

## Verification

- `npm.cmd run build` passed.
- Focused pin, caret, Node header/email, timeline, and mounted-surface tests passed.
- `wsl.exe --distribution Ubuntu ... go test ./internal/store` passed.
- `node scripts\run_all_tests.mjs` passed every frontend, production-build, backend, and infrastructure suite.
