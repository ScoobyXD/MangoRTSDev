import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const frontendRoot = resolve(repoRoot, "frontend");
const testFiles = [
  resolve(frontendRoot, ".test-dist/tests/frontend/auth/cognitoAuth.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/auth/authRoutes.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/api/requestJSON.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/huddles/logicGateConversion.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/huddles/huddleUI.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/huddles/huddleActionItems.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/huddles/huddleNodeWorkspace.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/attachments/attachmentApi.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/attachments/emailDraftResourceIdentity.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/attachments/attachmentDirectUpload.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/attachments/attachmentHash.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/attachments/attachmentPresentation.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/accounts/accountsApi.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/communications/outboundEmailUndo.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/communications/communicationsApi.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/communications/emailQuotedContent.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/communications/emailThreadMessages.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/communications/emailCollaborationContracts.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/notifications/notificationsApi.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/grouping/universalStatusGrouping.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/my-work/myWorkApi.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/my-work/myWorkGrouping.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/my-work/myWorkWindowing.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/project-management/projectRelationshipGrouping.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/project-management/projectManagementApi.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/project-management/projectListView.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/entities/entitiesApi.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/entities/entitiesChoiceConfig.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/entities/entitiesPageModel.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/project-management/projectTimelineDocument.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/pages/home/homeUtils.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/pages/home/emailReadReceipts.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/pages/home/emailForwarding.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/pages/home/emailCollaborationRows.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/pages/home/emailCollaborationChat.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/pages/home/updatesSelection.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/pages/home/updatesGrouping.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/pages/home/homeCommands.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/pages/home/homeMailDrafts.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/pages/home/homeMailboxRealtime.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/realtime/realtimeWebSocket.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/process-map/processMapGeometry.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/process-map/processMapApi.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/process-map/processMapInteraction.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/process-map/processMapContract.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/hooks/keyboardShortcutRouting.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/app/frameLinking.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/app/framePointerRouting.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/app/deepLinkRoutes.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/app/sidebarPinsApi.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/app/sidebarPinDrops.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/app/sidebarPinTree.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/app/raciTabs.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/app/sidebarLogicGateStatusCounts.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/app/sidebarPinPopup.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/app/preloadDashboardPlan.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/app/myWorkRoutingContract.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/app/timelineState.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/app/committedTitleCacheReconciliation.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/linkingGraph.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/nodes/relationshipRules.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/nodes/nodeRelationshipStructure.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/nodes/nodeRecordStore.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/company-explorer/companyExplorerStore.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/company-explorer/companyExplorerLazyApi.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/company-explorer/companyExplorerRACIVisibility.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/company-explorer/selectionSync.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/company-explorer/treePresentation.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/folders/companyExplorerFolders.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/contextSyncContract.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/selectionCoordinator.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/kanban/shared.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/kanban/kanbanApi.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/kanban/kanbanBoardContentStore.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/kanban/kanbanCommands.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/kanban/kanbanRealtimeRefresh.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/kanban/nodeEditorOverlayViewMode.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/kanban/overlayClamp.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorTabs.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorExitHistory.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorTrace.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorUndoHistory.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorInputBatch.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorMentions.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorEntityLinks.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/emailThreadDownloadStatus.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorSuggestionMenuPosition.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/chatEntityLinks.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorChatEntityPersistence.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/plainTextEditing.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/unifiedRichEditorContract.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorImageHydration.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/emailSignatureBody.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorOpenPerformanceContract.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/emailViewerContract.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/richTextEditing.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorRichClipboard.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorScroll.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorIndentGuides.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorProjection.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/emailTextBoxRelationships.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/nodeTextBlockCreation.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/mangoTiptapFoundation.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/mangoTiptapRichClipboard.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/nodeTextBlockProjectionSaves.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/nodeTextBlockAttachments.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/nodeTextBlockDeletion.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorTextBlockChatHighlights.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/nodeTimelineActivity.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorDates.test.js"),
  resolve(frontendRoot, ".test-dist/tests/frontend/modules/logic-gates/qdRatingsApi.test.js"),
];
const componentTests = [
  {
    source: resolve(repoRoot, "tests/frontend/modules/hierarchy/hierarchyBreadcrumb.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/modules/hierarchy/hierarchyBreadcrumb.test.js"),
  },
  {
    source: resolve(repoRoot, "tests/frontend/modules/process-map/processMapSurface.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/modules/process-map/processMapSurface.test.cjs"),
    bundleDependencies: true,
    processMapComponentHarness: true,
  },
  {
    source: resolve(repoRoot, "tests/frontend/modules/communications/EmailQuotedHistory.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/modules/communications/EmailQuotedHistory.test.js"),
  },
  {
    source: resolve(repoRoot, "tests/frontend/modules/huddles/logicGateKPISection.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/modules/huddles/logicGateKPISection.test.js"),
  },
  {
    source: resolve(repoRoot, "tests/frontend/modules/huddles/huddleActionItemsPanel.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/modules/huddles/huddleActionItemsPanel.test.js"),
  },
  {
    source: resolve(repoRoot, "tests/frontend/modules/my-work/MyWorkContent.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/modules/my-work/MyWorkContent.test.js"),
  },
  {
    source: resolve(repoRoot, "tests/frontend/modules/logic-gates/logicGateQDTracker.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/modules/logic-gates/logicGateQDTracker.test.js"),
  },
  {
    source: resolve(repoRoot, "tests/frontend/modules/editor/mangoTiptapEditorIntegration.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/mangoTiptapEditorIntegration.test.js"),
  },
  {
    source: resolve(repoRoot, "tests/frontend/modules/editor/editorRowVirtualizationReact.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorRowVirtualizationReact.test.js"),
  },
  {
    source: resolve(repoRoot, "tests/frontend/modules/editor/sharedEmailDraftsReact.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/sharedEmailDraftsReact.test.js"),
  },
  {
    source: resolve(repoRoot, "tests/frontend/modules/editor/nodeTextBlockEditorHydration.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/nodeTextBlockEditorHydration.test.js"),
  },
  {
    source: resolve(repoRoot, "tests/frontend/modules/editor/editorToolbarInteractions.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorToolbarInteractions.test.js"),
  },
  {
    source: resolve(repoRoot, "tests/frontend/modules/editor/attachmentCountDropdown.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/attachmentCountDropdown.test.js"),
  },
  {
    source: resolve(repoRoot, "tests/frontend/modules/editor/raciAssignmentHover.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/raciAssignmentHover.test.js"),
  },
  {
    source: resolve(repoRoot, "tests/frontend/modules/editor/editorTextBlockChatNavigation.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/modules/editor/editorTextBlockChatNavigation.test.js"),
  },
  {
    source: resolve(repoRoot, "tests/frontend/app/sidebarPinnedSection.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/app/sidebarPinnedSection.test.js"),
  },
  {
    source: resolve(repoRoot, "tests/frontend/pages/home/emailChatGroupingUI.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/pages/home/emailChatGroupingUI.test.js"),
  },
  {
    source: resolve(repoRoot, "tests/frontend/pages/home/composeRecipients.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/pages/home/composeRecipients.test.js"),
  },
  {
    source: resolve(repoRoot, "tests/frontend/app/raciTabsLazySection.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/app/raciTabsLazySection.test.js"),
  },
  {
    source: resolve(repoRoot, "tests/frontend/app/raciTabsMoveAndLive.test.tsx"),
    file: resolve(frontendRoot, ".test-dist/tests/frontend/app/raciTabsMoveAndLive.test.js"),
  },
];
const packageFile = resolve(frontendRoot, ".test-dist/package.json");
const tscEntrypoint = resolve(frontendRoot, "node_modules/typescript/bin/tsc");
const frontendRequire = createRequire(resolve(frontendRoot, "package.json"));
const { build, buildSync } = frontendRequire("esbuild");

