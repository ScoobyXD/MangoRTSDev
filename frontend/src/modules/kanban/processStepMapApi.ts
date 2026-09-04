import { requestJSON } from "../api/requestJSON.js";
import { dispatchLogicGateWorkUpdated, invalidateLogicGateArenaViewCache } from "./kanbanApi.js";
import type { ProcessStepMapLayout } from "./processStepMapGeometry.js";

export function getProcessStepMap(apiBase: string, companyID: string, processID: string, signal?: AbortSignal): Promise<ProcessStepMapLayout> {
  return requestJSON(apiBase, `/v2/logic-gates/${encodeURIComponent(processID)}/step-map?${new URLSearchParams({ company_id: companyID })}`, { signal });
}

export async function saveProcessStepMap(apiBase: string, companyID: string, processID: string, layout: ProcessStepMapLayout): Promise<ProcessStepMapLayout> {
  const saved = await requestJSON<ProcessStepMapLayout>(apiBase, `/v2/logic-gates/${encodeURIComponent(processID)}/step-map`, {
    method: "PUT",
    json: { company_id: companyID, base_revision: layout.revision, steps: layout.steps, routes: layout.routes },
  });
  invalidateLogicGateArenaViewCache(apiBase, companyID, processID);
  dispatchLogicGateWorkUpdated(companyID, processID);
  return saved;
}
