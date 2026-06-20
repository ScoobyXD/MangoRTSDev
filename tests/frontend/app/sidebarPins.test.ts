import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sidebarPinExplorerDropPayload } from "../../../frontend/src/app/sidebarPins.js";
import { resolveExplorerDropTarget } from "../../../frontend/src/modules/company-explorer/treePresentation.js";

describe("sidebarPins", () => {
  it("turns pinned resources into Explorer-compatible drop payloads", () => {
    const nodePayload = sidebarPinExplorerDropPayload({ kind: "node", id: " node-1 " });
    const logicGatePayload = sidebarPinExplorerDropPayload({ kind: "logic_gate", id: "gate-1" });

    assert.deepEqual(nodePayload, { kind: "node", itemID: "node-1", itemType: "node" });
    assert.deepEqual(logicGatePayload, { kind: "logic_gate", itemID: "gate-1", itemType: "logic_gate" });
    assert.equal(sidebarPinExplorerDropPayload({ kind: "node", id: " " }), null);
  });

  it("keeps pinned resource drops bound to compatible Explorer containers", () => {
    const nodePayload = sidebarPinExplorerDropPayload({ kind: "node", id: "node-1" });
    const logicGatePayload = sidebarPinExplorerDropPayload({ kind: "logic_gate", id: "gate-1" });

    assert.deepEqual(
      resolveExplorerDropTarget({ kind: "folder", folderID: "node-folder", folderKind: "node" }, nodePayload),
      { folderID: "node-folder", folderKind: "node", treeID: "workspace-folder-node-folder" },
    );
    assert.deepEqual(
      resolveExplorerDropTarget({ kind: "folder", folderID: "gate-folder", folderKind: "logic_gate" }, logicGatePayload),
      { folderID: "gate-folder", folderKind: "logic_gate", treeID: "workspace-folder-gate-folder" },
    );
    assert.equal(
      resolveExplorerDropTarget({ kind: "folder", folderID: "gate-folder", folderKind: "logic_gate" }, nodePayload),
      null,
    );
  });
});
