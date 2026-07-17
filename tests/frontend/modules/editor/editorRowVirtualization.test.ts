import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildBoundedEditorRowEntries,
  computeBoundedEditorRowWindow,
  countMountedEditorRows,
} from "../../../../frontend/src/modules/editor/editorRowVirtualization.js";

const ROW_HEIGHT = 700;
const ROW_GAP = 12;
const ITEM_COUNT = 1_000;

function windowAt(scrollTop: number, targetIndex?: number) {
  return computeBoundedEditorRowWindow({
    itemCount: ITEM_COUNT,
    rowHeight: ROW_HEIGHT,
    rowGap: ROW_GAP,
    scrollTop,
    viewportHeight: 900,
    listOffset: 40,
    overscan: 2,
    targetIndex,
  });
}

function mountedCount(scrollTop: number, targetIndex?: number, pinnedIndices: number[] = []) {
  return countMountedEditorRows(buildBoundedEditorRowEntries(
    ITEM_COUNT,
    ROW_HEIGHT,
    ROW_GAP,
    windowAt(scrollTop, targetIndex),
    pinnedIndices,
  ));
}

test("a large Node mounts only the visible rows plus bounded overscan", () => {
  assert.ok(mountedCount(0) <= 6);
  assert.ok(mountedCount(350_000) <= 7);
});

test("a large Project uses the same bounded mounted-row invariant", () => {
  const nearEnd = (ITEM_COUNT - 2) * (ROW_HEIGHT + ROW_GAP);
  assert.ok(mountedCount(nearEnd) <= 6);
});

test("scrolling moves the mounted window without changing its bound", () => {
  const top = windowAt(0);
  const middle = windowAt(250 * (ROW_HEIGHT + ROW_GAP));
  assert.ok(middle.startIndex > top.endIndex);
  assert.ok(mountedCount(250 * (ROW_HEIGHT + ROW_GAP)) <= 7);
});

test("a deep target centers its neighborhood instead of mounting from the top", () => {
  const targeted = windowAt(0, 700);
  assert.ok(targeted.startIndex > 695);
  assert.ok(targeted.startIndex <= 700);
  assert.ok(targeted.endIndex >= 700);
  assert.ok(mountedCount(0, 700) <= 6);
});

test("fast long jumps stay bounded and preserve full scroll geometry", () => {
  const target = windowAt(0, 990);
  const entries = buildBoundedEditorRowEntries(ITEM_COUNT, ROW_HEIGHT, ROW_GAP, target);
  assert.ok(countMountedEditorRows(entries) <= 6);
  const representedHeight = entries.reduce(
    (height, entry) => height + (entry.kind === "spacer" ? entry.height : ROW_HEIGHT + ROW_GAP),
    0,
  );
  assert.equal(representedHeight, ITEM_COUNT * (ROW_HEIGHT + ROW_GAP));
});

test("focused rows can remain mounted without unbounding the list", () => {
  const entries = buildBoundedEditorRowEntries(
    ITEM_COUNT,
    ROW_HEIGHT,
    ROW_GAP,
    windowAt(0),
    [500, 900],
  );
  assert.ok(countMountedEditorRows(entries) <= 8);
});

test("Node and Project integrate one row primitive, fixed sections, independent toggles, and horizontal resizing", () => {
  const node = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurface.tsx"), "utf8");
  const project = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"), "utf8");
  const parts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const syncHook = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/useCollaborativeEditorDocument.ts"), "utf8");
  const logicGate = readFileSync(resolve(process.cwd(), "frontend/src/modules/logic-gate-map/LogicGateMapContent.tsx"), "utf8");

  assert.match(node, /data-mango-bounded-editor-rows="node"/);
  assert.match(project, /data-mango-bounded-editor-rows="project"/);
  assert.match(node, /data-node-text-box-columns="email-editor-chat"/);
  assert.match(project, /data-project-text-box-columns="email-editor-chat"/);
  for (const source of [node, project]) {
    assert.match(source, /aria-label="Toggle email column"/);
    assert.match(source, /aria-label="Toggle text editor column"/);
    assert.match(source, /aria-label="Toggle chat column"/);
  }
  assert.ok(node.includes("Resize ${pane} column"));
  assert.ok(project.includes('aria-label="Resize email column"'));
  assert.ok(project.includes('aria-label="Resize chat column"'));
  assert.ok(!node.includes("tabbed={emailOriginPrimaryRow}"));
  assert.match(parts, /resize: "none"/);
  assert.ok(node.includes("fixedHeight={TEXT_BLOCK_MIN_HEIGHT}"));
  assert.ok(project.includes("fixedHeight={TEXT_BLOCK_MIN_HEIGHT}"));
  assert.ok(node.includes("storedLayout?.initialized ? storedLayout.openEditorBlockIDs : blockIDs"));
  assert.ok(project.includes("setOpenEditorBlockIDs(new Set(nextBlockIDs))"));
  assert.ok(node.includes("emailPaneIsVisible || emailReplyBlockID === block.id"));
  assert.ok(project.includes("emailOpen || emailReplyBlockID === block.id"));
  const flushInputIndex = syncHook.indexOf("flushPendingLocalInput?.();");
  const flushControllerIndex = syncHook.indexOf("controller.flush()", flushInputIndex);
  const stopControllerIndex = syncHook.indexOf("controller.stop();", flushControllerIndex);
  assert.ok(flushInputIndex >= 0 && flushControllerIndex > flushInputIndex && stopControllerIndex > flushControllerIndex);
  assert.doesNotMatch(logicGate, /useBoundedEditorRowVirtualization|data-mango-bounded-editor-rows/);
});

test("target intent is passed through for Project navigation and resolved after data loads", () => {
  const app = readFileSync(resolve(process.cwd(), "frontend/src/app/applayout.tsx"), "utf8");
  const content = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/ProjectManagementContent.tsx"), "utf8");
  const summary = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"), "utf8");
  assert.ok(app.includes("targetProjectInformationID={projectManagementTarget?.informationID}"));
  assert.ok(content.includes("focusInformationID={targetProjectID?.trim() === activeProjectID ? targetProjectInformationID : undefined}"));
  assert.ok(summary.includes("if (!targetID || focusTargetIndex < 0) return;"));
  assert.ok(summary.includes("projectRowVirtualizer.mountAndScrollToIndex(focusTargetIndex)"));
});
