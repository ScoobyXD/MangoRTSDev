import assert from "node:assert/strict";
import test from "node:test";

import { orderedUpdateSelection, resolveUpdateClickSelection } from "../../../../frontend/src/pages/home/updatesSelection.js";

test("update selection uses single-click, ctrl-click, and additive shift-click semantics", () => {
  const orderedIDs = ["a", "b", "c", "d"];
  const first = resolveUpdateClickSelection({
    orderedIDs,
    previousSelectedIDs: new Set(),
    anchorID: "",
    clickedID: "b",
    shiftKey: false,
    ctrlKey: false,
  });
  assert.deepEqual(orderedUpdateSelection(orderedIDs, first.selectedIDs), ["b"]);
  assert.equal(first.anchorID, "b");

  const toggled = resolveUpdateClickSelection({
    orderedIDs,
    previousSelectedIDs: first.selectedIDs,
    anchorID: first.anchorID,
    clickedID: "d",
    shiftKey: false,
    ctrlKey: true,
  });
  assert.deepEqual(orderedUpdateSelection(orderedIDs, toggled.selectedIDs), ["b", "d"]);
  assert.equal(toggled.anchorID, "d");

  const ranged = resolveUpdateClickSelection({
    orderedIDs,
    previousSelectedIDs: toggled.selectedIDs,
    anchorID: toggled.anchorID,
    clickedID: "a",
    shiftKey: true,
    ctrlKey: false,
  });
  assert.deepEqual(orderedUpdateSelection(orderedIDs, ranged.selectedIDs), ["a", "b", "c", "d"]);
  assert.equal(ranged.anchorID, "d");
});
