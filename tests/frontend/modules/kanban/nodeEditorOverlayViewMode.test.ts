import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { shouldResetNodeEditorOverlayViewMode } from "../../../../frontend/src/modules/kanban/nodeEditorOverlayViewMode.js";

test("same-node work refreshes preserve fullscreen while a different Node resets the view mode", () => {
  const openNode = { nodeID: "node-1" };

  assert.equal(shouldResetNodeEditorOverlayViewMode(openNode, "node-1"), false);
  assert.equal(
    shouldResetNodeEditorOverlayViewMode({ ...openNode }, "node-1"),
    false,
    "a Process work refresh must not collapse the same Node",
  );
  assert.equal(shouldResetNodeEditorOverlayViewMode(openNode, "node-2"), true);
  assert.equal(shouldResetNodeEditorOverlayViewMode(null, "node-1"), true);
});

test("route-controlled Node open and close do not retrigger from local overlay state", () => {
  const source = readFileSync(resolve(process.cwd(), "frontend/src/modules/kanban/KanbanContent.tsx"), "utf8");
  const open = source.match(/const openNode = useCallback\(([\s\S]*?), \[([^\]]*)\]\);/);
  const close = source.match(/const closeOverlay = useCallback\(([\s\S]*?), \[([^\]]*)\]\);/);

  assert.ok(open && close, "Process work retains stable Node open and close callbacks");
  assert.doesNotMatch(open[2], /\boverlay\b/, "opening a Node must not change callback identity when local overlay state changes");
  assert.doesNotMatch(close[2], /\boverlay\b/, "closing a Node must not change callback identity when local overlay state changes");
  assert.match(open[1], /shouldResetNodeEditorOverlayViewMode\(overlayRef\.current, nodeID\)/, "opening the same Node preserves fullscreen through the latest overlay ref");
  assert.match(close[1], /onNodeEditorOverlayClose\?\.\(\)/, "closing the overlay clears its parent route state");
  assert.doesNotMatch(close[1], /if \(overlay\)/, "route close notification must not depend on a captured overlay value");

  const routeSync = source.match(/useEffect\(\(\) => \{\s*if \(forcedOpenNodeID\) \{([\s\S]*?)\}, \[([^\]]*)\]\);/);
  assert.ok(routeSync, "forced-route synchronization remains separate from local Node open and close");
  assert.match(routeSync[1], /shouldResetNodeEditorOverlayViewMode\(overlayRef\.current, forcedOpenNodeID\)/, "changing the routed Node resets fullscreen while same-Node work refreshes preserve it");
  assert.doesNotMatch(routeSync[2], /\boverlay\b|\bopenNode\b|\bcloseOverlay\b/, "local overlay state must not retrigger route synchronization");
});
