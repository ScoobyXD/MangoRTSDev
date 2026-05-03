import test from "node:test";
import assert from "node:assert/strict";
import { buildFolderLevelMapProjection, filterLogicGateGraphToFolderScope, filterNodeGraphToFolderScope, getFolderSubtreeIDs, resolveScopedMapSelectionFallback } from "../../../../frontend/src/modules/folders/companyExplorerFolders.js";

const folders = [
  { company_id: "c", folder_id: "folder-parent", folder_kind: "node" as const, name: "Parent", position: 1000, created_timestamp: "1", updated_timestamp: "1" },
  { company_id: "c", folder_id: "folder-child", parent_folder_id: "folder-parent", folder_kind: "node" as const, name: "Child", position: 1000, created_timestamp: "2", updated_timestamp: "2" },
  { company_id: "c", folder_id: "logic-parent", folder_kind: "logic_gate" as const, name: "Logic", position: 1000, created_timestamp: "3", updated_timestamp: "3" },
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
      { company_id: "c", folder_id: "folder-parent", item_type: "node", item_id: "node-a", position: 1000, created_timestamp: "1", updated_timestamp: "1" },
      { company_id: "c", folder_id: "folder-child", item_type: "node", item_id: "node-b", position: 1000, created_timestamp: "2", updated_timestamp: "2" },
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
      { company_id: "c", folder_id: "logic-parent", item_type: "logic_gate", item_id: "gate-a", position: 1000, created_timestamp: "1", updated_timestamp: "1" },
      { company_id: "c", folder_id: "folder-parent", item_type: "node", item_id: "gate-b", position: 1000, created_timestamp: "2", updated_timestamp: "2" },
    ],
    folderID: "logic-parent",
  });

  assert.deepEqual(scoped.nodes.map((node) => node.node_id), ["gate-a"]);
  assert.deepEqual(scoped.relationships, []);
});

test("folder-level map projection shows root folders and unassigned node items only", () => {
  const projected = buildFolderLevelMapProjection({
    items: [
      { company_id: "c", node_id: "node-unassigned", title: "Root Node", created_timestamp: "1" },
      { company_id: "c", node_id: "node-in-folder", title: "Folder Node", created_timestamp: "2" },
    ],
    relationships: [
      { company_id: "c", node_relationship_id: "rel-hidden", node_id_a: "node-unassigned", node_id_b: "node-in-folder", a_position: "Peer", b_position: "Peer", created_timestamp: "3" },
    ],
    folders,
    folderItems: [
      { company_id: "c", folder_id: "folder-parent", item_type: "node", item_id: "node-in-folder", position: 1000, created_timestamp: "1", updated_timestamp: "1" },
    ],
    folderID: "",
    itemType: "node",
    getItemID: (node) => node.node_id,
    getRelationshipItemIDs: (relationship) => [relationship.node_id_a, relationship.node_id_b],
  });

  assert.deepEqual(projected.items.map((node) => node.node_id), ["node-unassigned"]);
  assert.deepEqual(projected.relationships, []);
  assert.deepEqual(projected.childFolders.map((folder) => ({
    id: folder.folder_id,
    directItems: folder.direct_item_count,
    childFolders: folder.child_folder_count,
    descendantItems: folder.descendant_item_count,
  })), [
    { id: "folder-parent", directItems: 1, childFolders: 1, descendantItems: 1 },
  ]);
});

test("folder-level map projection expands one folder level at a time", () => {
  const projected = buildFolderLevelMapProjection({
    items: [
      { company_id: "c", node_id: "node-a", title: "A", created_timestamp: "1" },
      { company_id: "c", node_id: "node-b", title: "B", created_timestamp: "2" },
      { company_id: "c", node_id: "node-child", title: "Child", created_timestamp: "3" },
    ],
    relationships: [
      { company_id: "c", node_relationship_id: "rel-visible", node_id_a: "node-a", node_id_b: "node-b", a_position: "Peer", b_position: "Peer", created_timestamp: "4" },
      { company_id: "c", node_relationship_id: "rel-child-hidden", node_id_a: "node-a", node_id_b: "node-child", a_position: "Parent", b_position: "Child", created_timestamp: "5" },
    ],
    folders,
    folderItems: [
      { company_id: "c", folder_id: "folder-parent", item_type: "node", item_id: "node-a", position: 1000, created_timestamp: "1", updated_timestamp: "1" },
      { company_id: "c", folder_id: "folder-parent", item_type: "node", item_id: "node-b", position: 2000, created_timestamp: "2", updated_timestamp: "2" },
      { company_id: "c", folder_id: "folder-child", item_type: "node", item_id: "node-child", position: 1000, created_timestamp: "3", updated_timestamp: "3" },
    ],
    folderID: "folder-parent",
    itemType: "node",
    getItemID: (node) => node.node_id,
    getRelationshipItemIDs: (relationship) => [relationship.node_id_a, relationship.node_id_b],
  });

  assert.deepEqual(projected.items.map((node) => node.node_id), ["node-a", "node-b"]);
  assert.deepEqual(projected.relationships.map((relationship) => relationship.node_relationship_id), ["rel-visible"]);
  assert.deepEqual(projected.childFolders.map((folder) => ({
    id: folder.folder_id,
    directItems: folder.direct_item_count,
    descendantItems: folder.descendant_item_count,
  })), [
    { id: "folder-child", directItems: 1, descendantItems: 1 },
  ]);
});

test("folder-level map projection works for logic-gate folders", () => {
  const projected = buildFolderLevelMapProjection({
    items: [
      { company_id: "c", logic_gate_id: "gate-unassigned", node_id: "gate-unassigned", header: "Gate Root", title: "Gate Root", created_timestamp: "1" },
      { company_id: "c", logic_gate_id: "gate-in-folder", node_id: "gate-in-folder", header: "Gate Folder", title: "Gate Folder", created_timestamp: "2" },
    ],
    relationships: [
      { company_id: "c", logic_gate_relationship_id: "logic-rel-hidden", node_relationship_id: "logic-rel-hidden", logic_gate_id_a: "gate-unassigned", logic_gate_id_b: "gate-in-folder", node_id_a: "gate-unassigned", node_id_b: "gate-in-folder", a_position: "Output", b_position: "Input", created_timestamp: "3" },
    ],
    folders,
    folderItems: [
      { company_id: "c", folder_id: "logic-parent", item_type: "logic_gate", item_id: "gate-in-folder", position: 1000, created_timestamp: "1", updated_timestamp: "1" },
    ],
    folderID: "",
    itemType: "logic_gate",
    getItemID: (logicGate) => logicGate.node_id,
    getRelationshipItemIDs: (relationship) => [relationship.node_id_a, relationship.node_id_b],
  });

  assert.deepEqual(projected.items.map((logicGate) => logicGate.node_id), ["gate-unassigned"]);
  assert.deepEqual(projected.relationships, []);
  assert.deepEqual(projected.childFolders.map((folder) => folder.folder_id), ["logic-parent"]);
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
