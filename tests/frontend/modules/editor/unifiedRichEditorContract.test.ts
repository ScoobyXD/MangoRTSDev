import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  UNIFIED_EDITOR_FORMAT_TOOLBAR_TAB_IDS,
} from "../../../../frontend/src/modules/editor/editorTabs.js";
import {
  UNIFIED_RICH_EDITOR_BEHAVIOR_SOURCE,
  UNIFIED_RICH_EDITOR_MAIL_CONTROL_IDS,
  UNIFIED_RICH_EDITOR_SURFACE_CONTRACTS,
  UNIFIED_RICH_EDITOR_TOOLBAR_SOURCE,
} from "../../../../frontend/src/modules/editor/unifiedRichEditorContract.js";
import {
  UNIFIED_NODE_SHELL_BEHAVIOR_SOURCE,
  UNIFIED_NODE_SHELL_SURFACE_CONTRACTS,
  UNIFIED_NODE_SHELL_TOP_RIGHT_ACTION_ORDER,
} from "../../../../frontend/src/modules/editor/unifiedNodeShellContract.js";

const SHARED_EDITOR_TAB_BAR_CONTROL_LABELS = [
  "Font size",
  "Font size value",
  "Bold",
  "Underline",
  "Outline styles",
] as const;

function assertSharedToolbarControls(adapterSource: string, editorTabBarSource: string, preferencesSource: string) {
  for (const label of SHARED_EDITOR_TAB_BAR_CONTROL_LABELS) {
    assert.match(editorTabBarSource, new RegExp(`aria-label="${label}"`));
  }
  for (const label of ["Automatic Numbering", "Indent Guides", "Bullet Points", "Checklist"]) {
    assert.match(preferencesSource, new RegExp(label));
  }
  for (const staleLabel of ["Numbered list", "Outdent", "Indent", "Bullet list", "Checklist", "Create link"]) {
    assert.doesNotMatch(adapterSource, new RegExp(`aria-label="${staleLabel}"`));
  }
  assert.doesNotMatch(adapterSource, /onInsertTable=/);
  assert.match(adapterSource, /<EditorTabBar/);
  assert.match(adapterSource, /visibleTabIDs=/);
  assert.match(adapterSource, /onSelectionFontSizeChange=/);
  assert.match(adapterSource, /onSelectionInlineFormatChange=/);
  assert.match(editorTabBarSource, /data-mango-unified-editor-toolbar="true"/);
  assert.match(editorTabBarSource, /data-mango-unified-editor-toolbar-tabs=/);
  assert.match(editorTabBarSource, /hoveredFormatControl/);
  assert.match(editorTabBarSource, /formatControlDivider/);
  for (const controlID of ["decrease-font", "font-size", "increase-font", "bold", "underline"]) {
    assert.match(editorTabBarSource, new RegExp(`data-mango-editor-format-control="${controlID}"`));
  }
}

function assertRemovedMailOnlyFontSelect(source: string) {
  for (const staleName of ["composeRichFontSelectStyle", "attachedEmailReplyFontSelectStyle"]) {
    assert.doesNotMatch(source, new RegExp(staleName));
  }
}

function assertUsesUnifiedFormatToolbarTabs(source: string) {
  assert.match(source, /visibleTabIDs=\{UNIFIED_EDITOR_FORMAT_TOOLBAR_TAB_IDS\}/);
}

test("unified rich editor contract lists every Phase 1 target surface", () => {
  assert.equal(UNIFIED_RICH_EDITOR_BEHAVIOR_SOURCE, "useEditorDocumentSurfaceHandlers");
  assert.equal(UNIFIED_RICH_EDITOR_TOOLBAR_SOURCE, "EditorTabBar");
  assert.deepEqual(UNIFIED_RICH_EDITOR_SURFACE_CONTRACTS.map((surface) => surface.id), [
    "logic-gate-editor",
    "node-text-block",
    "project-text-block",
    "my-triage-compose",
    "shared-triage-compose",
    "attached-email-reply",
  ]);
  assert.ok(UNIFIED_RICH_EDITOR_SURFACE_CONTRACTS.every((surface) => surface.chatSurface === false));
  assert.deepEqual(UNIFIED_RICH_EDITOR_MAIL_CONTROL_IDS, [
    "font-size",
    "bold",
    "underline",
    "outline-style",
  ]);
  assert.deepEqual(UNIFIED_EDITOR_FORMAT_TOOLBAR_TAB_IDS, ["format", "outline-styles"]);
});

