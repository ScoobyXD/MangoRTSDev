import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNodeRelationshipTreeRows,
  collectNodeStructureIDs,
  filterNodeGraphToStructure,
  getRelationshipRoleForNode,
} from "../../../../frontend/src/modules/node-map/nodeRelationshipStructure.js";
import type { NodeRecord, NodeRelationship } from "../../../../frontend/src/modules/node-map/shared.js";

function node(id: string, title = id): NodeRecord {
  return {
    company_id: "company-1",
    node_id: id,
    title,
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
