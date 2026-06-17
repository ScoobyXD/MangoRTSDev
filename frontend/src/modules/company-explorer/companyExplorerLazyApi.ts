import { requestJSON } from "../api/requestJSON.js";
import type { CompanyExplorerSnapshotPayload } from "./companyExplorerStore.js";

export type CompanyExplorerLazyScope = "me" | "team" | "all";

export type CompanyExplorerV2EntityType = "company" | "user_group" | "user" | "folder" | "project" | "logic_gate" | "node";

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

function lazyScopeQuery(companyID: string, scope: CompanyExplorerLazyScope): string {
  return `company_id=${encodeURIComponent(companyID)}&view=${encodeURIComponent(scope)}`;
}

export function fetchCompanyExplorerRoots(
  apiBase: string,
  companyID: string,
  scope: CompanyExplorerLazyScope,
): Promise<CompanyExplorerSnapshotPayload> {
  return requestJSON<CompanyExplorerSnapshotPayload>(
    apiBase,
    `/v2/company-explorer/roots?${lazyScopeQuery(companyID, scope)}`,
  );
}

export function fetchCompanyExplorerChildren(
  apiBase: string,
  companyID: string,
  scope: CompanyExplorerLazyScope,
  parentEntityID: string,
): Promise<CompanyExplorerSnapshotPayload> {
  return requestJSON<CompanyExplorerSnapshotPayload>(
    apiBase,
    `/v2/company-explorer/entities/${encodeURIComponent(parentEntityID)}/children?${lazyScopeQuery(companyID, scope)}`,
  );
}
