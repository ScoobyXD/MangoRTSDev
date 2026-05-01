import { NodeDirection, NodePosition, NodeRelationship, RelationshipAnchor } from "./shared.js";

export type LogicGateRelationshipRole = "Input" | "Output";

export type RelationshipWritePayload = {
  a_position: LogicGateRelationshipRole;
  b_position: LogicGateRelationshipRole;
  anchor: RelationshipAnchor;
};

// Port convention for Logic Gate Map: left/top are inputs, right/bottom are outputs.
export function relationshipRoleFromSide(side: NodeDirection): LogicGateRelationshipRole {
  return side === "left" || side === "top" ? "Input" : "Output";
}

function oppositeRole(role: LogicGateRelationshipRole): LogicGateRelationshipRole {
  return role === "Input" ? "Output" : "Input";
}

export function buildLinkedNodePayloadFromSourceSide(side: NodeDirection): RelationshipWritePayload {
  const sourceRole = relationshipRoleFromSide(side);
  return {
    a_position: sourceRole,
    b_position: oppositeRole(sourceRole),
    anchor: {
      from: side,
      to: side === "left" ? "right" : side === "right" ? "left" : side === "top" ? "bottom" : "top",
    },
  };
}

export function buildExistingNodeRelationshipPayload(sourceSide: NodeDirection, targetSide: NodeDirection): RelationshipWritePayload {
  const sourceRole = relationshipRoleFromSide(sourceSide);
  return {
    a_position: sourceRole,
    b_position: oppositeRole(sourceRole),
    anchor: { from: sourceSide, to: targetSide },
  };
}

// A logic-gate edge always connects an Input side to an Output side. Same-role pairs are invalid.
export function isLegalRelationshipSidePair(sourceSide: NodeDirection, targetSide: NodeDirection): boolean {
  return relationshipRoleFromSide(sourceSide) !== relationshipRoleFromSide(targetSide);
}

export function selectedRoleForRelationship(relationship: NodeRelationship, activeNodeID: string): LogicGateRelationshipRole | null {
  if (!activeNodeID) return null;
  if (relationship.node_id_a === activeNodeID) return relationship.b_position;
  if (relationship.node_id_b === activeNodeID) return relationship.a_position;
  return null;
}

export type RelationshipProjection = {
  sourceNodeID: string;
  targetNodeID: string;
  sourceAnchor: NodeDirection;
  targetAnchor: NodeDirection;
  selectedRole: LogicGateRelationshipRole | null;
  strokeColor: string;
  alpha: number;
};

export function inferRelationshipAnchor(
  relationship: NodeRelationship,
  nodePositions: Record<string, NodePosition>,
  rememberedAnchor?: RelationshipAnchor,
): RelationshipAnchor {
  if (rememberedAnchor) return rememberedAnchor;
  if (relationship.a_position === "Input" && relationship.b_position === "Output") {
    return { from: "left", to: "right" };
  }
  if (relationship.a_position === "Output" && relationship.b_position === "Input") {
    return { from: "right", to: "left" };
  }

  const source = nodePositions[relationship.node_id_a];
  const target = nodePositions[relationship.node_id_b];
  if (!source || !target) return { from: "right", to: "left" };
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dy) > Math.abs(dx) * 1.15) {
    return dy >= 0 ? { from: "bottom", to: "top" } : { from: "top", to: "bottom" };
  }
  return dx >= 0 ? { from: "right", to: "left" } : { from: "left", to: "right" };
}

export function projectRelationshipVisual(
  relationship: NodeRelationship,
  options: {
    activeNodeID: string;
    relationshipColorsEnabled: boolean;
    relationshipRoleColors: { input: string; output: string };
    accent: string;
    rememberedAnchor?: RelationshipAnchor;
    nodePositions: Record<string, NodePosition>;
  },
): RelationshipProjection {
  const anchor = inferRelationshipAnchor(relationship, options.nodePositions, options.rememberedAnchor);
  const selectedRole = selectedRoleForRelationship(relationship, options.activeNodeID);
  const strokeColor =
    selectedRole === "Input" ? options.relationshipRoleColors.input
      : selectedRole === "Output" ? options.relationshipRoleColors.output
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

