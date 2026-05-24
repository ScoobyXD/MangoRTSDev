import { summarizeRelationshipDeleteResults, type RelationshipDeleteSummary } from "./relationshipDeleteSummary.js";

export type NodeMapCommandRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export function normalizeNodeMapRelationshipIDs(relationshipIDs: string[]): string[] {
  return Array.from(new Set(relationshipIDs.map((relationshipID) => relationshipID.trim()).filter(Boolean)));
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
