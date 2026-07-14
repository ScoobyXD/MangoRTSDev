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
import { withPreparedEditorAttachmentResource } from "../../../../frontend/src/modules/editor/editorAttachmentPreparation.js";

const SHARED_EDITOR_TAB_BAR_CONTROL_LABELS = [
  "Format controls",
  "Decrease font size",
  "Font size value",
  "Increase font size",
  "Bold",
  "Underline",
  "Italic",
  "Strikethrough",
  "Text highlight",
  "Apply text highlight",
  "Choose highlight color",
  "Insert table",
  "Outline styles",
] as const;

test("editor attachment mutations wait for resource preparation and stop when it fails", async () => {
  const order: string[] = [];
  const result = await withPreparedEditorAttachmentResource(
    async () => { order.push("prepared"); },
    async () => {
      order.push("uploaded");
      return "attachment";
    },
  );
  assert.equal(result, "attachment");
  assert.deepEqual(order, ["prepared", "uploaded"]);

  let linked = false;
  await assert.rejects(
    withPreparedEditorAttachmentResource(
      async () => { throw new Error("draft_not_durable"); },
      async () => {
        linked = true;
      },
    ),
    /draft_not_durable/,
  );
  assert.equal(linked, false);
});

function assertSharedToolbarControls(editorTabBarSource: string, preferencesSource: string) {
  for (const label of SHARED_EDITOR_TAB_BAR_CONTROL_LABELS) {
    assert.match(editorTabBarSource, new RegExp(`aria-label="${label}"`));
  }
  for (const label of ["Automatic Numbering", "Indent Guides", "Bullet Points", "Checklist"]) {
    assert.match(preferencesSource, new RegExp(label));
  }
  assert.match(editorTabBarSource, /data-mango-unified-editor-toolbar="true"/);
  assert.match(editorTabBarSource, /data-mango-unified-editor-toolbar-tabs=/);
  assert.match(editorTabBarSource, /hoveredFormatControl/);
  assert.match(editorTabBarSource, /formatControlDivider/);
  for (const controlID of ["decrease-font", "font-size", "increase-font", "bold", "underline", "italic", "strikethrough", "highlight", "highlight-menu", "table"]) {
    assert.match(editorTabBarSource, new RegExp(`data-mango-editor-format-control="${controlID}"`));
  }
  assert.match(editorTabBarSource, /\(\["left", "center", "right"\] as const\)\.map\(\(alignment\) =>/);
  assert.match(editorTabBarSource, /const label = `Align \$\{alignment\}`/);
  assert.match(editorTabBarSource, /data-mango-editor-format-control=\{controlID\}/);
  assert.match(editorTabBarSource, /aria-label="Text highlight colors"/);
  assert.match(editorTabBarSource, /No highlight/);
  assert.match(editorTabBarSource, /Custom highlight color/);
}

function sourceSliceBetween(source: string, startMarker: string, endMarker: string, label: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label} start marker must exist`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label} end marker must exist`);
  return source.slice(start, end + endMarker.length);
}

