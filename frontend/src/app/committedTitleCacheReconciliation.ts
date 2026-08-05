import { markCommunicationsWorkspacePanelStale } from "../modules/communications/communicationsApi.js";
import type { CommittedEntityTitleUpdate } from "../modules/realtime/committedEntityTitleUpdates.js";
import { invalidateLogicGateRecordStoreCaches } from "../modules/logic-gates/logicGateRecordStore.js";
import { reconcileLogicGateRelationshipGraphTitle } from "../modules/logic-gates/logicGateRelationshipGraph.js";
import { reconcileKanbanBoardContentTitles } from "../modules/kanban/KanbanBoardContentStore.js";
import { invalidateKanbanBoardListCache } from "../modules/kanban/kanbanApi.js";
import { invalidateNodeRecordStoreCaches } from "../modules/nodes/nodeRecordStore.js";
import { reconcileNodeRelationshipGraphTitle } from "../modules/nodes/nodeRelationshipGraph.js";
import { invalidateProjectRelationshipsForResource } from "../modules/project-management/projectManagementApi.js";
import { invalidateWorkspaceSnapshot } from "../modules/workspace/workspaceSnapshotCache.js";
import { patchMyWorkMatrixCachesForCommittedTitle } from "../pages/home/myWorkMatrixLoader.js";

export function reconcileCachesForCommittedEntityTitle(
  apiBase: string,
  update: CommittedEntityTitleUpdate,
): void {
  const companyID = update.companyID.trim();
  const resourceID = update.resourceID.trim();
  if (!companyID || !resourceID) return;

  // Clear shared snapshots before synchronously patching the title-bearing
  // caches that can be served immediately by a mounted or remounted surface.
  invalidateWorkspaceSnapshot(apiBase, companyID);
  invalidateProjectRelationshipsForResource({
    companyID,
    resourceType: update.entityType,
    resourceID,
  });
  reconcileKanbanBoardContentTitles(apiBase, companyID, update);
  patchMyWorkMatrixCachesForCommittedTitle(update);

  if (update.entityType === "node") {
    invalidateNodeRecordStoreCaches(apiBase, companyID, resourceID);
    markCommunicationsWorkspacePanelStale(companyID, { nodes: true });
    reconcileNodeRelationshipGraphTitle(apiBase, companyID, update);
    return;
  }

  invalidateLogicGateRecordStoreCaches(apiBase, companyID, resourceID);
  markCommunicationsWorkspacePanelStale(companyID, { logicGates: true });
  invalidateKanbanBoardListCache(apiBase, companyID);
  reconcileLogicGateRelationshipGraphTitle(apiBase, companyID, update);
}
