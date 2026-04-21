# FRAME/MODULE MIGRATION HANDOFF FOR NEW CODEX INSTANCE

## Purpose of this handoff
This document is a full context transfer for the next Codex instance to finish the migration plan in two phases:

- **PRA** = naming migration (safe, no behavior changes)
- **PRB** = structural extraction (move logic out of `App.tsx`)

This handoff is intentionally exhaustive so the new instance can continue without prior chat context.

---

## Product language and architectural intent (non-negotiable)

### Core model
- A **frame data model** is the UI container users can place/size/reorder.
- A **module** is functionality loaded inside a frame.
- Frames can host node submodules (`Node Canvas`, `Node Doc`) and be linked.

### Naming preferences from product owner
Use names that are self-explanatory without parenthetical explanation:
- `frame data model`
- `frame`
- `framecanvas`
- `framerightclickmenu`
- `ModulePickerMenu`
- `applayout`

Do **not** introduce vague names that require explanation.

---

## Current repository state (important)

### Migration progress completed
1. `FrameDataModel` was added as the primary model type.
2. `Widget` remains as a temporary alias for backward compatibility.
3. `src/modules` registry exists (`MODULE_LIBRARY`, `MODULE_CONTENT_MAP`).
4. `src/widgets/index.ts` is now a compatibility shim re-exporting modules.
5. `main.tsx` points to `app/applayout`.
6. `docs/LLM.md` includes mandatory documentation rule.

### Files to inspect first
- `frontend/src/App.tsx`
- `frontend/src/types.ts`
- `frontend/src/modules/index.ts`
- `frontend/src/widgets/index.ts`
- `frontend/src/app/applayout.tsx`
- `frontend/src/app/frame.tsx`
- `frontend/src/app/framecanvas.tsx`
- `frontend/src/app/framerightclickmenu.tsx`
- `frontend/src/app/menus/ModulePickerMenu.tsx`
- `frontend/src/WidgetContent.tsx`
- `docs/frontend/modules/nodes.md`
- `docs/LLM.md`

---

## Functional features already present (must not regress)

### Node Canvas / Node Doc
- Node Canvas + Node Doc module kinds exist.
- Linking between Node Canvas and Node Doc exists via localStorage map.
- Node Doc follows linked Node Canvas selected node.
- Text boxes can be created/moved/resized and persisted as node information.

### Selection and linking UX
- Multi-select for module containers exists.
- Link action appears in context menu and can link Node Canvas + Node Doc.

### Persistence keys currently in use
- Node doc links: `node-doc-widget-links-v1`
- Canvas state: `node-canvas-state-v3:<companyID>:<widgetId-or-global>`

Do not change these keys unless adding an explicit migration.

---

## PRA plan (PR A): naming migration only

### Goal
Convert runtime naming from `widget`-centric to `frame/module`-centric in code identifiers while preserving behavior exactly.

### Scope
- `frontend/src/App.tsx` rename identifiers only:
  - `WidgetCard` -> `Frame`
  - `FloatingMenu` -> `FrameRightClickMenu`
  - `selectedWidgetId(s)` -> `selectedFrameId(s)`
  - `widgetMenu` -> `frameRightClickMenu`
  - `addWidget`/`duplicateWidget` etc -> frame equivalents
  - internal arrays `widgets` -> `frames`
- Keep backward compatibility for persisted storage shape where needed.

### Rules
- No functional changes.
- No interaction changes.
- No API contract changes.
- Build must pass.

### PRA acceptance criteria
- `npm run build` passes.
- No runtime behavior differences in:
  - drag/resize
  - frame selection
  - module switching
  - node canvas/doc linking
  - context menus
- No new `widget*` identifiers in `App.tsx` except explicit compatibility comments.

---

## PRB plan (PR B): structural extraction

### Goal
Decompose large app logic from `App.tsx` into app-layer files while preserving behavior.

### Target ownership
- `app/applayout.tsx`: composition and top-level orchestration
- `app/framecanvas.tsx`: board rendering + interaction container
- `app/frame.tsx`: one frame render + header/body shell
- `app/framerightclickmenu.tsx`: context menu logic/presentation
- `app/menus/ModulePickerMenu.tsx`: module picker and node submodule chooser

### PRB extraction approach
- Move code in small chunks (component by component).
- Preserve prop contracts first, then simplify.
- Keep a thin compatibility export from `App.tsx` during transition if needed.

### PRB acceptance criteria
- `App.tsx` is slim orchestration, not a giant implementation file.
- Extracted components are actually used (not placeholders only).
- Behavior parity with pre-extraction version.
- `npm run build` passes.

---

## Documentation requirements for both PRA and PRB

### Mandatory policy
`docs/LLM.md` requires every code change to be documented in corresponding docs.

### Required docs updates
- `docs/frontend/modules/nodes.md`
  - keep in sync with Node Canvas/Doc behaviors
  - update naming references to frame/module terms
- Add/maintain migration notes file(s) under `docs/frontend/migration/` for PRA/PRB progress.

### PR checklist for new instance
- [ ] code changes
- [ ] docs updated in same PR
- [ ] build passes
- [ ] no accidental behavior regressions

---

## Guardrails and anti-patterns to avoid

1. Do not do giant destructive renames in one shot without compiling iteratively.
2. Do not remove compatibility alias (`Widget`) until all references are migrated.
3. Do not break persistence key compatibility.
4. Do not silently change linked-node behavior in Node Doc.
5. Do not leave placeholder app files unused in final PRB.

---

## Suggested execution order for the next Codex instance

1. Create PRA branch changes:
   - rename identifiers in `App.tsx`
   - keep behavior stable
   - compile after each rename group
2. Update docs for PRA
3. Run build and commit PRA
4. Create PRB branch changes:
   - extract components into app files
   - wire usage
   - compile frequently
5. Update docs for PRB
6. Run build and commit PRB

---

## Commands the next instance should run frequently

```bash
cd frontend
npm run build
```

Optional while refactoring:
```bash
cd frontend
npm run dev
```

---

## Final success definition
The migration is complete when:
- runtime and code naming are frame/module-first,
- app structure is decomposed (not concentrated in `App.tsx`),
- all behaviors still work,
- docs are updated with every change,
- and PRA + PRB are delivered as clean, reviewable steps.
