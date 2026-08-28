# MangoRTS icon library

This folder is the source of truth for reusable MangoRTS icons.

Import icons through the public index:

```tsx
import { ExplorerRowIcon, HeaderSettingsIcon } from "../../icons/index.js";
```

Files:

- `NavigationIcons.tsx`: application navigation and header icons.
- `EntityIcons.tsx`: node, Logic Gate, project, Entity, and email icons.
- `ExplorerIcons.tsx`: folders, entities, Kanban boards, and disclosure arrows.
- `KanbanBoardIcon.tsx`: the Kanban board icon.
- `MangoBrand.tsx`: the MangoRTS mark and wordmark.
- `EditorSelectionNodeIcon.tsx`: the editor selection-to-node action.

Small SVGs that only make sense inside one control can remain beside that control. Move an icon here when it is reused or represents a named MangoRTS concept.

Run this from the repository root after changing the library:

```powershell
npm.cmd --prefix frontend run icons:export
```

That regenerates `docs/frontend/mangorts-icon-catalog.html`, the standalone file that can be sent to a designer.
