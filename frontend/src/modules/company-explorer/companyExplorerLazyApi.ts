import { getAuthSessionCacheGeneration } from "../../auth/cognitoAuth.js";
import { requestJSON } from "../api/requestJSON.js";
import type { CompanyExplorerSnapshotPayload } from "./companyExplorerStore.js";

export type CompanyExplorerLazyScope = "all";

export type CompanyExplorerV2EntityType = "company" | "folder" | "project" | "logic_gate" | "node" | "huddle_logic_gate" | "huddle_node";
export type CompanyExplorerSearchResourceType = Exclude<CompanyExplorerV2EntityType, "company">;

export type CompanyExplorerV2Row = {
  company_id: string;
  entity_id: string;
  entity_type: CompanyExplorerV2EntityType;
  resource_id?: string;
  name: string;
  parent_entity_id?: string;
  edge_id?: string;
  position: number;
  has_children?: boolean;
  effective_access?: string;
  has_permission_rules?: boolean;
  native_context?: Record<string, string>;
  created_timestamp: string;
  updated_timestamp: string;
};
export type CompanyExplorerLocationSegment = {
  entity_type: CompanyExplorerV2EntityType;
  entity_id: string;
  resource_id?: string;
  name: string;
  protected_default_folder?: boolean;
};

export type CompanyExplorerSearchResult = {
  company_id: string;
  resource_type: CompanyExplorerV2EntityType;
  resource_id: string;
  entity_id: string;
  display_name: string;
  match_reason: string;
  location_path: CompanyExplorerLocationSegment[];
  protected_default_folder?: boolean;
  has_children?: boolean;
  created_timestamp: string;
  updated_timestamp: string;
};

export type CompanyExplorerSearchResponse = {
  results: CompanyExplorerSearchResult[];
};
function lazyScopeQuery(companyID: string): string {
  return `company_id=${encodeURIComponent(companyID)}`;
}

const lazyReadInflight = new Map<string, Promise<CompanyExplorerSnapshotPayload>>();

function fetchLazyRows(apiBase: string, path: string): Promise<CompanyExplorerSnapshotPayload> {
  const key = `${getAuthSessionCacheGeneration()}\u0000${apiBase}\u0000${path}`;
  const existing = lazyReadInflight.get(key);
  if (existing) return existing;
  const request = requestJSON<CompanyExplorerSnapshotPayload>(apiBase, path).finally(() => {
    if (lazyReadInflight.get(key) === request) lazyReadInflight.delete(key);
  });
  lazyReadInflight.set(key, request);
  return request;
}

export function fetchCompanyExplorerRoots(
  apiBase: string,
  companyID: string,
  scope: CompanyExplorerLazyScope,
): Promise<CompanyExplorerSnapshotPayload> {
  void scope;
  return fetchLazyRows(apiBase, `/v1/company-explorer/roots?${lazyScopeQuery(companyID)}`);
}

export function fetchCompanyExplorerChildren(
  apiBase: string,
  companyID: string,
  scope: CompanyExplorerLazyScope,
  parentEntityID: string,
): Promise<CompanyExplorerSnapshotPayload> {
  void scope;
  return fetchLazyRows(apiBase, `/v1/company-explorer/children?${lazyScopeQuery(companyID)}&parent_id=${encodeURIComponent(parentEntityID)}`);
}

export async function fetchCompanyExplorerBranchResourceIDs(
  apiBase: string,
  companyID: string,
  parentEntityID: string,
  resourceType: Extract<CompanyExplorerV2EntityType, "node" | "logic_gate" | "project">,
): Promise<string[]> {
  const pendingEntityIDs = [parentEntityID.trim()];
  const visitedEntityIDs = new Set<string>();
  const resourceIDs = new Set<string>();
  while (pendingEntityIDs.length > 0) {
    const currentParentEntityID = pendingEntityIDs.shift() ?? "";
    if (!currentParentEntityID || visitedEntityIDs.has(currentParentEntityID)) continue;
    visitedEntityIDs.add(currentParentEntityID);
    const snapshot = await fetchCompanyExplorerChildren(apiBase, companyID, "all", currentParentEntityID);
    for (const row of snapshot.rows ?? []) {
      if (row.entity_type === resourceType) {
        const resourceID = (row.resource_id || row.entity_id).trim();
        if (resourceID) resourceIDs.add(resourceID);
      }
      if (row.has_children && row.entity_type !== "node") pendingEntityIDs.push(row.entity_id);
    }
  }
  return Array.from(resourceIDs);
}

export function fetchCompanyExplorerSearchResults(
  apiBase: string,
  companyID: string,
  query: string,
  limit?: number,
  resourceTypes?: CompanyExplorerSearchResourceType[],
  signal?: AbortSignal,
): Promise<CompanyExplorerSearchResponse> {
  const params = new URLSearchParams();
  params.set("company_id", companyID);
  params.set("q", query);
  if (limit && limit > 0) params.set("limit", String(limit));
  const cleanResourceTypes = Array.from(new Set((resourceTypes ?? []).map((item) => item.trim()).filter(Boolean)));
  if (cleanResourceTypes.length > 0) params.set("resource_types", cleanResourceTypes.join(","));
  return requestJSON<CompanyExplorerSearchResponse>(
    apiBase,
    `/v1/company-explorer/search?${params.toString()}`,
    { signal },
  );
}
