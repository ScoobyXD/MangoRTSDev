import test from "node:test";
import assert from "node:assert/strict";
import { getFolderSubtreeIDs, getScopedItemIDs } from "../../../../frontend/src/modules/folders/companyExplorerFolders.js";

const folders = [
  { company_id: "c", folder_id: "folder-parent", folder_kind: "node" as const, name: "Parent", position: 1000, created_timestamp: "1", updated_timestamp: "1" },
  { company_id: "c", folder_id: "folder-child", parent_folder_id: "folder-parent", folder_kind: "node" as const, name: "Child", position: 1000, created_timestamp: "2", updated_timestamp: "2" },
  { company_id: "c", folder_id: "mixed-child", parent_folder_id: "folder-parent", folder_kind: "logic_gate" as const, name: "Mixed", position: 1000, created_timestamp: "2", updated_timestamp: "2" },
];

const folderItems = [
  { company_id: "c", folder_id: "folder-parent", item_type: "node" as const, item_id: "node-a", position: 1000, created_timestamp: "1", updated_timestamp: "1" },
  { company_id: "c", folder_id: "folder-child", item_type: "node" as const, item_id: "node-b", position: 1000, created_timestamp: "2", updated_timestamp: "2" },
  { company_id: "c", folder_id: "mixed-child", item_type: "logic_gate" as const, item_id: "gate-a", position: 1000, created_timestamp: "3", updated_timestamp: "3" },
];

test("folder subtree includes every nested descendant", () => {
  assert.deepEqual(Array.from(getFolderSubtreeIDs(folders, "folder-parent")).sort(), ["folder-child", "folder-parent", "mixed-child"]);
});

test("scoped item lookup keeps item-type semantics across a mixed subtree", () => {
  assert.deepEqual(Array.from(getScopedItemIDs({ folders, folderItems, folderID: "folder-parent", itemType: "node" })).sort(), ["node-a", "node-b"]);
  assert.deepEqual(Array.from(getScopedItemIDs({ folders, folderItems, folderID: "folder-parent", itemType: "logic_gate" })), ["gate-a"]);
});