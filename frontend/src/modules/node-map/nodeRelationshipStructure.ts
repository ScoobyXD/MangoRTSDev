import { getNodeTitle, type NodeRecord, type NodeRelationship } from "./shared.js";
import type { RelationshipRole } from "./relationshipProjection.js";

export type RelationshipStructureRole = RelationshipRole | "Current" | "Related";

export type NodeRelationshipTreeRow = {
  nodeID: string;
  title: string;
  depth: number;
  role: RelationshipStructureRole;
  direct: boolean;
  hasChildren: boolean;
};

type HierarchyIndex = {
  childrenByParent: Map<string, Set<string>>;
  parentsByChild: Map<string, Set<string>>;
};

function sortedNodeIDs(ids: Iterable<string>, nodeByID: Map<string, NodeRecord>, focusNodeID: string): string[] {
  return Array.from(ids).sort((left, right) => {
    if (left === focusNodeID) return -1;
    if (right === focusNodeID) return 1;
    const leftLabel = getNodeTitle(nodeByID.get(left) ?? { title: left }).toLowerCase();
    const rightLabel = getNodeTitle(nodeByID.get(right) ?? { title: right }).toLowerCase();
    return leftLabel.localeCompare(rightLabel) || left.localeCompare(right);
  });
}

export function getRelationshipRoleForNode(relationship: NodeRelationship, nodeID: string): RelationshipRole | null {
  if (relationship.node_id_a === nodeID) return relationship.b_position;
  if (relationship.node_id_b === nodeID) return relationship.a_position;
  return null;
}

function relationshipEndpoints(relationship: NodeRelationship): [string, string] {
  return [relationship.node_id_a, relationship.node_id_b];
}

export function collectNodeStructureIDs(focusNodeID: string, relationships: NodeRelationship[]): Set<string> {
  const focus = focusNodeID.trim();
  if (!focus) return new Set();
  const relatedByNode = new Map<string, Set<string>>();
  for (const relationship of relationships) {
    const [left, right] = relationshipEndpoints(relationship);
    if (!left || !right) continue;
    if (!relatedByNode.has(left)) relatedByNode.set(left, new Set());
    if (!relatedByNode.has(right)) relatedByNode.set(right, new Set());
    relatedByNode.get(left)?.add(right);
    relatedByNode.get(right)?.add(left);
  }

  const visited = new Set<string>([focus]);
  const queue = [focus];
  while (queue.length > 0) {
    const nodeID = queue.shift() ?? "";
    for (const relatedID of relatedByNode.get(nodeID) ?? []) {
      if (visited.has(relatedID)) continue;
      visited.add(relatedID);
      queue.push(relatedID);
    }
  }
  return visited;
}

function indexHierarchy(relationships: NodeRelationship[], allowedIDs: Set<string>): HierarchyIndex {
  const childrenByParent = new Map<string, Set<string>>();
  const parentsByChild = new Map<string, Set<string>>();
  const addHierarchyEdge = (parentID: string, childID: string) => {
    if (!allowedIDs.has(parentID) || !allowedIDs.has(childID)) return;
    if (!childrenByParent.has(parentID)) childrenByParent.set(parentID, new Set());
    if (!parentsByChild.has(childID)) parentsByChild.set(childID, new Set());
    childrenByParent.get(parentID)?.add(childID);
    parentsByChild.get(childID)?.add(parentID);
  };

  for (const relationship of relationships) {
    if (relationship.a_position === "Parent" && relationship.b_position === "Child") {
      addHierarchyEdge(relationship.node_id_a, relationship.node_id_b);
      continue;
    }
    if (relationship.a_position === "Child" && relationship.b_position === "Parent") {
      addHierarchyEdge(relationship.node_id_b, relationship.node_id_a);
    }
  }

  return { childrenByParent, parentsByChild };
}

function indexPeers(relationships: NodeRelationship[], allowedIDs: Set<string>): Map<string, Set<string>> {
  const peersByNode = new Map<string, Set<string>>();
  const addPeerEdge = (leftID: string, rightID: string) => {
    if (!allowedIDs.has(leftID) || !allowedIDs.has(rightID)) return;
    if (!peersByNode.has(leftID)) peersByNode.set(leftID, new Set());
    peersByNode.get(leftID)?.add(rightID);
  };

  for (const relationship of relationships) {
    if (relationship.a_position !== "Peer" || relationship.b_position !== "Peer") continue;
    addPeerEdge(relationship.node_id_a, relationship.node_id_b);
    addPeerEdge(relationship.node_id_b, relationship.node_id_a);
  }

  return peersByNode;
}

