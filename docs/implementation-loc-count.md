# Implementation Logic LOC Count

Scope:

- Included: `frontend/src/**/*.ts`, `frontend/src/**/*.tsx`, `backend/cmd/**/*.go`, `backend/internal/**/*.go`
- Excluded: tests, scripts, docs, config, declarations, CSS/HTML, SQL migrations, Terraform, lockfiles/package metadata
- Also excluded frontend pure non-runtime files: `frontend/src/types.ts`, `frontend/src/modules/company-explorer/companyExplorerTypes.ts`, `frontend/src/modules/company-explorer/index.ts`
- Line rule: code LOC excludes blank lines and comment-only lines

Total: 23,665 LOC across 112 files

By area:

| Area | Files | LOC |
| --- | ---: | ---: |
| frontend/src | 85 | 17,946 |
| backend impl | 27 | 5,719 |

Sorted by LOC, most to least:

| LOC | File |
| ---: | --- |
| 1253 | `frontend/src/modules/logic-gate-map/LogicGateMapContent.tsx` |
| 1207 | `frontend/src/modules/node-map/NodeMapContent.tsx` |
| 1064 | `frontend/src/modules/company-explorer/CompanyExplorerContent.tsx` |
| 921 | `frontend/src/modules/kanban/KanbanContent.tsx` |
| 758 | `frontend/src/modules/editor/EditorContent.tsx` |
| 752 | `frontend/src/app/applayout.tsx` |
| 568 | `frontend/src/modules/company-explorer/useCompanyExplorerSelectionBridge.ts` |
| 549 | `frontend/src/modules/node-map/NodeMapControls.ts` |
| 548 | `backend/internal/store/postgres_nodes.go` |
| 519 | `backend/internal/store/postgres_logic_gates.go` |
| 500 | `frontend/src/modules/kanban/shared.ts` |
| 483 | `backend/internal/store/postgres_company_explorer.go` |
| 451 | `backend/internal/http/kanban_handlers.go` |
| 446 | `backend/internal/store/postgres_kanban.go` |
| 417 | `frontend/src/modules/logic-gate-map/LogicGateRelationshipGraph.ts` |
| 401 | `frontend/src/modules/node-map/NodeRelationshipGraph.ts` |
| 399 | `backend/internal/store/memory_kanban.go` |
| 390 | `frontend/src/modules/logic-gate-map/LogicGateMapNodeCard.tsx` |
| 389 | `frontend/src/modules/company-explorer/treePresentation.ts` |
| 383 | `frontend/src/modules/node-map/NodeMapNodeCard.tsx` |
| 374 | `frontend/src/app/FrameChrome.tsx` |
| 334 | `frontend/src/modules/company-explorer/CompanyExplorerTreeRow.tsx` |
| 317 | `frontend/src/modules/node-map/NodeMapContextMenus.tsx` |
| 316 | `frontend/src/modules/logic-gate-map/LogicGateMapContextMenus.tsx` |
| 315 | `backend/internal/store/memory_company_explorer.go` |
| 308 | `backend/internal/store/memory_nodes.go` |
| 293 | `frontend/src/modules/editor/plainTextEditing.ts` |
| 287 | `backend/internal/store/memory_logic_gates.go` |
| 253 | `frontend/src/modules/logic-gate-map/logicGateMapRouting.ts` |
| 253 | `frontend/src/modules/node-map/nodeMapRouting.ts` |
| 252 | `frontend/src/modules/node-map/useNodeMapGraphPersistence.ts` |
| 250 | `frontend/src/modules/logic-gate-map/useLogicGateMapGraphPersistence.ts` |
| 245 | `frontend/src/modules/node-map/shared.ts` |
| 237 | `backend/internal/http/company_explorer_handlers.go` |
| 229 | `frontend/src/modules/kanban/kanbanCommands.ts` |
| 213 | `frontend/src/modules/kanban/KanbanColumnView.tsx` |
| 210 | `backend/internal/http/node_handlers.go` |
| 210 | `backend/internal/http/logic_gate_handlers.go` |
| 197 | `frontend/src/modules/company-explorer/companyExplorerTreeRows.ts` |
| 186 | `frontend/src/modules/editor/editorUndoHistory.ts` |
| 184 | `frontend/src/modules/company-explorer/CompanyExplorerTree.tsx` |
| 176 | `frontend/src/modules/editor/useEditorDocumentPersistence.ts` |
| 174 | `frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts` |
| 169 | `backend/internal/http/workspace_handlers.go` |
| 168 | `backend/internal/store/repository.go` |
| 168 | `frontend/src/modules/kanban/KanbanBoardSidebar.tsx` |
| 163 | `frontend/src/app/frameLinking.ts` |
| 162 | `frontend/src/modules/company-explorer/companyExplorerDragDrop.ts` |
| 155 | `frontend/src/modules/logic-gate-map/shared.ts` |
| 152 | `backend/internal/domain/types.go` |
| 151 | `frontend/src/modules/editor/EditorDocumentSurface.tsx` |
| 141 | `frontend/src/modules/stats/StatsContent.tsx` |
| 140 | `frontend/src/modules/linkingGraph.ts` |
| 134 | `frontend/src/modules/kanban/kanbanApi.ts` |
| 133 | `frontend/src/app/useFramePersistence.ts` |
| 132 | `backend/internal/http/map_layout_handlers.go` |
| 131 | `frontend/src/modules/node-map/NodeMapRelationshipHitLines.tsx` |
| 131 | `frontend/src/modules/logic-gate-map/LogicGateMapRelationshipHitLines.tsx` |
| 129 | `frontend/src/modules/folders/companyExplorerFolders.ts` |
| 123 | `frontend/src/modules/selectionCoordinator.ts` |
| 123 | `frontend/src/modules/node-map/relationshipProjection.ts` |
| 120 | `frontend/src/app/useFrameDragResize.ts` |
| 108 | `frontend/src/modules/logic-gate-map/useLogicGateMapViewportHandlers.ts` |
| 108 | `frontend/src/modules/node-map/useNodeMapViewportHandlers.ts` |
| 107 | `frontend/src/modules/logic-gate-map/relationshipProjection.ts` |
| 107 | `frontend/src/modules/node-map/useNodeMapGraphLoader.ts` |
| 105 | `backend/internal/http/logic_gate_relationship_handlers.go` |
| 103 | `frontend/src/modules/editor/EditorLinkedDocumentPanels.tsx` |
| 101 | `backend/internal/http/node_relationship_handlers.go` |
| 101 | `frontend/src/modules/kanban/KanbanCardView.tsx` |
| 99 | `frontend/src/app/frameLayoutTypes.ts` |
| 98 | `frontend/src/modules/company-explorer/CompanyExplorerContextMenu.tsx` |
| 94 | `backend/cmd/miraeopus-api/main.go` |
| 93 | `backend/internal/store/postgres_operations.go` |
| 88 | `backend/internal/http/operation_handlers.go` |
| 82 | `frontend/src/modules/editor/EditorTabBar.tsx` |
| 75 | `frontend/src/WidgetContent.tsx` |
| 74 | `frontend/src/modules/node-map/NodeRecordStore.ts` |
| 74 | `frontend/src/modules/logic-gate-map/LogicGateRecordStore.ts` |
| 69 | `frontend/src/modules/company-explorer/useCompanyExplorerKeyboard.ts` |
| 61 | `frontend/src/modules/editor/useEditorPreferences.ts` |
| 55 | `frontend/src/modules/editor/EditorFormattingToolbar.tsx` |
| 55 | `frontend/src/modules/map/MapContent.tsx` |
| 53 | `backend/internal/store/memory.go` |
| 52 | `frontend/src/modules/company-explorer/CompanyExplorerIcons.tsx` |
| 51 | `frontend/src/app/framerightclickmenu.tsx` |
| 50 | `frontend/src/modules/company-explorer/useCompanyExplorerTreeModel.ts` |
| 49 | `frontend/src/modules/editor/editorIndentGuides.ts` |
| 48 | `frontend/src/app/menus/ModulePickerMenu.tsx` |
| 45 | `backend/internal/http/server.go` |
| 42 | `frontend/src/hooks/keyboardShortcutRouting.ts` |
| 40 | `frontend/src/hooks/useKeyboardShortcuts.ts` |
| 38 | `frontend/src/app/DefaultViews.ts` |
| 37 | `frontend/src/modules/contextSyncContract.ts` |
| 36 | `backend/internal/store/memory_operations.go` |
| 35 | `backend/internal/http/http_helpers.go` |
| 34 | `frontend/src/modules/editor/editorScroll.ts` |
| 32 | `frontend/src/modules/editor/editorTypes.ts` |
| 28 | `frontend/src/modules/index.ts` |
| 27 | `backend/internal/store/uuid.go` |
| 26 | `frontend/src/modules/node-map/relationshipDeleteSummary.ts` |
| 23 | `frontend/src/modules/company-explorer/useCompanyExplorerVirtualTree.ts` |
| 23 | `frontend/src/modules/editor/editorTabs.ts` |
| 22 | `frontend/src/modules/editor/editorProjection.ts` |
| 18 | `frontend/src/modules/company-explorer/explorerSync.ts` |
| 17 | `frontend/src/modules/node-map/nodeMapCommands.ts` |
| 10 | `frontend/src/modules/node-map/eventbus.ts` |
| 9 | `frontend/src/main.tsx` |
| 8 | `backend/internal/store/postgres.go` |
| 7 | `frontend/src/app/framePointerRouting.ts` |
| 6 | `frontend/src/app/frame.tsx` |
| 6 | `frontend/src/app/framecanvas.tsx` |
