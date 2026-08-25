import { requestJSON } from "../api/requestJSON.js";

export type CompanyHierarchyResourceType = "node" | "logic_gate" | "project";
export type HuddleHierarchyResourceType = "huddle_logic_gate" | "huddle_node";
export type HierarchyResourceType = CompanyHierarchyResourceType | HuddleHierarchyResourceType;
export type HierarchyPathKind = "company_explorer" | "huddle_explorer";
export type HierarchyPathStatus = "resolved" | "omitted";
export type HierarchyPathSegmentType = "folder" | "logic_gate" | "project" | "huddle_explorer_folder" | "huddle_logic_gate";

export type HierarchyPathSegment = {
  entity_type: HierarchyPathSegmentType;
  entity_id: string;
  resource_id?: string;
  name: string;
};

export type HierarchyPathResponse = {
  kind: HierarchyPathKind;
  status: HierarchyPathStatus;
  segments: HierarchyPathSegment[];
};

export type HierarchyPathRequest = {
  companyID: string;
  kind: HierarchyPathKind;
  resourceType: HierarchyResourceType;
  resourceID: string;
};

export function hierarchyPathRequestPath(request: HierarchyPathRequest): string {
  const params = new URLSearchParams({
    company_id: request.companyID.trim(),
    resource_type: request.resourceType,
    resource_id: request.resourceID.trim(),
  });
  const endpoint = request.kind === "huddle_explorer"
    ? "/v1/huddle-explorer/location-path"
    : "/v1/company-explorer/location-path";
  return `${endpoint}?${params.toString()}`;
}

export function fetchHierarchyPath(
  apiBase: string,
  request: HierarchyPathRequest,
  signal?: AbortSignal,
): Promise<HierarchyPathResponse> {
  return requestJSON<HierarchyPathResponse>(apiBase, hierarchyPathRequestPath(request), { signal, cache: "no-store" });
}
