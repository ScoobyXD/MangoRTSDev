import test from "node:test";
import assert from "node:assert/strict";
import { emptyExplorerSelectionState, shouldBroadcastSelection } from "../../../../frontend/src/modules/company-explorer/selectionSync.js";

test("broadcasts only when the Explorer semantic selection changes", () => {
  const previous = emptyExplorerSelectionState();
  assert.equal(shouldBroadcastSelection(previous, emptyExplorerSelectionState()), false);
  assert.equal(shouldBroadcastSelection(previous, { ...previous, selectedNodeID: "node-3", selectedTreeID: "node-node-3" }), true);
  assert.equal(shouldBroadcastSelection({ ...previous, selectedLogicGateID: "gate-1" }, { ...previous, selectedLogicGateID: "gate-2" }), true);
});

test("empty Explorer selection has no entity, folder, or multi-selection state", () => {
  assert.deepEqual(emptyExplorerSelectionState(), {
    selectedNodeID: "",
    selectedLogicGateID: "",
    selectedFolderID: "",
    selectedFolderKind: undefined,
    selectedTreeID: "",
    selectedTreeIDs: [],
  });
});