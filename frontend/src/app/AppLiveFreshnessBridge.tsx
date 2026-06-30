import { useEffect, useRef } from "react";
import { fetchCurrentUser, readAuthConfig, type CurrentUserResponse } from "../auth/cognitoAuth";
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
import { EVENT_KANBAN_BOARD_CONTENTS_UPDATED, type KanbanBoardContentsUpdatedDetail } from "../modules/kanban/shared";
import { invalidateLogicGateRelationshipGraphSnapshot } from "../modules/logic-gate-map/LogicGateRelationshipGraph";
import { invalidateNodeRelationshipGraphSnapshot } from "../modules/node-map/NodeRelationshipGraph";
import { emitNotificationsUpdated } from "../modules/notifications/notificationsApi";
import { ensureMangoRealtimeConnection, subscribeRealtimeScope } from "../modules/realtime/realtimeWebSocket";
import { markWorkspaceSnapshotScopeStale, markWorkspaceSnapshotStale } from "../modules/workspace/workspaceSnapshotCache";
import { deriveWorkspaceReconciliationScopes, subscribeWorkspaceUserRealtime, workspaceRealtimeScope, type WorkspaceReconciliationScope, type WorkspaceStreamEventContext, type WorkspaceStreamGapSignal } from "../modules/workspace/workspaceRealtime";
import { EVENT_HOME_TRIAGE_CONVERSION_APPLIED, type HomeTriageConversionAppliedDetail } from "../pages/home/homeConstants";
import { localTriageConversionWasApplied, rememberLocalTriageConversionIDs } from "./appLiveFreshnessBridgeEcho";

type StreamEvent = {
  event: string;
  data: string;
};

type CommunicationsStreamEnvelope = {
  trigger?: string;
  message_id?: string;
  shared_inbox_id?: string;
};

type WorkspaceStreamEnvelope = {
  company_id?: string;
  type?: string;
};

export function AppLiveFreshnessBridge() {
  const companyID = getActiveCompanyID();
  const apiBase = readAuthConfig().apiBase;
  const locallyAppliedTriageConversionIDsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const unsubscribe = subscribeCommunicationsStream(apiBase, companyID, {
      onEvent(event) {
        markCommunicationsCachesStaleForEvent(event, companyID, (messageID, sharedInboxID) => (
          localTriageConversionWasApplied(locallyAppliedTriageConversionIDsRef.current, messageID, sharedInboxID)
        ));
      },
      onError() {
        // Individual pages surface reload errors; this bridge only keeps caches honest.
      },
    });
    return unsubscribe;
  }, [apiBase, companyID]);

  useEffect(() => {
    const rememberLocalTriageConversion = (event: Event) => {
      const detail = (event as CustomEvent<HomeTriageConversionAppliedDetail>).detail ?? {};
      if (detail.companyID && detail.companyID !== companyID) return;
      rememberLocalTriageConversionIDs(
        locallyAppliedTriageConversionIDsRef.current,
        detail.messageIDs ?? [],
        detail.sharedInboxID,
      );
    };
    window.addEventListener(EVENT_HOME_TRIAGE_CONVERSION_APPLIED, rememberLocalTriageConversion);
    return () => window.removeEventListener(EVENT_HOME_TRIAGE_CONVERSION_APPLIED, rememberLocalTriageConversion);
  }, [companyID]);

  useEffect(() => {
    if (!companyID) return undefined;
    return ensureMangoRealtimeConnection(apiBase, companyID);
  }, [apiBase, companyID]);

  useEffect(() => {
    if (!companyID) return undefined;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void fetchCurrentUser()
      .then((current) => {
        const userID = current.user.user_id.trim();
        if (cancelled || !userID || !currentUserCanUseCompany(current, companyID)) return;
        unsubscribe = subscribeRealtimeScope(apiBase, companyID, `notifications:user:${userID}`, {
          onNotificationCreated(message) {
            markNotificationCachesStaleForRealtimeMessage(message.company_id, companyID);
          },
          onNotificationDeleted(message) {
            markNotificationCachesStaleForRealtimeMessage(message.company_id, companyID);
          },
          onNotificationsCleared(message) {
            markNotificationCachesStaleForRealtimeMessage(message.company_id, companyID);
          },
        });
      })
      .catch(() => {
        // Auth gate owns visible auth failures; this bridge only wires live refresh.
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [apiBase, companyID]);

  useEffect(() => {
    if (!companyID) return undefined;
    const unsubscribe = subscribeWorkspaceUserRealtime(apiBase, companyID, workspaceRealtimeScope, {
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
  }, [apiBase, companyID]);

  return null;
}

function markCommunicationsCachesStaleForEvent(event: StreamEvent, companyID: string, localTriageConversionWasApplied?: (messageID: string, sharedInboxID?: string) => boolean): void {
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
    if (trigger.startsWith("triage.converted") && localTriageConversionWasApplied?.(messageID, envelope.shared_inbox_id)) return;
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

function currentUserCanUseCompany(current: CurrentUserResponse, companyID: string): boolean {
  const cleanCompanyID = companyID.trim();
  return !!cleanCompanyID && (current.is_dev_admin || current.memberships.some((membership) => membership.company_id === cleanCompanyID));
}

function markNotificationCachesStaleForRealtimeMessage(messageCompanyID: string | undefined, activeCompanyID: string): void {
  const cleanMessageCompanyID = messageCompanyID?.trim() ?? "";
  const cleanActiveCompanyID = activeCompanyID.trim();
  if (cleanMessageCompanyID && cleanMessageCompanyID !== cleanActiveCompanyID) return;
  emitNotificationsUpdated(cleanMessageCompanyID || cleanActiveCompanyID);
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
      case "updates":
        emitNotificationsUpdated(companyID);
        break;
      case "my_work":
        break;
      case "kanban_board":
        if (scope.boardID) {
          markWorkspaceSnapshotScopeStale(apiBase, companyID, { scope: "kanban", boardID: scope.boardID });
          invalidateKanbanBoardContentsCache(apiBase, companyID, scope.boardID);
          dispatchKanbanBoardContentsUpdated({ companyID, boardID: scope.boardID, logicGateID: scope.logicGateID });
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
          dispatchKanbanBoardContentsUpdated({ companyID, boardID: scope.boardID, logicGateID: scope.logicGateID });
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

function dispatchKanbanBoardContentsUpdated(detail: KanbanBoardContentsUpdatedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<KanbanBoardContentsUpdatedDetail>(EVENT_KANBAN_BOARD_CONTENTS_UPDATED, { detail }));
}

function markWorkspaceCachesStale(apiBase: string, companyID: string): void {
  markWorkspaceSnapshotStale(apiBase, companyID);
  markCommunicationsWorkspacePanelStale(companyID);
  invalidateKanbanBoardListCache(apiBase, companyID);
  invalidateNodeRelationshipGraphSnapshot(apiBase, companyID);
  invalidateLogicGateRelationshipGraphSnapshot(apiBase, companyID);
}

function workspacePanelCacheScopeForCompanyExplorerScope(scope: WorkspaceReconciliationScope): CommunicationsWorkspacePanelCacheScope {
  if (scope.semanticScope) return {};
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