test("mail compose and attached-email reply mount unified rich editor adapters and toolbar", () => {
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const nodeWorkspaceParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const unifiedRichEditorSurface = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/UnifiedRichEditorSurface.tsx"), "utf8");
  const editorSurfaceHandlers = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts"), "utf8");
  const editorTabBar = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorTabBar.tsx"), "utf8");
  const editorPreferences = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/useEditorPreferences.ts"), "utf8");

  assert.match(homeParts, /UnifiedRichEditorSurface/);
  assert.match(homeParts, /composeEditorSurfaceID/);
  assert.match(homeParts, /"my-triage-compose"/);
  assert.match(homeParts, /"shared-triage-compose"/);
  assert.doesNotMatch(homeParts, /document\.execCommand/);
  assertSharedToolbarControls(homeParts, editorTabBar, editorPreferences);
  assertUsesUnifiedFormatToolbarTabs(homeParts);
  assert.doesNotMatch(homeParts, /MAIL_RICH_EDITOR_TAB_IDS/);
  assert.match(homeParts, /bodyEditorControllerRef\.current\?\.applyFontSizeValue\(fontSize\)/);
  assert.doesNotMatch(homeParts, /bodyEditorControllerRef\.current\?\.(toggleNumberedList|outdent|indent|insertList|insertLink|insertTable)\(/);
  assert.doesNotMatch(homeParts, /selectNumberedMode/);

  assert.match(nodeWorkspaceParts, /UnifiedRichEditorSurface/);
  assert.match(nodeWorkspaceParts, /surfaceID="attached-email-reply"/);
  assert.match(nodeWorkspaceParts, /serializeEditorBodyForEmailHTML/);
  assertSharedToolbarControls(nodeWorkspaceParts, editorTabBar, editorPreferences);
  assertUsesUnifiedFormatToolbarTabs(nodeWorkspaceParts);
  assert.doesNotMatch(nodeWorkspaceParts, /ATTACHED_EMAIL_REPLY_EDITOR_TAB_IDS/);
  assert.match(nodeWorkspaceParts, /replyEditorControllerRef\.current\?\.applyFontSizeValue\(fontSize\)/);
  assert.match(nodeWorkspaceParts, /padding: "7px 8px 24px"/);
  assert.match(nodeWorkspaceParts, /scrollPaddingBottom: 24/);
  assert.doesNotMatch(nodeWorkspaceParts, /replyEditorControllerRef\.current\?\.(toggleNumberedList|outdent|indent|insertList|insertLink|insertTable)\(/);
  assert.doesNotMatch(nodeWorkspaceParts, /selectReplyNumberedMode/);

  assert.match(unifiedRichEditorSurface, /applyEditorNumberedListToRoot/);
  assert.match(unifiedRichEditorSurface, /applyEditorIndentCommandToRoot/);
  assert.match(unifiedRichEditorSurface, /toggleNumberedList:/);
  assert.match(unifiedRichEditorSurface, /indent:/);
  assert.match(unifiedRichEditorSurface, /outdent:/);
  assert.match(unifiedRichEditorSurface, /restoreFormattingSelection/);
  assert.match(editorSurfaceHandlers, /restoreSelection: restoreEditorSelectionRange/);
  assert.match(editorSurfaceHandlers, /boldCommandState \?\? readElementInlineFormat/);
  assert.match(editorSurfaceHandlers, /underlineCommandState \?\? readElementInlineFormat/);
  assertRemovedMailOnlyFontSelect(homeParts);
  assertRemovedMailOnlyFontSelect(nodeWorkspaceParts);
});

test("mail thread detail supports exact-message replies, saved editor sizing, and one scroll surface", () => {
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const homePage = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomePage.tsx"), "utf8");

  assert.match(homeParts, /sortEmailConversationMessagesNewestFirst/);
  assert.match(homeParts, /onReply\(message\)/);
  assert.match(homeParts, /onReplyAll\(message\)/);
  assert.match(homeParts, /AutoHeightEmailBodyFrame/);
  assert.match(homeParts, /scrolling="no"/);
  assert.match(homeParts, /new ResizeObserver\(resize\)/);
  assert.match(homeParts, /setExpandedMessageIDs\(newestMessageID \? new Set\(\[newestMessageID\]\)/);
  assert.match(homeParts, /saveMailReplyEditorHeight/);
  assert.match(homeParts, /MAIL_REPLY_EDITOR_MIN_HEIGHT_PX/);
  assert.match(homePage, /saveCurrentComposeDraft\(\{ quiet: true \}\);\s*setCompose\(emptyCompose\);/);
  assert.match(homePage, /openReply\("reply", message \?\? selectedMessage\)/);
  assert.match(homePage, /incomingThreadID && incomingThreadID === selectedThreadID/);
  assert.match(homePage, /setSelectedThreadMessages\(\(previous\) => mergeEmailThreadDetailMessages\(previous, \[message\]\)\)/);
});

test("editor toolbar font and outline controls share one source across rich editor surfaces", () => {
  const editorContent = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorContent.tsx"), "utf8");
  const nodeWorkspaceParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const unifiedRichEditorSurface = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/UnifiedRichEditorSurface.tsx"), "utf8");
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const projectSummary = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"), "utf8");
  const editorTabBar = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorTabBar.tsx"), "utf8");
  const editorTabs = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/editorTabs.ts"), "utf8");

  assert.match(editorTabs, /UNIFIED_EDITOR_FORMAT_TOOLBAR_TAB_IDS: readonly EditorTabID\[\] = \["format", "outline-styles"\]/);
  assert.match(editorTabBar, /data-mango-unified-editor-toolbar="true"/);
  assertUsesUnifiedFormatToolbarTabs(homeParts);
  assertUsesUnifiedFormatToolbarTabs(nodeWorkspaceParts);
  assertUsesUnifiedFormatToolbarTabs(projectSummary);
  assert.doesNotMatch(projectSummary, /PROJECT_TEXT_EDITOR_TOOLBAR_TAB_IDS/);

  assert.match(editorContent, /applyEditorSelectionFontSizeToRoot\(element, nextFontSizeInput,/);
  assert.doesNotMatch(editorContent, /span\.style\.fontSize = `\$\{nextFontSize\}px`/);
  assert.match(nodeWorkspaceParts, /applyEditorSelectionFontSizeToRoot\(editor, fontSize,/);
  assert.match(unifiedRichEditorSurface, /applyEditorSelectionFontSizeToRoot\(editor, fontSize,/);
  assert.match(projectSummary, /controller\.applyFontSizeValue\(fontSize\)/);
  assert.match(homeParts, /bodyEditorControllerRef\.current\?\.applyFontSizeValue\(fontSize\)/);
  assert.match(nodeWorkspaceParts, /replyEditorControllerRef\.current\?\.applyFontSizeValue\(fontSize\)/);
});

test("mail signatures are mailbox scoped and late hydration only backfills the pending new draft", () => {
  const homePage = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomePage.tsx"), "utf8");
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const homeMailDrafts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/homeMailDrafts.ts"), "utf8");

  assert.match(homePage, /pendingAutoSignatureRef/);
  assert.match(homePage, /activeSignatureScopeKey/);
  assert.match(homePage, /loadHomeMailSignature\(companyID, currentUserID, activeSharedInboxFolderID, activeMailAccountEmail\)/);
  assert.match(homePage, /current\.draftID !== pending\.draftID/);
  assert.match(homePage, /applyHomeMailSignature\(current\.body, emailSignature\)/);
  assert.match(homePage, /emailSignature=\{composeScopeEmailSignature\}/);
  assert.match(homePage, /compose: submittedCompose/);
  assert.match(homeMailDrafts, /export function homeMailSignatureScopeKey/);
  assert.match(homeMailDrafts, /export function homeMailBodyHasSignature/);
  assert.match(homeParts, /applyHomeMailSignature\(compose\.body, signature\)/);
  assert.doesNotMatch(homeParts, /compose\.body\.endsWith\(signature\)/);
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
  assert.deepEqual(UNIFIED_NODE_SHELL_SURFACE_CONTRACTS.find((surface) => surface.id === "kanban-my-work-node-overlay")?.actions, [
    "close",
    "fullscreen",
    "minimize",
    "open-in-new-tab",
    "delete",
  ]);
});

test("node window adapters mount the shared unified node shell", () => {
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const appSidebar = readFileSync(resolve(process.cwd(), "frontend/src/app/AppSidebarChrome.tsx"), "utf8");
  const appLayout = readFileSync(resolve(process.cwd(), "frontend/src/app/applayout.tsx"), "utf8");
  const kanbanContent = readFileSync(resolve(process.cwd(), "frontend/src/modules/kanban/KanbanContent.tsx"), "utf8");
  const kanbanOverlays = readFileSync(resolve(process.cwd(), "frontend/src/modules/kanban/KanbanOverlays.tsx"), "utf8");
  const updatesView = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/UpdatesView.tsx"), "utf8");
  const projectSummary = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"), "utf8");
  const unifiedShell = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/UnifiedNodeShell.tsx"), "utf8");

  assert.match(unifiedShell, /data-mango-unified-node-shell/);
  assert.match(unifiedShell, /data-mango-unified-node-shell-body="node-workspace"/);
  assert.match(unifiedShell, /UNIFIED_NODE_SHELL_TOP_RIGHT_ACTION_ORDER/);
  assert.match(unifiedShell, /UNIFIED_NODE_SHELL_CLOSE_BUTTON_CHROME_STYLE/);
  assert.match(unifiedShell, /linear-gradient\(135deg, #ff5a6b, #ef334e\)/);

  assert.match(homeParts, /UnifiedNodeShell/);
  assert.match(homeParts, /surfaceID="home-node-popup"/);
  assert.match(homeParts, /fullscreenNodeEditorViewportRect/);
  assert.doesNotMatch(homeParts, /function NodeEditorPopupFullscreenIcon/);

  assert.match(appSidebar, /UnifiedNodeShell/);
  assert.match(appSidebar, /surfaceID = "app-sidebar-node-popup"/);
  assert.match(appSidebar, /fullscreenNodeEditorViewportRect/);
  assert.match(appSidebar, /subscribeNodeEditorFullscreenChrome/);
  assert.match(appSidebar, /explorerSearchHidden/);
  assert.doesNotMatch(appSidebar, /nodeEditorPopupIconButtonStyle/);
  assert.match(appLayout, /surfaceID: "dock-restored-node-popup"/);

  assert.match(kanbanOverlays, /UnifiedNodeShell/);
  assert.match(kanbanOverlays, /surfaceID="kanban-my-work-node-overlay"/);
  assert.match(kanbanOverlays, /id: "fullscreen"/);
  assert.match(kanbanOverlays, /pressed: fullscreen/);
  assert.match(kanbanOverlays, /position: fullscreen \? "fixed" : "absolute"/);
  assert.match(kanbanOverlays, /NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX/);
  assert.match(kanbanOverlays, /NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX/);
  assert.match(kanbanOverlays, /setNodeEditorFullscreenChromeActive\(fullscreen\)/);
  assert.match(kanbanOverlays, /closeButtonStyle=\{overlayHeaderButtonStyle\}/);
  assert.match(kanbanContent, /onToggleFullscreen=\{toggleNodeEditorOverlayFullscreen\}/);
  assert.match(kanbanContent, /fullscreen=\{nodeEditorOverlayFullscreen\}/);
  assert.doesNotMatch(kanbanOverlays, /overlayHeaderButtonStyle\(right/);

  assert.match(updatesView, /UnifiedNodeShell/);
  assert.match(updatesView, /surfaceID="updates-node-panel"/);

  assert.match(projectSummary, /UnifiedNodeShell/);
  assert.match(projectSummary, /surfaceID="project-critical-path-inline-node"/);
  assert.match(projectSummary, /onNodeOpen\(selection\.nodeID\)/);
});
