import { requestJSON } from "../api/requestJSON.js";
import type { CompanyExplorerSnapshotPayload } from "./companyExplorerStore.js";

export type CompanyExplorerLazyScope = "all";

export type CompanyExplorerV2EntityType = "company" | "folder" | "project" | "logic_gate" | "node";

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
  native_context?: Record<string, string>;
  created_timestamp: string;
  updated_timestamp: string;
};

function lazyScopeQuery(companyID: string): string {
  return `company_id=${encodeURIComponent(companyID)}`;
}

export function fetchCompanyExplorerRoots(
  apiBase: string,
  companyID: string,
  scope: CompanyExplorerLazyScope,
): Promise<CompanyExplorerSnapshotPayload> {
  void scope;
  return requestJSON<CompanyExplorerSnapshotPayload>(
    apiBase,
    `/v1/company-explorer/roots?${lazyScopeQuery(companyID)}`,
  );
}

export function fetchCompanyExplorerChildren(
  apiBase: string,
  companyID: string,
  scope: CompanyExplorerLazyScope,
  parentEntityID: string,
): Promise<CompanyExplorerSnapshotPayload> {
  void scope;
  return requestJSON<CompanyExplorerSnapshotPayload>(
    apiBase,
    `/v1/company-explorer/children?${lazyScopeQuery(companyID)}&parent_id=${encodeURIComponent(parentEntityID)}`,
  );
}
