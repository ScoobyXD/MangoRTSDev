import {
  sortEmailMessagesByDateDescending,
  type CommunicationsEmailCollaboration,
  type EmailMessage,
} from "../../modules/communications/communicationsApi.js";
import type { HomeViewID } from "./homeTypes.js";

export function sharedInboxIDForHomeView(viewID: HomeViewID): string {
  return viewID.startsWith("shared:") ? viewID.slice("shared:".length).trim() : "";
}

export function emailMessageUsesActiveProviderScope(
  message: EmailMessage,
  viewID: HomeViewID,
  currentUserID: string,
  accountEmail: string,
): boolean {
  if (!message.collaboration_id?.trim()) return true;
  const sourceSharedInboxID = message.collaboration_shared_inbox_id?.trim() ?? "";
  if (sourceSharedInboxID) return sharedInboxIDForHomeView(viewID) === sourceSharedInboxID;
  const sourcePersonalUserID = message.collaboration_personal_user_id?.trim() ?? "";
  if (sourcePersonalUserID && sourcePersonalUserID !== currentUserID.trim()) return false;
  if (viewID !== "my-triage") return false;
  const sourceAccountEmail = message.collaboration_account_email?.trim().toLowerCase() ?? "";
  return !!sourceAccountEmail && sourceAccountEmail === accountEmail.trim().toLowerCase();
}

function emailCollaborationSnapshot(collaboration: CommunicationsEmailCollaboration): EmailMessage | null {
  return collaboration.latest_message ?? collaboration.message_snapshot ?? collaboration.message ?? null;
}

function collaborationSourceScopeKey(collaboration: CommunicationsEmailCollaboration): string {
  const sharedInboxID = collaboration.shared_inbox_id?.trim() ?? "";
  if (sharedInboxID) return JSON.stringify([collaboration.company_id.trim(), "shared", sharedInboxID]);
  const personalUserID = collaboration.personal_user_id?.trim() ?? "";
  const accountEmail = collaboration.account_email?.trim().toLowerCase()
    || collaboration.personal_account_email?.trim().toLowerCase()
    || "";
  if (personalUserID || accountEmail) {
    return JSON.stringify([collaboration.company_id.trim(), "personal", personalUserID, accountEmail]);
  }
  return JSON.stringify([collaboration.company_id.trim(), "collaboration", collaboration.collaboration_id.trim()]);
}

function collaborationAccountEmail(collaboration: CommunicationsEmailCollaboration): string {
  return collaboration.account_email?.trim().toLowerCase()
    || collaboration.personal_account_email?.trim().toLowerCase()
    || "";
}

export function emailMessageMatchesCollaboration(
  candidate: EmailMessage,
  collaboration: CommunicationsEmailCollaboration,
  viewID: HomeViewID,
  providerAccountEmail = "",
  providerPersonalUserID = "",
): boolean {
  const collaborationMessage = emailCollaborationListMessage(collaboration);
  if (!collaborationMessage) return false;
  const candidateCollaborationID = candidate.collaboration_id?.trim() ?? "";
  const targetCollaborationID = collaboration.collaboration_id.trim();
  const targetSharedInboxID = collaboration.shared_inbox_id?.trim() ?? "";
  const targetPersonalUserID = collaboration.personal_user_id?.trim() ?? "";
  const targetAccountEmail = collaborationAccountEmail(collaboration);

  if (candidateCollaborationID) {
    if (candidateCollaborationID !== targetCollaborationID) {
      const candidateSharedInboxID = candidate.collaboration_shared_inbox_id?.trim() ?? "";
      if (candidateSharedInboxID || targetSharedInboxID) {
        if (!candidateSharedInboxID || candidateSharedInboxID !== targetSharedInboxID) return false;
      } else {
        const candidatePersonalUserID = candidate.collaboration_personal_user_id?.trim() ?? "";
        const candidateAccountEmail = candidate.collaboration_account_email?.trim().toLowerCase() ?? "";
        if (!candidateAccountEmail || !targetAccountEmail || candidateAccountEmail !== targetAccountEmail) return false;
        if (candidatePersonalUserID && targetPersonalUserID && candidatePersonalUserID !== targetPersonalUserID) return false;
      }
    }
  } else if (targetSharedInboxID) {
    if (sharedInboxIDForHomeView(viewID) !== targetSharedInboxID) return false;
  } else {
    if (sharedInboxIDForHomeView(viewID)) return false;
    if (!targetAccountEmail || targetAccountEmail !== providerAccountEmail.trim().toLowerCase()) return false;
    if (targetPersonalUserID && providerPersonalUserID.trim() && targetPersonalUserID !== providerPersonalUserID.trim()) return false;
  }

  const threadID = collaborationMessage.thread_id?.trim() ?? "";
  return candidate.id === collaborationMessage.id
    || Boolean(threadID && candidate.thread_id?.trim() === threadID);
}

