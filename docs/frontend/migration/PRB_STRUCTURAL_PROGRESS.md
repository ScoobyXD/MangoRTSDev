# PRB Structural Extraction Progress

Date: 2026-04-21

## Outcome

PRB migration goals are complete.

- App runtime is centered in `frontend/src/app/applayout.tsx`.
- Module runtime is centered in `frontend/src/modules/*`.
- Node runtime is split into canvas/doc/shared files under `frontend/src/modules/node/*`.
- Transitional migration files and compatibility shims were removed from `frontend/src`.

## Verified structure

- `frontend/src/main.tsx`
- `frontend/src/app/applayout.tsx`
- `frontend/src/app/framerightclickmenu.tsx`
- `frontend/src/app/menus/ModulePickerMenu.tsx`
- `frontend/src/modules/index.ts`
- `frontend/src/modules/content/basic.tsx`
- `frontend/src/modules/node/canvas/NodesContent.tsx`
- `frontend/src/modules/node/doc/NodeDocContent.tsx`
- `frontend/src/modules/node/shared.ts`

## Non-blocking follow-up

- Optional quality refactor: split `applayout.tsx` into smaller hooks/components for readability and tests.
