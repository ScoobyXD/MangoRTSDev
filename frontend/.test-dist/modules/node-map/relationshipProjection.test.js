// Relationship projection semantics tests (parent/child/peer + anchors + color role mapping).
// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { buildExistingNodeRelationshipPayload, buildLinkedNodePayloadFromSourceSide, inferRelationshipAnchor, isLegalRelationshipSidePair, projectRelationshipVisual, relationshipRoleFromSide, selectedRoleForRelationship } from "./relationshipProjection.js";
function relationship(overrides) {
    return {
        company_id: "11111111-1111-1111-1111-111111111111",
        node_relationship_id: "rel-1",
        node_id_a: "node-a",
        node_id_b: "node-b",
        a_position: "Peer",
        b_position: "Peer",
        created_timestamp: new Date().toISOString(),
        ...overrides,
    };
}
test("maps side to relationship role for direct links", () => {
    assert.equal(relationshipRoleFromSide("left"), "Peer");
    assert.equal(relationshipRoleFromSide("right"), "Peer");
    assert.equal(relationshipRoleFromSide("top"), "Parent");
    assert.equal(relationshipRoleFromSide("bottom"), "Child");
});
test("maps plus-link top/bottom to correct parent-child semantics", () => {
    const top = buildLinkedNodePayloadFromSourceSide("top");
    assert.deepEqual(top, {
        a_position: "Child",
        b_position: "Parent",
        anchor: { from: "top", to: "bottom" },
    });
    const bottom = buildLinkedNodePayloadFromSourceSide("bottom");
    assert.deepEqual(bottom, {
        a_position: "Parent",
        b_position: "Child",
        anchor: { from: "bottom", to: "top" },
    });
});
test("keeps peer semantics for plus-link left/right", () => {
    assert.deepEqual(buildLinkedNodePayloadFromSourceSide("left"), {
        a_position: "Peer",
        b_position: "Peer",
        anchor: { from: "left", to: "right" },
    });
    assert.deepEqual(buildLinkedNodePayloadFromSourceSide("right"), {
        a_position: "Peer",
        b_position: "Peer",
        anchor: { from: "right", to: "left" },
    });
});
test("uses source-side semantics for existing-node relationship writes", () => {
    assert.deepEqual(buildExistingNodeRelationshipPayload("top", "bottom"), {
        a_position: "Child",
        b_position: "Parent",
        anchor: { from: "top", to: "bottom" },
    });
    assert.deepEqual(buildExistingNodeRelationshipPayload("bottom", "top"), {
        a_position: "Parent",
        b_position: "Child",
        anchor: { from: "bottom", to: "top" },
    });
});
test("enforces illegal side-pair rules for existing-node relationship drafts", () => {
    assert.equal(isLegalRelationshipSidePair("left", "right"), true);
    assert.equal(isLegalRelationshipSidePair("right", "left"), true);
    assert.equal(isLegalRelationshipSidePair("left", "top"), false);
    assert.equal(isLegalRelationshipSidePair("right", "bottom"), false);
    assert.equal(isLegalRelationshipSidePair("top", "bottom"), true);
    assert.equal(isLegalRelationshipSidePair("bottom", "top"), true);
    assert.equal(isLegalRelationshipSidePair("top", "top"), false);
    assert.equal(isLegalRelationshipSidePair("bottom", "bottom"), false);
});
test("resolves selected role from the opposite-side position field", () => {
    const rel = relationship({ a_position: "Child", b_position: "Parent" });
    assert.equal(selectedRoleForRelationship(rel, "node-a"), "Parent");
    assert.equal(selectedRoleForRelationship(rel, "node-b"), "Child");
    assert.equal(selectedRoleForRelationship(rel, "other-node"), null);
});
test("infers deterministic anchor for parent-child and child-parent rows", () => {
    assert.deepEqual(inferRelationshipAnchor(relationship({ a_position: "Child", b_position: "Parent" }), {}), { from: "top", to: "bottom" });
    assert.deepEqual(inferRelationshipAnchor(relationship({ a_position: "Parent", b_position: "Child" }), {}), { from: "bottom", to: "top" });
});
test("projects visual relationship line metadata without persistent storage", () => {
    const rel = relationship({ a_position: "Child", b_position: "Parent" });
    const projected = projectRelationshipVisual(rel, {
        activeNodeID: "node-a",
        relationshipColorsEnabled: true,
        relationshipRoleColors: { parent: "#00f", peer: "#ff0", child: "#f00" },
        accent: "#0ff",
        nodePositions: {
            "node-a": { x: 100, y: 100 },
            "node-b": { x: 100, y: 20 },
        },
    });
    assert.deepEqual({
        sourceNodeID: projected.sourceNodeID,
        targetNodeID: projected.targetNodeID,
        sourceAnchor: projected.sourceAnchor,
        targetAnchor: projected.targetAnchor,
        selectedRole: projected.selectedRole,
        strokeColor: projected.strokeColor,
    }, {
        sourceNodeID: "node-a",
        targetNodeID: "node-b",
        sourceAnchor: "top",
        targetAnchor: "bottom",
        selectedRole: "Parent",
        strokeColor: "#00f",
    });
    assert.equal(projected.alpha > 0, true);
});
