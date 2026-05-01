import { NodeDirection, NodePosition, NodeRelationship, RelationshipAnchor } from "./shared.js";

export type LogicGateRelationshipRole = "Input" | "Output";

export type RelationshipWritePayload = {
  a_position: LogicGateRelationshipRole;
  b_position: LogicGateRelationshipRole;
  anchor: RelationshipAnchor;
};

// Port convention for Logic Gate Map: left is the input side; every other side is output-only.
export function relationshipRoleFromSide(side: NodeDirection): LogicGateRelationshipRole {
  return side === "left" ? "Input" : "Output";
}

export function canStartRelationshipFromSide(side: NodeDirection): boolean {
  return side === "left" || side === "right";
}

export function buildLinkedNodePayloadFromSourceSide(side: NodeDirection): RelationshipWritePayload {
  const sourceRole = relationshipRoleFromSide(side);
  const targetSide = sourceRole === "Input" ? "right" : "left";
  const targetRole = relationshipRoleFromSide(targetSide);
  return {
    a_position: targetRole,
    b_position: sourceRole,
    anchor: {
      from: side,
      to: targetSide,
    },
  };
}

export function buildExistingNodeRelationshipPayload(sourceSide: NodeDirection, targetSide: NodeDirection): RelationshipWritePayload {
  const sourceRole = relationshipRoleFromSide(sourceSide);
  const targetRole = relationshipRoleFromSide(targetSide);
  return {
    a_position: targetRole,
    b_position: sourceRole,
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
  const source = nodePositions[relationship.node_id_a];
  const target = nodePositions[relationship.node_id_b];

  const inferOutputSide = (node: NodePosition | undefined, other: NodePosition | undefined): NodeDirection => {
    if (!node || !other) return "right";
    const dx = other.x - node.x;
    const dy = other.y - node.y;
    if (Math.abs(dy) > Math.abs(dx) * 1.15) {
      return dy >= 0 ? "bottom" : "top";
    }
    return "right";
  };

  if (relationship.a_position === "Input" && relationship.b_position === "Output") {
    return { from: inferOutputSide(source, target), to: "left" };
  }
  if (relationship.a_position === "Output" && relationship.b_position === "Input") {
    return { from: "left", to: inferOutputSide(target, source) };
  }

  return { from: "right", to: "left" };
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

