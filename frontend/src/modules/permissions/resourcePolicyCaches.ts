import { invalidateLogicGateRecordStorePolicyCachesForCompany } from "../logic-gates/logicGateRecordStore.js";
import { invalidateNodeRecordStorePolicyCachesForCompany } from "../nodes/nodeRecordStore.js";

export function invalidateResourcePolicyDependentCaches(apiBase: string, companyID: string): void {
  const cleanApiBase = apiBase.trim();
  const cleanCompanyID = companyID.trim();
  if (!cleanApiBase || !cleanCompanyID) return;

  invalidateNodeRecordStorePolicyCachesForCompany(cleanApiBase, cleanCompanyID);
  invalidateLogicGateRecordStorePolicyCachesForCompany(cleanApiBase, cleanCompanyID);
}
