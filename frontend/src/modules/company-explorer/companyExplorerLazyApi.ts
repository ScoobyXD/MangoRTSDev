import { requestJSON } from "../api/requestJSON.js";
import type { CompanyExplorerSnapshotPayload } from "./companyExplorerStore.js";

export type CompanyExplorerLazyScope = "me" | "team" | "all";

export type CompanyExplorerV2EntityType = "company" | "user_group" | "user" | "folder" | "project" | "logic_gate" | "node";


export type CompanyExplorerV2SubscriptionOwnerType = "user" | "team";

export type CompanyExplorerV2Subscription = {
  company_id: string;
  subscription_id: string;
  owner_type: CompanyExplorerV2SubscriptionOwnerType;
  owner_id: string;
  anchor_entity_id: string;
  position: number;
  created_by_user_id?: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type CompanyExplorerV2SubscriptionInput = {
  companyID: string;
  ownerType: CompanyExplorerV2SubscriptionOwnerType;
  ownerID: string;
  anchorEntityID: string;
  position?: number;
};
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
export function subscribeCompanyExplorerEntity(
  apiBase: string,
  input: CompanyExplorerV2SubscriptionInput,
): Promise<CompanyExplorerV2Subscription> {
  return requestJSON<CompanyExplorerV2Subscription>(apiBase, "/v2/company-explorer/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      owner_type: input.ownerType,
      owner_id: input.ownerID,
      anchor_entity_id: input.anchorEntityID,
      position: input.position,
    }),
  });
}

export function deleteCompanyExplorerSubscription(
  apiBase: string,
  companyID: string,
  subscriptionID: string,
): Promise<{ status?: string }> {
  return requestJSON<{ status?: string }>(
    apiBase,
    `/v2/company-explorer/subscriptions/${encodeURIComponent(subscriptionID)}?company_id=${encodeURIComponent(companyID)}`,
    { method: "DELETE" },
  );
}
