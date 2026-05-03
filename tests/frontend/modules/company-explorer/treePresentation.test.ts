import assert from "node:assert/strict";
import { EXPLORER_DEFAULT_EXPANDED_ROW_IDS, EXPLORER_ROOT_ROW_ORDER, resolveExplorerCreationTargets } from "../../../../frontend/src/modules/company-explorer/treePresentation.js";

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("root presentation puts logic gates above nodes and excludes knowledge nodes", () => {
  assert.deepEqual([...EXPLORER_ROOT_ROW_ORDER], ["folder-root", "folder-logic", "folder-nodes"]);
  assert.equal((EXPLORER_ROOT_ROW_ORDER as readonly string[]).includes("folder-notes"), false);
  assert.deepEqual([...EXPLORER_DEFAULT_EXPANDED_ROW_IDS], ["folder-root", "folder-logic", "folder-nodes"]);
});

run("context creation targets nested logic gate folders", () => {
  const targets = resolveExplorerCreationTargets({ kind: "folder", folderKind: "logic_gate", folderID: "logic-folder-1" });
  assert.deepEqual(targets, {
    folderKind: "logic_gate",
    folderParentID: "logic-folder-1",
    nodeParentFolderID: "",
    logicGateParentFolderID: "logic-folder-1",
  });
});

run("context creation targets node siblings from a node row", () => {
  const targets = resolveExplorerCreationTargets({ kind: "node", folderKind: "node", folderID: "node-folder-1" });
  assert.deepEqual(targets, {
    folderKind: "node",
    folderParentID: "node-folder-1",
    nodeParentFolderID: "node-folder-1",
    logicGateParentFolderID: "",
  });
});
