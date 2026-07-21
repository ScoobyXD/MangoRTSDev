import { readAuthConfig } from "../../auth/cognitoAuth.js";
import { createRequestJSON } from "../api/requestJSON.js";
import type { CompanyExplorerFolderItem } from "../folders/companyExplorerFolders.js";
import { markWorkspaceSnapshotScopeStale } from "../workspace/workspaceSnapshotCache.js";
import { createWorkspaceEntityBatchClientID, createWorkspaceEntityBatchCommand } from "../workspace/workspaceEntityCommands.js";
import type { NodeMapCommandRequest } from "./nodeMapCommands.js";
import { getNodeRelationshipGraphSnapshot, upsertCompanyExplorerFolderItemInNodeRelationshipGraph, upsertNodeMapPositionsInNodeRelationshipGraph, upsertNodeRelationshipGraphNode, upsertNodeRelationshipGraphRelationship } from "./NodeRelationshipGraph.js";
import { primeNodeRecordStoreCaches } from "./NodeRecordStore.js";
import { buildLinkedNodePayloadFromSourceSide } from "./relationshipProjection.js";
import { MINI_GRID, NODE_H, NODE_W, resolveOpenNodeMapPosition, type NodeDirection, type NodeRecord, type NodeRelationship, type PersistedMapPosition } from "./shared.js";

const WORLD_W = 12800;
const WORLD_H = 8800;
const MAX_TEXT_SELECTION_NODE_TITLE_LENGTH = 500;

export type SelectionNodeRelationshipKind = "parent" | "peer" | "child";

type TextSelectionNodeCreateResponse = {
  nodes?: NodeRecord[];
  relationships?: NodeRelationship[];
  folder_items?: CompanyExplorerFolderItem[];
  node_map_positions?: PersistedMapPosition[];
};

export function normalizeSelectedTextForNodeTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > MAX_TEXT_SELECTION_NODE_TITLE_LENGTH
    ? normalized.slice(0, MAX_TEXT_SELECTION_NODE_TITLE_LENGTH).trim()
    : normalized;
}

function relationshipDirectionForSelectionKind(kind: SelectionNodeRelationshipKind): NodeDirection {
  if (kind === "parent") return "top";
  if (kind === "child") return "bottom";
  return "right";
}

function readOpenSelectionNodePosition(
  apiBase: string,
  companyID: string,
  sourceNodeID?: string,
  relationshipKind?: SelectionNodeRelationshipKind,
): { x: number; y: number } {
  const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
  const occupied: Record<string, { x: number; y: number }> = {};
  for (const position of snapshot.node_map_positions ?? []) {
    const id = position.node_id || position.entity_id || "";
    if (!id || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
    occupied[id] = { x: position.x, y: position.y };
  }
  const sourcePosition = sourceNodeID ? occupied[sourceNodeID] : undefined;
  const clearance = MINI_GRID * 4;
  const horizontalGap = NODE_W + clearance;
  const verticalGap = NODE_H + clearance;
  const desired = sourcePosition && relationshipKind
    ? {
      x: sourcePosition.x + (relationshipKind === "peer" ? horizontalGap : 0),
      y: sourcePosition.y + (relationshipKind === "parent" ? -verticalGap : relationshipKind === "child" ? verticalGap : 0),
    }
    : { x: 120, y: 120 };
  return resolveOpenNodeMapPosition({
    desired,
    occupied,
    worldWidth: WORLD_W,
    worldHeight: WORLD_H,
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
  });
}

export async function createNodeFromSelectionTitle(args: {
  companyID: string;
  title: string;
  sourceNodeID?: string;
  relationshipKind?: SelectionNodeRelationshipKind;
  folderID?: string;
  apiBase?: string;
  requestJSON?: NodeMapCommandRequest;
}): Promise<NodeRecord> {
  const title = normalizeSelectedTextForNodeTitle(args.title);
  if (!title) throw new Error("selection_node_title_empty");

  const apiBase = args.apiBase?.trim() || readAuthConfig().apiBase;
  const requestJSON = args.requestJSON ?? createRequestJSON(apiBase);
  const companyID = args.companyID.trim();
  if (!companyID) throw new Error("company_id_required");

  const sourceNodeID = args.sourceNodeID?.trim() ?? "";
  if (args.relationshipKind && !sourceNodeID) throw new Error("selection_source_node_required");

  const position = readOpenSelectionNodePosition(apiBase, companyID, sourceNodeID, args.relationshipKind);
  const clientID = createWorkspaceEntityBatchClientID("selection-node");
  const relationshipPayload = sourceNodeID && args.relationshipKind
    ? buildLinkedNodePayloadFromSourceSide(relationshipDirectionForSelectionKind(args.relationshipKind))
    : null;
  const folderID = args.folderID?.trim() ?? "";
  const response = await createWorkspaceEntityBatchCommand<TextSelectionNodeCreateResponse>({
    companyID,
    entityKind: "node",
    folderID,
    mutationOrigin: "editor",
    items: [{
      client_id: clientID,
      name: title,
      x: position.x,
      y: position.y,
    }],
    relationships: relationshipPayload ? [{
      entity_id_a: sourceNodeID,
      client_id_b: clientID,
      a_position: relationshipPayload.a_position,
      b_position: relationshipPayload.b_position,
    }] : undefined,
    requestJSON,
  });
  const node = response.nodes?.[0];
  if (!node) throw new Error("selection_node_create_missing_node");

  const relationships = response.relationships ?? [];
  upsertNodeRelationshipGraphNode(apiBase, companyID, node);
  for (const relationship of relationships) {
    upsertNodeRelationshipGraphRelationship(apiBase, companyID, relationship);
  }
  for (const folderItem of response.folder_items ?? []) {
    upsertCompanyExplorerFolderItemInNodeRelationshipGraph(apiBase, companyID, folderItem);
  }
  upsertNodeMapPositionsInNodeRelationshipGraph(apiBase, companyID, response.node_map_positions ?? [{ entity_id: node.node_id, node_id: node.node_id, ...position }]);
  primeNodeRecordStoreCaches(apiBase, companyID, [{ node, relationships }]);
  markWorkspaceSnapshotScopeStale(apiBase, companyID, { scope: "node_map" });
  markWorkspaceSnapshotScopeStale(apiBase, companyID, { scope: "company_explorer" });
  return node;
}
