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
} from "../pages/communications/communicationsApi";
import { subscribeCommunicationsStream } from "../pages/communications/communicationsStream";
import { invalidateLogicGateRelationshipGraphSnapshot } from "../modules/logic-gate-map/LogicGateRelationshipGraph";
import { invalidateNodeRelationshipGraphSnapshot } from "../modules/node-map/NodeRelationshipGraph";
import { markWorkspaceSnapshotStale } from "../modules/workspace/workspaceSnapshotCache";
import { subscribeWorkspaceStream } from "../modules/workspace/workspaceStream";

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

export function AppLiveFreshnessBridge() {
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
    const unsubscribe = subscribeWorkspaceStream(apiBase, companyID, {
      onEvent(event) {
        markWorkspaceCachesStaleForEvent(event, apiBase, companyID);
      },
      onError() {
        // Workspace consumers refresh on demand after cache invalidation.
      },
    });
    return unsubscribe;
  }, [apiBase, companyID]);

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

function markWorkspaceCachesStaleForEvent(event: StreamEvent, apiBase: string, companyID: string): void {
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
  markWorkspaceCachesStale(apiBase, companyID);
}

function markWorkspaceCachesStale(apiBase: string, companyID: string): void {
  markWorkspaceSnapshotStale(apiBase, companyID);
  markCommunicationsWorkspacePanelStale(companyID);
  invalidateNodeRelationshipGraphSnapshot(apiBase, companyID);
  invalidateLogicGateRelationshipGraphSnapshot(apiBase, companyID);
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
