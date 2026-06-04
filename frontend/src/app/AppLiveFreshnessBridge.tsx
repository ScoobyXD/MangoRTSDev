import { useEffect } from "react";
import { readAuthConfig } from "../auth/cognitoAuth";
import { getActiveCompanyID } from "../auth/currentCompany";
import {
  applyEmailMessageToCachedPages,
  getEmailMessage,
  invalidateCommunicationsCache,
  invalidateCommunicationsFolderCache,
  invalidateEmailMessageCache,
  markCommunicationsWorkspacePanelStale,
  removeEmailMessageFromCache,
  type CommunicationsWorkspacePanelCacheScope,
} from "../modules/communications/communicationsApi";
import { subscribeCommunicationsStream } from "../modules/communications/communicationsStream";
import { invalidateKanbanBoardListCache, invalidateLogicGateArenaViewCache } from "../modules/kanban/kanbanApi";
import { invalidateKanbanBoardContentsCache } from "../modules/kanban/KanbanBoardContentStore";
import { invalidateLogicGateRelationshipGraphSnapshot } from "../modules/logic-gate-map/LogicGateRelationshipGraph";
import { invalidateNodeRelationshipGraphSnapshot } from "../modules/node-map/NodeRelationshipGraph";
import { ensureMangoRealtimeConnection } from "../modules/realtime/realtimeWebSocket";
import { markWorkspaceSnapshotScopeStale, markWorkspaceSnapshotStale } from "../modules/workspace/workspaceSnapshotCache";
import { deriveWorkspaceReconciliationScopes, subscribeWorkspaceStream, type WorkspaceReconciliationScope, type WorkspaceStreamEventContext, type WorkspaceStreamGapSignal } from "../modules/workspace/workspaceStream";

type StreamEvent = {
  event: string;
  data: string;
};

type CommunicationsStreamEnvelope = {
  trigger?: string;
  message_id?: string;
};

type WorkspaceStreamEnvelope = {
  company_id?: string;
  type?: string;
};

type AppLiveFreshnessBridgeProps = {
  suppressWorkspaceStream?: boolean;
};

export function AppLiveFreshnessBridge({ suppressWorkspaceStream = false }: AppLiveFreshnessBridgeProps) {
  const companyID = getActiveCompanyID();
  const apiBase = readAuthConfig().apiBase;

  useEffect(() => {
    const unsubscribe = subscribeCommunicationsStream({
      onEvent(event) {
        markCommunicationsCachesStaleForEvent(event, companyID);
      },
      onError() {
        // Individual pages surface reload errors; this bridge only keeps caches honest.
      },
    });
    return unsubscribe;
  }, [companyID]);

  useEffect(() => {
    if (!companyID) return undefined;
    return ensureMangoRealtimeConnection(apiBase, companyID);
  }, [apiBase, companyID]);

  useEffect(() => {
    if (!companyID || suppressWorkspaceStream) return undefined;
    const unsubscribe = subscribeWorkspaceStream(apiBase, companyID, {
      onEvent(event, context: WorkspaceStreamEventContext) {
        markWorkspaceCachesStaleForEvent(event, apiBase, companyID, context.scopes);
      },
      onGap(gap) {
        markWorkspaceCachesStaleForGap(gap, apiBase, companyID);
      },
      onError() {
        // Workspace consumers refresh on demand after cache invalidation.
      },
    });
    return unsubscribe;
  }, [apiBase, companyID, suppressWorkspaceStream]);

  return null;
}

function markCommunicationsCachesStaleForEvent(event: StreamEvent, companyID: string): void {
  if (event.event !== "communications") return;
  let envelope: CommunicationsStreamEnvelope;
  try {
    envelope = JSON.parse(event.data) as CommunicationsStreamEnvelope;
  } catch {
    return;
  }

  const trigger = envelope.trigger?.trim().toLowerCase() ?? "";
  const messageID = envelope.message_id?.trim() ?? "";
  if (!trigger) return;

  if (trigger.startsWith("folder.")) {
    invalidateCommunicationsFolderCache();
    return;
  }

  if (trigger.startsWith("triage.")) {
    invalidateCommunicationsCache({ messagePages: true });
    return;
  }

  if (!trigger.startsWith("message.")) return;
  if (trigger.startsWith("message.deleted") && messageID) {
    removeEmailMessageFromCache(messageID);
  } else if (messageID) {
    invalidateEmailMessageCache(messageID);
  } else {
    invalidateCommunicationsCache({ messages: true });
  }
  invalidateCommunicationsCache({ messagePages: true });
  if (trigger.startsWith("message.created") && messageID) primeCreatedMessageFromStream(messageID, companyID);
}

function markWorkspaceCachesStaleForEvent(event: StreamEvent, apiBase: string, companyID: string, scopes: WorkspaceReconciliationScope[] = []): void {
  if (event.event !== "workspace") return;
  let envelope: WorkspaceStreamEnvelope;
  try {
    envelope = JSON.parse(event.data) as WorkspaceStreamEnvelope;
  } catch {
    markWorkspaceCachesStale(apiBase, companyID);
    return;
  }

  const eventCompanyID = envelope.company_id?.trim() ?? "";
  if (eventCompanyID && eventCompanyID !== companyID) return;
  const effectiveScopes = scopes.length > 0 ? scopes : deriveWorkspaceReconciliationScopes(envelope);
  markWorkspaceCachesStaleForScopes(effectiveScopes, apiBase, companyID);
}

