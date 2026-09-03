import { markCommunicationsWorkspaceResourcesStale } from "../modules/communications/communicationsApi.js";
import type { CommittedEntityTitleUpdate } from "../modules/realtime/committedEntityTitleUpdates.js";
import { invalidateLogicGateRecordStoreCaches } from "../modules/logic-gates/logicGateRecordStore.js";
import { reconcileProcessWorkTitles } from "../modules/kanban/ProcessWorkStore.js";
import { invalidateNodeRecordStoreCaches } from "../modules/nodes/nodeRecordStore.js";
import { reconcileNodeRelationshipGraphTitle } from "../modules/nodes/nodeRelationshipGraph.js";
import { invalidateProjectRelationshipsForResource } from "../modules/project-management/projectManagementApi.js";

export function reconcileCachesForCommittedEntityTitle(
  apiBase: string,
  update: CommittedEntityTitleUpdate,
): void {
  const companyID = update.companyID.trim();
  const resourceID = update.resourceID.trim();
  if (!companyID || !resourceID) return;

  invalidateProjectRelationshipsForResource({
    companyID,
    resourceType: update.entityType,
    resourceID,
  });
  reconcileProcessWorkTitles(apiBase, companyID, update);
  if (update.entityType === "node") {
    invalidateNodeRecordStoreCaches(apiBase, companyID, resourceID);
    markCommunicationsWorkspaceResourcesStale(companyID, { nodes: true });
    reconcileNodeRelationshipGraphTitle(apiBase, companyID, update);
    return;
  }

  invalidateLogicGateRecordStoreCaches(apiBase, companyID, resourceID);
  markCommunicationsWorkspaceResourcesStale(companyID, { logicGates: true });
}
