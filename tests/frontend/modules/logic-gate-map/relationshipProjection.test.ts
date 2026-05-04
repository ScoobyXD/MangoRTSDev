// Logic-gate relationship projection tests (Input/Output + anchors + color role mapping).
// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { buildExistingNodeRelationshipPayload, buildLinkedNodePayloadFromSourceSide, canStartRelationshipFromSide, inferRelationshipAnchor, isLegalRelationshipSidePair, projectRelationshipVisual, relationshipRoleFromSide, selectedRoleForRelationship } from "../../../../frontend/src/modules/logic-gate-map/relationshipProjection.js";
import { NodeRelationship } from "../../../../frontend/src/modules/logic-gate-map/shared.js";

function relationship(overrides: Partial<NodeRelationship>): NodeRelationship {
  return {
    company_id: "11111111-1111-1111-1111-111111111111",
    logic_gate_relationship_id: "logic-rel-1",
    logic_gate_id_a: "logic-a",
    logic_gate_id_b: "logic-b",
    node_relationship_id: "logic-rel-1",
    node_id_a: "logic-a",
    node_id_b: "logic-b",
    a_position: "Output",
    b_position: "Input",
    created_timestamp: new Date().toISOString(),
    ...overrides,
  };
}

test("maps logic-gate sides to input and output ports", () => {
  assert.equal(relationshipRoleFromSide("left"), "Input");
  assert.equal(relationshipRoleFromSide("top"), "Output");
  assert.equal(relationshipRoleFromSide("right"), "Output");
  assert.equal(relationshipRoleFromSide("bottom"), "Output");
});

test("only left and right sides can start logic-gate creation or relationship drafts", () => {
  assert.equal(canStartRelationshipFromSide("left"), true);
  assert.equal(canStartRelationshipFromSide("right"), true);
  assert.equal(canStartRelationshipFromSide("top"), false);
  assert.equal(canStartRelationshipFromSide("bottom"), false);
});

test("plus-link relationships always connect input to output", () => {
  assert.deepEqual(buildLinkedNodePayloadFromSourceSide("left"), {
    a_position: "Output",
    b_position: "Input",
    anchor: { from: "left", to: "right" },
  });
  assert.deepEqual(buildLinkedNodePayloadFromSourceSide("right"), {
    a_position: "Input",
    b_position: "Output",
    anchor: { from: "right", to: "left" },
  });
});

test("existing-gate attach flow connects inputs only to output sides", () => {
  assert.equal(isLegalRelationshipSidePair("left", "right"), true);
  assert.equal(isLegalRelationshipSidePair("left", "top"), true);
  assert.equal(isLegalRelationshipSidePair("left", "bottom"), true);
  assert.equal(isLegalRelationshipSidePair("left", "left"), false);
});

test("existing-gate attach flow connects outputs only to input sides", () => {
  assert.equal(isLegalRelationshipSidePair("right", "left"), true);
  assert.equal(isLegalRelationshipSidePair("top", "left"), true);
  assert.equal(isLegalRelationshipSidePair("bottom", "left"), true);
  assert.equal(isLegalRelationshipSidePair("right", "top"), false);
  assert.equal(isLegalRelationshipSidePair("top", "bottom"), false);
  assert.equal(isLegalRelationshipSidePair("bottom", "right"), false);
});

test("uses target/source input-output semantics for existing-gate writes", () => {
  assert.deepEqual(buildExistingNodeRelationshipPayload("left", "top"), {
    a_position: "Output",
    b_position: "Input",
    anchor: { from: "left", to: "top" },
  });
  assert.deepEqual(buildExistingNodeRelationshipPayload("right", "left"), {
    a_position: "Input",
    b_position: "Output",
    anchor: { from: "right", to: "left" },
  });
});

test("resolves selected role from the opposite side of a logic-gate relationship", () => {
  const rel = relationship({ a_position: "Input", b_position: "Output" });
  assert.equal(selectedRoleForRelationship(rel, "logic-a"), "Output");
  assert.equal(selectedRoleForRelationship(rel, "logic-b"), "Input");
  assert.equal(selectedRoleForRelationship(rel, "other"), null);
});

test("infers deterministic anchors for input/output relationships", () => {
  assert.deepEqual(inferRelationshipAnchor(relationship({ a_position: "Input", b_position: "Output" }), {}), { from: "right", to: "left" });
  assert.deepEqual(inferRelationshipAnchor(relationship({ a_position: "Output", b_position: "Input" }), {}), { from: "left", to: "right" });
  assert.deepEqual(
    inferRelationshipAnchor(relationship({ a_position: "Input", b_position: "Output" }), {
      "logic-a": { x: 100, y: 100 },
      "logic-b": { x: 120, y: 360 },
    }),
    { from: "bottom", to: "left" },
  );
  assert.deepEqual(
    inferRelationshipAnchor(relationship({ a_position: "Output", b_position: "Input" }), {
      "logic-a": { x: 100, y: 360 },
      "logic-b": { x: 120, y: 100 },
    }),
    { from: "left", to: "bottom" },
  );
});

test("projects visual relationship metadata with input/output colors", () => {
  const rel = relationship({ a_position: "Input", b_position: "Output" });
  const projected = projectRelationshipVisual(rel, {
    activeNodeID: "logic-a",
    relationshipColorsEnabled: true,
    relationshipRoleColors: { input: "#00f", output: "#f80" },
    accent: "#0ff",
    nodePositions: {
      "logic-a": { x: 100, y: 100 },
      "logic-b": { x: 240, y: 100 },
    },
  });

  assert.deepEqual(
    {
      sourceNodeID: projected.sourceNodeID,
      targetNodeID: projected.targetNodeID,
      sourceAnchor: projected.sourceAnchor,
      targetAnchor: projected.targetAnchor,
      selectedRole: projected.selectedRole,
      strokeColor: projected.strokeColor,
    },
    {
      sourceNodeID: "logic-a",
      targetNodeID: "logic-b",
      sourceAnchor: "right",
      targetAnchor: "left",
      selectedRole: "Output",
      strokeColor: "#f80",
    },
  );
  assert.equal(projected.alpha > 0, true);
});

test("disabled logic-gate relationship colors fall back fully to the map accent", () => {
  const rel = relationship({ a_position: "Input", b_position: "Output" });
  const projected = projectRelationshipVisual(rel, {
    activeNodeID: "logic-a",
    relationshipColorsEnabled: false,
    relationshipRoleColors: { input: "#00f", output: "#f80" },
    accent: "#0ff",
    nodePositions: {},
  });

  assert.equal(projected.selectedRole, "Output");
  assert.equal(projected.strokeColor, "#0ff");
});
