import { requestJSON } from "../api/requestJSON";
import type { CompanyExplorerSnapshotPayload } from "./companyExplorerStore";

export type CompanyExplorerLazyScope = "me" | "team" | "all";
export type CompanyExplorerLazyParentType = "folder" | "logic_gate";

function lazyScopeQuery(companyID: string, scope: CompanyExplorerLazyScope): string {
  return `company_id=${encodeURIComponent(companyID)}&scope=${encodeURIComponent(scope)}`;
}

export function fetchCompanyExplorerRoots(
  apiBase: string,
  companyID: string,
  scope: CompanyExplorerLazyScope,
): Promise<CompanyExplorerSnapshotPayload> {
  return requestJSON<CompanyExplorerSnapshotPayload>(
    apiBase,
    `/v1/company-explorer/roots?${lazyScopeQuery(companyID, scope)}`,
  );
}

export function fetchCompanyExplorerChildren(
  apiBase: string,
  companyID: string,
  scope: CompanyExplorerLazyScope,
  parentType: CompanyExplorerLazyParentType,
  parentID: string,
): Promise<CompanyExplorerSnapshotPayload> {
  return requestJSON<CompanyExplorerSnapshotPayload>(
    apiBase,
    `/v1/company-explorer/children?${lazyScopeQuery(companyID, scope)}&parent_type=${encodeURIComponent(parentType)}&parent_id=${encodeURIComponent(parentID)}`,
  );
}
