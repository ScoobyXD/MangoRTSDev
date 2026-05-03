import test from "node:test";
import assert from "node:assert/strict";
import { filterLogicGateGraphToFolderScope, filterNodeGraphToFolderScope, getFolderSubtreeIDs, resolveScopedMapSelectionFallback } from "../../../../frontend/src/modules/folders/companyExplorerFolders.js";

const folders = [
  { company_id: "c", folder_id: "folder-parent", folder_kind: "node" as const, name: "Parent", created_timestamp: "1", updated_timestamp: "1" },
  { company_id: "c", folder_id: "folder-child", parent_folder_id: "folder-parent", folder_kind: "node" as const, name: "Child", created_timestamp: "2", updated_timestamp: "2" },
  { company_id: "c", folder_id: "logic-parent", folder_kind: "logic_gate" as const, name: "Logic", created_timestamp: "3", updated_timestamp: "3" },
];

test("folder subtree includes nested descendants", () => {
  assert.deepEqual(Array.from(getFolderSubtreeIDs(folders, "folder-parent")).sort(), ["folder-child", "folder-parent"]);
});

test("node folder scope keeps only nodes in selected folder subtree and their internal relationships", () => {
  const scoped = filterNodeGraphToFolderScope({
    nodes: [
      { company_id: "c", node_id: "node-a", title: "A", created_timestamp: "1" },
      { company_id: "c", node_id: "node-b", title: "B", created_timestamp: "2" },
      { company_id: "c", node_id: "node-outside", title: "Outside", created_timestamp: "3" },
    ],
    relationships: [
      { company_id: "c", node_relationship_id: "rel-inside", node_id_a: "node-a", node_id_b: "node-b", a_position: "Parent", b_position: "Child", created_timestamp: "4" },
      { company_id: "c", node_relationship_id: "rel-cross", node_id_a: "node-a", node_id_b: "node-outside", a_position: "Peer", b_position: "Peer", created_timestamp: "5" },
    ],
    folders,
    folderItems: [
      { company_id: "c", folder_id: "folder-parent", item_type: "node", item_id: "node-a", created_timestamp: "1", updated_timestamp: "1" },
      { company_id: "c", folder_id: "folder-child", item_type: "node", item_id: "node-b", created_timestamp: "2", updated_timestamp: "2" },
    ],
    folderID: "folder-parent",
  });

  assert.deepEqual(scoped.nodes.map((node) => node.node_id), ["node-a", "node-b"]);
  assert.deepEqual(scoped.relationships.map((relationship) => relationship.node_relationship_id), ["rel-inside"]);
});

test("logic gate folder scope uses logic_gate folder items only", () => {
  const scoped = filterLogicGateGraphToFolderScope({
    nodes: [
      { company_id: "c", logic_gate_id: "gate-a", node_id: "gate-a", header: "Gate A", title: "Gate A", created_timestamp: "1" },
      { company_id: "c", logic_gate_id: "gate-b", node_id: "gate-b", header: "Gate B", title: "Gate B", created_timestamp: "2" },
    ],
    relationships: [
      { company_id: "c", logic_gate_relationship_id: "gate-rel", node_relationship_id: "gate-rel", logic_gate_id_a: "gate-a", logic_gate_id_b: "gate-b", node_id_a: "gate-a", node_id_b: "gate-b", a_position: "Output", b_position: "Input", created_timestamp: "3" },
    ],
    folders,
    folderItems: [
      { company_id: "c", folder_id: "logic-parent", item_type: "logic_gate", item_id: "gate-a", created_timestamp: "1", updated_timestamp: "1" },
      { company_id: "c", folder_id: "folder-parent", item_type: "node", item_id: "gate-b", created_timestamp: "2", updated_timestamp: "2" },
    ],
    folderID: "logic-parent",
  });

  assert.deepEqual(scoped.nodes.map((node) => node.node_id), ["gate-a"]);
  assert.deepEqual(scoped.relationships, []);
});

test("scoped map selection keeps Explorer click during folder projection handoff", () => {
  const fallback = resolveScopedMapSelectionFallback({
    selectedID: "child-node-8",
    visibleItemIDs: ["parent-node-1", "parent-node-2"],
    knownItemIDs: ["parent-node-1", "parent-node-2", "child-node-8"],
    explorerRequestedID: "child-node-8",
  });

  assert.equal(fallback, null);
});

test("scoped map selection does not invent a fallback for hidden but known items", () => {
  const fallback = resolveScopedMapSelectionFallback({
    selectedID: "child-node-8",
    visibleItemIDs: ["parent-node-1", "parent-node-2"],
    knownItemIDs: ["parent-node-1", "parent-node-2", "child-node-8"],
  });

  assert.equal(fallback, null);
});

test("scoped map selection falls back only when selected item is gone", () => {
  const fallback = resolveScopedMapSelectionFallback({
    selectedID: "deleted-node",
    visibleItemIDs: ["parent-node-1", "parent-node-2"],
    knownItemIDs: ["parent-node-1", "parent-node-2"],
  });

  assert.equal(fallback, "parent-node-1");
});
