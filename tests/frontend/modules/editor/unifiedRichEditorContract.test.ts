import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  UNIFIED_RICH_EDITOR_BEHAVIOR_SOURCE,
  UNIFIED_RICH_EDITOR_SURFACE_CONTRACTS,
} from "../../../../frontend/src/modules/editor/unifiedRichEditorContract.js";
import {
  UNIFIED_NODE_SHELL_BEHAVIOR_SOURCE,
  UNIFIED_NODE_SHELL_SURFACE_CONTRACTS,
  UNIFIED_NODE_SHELL_TOP_RIGHT_ACTION_ORDER,
} from "../../../../frontend/src/modules/editor/unifiedNodeShellContract.js";

test("unified rich editor contract lists every Phase 1 target surface", () => {
  assert.equal(UNIFIED_RICH_EDITOR_BEHAVIOR_SOURCE, "useEditorDocumentSurfaceHandlers");
  assert.deepEqual(UNIFIED_RICH_EDITOR_SURFACE_CONTRACTS.map((surface) => surface.id), [
    "logic-gate-editor",
    "node-text-block",
    "project-text-block",
    "my-triage-compose",
    "shared-triage-compose",
    "attached-email-reply",
  ]);
  assert.ok(UNIFIED_RICH_EDITOR_SURFACE_CONTRACTS.every((surface) => surface.chatSurface === false));
});

test("mail compose and attached-email reply mount unified rich editor adapters", () => {
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const nodeWorkspaceParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");

  assert.match(homeParts, /UnifiedRichEditorSurface/);
  assert.match(homeParts, /composeEditorSurfaceID/);
  assert.match(homeParts, /"my-triage-compose"/);
  assert.match(homeParts, /"shared-triage-compose"/);
  assert.doesNotMatch(homeParts, /document\.execCommand/);

  assert.match(nodeWorkspaceParts, /UnifiedRichEditorSurface/);
  assert.match(nodeWorkspaceParts, /surfaceID="attached-email-reply"/);
  assert.match(nodeWorkspaceParts, /unifiedRichEditorBodyToEmailHTML/);
});

test("EmailPickerModal remains attach-only and cannot compose or send mail", () => {
  const nodeWorkspaceParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const start = nodeWorkspaceParts.indexOf("export const EmailPickerModal");
  const end = nodeWorkspaceParts.indexOf("function messageDocument", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const emailPickerModal = nodeWorkspaceParts.slice(start, end);

  assert.match(emailPickerModal, /onAttach/);
  assert.doesNotMatch(emailPickerModal, /composeOpen|composeDraft|submitCompose/);
  assert.doesNotMatch(emailPickerModal, /sendEmail\s*\(/);
  assert.doesNotMatch(emailPickerModal, /<textarea|Schedule send|Save draft|Save to|Write a reply|Send message/);
});

test("unified node shell contract lists every Phase 2 full node-window surface", () => {
  assert.equal(UNIFIED_NODE_SHELL_BEHAVIOR_SOURCE, "UnifiedNodeShell");
  assert.deepEqual(UNIFIED_NODE_SHELL_TOP_RIGHT_ACTION_ORDER, [
    "close",
    "fullscreen",
    "minimize",
    "open-in-new-tab",
    "delete",
  ]);
  assert.deepEqual(UNIFIED_NODE_SHELL_SURFACE_CONTRACTS.map((surface) => surface.id), [
    "home-node-popup",
    "app-sidebar-node-popup",
    "dock-restored-node-popup",
    "updates-node-panel",
    "kanban-my-work-node-overlay",
    "project-critical-path-inline-node",
  ]);
  assert.ok(UNIFIED_NODE_SHELL_SURFACE_CONTRACTS.every((surface) => surface.body === "node-workspace"));
  assert.ok(UNIFIED_NODE_SHELL_SURFACE_CONTRACTS.every((surface) => surface.persistenceBoundary === "node-information-projection"));
  assert.ok(UNIFIED_NODE_SHELL_SURFACE_CONTRACTS.every((surface) => surface.openerState === "opener-owned"));
  assert.ok(UNIFIED_NODE_SHELL_SURFACE_CONTRACTS.every((surface) => surface.chatPane === "separate"));
});

test("node window adapters mount the shared unified node shell", () => {
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const appSidebar = readFileSync(resolve(process.cwd(), "frontend/src/app/AppSidebarChrome.tsx"), "utf8");
  const appLayout = readFileSync(resolve(process.cwd(), "frontend/src/app/applayout.tsx"), "utf8");
  const kanbanOverlays = readFileSync(resolve(process.cwd(), "frontend/src/modules/kanban/KanbanOverlays.tsx"), "utf8");
  const updatesView = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/UpdatesView.tsx"), "utf8");
  const projectSummary = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"), "utf8");
  const unifiedShell = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/UnifiedNodeShell.tsx"), "utf8");

  assert.match(unifiedShell, /data-mango-unified-node-shell/);
  assert.match(unifiedShell, /data-mango-unified-node-shell-body="node-workspace"/);
  assert.match(unifiedShell, /UNIFIED_NODE_SHELL_TOP_RIGHT_ACTION_ORDER/);

  assert.match(homeParts, /UnifiedNodeShell/);
  assert.match(homeParts, /surfaceID="home-node-popup"/);
  assert.doesNotMatch(homeParts, /function NodeEditorPopupFullscreenIcon/);

  assert.match(appSidebar, /UnifiedNodeShell/);
  assert.match(appSidebar, /surfaceID = "app-sidebar-node-popup"/);
  assert.doesNotMatch(appSidebar, /nodeEditorPopupIconButtonStyle/);
  assert.match(appLayout, /surfaceID: "dock-restored-node-popup"/);

  assert.match(kanbanOverlays, /UnifiedNodeShell/);
  assert.match(kanbanOverlays, /surfaceID="kanban-my-work-node-overlay"/);
  assert.doesNotMatch(kanbanOverlays, /overlayHeaderButtonStyle\(right/);

  assert.match(updatesView, /UnifiedNodeShell/);
  assert.match(updatesView, /surfaceID="updates-node-panel"/);

  assert.match(projectSummary, /UnifiedNodeShell/);
  assert.match(projectSummary, /surfaceID="project-critical-path-inline-node"/);
  assert.match(projectSummary, /onNodeOpen\(selection\.nodeID\)/);
});
