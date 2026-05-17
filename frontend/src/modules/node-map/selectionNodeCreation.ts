import { apiFetchJSON, readAuthConfig } from "../../auth/cognitoAuth";
import type { CompanyExplorerFolderItem } from "../folders/companyExplorerFolders";
import { invalidateWorkspaceSnapshot } from "../workspace/workspaceSnapshotCache";
import { createMapEntityBatchClientID, createMapEntityBatchCommand, type NodeMapCommandRequest } from "./nodeMapCommands";
import { getNodeRelationshipGraphSnapshot, upsertCompanyExplorerFolderItemInNodeRelationshipGraph, upsertNodeMapPositionsInNodeRelationshipGraph, upsertNodeRelationshipGraphNode } from "./NodeRelationshipGraph";
import { primeNodeRecordStoreCaches } from "./NodeRecordStore";
import { NODE_H, NODE_W, resolveOpenNodeMapPosition, type NodeRecord, type NodeRelationship, type PersistedMapPosition } from "./shared";

const WORLD_W = 12800;
const WORLD_H = 8800;
const MAX_TEXT_SELECTION_NODE_TITLE_LENGTH = 500;

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

function readOpenSelectionNodePosition(apiBase: string, companyID: string): { x: number; y: number } {
  const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
  const occupied: Record<string, { x: number; y: number }> = {};
  for (const position of snapshot.node_map_positions ?? []) {
    const id = position.node_id || position.entity_id || "";
    if (!id || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
    occupied[id] = { x: position.x, y: position.y };
  }
  return resolveOpenNodeMapPosition({
    desired: { x: 120, y: 120 },
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
  folderID?: string;
  apiBase?: string;
  requestJSON?: NodeMapCommandRequest;
}): Promise<NodeRecord> {
  const title = normalizeSelectedTextForNodeTitle(args.title);
  if (!title) throw new Error("selection_node_title_empty");

  const apiBase = args.apiBase?.trim() || readAuthConfig().apiBase;
  const companyID = args.companyID.trim();
  if (!companyID) throw new Error("company_id_required");

  const position = readOpenSelectionNodePosition(apiBase, companyID);
  const response = await createMapEntityBatchCommand<TextSelectionNodeCreateResponse>({
    companyID,
    entityKind: "node",
    folderID: args.folderID,
    items: [{
      client_id: createMapEntityBatchClientID("selection-node"),
      title,
      x: position.x,
      y: position.y,
    }],
    requestJSON: args.requestJSON ?? apiFetchJSON,
  });
  const node = response.nodes?.[0];
  if (!node) throw new Error("selection_node_create_missing_node");

  const relationships = response.relationships ?? [];
  upsertNodeRelationshipGraphNode(apiBase, companyID, node);
  for (const folderItem of response.folder_items ?? []) {
    upsertCompanyExplorerFolderItemInNodeRelationshipGraph(apiBase, companyID, folderItem);
  }
  upsertNodeMapPositionsInNodeRelationshipGraph(apiBase, companyID, response.node_map_positions ?? [{ entity_id: node.node_id, node_id: node.node_id, ...position }]);
  primeNodeRecordStoreCaches(apiBase, companyID, [{ node, relationships }]);
  invalidateWorkspaceSnapshot(apiBase, companyID);
  return node;
}
