import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const frontendRoot = resolve(repoRoot, "frontend");
const testFiles = [
  resolve(frontendRoot, ".test-dist/tests/frontend/auth/authRoutes.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/api/requestJSON.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/communications/communicationsApi.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/notifications/notificationsApi.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/pages/home/homeUtils.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/pages/home/homeCommands.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/workspace/workspaceRealtime.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/workspace/workspaceSnapshotCache.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/realtime/realtimeWebSocket.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/hooks/keyboardShortcutRouting.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/app/frameLinking.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/app/framePointerRouting.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/app/preloadDashboardPlan.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/app/timelineState.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/linkingGraph.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/map/mapMode.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/node-map/relationshipProjection.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/logic-gate-map/relationshipProjection.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/node-map/relationshipSelection.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/node-map/NodeMapControls.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/node-map/deleteKeyboardRouting.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/node-map/nodeMapLayout.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/node-map/mapGridBackground.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/node-map/relationshipDeleteSummary.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/node-map/nodeMapCommands.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/node-map/nodeInlineComments.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/node-map/editorCanvasKeydownRouting.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/company-explorer/companyExplorerStore.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/company-explorer/explorerSync.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/company-explorer/treePresentation.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/folders/companyExplorerFolders.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/contextSyncContract.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/selectionCoordinator.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/kanban/shared.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/kanban/kanbanProjectionDeltas.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/kanban/kanbanBoardContentStore.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/kanban/kanbanCommands.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorTabs.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorUndoHistory.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorMentions.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/plainTextEditing.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/richTextEditing.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorScroll.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorIndentGuides.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorProjection.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorTextBlockChatHighlights.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/nodeContentChanges.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorDates.test.js"),
];
const packageFile = resolve(frontendRoot, ".test-dist/package.json");
const tscEntrypoint = resolve(frontendRoot, "node_modules/typescript/bin/tsc");

function run(command) {
  execSync(command, {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
}

run(`"${process.execPath}" "${tscEntrypoint}" -p tests/frontend/config/tsconfig.node-tests.json`);

for (const testFile of testFiles) {
  let contents = readFileSync(testFile, "utf8");
  contents = contents.replaceAll('"../../../../frontend/src/modules/node-map/relationshipProjection"', '"../../../../frontend/src/modules/node-map/relationshipProjection.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/node-map/relationshipDeleteSummary"', '"../../../../frontend/src/modules/node-map/relationshipDeleteSummary.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/node-map/nodeMapCommands"', '"../../../../frontend/src/modules/node-map/nodeMapCommands.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/node-map/nodeInlineComments"', '"../../../../frontend/src/modules/node-map/nodeInlineComments.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/node-map/NodeMapControls"', '"../../../../frontend/src/modules/node-map/NodeMapControls.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/node-map/shared"', '"../../../../frontend/src/modules/node-map/shared.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/logic-gate-map/shared"', '"../../../../frontend/src/modules/logic-gate-map/shared.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/folders/companyExplorerFolders"', '"../../../../frontend/src/modules/folders/companyExplorerFolders.js"');
  contents = contents.replaceAll('"../../../frontend/src/modules/linkingGraph"', '"../../../frontend/src/modules/linkingGraph.js"');
  contents = contents.replaceAll('"../../../frontend/src/app/frameLinking"', '"../../../frontend/src/app/frameLinking.js"');
  contents = contents.replaceAll('"../../../frontend/src/types"', '"../../../frontend/src/types.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/company-explorer/explorerSync"', '"../../../../frontend/src/modules/company-explorer/explorerSync.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/company-explorer/treePresentation"', '"../../../../frontend/src/modules/company-explorer/treePresentation.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/kanban/shared"', '"../../../../frontend/src/modules/kanban/shared.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/kanban/kanbanProjectionDeltas"', '"../../../../frontend/src/modules/kanban/kanbanProjectionDeltas.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/kanban/KanbanBoardContentStore"', '"../../../../frontend/src/modules/kanban/KanbanBoardContentStore.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/editor/plainTextEditing"', '"../../../../frontend/src/modules/editor/plainTextEditing.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/editor/richTextEditing"', '"../../../../frontend/src/modules/editor/richTextEditing.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/editor/editorUndoHistory"', '"../../../../frontend/src/modules/editor/editorUndoHistory.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/editor/editorProjection"', '"../../../../frontend/src/modules/editor/editorProjection.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/editor/editorTextBlockChatHighlights"', '"../../../../frontend/src/modules/editor/editorTextBlockChatHighlights.js"');
  contents = contents.replaceAll('"../../../frontend/src/hooks/keyboardShortcutRouting"', '"../../../frontend/src/hooks/keyboardShortcutRouting.js"');
  writeFileSync(testFile, contents, "utf8");
}

mkdirSync(resolve(frontendRoot, ".test-dist"), { recursive: true });
writeFileSync(packageFile, '{"type":"module"}\n', "utf8");

for (const testFile of testFiles) {
  console.log(`\n=== Frontend feature tests: ${testFile} ===`);
  // Running the compiled test module directly avoids Node's worker-spawn path, which is
  // blocked in some Windows sandboxes. `node:test` still reports TAP and exits non-zero
  // on failures, so this keeps the same pass/fail contract.
  run(`"${process.execPath}" "${testFile}"`);
}
