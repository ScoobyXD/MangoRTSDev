import test from "node:test";
import assert from "node:assert/strict";
import { isSelectionTargetForFrame, publishLiveSelection, readLiveSelectionForFrame, shouldAcceptLiveSelection, type LiveSelectionChange } from "../../../frontend/src/modules/selectionCoordinator.js";

function selection(overrides: Partial<LiveSelectionChange> = {}): LiveSelectionChange {
  return {
    companyID: "company-selection-test",
    entityKind: "node",
    entityID: "node-a",
    label: "Node A",
    sourceFrameID: "map-1",
    sourceModule: "node-map",
    targetFrameIDs: ["editor-1"],
    sequence: 10,
    changedAt: 1000,
    ...overrides,
  };
}

test("accepts only newer selections from the same source stream", () => {
  const current = selection({ sequence: 10 });
  assert.equal(shouldAcceptLiveSelection(current, selection({ sequence: 9 })), false);
  assert.equal(shouldAcceptLiveSelection(current, selection({ sequence: 10 })), false);
  assert.equal(shouldAcceptLiveSelection(current, selection({ sequence: 11 })), true);
});

test("rejects older cross-source selections so delayed echoes cannot win", () => {
  const current = selection({ sourceFrameID: "explorer-1", sourceModule: "company-explorer", changedAt: 2000 });
  const delayedEcho = selection({ sourceFrameID: "map-1", sourceModule: "node-map", changedAt: 1500, sequence: 999 });
  assert.equal(shouldAcceptLiveSelection(current, delayedEcho), false);
});

test("publishes selected entity directly to target frames without storing source echo", () => {
  const companyID = "company-selection-publish-test";
  publishLiveSelection({
    companyID,
    entityKind: "logic_gate",
    entityID: "gate-1",
    label: "Gate 1",
    sourceFrameID: "explorer-1",
    sourceModule: "company-explorer",
    targetFrameIDs: ["map-1", "editor-1", "explorer-1"],
    selectedTreeID: "logic-gate-gate-1",
    selectedTreeIDs: ["logic-gate-gate-1", "logic-gate-gate-2", "logic-gate-gate-1"],
    selectedEntityIDs: ["gate-1", "gate-2", "gate-1"],
    folderKind: "logic_gate",
    changedAt: 3000,
    sequence: 1,
  });

  const editorSelection = readLiveSelectionForFrame(companyID, "editor-1");
  assert.equal(editorSelection?.entityKind, "logic_gate");
  assert.equal(editorSelection?.entityID, "gate-1");
  assert.equal(editorSelection?.selectedTreeID, "logic-gate-gate-1");
  assert.deepEqual(editorSelection?.selectedTreeIDs, ["logic-gate-gate-1", "logic-gate-gate-2"]);
  assert.deepEqual(editorSelection?.selectedEntityIDs, ["gate-1", "gate-2"]);
  assert.equal(isSelectionTargetForFrame(editorSelection!, "editor-1"), true);
  assert.equal(readLiveSelectionForFrame(companyID, "explorer-1"), null);
});
