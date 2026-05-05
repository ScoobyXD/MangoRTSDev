import { summarizeRelationshipDeleteResults, type RelationshipDeleteSummary } from "./relationshipDeleteSummary.js";

export type NodeMapCommandRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export type MapEntityBatchKind = "node" | "logic_gate";

export type MapEntityBatchItem = {
  client_id: string;
  title: string;
  x: number;
  y: number;
};

export type MapEntityBatchRelationship = {
  entity_id_a?: string;
  entity_id_b?: string;
  client_id_a?: string;
  client_id_b?: string;
  a_position: string;
  b_position: string;
};

export function normalizeNodeMapRelationshipIDs(relationshipIDs: string[]): string[] {
  return Array.from(new Set(relationshipIDs.map((relationshipID) => relationshipID.trim()).filter(Boolean)));
}

export function createMapEntityBatchClientID(prefix: string, index = 0): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${index}-${random}`;
}

export async function createMapEntityBatchCommand<TResponse>(args: {
  companyID: string;
  entityKind: MapEntityBatchKind;
  folderID?: string;
  items: MapEntityBatchItem[];
  relationships?: MapEntityBatchRelationship[];
  requestJSON: NodeMapCommandRequest;
}): Promise<TResponse> {
  return args.requestJSON<TResponse>("/v1/map-entity-batches", {
    method: "POST",
    body: JSON.stringify({
      company_id: args.companyID,
      entity_kind: args.entityKind,
      folder_id: args.folderID ?? "",
      items: args.items,
      relationships: args.relationships ?? [],
    }),
  });
}

export async function deleteNodeMapRelationshipsCommand(args: {
  companyID: string;
  relationshipIDs: string[];
  requestJSON: NodeMapCommandRequest;
}): Promise<RelationshipDeleteSummary & { requestedIDs: string[] }> {
  const requestedIDs = normalizeNodeMapRelationshipIDs(args.relationshipIDs);
  const settled = await Promise.allSettled(requestedIDs.map((relationshipID) => args.requestJSON<{ status: string }>(
    `/v1/node-relationships/${relationshipID}?company_id=${encodeURIComponent(args.companyID)}`,
    { method: "DELETE" },
  )));
  return { requestedIDs, ...summarizeRelationshipDeleteResults(requestedIDs, settled) };
}