function markWorkspaceCachesStaleForGap(gap: WorkspaceStreamGapSignal, apiBase: string, companyID: string): void {
  if (gap.companyID !== companyID) return;
  markWorkspaceCachesStaleForScopes(gap.scopes.length > 0 ? gap.scopes : [{ kind: "workspace", eventType: "workspace_gap_unscoped" }], apiBase, companyID);
}

function markWorkspaceCachesStaleForScopes(scopes: WorkspaceReconciliationScope[], apiBase: string, companyID: string): void {
  if (scopes.length === 0) return;
  const workspacePanelScope: CommunicationsWorkspacePanelCacheScope = {};
  const markPanelScope = (scope: CommunicationsWorkspacePanelCacheScope) => {
    Object.assign(workspacePanelScope, scope);
  };
  for (const scope of scopes) {
    switch (scope.kind) {
      case "node_graph":
        markWorkspaceSnapshotScopeStale(apiBase, companyID, { scope: "node_map" });
        invalidateNodeRelationshipGraphSnapshot(apiBase, companyID);
        markPanelScope(scope.eventType === "node_deleted" || scope.eventType === "node_permissions_updated"
          ? { nodes: true, nodeFolderItems: true }
          : { nodes: true });
        break;
      case "logic_gate_graph":
        markWorkspaceSnapshotScopeStale(apiBase, companyID, { scope: "logic_gate_map" });
        invalidateLogicGateRelationshipGraphSnapshot(apiBase, companyID);
        markPanelScope(scope.eventType === "logic_gate_deleted" || scope.eventType === "logic_gate_permissions_updated"
          ? { logicGates: true, logicGateFolderItems: true }
          : { logicGates: true });
        break;
      case "company_explorer":
        markWorkspaceSnapshotScopeStale(apiBase, companyID, { scope: "company_explorer" });
        markPanelScope(workspacePanelCacheScopeForCompanyExplorerScope(scope));
        break;
      case "kanban_board":
        if (scope.boardID) {
          markWorkspaceSnapshotScopeStale(apiBase, companyID, { scope: "kanban", boardID: scope.boardID });
          invalidateKanbanBoardContentsCache(apiBase, companyID, scope.boardID);
        }
        if (scope.logicGateID) invalidateLogicGateArenaViewCache(apiBase, companyID, scope.logicGateID);
        break;
      case "kanban_board_list":
        invalidateKanbanBoardListCache(apiBase, companyID);
        if (scope.logicGateID) invalidateLogicGateArenaViewCache(apiBase, companyID, scope.logicGateID);
        break;
      case "work_item_assignment":
        if (scope.boardID) {
          markWorkspaceSnapshotScopeStale(apiBase, companyID, { scope: "kanban", boardID: scope.boardID });
          invalidateKanbanBoardContentsCache(apiBase, companyID, scope.boardID);
        }
        if (scope.logicGateID) invalidateLogicGateArenaViewCache(apiBase, companyID, scope.logicGateID);
        if (scope.nodeID) {
          markWorkspaceSnapshotScopeStale(apiBase, companyID, { scope: "node_map" });
          invalidateNodeRelationshipGraphSnapshot(apiBase, companyID);
        }
        markPanelScope({ nodes: true });
        break;
      case "workspace":
        markWorkspaceCachesStale(apiBase, companyID);
        return;
    }
  }
  if (Object.values(workspacePanelScope).some(Boolean)) markCommunicationsWorkspacePanelStale(companyID, workspacePanelScope);
}

function markWorkspaceCachesStale(apiBase: string, companyID: string): void {
  markWorkspaceSnapshotStale(apiBase, companyID);
  markCommunicationsWorkspacePanelStale(companyID);
  invalidateKanbanBoardListCache(apiBase, companyID);
  invalidateNodeRelationshipGraphSnapshot(apiBase, companyID);
  invalidateLogicGateRelationshipGraphSnapshot(apiBase, companyID);
}

function workspacePanelCacheScopeForCompanyExplorerScope(scope: WorkspaceReconciliationScope): CommunicationsWorkspacePanelCacheScope {
  const eventType = scope.eventType.trim();
  if (eventType === "company_explorer_folder_item_assigned" || eventType === "company_explorer_folder_item_removed") {
    if (scope.itemType === "node") return { nodeFolderItems: true };
    if (scope.itemType === "logic_gate") return { logicGateFolderItems: true };
    return {};
  }
  if (eventType.startsWith("company_explorer_folder_")) {
    if (scope.folderKind === "node") return { nodeFolders: true, nodeFolderItems: true };
    if (scope.folderKind === "logic_gate") return { logicGateFolders: true, logicGateFolderItems: true };
    return {};
  }
  if (eventType === "node_deleted" || eventType === "node_permissions_updated") return { nodeFolderItems: true };
  if (eventType === "logic_gate_deleted" || eventType === "logic_gate_permissions_updated") return { logicGateFolderItems: true };
  return {};
}

function primeCreatedMessageFromStream(messageID: string, companyID: string): void {
  void getEmailMessage(messageID, companyID || undefined)
    .then((message) => {
      applyEmailMessageToCachedPages(message, { prependIfMissing: true, maxMessages: 15 });
    })
    .catch(() => {
      // The next visible list load still fetches a fresh page after the invalidation above.
    });
}