function run(command, extraEnv = {}) {
  execSync(command, {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
}

run(`"${process.execPath}" "${tscEntrypoint}" -p tests/frontend/config/tsconfig.node-tests.json`);

for (const testFile of testFiles) {
  let contents = readFileSync(testFile, "utf8");
  contents = contents.replaceAll('"../../../../frontend/src/modules/folders/companyExplorerFolders"', '"../../../../frontend/src/modules/folders/companyExplorerFolders.js"');
  contents = contents.replaceAll('"../../../frontend/src/modules/linkingGraph"', '"../../../frontend/src/modules/linkingGraph.js"');
  contents = contents.replaceAll('"../../../frontend/src/app/frameLinking"', '"../../../frontend/src/app/frameLinking.js"');
  contents = contents.replaceAll('"../../../frontend/src/types"', '"../../../frontend/src/types.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/company-explorer/selectionSync"', '"../../../../frontend/src/modules/company-explorer/selectionSync.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/company-explorer/treePresentation"', '"../../../../frontend/src/modules/company-explorer/treePresentation.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/kanban/shared"', '"../../../../frontend/src/modules/kanban/shared.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/kanban/KanbanBoardContentStore"', '"../../../../frontend/src/modules/kanban/KanbanBoardContentStore.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/editor/plainTextEditing"', '"../../../../frontend/src/modules/editor/plainTextEditing.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/editor/unifiedRichEditorContract"', '"../../../../frontend/src/modules/editor/unifiedRichEditorContract.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/editor/richTextEditing"', '"../../../../frontend/src/modules/editor/richTextEditing.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/communications/emailQuotedContent"', '"../../../../frontend/src/modules/communications/emailQuotedContent.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/editor/editorUndoHistory"', '"../../../../frontend/src/modules/editor/editorUndoHistory.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/editor/editorProjection"', '"../../../../frontend/src/modules/editor/editorProjection.js"');
  contents = contents.replaceAll('"../../../../frontend/src/modules/editor/editorTextBlockChatHighlights"', '"../../../../frontend/src/modules/editor/editorTextBlockChatHighlights.js"');
  contents = contents.replaceAll('"../../../frontend/src/hooks/keyboardShortcutRouting"', '"../../../frontend/src/hooks/keyboardShortcutRouting.js"');
  writeFileSync(testFile, contents, "utf8");
}

mkdirSync(resolve(frontendRoot, ".test-dist"), { recursive: true });
writeFileSync(packageFile, '{"type":"module"}\n', "utf8");
for (const componentTest of componentTests) {
  const plugins = componentTest.processMapComponentHarness ? [{
    name: "process-map-component-harness",
    setup(esbuild) {
      esbuild.onResolve({ filter: /^@deck\.gl\/react$/ }, () => ({
        path: resolve(repoRoot, "tests/frontend/modules/process-map/processMapDeckGLTestStub.tsx"),
      }));
      esbuild.onResolve({ filter: /realtimeWebSocket\.js$/ }, () => ({
        path: resolve(repoRoot, "tests/frontend/modules/process-map/processMapRealtimeTestStub.ts"),
      }));
    },
  }] : undefined;
  const options = {
    absWorkingDir: repoRoot,
    entryPoints: [componentTest.source],
    bundle: true,
    platform: "node",
    format: componentTest.bundleDependencies ? "cjs" : "esm",
    ...(componentTest.bundleDependencies
      ? { external: ["react", "react-dom", "react-dom/*", "jsdom"] }
      : { packages: "external" }),
    define: { "import.meta.env": "{}" },
    outfile: componentTest.file,
  };
  if (plugins) await build({ ...options, plugins });
  else buildSync({ ...options });
}

const componentTestFiles = new Set(componentTests.map((componentTest) => componentTest.file));
for (const testFile of [...testFiles, ...componentTestFiles]) {
  console.log(`\n=== Frontend feature tests: ${testFile} ===`);
  // Force the Node test harness to close timers left by deliberately long-lived UI
  // clients after each module reports its assertions.
  run(
    `"${process.execPath}" --test --test-force-exit "${testFile}"`,
    componentTestFiles.has(testFile) ? { NODE_ENV: "development" } : {},
  );
}