export function emailCollaborationListMessage(collaboration: CommunicationsEmailCollaboration): EmailMessage | null {
  const snapshot = emailCollaborationSnapshot(collaboration);
  if (!snapshot) return null;
  const messageID = snapshot.id?.trim() || collaboration.latest_message_id?.trim() || collaboration.root_message_id?.trim() || "";
  if (!messageID) return null;
  return {
    ...snapshot,
    id: messageID,
    thread_id: snapshot.thread_id?.trim() || collaboration.provider_thread_id?.trim() || undefined,
    collaboration_id: collaboration.collaboration_id,
    collaboration_node_id: collaboration.node_id,
    collaboration_information_id: collaboration.attached_email_information_id,
    collaboration_scope_type: collaboration.scope_type,
    collaboration_personal_user_id: collaboration.personal_user_id,
    collaboration_shared_inbox_id: collaboration.shared_inbox_id?.trim() || undefined,
    collaboration_account_email: collaboration.account_email?.trim() || undefined,
    client_source_scope_key: collaborationSourceScopeKey(collaboration),
  };
}

export function mergeEmailCollaborationsForView(
  providerMessages: EmailMessage[],
  collaborations: CommunicationsEmailCollaboration[],
  viewID: HomeViewID,
  navigableSharedInboxIDs: Set<string>,
  providerAccountEmail = "",
  providerSourceScopeKey = "",
  providerPersonalUserID = "",
): EmailMessage[] {
  if (viewID !== "my-triage" && !viewID.startsWith("shared:")) return providerMessages;
  const activeSharedInboxID = sharedInboxIDForHomeView(viewID);
  const visibleCollaborations = collaborations.filter((collaboration) => {
    const sourceSharedInboxID = collaboration.shared_inbox_id?.trim() ?? "";
    if (activeSharedInboxID) return sourceSharedInboxID === activeSharedInboxID;
    return !sourceSharedInboxID || !navigableSharedInboxIDs.has(sourceSharedInboxID);
  });
  const activeProviderSourceScopeKey = providerSourceScopeKey.trim() || JSON.stringify([
    activeSharedInboxID ? "shared" : "personal",
    activeSharedInboxID || providerAccountEmail.trim().toLowerCase() || "mailbox",
  ]);
  const activeProviderMailboxIsAuthoritative = activeSharedInboxID
    ? navigableSharedInboxIDs.has(activeSharedInboxID)
    : Boolean(providerAccountEmail.trim());
  const merged = providerMessages.map((message) => ({
    ...message,
    client_source_scope_key: message.client_source_scope_key?.trim() || activeProviderSourceScopeKey,
  }));
  for (const collaboration of visibleCollaborations) {
    const collaborationMessage = emailCollaborationListMessage(collaboration);
    if (!collaborationMessage) continue;
    const existingIndexes: number[] = [];
    merged.forEach((candidate, candidateIndex) => {
      if (emailMessageMatchesCollaboration(candidate, collaboration, viewID, providerAccountEmail, providerPersonalUserID)) existingIndexes.push(candidateIndex);
    });
    if (existingIndexes.length > 0) {
      for (const existingIndex of existingIndexes) {
        merged[existingIndex] = {
          ...collaborationMessage,
          ...merged[existingIndex],
          client_source_scope_key: merged[existingIndex].client_source_scope_key,
        };
      }
    } else if (
      !activeProviderMailboxIsAuthoritative
      || !emailMessageUsesActiveProviderScope(collaborationMessage, viewID, providerPersonalUserID, providerAccountEmail)
    ) {
      merged.push({
        ...collaborationMessage,
        client_source_scope_key: collaborationMessage.client_source_scope_key?.trim() || collaborationSourceScopeKey(collaboration),
      });
    }
  }
  return sortEmailMessagesByDateDescending(merged);
}
