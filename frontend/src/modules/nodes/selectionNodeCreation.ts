import { readAuthConfig } from "../../auth/cognitoAuth.js";
import { createRequestJSON } from "../api/requestJSON.js";
import type { CompanyExplorerFolderItem } from "../folders/companyExplorerFolders.js";
import { createWorkspaceEntityBatchClientID, createWorkspaceEntityBatchCommand, type WorkspaceEntityCommandRequest } from "../workspace/workspaceEntityCommands.js";
import { upsertNodeRelationshipGraphNode, upsertNodeRelationshipGraphRelationship } from "./nodeRelationshipGraph.js";
import { primeNodeRecordStoreCaches } from "./nodeRecordStore.js";
import { buildLinkedNodePayload } from "./relationshipRules.js";
import type { NodeRecord, NodeRelationship } from "./types.js";

const MAX_TEXT_SELECTION_NODE_TITLE_LENGTH = 500;
export type SelectionNodeRelationshipKind = "parent" | "peer" | "child";

type TextSelectionNodeCreateResponse = {
  nodes?: NodeRecord[];
  relationships?: NodeRelationship[];
  folder_items?: CompanyExplorerFolderItem[];
};

export function normalizeSelectedTextForNodeTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > MAX_TEXT_SELECTION_NODE_TITLE_LENGTH
    ? normalized.slice(0, MAX_TEXT_SELECTION_NODE_TITLE_LENGTH).trim()
    : normalized;
}

export async function createNodeFromSelectionTitle(args: {
  companyID: string;
  title: string;
  sourceNodeID?: string;
  relationshipKind?: SelectionNodeRelationshipKind;
  folderID?: string;
  apiBase?: string;
  requestJSON?: WorkspaceEntityCommandRequest;
}): Promise<NodeRecord> {
  const title = normalizeSelectedTextForNodeTitle(args.title);
  if (!title) throw new Error("selection_node_title_empty");
  const apiBase = args.apiBase?.trim() || readAuthConfig().apiBase;
  const requestJSON = args.requestJSON ?? createRequestJSON(apiBase);
  const companyID = args.companyID.trim();
  if (!companyID) throw new Error("company_id_required");
  const sourceNodeID = args.sourceNodeID?.trim() ?? "";
  if (args.relationshipKind && !sourceNodeID) throw new Error("selection_source_node_required");

  const clientID = createWorkspaceEntityBatchClientID("selection-node");
  const relationshipPayload = sourceNodeID && args.relationshipKind ? buildLinkedNodePayload(args.relationshipKind) : null;
  const response = await createWorkspaceEntityBatchCommand<TextSelectionNodeCreateResponse>({
    companyID,
    entityKind: "node",
    folderID: args.folderID?.trim() ?? "",
    mutationOrigin: "editor",
    items: [{ client_id: clientID, name: title }],
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
  for (const relationship of relationships) upsertNodeRelationshipGraphRelationship(apiBase, companyID, relationship);
  primeNodeRecordStoreCaches(apiBase, companyID, [{ node, relationships }]);
  return node;
}
