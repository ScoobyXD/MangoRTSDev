import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSidebarPinTreeRows,
  planSidebarPinMove,
  removeSidebarPinFolderSubtree,
} from "../../../frontend/src/app/sidebarPinTree.js";
import type { SidebarPin, SidebarPinFolder, SidebarPinTree } from "../../../frontend/src/app/sidebarPins.js";

const timestamp = "2026-08-05T00:00:00Z";

function folder(folderID: string, parentFolderID: string, position: number): SidebarPinFolder {
  return { folderID, parentFolderID, name: folderID, position, createdTimestamp: timestamp, updatedTimestamp: timestamp };
}

function pin(pinID: string, parentFolderID: string, position: number): SidebarPin {
  return { pinID, parentFolderID, id: `resource-${pinID}`, kind: "node", name: pinID, position, createdTimestamp: timestamp };
}

describe("sidebarPinTree", () => {
  it("builds a complete mixed nested tree using session expansion state", () => {
    const tree: SidebarPinTree = {
      folders: [folder("folder-a", "", 1000), folder("folder-b", "folder-a", 2000)],
      pins: [pin("pin-root", "", 500), pin("pin-a", "folder-a", 1000), pin("pin-b", "folder-b", 1000)],
    };
    assert.deepEqual(
      buildSidebarPinTreeRows(tree, new Set(["folder-a", "folder-b"])).map((row) => [row.entryID, row.depth]),
      [["pin-root", 0], ["folder-a", 0], ["pin-a", 1], ["folder-b", 1], ["pin-b", 2]],
    );
    assert.deepEqual(
      buildSidebarPinTreeRows(tree, new Set()).map((row) => row.entryID),
      ["pin-root", "folder-a"],
    );
  });

  it("moves mixed entries between parents and rejects folder descendant cycles", () => {
    const tree: SidebarPinTree = {
      folders: [folder("folder-a", "", 1000), folder("folder-b", "folder-a", 1000)],
      pins: [pin("pin-root", "", 2000), pin("pin-a", "folder-a", 2000)],
    };
    const moved = planSidebarPinMove(
      tree,
      { entryType: "pin", entryID: "pin-root" },
      { entryType: "folder", entryID: "folder-a" },
      "inside",
    );
    assert.equal(moved.tree.pins.find((item) => item.pinID === "pin-root")?.parentFolderID, "folder-a");
    assert.deepEqual(moved.updates.map((entry) => [entry.entryType, entry.entryID, entry.position]), [
      ["folder", "folder-b", 1000],
      ["pin", "pin-a", 2000],
      ["pin", "pin-root", 3000],
    ]);

    const cycle = planSidebarPinMove(
      tree,
      { entryType: "folder", entryID: "folder-a" },
      { entryType: "folder", entryID: "folder-b" },
      "inside",
    );
    assert.deepEqual(cycle.updates, []);
    assert.equal(cycle.tree, tree);
  });

  it("removes a folder subtree and contained pins without touching outside pins", () => {
    const tree: SidebarPinTree = {
      folders: [folder("folder-a", "", 1000), folder("folder-b", "folder-a", 1000), folder("folder-c", "", 2000)],
      pins: [pin("pin-a", "folder-a", 1000), pin("pin-b", "folder-b", 1000), pin("pin-c", "folder-c", 1000), pin("pin-root", "", 3000)],
    };
    const next = removeSidebarPinFolderSubtree(tree, "folder-a");
    assert.deepEqual(next.folders.map((item) => item.folderID), ["folder-c"]);
    assert.deepEqual(next.pins.map((item) => item.pinID), ["pin-c", "pin-root"]);
  });
});