function jsxOpeningTagContaining(source: string, componentName: string, marker: string, label: string): string {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${label} marker must exist`);
  const start = source.lastIndexOf(`<${componentName}`, markerIndex);
  assert.notEqual(start, -1, `${label} opening tag must exist`);
  const end = source.indexOf("/>", markerIndex);
  assert.notEqual(end, -1, `${label} opening tag must close`);
  return source.slice(start, end + 2);
}

function assertFontToolbarRouting(
  toolbarSource: string,
  adjustHandler: string,
  valueHandler: string,
  selectionValue: string,
) {
  assert.match(toolbarSource, new RegExp(`onAdjustSelectionFontSize=\\{${adjustHandler}\\}`));
  assert.match(toolbarSource, new RegExp(`onSetSelectionFontSize=\\{${valueHandler}\\}`));
  assert.match(toolbarSource, new RegExp(`documentFontSize=\\{${selectionValue}\\}`));
}

function assertRemovedMailOnlyFontSelect(source: string) {
  for (const staleName of ["composeRichFontSelectStyle", "attachedEmailReplyFontSelectStyle"]) {
    assert.doesNotMatch(source, new RegExp(staleName));
  }
}

function assertUsesUnifiedFormatToolbarTabs(source: string) {
  assert.match(source, /visibleTabIDs=\{UNIFIED_EDITOR_FORMAT_TOOLBAR_TAB_IDS\}/);
}

test("unified rich editor contract lists every declared target surface", () => {
  assert.equal(UNIFIED_RICH_EDITOR_BEHAVIOR_SOURCE, "useEditorDocumentSurfaceHandlers");
  assert.equal(UNIFIED_RICH_EDITOR_TOOLBAR_SOURCE, "EditorTabBar");
  assert.deepEqual(UNIFIED_RICH_EDITOR_SURFACE_CONTRACTS.map((surface) => surface.id), [
    "logic-gate-editor",
    "node-text-block",
    "project-text-block",
    "my-triage-compose",
    "shared-triage-compose",
    "attached-email-reply",
    "email-signature",
  ]);
  assert.ok(UNIFIED_RICH_EDITOR_SURFACE_CONTRACTS.every((surface) => surface.chatSurface === false));
  assert.equal(UNIFIED_RICH_EDITOR_SURFACE_CONTRACTS.length, 7);
  assert.equal(
    UNIFIED_RICH_EDITOR_SURFACE_CONTRACTS.find((surface) => surface.id === "email-signature")?.persistenceBoundary,
    "mailbox-signature",
  );
  assert.deepEqual(UNIFIED_RICH_EDITOR_MAIL_CONTROL_IDS, [
    "font-size",
    "bold",
    "underline",
    "italic",
    "strikethrough",
    "highlight",
    "align-left",
    "align-center",
    "align-right",
    "table",
    "outline-style",
  ]);
  assert.deepEqual(UNIFIED_EDITOR_FORMAT_TOOLBAR_TAB_IDS, ["format", "outline-styles"]);
});

test("shared editor surfaces retain semantic identity, placeholders, and urgent mentions", () => {
  const editorDocumentSurface = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorDocumentSurface.tsx"), "utf8");
  const nodeWorkspaceParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const projectSummary = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"), "utf8");
  const richTextEditing = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/richTextEditing.ts"), "utf8");
  const editorSurfaceHandlers = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts"), "utf8");
  const indexCSS = readFileSync(resolve(process.cwd(), "frontend/src/index.css"), "utf8");

  assert.match(editorDocumentSurface, /data-mango-editor-empty=/);
  assert.match(editorDocumentSurface, /data-placeholder=\{placeholder\}/);
  assert.match(indexCSS, /\[data-mango-editor-empty="true"\]\[data-placeholder\]::before/);
  assert.match(nodeWorkspaceParts, /dataAttributes=\{\{/);
  assert.match(nodeWorkspaceParts, /"data-project-text-block-id": surfaceKind === "project" \? blockID : undefined/);
  assert.match(editorDocumentSurface, /\{\.\.\.dataAttributes\}/);
  assert.match(nodeWorkspaceParts, /"Project text block"/);
  assert.match(projectSummary, /surfaceKind="project"/);
  assert.match(projectSummary, /const \[activeRichTextBlockID, setActiveRichTextBlockID\] = useState\(""\)/);
  assert.match(projectSummary, /formattingDisabled=\{!activeRichTextBlockID \|\| !blocks\.some\(\(block\) => block\.id === activeRichTextBlockID\)\}/);
  assert.match(projectSummary, /setActiveRichTextBlockID\(""\);\s*projectFormattingControllerRef\.current = null/);
  assert.match(projectSummary, /<AttachedEmailOrganizerPane[\s\S]*attachmentResourceType="project"[\s\S]*attachmentResourceID=\{projectID\}[\s\S]*attachmentInformationID=\{block\.id\}/);
  assert.match(nodeWorkspaceParts, /resourceType: attachmentResourceType/);
  assert.match(nodeWorkspaceParts, /resourceID: replyAttachmentResourceID/);
  assert.match(richTextEditing, /element\.getAttribute\(EDITOR_MENTION_KIND_ATTRIBUTE\)/);
  assert.match(richTextEditing, /span\.setAttribute\(EDITOR_MENTION_KIND_ATTRIBUTE, mentionKind\)/);
  assert.match(editorSurfaceHandlers, /event\.key === "Tab" && !activeTableCell\.contains\(getCurrentEditorListItem\(root\)\)/);
});

test("the numeric font-size input commits on Enter and cancels cleanly on Escape", () => {
  const editorTabBar = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorTabBar.tsx"), "utf8");
  const fontSizeInput = jsxOpeningTagContaining(editorTabBar, "input", 'aria-label="Font size value"', "shared font-size input");

  assert.match(editorTabBar, /const cancelFontSizeCommitRef = useRef\(false\)/);
  assert.match(fontSizeInput, /onFocus=\{\(\) => \{\s*cancelFontSizeCommitRef\.current = false/);
  assert.match(fontSizeInput, /if \(cancelFontSizeCommitRef\.current\) \{[\s\S]*cancelFontSizeCommitRef\.current = false[\s\S]*setFontSizeDraft\(String\(documentFontSize\)\)[\s\S]*\} else \{\s*commitFontSizeDraft\(\)/);
  assert.match(fontSizeInput, /if \(event\.key === "Enter"\) \{\s*event\.preventDefault\(\);\s*event\.currentTarget\.blur\(\)/);
  assert.match(fontSizeInput, /onChange=\{\(event\) => \{\s*cancelFontSizeCommitRef\.current = false/);
  assert.match(fontSizeInput, /if \(event\.key === "Escape"\) \{\s*event\.preventDefault\(\);\s*cancelFontSizeCommitRef\.current = true[\s\S]*event\.currentTarget\.select\(\)/);
  assert.doesNotMatch(
    sourceSliceBetween(fontSizeInput, 'if (event.key === "Escape")', "}", "font-size Escape handler"),
    /\.blur\(\)/,
  );
  assert.doesNotMatch(editorTabBar, /if \(nextFontSize === documentFontSize\) return/);
});

test("toolbar cancellation and passive format reads preserve keyboard focus", () => {
  const editorTabBar = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorTabBar.tsx"), "utf8");
  const editorSurfaceHandlers = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts"), "utf8");
  const modalPortal = readFileSync(resolve(process.cwd(), "frontend/src/app/AppModalPortal.tsx"), "utf8");
  const readFormatState = sourceSliceBetween(
    editorSurfaceHandlers,
    "readFormatState: () => {",
    "},",
    "shared read-format-state command",
  );

  assert.match(editorTabBar, /useAppFloatingMenuDismissal\(outlineMenuOpen, outlineMenuRef, \(\) => setOutlineMenuOpen\(false\)\)/);
  assert.match(editorTabBar, /useAppFloatingMenuDismissal\(highlightMenuOpen, highlightMenuRef, \(\) => setHighlightMenuOpen\(false\)\)/);
  assert.match(modalPortal, /const trigger = containerRef\.current\?\.querySelector<HTMLButtonElement>\("button\[aria-haspopup\]"\)/);
  assert.match(modalPortal, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*event\.stopImmediatePropagation\(\);\s*onCloseRef\.current\(\)/);
  assert.match(modalPortal, /targetDocument\.addEventListener\("keydown", closeOnEscape, true\)/);
  assert.match(modalPortal, /requestAnimationFrame\(restoreFocus\)/);
  assert.match(readFormatState, /const editor = restoreFormattingRange\(\)/);
  assert.doesNotMatch(readFormatState, /restoreFormattingSelection|\.focus\(/);
});

test("attached-email reply focus clears the outer node or project formatting target", () => {
  const nodeWorkspaceParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const nodeWorkspace = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurface.tsx"), "utf8");
  const projectSummary = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"), "utf8");

  assert.match(nodeWorkspaceParts, /onReplyEditorFocus\?: \(\) => void/);
  assert.match(nodeWorkspaceParts, /onReplyEditorFocus=\{onReplyEditorFocus\}/);
  assert.match(nodeWorkspaceParts, /onFocus=\{onReplyEditorFocus\}/);
  assert.match(nodeWorkspace, /onReplyEditorFocus=\{\(\) => \{\s*setFocusedTextBlockID\(""\);\s*if \(formattingControllerRef\) formattingControllerRef\.current = null/);
  assert.match(projectSummary, /onReplyEditorFocus=\{\(\) => \{\s*setFocusedTextBlockID\(block\.id\);\s*setActiveRichTextBlockID\(""\);\s*projectFormattingControllerRef\.current = null/);
});

test("format availability never disables editor navigation tabs", () => {
  const editorTabBar = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorTabBar.tsx"), "utf8");
  const editorContent = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorContent.tsx"), "utf8");
  const nodeWorkspace = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurface.tsx"), "utf8");

  assert.match(editorTabBar, /formattingDisabled\?: boolean/);
  assert.match(editorTabBar, /const formatControlsDisabled = disabled \|\| formattingDisabled/);
  assert.match(editorContent, /formattingDisabled=\{documentIsolation\.pointerEvents !== "auto" \|\| !linkedEntityCanEdit \|\| \(linkedEntityKind === "node" && !nodeFormattingControllerAvailable\)\}/);
  assert.match(editorContent, /hidden=\{documentIsolation\.visibility === "hidden"\}/);
  assert.match(nodeWorkspace, /display: hidden \? "none" : "block"/);
  assert.doesNotMatch(editorContent, /disabled=\{!linkedEntityCanEdit \|\| \(linkedEntityKind === "node" && !nodeFormattingControllerAvailable\)\}/);
  assert.match(editorTabBar, /disabled=\{formatControlsDisabled\}/);
  assert.match(editorTabBar, /disabled=\{disabled\}/);
});

test("all unified rich editors use one contentEditable host and one formatting-controller hook", () => {
  const editorDocumentSurface = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorDocumentSurface.tsx"), "utf8");
  const editorContent = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorContent.tsx"), "utf8");
  const nodeWorkspaceParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const unifiedRichEditorSurface = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/UnifiedRichEditorSurface.tsx"), "utf8");
  const projectSummary = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"), "utf8");
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");

  const contentEditableMarkupCount = (source: string) => source.match(/\bcontentEditable\s*=/g)?.length ?? 0;
  assert.equal(contentEditableMarkupCount(editorDocumentSurface), 1, "EditorDocumentSurface must own the one rich contentEditable element");
  for (const [label, source] of [
    ["EditorContent", editorContent],
    ["NodeWorkspaceSurfaceParts", nodeWorkspaceParts],
    ["UnifiedRichEditorSurface", unifiedRichEditorSurface],
    ["ProjectSummaryContent", projectSummary],
    ["HomeParts", homeParts],
  ] as const) {
    assert.equal(contentEditableMarkupCount(source), 0, label + " must configure the shared surface instead of emitting rich contentEditable markup");
  }

  for (const [label, source] of [
    ["EditorContent", editorContent],
    ["NodeWorkspaceSurfaceParts", nodeWorkspaceParts],
    ["UnifiedRichEditorSurface", unifiedRichEditorSurface],
  ] as const) {
    assert.match(source, /<EditorDocumentSurface/, label + " must mount the shared rich DOM host");
    assert.match(source, /useEditorDocumentFormattingController\s*\(/, label + " must use the shared formatting-controller hook");
  }
  assert.match(editorContent, /<EditorDocumentSurface[\s\S]*surfaceID="logic-gate-editor"/);
  assert.match(nodeWorkspaceParts, /surfaceID=\{surfaceKind === "project" \? "project-text-block" : "node-text-block"\}/);
  assert.match(unifiedRichEditorSurface, /<EditorDocumentSurface[\s\S]*surfaceID=\{surfaceID\}/);
  assert.match(projectSummary, /<NodeTextBlockEditor/);
  assert.match(homeParts, /<UnifiedRichEditorSurface/);
});

test("project text blocks serialize latest full-envelope saves through the shared queue", () => {
  const projectSummary = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"), "utf8");

  assert.match(projectSummary, /createTextBlockProjectionSaveController<EditorTextBlockContent>\(\)/);
  assert.match(projectSummary, /useMemo<TextBlockProjectionSaveController<EditorTextBlockContent>>\([\s\S]*\[projectSaveScope\]/);
  assert.match(projectSummary, /projectTextBlockContentRef = useRef\(new Map<string, EditorTextBlockContent>\(\)\)/);
  assert.match(projectSummary, /projectTextBlockSaveController\.configure\(\{/);
  assert.match(projectSummary, /saveBlock: async \(\{ blockID, content, sentVersion \}\)/);
  assert.match(projectSummary, /projectTextBlockContentRef\.current\.get\(blockID\)/);
  assert.match(projectSummary, /projectTextBlockSaveController\.markHasChanged\(blockID, nextContent\)/);
  assert.match(projectSummary, /onDocumentChange=\{\(document\) => scheduleProjectTextBlockSave\(block\.id, \{ document \}\)\}/);
  assert.match(projectSummary, /onDocumentFlush=\{\(document\) => \{[\s\S]*flushProjectTextBlockSave\(block\.id, \{ document \}\)/);
  assert.match(projectSummary, /const latest = projectTextBlockContentRef\.current\.get\(block\.id\)[\s\S]*flushProjectTextBlockSave\(block\.id, \{ attachments: nextAttachments \}\)/);
  assert.match(projectSummary, /await projectTextBlockSaveController\.waitForInProgressSaveThenRemoveBlock\(blockID\)/);
  assert.match(projectSummary, /return \(\) => \{[\s\S]*projectTextBlockSaveController\.flushChangedBlocks\(\)/);
  assert.doesNotMatch(projectSummary, /projectTextBlockSaveController\.clear\(\)/);
  assert.doesNotMatch(projectSummary, /saveTextBlock\(block, \{ (?:document|attachments)/);
});

test("the active node or project text block keeps its formatting controller current across rerenders", () => {
  const nodeWorkspaceParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const nodeWorkspaceSurface = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurface.tsx"), "utf8");
  const editorContent = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorContent.tsx"), "utf8");
  const handoff = sourceSliceBetween(
    nodeWorkspaceParts,
    "const activateFormattingController",
    "const handleBlur",
    "active text-block formatting-controller handoff",
  );
  const activeEditorSurface = jsxOpeningTagContaining(
    nodeWorkspaceParts,
    "EditorDocumentSurface",
    "onFocus={() => {",
    "active node/project text-block editor surface",
  );
  const workspaceAvailability = sourceSliceBetween(
    nodeWorkspaceSurface,
    "const [focusedTextBlockID",
    "const [projectAssignerDropdownLeft",
    "node formatting-controller availability",
  );
  const workspaceTextBlock = jsxOpeningTagContaining(
    nodeWorkspaceSurface,
    "NodeTextBlockEditor",
    "Keep the last focused editor active while toolbar inputs own browser focus.",
    "node workspace text-block editor",
  );

  assert.match(nodeWorkspaceParts, /const publishedFormattingControllerRef = useRef<EditorDocumentFormattingController \| null>\(null\)/);
  assert.match(nodeWorkspaceParts, /const formattingControllerWasActivatedRef = useRef\(false\)/);
  assert.match(handoff, /formattingControllerWasActivatedRef\.current = true/);
  assert.match(handoff, /publishedFormattingControllerRef\.current = formattingController/);
  assert.match(handoff, /formattingControllerRef\.current = formattingController/);
  assert.match(handoff, /const previousController = publishedFormattingControllerRef\.current/);
  assert.match(handoff, /formattingControllerWasActivatedRef\.current && formattingControllerRef\?\.current === previousController/);
  assert.match(activeEditorSurface, /onFocus=\{\(\) => \{\s*activateFormattingController\(\)/);
  assert.match(workspaceAvailability, /const formattingControllerAvailable = canEdit && blocks\.some\(\(block\) => block\.id === focusedTextBlockID\)/);
  assert.match(workspaceAvailability, /onFormattingControllerAvailabilityChange\?\.\(formattingControllerAvailable\)/);
  assert.match(editorContent, /const \[nodeFormattingControllerAvailable, setNodeFormattingControllerAvailable\] = useState\(false\)/);
  assert.match(editorContent, /onFormattingControllerAvailabilityChange=\{setNodeFormattingControllerAvailable\}/);
  assert.match(editorContent, /formattingDisabled=\{documentIsolation\.pointerEvents !== "auto" \|\| !linkedEntityCanEdit \|\| \(linkedEntityKind === "node" && !nodeFormattingControllerAvailable\)\}/);
  assert.match(workspaceTextBlock, /onFocus=\{\(\) => \{\s*setFocusedTextBlockID\(block\.id\)/);
  assert.match(workspaceTextBlock, /onBlur=\{\(\) => \{\s*\/\/ Keep the last focused editor active while toolbar inputs own browser focus\./);
  assert.doesNotMatch(workspaceTextBlock, /onBlur=[\s\S]*setFocusedTextBlockID\(""\)/);
});

test("external hydration preserves logical selection and node teardown drains local edits", () => {
  const editorContent = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorContent.tsx"), "utf8");
  const nodeWorkspace = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurface.tsx"), "utf8");
  const nodeWorkspaceParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const unifiedRichEditorSurface = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/UnifiedRichEditorSurface.tsx"), "utf8");

  assert.match(nodeWorkspaceParts, /const deferredExternalDocumentRef = useRef<\{ targetKey: string; value: string \} \| null>\(null\)/);
  assert.match(nodeWorkspaceParts, /if \(editorHasFocus\(element\)\) \{\s*deferredExternalDocumentRef\.current = \{ targetKey: documentTargetKey, value: documentValue \}/);
  assert.match(nodeWorkspaceParts, /if \(userEditedDocumentRef\.current\) \{[\s\S]*onDocumentConflict\?\.\(\)[\s\S]*\} else \{[\s\S]*suppressNextDocumentFlushRef\.current = true[\s\S]*applyExternalDocumentValue/);
  assert.match(nodeWorkspaceParts, /if \(preserveSelection\) restoreSelection\(element\);\s*const selectionOffsets = preserveSelection \? getEditorSelectionOffsets\(element\) : null/);
  assert.match(nodeWorkspaceParts, /setEditorSelectionByOffsets\(element, selectionOffsets\.start, selectionOffsets\.end\)/);
  assert.match(unifiedRichEditorSurface, /restoreSelectionForHydrationRef\.current\?\.\(editor\)/);
  assert.match(editorContent, /restoreDocumentSelectionForHydrationRef\.current\?\.\(element\)/);
  assert.match(editorContent, /setEditorSelectionByOffsets\(element, selectionOffsets\.start, selectionOffsets\.end\)/);

  assert.match(nodeWorkspace, /createTextBlockProjectionSaveController<EditorTextBlockContent>\(\),\s*\[companyID, nodeID\]/);
  assert.match(nodeWorkspace, /textBlockProjectionSaveController\.flushChangedBlocks\(\)\s*\.finally\(\(\) => textBlockProjectionSaveController\.clear\(\)\)/);
  assert.match(nodeWorkspaceParts, /nextHeight < TEXT_BLOCK_MIN_HEIGHT/);
});

test("shared editor clipboard routing keeps mixed content and copies images before cut deletion", () => {
  const editorImages = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/editorImages.ts"), "utf8");
  const editorSurface = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorDocumentSurface.tsx"), "utf8");
  const editorSurfaceHandlers = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts"), "utf8");
  const nodeWorkspaceParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const unifiedRichEditorSurface = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/UnifiedRichEditorSurface.tsx"), "utf8");
  const editorContent = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorContent.tsx"), "utf8");
  const attachmentBackedPaste = sourceSliceBetween(
    editorSurfaceHandlers,
    "if (clipboardData.attachmentID) {",
    "const imageData = await createEditorImageDataFromSource",
    "attachment-backed editor image paste",
  );

  assert.match(editorImages, /createEditorImageFrame\(ownerDocument, \{ \.\.\.data, id: undefined \}, \{ durable: true \}\)/);
  assert.match(editorSurfaceHandlers, /editorImageTransferHTMLKind\(root\.ownerDocument, html\)/);
  assert.match(editorSurfaceHandlers, /shouldUseEditorImageFileTransferShortcut\(true, htmlKind, text\)/);
  assert.match(editorSurfaceHandlers, /onCut\(event\)[\s\S]*copySelectedEditorImage\(root, event\.clipboardData\)[\s\S]*removeSelectedEditorImage\(root\)/);
  assert.match(attachmentBackedPaste, /await withPreparedEditorAttachmentResource\(editorImageAttachmentContext\.prepareResource, \(\) => linkMangoResourceAttachment\(editorImageAttachmentContext\.requestJSON, \{/);
  assert.match(attachmentBackedPaste, /resourceType: editorImageAttachmentContext\.resourceType/);
  assert.match(attachmentBackedPaste, /resourceID: editorImageAttachmentContext\.resourceID/);
  assert.match(attachmentBackedPaste, /attachmentID: clipboardData\.attachmentID/);
  assert.match(attachmentBackedPaste, /relationshipKind: "inline_image"/);
  assert.ok(
    attachmentBackedPaste.indexOf("await withPreparedEditorAttachmentResource") < attachmentBackedPaste.indexOf("insertPreparedEditorImage"),
    "resource preparation and linking must finish before the attachment-backed image is inserted",
  );
  assert.match(editorSurface, /onCut=/);
  assert.match(nodeWorkspaceParts, /<EditorDocumentSurface[\s\S]*\{\.\.\.documentSurfaceHandlers\}/);
  assert.match(unifiedRichEditorSurface, /<EditorDocumentSurface[\s\S]*\{\.\.\.documentSurfaceHandlers\}/);
  assert.match(editorContent, /<EditorDocumentSurface[\s\S]*\{\.\.\.documentSurfaceEventHandlers\}/);
  for (const wrapperSource of [nodeWorkspaceParts, unifiedRichEditorSurface, editorContent]) {
    assert.doesNotMatch(wrapperSource, /\bonCut\s*=/);
  }
});

test("mail compose, attached-email reply, and mailbox signature mount unified rich editor adapters and toolbar", () => {
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const nodeWorkspaceParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const unifiedRichEditorSurface = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/UnifiedRichEditorSurface.tsx"), "utf8");
  const editorSurfaceHandlers = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts"), "utf8");
  const editorTabBar = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorTabBar.tsx"), "utf8");
  const editorPreferences = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/useEditorPreferences.ts"), "utf8");
  const bodyToolbar = jsxOpeningTagContaining(homeParts, "EditorTabBar", "activeTab={bodyToolbarTab}", "triage body toolbar");
  const bodySurface = jsxOpeningTagContaining(homeParts, "UnifiedRichEditorSurface", "surfaceID={composeEditorSurfaceID}", "triage body surface");
  const signaturePanel = sourceSliceBetween(homeParts, "{signatureEditorOpen && (", "\n        )}", "signature editor panel");
  const signatureToolbar = jsxOpeningTagContaining(signaturePanel, "EditorTabBar", "activeTab={signatureToolbarTab}", "signature toolbar");
  const signatureSurface = jsxOpeningTagContaining(signaturePanel, "UnifiedRichEditorSurface", 'surfaceID="email-signature"', "signature surface");
  const replyToolbar = jsxOpeningTagContaining(nodeWorkspaceParts, "EditorTabBar", "activeTab={replyToolbarTab}", "attached-email reply toolbar");
  const replySurface = jsxOpeningTagContaining(nodeWorkspaceParts, "UnifiedRichEditorSurface", 'surfaceID="attached-email-reply"', "attached-email reply surface");
  const bodyFontHandlers = sourceSliceBetween(homeParts, "const adjustBodyFontSize", "const toggleBodyInlineFormat", "triage body font handlers");
  const signatureFontHandlers = sourceSliceBetween(homeParts, "const adjustSignatureFontSize", "const toggleSignatureInlineFormat", "signature font handlers");
  const replyFontHandlers = sourceSliceBetween(nodeWorkspaceParts, "const adjustReplyFontSize", "const toggleReplyInlineFormat", "attached-email reply font handlers");

  assert.match(homeParts, /UnifiedRichEditorSurface/);
  assert.match(homeParts, /composeEditorSurfaceID/);
  assert.match(homeParts, /"my-triage-compose"/);
  assert.match(homeParts, /"shared-triage-compose"/);
  assert.doesNotMatch(homeParts, /document\.execCommand/);
  assertSharedToolbarControls(editorTabBar, editorPreferences);
  assertUsesUnifiedFormatToolbarTabs(homeParts);
  assert.doesNotMatch(homeParts, /MAIL_RICH_EDITOR_TAB_IDS/);
  assertFontToolbarRouting(bodyToolbar, "adjustBodyFontSize", "setBodyFontSize", "bodySelectionFontSize");
  assert.match(bodyToolbar, /highlightColor=\{bodyHighlightColor\}/);
  assert.match(bodyToolbar, /onSetSelectionHighlightColor=\{setBodySelectionHighlightColor\}/);
  assert.match(bodySurface, /onSelectionFontSizeChange=\{setBodySelectionFontSize\}/);
  assert.match(bodySurface, /onSelectionHighlightColorChange=\{setBodyHighlightColor\}/);
  assert.match(bodyFontHandlers, /bodyEditorControllerRef\.current\?\.adjustFontSize\(delta\)/);
  assert.match(bodyFontHandlers, /bodyEditorControllerRef\.current\?\.applyFontSizeValue\(fontSize\)/);
  assert.doesNotMatch(homeParts, /selectNumberedMode/);
  assertFontToolbarRouting(signatureToolbar, "adjustSignatureFontSize", "setSignatureFontSize", "signatureSelectionFontSize");
  assert.match(signatureToolbar, /highlightColor=\{signatureHighlightColor\}/);
  assert.match(signatureToolbar, /onSetSelectionHighlightColor=\{setSignatureSelectionHighlightColor\}/);
  assert.match(signatureSurface, /surfaceID="email-signature"/);
  assert.match(signatureSurface, /onSelectionFontSizeChange=\{setSignatureSelectionFontSize\}/);
  assert.match(signatureSurface, /onSelectionHighlightColorChange=\{setSignatureHighlightColor\}/);
  assert.match(signatureFontHandlers, /signatureEditorControllerRef\.current\?\.adjustFontSize\(delta\)/);
  assert.match(signatureFontHandlers, /signatureEditorControllerRef\.current\?\.applyFontSizeValue\(fontSize\)/);
  assert.doesNotMatch(signaturePanel, /<textarea\b/);

  assert.match(nodeWorkspaceParts, /UnifiedRichEditorSurface/);
  assert.match(nodeWorkspaceParts, /surfaceID="attached-email-reply"/);
  assert.match(nodeWorkspaceParts, /serializeEditorBodyForEmailHTML/);
  assertSharedToolbarControls(editorTabBar, editorPreferences);
  assertUsesUnifiedFormatToolbarTabs(nodeWorkspaceParts);
  assert.doesNotMatch(nodeWorkspaceParts, /ATTACHED_EMAIL_REPLY_EDITOR_TAB_IDS/);
  assertFontToolbarRouting(replyToolbar, "adjustReplyFontSize", "setReplyFontSize", "replySelectionFontSize");
  assert.match(replyToolbar, /highlightColor=\{replyHighlightColor\}/);
  assert.match(replyToolbar, /onSetSelectionHighlightColor=\{setReplySelectionHighlightColor\}/);
  assert.match(replySurface, /onSelectionFontSizeChange=\{setReplySelectionFontSize\}/);
  assert.match(replySurface, /onSelectionHighlightColorChange=\{setReplyHighlightColor\}/);
  assert.match(replyFontHandlers, /replyEditorControllerRef\.current\?\.adjustFontSize\(delta\)/);
  assert.match(replyFontHandlers, /replyEditorControllerRef\.current\?\.applyFontSizeValue\(fontSize\)/);
  assert.match(nodeWorkspaceParts, /padding: "7px 8px 24px"/);
  assert.match(nodeWorkspaceParts, /scrollPaddingBottom: 24/);
  assert.doesNotMatch(nodeWorkspaceParts, /selectReplyNumberedMode/);

  assert.match(unifiedRichEditorSurface, /useEditorDocumentFormattingController\s*\(/);
  assert.match(unifiedRichEditorSurface, /onSelectionHighlightColorChange/);
  assert.match(editorSurfaceHandlers, /restoreSelection: restoreEditorSelectionRange/);
  assert.match(editorSurfaceHandlers, /useEditorDocumentFormattingController/);
  assert.match(editorSurfaceHandlers, /applyEditorHighlightColorToRoot/);
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
  assert.match(homeParts, /observer\.observe\(frameDocument\.documentElement\)/);
  assert.match(homeParts, /root\.scrollHeight/);
  assert.match(homeParts, /body\.scrollHeight/);
  assert.match(homeParts, /fillAvailableHeight=\{fill\}/);
  assert.match(homeParts, /frame\.style\.minHeight = "0px"/);
  assert.match(homeParts, /frame\.style\.height = "0px"/);
  assert.match(homeParts, /fillAvailableHeight \? "100%" : minHeight/);
  assert.match(homeParts, /gridTemplateRows: fill \? "minmax\(auto, 1fr\)" : "auto"/);
  assert.doesNotMatch(homeParts, /fill \? \(hasAttachments \? 300 : 360\) : 120/);
  assert.match(homeParts, /setExpandedMessageIDs\(newestMessageID \? new Set\(\[newestMessageID\]\)/);
  assert.match(homeParts, /saveMailReplyEditorHeight/);
  assert.match(homeParts, /MAIL_REPLY_EDITOR_MIN_HEIGHT_PX/);
  assert.match(homePage, /saveCurrentComposeDraft\(\{ quiet: true \}\);\s*setCompose\(emptyCompose\);/);
  assert.match(homePage, /openReply\("reply", message \?\? selectedMessage\)/);
});

test("editor toolbar font, inline, highlight, and outline controls share one controller across rich editor surfaces", () => {
  const editorContent = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorContent.tsx"), "utf8");
  const nodeWorkspaceParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const unifiedRichEditorSurface = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/UnifiedRichEditorSurface.tsx"), "utf8");
  const editorSurfaceHandlers = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts"), "utf8");
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const projectSummary = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"), "utf8");
  const editorTabBar = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorTabBar.tsx"), "utf8");
  const editorTabs = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/editorTabs.ts"), "utf8");
  const logicNodeToolbar = jsxOpeningTagContaining(editorContent, "EditorTabBar", "onAdjustSelectionFontSize={applyEditorSelectionFontSize}", "Logic Gate and node toolbar");
  const projectToolbar = jsxOpeningTagContaining(projectSummary, "EditorTabBar", "documentFontSize={projectSelectionFontSize}", "project toolbar");
  const logicNodeFontHandlers = sourceSliceBetween(editorContent, "const currentFormattingController", "const selectTab", "Logic Gate and node formatting handlers");
  const formattingHook = sourceSliceBetween(
    editorSurfaceHandlers,
    "export function useEditorDocumentFormattingController(",
    "export function useEditorDocumentSurfaceHandlers(",
    "shared formatting-controller hook",
  );
  const fontSizeCommand = sourceSliceBetween(
    editorSurfaceHandlers,
    "export function applyEditorSelectionFontSizeToRoot(",
    "function stripNestedEditorHighlights",
    "shared font-size command",
  );

  assert.match(editorTabs, /UNIFIED_EDITOR_FORMAT_TOOLBAR_TAB_IDS: readonly EditorTabID\[\] = \["format", "outline-styles"\]/);
  assert.match(editorTabBar, /data-mango-unified-editor-toolbar="true"/);
  assertUsesUnifiedFormatToolbarTabs(homeParts);
  assertUsesUnifiedFormatToolbarTabs(nodeWorkspaceParts);
  assert.match(projectSummary, /visibleTabIDs=\{EDITOR_PRIMARY_HEADER_TAB_IDS\}/);
  assert.doesNotMatch(projectSummary, /PROJECT_TEXT_EDITOR_TOOLBAR_TAB_IDS/);

  for (const source of [editorContent, nodeWorkspaceParts, unifiedRichEditorSurface]) {
    assert.match(source, /useEditorDocumentFormattingController\s*\(/);
    for (const localMutationHelper of [
      "applyEditorSelectionFontSizeToRoot",
      "applyEditorHighlightColorToRoot",
      "applyEditorLinkToRoot",
      "insertEditorListKindToRoot",
      "applyEditorNumberedListToRoot",
      "applyEditorIndentCommandToRoot",
    ]) {
      assert.doesNotMatch(source, new RegExp(`${localMutationHelper}\\s*\\(`));
    }
  }
  assertFontToolbarRouting(logicNodeToolbar, "applyEditorSelectionFontSize", "applyEditorSelectionFontSizeValue", "selectionFontSize");
  assert.match(logicNodeFontHandlers, /linkedEntityKind === "node" \? nodeFormattingControllerRef\.current : logicFormattingControllerRef\.current/);
  assert.match(logicNodeFontHandlers, /currentFormattingController\(\)\?\.adjustFontSize\(delta\)/);
  assert.match(logicNodeFontHandlers, /currentFormattingController\(\)\?\.applyFontSizeValue\(nextFontSizeInput\)/);
  assert.match(logicNodeToolbar, /highlightColor=\{selectionHighlightColor\}/);
  assert.match(logicNodeToolbar, /onSetSelectionHighlightColor=\{applyEditorSelectionHighlightColor\}/);

  assert.match(projectToolbar, /onAdjustSelectionFontSize=\{\(delta\) => runProjectFormatCommand\(\(controller\) => controller\.adjustFontSize\(delta\)\)\}/);
  assert.match(projectToolbar, /onSetSelectionFontSize=\{\(fontSize\) => runProjectFormatCommand\(\(controller\) => controller\.applyFontSizeValue\(fontSize\)\)\}/);
  assert.match(projectSummary, /controller\.applyFontSizeValue\(fontSize\)/);
  assert.match(projectSummary, /controller\.applyHighlightColor\(color\)/);
  assert.match(projectSummary, /onSelectionFontSizeChange=\{setProjectSelectionFontSize\}/);
  assert.match(homeParts, /bodyEditorControllerRef\.current\?\.applyFontSizeValue\(fontSize\)/);
  assert.match(homeParts, /bodyEditorControllerRef\.current\?\.adjustFontSize\(delta\)/);
  assert.match(homeParts, /bodyEditorControllerRef\.current\?\.applyHighlightColor\(color\)/);
  assert.match(homeParts, /signatureEditorControllerRef\.current\?\.applyFontSizeValue\(fontSize\)/);
  assert.match(homeParts, /signatureEditorControllerRef\.current\?\.adjustFontSize\(delta\)/);
  assert.match(homeParts, /signatureEditorControllerRef\.current\?\.applyHighlightColor\(color\)/);
  assert.match(nodeWorkspaceParts, /replyEditorControllerRef\.current\?\.applyFontSizeValue\(fontSize\)/);
  assert.match(nodeWorkspaceParts, /replyEditorControllerRef\.current\?\.adjustFontSize\(delta\)/);
  assert.match(nodeWorkspaceParts, /replyEditorControllerRef\.current\?\.applyHighlightColor\(color\)/);

  assert.match(formattingHook, /applyFontSizeValue: \(fontSize\) => \{\s*const editor = restoreFormattingSelection\(\)/);
  assert.match(formattingHook, /adjustFontSize: \(delta\) => \{\s*const editor = restoreFormattingSelection\(\)/);
  assert.match(formattingHook, /applyHighlightColor: \(color\) => \{\s*const editor = restoreFormattingSelection\(\)/);
  assert.match(formattingHook, /insertLink: \(href\) => \{\s*const editor = restoreFormattingSelection\(\)/);
  assert.match(formattingHook, /insertList: \(kind\) => \{\s*const editor = restoreFormattingSelection\(\)/);
  assert.match(formattingHook, /fontSize: pendingEditorFontSizeRef\.current \?\? state\.fontSize/);
  assert.match(formattingHook, /pendingEditorInlineFormatRef\.current \?\? \{\}/);
  assert.match(formattingHook, /pendingEditorTypingCaretRef/);
  assert.match(fontSizeCommand, /if \(!range\) return false;\s*if \(range\.collapsed\) \{\s*options\.pendingEditorFontSizeRef\.current = nextFontSize;\s*options\.pendingEditorTypingCaretRef\.current = getEditorTypingCaretBookmark\(root\)/);
  assert.match(editorSurfaceHandlers, /function editorSelectedTextRuns\(root: HTMLElement, range: Range\)[\s\S]*getEditorRangeOffsets\(root, range\)/);
  assert.match(editorSurfaceHandlers, /const spans = wrapEditorSelectedTextRuns\([\s\S]*span\.style\.fontSize/);
  assert.match(editorSurfaceHandlers, /function normalizeEditorFontSizeSpans\(root: HTMLElement, spans: readonly HTMLSpanElement\[\]\)/);
  assert.match(fontSizeCommand, /normalizeEditorFontSizeSpans\(root, spans\)/);
  assert.doesNotMatch(fontSizeCommand, /span\.appendChild\(fragment\);\s*range\.insertNode\(span\)/);
  assert.match(editorSurfaceHandlers, /onCompositionEnd\(event\) \{[\s\S]*const pendingFontSize = pendingEditorFontSizeRef\.current[\s\S]*const pendingHighlightColor = pendingEditorHighlightColorRef\.current[\s\S]*const pendingInlineFormat = pendingEditorInlineFormatRef\.current[\s\S]*applyEditorTypingStyleToRecentlyInsertedText\(root, composedText, pendingStyle\)/);
  assert.match(editorSurfaceHandlers, /onCompositionStart\(event\) \{[\s\S]*pendingCompositionUndoSnapshotRef\.current[\s\S]*snapshotEditorDocumentRoot\(event\.currentTarget\)/);
  assert.match(editorSurfaceHandlers, /const mutationUndoBefore = undoBefore \?\? snapshotEditorDocumentRoot\(root\)/);
  assert.match(editorSurfaceHandlers, /setEditorSelectionByOffsets\(root, endOffset, endOffset\)/);
});

test("shared toolbar hover and focus styling is scoped to each clickable control", () => {
  const editorTabBar = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorTabBar.tsx"), "utf8");
  const indexCSS = readFileSync(resolve(process.cwd(), "frontend/src/index.css"), "utf8");
  const formatGroupOpening = sourceSliceBetween(
    editorTabBar,
    'data-mango-editor-format-group="true"',
    ">",
    "format control group opening tag",
  );
  const formatControlStyle = sourceSliceBetween(
    editorTabBar,
    "const formatControlStyle =",
    "const formatControlHoverHandlers =",
    "shared format-control style",
  );

  assert.doesNotMatch(formatGroupOpening, /onMouseEnter|onMouseLeave|hoveredFormatControl/);
  assert.doesNotMatch(formatGroupOpening, /outlineMenuAccent|active/);
  assert.match(editorTabBar, /const hovered = hoveredFormatControl === id && !formatControlsDisabled/);
  assert.match(editorTabBar, /const formatControlHoverHandlers = \(id: EditorFormatControlID\) => \(\{/);
  assert.match(formatControlStyle, /background: active\s*\? `linear-gradient\(135deg, \$\{colorWithAlpha\(outlineMenuAccent, 0\.36\)\}, rgba\(94,234,212,0\.28\) 52%, rgba\(168,85,247,0\.24\)\)`/);
  assert.match(formatControlStyle, /boxShadow: active\s*\? `inset 0 0 0 1px \$\{colorWithAlpha\(outlineMenuAccent, 0\.52\)\}, 0 0 8px \$\{colorWithAlpha\(outlineMenuAccent, 0\.18\)\}`/);
  for (const controlID of ["decrease-font", "increase-font", "bold", "underline", "italic", "strikethrough", "highlight", "highlight-menu", "table"]) {
    const controlIndex = editorTabBar.indexOf(`data-mango-editor-format-control="${controlID}"`);
    const hoverIndex = editorTabBar.indexOf(`formatControlHoverHandlers("${controlID}")`, controlIndex);
    assert.ok(controlIndex >= 0, controlID + " control marker must exist");
    assert.ok(hoverIndex > controlIndex && hoverIndex - controlIndex < 240, controlID + " must own its hover handlers");
  }
  assert.match(editorTabBar, /data-mango-editor-format-control="font-size"[\s\S]*onMouseEnter=\{\(\) => setHoveredFormatControl\("font-size"\)\}/);
  assert.match(editorTabBar, /data-mango-editor-format-control=\{controlID\}[\s\S]*formatControlHoverHandlers\(controlID\)/);
  assert.match(indexCSS, /\[data-mango-editor-format-control\]:focus-visible/);
});

test("collapsed-caret font size, highlight, italic, and strikethrough retain pending typing state at the saved caret", () => {
  const editorSurfaceHandlers = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts"), "utf8");
  const fontSizeCommand = sourceSliceBetween(
    editorSurfaceHandlers,
    "export function applyEditorSelectionFontSizeToRoot(",
    "function stripNestedEditorHighlights",
    "shared font-size command",
  );
  const highlightCommand = sourceSliceBetween(
    editorSurfaceHandlers,
    "export function applyEditorHighlightColorToRoot(",
    "export function insertEditorListKindToRoot(",
    "shared highlight command",
  );
  const beforeInput = sourceSliceBetween(editorSurfaceHandlers, "onBeforeInput(event) {", "onPaste(event) {", "shared before-input handler");
  const formattingHook = sourceSliceBetween(
    editorSurfaceHandlers,
    "export function useEditorDocumentFormattingController(",
    "export function useEditorDocumentSurfaceHandlers(",
    "shared formatting-controller hook",
  );

  assert.match(fontSizeCommand, /if \(range\.collapsed\) \{\s*options\.pendingEditorFontSizeRef\.current = nextFontSize;\s*options\.pendingEditorTypingCaretRef\.current = getEditorTypingCaretBookmark\(root\)[\s\S]*return true/);
  assert.match(highlightCommand, /if \(range\.collapsed\) \{\s*options\.pendingEditorHighlightColorRef\.current = color;\s*options\.pendingEditorTypingCaretRef\.current = getEditorTypingCaretBookmark\(root\);\s*return true/);
  assert.match(highlightCommand, /options\.pendingEditorHighlightColorRef\.current = undefined/);
  assert.match(formattingHook, /fontSize: pendingEditorFontSizeRef\.current \?\? state\.fontSize/);
  assert.match(formattingHook, /pendingEditorHighlightColorRef\.current === undefined \? state\.highlightColor : pendingEditorHighlightColorRef\.current/);
  assert.match(formattingHook, /toggleInlineFormat: \(command\) => \{\s*const editor = restoreFormattingSelection\(\)[\s\S]*pendingEditorInlineFormatRef,[\s\S]*pendingEditorTypingCaretRef/);
  assert.match(beforeInput, /pendingFontSize !== null \|\| pendingHighlightColor !== undefined \|\| pendingInlineFormat !== null/);
  assert.match(beforeInput, /if \(pendingStyle && pendingFontSize !== null\) pendingStyle\.fontSize = pendingFontSize/);
  assert.match(beforeInput, /if \(pendingStyle && pendingHighlightColor !== undefined\) pendingStyle\.highlightColor = pendingHighlightColor/);
  assert.match(beforeInput, /if \(pendingStyle && pendingInlineFormat !== null\) pendingStyle\.inlineFormat = pendingInlineFormat/);
  assert.match(editorSurfaceHandlers, /const clearPendingTypingStyle = useCallback\(\(\) => \{\s*pendingEditorFontSizeRef\.current = null;\s*pendingEditorHighlightColorRef\.current = undefined;\s*pendingEditorInlineFormatRef\.current = null;\s*pendingEditorTypingCaretRef\.current = null/);
  assert.match(beforeInput, /const selectionFormat = readEditorSelectionFormatState\(root\)/);
  assert.ok(beforeInput.indexOf("const selectionFormat = readEditorSelectionFormatState(root)") < beforeInput.indexOf("const activeTableCell"));
  assert.match(beforeInput, /if \(includeInlineFormat && !scriptedTypingStyle\.inlineFormat && selectionFormat\) \{\s*scriptedTypingStyle\.inlineFormat = \{\s*bold: selectionFormat\.bold,\s*underline: selectionFormat\.underline,\s*italic: selectionFormat\.italic,\s*strikethrough: selectionFormat\.strikethrough/);
  assert.ok(beforeInput.indexOf("startEditorListFromBlankLine") < beforeInput.indexOf("pendingNativeStyledInsertionRef.current = { text"));
  assert.match(editorSurfaceHandlers, /onInput\(event\) \{[\s\S]*pendingNativeStyledInsertionRef\.current[\s\S]*applyEditorTypingStyleToRecentlyInsertedText\(root, pendingStyledInsertion\.text, pendingStyledInsertion\.style\)/);
  assert.match(editorSurfaceHandlers, /function wrapEditorSelectedTextRunsWithInlineFormat[\s\S]*editorTextNodeHasInlineFormatDefinition\(root, run\.node, command\)/);
  assert.match(editorSurfaceHandlers, /for \(const command of EDITOR_INLINE_STYLE_COMMANDS\) \{[\s\S]*if \(!format\[command\]\) continue;[\s\S]*const tagName = command === "bold" \? "strong" : command === "underline" \? "u" : command === "italic" \? "em" : "s"/);
  assert.match(editorSurfaceHandlers, /if \(style\.inlineFormat\) \{\s*const range = selectInsertedText\(\)/);
  assert.doesNotMatch(editorSurfaceHandlers, /style\.inlineFormat && \(style\.inlineFormat\.bold \|\| style\.inlineFormat\.underline \|\| style\.inlineFormat\.italic \|\| style\.inlineFormat\.strikethrough\)/);
  assert.match(beforeInput, /const anchor = getCollapsedAnchorAtSelectionEnd\(root\)[\s\S]*applyScriptedTypingStyle\(\)/);
  assert.match(editorSurfaceHandlers, /onCompositionEnd\(event\) \{[\s\S]*applyEditorTypingStyleToRecentlyInsertedText\(root, composedText, pendingStyle\)[\s\S]*recordEditorDocumentMutation\([^\n]*"typing"\)/);
  assert.match(editorSurfaceHandlers, /onKeyUp\(event\) \{\s*rememberEditorSelectionRange\(event\.currentTarget\);\s*refreshMentionDraft\(event\.currentTarget\)/);
  assert.match(editorSurfaceHandlers, /const alreadyStyled = editorSelectedTextRuns\(root, range\)\.every\(\(run\) => readEditorTextNodeEffectiveFontSize\(root, run\.node\) === nextFontSize\);\s*if \(!alreadyStyled\)/);
  assert.match(editorSurfaceHandlers, /readSelectionHighlightColor\(root, run\.node\.parentElement \?\? root\) === color\);\s*if \(!alreadyStyled\)/);
  assert.match(editorSurfaceHandlers, /function editorTypingCaretMatches\([\s\S]*range\.compareBoundaryPoints\(0, bookmark\.range\) === 0[\s\S]*range\.compareBoundaryPoints\(2, bookmark\.range\) === 0/);
  assert.match(editorSurfaceHandlers, /const retainsPendingTypingStyle = pendingCaret \? editorTypingCaretMatches\(root, pendingCaret\) : false;[\s\S]*if \(!retainsPendingTypingStyle\) clearPendingTypingStyle\(\)/);
  assert.match(editorSurfaceHandlers, /onInput\(event\) \{[\s\S]*pendingEditorTypingCaretRef\.current = getEditorTypingCaretBookmark\(event\.currentTarget\)/);
});

test("italic, strikethrough, alignment, and table insertion route through the shared toolbar and controller", () => {
  const editorTabBar = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorTabBar.tsx"), "utf8");
  const editorSurfaceHandlers = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts"), "utf8");
  const editorContent = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorContent.tsx"), "utf8");
  const nodeWorkspace = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurface.tsx"), "utf8");
  const nodeWorkspaceParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const unifiedRichEditorSurface = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/UnifiedRichEditorSurface.tsx"), "utf8");
  const projectSummary = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"), "utf8");
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");

  const toolbarOrder = [
    'data-mango-editor-format-control="bold"',
    'data-mango-editor-format-control="underline"',
    'data-mango-editor-format-control="italic"',
    'data-mango-editor-format-control="strikethrough"',
    'data-mango-editor-format-control="highlight"',
    '(["left", "center", "right"] as const).map',
    "{onInsertTable && (",
  ];
  let previousIndex = -1;
  for (const marker of toolbarOrder) {
    const markerIndex = editorTabBar.indexOf(marker);
    assert.ok(markerIndex > previousIndex, marker + " must retain the shared toolbar order");
    previousIndex = markerIndex;
  }

  assert.match(editorSurfaceHandlers, /export type EditorInlineStyleCommand = "bold" \| "underline" \| "italic" \| "strikethrough"/);
  assert.match(editorSurfaceHandlers, /const italicCommandState = readDocumentCommandState\(root, "italic"\)/);
  assert.match(editorSurfaceHandlers, /const strikethroughCommandState = readDocumentCommandState\(root, "strikethrough"\)/);
  assert.match(editorSurfaceHandlers, /command === "strikethrough" \? "strikeThrough" : command/);
  assert.match(editorSurfaceHandlers, /applyEditorInlineFormatToRoot\(editor, command/);
  assert.match(editorSurfaceHandlers, /export function applyEditorTextAlignmentToRoot/);
  assert.match(editorSurfaceHandlers, /applyEditorTableTextAlign\(table, alignment\)/);
  assert.match(editorSurfaceHandlers, /alignment === "center" \? "justifyCenter" : alignment === "right" \? "justifyRight" : "justifyLeft"/);
  assert.match(editorSurfaceHandlers, /applyTextAlignment: \(alignment\) => \{[\s\S]*applyEditorTextAlignmentToRoot\(editor, alignment/);
  assert.match(editorTabBar, /aria-label="Italic"[\s\S]*aria-pressed=\{italicActive\}/);
  assert.match(editorTabBar, /aria-label="Strikethrough"[\s\S]*aria-pressed=\{strikethroughActive\}[\s\S]*onToggleStrikethrough\(\)/);
  assert.match(editorTabBar, /const label = `Align \$\{alignment\}`[\s\S]*aria-pressed=\{active\}/);
  assert.match(editorTabBar, /aria-label="Insert table"[\s\S]*if \(!formatControlsDisabled\) onInsertTable\(\)/);

  for (const source of [editorContent, nodeWorkspaceParts, projectSummary, homeParts]) {
    assert.match(source, /onToggleItalic=/);
    assert.match(source, /onToggleStrikethrough=/);
    assert.match(source, /onSetTextAlignment=/);
    assert.match(source, /onInsertTable=/);
  }
  assert.match(unifiedRichEditorSurface, /onSelectionTextAlignmentChange/);
  assert.doesNotMatch(nodeWorkspace, /aria-label="Insert table"|tableInsertRequest|TableIcon/);
  assert.doesNotMatch(projectSummary, /aria-label="Insert table"|tableInsertRequest|TableIcon/);
});

test("editor header keeps primary controls visible and preserves all secondary overflow actions", () => {
  const editorTabBar = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorTabBar.tsx"), "utf8");
  const editorContent = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorContent.tsx"), "utf8");
  const linkedDocumentPanels = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorLinkedDocumentPanels.tsx"), "utf8");
  const projectSummary = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"), "utf8");

  assert.match(editorTabBar, /const primaryTabs = visibleTabs\.filter\(\(tab\) => EDITOR_PRIMARY_HEADER_TAB_IDS\.includes\(tab\.id\)\)/);
  assert.match(editorTabBar, /const overflowTabs = visibleTabs\.filter\(\(tab\) => EDITOR_OVERFLOW_HEADER_TAB_IDS\.includes\(tab\.id\)\)/);
  assert.match(editorTabBar, /data-mango-editor-header-primary=\{primaryTabs\.map\(\(tab\) => tab\.id\)\.join\(" "\)\}/);
  assert.match(editorTabBar, /aria-label="More editor actions"[\s\S]*aria-haspopup="menu"[\s\S]*data-mango-editor-header-overflow-trigger="true"/);
  assert.match(editorTabBar, /data-mango-editor-header-overflow-menu="true"[\s\S]*\["ArrowDown", "ArrowUp", "Home", "End"\]/);
  assert.match(editorTabBar, /data-mango-editor-header-overflow-action=\{tab\.id\}/);
  assert.match(editorTabBar, /secondaryActions\.map\(\(action\) =>/);
  assert.match(editorTabBar, /data-mango-editor-header-overflow-action=\{action\.id\}/);
  assert.match(editorTabBar, /data-mango-editor-header-overflow-action="save-version"/);
  assert.match(editorTabBar, /flexWrap: singleLine \? "nowrap" : "wrap"[\s\S]*minWidth: singleLine \? "max-content" : undefined/);
  assert.match(editorTabBar, /\}\)\}\s*\{hasOverflowActions && \([\s\S]*data-mango-editor-header-overflow="true"[\s\S]*marginLeft: singleLine \? 0 : "auto"/);
  assert.match(editorTabBar, /const toggleHeaderMenu = \(menu: "outline" \| "highlight" \| "overflow"\)[\s\S]*setOutlineMenuOpen\(menu === "outline" && opening\)[\s\S]*setHighlightMenuOpen\(menu === "highlight" && opening\)[\s\S]*setOverflowMenuOpen\(menu === "overflow" && opening\)/);
  assert.match(editorTabBar, /toggleHeaderMenu\("highlight"\)[\s\S]*toggleHeaderMenu\("outline"\)[\s\S]*toggleHeaderMenu\("overflow"\)/);
  assert.match(editorTabBar, /onCreateRelatedNode\(kind as EditorRelatedNodeCreationKind\)/);
  assert.match(editorContent, /onCreateRelatedNode=/);
  assert.match(editorContent, /onSaveCurrentVersion=/);
  assert.match(editorContent, /secondaryActions=\{linkedEntityKind === "logic_gate" \? \[\{[\s\S]*id: "apply-gvic-to-assigned-nodes"[\s\S]*disabled: !linkedEntityCanEdit \|\| logicGateGVICApplyToAssignedNodesBusy[\s\S]*onSelect: \(\) => setLogicGateGVICApplyConfirmationOpen\(true\)[\s\S]*singleLine/);
  assert.match(editorContent, /logicGateGVICApplyConfirmationOpen && linkedEntityKind === "logic_gate"[\s\S]*<ConfirmActionMenu[\s\S]*title="Apply GVIC to assigned nodes\?"[\s\S]*confirmLabel="Yes"[\s\S]*cancelLabel="No"[\s\S]*onConfirm=\{\(\) => \{[\s\S]*setLogicGateGVICApplyConfirmationOpen\(false\);[\s\S]*applyLogicGateGVICToAssignedNodes\(\)[\s\S]*onCancel=\{\(\) => setLogicGateGVICApplyConfirmationOpen\(false\)\}/);
  assert.match(linkedDocumentPanels, /const GVIC_ROLES:[\s\S]*role: "generated"[\s\S]*role: "verified"[\s\S]*role: "consulted"[\s\S]*role: "informed"[\s\S]*gridTemplateColumns: "repeat\(4, minmax\(145px, 1fr\)\)"[\s\S]*\{GVIC_ROLES\.map/);
  assert.doesNotMatch(linkedDocumentPanels, /Apply GVIC to assigned nodes|Current GVIC|Apply GVIC to all descendants/);
  assert.match(projectSummary, /visibleTabIDs=\{EDITOR_PRIMARY_HEADER_TAB_IDS\}/);
  for (const projectAction of ["assignments", "open-project-tab", "minimize-project"]) {
    assert.match(projectSummary, new RegExp(`id: "${projectAction}"`));
  }
});

test("blocking editor and node overlays use the app modal layer above feature stacking contexts", () => {
  const modalPortal = readFileSync(resolve(process.cwd(), "frontend/src/app/AppModalPortal.tsx"), "utf8");
  const editorSurfaceHandlers = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts"), "utf8");
  const frameRightClickMenu = readFileSync(resolve(process.cwd(), "frontend/src/app/framerightclickmenu.tsx"), "utf8");
  const linkedDocumentPanels = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorLinkedDocumentPanels.tsx"), "utf8");
  const consumerPaths = [
    "frontend/src/app/AppSidebarChrome.tsx",
    "frontend/src/modules/company-explorer/CompanyExplorerDialogs.tsx",
    "frontend/src/modules/editor/NodeWorkspaceSurface.tsx",
    "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx",
    "frontend/src/modules/kanban/KanbanOverlays.tsx",
    "frontend/src/modules/permissions/EntityPermissionsDialog.tsx",
    "frontend/src/modules/project-management/ProjectManagementContent.tsx",
    "frontend/src/modules/project-management/ProjectSummaryContent.tsx",
    "frontend/src/pages/home/HomePage.tsx",
    "frontend/src/pages/home/HomeParts.tsx",
  ];
  assert.match(modalPortal, /const APP_MODAL_LAYER_Z_INDEX = 10100/);
  assert.match(modalPortal, /data-mango-modal-layer="true"/);
  assert.match(modalPortal, /createPortal\([\s\S]*targetDocument\.body/);
  assert.match(modalPortal, /export function useAppOverlayPortalTarget/);
  assert.match(modalPortal, /data-mango-modal-focus-trap=\{trapFocus \? "true" : "false"\}/);
  assert.match(modalPortal, /const trappingLayers = layers\.filter[\s\S]*const activeLayers = trappingLayers\.length > 0 \? trappingLayers : layers/);
  assert.match(modalPortal, /export function appOverlayCanHandleEscape[\s\S]*const activeLayer = activeAppModalLayer\(ownerDocument\)[\s\S]*element\?\.closest<HTMLElement>\(APP_MODAL_LAYER_SELECTOR\) === activeLayer/);
  assert.match(modalPortal, /activeElement\.closest<HTMLElement>\('\[role="menu"\]'\)[\s\S]*:scope > button\[aria-haspopup\]/);
  assert.match(modalPortal, /const fallbackLayer = activeAppModalLayer\(targetDocument, layer\)[\s\S]*appModalFocusableElements\(fallbackLayer\)/);
  assert.match(modalPortal, /element\.matches\(":disabled"\) \|\| element\.tabIndex < 0 \|\| element\.getClientRects\(\)\.length === 0[\s\S]*current\.hasAttribute\("inert"\)/);
  assert.match(modalPortal, /zIndex: trapFocus \? APP_MODAL_LAYER_Z_INDEX : APP_MODAL_LAYER_Z_INDEX - 10/);
  assert.match(modalPortal, /targetDocument\.addEventListener\("keydown", onKeyDown\)/);
  assert.match(modalPortal, /targetDocument\.addEventListener\("focusin", onFocusIn, true\)/);
  assert.match(modalPortal, /previousFocus\?\.isConnected[\s\S]*previousFocus\.focus\(\{ preventScroll: true \}\)[\s\S]*targetDocument\.activeElement === previousFocus/);
  for (const path of consumerPaths) {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    assert.match(source, /AppModalPortal/, path + " must escape feature-local stacking contexts");
  }
  assert.match(editorSurfaceHandlers, /React\.createElement\(AppModalPortal, \{ onRequestClose: \(\) => setActiveImagePreview\(null\) \}, imagePreviewModal\)/);
  assert.match(frameRightClickMenu, /const portalTarget = useAppOverlayPortalTarget\(\)[\s\S]*portalTarget \? createPortal/);
  assert.match(frameRightClickMenu, /if \(!appOverlayCanHandleEscape\(menuRef\.current\)\) return/);
  assert.match(linkedDocumentPanels, /const floatingPortalTarget = useAppOverlayPortalTarget\(\)[\s\S]*createPortal\([\s\S]*floatingPortalTarget/);
  const kanbanOverlay = readFileSync(resolve(process.cwd(), "frontend/src/modules/kanban/KanbanOverlays.tsx"), "utf8");
  const projectSummary = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"), "utf8");
  assert.match(kanbanOverlay, /useAppViewportAnchorRect\(boardRootRef\)/);
  assert.match(projectSummary, /useAppViewportAnchorRect\(containerRef\)/);
  assert.match(projectSummary, /<AppModalPortal onRequestClose=\{saving \? undefined : onClose\}>[\s\S]*disabled=\{saving\}[\s\S]*Save Assignments/);
  assert.match(kanbanOverlay, /data-mango-editor-overlay-backdrop=\{fullscreen \? "modal" : "modeless"\}/);
  assert.match(kanbanOverlay, /trapFocus=\{fullscreen\}/);
});

test("highlight control, active selection state, mutation, and sanitization share one source", () => {
  const editorTabBar = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorTabBar.tsx"), "utf8");
  const editorSurfaceHandlers = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts"), "utf8");
  const richTextEditing = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/richTextEditing.ts"), "utf8");
  const editorContent = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/EditorContent.tsx"), "utf8");
  const nodeWorkspaceParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const unifiedRichEditorSurface = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/UnifiedRichEditorSurface.tsx"), "utf8");
  const highlightCommand = sourceSliceBetween(
    editorSurfaceHandlers,
    "export function applyEditorHighlightColorToRoot(",
    "export function insertEditorListKindToRoot(",
    "shared selected-range highlight command",
  );
  const formattingHook = sourceSliceBetween(
    editorSurfaceHandlers,
    "export function useEditorDocumentFormattingController(",
    "export function useEditorDocumentSurfaceHandlers(",
    "shared formatting-controller hook",
  );
  const highlightMain = sourceSliceBetween(
    editorTabBar,
    'aria-label="Apply text highlight"',
    'aria-label="Choose highlight color"',
    "highlight split-button main action",
  );
  const highlightArrow = sourceSliceBetween(
    editorTabBar,
    'aria-label="Choose highlight color"',
    "{highlightMenuOpen && (",
    "highlight split-button menu action",
  );

  assert.match(editorTabBar, /highlightColor: EditorHighlightColor \| null/);
  assert.match(editorTabBar, /onSetSelectionHighlightColor: \(color: EditorHighlightColor \| null\) => void/);
  assert.match(editorTabBar, /role="group" aria-label="Text highlight"/);
  assert.match(highlightMain, /data-mango-editor-format-control="highlight"/);
  assert.match(highlightMain, /onSetSelectionHighlightColor\(highlightColor === customHighlightColor \? null : customHighlightColor\)/);
  assert.doesNotMatch(highlightMain, /toggleHeaderMenu\("highlight"\)/);
  assert.doesNotMatch(editorTabBar, /if \(highlightColor\) setCustomHighlightColor\(highlightColor\)/);
  assert.match(highlightArrow, /data-mango-editor-format-control="highlight-menu"/);
  assert.match(highlightArrow, /aria-haspopup="menu"[\s\S]*aria-expanded=\{highlightMenuOpen\}/);
  assert.match(highlightArrow, /toggleHeaderMenu\("highlight"\)/);
  assert.doesNotMatch(highlightArrow, /onSetSelectionHighlightColor/);
  assert.match(editorTabBar, /aria-label="Text highlight colors"/);
  assert.match(editorTabBar, /onSetSelectionHighlightColor\(item\.color\);\s*setCustomHighlightColor\(item\.color\)/);
  assert.match(editorTabBar, /aria-label="No highlight"[\s\S]*onSetSelectionHighlightColor\(null\)[\s\S]*No highlight/);
  assert.match(editorTabBar, /Custom highlight color/);

  assert.match(editorSurfaceHandlers, /export function applyEditorHighlightColorToRoot/);
  assert.match(editorSurfaceHandlers, /applyHighlightColor: \(color: EditorHighlightColor \| null\) => boolean/);
  assert.match(editorSurfaceHandlers, /highlightColor: EditorHighlightColor \| null/);
  assert.match(highlightCommand, /if \(range\.collapsed\) \{\s*options\.pendingEditorHighlightColorRef\.current = color;\s*options\.pendingEditorTypingCaretRef\.current = getEditorTypingCaretBookmark\(root\);\s*return true/);
  assert.match(formattingHook, /applyHighlightColor: \(color\) => \{\s*const editor = restoreFormattingSelection\(\)[\s\S]*applyEditorHighlightColorToRoot\(editor, color[\s\S]*pendingEditorHighlightColorRef/);
  assert.match(editorSurfaceHandlers, /pendingEditorHighlightColorRef: React\.MutableRefObject<EditorHighlightColor \| null \| undefined>/);

  assert.match(richTextEditing, /EDITOR_HIGHLIGHT_ATTRIBUTE/);
  assert.match(richTextEditing, /EDITOR_HIGHLIGHT_COLOR_ITEMS/);
  assert.match(richTextEditing, /normalizeEditorHighlightColor/);
  assert.match(richTextEditing, /setEditorElementHighlight/);
  assert.match(richTextEditing, /applySafeHighlight\(element, span\)/);

  for (const source of [editorContent, nodeWorkspaceParts, unifiedRichEditorSurface]) {
    assert.match(source, /onSelectionHighlightColorChange/);
    assert.match(source, /pendingEditorHighlightColorRef/);
  }
});

test("mentions, image preview and undo hydration, and retired table-cell controls retain shared editor semantics", () => {
  const editorSurfaceHandlers = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts"), "utf8");
  const editorImages = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/editorImages.ts"), "utf8");
  const richTextEditing = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/richTextEditing.ts"), "utf8");
  const mentionCaretNormalization = sourceSliceBetween(
    editorSurfaceHandlers,
    "function breakEditorMentionsForInput(",
    "function mentionAtTextBoundary(",
    "atomic mention caret normalization",
  );
  const atomicMentionHelpers = sourceSliceBetween(
    editorSurfaceHandlers,
    "function mentionAtTextBoundary(",
    "function replaceSelectionWithHTML(",
    "atomic mention navigation and editing helpers",
  );
  const imagePreview = sourceSliceBetween(
    editorSurfaceHandlers,
    "const imagePreviewModal = activeImagePreview",
    "const tableContextMenuButtonStyle =",
    "stable inline-image preview",
  );
  const undoRestore = sourceSliceBetween(
    editorSurfaceHandlers,
    "function restoreEditorDocumentUndoSnapshot(",
    "function applyEditorUndoCommand(",
    "editor undo restore",
  );
  const attachmentRefresh = sourceSliceBetween(
    editorImages,
    "export function refreshEditorAttachmentImageFrames(",
    "export function clearEditorImageSelection(",
    "attachment image hydration refresh",
  );
  const retiredTableAlignmentControls = sourceSliceBetween(
    richTextEditing,
    "export function ensureEditorTableAlignmentControls(",
    "function readEditorGridTableColumns(",
    "retired table-cell alignment controls",
  );

  assert.match(mentionCaretNormalization, /normalized\.setStartBefore\(startMention\)[\s\S]*normalized\.setEndAfter\(endMention\)[\s\S]*setEditorSelectionRange\(root, normalized\)/);
  assert.match(mentionCaretNormalization, /never dissolve the[\s\S]*entity into ordinary text[\s\S]*return null/);
  assert.doesNotMatch(mentionCaretNormalization, /replaceWith|createTextNode|\.textContent\s*=/);
  assert.match(atomicMentionHelpers, /function setSelectionBesideMention[\s\S]*range\.setStartBefore\(mention\)[\s\S]*range\.setStartAfter\(mention\)/);
  assert.match(atomicMentionHelpers, /function moveEditorSelectionAcrossMention[\s\S]*selectionRange\.selectNode\(mention\)/);
  assert.match(atomicMentionHelpers, /function applyAtomicMentionKeyboardEdit[\s\S]*mention\.remove\(\)[\s\S]*recordEditorDocumentMutation\(documentUndoHistory, root, undoBefore, "delete"\)/);
  assert.match(editorSurfaceHandlers, /event\.key === "ArrowLeft" \|\| event\.key === "ArrowRight"[\s\S]*moveEditorSelectionAcrossMention\(root,[\s\S]*event\.shiftKey/);
  assert.match(editorSurfaceHandlers, /event\.key === "Backspace"[\s\S]*event\.key === "Delete"[\s\S]*applyAtomicMentionKeyboardEdit\(/);

  assert.match(imagePreview, /role: "dialog"[\s\S]*"aria-modal": true[\s\S]*position: "fixed"[\s\S]*inset: 0/);
  assert.match(imagePreview, /"aria-label": "Close image preview"[\s\S]*onClick: \(\) => setActiveImagePreview\(null\)[\s\S]*top: 18[\s\S]*right: 18[\s\S]*background: "#ef4444"/);
  assert.match(imagePreview, /width: "auto"[\s\S]*height: "auto"[\s\S]*maxWidth: "calc\(100vw - 32px\)"[\s\S]*maxHeight: "calc\(100vh - 32px\)"/);
  assert.doesNotMatch(imagePreview, /setTimeout|requestAnimationFrame|animation:|transition:|outline:/);

  assert.ok(undoRestore.indexOf("root.innerHTML = deserializeEditorDocumentHTML(snapshot.html)") < undoRestore.indexOf("refreshEditorAttachmentImageFrames(root)"));
  assert.ok(undoRestore.indexOf("refreshEditorAttachmentImageFrames(root)") < undoRestore.indexOf("setEditorSelectionByOffsets(root"));
  assert.match(attachmentRefresh, /const owner = editorAttachmentHydrationOwnerByRoot\.get\(root\)[\s\S]*owner\.disposeGeneration\?\.\(\);[\s\S]*owner\.disposeGeneration = startEditorAttachmentImageHydrationGeneration\(root, owner\.loadObjectURL\)/);

  assert.match(retiredTableAlignmentControls, /querySelectorAll\(`\[\$\{EDITOR_TABLE_ALIGNMENT_CONTROL_ATTRIBUTE\}="true"\]`\)\.forEach\(\(control\) => control\.remove\(\)\)/);
  assert.doesNotMatch(retiredTableAlignmentControls, /createElement|appendChild|<button|aria-label/);
});

test("mail signatures are mailbox scoped unified rich editors and late hydration only backfills the pending new draft", () => {
  const homePage = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomePage.tsx"), "utf8");
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const homeMailDrafts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/homeMailDrafts.ts"), "utf8");
  const signaturePanel = sourceSliceBetween(homeParts, "{signatureEditorOpen && (", "\n        )}", "signature editor panel");
  const signatureToolbar = jsxOpeningTagContaining(signaturePanel, "EditorTabBar", "activeTab={signatureToolbarTab}", "signature toolbar");
  const signatureSurface = jsxOpeningTagContaining(signaturePanel, "UnifiedRichEditorSurface", 'surfaceID="email-signature"', "signature surface");

  assert.match(homePage, /pendingAutoSignatureRef/);
  assert.match(homePage, /activeSignatureScopeKey/);
  assert.match(homePage, /loadHomeMailSignature\(companyID, currentUserID, activeSharedInboxFolderID, activeMailAccountEmail\)/);
  assert.match(homePage, /current\.draftID !== pending\.draftID/);
  assert.match(homePage, /applyHomeMailSignature\(current\.body, emailSignature\)/);
  assert.match(homePage, /emailSignature=\{composeScopeEmailSignature\}/);
  assert.match(homePage, /compose: submittedCompose/);
  assert.match(homeMailDrafts, /export function homeMailSignatureScopeKey/);
  assert.match(homeMailDrafts, /export function homeMailBodyHasSignature/);
  assert.match(homeParts, /applyHomeMailSignature\(currentBody, signature\)/);
  assert.doesNotMatch(homeParts, /compose\.body\.endsWith\(signature\)/);
  assert.match(signatureToolbar, /onAdjustSelectionFontSize=\{adjustSignatureFontSize\}/);
  assert.match(signatureToolbar, /onSetSelectionFontSize=\{setSignatureFontSize\}/);
  assert.match(signatureToolbar, /onSetSelectionHighlightColor=\{setSignatureSelectionHighlightColor\}/);
  assert.match(signatureSurface, /surfaceID="email-signature"/);
  assert.match(signatureSurface, /formattingControllerRef=\{signatureEditorControllerRef\}/);
  assert.match(homeParts, /signatureEditorImageAttachmentContext/);
  assert.match(homeParts, /resourceType: "email_signature"/);
  assert.match(signaturePanel, /signatureEditorControllerRef\.current\?\.flush\(\)/);
  assert.doesNotMatch(signaturePanel, /<textarea\b/);
  assert.match(homeMailDrafts, /body_editor_html/);
});

test("signature hydration, empty remote rows, and attachment scope preserve the mailbox owner", () => {
  const homePage = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomePage.tsx"), "utf8");
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const homeMailWorkspace = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeMailWorkspace.tsx"), "utf8");
  const homeMailDrafts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/homeMailDrafts.ts"), "utf8");
  const hydration = sourceSliceBetween(
    homePage,
    "const localSignature = readHomeMailSignature",
    "const pending = pendingAutoSignatureRef.current",
    "remote signature hydration",
  );
  const signatureEdits = sourceSliceBetween(
    homePage,
    "const handleEmailSignatureChange",
    "const activeMessageListKey",
    "signature edit and save handlers",
  );
  const signatureLoader = sourceSliceBetween(
    homeMailDrafts,
    "export async function loadHomeMailSignature(",
    "export async function saveHomeMailSignatureRemote(",
    "mailbox signature loader",
  );

  assert.match(homeMailDrafts, /function homeMailSignaturePendingSyncKey/);
  assert.match(homeMailDrafts, /function markPendingHomeMailSignatureSync/);
  assert.match(homeMailDrafts, /function clearPendingHomeMailSignatureSync/);
  assert.match(homeMailDrafts, /if \(localStorage\.getItem\(key\) === signature\) localStorage\.removeItem\(key\)/);
  assert.match(signatureLoader, /const pendingSignature = readPendingHomeMailSignatureSync/);
  assert.match(signatureLoader, /if \(pendingSignature !== null\) \{[\s\S]*saveHomeMailSignature\(companyID, userID, pendingSignature[\s\S]*bodyEditorHTML: pendingSignature/);
  assert.match(signatureLoader, /return readPendingHomeMailSignatureSync\(companyID, userID, sharedInboxID, accountEmail\)[\s\S]*\?\? readHomeMailSignature\(companyID, userID, sharedInboxID, accountEmail\)/);
  assert.ok(
    signatureLoader.indexOf("if (pendingSignature !== null)") < signatureLoader.indexOf("if (remoteSignature)"),
    "a failed mailbox-scoped save must retry before an older remote row can replace it",
  );
  assert.match(homePage, /const emailSignatureEditRevisionRef = useRef\(0\)/);
  assert.match(hydration, /const editRevisionAtLoadStart = emailSignatureEditRevisionRef\.current/);
  assert.match(hydration, /if \(cancelled \|\| emailSignatureEditRevisionRef\.current !== editRevisionAtLoadStart\) return/);
  assert.match(signatureEdits, /handleEmailSignatureChange[\s\S]*emailSignatureEditRevisionRef\.current \+= 1/);
  assert.match(signatureEdits, /handleSaveEmailSignature[\s\S]*emailSignatureEditRevisionRef\.current \+= 1/);

  assert.match(signatureLoader, /if \(remoteSignature\) \{\s*const body = remoteSignature\.body_editor_html \?\? ""/);
  assert.match(signatureLoader, /saveHomeMailSignature\(companyID, userID, body, sharedInboxID, accountEmail\);\s*return body/);
  assert.ok(
    signatureLoader.indexOf("if (remoteSignature)") < signatureLoader.indexOf("if (localSignature.trim())"),
    "an existing remote row, including an empty body, must win before local fallback upload",
  );

  assert.match(homePage, /emailSignatureAccountEmail=\{composeSignatureAccountEmail\}/);
  assert.match(homeMailWorkspace, /emailSignatureAccountEmail: string/);
  assert.match(homeMailWorkspace, /emailSignatureAccountEmail=\{emailSignatureAccountEmail\}/);
  assert.match(homeParts, /accountEmail: emailSignatureAccountEmail/);
  assert.match(homeParts, /const composeAttachmentResourceID[\s\S]*accountEmail: compose\.accountEmail/);
  const signatureAttachmentScope = sourceSliceBetween(
    homeParts,
    "const signatureAttachmentResourceID",
    "[compose.sharedInboxID, currentUserID, emailSignatureAccountEmail]",
    "signature attachment resource scope",
  );
  assert.doesNotMatch(signatureAttachmentScope, /accountEmail: compose\.accountEmail/);
  assert.match(homeMailDrafts, /const homeMailSignatureLocalRevisions = new Map<string, number>\(\)/);
  assert.match(signatureLoader, /const localRevisionAtLoadStart = readHomeMailSignatureLocalRevision\(scopeKey\)/);
  assert.match(signatureLoader, /readHomeMailSignatureLocalRevision\(scopeKey\) !== localRevisionAtLoadStart/);
  assert.match(signatureLoader, /await queueHomeMailSignatureRemoteSave\(scopeKey,[\s\S]*bodyEditorHTML: localSignature/);
});

test("signature Save persists the exact serialized editor HTML returned by flush", () => {
  const unifiedRichEditorSurface = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/UnifiedRichEditorSurface.tsx"), "utf8");
  const nodeWorkspaceParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const homeMailWorkspace = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeMailWorkspace.tsx"), "utf8");
  const homePage = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomePage.tsx"), "utf8");
  const homeMailDrafts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/homeMailDrafts.ts"), "utf8");
  const flushImplementation = sourceSliceBetween(
    unifiedRichEditorSurface,
    "const flushDocumentSave",
    "const handleSelectionFontSizeChange",
    "unified rich-editor flush implementation",
  );
  const signaturePanel = sourceSliceBetween(homeParts, "{signatureEditorOpen && (", "\n        )}", "signature editor panel");
  const saveHandler = sourceSliceBetween(
    homePage,
    "const handleSaveEmailSignature",
    "const activeMessageListKey",
    "mailbox signature save handler",
  );
  const remoteSave = sourceSliceBetween(
    homeMailDrafts,
    "export async function saveHomeMailSignatureRemote(",
    "clearPendingHomeMailSignatureSync(companyID, userID, signature, sharedInboxID, accountEmail);",
    "remote signature save",
  );

  assert.match(unifiedRichEditorSurface, /flush: \(\) => string/);
  assert.match(flushImplementation, /editorRef\.current \? serializeEditorDocumentHTML\(editorRef\.current\) : lastAppliedValueRef\.current/);
  assert.match(flushImplementation, /return nextValue/);
  assert.match(unifiedRichEditorSurface, /flush: \(\) => flushDocumentSave\(\)/);
  assert.match(unifiedRichEditorSurface, /if \(lastAppliedValueRef\.current === value && attachmentHydrationContextKeyRef\.current === hydrationContextKey\) return/);
  assert.doesNotMatch(unifiedRichEditorSurface, /editorHasFocus/);
  assert.match(unifiedRichEditorSurface, /restoreSelectionForHydrationRef\.current\?\.\(editor\);\s*const selectionOffsets = getEditorSelectionOffsets\(editor\)/);
  assert.match(unifiedRichEditorSurface, /setEditorSelectionByOffsets\(editor, selectionOffsets\.start, selectionOffsets\.end\)/);
  assert.match(homeParts, /key=\{.compose-editor:/);
  assert.match(homeParts, /key=\{.signature-editor:/);
  assert.match(nodeWorkspaceParts, /key=\{.attached-email-reply:/);
  assert.match(signaturePanel, /const signature = signatureEditorControllerRef\.current\?\.flush\(\) \?\? emailSignature/);
  assert.match(signaturePanel, /onSaveEmailSignature\(signature\)/);
  assert.match(homeMailWorkspace, /onSaveEmailSignature: \(signature: string\) => void/);
  assert.match(homeMailWorkspace, /onSaveEmailSignature=\{onSaveEmailSignature\}/);
  assert.match(saveHandler, /setEmailSignature\(signature\)/);
  assert.match(saveHandler, /saveHomeMailSignatureRemote\(companyID, currentUserID, signature, sharedInboxID, composeSignatureAccountEmail\)/);
  assert.match(saveHandler, /\.then\(\(\) => setNotice\("Signature saved\."\)\)/);
  assert.match(saveHandler, /\.catch\(\(\) => setNotice\("Signature save failed\. Mango will retry this mailbox-scoped edit; retry before leaving if it remains unsynced\."\)\)/);
  assert.match(remoteSave, /saveHomeMailSignature\(companyID, userID, signature, sharedInboxID, accountEmail\)/);
  assert.match(remoteSave, /markPendingHomeMailSignatureSync\(companyID, userID, signature, sharedInboxID, accountEmail\)/);
  assert.match(remoteSave, /await queueHomeMailSignatureRemoteSave\(scopeKey,[\s\S]*saveEmailSignature\(\{ companyID, sharedInboxID, accountEmail, bodyEditorHTML: signature \}\)/);
  assert.match(homeMailDrafts, /const current = previous\.catch\(\(\) => undefined\)\.then\(async \(\) => \{\s*await save\(\)/);
  assert.match(homeMailDrafts, /clearPendingHomeMailSignatureSync\(companyID, userID, signature, sharedInboxID, accountEmail\)/);
});

test("My and Shared Triage submit the exact serialized editor HTML returned by flush", () => {
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const homeMailWorkspace = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeMailWorkspace.tsx"), "utf8");
  const homePage = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomePage.tsx"), "utf8");
  const submitHandler = sourceSliceBetween(
    homeParts,
    "const handleSubmit =",
    "return (",
    "compose rich-editor submit handler",
  );
  const submitCompose = sourceSliceBetween(
    homePage,
    "const submitCompose =",
    "useEffect(() => {",
    "home compose submission",
  );

  assert.match(submitHandler, /const body = bodyEditorControllerRef\.current\?\.flush\(\) \?\? compose\.body/);
  assert.match(submitHandler, /const submittedCompose = body === compose\.body \? compose : \{ \.\.\.compose, body \}/);
  assert.match(submitHandler, /onChange\(submittedCompose\)/);
  assert.match(submitHandler, /onSubmit\(event, submittedCompose\)/);
  assert.match(homeParts, /const handleSaveDraft = \(\) => \{[\s\S]*bodyEditorControllerRef\.current\?\.flush\(\)[\s\S]*onSaveDraft\(composeToSave\)/);
  assert.match(homeMailWorkspace, /onSaveComposeDraft: \(compose: ComposeState\) => void/);
  assert.match(homeMailWorkspace, /onSubmitCompose: \(event: React\.FormEvent, compose: ComposeState\) => void/);
  assert.match(submitCompose, /composeAtSubmit: ComposeState/);
  assert.match(submitCompose, /let submittedCompose = composeAtSubmit/);
  assert.doesNotMatch(submitCompose, /let submittedCompose = compose;/);
});

test("draft and signature persistence reject inline file bytes before durable writes", () => {
  const handlers = readFileSync(resolve(process.cwd(), "backend/internal/http/communications_email_draft_handlers.go"), "utf8");
  const behaviorTests = readFileSync(resolve(process.cwd(), "backend/internal/http/communications_email_draft_handlers_test.go"), "utf8");
  const draftUpsert = sourceSliceBetween(
    handlers,
    "func (s *Server) handleCommunicationsEmailDraftUpsert(",
    "func (s *Server) handleCommunicationsEmailDraftDelete(",
    "email draft upsert handler",
  );
  const signatureUpsert = sourceSliceBetween(
    handlers,
    "func (s *Server) handleCommunicationsEmailSignatureUpsert(",
    "func (scope resolvedCommunicationsEmailScope) signatureScopeInput(",
    "email signature upsert handler",
  );

  assert.match(draftUpsert, /rejectDurableInlineFileBytes\(w, "communications_email_draft", req\.BodyEditorHTML\)/);
  assert.match(signatureUpsert, /rejectDurableInlineFileBytes\(w, "communications_email_signature", req\.BodyEditorHTML\)/);
  assert.match(behaviorTests, /func TestCommunicationsEmailDraftRejectsInlineFileBytes/);
  assert.match(behaviorTests, /func TestCommunicationsEmailSignatureRejectsInlineFileBytes/);
  assert.match(behaviorTests, /data:image\/png;base64,aGVsbG8=/);
  assert.match(behaviorTests, /http\.StatusBadRequest/);
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
    "pin",
    "delete",
  ]);
  assert.deepEqual(UNIFIED_NODE_SHELL_SURFACE_CONTRACTS.map((surface) => surface.id), [
    "home-node-popup",
    "app-sidebar-node-popup",
    "dock-restored-node-popup",
    "updates-node-panel",
    "kanban-my-work-node-overlay",
    "project-critical-path-inline-node",
    "project-relationships-node-panel",
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
    "pin",
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
  assert.match(kanbanOverlays, /<AppModalPortal ownerDocument=\{boardRootRef\.current\?\.ownerDocument\} trapFocus=\{fullscreen\} onRequestClose=\{onClose\}>/);
  assert.match(kanbanOverlays, /position: "fixed"/);
  assert.match(kanbanOverlays, /top: fullscreen \? NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX : normalTopPx/);
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
  assert.match(projectSummary, /surfaceID="project-relationships-node-panel"/);
  assert.match(projectSummary, /id: "fullscreen"/);
  assert.match(projectSummary, /pressed: fullscreen/);
  assert.match(projectSummary, /NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX/);
  assert.match(projectSummary, /NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX/);
  assert.match(projectSummary, /onNodeOpen\(selection\.nodeID\)/);
});
