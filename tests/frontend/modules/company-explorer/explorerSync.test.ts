import assert from "node:assert/strict";
import { shouldApplyMapSelection, shouldBroadcastSelection, shouldIgnoreSelfOriginatedMapSelection, shouldReadMapStateForSelectionEvent } from "../../../../frontend/src/modules/company-explorer/explorerSync.js";

type SelectionState = { selectedNodeID: string; selectedTreeID: string };

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("does not apply map echo when explorer already holds same node/tree", () => {
  const current: SelectionState = { selectedNodeID: "node-1", selectedTreeID: "node-node-1" };
  assert.equal(shouldApplyMapSelection(current, "node-1"), false);
});

run("applies map selection when node changes", () => {
  const current: SelectionState = { selectedNodeID: "node-1", selectedTreeID: "node-node-1" };
  assert.equal(shouldApplyMapSelection(current, "node-2"), true);
});

run("broadcasts only when semantic selection changes", () => {
  const previous: SelectionState = { selectedNodeID: "", selectedTreeID: "folder-all" };
  const unchanged: SelectionState = { selectedNodeID: "", selectedTreeID: "folder-all" };
  const changed: SelectionState = { selectedNodeID: "node-3", selectedTreeID: "node-node-3" };
  assert.equal(shouldBroadcastSelection(previous, unchanged), false);
  assert.equal(shouldBroadcastSelection(previous, changed), true);
});

run("uses event payload instead of stale debounced map state during gap recovery", () => {
  assert.equal(shouldReadMapStateForSelectionEvent(true, true), false);
  assert.equal(shouldReadMapStateForSelectionEvent(true, false), true);
  assert.equal(shouldReadMapStateForSelectionEvent(false, false), false);
});

run("ignores map selection events that are echoes of this explorer", () => {
  assert.equal(shouldIgnoreSelfOriginatedMapSelection("explorer-1", "explorer-1"), true);
  assert.equal(shouldIgnoreSelfOriginatedMapSelection("explorer-2", "explorer-1"), false);
  assert.equal(shouldIgnoreSelfOriginatedMapSelection(undefined, "explorer-1"), false);
});
