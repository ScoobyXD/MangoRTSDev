// Side-to-role mapping: horizontal sides are peers, vertical sides imply hierarchy.
export function relationshipRoleFromSide(side) {
    if (side === "left" || side === "right")
        return "Peer";
    if (side === "top")
        return "Parent";
    return "Child";
}
// New-linked-node path: decides default relationship semantics from the source + handle used.
export function buildLinkedNodePayloadFromSourceSide(side) {
    if (side === "top") {
        return {
            a_position: "Child",
            b_position: "Parent",
            anchor: { from: "top", to: "bottom" },
        };
    }
    if (side === "bottom") {
        return {
            a_position: "Parent",
            b_position: "Child",
            anchor: { from: "bottom", to: "top" },
        };
    }
    if (side === "left") {
        return {
            a_position: "Peer",
            b_position: "Peer",
            anchor: { from: "left", to: "right" },
        };
    }
    return {
        a_position: "Peer",
        b_position: "Peer",
        anchor: { from: "right", to: "left" },
    };
}
// Existing-node attach path: converts selected source/target sides into API row fields.
export function buildExistingNodeRelationshipPayload(sourceSide, targetSide) {
    const sourceRole = sourceSide === "top" ? "Child" : sourceSide === "bottom" ? "Parent" : "Peer";
    const targetRole = sourceRole === "Child" ? "Parent" : sourceRole === "Parent" ? "Child" : "Peer";
    return {
        a_position: sourceRole,
        b_position: targetRole,
        anchor: { from: sourceSide, to: targetSide },
    };
}
// Relationship legality gate: enforce parent/child vertical and peer horizontal pairings.
export function isLegalRelationshipSidePair(sourceSide, targetSide) {
    const sourceIsPeer = sourceSide === "left" || sourceSide === "right";
    const targetIsPeer = targetSide === "left" || targetSide === "right";
    if (sourceIsPeer)
        return targetIsPeer;
    if (sourceSide === "top")
        return targetSide === "bottom";
    return targetSide === "top";
}
// Active-node role resolver used by relationship color coding and contextual highlighting.
export function selectedRoleForRelationship(relationship, activeNodeID) {
    if (!activeNodeID)
        return null;
    if (relationship.node_id_a === activeNodeID)
        return relationship.b_position;
    if (relationship.node_id_b === activeNodeID)
        return relationship.a_position;
    return null;
}
// Anchor inference fallback used when no persisted anchor exists for this relationship row.
export function inferRelationshipAnchor(relationship, nodePositions, rememberedAnchor) {
    if (rememberedAnchor)
        return rememberedAnchor;
    const source = nodePositions[relationship.node_id_a];
    const target = nodePositions[relationship.node_id_b];
    if (relationship.a_position === "Child" && relationship.b_position === "Parent") {
        return { from: "top", to: "bottom" };
    }
    if (relationship.a_position === "Parent" && relationship.b_position === "Child") {
        return { from: "bottom", to: "top" };
    }
    if (!source || !target)
        return { from: "right", to: "left" };
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    if (Math.abs(dy) > Math.abs(dx) * 1.15) {
        return dy >= 0 ? { from: "bottom", to: "top" } : { from: "top", to: "bottom" };
    }
    return dx >= 0 ? { from: "right", to: "left" } : { from: "left", to: "right" };
}
// Rendering projection: converts relationship rows to visual metadata used by path drawing.
export function projectRelationshipVisual(relationship, options) {
    const anchor = inferRelationshipAnchor(relationship, options.nodePositions, options.rememberedAnchor);
    const selectedRole = selectedRoleForRelationship(relationship, options.activeNodeID);
    const strokeColor = selectedRole === "Parent" ? options.relationshipRoleColors.parent
        : selectedRole === "Peer" ? options.relationshipRoleColors.peer
            : selectedRole === "Child" ? options.relationshipRoleColors.child
                : options.accent;
    const alpha = !options.relationshipColorsEnabled ? 0.72 : (selectedRole ? 0.92 : 0.35);
    return {
        sourceNodeID: relationship.node_id_a,
        targetNodeID: relationship.node_id_b,
        sourceAnchor: anchor.from,
        targetAnchor: anchor.to,
        selectedRole,
        strokeColor,
        alpha,
    };
}
