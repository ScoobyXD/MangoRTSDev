import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RACI_TAB_LABELS,
  RACI_TAB_ROLES,
  buildVisibleRACITabRows,
  planRACITabDrop,
  raciTabBranchKey,
  resolveRACITabSelection,
} from "../../../frontend/src/app/raciTabs.js";
import type {
  RACITabBranch,
  RACITabFolder,
  RACITabItem,
  RACITabRow,
  RACITabRole,
} from "../../../frontend/src/app/raciTabs.js";

const timestamp = "2026-08-10T00:00:00Z";
const zeroCounts = { request: 0, pending: 0, inProgress: 0, review: 0 };

function folder(folderID: string, parentFolderID: string, position: number): RACITabRow {
  const value: RACITabFolder = {
    companyID: "company", folderID, userID: "user", role: "responsible", parentFolderID,
    name: folderID, position, createdTimestamp: timestamp, updatedTimestamp: timestamp,
    hasChildren: true, statusCounts: zeroCounts,
  };
  return { rowKind: "folder", folder: value };
}

function item(logicGateID: string, folderID: string, position: number): RACITabRow {
  const value: RACITabItem = {
    companyID: "company", userID: "user", role: "responsible", logicGateID, folderID,
    name: logicGateID, position, createdTimestamp: timestamp, updatedTimestamp: timestamp,
    statusCounts: zeroCounts,
  };
  return { rowKind: "item", item: value };
}

function branch(role: RACITabRole, parentFolderID: string, rows: RACITabRow[]): RACITabBranch {
  return { role, parentFolderID, rows, statusCounts: zeroCounts, nextCursor: "" };
}

describe("Tower RACI Tabs", () => {
  it("keeps the four binding roles in their exact display order", () => {
    assert.deepEqual(RACI_TAB_ROLES, ["responsible", "accountable", "consulted", "informed"]);
    assert.deepEqual(RACI_TAB_ROLES.map((role) => RACI_TAB_LABELS[role]), ["Responsible", "Accountable", "Consulted", "Informed"]);
  });

  it("reveals only loaded root and opened-folder branches", () => {
    const root = branch("responsible", "", [folder("folder-a", "", 1000), item("gate-root", "", 2000)]);
    const branches: Record<string, RACITabBranch> = { [raciTabBranchKey("responsible", "")]: root };
    assert.deepEqual(
      buildVisibleRACITabRows("responsible", branches, new Set(["folder-a"])).map((row) => [row.key, row.depth]),
      [["folder:folder-a", 0], ["item:gate-root", 0]],
    );

    branches[raciTabBranchKey("responsible", "folder-a")] = branch("responsible", "folder-a", [item("gate-child", "folder-a", 1000)]);
    assert.deepEqual(
      buildVisibleRACITabRows("responsible", branches, new Set()).map((row) => row.key),
      ["folder:folder-a", "item:gate-root"],
    );
    assert.deepEqual(
      buildVisibleRACITabRows("responsible", branches, new Set(["folder-a"])).map((row) => [row.key, row.depth]),
      [["folder:folder-a", 0], ["item:gate-child", 1], ["item:gate-root", 0]],
    );
  });

  it("uses plain, Ctrl/Command toggle, and additive Shift range selection", () => {
    const visible = ["item:a", "item:b", "item:c", "item:d"];
    const plain = resolveRACITabSelection(visible, new Set(), "", "item:b", { toggle: false, range: false });
    assert.deepEqual([...plain.selectedKeys], ["item:b"]);

    const toggled = resolveRACITabSelection(visible, plain.selectedKeys, plain.anchorKey, "item:d", { toggle: true, range: false });
    assert.deepEqual([...toggled.selectedKeys], ["item:b", "item:d"]);

    const ranged = resolveRACITabSelection(visible, toggled.selectedKeys, toggled.anchorKey, "item:a", { toggle: false, range: true });
    assert.deepEqual([...ranged.selectedKeys], ["item:b", "item:d", "item:a", "item:c"]);
    assert.equal(ranged.anchorKey, "item:d");
  });

  it("moves item batches, moves only one folder, preserves mixed order, and blocks cycles", () => {
    const branches: Record<string, RACITabBranch> = {
      [raciTabBranchKey("responsible", "")]: branch("responsible", "", [folder("folder-a", "", 1000), item("gate-a", "", 2000), item("gate-b", "", 3000)]),
      [raciTabBranchKey("responsible", "folder-a")]: branch("responsible", "folder-a", [folder("folder-b", "folder-a", 1000), item("gate-child", "folder-a", 2000)]),
      [raciTabBranchKey("responsible", "folder-b")]: branch("responsible", "folder-b", []),
    };

    const itemBatch = planRACITabDrop(
      "responsible",
      branches,
      [{ entryType: "item", entryID: "gate-a" }, { entryType: "item", entryID: "gate-b" }],
      { entryType: "folder", entryID: "folder-a" },
      "inside",
    );
    assert.deepEqual(itemBatch.map((entry) => [entry.entryType, entry.entryID, entry.parentFolderID, entry.position]), [
      ["folder", "folder-a", "", 1000],
      ["folder", "folder-b", "folder-a", 1000],
      ["item", "gate-child", "folder-a", 2000],
      ["item", "gate-a", "folder-a", 3000],
      ["item", "gate-b", "folder-a", 4000],
    ]);

    assert.deepEqual(
      planRACITabDrop("responsible", branches, [{ entryType: "folder", entryID: "folder-a" }], { entryType: "folder", entryID: "folder-b" }, "inside"),
      [],
    );
    assert.deepEqual(
      planRACITabDrop("responsible", branches, [{ entryType: "folder", entryID: "folder-a" }, { entryType: "item", entryID: "gate-a" }], null, "after"),
      [],
    );
  });
});