export function filterNodeGraphToStructure(input: {
  nodes: NodeRecord[];
  relationships: NodeRelationship[];
  focusNodeID: string;
}): { nodes: NodeRecord[]; relationships: NodeRelationship[] } {
  const structureIDs = collectNodeStructureIDs(input.focusNodeID, input.relationships);
  if (structureIDs.size === 0) return { nodes: [], relationships: [] };
  const nodes = input.nodes.filter((node) => structureIDs.has(node.node_id));
  const nodeIDs = new Set(nodes.map((node) => node.node_id));
  return {
    nodes,
    relationships: input.relationships.filter((relationship) => nodeIDs.has(relationship.node_id_a) && nodeIDs.has(relationship.node_id_b)),
  };
}

export function buildNodeRelationshipTreeRows(input: {
  nodes: NodeRecord[];
  relationships: NodeRelationship[];
  focusNodeID: string;
  fallbackTitle?: string;
}): NodeRelationshipTreeRow[] {
  const focusNodeID = input.focusNodeID.trim();
  if (!focusNodeID) return [];
  const structure = filterNodeGraphToStructure(input);
  const fallbackNode: NodeRecord | null = structure.nodes.some((node) => node.node_id === focusNodeID)
    ? null
    : {
      company_id: "",
      node_id: focusNodeID,
      title: input.fallbackTitle?.trim() || "Current node",
      created_timestamp: "",
    };
  const nodes = fallbackNode ? [...structure.nodes, fallbackNode] : structure.nodes;
  const nodeByID = new Map(nodes.map((node) => [node.node_id, node]));
  const allowedIDs = new Set(nodes.map((node) => node.node_id));
  const { childrenByParent, parentsByChild } = indexHierarchy(structure.relationships, allowedIDs);
  const peersByNode = indexPeers(structure.relationships, allowedIDs);
  const directRoleByNodeID = new Map<string, RelationshipRole>();
  for (const relationship of structure.relationships) {
    const roleForA = getRelationshipRoleForNode(relationship, focusNodeID);
    if (!roleForA) continue;
    const relatedID = relationship.node_id_a === focusNodeID ? relationship.node_id_b : relationship.node_id_a;
    directRoleByNodeID.set(relatedID, roleForA);
  }

  const canReachNodeThroughPeer = (nodeID: string): boolean => {
    if (nodeID === focusNodeID) return false;
    for (const peerID of peersByNode.get(nodeID) ?? []) {
      if (peerID === focusNodeID) return true;
      if ((parentsByChild.get(peerID)?.size ?? 0) > 0) return true;
      if ((childrenByParent.get(peerID)?.size ?? 0) > 0) return true;
    }
    return false;
  };

  const roots = sortedNodeIDs(
    nodes
      .map((node) => node.node_id)
      .filter((nodeID) => (parentsByChild.get(nodeID)?.size ?? 0) === 0)
      .filter((nodeID) => !canReachNodeThroughPeer(nodeID)),
    nodeByID,
    focusNodeID,
  );
  const rows: NodeRelationshipTreeRow[] = [];
  const visited = new Set<string>();

  const rowForNode = (nodeID: string, depth: number, traversalRole?: RelationshipRole): NodeRelationshipTreeRow => {
    const node = nodeByID.get(nodeID);
    const directRole = directRoleByNodeID.get(nodeID);
    return {
      nodeID,
      title: getNodeTitle(node ?? { title: nodeID }) || nodeID,
      depth,
      role: nodeID === focusNodeID ? "Current" : directRole ?? traversalRole ?? "Related",
      direct: nodeID === focusNodeID || directRoleByNodeID.has(nodeID),
      hasChildren: (childrenByParent.get(nodeID)?.size ?? 0) > 0,
    };
  };

  const walk = (nodeID: string, depth: number, stack: Set<string>, traversalRole?: RelationshipRole) => {
    if (!allowedIDs.has(nodeID)) return;
    if (visited.has(nodeID)) return;
    visited.add(nodeID);
    rows.push(rowForNode(nodeID, depth, traversalRole));
    if (stack.has(nodeID)) return;
    const nextStack = new Set(stack);
    nextStack.add(nodeID);
    for (const peerID of sortedNodeIDs(peersByNode.get(nodeID) ?? [], nodeByID, focusNodeID)) {
      walk(peerID, depth, nextStack, "Peer");
    }
    for (const childID of sortedNodeIDs(childrenByParent.get(nodeID) ?? [], nodeByID, focusNodeID)) {
      walk(childID, depth + 1, nextStack, "Child");
    }
  };

  for (const rootID of roots) walk(rootID, 0, new Set());
  for (const nodeID of sortedNodeIDs(allowedIDs, nodeByID, focusNodeID)) {
    if (!visited.has(nodeID)) walk(nodeID, 0, new Set());
  }

  return rows;
}
