import assert from "node:assert/strict";
import test from "node:test";

import {
  decideProcessMapExplorerDrop,
  isValidProcessMapConnection,
  processMapFolderDrillTarget,
  processMapSelectionTarget,
  shouldApplyProcessMapCommit,
  shouldRollbackProcessMapOptimisticSave,
} from "../../../../frontend/src/modules/process-map/processMapInteraction.js";

test("Process Map accepts only exact manual Explorer resources in valid layers", () => {
  assert.deepEqual(
    decideProcessMapExplorerDrop({ kind: "folder", folderID: " folder-1 ", folderKind: "logic_gate" }),
    {
      kind: "place",
      resource: { resource_type: "company_explorer_folder", resource_id: "folder-1" },
      mapParentFolderID: null,
    },
  );
  assert.deepEqual(
    decideProcessMapExplorerDrop({ kind: "logic_gate", itemID: " gate-1 ", itemType: "logic_gate" }, "folder-1"),
    {
      kind: "place",
      resource: { resource_type: "logic_gate", resource_id: "gate-1" },
      mapParentFolderID: "folder-1",
    },
  );
  assert.equal(
    decideProcessMapExplorerDrop({ kind: "logic_gate", itemID: "gate-1", itemType: "logic_gate" }).kind,
    "reject",
  );
  assert.equal(
    decideProcessMapExplorerDrop({ kind: "folder", folderID: "folder-1", folderKind: "logic_gate" }, "folder-1").kind,
    "reject",
  );
  assert.deepEqual(
    decideProcessMapExplorerDrop({ kind: "project", itemID: "project-1", itemType: "project" }, "folder-1"),
    { kind: "ignore" },
  );
  assert.deepEqual(
    decideProcessMapExplorerDrop({ kind: "batch", items: [{ itemID: "gate-1", itemType: "logic_gate" }] }, "folder-1"),
    { kind: "ignore" },
  );
});

test("single-click selection excludes restricted cards and double-click drill-in is Folder-only", () => {
  assert.equal(processMapSelectionTarget("company_explorer_folder:folder-1", false), "company_explorer_folder:folder-1");
  assert.equal(processMapSelectionTarget("logic_gate:gate-1", false), "logic_gate:gate-1");
  assert.equal(processMapSelectionTarget("restricted:0", true), null);
  assert.equal(
    processMapFolderDrillTarget({ resource_type: "company_explorer_folder", resource_id: "folder-1" }),
    "folder-1",
  );
  assert.equal(processMapFolderDrillTarget({ resource_type: "logic_gate", resource_id: "gate-1" }), null);
  assert.equal(processMapFolderDrillTarget(null), null);
});

test("connections require distinct cards and the fixed output-to-input direction", () => {
  assert.equal(isValidProcessMapConnection({ source: "folder-1", target: "gate-1", sourceHandle: "output", targetHandle: "input" }), true);
  assert.equal(isValidProcessMapConnection({ source: "folder-1", target: "folder-1", sourceHandle: "output", targetHandle: "input" }), false);
  assert.equal(isValidProcessMapConnection({ source: "folder-1", target: "gate-1", sourceHandle: "input", targetHandle: "output" }), false);
  assert.equal(isValidProcessMapConnection({ source: null, target: "gate-1", sourceHandle: "output", targetHandle: "input" }), false);
});

test("optimistic saves apply committed revisions in order and only the latest failed save rolls back", () => {
  assert.equal(shouldApplyProcessMapCommit(3, 4), true);
  assert.equal(shouldApplyProcessMapCommit(4, 4), true);
  assert.equal(shouldApplyProcessMapCommit(4, 3), false);
  assert.equal(shouldRollbackProcessMapOptimisticSave(2, 3), false);
  assert.equal(shouldRollbackProcessMapOptimisticSave(3, 3), true);
});
