import { readAuthConfig } from "../../auth/cognitoAuth";
import { createRequestJSON } from "../api/requestJSON";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../folders/companyExplorerFolders";
import { invalidateWorkspaceSnapshot } from "../workspace/workspaceSnapshotCache";
import { createMapEntityBatchClientID, createMapEntityBatchCommand, type NodeMapCommandRequest } from "./nodeMapCommands";
import { getNodeRelationshipGraphSnapshot, refreshNodeRelationshipGraphSnapshot, upsertCompanyExplorerFolderItemInNodeRelationshipGraph, upsertNodeMapPositionsInNodeRelationshipGraph, upsertNodeRelationshipGraphNode, upsertNodeRelationshipGraphRelationship } from "./NodeRelationshipGraph";
import { primeNodeRecordStoreCaches } from "./NodeRecordStore";
import { buildLinkedNodePayloadFromSourceSide } from "./relationshipProjection";
import { MINI_GRID, NODE_H, NODE_W, resolveOpenNodeMapPosition, type NodeDirection, type NodeRecord, type NodeRelationship, type PersistedMapPosition } from "./shared";

const WORLD_W = 12800;
const WORLD_H = 8800;
const MAX_TEXT_SELECTION_NODE_TITLE_LENGTH = 500;
const ACTIVE_NODES_SYSTEM_KEY = "active_nodes";

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

function readActiveNodesFolderID(folders: CompanyExplorerFolder[] | undefined): string {
  return (folders ?? []).find((folder) => folder.folder_kind === "node" && folder.system_key === ACTIVE_NODES_SYSTEM_KEY)?.folder_id ?? "";
}

async function resolveActiveNodesFolderID(apiBase: string, companyID: string): Promise<string> {
  const cached = getNodeRelationshipGraphSnapshot(apiBase, companyID);
  const cachedFolderID = readActiveNodesFolderID(cached.folders);
  if (cachedFolderID) return cachedFolderID;

  await refreshNodeRelationshipGraphSnapshot(apiBase, companyID).catch(() => undefined);
  const refreshed = getNodeRelationshipGraphSnapshot(apiBase, companyID);
  return readActiveNodesFolderID(refreshed.folders);
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
  const clientID = createMapEntityBatchClientID("selection-node");
  const relationshipPayload = sourceNodeID && args.relationshipKind
    ? buildLinkedNodePayloadFromSourceSide(relationshipDirectionForSelectionKind(args.relationshipKind))
    : null;
  const folderID = args.folderID?.trim() || await resolveActiveNodesFolderID(apiBase, companyID);
  const response = await createMapEntityBatchCommand<TextSelectionNodeCreateResponse>({
    companyID,
    entityKind: "node",
    folderID,
    items: [{
      client_id: clientID,
      title,
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
  invalidateWorkspaceSnapshot(apiBase, companyID);
  return node;
}
