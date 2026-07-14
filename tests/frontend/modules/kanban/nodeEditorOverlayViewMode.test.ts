import assert from "node:assert/strict";
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
