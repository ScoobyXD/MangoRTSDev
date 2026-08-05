import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNodeRelationshipHierarchyRows,
  buildNodeRelationshipTreeRows,
  collectNodeStructureIDs,
  filterNodeGraphToStructure,
  getRelationshipRoleForNode,
} from "../../../../frontend/src/modules/nodes/nodeRelationshipStructure.js";
import type { NodeRecord, NodeRelationship } from "../../../../frontend/src/modules/nodes/types.js";

function node(id: string, title = id): NodeRecord {
  return {
    company_id: "company-1",
    node_id: id,
    name: title,
    created_timestamp: "2026-05-17T00:00:00.000Z",
  };
}

function relationship(id: string, a: string, b: string, aPosition: NodeRelationship["a_position"], bPosition: NodeRelationship["b_position"]): NodeRelationship {
  return {
    company_id: "company-1",
    node_relationship_id: id,
    node_id_a: a,
    node_id_b: b,
    a_position: aPosition,
    b_position: bPosition,
    created_timestamp: "2026-05-17T00:00:00.000Z",
  };
}

test("resolves direct relationship role from the other side position", () => {
  const rel = relationship("r1", "parent", "child", "Parent", "Child");
  assert.equal(getRelationshipRoleForNode(rel, "parent"), "Child");
  assert.equal(getRelationshipRoleForNode(rel, "child"), "Parent");
  assert.equal(getRelationshipRoleForNode(rel, "missing"), null);
});

test("collects the whole connected structure around a node", () => {
  const ids = collectNodeStructureIDs("child", [
    relationship("r1", "root", "parent", "Parent", "Child"),
    relationship("r2", "parent", "child", "Parent", "Child"),
    relationship("r3", "child", "peer", "Peer", "Peer"),
    relationship("r4", "other-a", "other-b", "Peer", "Peer"),
  ]);

  assert.deepEqual(Array.from(ids).sort(), ["child", "parent", "peer", "root"]);
});

test("filters graph to current node structure", () => {
  const nodes = [node("root"), node("parent"), node("child"), node("peer"), node("other")];
  const relationships = [
    relationship("r1", "root", "parent", "Parent", "Child"),
    relationship("r2", "parent", "child", "Parent", "Child"),
    relationship("r3", "child", "peer", "Peer", "Peer"),
    relationship("r4", "other", "rootless", "Peer", "Peer"),
  ];

  const structure = filterNodeGraphToStructure({ nodes, relationships, focusNodeID: "child" });
  assert.deepEqual(structure.nodes.map((item) => item.node_id).sort(), ["child", "parent", "peer", "root"]);
  assert.deepEqual(structure.relationships.map((item) => item.node_relationship_id).sort(), ["r1", "r2", "r3"]);
});

test("builds hierarchy rows with peers at the same level when there is no parent edge", () => {
  const rows = buildNodeRelationshipTreeRows({
    focusNodeID: "node-a",
    nodes: [node("node-a", "A"), node("node-b", "B")],
    relationships: [relationship("r1", "node-a", "node-b", "Peer", "Peer")],
  });

  assert.deepEqual(rows.map((row) => ({ id: row.nodeID, depth: row.depth, role: row.role })), [
    { id: "node-a", depth: 0, role: "Current" },
    { id: "node-b", depth: 0, role: "Peer" },
  ]);
});

test("builds parent-child hierarchy with the current node nested under parents", () => {
  const rows = buildNodeRelationshipTreeRows({
    focusNodeID: "child",
    nodes: [node("root", "Root"), node("parent", "Parent"), node("child", "Child")],
    relationships: [
      relationship("r1", "root", "parent", "Parent", "Child"),
      relationship("r2", "parent", "child", "Parent", "Child"),
    ],
  });

  assert.deepEqual(rows.map((row) => ({ id: row.nodeID, depth: row.depth, role: row.role })), [
    { id: "root", depth: 0, role: "Related" },
    { id: "parent", depth: 1, role: "Parent" },
    { id: "child", depth: 2, role: "Current" },
  ]);
});

test("places peers created from nested nodes at the source node depth", () => {
  const rows = buildNodeRelationshipTreeRows({
    focusNodeID: "root",
    nodes: [node("root", "Root"), node("child", "Child"), node("peer", "Peer")],
    relationships: [
      relationship("r1", "root", "child", "Parent", "Child"),
      relationship("r2", "child", "peer", "Peer", "Peer"),
    ],
  });

  assert.deepEqual(rows.map((row) => ({ id: row.nodeID, depth: row.depth, role: row.role })), [
    { id: "root", depth: 0, role: "Current" },
    { id: "child", depth: 1, role: "Child" },
    { id: "peer", depth: 1, role: "Peer" },
  ]);
});

test("places children created from nested nodes one level below the source node", () => {
  const rows = buildNodeRelationshipTreeRows({
    focusNodeID: "root",
    nodes: [node("root", "Root"), node("child", "Child"), node("grandchild", "Grandchild")],
    relationships: [
      relationship("r1", "root", "child", "Parent", "Child"),
      relationship("r2", "child", "grandchild", "Parent", "Child"),
    ],
  });

  assert.deepEqual(rows.map((row) => ({ id: row.nodeID, depth: row.depth, role: row.role })), [
    { id: "root", depth: 0, role: "Current" },
    { id: "child", depth: 1, role: "Child" },
    { id: "grandchild", depth: 2, role: "Child" },
  ]);
});

test("builds hierarchy rows for an arbitrary node set", () => {
  const rows = buildNodeRelationshipHierarchyRows({
    nodeIDs: ["parent", "peer-a", "peer-b", "child-a", "child-b", "child-c"],
    nodes: [
      node("parent", "Parent"),
      node("peer-a", "Peer A"),
      node("peer-b", "Peer B"),
      node("child-a", "Child A"),
      node("child-b", "Child B"),
      node("child-c", "Child C"),
      node("outside", "Outside"),
    ],
    relationships: [
      relationship("r1", "parent", "peer-a", "Peer", "Peer"),
      relationship("r2", "parent", "peer-b", "Peer", "Peer"),
      relationship("r3", "parent", "child-a", "Parent", "Child"),
      relationship("r4", "parent", "child-b", "Parent", "Child"),
      relationship("r5", "parent", "child-c", "Parent", "Child"),
      relationship("r6", "parent", "outside", "Parent", "Child"),
    ],
  });

  assert.deepEqual(rows.map((row) => ({ id: row.nodeID, depth: row.depth, role: row.role })), [
    { id: "parent", depth: 0, role: "Related" },
    { id: "child-a", depth: 1, role: "Child" },
    { id: "child-b", depth: 1, role: "Child" },
    { id: "child-c", depth: 1, role: "Child" },
    { id: "peer-a", depth: 0, role: "Peer" },
    { id: "peer-b", depth: 0, role: "Peer" },
  ]);
});
