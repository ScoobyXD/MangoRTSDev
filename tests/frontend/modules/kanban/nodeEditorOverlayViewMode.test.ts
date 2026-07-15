import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { shouldResetNodeEditorOverlayViewMode } from "../../../../frontend/src/modules/kanban/nodeEditorOverlayViewMode.js";

test("same-node projection refreshes preserve fullscreen while a different node resets the view mode", () => {
  const openNode = { nodeID: "node-1" };

  assert.equal(shouldResetNodeEditorOverlayViewMode(openNode, "node-1"), false);
  assert.equal(
    shouldResetNodeEditorOverlayViewMode({ ...openNode }, "node-1"),
    false,
    "a realtime card projection update must not collapse the same node",
  );
  assert.equal(shouldResetNodeEditorOverlayViewMode(openNode, "node-2"), true);
  assert.equal(shouldResetNodeEditorOverlayViewMode(null, "node-1"), true);
});

test("route-controlled node open and close do not retrigger from local overlay state", () => {
  const source = readFileSync(resolve(process.cwd(), "frontend/src/modules/kanban/KanbanContent.tsx"), "utf8");
  const callback = source.match(/const openNodeEditorOverlay = useCallback\([\s\S]*?\n  \}, \[([^\]]*)\]\);/);

  if (!callback) throw new Error("Kanban node overlay open callback remains identifiable");
  assert.doesNotMatch(
    callback[1],
    /\bnodeEditorOverlay\b/,
    "local overlay state must not change the callback identity and retrigger forced-route synchronization",
  );
  assert.match(
    callback[0],
    /shouldResetNodeEditorOverlayViewMode\(nodeEditorOverlayRef\.current, cleanNodeID\)/,
    "same-node fullscreen preservation reads the latest overlay through a stable ref",
  );
});
